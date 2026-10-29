import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function fixture() {
    const registry = require('minecraft-data')('1.21.6');
    const packets = [];
    const b = new EventEmitter();
    b._client = Object.assign(new EventEmitter(), { write: (name, data) => packets.push({ name, ...data }) });
    b.registry = registry;
    b.version = '1.21.6';
    b.supportFeature = feature => registry.supportFeature(feature);
    b.QUICK_BAR_START = 36;
    b.entity = { position: { x: 0, y: 64, z: 0 } };
    require('mineflayer/lib/plugins/inventory.js')(b, { hideErrors: true });
    return { b, packets };
}

const empty = n => Array.from({ length: n }, () => ({ itemCount: 0 }));
const withStone = (n, slots) => {
    const items = empty(n);
    const stone = require('minecraft-data')('1.21.6').itemsByName.stone.id;
    for (const slot of slots)
        items[slot] = {
            itemCount: 1,
            itemId: stone,
            addedComponentCount: 0,
            removedComponentCount: 0,
            components: [],
            removeComponents: [],
        };
    return items;
};

test('window clicks carry the clicked window state id, not the last one seen for any window', async () => {
    const { b, packets } = fixture();
    b._client.emit('window_items', {
        windowId: 0,
        stateId: 5,
        items: withStone(46, [36]),
        carriedItem: { itemCount: 0 },
    });
    b._client.emit('open_window', { windowId: 1, inventoryType: 12, windowTitle: '"Crafting"' });
    b._client.emit('window_items', {
        windowId: 1,
        stateId: 1,
        items: withStone(46, [10, 11]),
        carriedItem: { itemCount: 0 },
    });
    b._client.emit('set_slot', { windowId: 0, stateId: 12, slot: 45, item: { itemCount: 0 } });
    assert.equal(b.currentWindow?.id, 1);
    await b.clickWindow(10, 0, 0);
    assert.equal(packets.at(-1).name, 'window_click');
    assert.equal(packets.at(-1).windowId, 1);
    assert.equal(packets.at(-1).stateId, 1);
    b._client.emit('set_slot', { windowId: -1, stateId: 3, slot: -1, item: { itemCount: 0 } });
    await b.clickWindow(10, 0, 0);
    assert.equal(packets.at(-1).stateId, 3);
    b.closeWindow(b.currentWindow);
    await b.clickWindow(36, 0, 0);
    assert.equal(packets.at(-1).windowId, 0);
    assert.equal(packets.at(-1).stateId, 12);
});
