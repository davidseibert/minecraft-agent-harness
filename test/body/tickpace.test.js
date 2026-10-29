import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { paceBot } from '../../src/body/tickpace.js';
const fake = () => {
    const b = new EventEmitter();
    b._client = new EventEmitter();
    b.entity = { position: {} };
    b.blockAt = () => ({});
    b.controlState = {};
    b.physicsEnabled = true;
    b.digTime = () => 750;
    return b;
};
test('pacer follows server tick state, drops backlog after a stall, freezes, and hands back at 20 TPS', async () => {
    const b = fake();
    let sims = 0,
        ticks = 0;
    b.on('physicsTick', () => ticks++);
    const p = paceBot(b, { simulate: () => sims++ });
    assert.equal(b.physicsEnabled, true);
    await sleep(300);
    assert.equal(sims, 0, '20 TPS leaves stock plugin in charge');
    b._client.emit('set_ticking_state', { tick_rate: 5, is_frozen: false });
    assert.equal(b.physicsEnabled, false);
    assert.equal(b.digTime({}), 3000);
    await sleep(1010);
    assert.ok(sims >= 4 && sims <= 6, `~5 steps/s, got ${sims}`);
    assert.equal(ticks, sims);
    const before = sims,
        t = Date.now();
    while (Date.now() - t < 700);
    await sleep(30);
    assert.ok(sims - before <= 1, `no catch-up burst after 700ms stall (${sims - before})`);
    assert.ok(p.state.dropped >= 2);
    b._client.emit('set_ticking_state', { tick_rate: 5, is_frozen: true });
    const f = sims;
    await sleep(500);
    assert.equal(sims, f, 'frozen => no steps');
    b._client.emit('set_ticking_state', { tick_rate: 20, is_frozen: false });
    assert.equal(b.physicsEnabled, true);
    const g = sims;
    await sleep(300);
    assert.equal(sims, g);
    p.close();
    assert.equal(b.digTime({}), 750);
});
