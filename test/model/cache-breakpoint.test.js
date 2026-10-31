import test from 'node:test';
import assert from 'node:assert/strict';
import { markCacheBreakpoint, moveMessagesBreakpoint } from '../../src/model/session.js';
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
const cc = { type: 'ephemeral' };
const result = { type: 'tool_result', tool_use_id: 't', content: 'ok' };
const observed = { type: 'text', text: 'Current observation', cache_control: cc };
test('moves the Messages breakpoint off an observation in a separate message', () => {
    const payload = {
        messages: [
            { role: 'user', content: [{ type: 'text', text: 'wake' }] },
            { role: 'assistant', content: [{ type: 'tool_use', id: 't', name: 'x', input: {} }] },
            { role: 'user', content: [result] },
            { role: 'user', content: [observed] },
        ],
    };
    const out = moveMessagesBreakpoint(payload);
    assert.deepEqual(out.messages[2].content, [{ ...result, cache_control: cc }]);
    assert.deepEqual(out.messages[3].content, [{ type: 'text', text: 'Current observation' }]);
    assert.equal(payload.messages[2].content[0], result);
    assert.equal(payload.messages[3].content[0], observed);
});
test('moves the Messages breakpoint to the previous block of a merged message', () => {
    const payload = { messages: [{ role: 'user', content: [result, observed] }] };
    assert.deepEqual(moveMessagesBreakpoint(payload).messages[0].content, [
        { ...result, cache_control: cc },
        { type: 'text', text: 'Current observation' },
    ]);
});
test('skips assistant messages and reads string content when moving the Messages breakpoint', () => {
    const payload = {
        messages: [
            { role: 'user', content: 'wake' },
            { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
            { role: 'user', content: [observed] },
        ],
    };
    const out = moveMessagesBreakpoint(payload);
    assert.deepEqual(out.messages[0].content, [{ type: 'text', text: 'wake', cache_control: cc }]);
    assert.equal(out.messages[1], payload.messages[1]);
});
test('keeps the Messages breakpoint when nothing precedes it or none is set', () => {
    const only = { messages: [{ role: 'user', content: [observed] }] };
    assert.equal(moveMessagesBreakpoint(only), only);
    const unmarked = { messages: [{ role: 'user', content: [result] }] };
    assert.equal(moveMessagesBreakpoint(unmarked), unmarked);
    const responses = { input: [] };
    assert.equal(moveMessagesBreakpoint(responses), responses);
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
