import test from 'node:test';
import assert from 'node:assert/strict';
import { Vec3 } from 'vec3';
import { createGameTools } from '../../src/tools/game-tools.js';

function world(solidAt, start) {
    const blocks = new Map();
    const key = (x, y, z) => `${x},${y},${z}`;
    const calls = [];
    const b = {
        calls,
        username: 'Test',
        game: { gameMode: 'survival' },
        health: 20,
        food: 20,
        entity: { id: 0, position: new Vec3(...start), onGround: true, yaw: 0, pitch: 0 },
        entities: {},
        inventory: {
            items: () => [{ name: 'cobblestone', count: 32 }],
            slots: new Array(46).fill(null),
            findInventoryItem: n => (n === 'cobblestone' ? { name: n, count: 32 } : null),
        },
        blockAt(v) {
            const p = new Vec3(Math.floor(v.x), Math.floor(v.y), Math.floor(v.z));
            const s = blocks.get(key(p.x, p.y, p.z)) ?? solidAt(p.x, p.y, p.z);
            return s
                ? { name: 'dirt', position: p, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] }
                : { name: 'air', position: p, boundingBox: 'empty', shapes: [] };
        },
        equip: async () => {},
        lookAt: async () => {},
        dig: async () => calls.push('dig'),
        setControlState(k, v) {
            if (k === 'jump' && v) b.entity.position = b.entity.position.offset(0, 1.25, 0);
        },
        placeBlock: async below => {
            blocks.set(key(below.position.x, below.position.y + 1, below.position.z), true);
            b.entity.position = new Vec3(b.entity.position.x, below.position.y + 2, b.entity.position.z);
            calls.push('place');
        },
        pathfinder: {
            goto: async goal => {
                calls.push(['goto', goal.constructor.name]);
                if (goal.x != null) b.entity.position = new Vec3(goal.x + 0.5, goal.y ?? 64, goal.z + 0.5);
                else b.entity.position = new Vec3(-30, 64, 0);
            },
            setGoal: () => {},
            stop: () => {},
            setMovements: () => {},
        },
        clearControlStates: () => {},
        stopDigging: () => {},
        deactivateItem: () => {},
        quit: () => {},
        chat: () => {},
        emit: () => {},
    };
    return b;
}
const run = async (b, name, args = {}) => {
    const tools = createGameTools({
        bot: b,
        skills: {
            goToPosition: async (bb, x, y, z) => {
                bb.entity.position = new Vec3(x, 64, z);
                return true;
            },
        },
        observe: async () => ({ state: {}, frame: null }),
    });
    const r = await tools.find(t => t.name === name).execute('id', args, new AbortController().signal);
    return JSON.parse(r.content[0].text).result;
};
const pit = (x, y, z) => (x === 0 && z === 0 ? y <= 60 : y <= 63);

test('return_to_surface gets out of a 3-deep open pit to ground level', async () => {
    const b = world(pit, [0.5, 61, 0.5]);
    const r = await run(b, 'return_to_surface');
    assert.equal(r.reached, true);
    assert.equal(r.method, 'path');
    assert.equal(r.surfaceY, 64);
    assert.equal(Math.floor(b.entity.position.y), 64);
});

test('return_to_surface falls back to climbing when no route is found', async () => {
    const b = world(pit, [0.5, 61, 0.5]);
    b.pathfinder.goto = async goal => {
        if (b.entity.position.y >= 64 && goal.y === 64) {
            b.entity.position = new Vec3(goal.x + 0.5, 64, goal.z + 0.5);
            return;
        }
        throw new Error('No path');
    };
    const r = await run(b, 'return_to_surface');
    assert.equal(r.reached, true);
    assert.equal(r.method, 'climb');
    assert.equal(r.blocksPlaced, 3);
    assert.equal(Math.floor(b.entity.position.y), 64);
    assert.ok(Math.floor(b.entity.position.x) !== 0 || Math.floor(b.entity.position.z) !== 0);
});

test('return_to_surface treats a 2-wide pit as a hole, not as ground', async () => {
    const pit2 = (x, y, z) => ((x === 0 || x === -1) && z === 0 ? y <= 60 : y <= 63);
    const b = world(pit2, [0.5, 61, 0.5]);
    const r = await run(b, 'return_to_surface');
    assert.ok(!r.alreadyAtSurface);
    assert.equal(r.reached, true);
    assert.equal(Math.floor(b.entity.position.y), 64);
});

test('return_to_surface gets out of a wide roofless pit', async () => {
    const wide = (x, y, z) => (Math.abs(x) <= 4 && Math.abs(z) <= 4 ? y <= 57 : y <= 63);
    const b = world(wide, [0.5, 58, 0.5]);
    const r = await run(b, 'return_to_surface');
    assert.ok(!r.alreadyAtSurface);
    assert.equal(r.reached, true);
    assert.equal(Math.floor(b.entity.position.y), 64);
});

test('return_to_surface gets out of a roofed cave', async () => {
    const cave = (x, y, z) => (Math.abs(x) <= 1 && Math.abs(z) <= 1 && y >= 55 && y <= 57 ? false : y <= 63);
    const b = world(cave, [0.5, 55, 0.5]);
    const r = await run(b, 'return_to_surface');
    assert.equal(r.reached, true);
    assert.equal(Math.floor(b.entity.position.y), 64);
});

test('return_to_surface on a gentle slope is a no-op', async () => {
    const b = world((x, y, z) => y <= 63 - Math.max(0, Math.floor(x / 2)), [0.5, 64, 0.5]);
    const r = await run(b, 'return_to_surface');
    assert.equal(r.alreadyAtSurface, true);
});

test('return_to_surface at the foot of a steep hill is a no-op', async () => {
    const b = world((x, y, z) => y <= (x < 0 ? 70 : 63), [2.5, 64, 0.5]);
    const r = await run(b, 'return_to_surface');
    assert.equal(r.alreadyAtSurface, true);
    assert.deepEqual(b.calls, []);
});

test('return_to_surface on flat ground is an honest no-op', async () => {
    const b = world((x, y, z) => y <= 63, [5.5, 64, 5.5]);
    const r = await run(b, 'return_to_surface');
    assert.equal(r.alreadyAtSurface, true);
    assert.deepEqual(b.calls, []);
});

const awayMover = (b, ok = () => true) => {
    b.goals = [];
    b.pathfinder.setGoal = g => {
        if (!g) return;
        b.goals.push(g);
        let best = null;
        for (let k = 0; k < 72; k++) {
            const a = (k * Math.PI) / 36;
            const n = {
                x: Math.round(b.entity.position.x + 22 * Math.cos(a)),
                y: 64,
                z: Math.round(b.entity.position.z + 22 * Math.sin(a)),
            };
            if (!ok(n)) continue;
            const h = -g.points.reduce((s, p) => s + Math.hypot(n.x - p.x, n.z - p.z), 0) + 0 * g.heuristic(n);
            if (g.isEnd(n) && (!best || h < best.h)) best = { n, h };
        }
        if (best) b.entity.position = new Vec3(best.n.x + 0.5, 64, best.n.z + 0.5);
    };
};

test('flee runs from the last attacker and reports distance', async () => {
    const b = world((x, y, z) => y <= 63, [0.5, 64, 0.5]);
    awayMover(b);
    b.entities[7] = { id: 7, username: 'schlep_blind', type: 'player', position: new Vec3(3, 64, 0) };
    b.pi_lastAttacker = 7;
    const r = await run(b, 'flee', {});
    assert.equal(r.fledFrom, 'schlep_blind');
    assert.equal(r.safe, true);
    assert.ok(r.distanceNow > 16);
    assert.ok(!r.walled);
});

test('flee with nothing to flee from fails clearly', async () => {
    const b = world((x, y, z) => y <= 63, [0.5, 64, 0.5]);
    const tools = createGameTools({ bot: b, observe: async () => ({ state: {}, frame: null }) });
    const r = await tools
        .find(t => t.name === 'flee')
        .execute('id', {}, new AbortController().signal)
        .catch(e => ({ err: String(e.message) }));
    assert.match(JSON.stringify(r), /Nothing has hurt you/);
});

test('flee falls back to a live hostile when the requested id is gone', async () => {
    const b = world((x, y, z) => y <= 63, [0.5, 64, 0.5]);
    awayMover(b);
    b.entities[9] = { id: 9, name: 'zombie', type: 'hostile', position: new Vec3(2, 64, 0) };
    const r = await run(b, 'flee', { id: 378 });
    assert.equal(r.id, 9);
    assert.match(r.note, /378 is gone/);
    assert.equal(r.safe, true);
});

test('flee runs away from several hostiles at once', async () => {
    const b = world((x, y, z) => y <= 63, [0.5, 64, 0.5]);
    awayMover(b);
    b.entities[9] = { id: 9, name: 'zombie', type: 'hostile', position: new Vec3(3, 64, 0) };
    b.entities[10] = { id: 10, name: 'skeleton', type: 'hostile', position: new Vec3(0, 64, 3) };
    b.pi_lastAttacker = 9;
    const r = await run(b, 'flee', {});
    assert.equal(r.alsoAvoided, 1);
    assert.ok(b.entity.position.x < 0 && b.entity.position.z < 0);
    assert.ok(b.goals[0].isEnd({ x: -20, y: 64, z: -20 }) && !b.goals[0].isEnd({ x: 10, y: 64, z: 0 }));
});

test('flee re-plans when a new hostile shows up mid-flight', async () => {
    const b = world((x, y, z) => y <= 63, [0.5, 64, 0.5]);
    b.goals = [];
    b.entities[9] = { id: 9, name: 'zombie', type: 'hostile', position: new Vec3(3, 64, 0) };
    let step = 0;
    b.pathfinder.setGoal = g => {
        if (!g) return;
        b.goals.push(g);
        step++;
        if (step === 1) {
            b.entity.position = new Vec3(-6.5, 64, 0.5);
            b.entities[11] = { id: 11, name: 'zombie', type: 'hostile', position: new Vec3(-9, 64, 0) };
        } else b.entity.position = new Vec3(-3.5, 64, 20.5);
    };
    const r = await run(b, 'flee', { seconds: 5 });
    assert.ok(b.goals.length >= 2, 'goal re-set after the new hostile appeared');
    assert.equal(b.goals.at(-1).points.length, 2);
    assert.equal(r.safe, true);
});

test('flee walls off a 1-wide tunnel when an attacker is right behind', async () => {
    const tunnel = (x, y, z) => !(z === 0 && (y === 64 || y === 65) && x >= -6 && x <= 10);
    const b = world(tunnel, [0.5, 64, 0.5]);
    const placed = [];
    b.pathfinder.setGoal = () => {};
    b.placeBlock = async (ref, face) => {
        const c = ref.position.offset(face.x, face.y, face.z);
        placed.push(`${c.x},${c.y},${c.z}`);
        const k = `${c.x},${c.y},${c.z}`;
        const prev = b.blockAt;
        b.blockAt = v => {
            const p = v.floored ? v.floored() : v;
            return `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}` === k
                ? { name: 'cobblestone', position: c, boundingBox: 'block' }
                : prev(v);
        };
    };
    b.entities[9] = { id: 9, name: 'zombie', type: 'hostile', position: new Vec3(2.7, 64, 0.5) };
    b.pi_lastAttacker = 9;
    const r = await run(b, 'flee', { seconds: 5 });
    assert.deepEqual(placed, ['1,64,0', '1,65,0']);
    assert.equal(r.walled.block, 'cobblestone');
    assert.equal(r.safe, true);
});

test('flee reports cornered when the attacker blocks the only gap and no route exists', async () => {
    const tunnel = (x, y, z) => !(z === 0 && (y === 64 || y === 65) && x >= 0 && x <= 10);
    const b = world(tunnel, [0.5, 64, 0.5]);
    b.pathfinder.setGoal = () => {};
    b.on = (ev, fn) => {
        if (ev === 'path_update') setTimeout(() => fn({ status: 'noPath', path: [] }), 10);
    };
    b.entities[9] = { id: 9, name: 'zombie', type: 'hostile', position: new Vec3(1.5, 64, 0.5) };
    b.pi_lastAttacker = 9;
    const r = await run(b, 'flee', { seconds: 2 });
    assert.equal(r.cornered, true);
    assert.match(r.reason, /standing in the gap/);
    assert.equal(r.safe, false);
});

test('flee with a gone id and no hostiles fails with not_found', async () => {
    const b = world((x, y, z) => y <= 63, [0.5, 64, 0.5]);
    const tools = createGameTools({ bot: b, observe: async () => ({ state: {}, frame: null }) });
    const r = await tools
        .find(t => t.name === 'flee')
        .execute('id', { id: 378 }, new AbortController().signal)
        .catch(e => ({ err: String(e.message) }));
    assert.match(JSON.stringify(r), /378 is gone/);
});
