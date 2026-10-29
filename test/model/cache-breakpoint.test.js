import test from 'node:test';
import assert from 'node:assert/strict';
import { markCacheBreakpoint } from '../../src/model/session.js';
const obs = { role: 'user', content: [{ type: 'input_text', text: 'Current observation' }] };
const bp = { mode: 'explicit' };
test('marks the tool output just before the observation', () => {
    const payload = {
        input: [
            { role: 'developer', content: 'sys' },
            { type: 'function_call', call_id: 'c', name: 't', arguments: '{}' },
            { type: 'function_call_output', call_id: 'c', output: 'ok' },
            obs,
        ],
    };
    const out = markCacheBreakpoint(payload);
    assert.deepEqual(out.input[2].output, [{ type: 'input_text', text: 'ok', prompt_cache_breakpoint: bp }]);
    assert.equal(payload.input[2].output, 'ok');
    assert.equal(out.input[3], obs);
});
test('skips assistant and function_call items, marks the newest user text', () => {
    const payload = {
        input: [
            { role: 'user', content: [{ type: 'input_text', text: 'wake' }] },
            { role: 'assistant', content: [{ type: 'output_text', text: 'hi' }] },
            obs,
        ],
    };
    const out = markCacheBreakpoint(payload);
    assert.deepEqual(out.input[0].content[0].prompt_cache_breakpoint, bp);
    assert.equal(out.input[1], payload.input[1]);
});
test('marks a trailing image part and leaves non-Responses payloads alone', () => {
    const img = {
        type: 'function_call_output',
        call_id: 'c',
        output: [
            { type: 'input_text', text: 'look' },
            { type: 'input_image', image_url: 'data:x' },
        ],
    };
    assert.deepEqual(markCacheBreakpoint({ input: [img, obs] }).input[0].output[1].prompt_cache_breakpoint, bp);
    const chat = { messages: [{ role: 'user', content: 'x' }] };
    assert.equal(markCacheBreakpoint(chat), chat);
    const one = { input: [obs] };
    assert.equal(markCacheBreakpoint(one), one);
});
