import test from 'node:test';
import assert from 'node:assert/strict';
import { Vec3 } from 'vec3';
import * as perception from '../../src/skills/perception.js';
import * as survival from '../../src/skills/survival.js';
import { createGameTools } from '../../src/tools/game-tools.js';

const key = p => `${p.x},${p.y},${p.z}`;
function makeWorld(solids, { mode = 'creative', at = [11.5, -56, 0.5] } = {}) {
    const cells = new Map(solids.map(([x, y, z, name = 'oak_planks']) => [key({ x, y, z }), name]));
    const block = p => {
        const n = cells.get(key(p)) ?? 'air';
        return {
            name: n,
            position: new Vec3(p.x, p.y, p.z),
            shapes: n === 'air' ? [] : [[0, 0, 0, 1, 1, 1]],
            boundingBox: n === 'air' ? 'empty' : 'block',
        };
    };
    const placed = [],
        log = [];
    const b = {
        username: 'T',
        game: { gameMode: mode },
        pi_game_mode: mode,
        entity: { id: 1, position: new Vec3(...at), eyeHeight: 1.62, yaw: 0, pitch: 0 },
        entities: {},
        inventory: {
            items: () => [],
            slots: new Array(46).fill(null),
            findInventoryItem: () => ({ name: 'oak_planks', type: 1, count: 64 }),
        },
        world: { getBlock: p => block(new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))) },
        pathfinder: {
            setMovements() {},
            setGoal() {},
            stop() {},
            goto: async () => {
                log.push('PATHFIND');
            },
        },
        clearControlStates() {},
        stopDigging() {},
        deactivateItem() {},
        dig: () => {
            throw new Error('dig');
        },
        equip: async () => {},
        lookAt: async () => {},
        heldItem: { type: 1 },
        chat() {},
        placeBlock: async (ref, face) => {
            const t = ref.position.plus(face);
            cells.set(key(t), 'oak_planks');
            placed.push(key(t));
        },
    };
    b.blockAt = p => block(p);
    const tools = createGameTools({
        bot: b,
        perception,
        skills: survival,
        observe: async () => ({ state: {}, frame: null }),
    });
    return { b, cells, placed, log, run: (n, a) => tools.find(t => t.name === n).execute('id', a) };
}
const roof = [];
for (const [x, z] of [
    [10, -3],
    [12, -3],
    [13, -3],
    [12, -2],
    [13, -2],
])
    roof.push([x, -53, z]);
for (let x = 10; x <= 13; x++) for (let z = -1; z <= 2; z++) roof.push([x, -53, z]);
for (let x = 9; x <= 13; x++) roof.push([x, -54, -3]);

test('go_to reports its stop position and tolerance, on success and failure', async () => {
    const w = makeWorld([], { at: [0.5, 64, 0.5] });
    const tools = createGameTools({
        bot: w.b,
        perception,
        skills: {
            goToPosition: async (bot, x, y, z, d) => {
                bot.entity.position = new Vec3(x + 1.2, y, z + 0.4);
                return d >= 1;
            },
        },
    });
    const go = a => tools.find(t => t.name === 'go_to').execute('id', a);
    const ok = (await go({ x: 10, y: 64, z: 0 })).details.result;
    assert.equal(ok.tolerance, 2);
    assert.deepEqual(ok.stoppedAt, { x: 11.2, y: 64, z: 0.4 });
    assert.equal(ok.distanceToTarget, 1.26);
    const bad = await go({ x: 10, y: 64, z: 0, distance: 0.5 });
    assert.equal(bad.isError, true);
    assert.equal(bad.details.facts.tolerance, 0.5);
    assert.deepEqual(bad.details.facts.stoppedAt, { x: 11.2, y: 64, z: 0.4 });
});

const ground = [];
for (let x = -2; x <= 8; x++) for (let z = -3; z <= 3; z++) ground.push([x, 63, z, 'grass_block']);
