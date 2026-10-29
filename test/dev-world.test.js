import test from 'node:test';
import assert from 'node:assert/strict';
import { startupCommands } from '../scripts/dev-world.js';

test('new seed-2024 worlds use the checked forest spawn and morning time', () => {
    assert.deepEqual(startupCommands({ worldExists: false, world: 'normal', seed: '2024' }), [
        'time set day',
        'setworldspawn 5 71 -3',
        'gamerule spawnRadius 0',
    ]);
    assert.deepEqual(startupCommands({ worldExists: true, world: 'normal', seed: '2024' }), ['time set day']);
    assert.deepEqual(startupCommands({ worldExists: false, world: 'void', seed: '2024' }), ['time set day']);
    assert.deepEqual(startupCommands({ worldExists: false, world: 'normal', seed: '100' }), ['time set day']);
});
