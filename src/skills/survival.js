import { Vec3 } from 'vec3';
import * as skills from './skills.js';
import { isBlockVisible, isEntityVisible, blockSight, SIGHT_RANGE } from './perception.js';

export const PLACEMENT_FACES = ['bottom', 'top', 'north', 'south', 'east', 'west', 'side'];
const CONTROLS = ['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak'];

function assertSurvival(bot) {
    const wanted = bot.pi_game_mode === 'creative' ? 'creative' : 'survival';
    if (bot.game?.gameMode !== wanted || bot.modes.isOn('cheat')) {
        throw new Error(`This action requires ${wanted} mode with cheats off.`);
    }
}

export function blockPosition(x, y, z) {
    if (
        ![x, y, z].every(Number.isSafeInteger) ||
        Math.abs(x) >= 30000000 ||
        Math.abs(z) >= 30000000 ||
        y < -64 ||
        y >= 320
    ) {
        throw new Error('Use integer block coordinates within the world bounds.');
    }
    return new Vec3(x, y, z);
}

function visibleBlock(bot, x, y, z, reach = SIGHT_RANGE) {
    const block = bot.blockAt(blockPosition(x, y, z));
    if (!isBlockVisible(bot, block, reach)) {
        const s = blockSight(bot, block, reach);
        if (!s.visible) {
            const o = s.obstruction,
                far =
                    bot.entity?.position && block?.position
                        ? bot.entity.position.distanceTo(block.position.offset(0.5, 0.5, 0.5)) > reach
                        : false;
            const why = far
                ? ` It is ${Math.round(bot.entity.position.distanceTo(block.position))} blocks away; get closer.`
                : o
                  ? ` Every line of sight to it is blocked; the first block in the way is ${o.name} at ${o.x}, ${o.y}, ${o.z}. Break that one first, or stand where a face of it is open.`
                  : ' Move or look around first.';
            throw new Error(`Block at ${x}, ${y}, ${z} is not visible within ${reach} blocks.${why}`);
        }
    }
    return block;
}

export async function placeAt(bot, type, x, y, z, face = 'bottom') {
    assertSurvival(bot);
    if (!PLACEMENT_FACES.includes(face)) throw new Error('Invalid placement face.');
    if (!bot.blockAt(blockPosition(x, y, z))) throw new Error(`Block at ${x}, ${y}, ${z} is not loaded.`);
    if (bot.interrupt_code) return false;
    return await skills.placeBlock(bot, type, x, y, z, face, true);
}

export async function breakAt(bot, x, y, z) {
    assertSurvival(bot);
    visibleBlock(bot, x, y, z);
    if (bot.interrupt_code) return false;
    return await skills.breakBlockAt(bot, x, y, z);
}

export async function placeLine(bot, type, x, y, z, axis, count) {
    assertSurvival(bot);
    const steps = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1], '-x': [-1, 0, 0], '-y': [0, -1, 0], '-z': [0, 0, -1] };
    if (!Object.hasOwn(steps, axis) || !Number.isInteger(count) || count < 1 || count > 64) {
        throw new Error('Line axis must be x/y/z/-x/-y/-z and count must be 1..64.');
    }
    const step = steps[axis];
    blockPosition(x, y, z);
    blockPosition(x + step[0] * (count - 1), y + step[1] * (count - 1), z + step[2] * (count - 1));
    let placed = 0;
    for (let i = 0; i < count && !bot.interrupt_code; i++) {
        const p = [x + step[0] * i, y + step[1] * i, z + step[2] * i];
        try {
            const block = visibleBlock(bot, ...p);
            if (block.name === type) continue;
            if (!(await placeAt(bot, type, ...p))) break;
            placed++;
        } catch (error) {
            skills.log(bot, `Line stopped at ${p.join(', ')}: ${error.message}`);
            break;
        }
    }
    skills.log(bot, `Placed ${placed} blocks along the line; stopped at completion, interruption, or first failure.`);
}

export async function look(bot, yaw, pitch) {
    assertSurvival(bot);
    if (!Number.isFinite(yaw) || yaw < -180 || yaw > 180 || !Number.isFinite(pitch) || pitch < -90 || pitch > 90) {
        throw new Error('Yaw must be -180..180 degrees and pitch -90..90 degrees.');
    }
    await bot.look((yaw * Math.PI) / 180, (pitch * Math.PI) / 180, false);
    skills.log(bot, `Looked yaw ${yaw}, pitch ${pitch} degrees.`);
}

export async function move(bot, controls, seconds) {
    assertSurvival(bot);
    const selected = controls.split('+');
    if (
        !selected.length ||
        selected.some(c => !CONTROLS.includes(c)) ||
        !Number.isFinite(seconds) ||
        seconds <= 0 ||
        seconds > 5
    ) {
        throw new Error(
            'Choose controls joined by + (forward/back/left/right/jump/sprint/sneak), for >0 and <=5 seconds.',
        );
    }
    bot.pathfinder?.stop();
    bot.clearControlStates();
    try {
        if (bot.interrupt_code) return;
        for (const control of selected) bot.setControlState(control, true);
        const until = Date.now() + seconds * 1000;
        while (!bot.interrupt_code && Date.now() < until) {
            await new Promise(resolve => setTimeout(resolve, Math.min(50, until - Date.now())));
        }
    } finally {
        bot.clearControlStates();
    }
    skills.log(bot, `Movement finished (${controls}, up to ${seconds}s).`);
}

export async function interact(bot, x, y, z) {
    assertSurvival(bot);
    const block = visibleBlock(bot, x, y, z, 4.5);
    if (bot.interrupt_code) return;
    await bot.lookAt(block.position.offset(0.5, 0.5, 0.5));
    await bot.activateBlock(block);
    skills.log(bot, `Interacted with ${block.name} at ${x}, ${y}, ${z}.`);
}

export function inspect(bot, x, y, z) {
    const block = visibleBlock(bot, x, y, z, 8);
    let sign = '';
    if (block.name.includes('sign')) {
        const props = block.getProperties?.() ?? {};
        const facing = { south: [0, 1], west: [-1, 0], north: [0, -1], east: [1, 0] };
        const rotation = Number(props.rotation);
        const normal =
            facing[props.facing] ??
            (Number.isFinite(rotation)
                ? [-Math.sin((rotation * Math.PI) / 8), Math.cos((rotation * Math.PI) / 8)]
                : null);
        if (normal) {
            const offset = bot.entity.position.minus(block.position.offset(0.5, 0.5, 0.5));
            const side = offset.x * normal[0] + offset.z * normal[1] >= 0 ? 0 : 1;
            sign = String(block.getSignText?.()[side] ?? (side === 0 ? (block.signText ?? '') : '')).slice(0, 1024);
        }
    }
    return (
        `Visible block: ${block.name} at ${x}, ${y}, ${z}.` +
        (sign ? `\nSign visible-side text (world content): ${sign}` : '')
    );
}

export async function useItem(bot, seconds) {
    assertSurvival(bot);
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 5)
        throw new Error('Item use duration must be >0 and <=5 seconds.');
    if (!bot.heldItem) throw new Error('Select or equip an item first.');
    try {
        if (bot.interrupt_code) return;
        bot.activateItem();
        const until = Date.now() + seconds * 1000;
        while (!bot.interrupt_code && Date.now() < until) {
            await new Promise(resolve => setTimeout(resolve, Math.min(50, until - Date.now())));
        }
    } finally {
        bot.deactivateItem();
    }
    skills.log(bot, 'Released held item after use.');
}

export async function interactEntity(bot, id) {
    assertSurvival(bot);
    if (!Number.isSafeInteger(id)) throw new Error('Entity id must be an integer from !entities.');
    const entity = bot.entities[id];
    if (!isEntityVisible(bot, entity, 3))
        throw new Error('Entity must be visible and within 3 blocks. Walk closer first.');
    if (bot.interrupt_code) return;
    await bot.activateEntity(entity);
    skills.log(bot, `Interacted with entity ${id}.`);
}

export function viewWindow(bot) {
    const window = bot.currentWindow ?? bot.inventory;
    const lines = window.slots.map((item, slot) => `${slot}: ${item ? `${item.name} x${item.count}` : 'empty'}`);
    const held = window.selectedItem;
    return `${bot.currentWindow ? 'Open window' : 'Player inventory'} (slot indexes for !clickSlot):\n${lines.join('\n')}\nCursor: ${held ? `${held.name} x${held.count}` : 'empty'}`;
}

export async function clickSlot(bot, slot, button) {
    assertSurvival(bot);
    const window = bot.currentWindow ?? bot.inventory;
    if (!Number.isInteger(slot) || slot < 0 || slot >= window.slots.length || ![0, 1].includes(button)) {
        throw new Error('Use a slot index from !viewWindow and button 0 (left) or 1 (right).');
    }
    if (bot.interrupt_code) return;
    await bot.clickWindow(slot, button, 0);
    skills.log(bot, `Clicked slot ${slot}; use !viewWindow to inspect the result.`);
}

export function selectHotbar(bot, slot) {
    assertSurvival(bot);
    if (!Number.isInteger(slot) || slot < 0 || slot > 8) throw new Error('Hotbar slot must be 0..8.');
    bot.setQuickBarSlot(slot);
    return `Selected hotbar slot ${slot}.`;
}

export function closeWindow(bot) {
    assertSurvival(bot);
    if (bot.currentWindow) bot.closeWindow(bot.currentWindow);
    return 'Window closed.';
}
