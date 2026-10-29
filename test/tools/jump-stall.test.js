import test from 'node:test';
import assert from 'node:assert';
import { createHelpers } from '../../src/tools/game/helpers.js';
const { stallWatch } = createHelpers({});
const bot = fn => {
    const b = {
        stopped: false,
        entity: { position: { x: 0, y: 70, z: 0 } },
        pathfinder: {
            setGoal() {},
            stop() {
                b.stopped = true;
            },
        },
    };
    let t = 0;
    const iv = setInterval(() => {
        t++;
        Object.assign(b.entity.position, fn(t));
    }, 50);
    b.end = () => clearInterval(iv);
    return b;
};
test('bouncing in place trips the guard', async () => {
    const b = bot(t => ({ y: 70 + (t % 8 < 4 ? 1 : 0) }));
    const w = stallWatch(b, 2000);
    await new Promise(r => setTimeout(r, 3000));
    w.stop();
    b.end();
    assert.ok(w.stalled);
    assert.ok(b.stopped);
});
test('walking does not trip', async () => {
    const b = bot(t => ({ x: t * 0.1, y: 70 + (t % 8 < 4 ? 1 : 0) }));
    const w = stallWatch(b, 2000);
    await new Promise(r => setTimeout(r, 3000));
    w.stop();
    b.end();
    assert.ok(!w.stalled);
});
test('climbing up does not trip', async () => {
    const b = bot(t => ({ y: 70 + t * 0.05 }));
    const w = stallWatch(b, 2000);
    await new Promise(r => setTimeout(r, 3000));
    w.stop();
    b.end();
    assert.ok(!w.stalled);
});
test('standing still (digging) does not trip', async () => {
    const b = bot(() => ({}));
    const w = stallWatch(b, 2000);
    await new Promise(r => setTimeout(r, 3000));
    w.stop();
    b.end();
    assert.ok(!w.stalled);
});
