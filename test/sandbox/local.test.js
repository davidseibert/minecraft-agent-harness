import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLocalBackend } from '../../src/sandbox/shell-sandbox.js';

test('local sandbox keeps the tool command on PATH even when a login profile resets PATH', async () => {
    const workdir = mkdtempSync(path.join(os.tmpdir(), 'local-'));
    writeFileSync(path.join(workdir, '.bash_profile'), 'export PATH=/usr/bin:/bin\n');
    const backend = createLocalBackend({ workdir });
    await backend.start({ invoke: async name => ({ via: name }), tools: [] });
    try {
        const r = await backend.run('tool inventory', { timeoutMs: 20000, outputBytes: 1000 });
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout.trim(), '{"via":"inventory"}');
    } finally {
        await backend.close();
    }
});
