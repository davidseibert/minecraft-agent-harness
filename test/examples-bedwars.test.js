import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Rcon } from '../examples/bedwars/rcon.mjs';

test('RCON timeout errors omit authentication and command payloads', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const privateBody = 'test-private-request-body';
    const rcon = new Rcon({ password: privateBody });
    const packets = [];
    rcon.socket = { write: packet => packets.push(packet) };

    for (const type of [3, 2]) {
        const request = rcon.request(type, privateBody);
        const rejected = assert.rejects(request, error => {
            assert.equal(error.message, 'RCON request timed out');
            assert.ok(!error.stack.includes(privateBody));
            return true;
        });
        t.mock.timers.tick(10000);
        await rejected;
        assert.equal(rcon.pending.size, 0);
        assert.equal(packets.at(-1).subarray(12, -2).toString('utf8'), privateBody);
    }
});

test('referee reads deaths and killers from server log lines', async () => {
    const { parseDeath } = await import('../examples/bedwars/deaths.mjs');
    const known = { Red1: 'red', Blue1: 'blue' };
    assert.deepEqual(parseDeath('[12:00:01 INFO]: Red1 was slain by Blue1', known), {
        victim: 'Red1',
        killer: 'Blue1',
        message: 'Red1 was slain by Blue1',
    });
    assert.deepEqual(parseDeath('[12:00:02 INFO]: Blue1 fell out of the world', known), {
        victim: 'Blue1',
        killer: null,
        message: 'Blue1 fell out of the world',
    });
    assert.equal(parseDeath('[12:00:03 INFO]: Red1 joined the game', known), null);
    assert.equal(parseDeath('[12:00:04 INFO]: Steve was slain by Red1', known), null);
});

test('Bed Wars team files point every agent at the example tools and keep teams apart', () => {
    const arena = JSON.parse(readFileSync(new URL('../examples/bedwars/arena.json', import.meta.url), 'utf8'));
    for (const team of ['red', 'blue']) {
        const cfg = JSON.parse(readFileSync(new URL(`../examples/bedwars/${team}.json`, import.meta.url), 'utf8'));
        assert.equal(cfg.toolsModule, 'examples/bedwars/tools.mjs');
        assert.equal(cfg.stateDir, `.agent-state/bedwars-${team}`);
        assert.deepEqual(
            cfg.agents.map(a => a.name),
            arena.teams[team].players,
        );
    }
});
