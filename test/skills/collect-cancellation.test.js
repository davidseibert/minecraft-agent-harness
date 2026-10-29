import test from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import { collectBlock } from '../../src/skills/skills.js';
function fixture() {
    let attempts = 0;
    const pos = new Vec3(1, 64, 1);
    const block = { name: 'stone', position: pos, canHarvest: () => true };
    const bot = {
        registry: minecraftData('1.21.6'),
        entity: { position: new Vec3(0, 64, 0) },
        heldItem: null,
        inventory: { items: () => [] },
        findBlocks: () => [pos],
        blockAt: () => block,
        tool: { equipForBlock: async () => {} },
        modes: { isOn: () => false },
        output: '',
        collectBlock: {
            collect: async () => {
                attempts++;
                bot.interrupt_code = true;
                const e = new Error('cancelled');
                e.name = 'GoalChanged';
                throw e;
            },
        },
    };
    return { bot, attempts: () => attempts };
}
test('collection cancellation does not retry remaining 64 blocks', async () => {
    const { bot, attempts } = fixture();
    await collectBlock(bot, 'stone', 64);
    assert.equal(attempts(), 1);
});
test('already interrupted collection never starts another block', async () => {
    const { bot, attempts } = fixture();
    bot.interrupt_code = true;
    await collectBlock(bot, 'stone', 64);
    assert.equal(attempts(), 0);
});
