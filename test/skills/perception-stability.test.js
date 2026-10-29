import test from 'node:test';
import assert from 'node:assert/strict';
import { Vec3 } from 'vec3';
import iterators from 'prismarine-world/src/iterators.js';
import WorldSync from 'prismarine-world/src/worldsync.js';
import { isEntityVisible, isBlockVisible } from '../../src/skills/perception.js';
import { isEntityVisible as before } from '../fixtures/perception-before.js';
function fixture() {
    let reads = 0;
    const bot = {
        entity: { id: 1, position: new Vec3(0, 0, 0), eyeHeight: 1 },
        world: {
            raycast: WorldSync.prototype.raycast,
            getBlock() {
                if (++reads > 1000) throw Error('unbounded traversal');
                return null;
            },
        },
    };
    return { bot, reads: () => reads };
}
test('old entity perception stalls on nonfinite item height; fixed code fails closed without raycast', () => {
    const { bot } = fixture();
    const item = { id: 2, position: new Vec3(2, 0, 0), height: NaN };
    assert.throws(() => before(bot, item), /unbounded traversal/);
    const after = fixture();
    assert.equal(isEntityVisible(after.bot, item), false);
    assert.equal(after.reads(), 0);
});
test('rejects nonfinite target/origin/range and block coordinates', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
        let { bot } = fixture();
        assert.equal(isEntityVisible(bot, { id: 2, position: new Vec3(bad, 0, 0), height: 1 }), false);
        bot.entity.eyeHeight = bad;
        assert.equal(isEntityVisible(bot, { id: 2, position: new Vec3(2, 0, 0) }), false);
        ({ bot } = fixture());
        assert.equal(isEntityVisible(bot, { id: 2, position: new Vec3(2, 0, 0) }, bad), false);
        assert.equal(isBlockVisible(bot, { position: new Vec3(bad, 0, 0) }), false);
    }
});
test('axis aligned integer-origin rays and diagonal rays retain visibility and terminate', () => {
    for (const p of [
        new Vec3(5, 0.5, 0),
        new Vec3(-5, 0.5, 0),
        new Vec3(0, 5, 0),
        new Vec3(0, -5, 0),
        new Vec3(0, 0.5, 5),
        new Vec3(0, 0.5, -5),
        new Vec3(10, 10, 10),
    ]) {
        const a = fixture(),
            b = fixture(),
            item = { id: 2, position: p, height: 1 };
        assert.equal(before(a.bot, item), true);
        assert.equal(isEntityVisible(b.bot, item), true);
        assert.ok(b.reads() < 120);
    }
});
test('occluding wall still hides entities', () => {
    const { bot } = fixture();
    bot.world.getBlock = p => ({ position: p.floored(), shapes: [[0, 0, 0, 1, 1, 1]] });
    assert.equal(isEntityVisible(bot, { id: 2, position: new Vec3(5, 0.5, 0), height: 1 }), false);
});
test('hard bound fails closed even if a dependency iterator stops making progress', () => {
    const original = iterators.RaycastIterator.prototype.next;
    try {
        iterators.RaycastIterator.prototype.next = function () {
            return this.block;
        };
        const { bot, reads } = fixture();
        assert.equal(isEntityVisible(bot, { id: 2, position: new Vec3(5, 0.5, 0), height: 1 }), false);
        assert.ok(reads() > 0 && reads() < 20);
    } finally {
        iterators.RaycastIterator.prototype.next = original;
    }
});
test('bounded traversal matches original for 300 deterministic valid rays with occlusion', () => {
    let seed = 23;
    const rand = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
    for (let i = 0; i < 300; i++) {
        const a = fixture(),
            b = fixture();
        const origin = new Vec3(rand() * 8 - 4, rand() * 8 - 4, rand() * 8 - 4);
        a.bot.entity.position = origin;
        b.bot.entity.position = origin;
        const blocks = p => {
            const q = p.floored();
            return { position: q, shapes: q.x === 3 && q.y >= 0 ? [[0, 0, 0, 1, 1, 1]] : [] };
        };
        a.bot.world.getBlock = blocks;
        b.bot.world.getBlock = blocks;
        const e = {
            id: 2,
            height: rand() * 2,
            position: new Vec3(rand() * 60 - 30, rand() * 60 - 30, rand() * 60 - 30),
        };
        assert.equal(isEntityVisible(b.bot, e), before(a.bot, e));
    }
});
