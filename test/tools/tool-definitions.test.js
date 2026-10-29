import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createGameTools } from '../../src/tools/game-tools.js';

const snapshotPath = new URL('../fixtures/tool-definitions.json', import.meta.url);

function fakeBot(flight) {
    const position = { x: 0, y: 64, z: 0, offset: () => position, distanceTo: () => 0 };
    return {
        username: 'Test',
        game: { gameMode: 'survival' },
        entity: { id: 0, position, yaw: 0, pitch: 0 },
        entities: {},
        inventory: { items: () => [], slots: new Array(46).fill(null) },
        pathfinder: { setMovements: () => {}, setGoal: () => {}, stop: () => {} },
        clearControlStates: () => {},
        ...(flight ? {} : { pi_no_flight: true }),
    };
}

const variants = {
    single: { flight: false, options: {} },
    creative: { flight: true, options: {} },
    full: {
        flight: true,
        options: { mailbox: {}, plan: { read: () => ({}), append: () => ({}) }, peers: ['Ada'], whisperPlayers: true },
    },
};

function definitions() {
    const out = {};
    for (const [label, { flight, options }] of Object.entries(variants)) {
        const tools = createGameTools({ bot: fakeBot(flight), observe: async () => ({ state: {} }), ...options });
        out[label] = tools.map(({ name, label: toolLabel, description, parameters }) => ({
            name,
            label: toolLabel,
            description,
            parameters,
        }));
    }
    return JSON.parse(JSON.stringify(out));
}

test('tool names, order, descriptions and schemas match the committed snapshot', () => {
    const current = definitions();
    if (process.env.UPDATE_TOOL_SNAPSHOT === '1') writeFileSync(snapshotPath, `${JSON.stringify(current, null, 2)}\n`);
    const expected = JSON.parse(readFileSync(snapshotPath, 'utf8'));
    assert.deepEqual(current, expected);
});
