import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Vec3 } from 'vec3';
import minecraftData from 'minecraft-data';
import physicsModule from 'prismarine-physics';
const require = createRequire(import.meta.url);
const originalFile = require.resolve('mineflayer/lib/plugins/entities.js');
function loadSource(source) {
    const mod = { exports: {} };
    vm.runInThisContext(`(function(require,module,exports){${source}\n})`, { filename: 'entities-repro.js' })(
        createRequire(originalFile),
        mod,
        mod.exports,
    );
    return mod.exports;
}
const before = loadSource(readFileSync(new URL('../fixtures/entities-before.cjs', import.meta.url), 'utf8'));
const after = process.env.ENTITIES_PATCH
    ? loadSource(readFileSync(process.env.ENTITIES_PATCH, 'utf8'))
    : require(originalFile);
const { Physics, PlayerState } = physicsModule;
function fixture(inject) {
    const bot = new EventEmitter();
    bot._client = new EventEmitter();
    bot._client.username = 'OfflineTest';
    bot.version = '1.21.6';
    bot.registry = minecraftData(bot.version);
    bot.supportFeature = f => bot.registry.supportFeature(f);
    inject(bot);
    bot._client.emit('login', { entityId: 1 });
    bot.entity.position.set(-47.55, 64.42, -27.51);
    bot.entity.velocity.set(0, 0, 0);
    bot.entity.yaw = 0;
    bot.entity.pitch = 0;
    bot.entity.onGround = false;
    bot.entity.effects = {};
    bot.inventory = { slots: [] };
    bot.jumpTicks = 0;
    bot.jumpQueued = false;
    bot.controlState = {
        forward: false,
        back: false,
        left: false,
        right: false,
        jump: false,
        sprint: false,
        sneak: false,
    };
    const Block = require('prismarine-block')(bot.registry);
    const world = {
        getBlock(pos) {
            const b = Block.fromStateId(pos.y < 63 ? bot.registry.blocksByName.stone.defaultState : 0, 0);
            b.position = pos.floored();
            return b;
        },
    };
    return { bot, world, physics: Physics(bot.registry, world) };
}
const finite = v => [v.x, v.y, v.z].every(Number.isFinite);
const modern = { entityId: 1, velocity: { x: 800, y: 3200, z: -1600 } };
test('installed protocol exposes nested velocity, not legacy flat fields', () => {
    const fields = minecraftData('1.21.6').protocol.play.toClient.types.packet_entity_velocity[1].map(f => f.name);
    assert.ok(fields.includes('velocity'));
    assert.ok(!fields.includes('velocityX'));
});
test('BEFORE real entities plugin turns valid server impulse into NaN; next physics tick corrupts position', () => {
    const { bot, world, physics } = fixture(before);
    bot._client.emit('entity_velocity', modern);
    assert.ok([bot.entity.velocity.x, bot.entity.velocity.y, bot.entity.velocity.z].every(Number.isNaN));
    physics.simulatePlayer(new PlayerState(bot, bot.controlState), world).apply(bot);
    assert.equal(finite(bot.entity.position), false);
});
for (const [label, packet] of [
    ['nested', modern],
    ['legacy', { entityId: 1, velocityX: 800, velocityY: 3200, velocityZ: -1600 }],
]) {
    test(`AFTER ${label} impulse retains exact server velocity and finite physics for 100 ticks`, () => {
        const { bot, world, physics } = fixture(after);
        bot._client.emit('entity_velocity', packet);
        assert.deepEqual(bot.entity.velocity, new Vec3(0.1, 0.4, -0.2));
        for (let i = 0; i < 100; i++) {
            physics.simulatePlayer(new PlayerState(bot, bot.controlState), world).apply(bot);
            assert.ok(finite(bot.entity.position));
            assert.ok(finite(bot.entity.velocity));
        }
    });
}
test('BEFORE sync_entity_position loses velocity because Vec3.update takes one vector', () => {
    const { bot } = fixture(before);
    bot._client.emit('sync_entity_position', {
        entityId: 1,
        x: 1,
        y: 64,
        z: 3,
        dx: 0.1,
        dy: 0.4,
        dz: -0.2,
        yaw: 0,
        pitch: 0,
    });
    assert.equal(finite(bot.entity.velocity), false);
});
test('AFTER sync_entity_position retains exact received components and simulates finitely', () => {
    const { bot, world, physics } = fixture(after);
    bot._client.emit('sync_entity_position', {
        entityId: 1,
        x: 1,
        y: 64,
        z: 3,
        dx: 0.1,
        dy: 0.4,
        dz: -0.2,
        yaw: 0,
        pitch: 0,
    });
    assert.deepEqual(bot.entity.velocity, new Vec3(0.1, 0.4, -0.2));
    physics.simulatePlayer(new PlayerState(bot, bot.controlState), world).apply(bot);
    assert.ok(finite(bot.entity.position));
});
