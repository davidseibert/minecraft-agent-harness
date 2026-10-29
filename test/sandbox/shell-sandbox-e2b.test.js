import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createE2bBackend } from '../../src/sandbox/shell-sandbox.js';

const RELAY = path.join(mkdtempSync(path.join(os.tmpdir(), 'relay-')), 'relay.cjs');
copyFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../src/sandbox/assets/relay.cjs'), RELAY);
const sleep = ms => new Promise(r => setTimeout(r, ms));

function fakeSandboxClass() {
    const port = 21000 + Math.floor(Math.random() * 20000);
    const calls = [];
    class FakeSandbox {
        sandboxId = 'fake-sbx';
        relay = null;
        token = null;
        commands = {
            run: async (cmd, opts) => {
                calls.push({ cmd, opts });
                if (cmd.startsWith('node /opt/harness/relay.cjs')) {
                    this.token = cmd.split(' ').at(-1);
                    this.relay = spawn(process.execPath, [RELAY, String(port), this.token], { stdio: 'ignore' });
                    const proc = this.relay;
                    return { kill: async () => proc.kill('SIGKILL') };
                }
                return { exitCode: 0, stdout: '', stderr: '' };
            },
        };
        files = { write: async () => {}, list: async () => [], read: async () => '' };
        getHost() {
            return `127.0.0.1:${port}`;
        }
        async setTimeout() {}
        async kill() {
            this.relay?.kill('SIGKILL');
            FakeSandbox.killed = (FakeSandbox.killed ?? 0) + 1;
        }
        async pause() {
            this.relay?.kill('SIGKILL');
            FakeSandbox.paused = (FakeSandbox.paused ?? 0) + 1;
        }
        static async create(opts) {
            FakeSandbox.created = [...(FakeSandbox.created ?? []), opts];
            FakeSandbox.last = new FakeSandbox();
            return FakeSandbox.last;
        }
        static async connect(id) {
            if (FakeSandbox.gone) throw new Error('sandbox not found');
            FakeSandbox.connected = [...(FakeSandbox.connected ?? []), id];
            FakeSandbox.last = new FakeSandbox();
            FakeSandbox.last.sandboxId = id;
            return FakeSandbox.last;
        }
    }
    return { FakeSandbox, calls, port };
}

async function callThroughRelay(port, token, name, args) {
    const r = await fetch(`http://127.0.0.1:${port}/call`, {
        method: 'POST',
        headers: { 'x-token': token, 'content-type': 'application/json' },
        body: JSON.stringify({ name, args }),
        signal: AbortSignal.timeout(10000),
    });
    return r.json();
}

test('e2b relay is started as a background command with no stream deadline (timeoutMs 0)', async () => {
    const { FakeSandbox, calls } = fakeSandboxClass();
    const backend = createE2bBackend({
        apiKey: 'k',
        agentName: 'T',
        loadSandbox: async () => FakeSandbox,
        relayScheme: 'http',
    });
    await backend.start({ invoke: async () => 'x', tools: [], log: () => {} });
    const relayStarts = calls.filter(c => c.cmd.startsWith('node /opt/harness/relay.cjs'));
    assert.equal(relayStarts.length, 1);
    assert.deepEqual(relayStarts[0].opts, { background: true, timeoutMs: 0 });
    await backend.close();
});

test('a relay that dies is restarted by the poller and tool calls flow again', async () => {
    const { FakeSandbox, calls, port } = fakeSandboxClass();
    const logs = [];
    const backend = createE2bBackend({
        apiKey: 'k',
        agentName: 'T',
        loadSandbox: async () => FakeSandbox,
        relayScheme: 'http',
    });
    await backend.start({ invoke: async (name, args) => ({ name, args }), tools: [], log: m => logs.push(m) });
    const sbx = FakeSandbox.last;
    assert.deepEqual(await callThroughRelay(port, sbx.token, 'place_block', { y: 1 }), {
        ok: true,
        result: { name: 'place_block', args: { y: 1 } },
    });
    sbx.relay.kill('SIGKILL');
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline && calls.filter(c => c.cmd.startsWith('node /opt/harness/relay.cjs')).length < 2)
        await sleep(100);
    assert.equal(calls.filter(c => c.cmd.startsWith('node /opt/harness/relay.cjs')).length, 2, logs.join('\n'));
    while (Date.now() < deadline && !logs.includes('relay restarted')) await sleep(100);
    assert.ok(logs.includes('relay restarted'), logs.join('\n'));
    assert.deepEqual(await callThroughRelay(port, sbx.token, 'place_block', { y: 2 }), {
        ok: true,
        result: { name: 'place_block', args: { y: 2 } },
    });
    await backend.close();
});

test('e2b sandbox is paused on exit and resumed by id on the next start', async () => {
    const { FakeSandbox } = fakeSandboxClass();
    const statePath = path.join(mkdtempSync(path.join(os.tmpdir(), 'e2bstate-')), 'e2b-sandbox.json');
    const make = () =>
        createE2bBackend({
            apiKey: 'k',
            agentName: 'T',
            loadSandbox: async () => FakeSandbox,
            relayScheme: 'http',
            statePath,
        });
    const first = make();
    await first.start({ invoke: async () => 'x', tools: [], log: () => {} });
    assert.deepEqual(FakeSandbox.created[0].lifecycle, { onTimeout: 'pause' });
    await first.close();
    assert.equal(FakeSandbox.paused, 1);
    assert.equal(FakeSandbox.killed ?? 0, 0);
    const logs = [];
    const second = make();
    await second.start({ invoke: async () => 'x', tools: [], log: m => logs.push(m) });
    assert.deepEqual(FakeSandbox.connected, ['fake-sbx']);
    assert.equal(FakeSandbox.created.length, 1);
    assert.ok(logs.some(l => /resumed from the last run/.test(l)));
    await second.close();
});

test('e2b falls back to a new sandbox when the saved one is gone', async () => {
    const { FakeSandbox } = fakeSandboxClass();
    const dir = mkdtempSync(path.join(os.tmpdir(), 'e2bstate-'));
    const statePath = path.join(dir, 'e2b-sandbox.json');
    writeFileSync(statePath, JSON.stringify({ sandboxId: 'expired' }));
    FakeSandbox.gone = true;
    const logs = [];
    const backend = createE2bBackend({
        apiKey: 'k',
        agentName: 'T',
        loadSandbox: async () => FakeSandbox,
        relayScheme: 'http',
        statePath,
    });
    await backend.start({ invoke: async () => 'x', tools: [], log: m => logs.push(m) });
    assert.equal(FakeSandbox.created.length, 1);
    assert.ok(logs.some(l => /could not be resumed/.test(l)));
    assert.equal(JSON.parse(readFileSync(statePath, 'utf8')).sandboxId, 'fake-sbx');
    await backend.close();
});
