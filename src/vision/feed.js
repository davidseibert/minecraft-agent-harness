import { EventEmitter } from 'node:events';
import { Vec3 } from 'vec3';
import entityModels from 'prismarine-viewer/viewer/lib/entity/entities.json' with { type: 'json' };

export function worldFeed(bot, compat, deliver) {
    const known = new Set();
    const emitter = new EventEmitter();
    const on = EventEmitter.prototype.emit.bind(emitter);
    emitter.emit = (event, data) => {
        if (event === 'loadChunk') data = { ...data, chunk: compat.chunk(data.chunk) };
        if (event === 'blockUpdate') data = { ...data, stateId: compat.state(data.stateId) };
        if (event === 'entity') {
            if (data.id === bot.entity.id) return false;
            if (data.delete) {
                if (!known.has(data.id)) return false;
                known.delete(data.id);
            } else {
                known.add(data.id);
                const source = bot.entities[data.id];
                const name = data.name ?? source?.name;
                data = {
                    ...data,
                    name: entityModels[name] ? name : undefined,
                    width: data.width ?? source?.width ?? 0.5,
                    height: data.height ?? source?.height ?? 0.5,
                    username: data.username ?? source?.username,
                };
            }
        }
        if (['loadChunk', 'unloadChunk', 'blockUpdate', 'entity'].includes(event)) deliver(event, data);
        return on(event, data);
    };
    return { emitter, reset: () => known.clear() };
}

export async function waitForColumn(worldView, bot, deadline, check = () => {}) {
    for (;;) {
        check();
        if (Date.now() >= deadline) throw new Error('Camera timed out waiting for current world column');
        const pos = bot.entity.position.clone();
        await worldView.updatePosition(pos);
        check();
        const current = bot.entity.position;
        if (
            Math.floor(pos.x / 16) !== Math.floor(current.x / 16) ||
            Math.floor(pos.z / 16) !== Math.floor(current.z / 16)
        )
            continue;
        const column = new Vec3(Math.floor(pos.x / 16) * 16, 0, Math.floor(pos.z / 16) * 16);
        if (worldView.loadedChunks[`${column.x},${column.z}`]) return;
        await worldView.loadChunk(column);
        await new Promise(resolve => setTimeout(resolve, 20));
    }
}

export function eyePose(entity) {
    const eye = entity.eyeHeight ?? (Number.isFinite(entity.height) ? Math.min(1.62, entity.height * 0.9) : 1.62);
    return {
        pos: { x: entity.position.x, y: entity.position.y + eye, z: entity.position.z },
        pitch: entity.pitch,
        yaw: entity.yaw,
    };
}

export const LIMITATIONS =
    'Approximate prismarine graphics, not vanilla: no HUD, weather or time-of-day lighting. Unsupported blocks omitted; some entities are placeholders.';
