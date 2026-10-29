import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { convertResponsesMessages } from '@earendil-works/pi-ai/api/openai-responses-shared';
import { validateImage, sanitizeImages, isImageRejection, redactPayloads } from '../../src/model/image-guard.js';
import { createMinecraftSession, createPiSession } from '../../src/model/session.js';

const JPEG = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
    Buffer.from('JFIF\0tiny-test-frame'),
]).toString('base64');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]).toString('base64');
const img = (data = JPEG, mimeType = 'image/jpeg') => ({ type: 'image', data, mimeType });
const REAL_400 =
    'OpenAI API error (400): {"message":"litellm.BadRequestError: BedrockException - {\\"message\\":\\"This model doesn\'t support the image field for user messages. Remove image and try again.\\"}No fallback model group found for lookup_groups=vendor/test-model."}';

test('validateImage: accepts real magic bytes, rejects empty/wrong type/mismatch/non-base64/oversize', () => {
    assert.equal(validateImage(img()), null);
    assert.equal(validateImage(img(PNG, 'image/png')), null);
    assert.match(validateImage(img('')), /empty/);
    assert.match(validateImage(img(JPEG, 'image/gif')), /unsupported mimeType/);
    assert.match(validateImage(img(PNG, 'image/jpeg')), /do not match/);
    assert.match(validateImage(img('not base64!!')), /base64/);
    const big = Buffer.alloc(3_800_000);
    big[0] = 0xff;
    big[1] = 0xd8;
    big[2] = 0xff;
    assert.match(validateImage(img(big.toString('base64'))), /too large/);
});

test('sanitizeImages: tool-result images become placeholders, valid user images kept, input not mutated', () => {
    const tr = {
        role: 'toolResult',
        toolName: 'observe_world',
        toolCallId: 'c1',
        content: [{ type: 'text', text: '{}' }, img()],
    };
    const user = { role: 'user', content: [{ type: 'text', text: 'obs' }, img()] };
    const bad = { role: 'user', content: [img('', 'image/jpeg')] };
    const { messages, removed } = sanitizeImages([tr, user, bad]);
    assert.equal(tr.content[1].type, 'image', 'durable transcript object untouched');
    assert.equal(messages[0].content[1].type, 'text');
    assert.match(messages[0].content[1].text, /image omitted: tool-result images/);
    assert.equal(messages[1].content[1].type, 'image');
    assert.equal(messages[2].content[0].type, 'text');
    assert.deepEqual(
        removed.map(r => [r.role, r.index]),
        [
            ['toolResult', 0],
            ['user', 2],
        ],
    );
    const none = sanitizeImages([user], { allowImages: false });
    assert.equal(none.messages[0].content.filter(c => c.type === 'image').length, 0);
});

test('isImageRejection: exact live error is the image class; other 4xx are not', () => {
    assert.equal(isImageRejection(REAL_400), true);
    assert.equal(isImageRejection('OpenAI API error (400): {"message":"context length exceeded"}'), false);
    assert.equal(isImageRejection('OpenAI API error (401): invalid api key'), false);
    assert.equal(isImageRejection('OpenAI API error (429): rate limited image quota'), false);
    assert.equal(isImageRejection(undefined), false);
    assert.equal(isImageRejection('OpenAI API error (400): {"message":"image too large"}'), false);
    assert.equal(isImageRejection('OpenAI API error (400): {"message":"invalid tool name image_tool"}'), false);
    assert.equal(isImageRejection("OpenAI API error (500): This model doesn't support the image field"), false);
});

test('redactPayloads keeps every non-payload character', () => {
    const blob = 'A'.repeat(1000);
    const out = redactPayloads(`${REAL_400} data:image/jpeg;base64,${blob} tail`);
    assert.ok(out.startsWith(REAL_400));
    assert.ok(out.endsWith(' tail'));
    assert.match(out, /<base64 \d+ chars sha256=[0-9a-f]{16}>/);
});

function harness({ rejectAnyImage = false, alwaysError = null } = {}) {
    const requests = [];
    const assistant = (content, extra = {}) => ({
        role: 'assistant',
        content,
        api: 'openai-responses',
        provider: 'gateway',
        model: 'vendor/test-model',
        usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'stop',
        timestamp: Date.now(),
        ...extra,
    });
    const responses = {
        stream(model, context) {
            const items = convertResponsesMessages(model, context, new Set([model.provider]));
            const toolImages = items.filter(
                i =>
                    i.type === 'function_call_output' &&
                    Array.isArray(i.output) &&
                    i.output.some(o => o.type === 'input_image'),
            ).length;
            const userImages = items
                .filter(i => i.role === 'user')
                .flatMap(i => i.content)
                .filter(c => c.type === 'input_image').length;
            requests.push({ toolImages, userImages, items: items.length });
            const s = createAssistantMessageEventStream();
            queueMicrotask(() => {
                let msg;
                if (alwaysError) msg = assistant([], { stopReason: 'error', errorMessage: alwaysError });
                else if (toolImages || (rejectAnyImage && userImages))
                    msg = assistant([], { stopReason: 'error', errorMessage: REAL_400 });
                else if (!context.messages.some(m => m.role === 'toolResult'))
                    msg = assistant(
                        [{ type: 'toolCall', id: 'call_1|fc_1', name: 'look_tool', arguments: { image: true } }],
                        { stopReason: 'toolUse' },
                    );
                else msg = assistant([{ type: 'text', text: 'Built a wall.' }]);
                s.push({ type: 'start', partial: msg });
                if (msg.stopReason === 'error') s.push({ type: 'error', reason: 'error', error: msg });
                else s.push({ type: 'done', reason: msg.stopReason, message: msg });
                s.end?.();
            });
            return s;
        },
    };
    const dir = mkdtempSync(join(tmpdir(), 'img400-'));
    const cycles = [],
        diags = [];
    const tool = {
        name: 'look_tool',
        label: 'look',
        description: 'look',
        parameters: { type: 'object', properties: { image: { type: 'boolean' } } },
        execute: async () => ({ content: [{ type: 'text', text: '{"ok":true}' }, img()], details: {} }),
    };
    const make = () =>
        createMinecraftSession(
            {
                agentId: 'T',
                cwd: dir,
                sessionDir: join(dir, 's'),
                systemPrompt: 'You are a test agent.',
                apiKey: 'test',
                model: {
                    provider: 'gateway',
                    id: 'vendor/test-model',
                    name: 'Test Model',
                    input: ['text', 'image'],
                    baseUrl: 'http://127.0.0.1:9',
                    serviceTier: undefined,
                },
                tools: [tool],
                observe: async () => ({ text: '{}', images: [img()] }),
                cycleTelemetry: e => cycles.push(e),
                diagnostics: e => diags.push(e),
            },
            { createSession: options => createPiSession(options, { responses }) },
        );
    const transcript = () => {
        const d = join(dir, 's', 'T');
        const f = readdirSync(d).find(n => n.endsWith('.jsonl'));
        return readFileSync(join(d, f), 'utf8').trim().split('\n').map(JSON.parse);
    };
    return { requests, cycles, diags, make, transcript };
}
const cycle = async runner => {
    runner.paused = false;
    await runner.runCycle();
};

test('v6 Hw03 path: an image returned by a tool never reaches the model; the session keeps working', async () => {
    const h = harness();
    const runner = await h.make();
    await cycle(runner);
    await cycle(runner);
    assert.deepEqual(
        h.cycles.map(c => c.status),
        ['complete', 'complete'],
    );
    assert.ok(
        h.requests.every(r => r.toolImages === 0),
        JSON.stringify(h.requests),
    );
    assert.ok(
        h.requests.every(r => r.userImages === 1),
        'per-step frame still sent in the user message',
    );
    assert.ok(h.diags.some(d => d.event === 'images_omitted' && d.removed[0].role === 'toolResult'));
    assert.equal(
        h.transcript().filter(e => e.message?.role === 'toolResult' && e.message.content.some(c => c.type === 'image'))
            .length,
        1,
        'durable transcript keeps the original image block (evidence), only the request omits it',
    );
    await runner.close();
});

test('recovery: image-class 400 -> exactly one same-turn retry without images, logged, session continues', async () => {
    const h = harness({ rejectAnyImage: true });
    const runner = await h.make();
    await cycle(runner);
    assert.equal(h.cycles[0].status, 'complete');
    assert.equal(h.cycles[0].imageRetry, 'recovered');
    const err = h.diags.find(d => d.event === 'model_error');
    assert.ok(err.errorMessage.includes("doesn't support the image field"), 'full provider text kept');
    assert.ok(h.diags.some(d => d.event === 'image_400_retry'));
    assert.equal(h.requests[0].userImages, 1);
    assert.equal(h.requests[1].userImages, 0);
    assert.ok(
        h.transcript().some(e => e.message?.stopReason === 'error' && e.message.errorMessage === REAL_400),
        'error stays in the durable transcript',
    );
    await runner.close();
});

test('recovery is single-shot: a second image 400 fails the cycle (no loop)', async () => {
    const h = harness({ alwaysError: REAL_400 });
    const runner = await h.make();
    await cycle(runner);
    assert.equal(h.requests.length, 2);
    assert.equal(h.cycles[0].status, 'error');
    assert.equal(h.cycles[0].imageRetry, 'failed');
    await runner.close();
});

for (const other of [
    'OpenAI API error (400): {"message":"context length exceeded"}',
    'OpenAI API error (401): {"message":"invalid key"}',
    'OpenAI API error (429): {"message":"slow down"}',
]) {
    test(`no hidden retry for other errors: ${other.slice(17, 22)}`, async () => {
        const h = harness({ alwaysError: other });
        const runner = await h.make();
        await cycle(runner);
        assert.equal(h.requests.length, 1);
        assert.equal(h.cycles[0].status, 'error');
        assert.equal(h.cycles[0].imageRetry, undefined);
        assert.equal(h.diags.find(d => d.event === 'model_error').errorMessage, other);
        assert.ok(!h.diags.some(d => d.event === 'image_400_retry'));
        await runner.close();
    });
}

test('no retry when the cycle has under 10 s of budget left (logged instead)', async () => {
    const h = harness({ rejectAnyImage: true });
    const runner = await h.make();
    runner.options.maxWallMs = 5000;
    await cycle(runner);
    assert.equal(h.requests.length, 1);
    assert.equal(h.cycles[0].status, 'error');
    assert.ok(h.diags.some(d => d.event === 'image_400_no_retry'));
    await runner.close();
});
