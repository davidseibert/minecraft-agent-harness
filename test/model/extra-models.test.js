import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findModel, extraModelIds } from '../../src/model/extra-models.js';

function runtime(models) {
    return { getModel: (provider, id) => models.find(m => m.provider === provider && m.id === id) };
}

const terra = {
    provider: 'openai',
    id: 'gpt-5.6-terra',
    name: 'GPT-5.6 Terra',
    api: 'openai-responses',
    contextWindow: 272000,
};

test('findModel returns catalog models unchanged', () => {
    assert.equal(findModel(runtime([terra]), 'openai', 'gpt-5.6-terra'), terra);
});

test('findModel fills in a model the catalog does not list yet', () => {
    const model = findModel(runtime([terra]), 'openai', 'gpt-6.1-terra');
    assert.deepEqual(model, { ...terra, id: 'gpt-6.1-terra', name: 'GPT-6.1 Terra' });
});

test('findModel prefers the catalog entry once it exists', () => {
    const own = { ...terra, id: 'gpt-6.1-terra', name: 'Catalog Terra' };
    assert.equal(findModel(runtime([terra, own]), 'openai', 'gpt-6.1-terra'), own);
    assert.deepEqual(extraModelIds(runtime([terra, own]), 'openai'), []);
});

test('findModel still rejects unknown models', () => {
    assert.equal(findModel(runtime([terra]), 'openai', 'not-a-model'), undefined);
    assert.equal(findModel(runtime([]), 'openai', 'gpt-6.1-terra'), undefined);
});

test('extraModelIds lists filled-in models for listing', () => {
    assert.deepEqual(extraModelIds(runtime([terra]), 'openai'), ['gpt-6.1-terra']);
    assert.deepEqual(extraModelIds(runtime([terra]), 'anthropic'), []);
});
