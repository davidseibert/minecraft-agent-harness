import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createMinecraftSession } from '../../src/model/session.js';

const KEY = 'sentinel-gateway-key';
function gateway(script) {
    const requests = [];
    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', d => {
            body += d;
        });
        req.on('end', () => {
            const r = { path: req.url, headers: req.headers, body: JSON.parse(body), closed: false };
            requests.push(r);
            res.on('close', () => {
                r.closed = true;
            });
            const step = script[requests.length - 1] ?? script.at(-1);
            res.writeHead(200, { 'content-type': 'text/event-stream' });
            const send = e => res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
            send({ type: 'response.created', response: { id: `r${requests.length}` } });
            if (step === 'hang') return;
            const item = step.call
                ? {
                      type: 'function_call',
                      id: `fc${requests.length}`,
                      call_id: `c${requests.length}`,
                      name: step.call,
                      arguments: JSON.stringify(step.args ?? {}),
                  }
                : {
                      type: 'message',
                      id: `m${requests.length}`,
                      role: 'assistant',
                      content: [{ type: 'output_text', text: step.text }],
                  };
            send({
                type: 'response.output_item.added',
                output_index: 0,
                item: step.call ? { ...item, arguments: '' } : { ...item, content: [] },
            });
            if (step.call)
                send({ type: 'response.function_call_arguments.delta', output_index: 0, delta: item.arguments });
            else send({ type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: step.text });
            send({ type: 'response.output_item.done', output_index: 0, item });
            send({
                type: 'response.completed',
                response: {
                    id: `r${requests.length}`,
                    status: 'completed',
                    output: [item],
                    usage: {
                        input_tokens: 10,
                        output_tokens: 5,
                        total_tokens: 15,
                        input_tokens_details: { cached_tokens: 0 },
                    },
                },
            });
            res.end();
        });
    });
    return new Promise(ok =>
        server.listen(0, '127.0.0.1', () =>
            ok({ requests, server, url: `http://127.0.0.1:${server.address().port}/v1` }),
        ),
    );
}
const MODEL = url => ({
    provider: 'gateway',
    id: 'vendor/test-model',
    name: 'Test Model',
    baseUrl: url,
    input: ['text'],
    headers: { 'api-key': KEY },
    serviceTier: undefined,
    requestTimeoutMs: 400,
});
function setup(url, dir, extra = {}) {
    const calls = [];
    const tool = {
        name: 'place_probe',
        label: 'place_probe',
        description: 'Synthetic placement probe.',
        parameters: { type: 'object', properties: { x: { type: 'number' } }, required: ['x'] },
        execute: async (_id, args) => {
            calls.push(args);
            return { content: [{ type: 'text', text: JSON.stringify({ placed: true, x: args.x }) }], details: {} };
        },
    };
    const cycles = [];
    return createMinecraftSession({
        agentId: 'Kt01',
        cwd: dir,
        sessionDir: path.join(dir, 's'),
        systemPrompt: 'test prompt',
        apiKey: KEY,
        model: MODEL(url),
        tools: [tool],
        maxModelCalls: Number.MAX_SAFE_INTEGER,
        maxToolCalls: Number.MAX_SAFE_INTEGER,
        observe: async () => ({ text: '{"pos":[0,64,0]}', images: [] }),
        cycleTelemetry: e => cycles.push(e),
        ...extra,
    }).then(runner => ({ runner, calls, cycles }));
}
const until = async (f, ms = 5000) => {
    const t = Date.now();
    while (!f()) {
        if (Date.now() - t > ms) throw new Error('timeout');
        await new Promise(r => setTimeout(r, 10));
    }
};

test('one persistent session: tool call round trip, then persistence across restart', async () => {
    const g = await gateway([
        { call: 'place_probe', args: { x: 3 } },
        { text: 'placed one block' },
        { text: 'resumed' },
    ]);
    const dir = mkdtempSync(path.join(tmpdir(), 'gateway-'));
    const a = await setup(g.url, dir);
    a.runner.enqueue({ kind: 'start' });
    a.runner.start();
    await until(() => a.cycles.length === 1);
    await a.runner.close();
    assert.equal(a.cycles[0].status, 'complete');
    assert.deepEqual(a.calls, [{ x: 3 }]);
    assert.equal(g.requests.length, 2);
    for (const r of g.requests) {
        assert.equal(r.path, '/v1/responses');
        assert.equal(r.headers['api-key'], KEY);
        assert.equal(r.body.model, 'vendor/test-model');
        assert.equal(r.body.stream, true);
        assert.equal(r.body.service_tier, undefined);
        assert.ok(r.body.tools.some(t => t.name === 'place_probe'));
        assert.ok(!JSON.stringify(r.body.input).includes('input_image'));
    }
    const second = JSON.stringify(g.requests[1].body.input);
    assert.ok(second.includes('function_call_output') && second.includes('"placed\\":true'));
    const b = await setup(g.url, dir);
    b.runner.enqueue({ kind: 'resume' });
    b.runner.start();
    await until(() => b.cycles.length === 1, 15000);
    await b.runner.close();
    assert.ok(JSON.stringify(g.requests[2].body.input).includes('placed one block'));
    g.server.close();
});

test('STOP (cancel) aborts the in-flight streaming request promptly', async () => {
    const g = await gateway(['hang']);
    const dir = mkdtempSync(path.join(tmpdir(), 'gateway-'));
    const a = await setup(g.url, dir);
    a.runner.enqueue({ kind: 'start' });
    a.runner.start();
    await until(() => g.requests.length === 1);
    const t = Date.now();
    await a.runner.close();
    assert.ok(Date.now() - t < 2000);
    await until(() => g.requests[0].closed, 2000);
    assert.equal(a.calls.length, 0);
    g.server.close();
});

test('wall-clock guard stops a hung model call (no call caps involved)', async () => {
    const g = await gateway(['hang']);
    const dir = mkdtempSync(path.join(tmpdir(), 'gateway-'));
    const a = await setup(g.url, dir, { maxWallMs: 300 });
    a.runner.enqueue({ kind: 'start' });
    a.runner.start();
    await until(() => a.cycles.length === 1);
    assert.equal(a.cycles[0].status, 'budget');
    await until(() => g.requests[0].closed, 2000);
    await a.runner.close();
    g.server.close();
});

test('per-request timeout aborts a silent gateway stream (distinct from trial wall)', async () => {
    const g = await gateway(['hang']);
    const dir = mkdtempSync(path.join(tmpdir(), 'gateway-'));
    const a = await setup(g.url, dir);
    a.runner.enqueue({ kind: 'start' });
    a.runner.start();
    await until(() => a.cycles.length === 1, 3000);
    assert.notEqual(a.cycles[0].status, 'budget');
    assert.ok(a.cycles[0].timeMs < 2000);
    assert.equal(g.requests.length, 1);
    await until(() => g.requests[0].closed, 2000);
    await a.runner.close();
    g.server.close();
});
