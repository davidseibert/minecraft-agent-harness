import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { causeLabel, installDamageTypes, formatHitAlert } from '../../src/body/hurt-cause.js';
test('damage type comes from the registry index', () => {
    const client = new EventEmitter();
    const bot = { _client: client, entity: { id: 7 } };
    client.on('damage_event', () => {
        bot.seen = bot.pi_lastDamageType;
    });
    installDamageTypes(bot);
    client.emit('registry_data', {
        id: 'minecraft:damage_type',
        entries: [{ key: 'minecraft:arrow' }, { key: 'minecraft:lava' }, { key: 'minecraft:on_fire' }],
    });
    client.emit('damage_event', { entityId: 7, sourceTypeId: 1, sourceCauseId: 0 });
    assert.equal(bot.seen, 'lava');
    client.emit('damage_event', { entityId: 9, sourceTypeId: 2 });
    assert.equal(bot.pi_lastDamageType, 'lava');
});
test('labels and grouping', () => {
    assert.equal(causeLabel('drown'), 'drowning (out of air)');
    assert.equal(causeLabel('some_new'), 'some new');
    const evs = [
        { by: 'lava', cause: 'lava', id: null },
        ...Array(9)
            .fill(0)
            .map(() => ({ by: 'burning (you are on fire)', cause: 'on_fire', id: null })),
    ];
    const s = formatHitAlert(evs, 3.2);
    assert.equal(s, 'YOU WERE HIT 10x since your last look: lava; burning (you are on fire) x9. Health now 3/20.');
    const z = formatHitAlert(
        [
            { by: 'zombie', id: 5, kind: 'hostile', at: { x: 1, y: 2, z: 3 } },
            { by: 'zombie', id: 5, kind: 'hostile', at: { x: 1, y: 2, z: 4 } },
        ],
        15,
    );
    assert.match(
        z,
        /^YOU WERE HIT 2x since your last look: zombie \(entity id 5, hostile, at 1,2,4\) x2\. Health now 15\/20\. You can fight back/,
    );
});
