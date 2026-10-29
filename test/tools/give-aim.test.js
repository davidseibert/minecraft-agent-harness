import test from 'node:test';
import assert from 'node:assert/strict';
import { tossLandDistance, tossPitchFor } from '../../src/tools/game-tools.js';
test('give toss lands past an adjacent recipient, outside the giver pickup reach', () => {
    for (const d of [1.7, 2, 2.5, 3])
        assert.ok(Math.abs(tossLandDistance(tossPitchFor(d, 0), 0) - d) < 0.15, `flat ${d}`);
    assert.ok(tossLandDistance(tossPitchFor(1.7, 0), 0) > 1.45);
});
test('higher recipient gets a lob onto their block', () => {
    const p = tossPitchFor(0.9, 1);
    assert.ok(p > 0.35, 'lobbed upward');
    assert.ok(Math.abs(tossLandDistance(p, 1) - 0.9) < 0.15);
});
test('lower recipient: lands at their level', () => {
    assert.ok(Math.abs(tossLandDistance(tossPitchFor(1.7, -1), -1) - 1.7) < 0.15);
});
