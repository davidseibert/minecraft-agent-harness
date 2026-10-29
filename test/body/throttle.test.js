import test from 'node:test';
import assert from 'node:assert/strict';
import { throttleMovementPackets } from '../../src/body/bot.js';

function fakeClock() {
    let now = 0;
    const timers = [];
    return {
        now: () => now,
        setTimeout: (fn, ms) => {
            const t = { at: now + ms, fn };
            timers.push(t);
            return t;
        },
        clearTimeout: t => timers.splice(timers.indexOf(t), 1),
        advance(ms) {
            now += ms;
            for (const t of timers.filter(t => t.at <= now)) {
                timers.splice(timers.indexOf(t), 1);
                t.fn();
            }
        },
    };
}

test('movement throttle always delivers the newest position, never a stale one', () => {
    const sent = [];
    const clock = fakeClock();
    const client = throttleMovementPackets({ write: (name, data) => sent.push([name, data]) }, 50, clock);
    client.write('position', { y: 64, onGround: true });
    clock.advance(10);
    client.write('position', { y: 64.4, onGround: false });
    clock.advance(10);
    client.write('position', { y: 65, onGround: true });
    client.write('flying', { onGround: true });
    assert.deepEqual(sent, [
        ['position', { y: 64, onGround: true }],
        ['flying', { onGround: true }],
    ]);
    clock.advance(30);
    assert.deepEqual(sent.at(-1), ['position', { y: 65, onGround: true }]);
    assert.equal(sent.length, 3);
});

test('movement throttle keeps the latest packet of each kind in one flush', () => {
    const sent = [];
    const clock = fakeClock();
    const client = throttleMovementPackets({ write: (name, data) => sent.push([name, data]) }, 50, clock);
    client.write('look', { yaw: 0 });
    client.write('look', { yaw: 1 });
    client.write('position', { y: 70 });
    client.write('look', { yaw: 2 });
    clock.advance(50);
    assert.deepEqual(sent, [
        ['look', { yaw: 0 }],
        ['position', { y: 70 }],
        ['look', { yaw: 2 }],
    ]);
});
