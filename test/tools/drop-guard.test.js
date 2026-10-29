import test from 'node:test';
import assert from 'node:assert/strict';
import { Vec3 } from 'vec3';
import {
    createGameTools,
    installSkillCompatibility,
    edgeGuardTick,
    openDropBelow,
} from '../../src/tools/game-tools.js';

function world(solidFn, start, names = {}) {
    const gone = new Set(),
        calls = [];
    const key = (x, y, z) => `${x},${y},${z}`;
    const b = {
        calls,
        gone,
        username: 'Test',
        game: { gameMode: 'survival' },
        health: 20,
        food: 20,
        entity: {
            id: 0,
            position: new Vec3(...start),
            velocity: new Vec3(0, 0, 0),
            onGround: true,
            yaw: 0,
            pitch: 0,
            eyeHeight: 1.62,
        },
        entities: {},
        inventory: { items: () => [], slots: new Array(46).fill(null) },
        blockAt(v) {
            const p = new Vec3(Math.floor(v.x), Math.floor(v.y), Math.floor(v.z)),
                k = key(p.x, p.y, p.z);
            return !gone.has(k) && solidFn(p.x, p.y, p.z)
                ? {
                      name: names[k] ?? 'stone',
                      position: p,
                      boundingBox: 'block',
                      shapes: [[0, 0, 0, 1, 1, 1]],
                      diggable: true,
                  }
                : { name: 'air', position: p, boundingBox: 'empty', shapes: [] };
        },
        pathfinder: {
            goto: async () => {},
            setGoal: g => calls.push(['setGoal', g]),
            stop: () => {},
            setMovements: () => {},
        },
        clearControlStates: () => calls.push('clear'),
        stopDigging() {},
        deactivateItem() {},
        quit() {},
        chat() {},
        emit() {},
    };
    return b;
}
const perception = { isBlockVisible: () => true };
async function run(b, name, args) {
    const skills = {
        breakAt: async (bb, x, y, z) => {
            b.calls.push(['break', x, y, z]);
            b.gone.add(`${x},${y},${z}`);
            return true;
        },
        goToPosition: async () => true,
    };
    const tools = createGameTools({ bot: b, perception, skills, observe: async () => ({ state: {}, frame: null }) });
    return tools.find(t => t.name === name).execute('id', args, new AbortController().signal);
}
const result = r => JSON.parse(r.content[0].text).result;
const breaks = b => b.calls.filter(c => c[0] === 'break').map(c => c.slice(1).join(','));
const shaft = (x, y, z) => (x === 1 && z === 0 ? y <= 40 : y <= 63);

test('pathfinder movements never parkour or plan a drop of more than 3', () => {
    const b = world(shaft, [0.5, 64, 0.5]);
    installSkillCompatibility(b);
    const m = { blocksCantBreak: new Set() };
    b.pathfinder.setMovements(m);
    assert.equal(m.maxDropDown, 3);
    assert.equal(m.allowParkour, false);
});

test('edge guard stops a step into an open shaft, not into a shallow dip or when walking away', () => {
    const b = world(shaft, [0.75, 64, 0.5]);
    b.entity.velocity = new Vec3(0.2, 0, 0);
    assert.equal(openDropBelow(b, 1, 64, 0), Infinity);
    assert.equal(edgeGuardTick(b), true);
    assert.ok(b.calls.includes('clear'));
    assert.deepEqual(
        b.calls.find(c => c[0] === 'setGoal'),
        ['setGoal', null],
    );
    assert.equal(b.entity.velocity.x, 0);
    assert.equal(b.pi_edgeStop.x, 1);
    const c = world((x, y, z) => (x === 1 && z === 0 ? y <= 61 : y <= 63), [0.75, 64, 0.5]);
    c.entity.velocity = new Vec3(0.2, 0, 0);
    assert.equal(edgeGuardTick(c), false);
    const d = world(shaft, [0.7, 64, 0.5]);
    d.entity.velocity = new Vec3(-0.2, 0, 0);
    assert.equal(edgeGuardTick(d), false);
    const rim = world(shaft, [0.5, 64, 1.25]);
    rim.entity.velocity = new Vec3(0.2, 0, 0);
    assert.equal(edgeGuardTick(rim), false, 'walking past the shaft along its rim keeps a foot on solid ground');
    const into = world(shaft, [0.5, 64, 0.5]);
    into.entity.velocity = new Vec3(0.2, 0, 0);
    assert.equal(edgeGuardTick(into), false, 'not yet: half the body is still over ground 0.7 ahead');
    into.entity.position = new Vec3(0.75, 64, 0.5);
    assert.equal(edgeGuardTick(into), true);
    const e = world(shaft, [0.7, 64, 0.5]);
    e.entity.velocity = new Vec3(0.2, 0, 0);
    e.entity.onGround = false;
    assert.equal(edgeGuardTick(e), false);
    const w = world((x, y, z) => (x === 1 && z === 0 ? y <= 40 : y <= 63), [0.75, 64, 0.5]);
    const blockAt = w.blockAt.bind(w);
    w.blockAt = v =>
        Math.floor(v.x) === 1 && Math.floor(v.z) === 0 && Math.floor(v.y) === 61
            ? { name: 'water', position: v, boundingBox: 'empty' }
            : blockAt(v);
    w.entity.velocity = new Vec3(0.2, 0, 0);
    assert.equal(edgeGuardTick(w), false, 'a 2-block drop into water is fine');
});

test('break_block refuses the only block under your feet over a shaft, allows it with other support', async () => {
    const pillar = (x, y, z) => (x === 0 && z === 0 ? y === 63 || y <= 40 : x === 1 && z === 0 ? y <= 63 : y <= 40);
    const b = world(pillar, [0.5, 64, 0.5]);
    const r = await run(b, 'break_block', { x: 0, y: 63, z: 0 });
    assert.equal(r.isError, true);
    assert.match(JSON.stringify(r), /holding you up/);
    assert.deepEqual(breaks(b), []);
    const c = world(pillar, [0.9, 64, 0.5]);
    const ok = await run(c, 'break_block', { x: 0, y: 63, z: 0 });
    assert.notEqual(ok.isError, true);
    assert.deepEqual(breaks(c), ['0,63,0']);
});

test('break_area clears a box nearest column first, top down, skipping built blocks unless asked', async () => {
    const box = (x, y, z) => y <= 63 || (x === 2 && y <= 65 && z >= 0 && z <= 1);
    const b = world(box, [0.5, 64, 0.5], { '2,64,1': 'oak_planks' });
    const r = result(await run(b, 'break_area', { x1: 2, y1: 64, z1: 0, x2: 2, y2: 65, z2: 1 }));
    assert.equal(r.broke, 3);
    assert.deepEqual(breaks(b), ['2,65,0', '2,64,0', '2,65,1']);
    assert.equal(r.skipped.length, 1);
    assert.match(r.skipped[0].reason, /built block/);
    const again = result(
        await run(b, 'break_area', { x1: 2, y1: 64, z1: 0, x2: 2, y2: 65, z2: 1, include_built: true }),
    );
    assert.equal(again.broke, 1);
    assert.equal(breaks(b).pop(), '2,64,1');
});

test('break_area never breaks the block holding you up over a drop, and caps the box size', async () => {
    const pillar = (x, y, z) => (x === 0 && z === 0 ? y === 63 || y <= 40 : y <= 63 && !(x === 0 && z === 1 && y > 40));
    const b = world(pillar, [0.5, 64, 0.5]);
    const r = await run(b, 'break_area', { x1: 0, y1: 63, z1: 0, x2: 0, y2: 63, z2: 0 });
    assert.equal(r.isError, true);
    assert.match(JSON.stringify(r), /holds you up over an open drop/);
    assert.deepEqual(breaks(b), []);
    const big = await run(b, 'break_area', { x1: 0, y1: 60, z1: 0, x2: 9, y2: 69, z2: 0 });
    assert.equal(big.isError, true);
    assert.match(JSON.stringify(big), /up to 96/);
});

test('go_to reports a stop at a drop as drop_ahead with the hole position', async () => {
    const b = world(shaft, [0.5, 64, 0.5]);
    const tools = createGameTools({
        bot: b,
        perception,
        observe: async () => ({ state: {}, frame: null }),
        skills: {
            goToPosition: async bb => {
                bb.entity.velocity = new Vec3(0.2, 0, 0);
                bb.entity.position = new Vec3(0.75, 64, 0.5);
                edgeGuardTick(bb);
                return false;
            },
        },
    });
    const r = await tools
        .find(t => t.name === 'go_to')
        .execute('id', { x: 5, y: 64, z: 0 }, new AbortController().signal);
    assert.equal(r.isError, true);
    assert.match(JSON.stringify(r), /drop_ahead/);
    assert.match(JSON.stringify(r), /open drop of more than 8 blocks at 1,64,0/);
});
