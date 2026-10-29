import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
const req = createRequire(import.meta.url);
const { Vec3 } = req('vec3'),
    pf = req('mineflayer-pathfinder'),
    mcData = req('minecraft-data');
const { CollectBlock } = req('mineflayer-collectblock/lib/CollectBlock.js');
const delay = ms => new Promise(r => setTimeout(r, ms));
class Entity {
    constructor() {
        this.isValid = true;
        this.position = new Vec3(1, 64, 0);
    }
}
function fixture() {
    const bot = new EventEmitter();
    Object.assign(bot, {
        registry: mcData('1.21.6'),
        entity: { position: new Vec3(0, 64, 0), velocity: new Vec3(0, 0, 0) },
        inventory: { items: () => [], emptySlotCount: () => 10 },
        entities: {},
        tool: {},
        clearControlStates() {},
        stopDigging() {},
    });
    pf.pathfinder(bot);
    return { bot, plugin: new CollectBlock(bot), item: new Entity() };
}
function clean(bot) {
    for (const e of ['entityGone', 'collectBlock_cancel', 'collectBlock_finished'])
        assert.equal(bot.listenerCount(e), 0, e + ' leaked');
}
async function bounded(p) {
    let timer;
    try {
        return await Promise.race([
            p,
            new Promise((_, rej) => {
                timer = setTimeout(() => rej(Error('collection failed to cancel')), 300);
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}
test('cancel settles pickup wait after actual pathfinder goto finishes, invokes callback once', async () => {
    const { bot, plugin, item } = fixture();
    const p = plugin.collect(item);
    await delay(5);
    bot.emit('goal_reached');
    await delay(5);
    assert.equal(bot.listenerCount('goal_reached'), 0);
    let callbacks = 0;
    await bounded(Promise.all([p, plugin.cancelTask(() => callbacks++)]));
    assert.equal(callbacks, 1);
    assert.equal(bot.pathfinder.goal, null);
    assert.equal(plugin.targets.empty, true);
    clean(bot);
});
test('cancel settles pending actual goto and removes pickup listeners', async () => {
    const { bot, plugin, item } = fixture();
    const p = plugin.collect(item).catch(e => e.name);
    await delay(5);
    await bounded(plugin.cancelTask());
    assert.equal(await bounded(p), 'GoalChanged');
    assert.equal(bot.pathfinder.goal, null);
    clean(bot);
});
test('normal entity pickup still succeeds and cleans listeners', async () => {
    const { bot, plugin, item } = fixture();
    const p = plugin.collect(item);
    await delay(5);
    bot.emit('goal_reached');
    await delay(5);
    bot.emit('entityGone', item);
    await bounded(p);
    clean(bot);
});
test('goto failure removes entityGone and cancel listeners', async () => {
    const { bot, plugin, item } = fixture();
    const p = plugin.collect(item).catch(e => e.name);
    await delay(5);
    bot.pathfinder.setGoal(null);
    assert.equal(await bounded(p), 'GoalChanged');
    clean(bot);
});
