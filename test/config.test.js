import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultSandbox, resolveConfig } from '../src/config.js';

test('default sandbox prefers e2b with a key, then docker, then local', () => {
    assert.equal(
        defaultSandbox({ E2B_API_KEY: 'k' }, () => true),
        'e2b',
    );
    assert.equal(
        defaultSandbox({}, () => true),
        'docker',
    );
    assert.equal(
        defaultSandbox({}, () => false),
        'local',
    );
});

test('explicit sandbox and docker settings flow into the resolved config', () => {
    const config = resolveConfig([{ objective: 'x', sandbox: 'docker', dockerImage: 'img:1', dockerMemory: '4g' }], {
        env: {},
        probeDocker: () => false,
    });
    assert.equal(config.sandbox.kind, 'docker');
    assert.equal(config.sandbox.image, 'img:1');
    assert.equal(config.sandbox.memory, '4g');
});

test('unknown sandbox kinds are rejected', () => {
    assert.throws(
        () => resolveConfig([{ objective: 'x', sandbox: 'vm' }], { env: {}, probeDocker: () => false }),
        /sandbox must be one of none, local, docker, e2b/,
    );
});
