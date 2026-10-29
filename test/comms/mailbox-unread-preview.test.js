import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MailboxStore } from '../../src/comms/mailbox-store.js';
test('unreadPreview shows unread DMs without marking read', () => {
    const f = join(mkdtempSync(join(tmpdir(), 'mb-')), 'm.sqlite');
    const a = new MailboxStore(f, 'Ada'),
        b = new MailboxStore(f, 'Bram');
    a.sendDM('Bram', 'x'.repeat(300));
    const p = b.unreadPreview();
    assert.equal(p.length, 1);
    assert.equal(p[0].sender, 'Ada');
    assert.equal(p[0].text.length, 201);
    assert.equal(b.unreadPreview().length, 1);
    assert.equal(b.readDMs().messages.length, 1);
    assert.equal(b.unreadPreview().length, 0);
    a.close();
    b.close();
});
