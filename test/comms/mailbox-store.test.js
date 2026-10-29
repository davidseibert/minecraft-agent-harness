import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { MailboxStore } from '../../src/comms/mailbox-store.js';

function fixture(t) {
    const dir = mkdtempSync(join(tmpdir(), 'mailbox-test-'));
    const file = join(dir, 'mailbox.sqlite');
    const stores = [];
    t.after(() => {
        for (const store of stores) store.close();
        rmSync(dir, { recursive: true, force: true });
    });
    return {
        file,
        open(name) {
            const store = new MailboxStore(file, name);
            stores.push(store);
            return store;
        },
    };
}

const text = page => page.messages.map(message => message.text);

test('three agents isolate DMs and per-observer public records', t => {
    const f = fixture(t);
    const a = f.open('Ashlar'),
        b = f.open('Moss'),
        c = f.open('Rove');
    const receipt = a.sendDM('Moss', 'private A-B');
    c.sendDM('Ashlar', 'private C-A');
    b.sendDM('Rove', 'private B-C');
    for (const store of [a, b, c]) store.receiveChat('Human', 'hello everyone');
    assert.equal(typeof receipt, 'number');
    assert.deepEqual(text(a.readDMs()), ['private C-A']);
    assert.deepEqual(text(b.readDMs()), ['private A-B']);
    assert.deepEqual(text(c.readDMs()), ['private B-C']);
    assert.deepEqual(text(c.readDMs('Ashlar', 0)), ['private C-A']);
    assert.deepEqual(text(a.readChat()), ['hello everyone']);
    assert.match(b.summary(), /public chat: 1/);
    assert.match(c.summary(), /public chat: 1/);
    assert.deepEqual(text(b.readChat()), ['hello everyone']);
    assert.equal(c.readChat().messages.length, 1);
    assert.equal(a.readDMs('Moss', 0).messages[0].id, receipt);
    assert.doesNotThrow(() => JSON.stringify(a.readDMs('', 0)));
    const db = new DatabaseSync(f.file);
    assert.equal(db.prepare('SELECT count(*) AS n FROM mailbox_chat').get().n, 3);
    assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
    db.close();
});

test('filtered incoming receipts do not clear other peers or old unread gaps', t => {
    const f = fixture(t);
    const a = f.open('Ashlar'),
        b = f.open('Moss'),
        c = f.open('Rove');
    b.sendDM('Ashlar', 'b1');
    c.sendDM('Ashlar', 'c1');
    const skipThrough = b.sendDM('Ashlar', 'b2');
    const sent = a.sendDM('Moss', 'outgoing');
    b.sendDM('Ashlar', 'b3');
    assert.match(a.summary(), /Moss=3, Rove=1/);
    assert.deepEqual(text(a.readDMs('Ashlar')), []);
    assert.deepEqual(text(a.readDMs('Ashlar', 0)), []);
    assert.deepEqual(text(a.readDMs('Moss', skipThrough, 1)), ['outgoing']);
    assert.match(a.summary(), /Moss=3, Rove=1/);
    assert.deepEqual(text(a.readDMs('Moss', sent)), ['b3']);
    assert.deepEqual(text(a.readDMs('Moss', -1, 1)), ['b1']);
    assert.match(a.summary(), /Moss=1, Rove=1/);
    assert.deepEqual(text(a.readDMs('Rove')), ['c1']);
    assert.deepEqual(text(a.readDMs()), ['b2']);
    assert.equal(a.summary(), 'Unread DMs: 0; public chat: 0 (mentions: 0).');
});

test('unread paging acknowledges only returned rows; explicit history pages include sent', t => {
    const f = fixture(t);
    const a = f.open('Ashlar'),
        b = f.open('Moss');
    for (let i = 0; i < 53; i++) b.sendDM('Ashlar', `message ${i}`);
    const first = a.readDMs('', -1, 50);
    assert.equal(first.messages.length, 50);
    assert.equal(first.hasMore, true);
    assert.equal(first.nextAfter, first.messages[49].id);
    assert.match(a.summary(), /Moss=3/);
    const rest = a.readDMs();
    assert.deepEqual(text(rest), ['message 50', 'message 51', 'message 52']);
    assert.equal(rest.hasMore, false);
    assert.deepEqual(a.readDMs(), { messages: [], nextAfter: -1, hasMore: false });
    a.sendDM('Moss', 'sent');
    let after = 0,
        messages = [];
    for (;;) {
        const page = a.readDMs('', after, 20);
        messages.push(...page.messages);
        after = page.nextAfter;
        if (!page.hasMore) break;
    }
    assert.equal(messages.length, 54);
    assert.equal(new Set(messages.map(m => m.id)).size, 54);
    assert.equal(messages.at(-1).text, 'sent');
    assert.deepEqual(a.readDMs('', after), { messages: [], nextAfter: after, hasMore: false });
});

test('public history gaps, paging, mentions and repeated text remain precise', t => {
    const f = fixture(t),
        a = f.open('Ashlar');
    a.receiveChat('Human', 'hello @ashlar');
    const gap = a.receiveChat('Human', 'hello @ASHLAR!');
    for (const s of ['@Ashlar_extra', 'x@Ashlar', '@@Ashlar', '@Ashlar123', '@Moss']) a.receiveChat('Human', s);
    a.receiveChat('Human', 'repeat');
    a.receiveChat('Human', 'repeat');
    assert.match(a.summary(), /public chat: 9 \(mentions: 2\)/);
    const page = a.readChat(gap, 2);
    assert.equal(page.hasMore, true);
    assert.equal(page.messages.length, 2);
    assert.match(a.summary(), /public chat: 7 \(mentions: 2\)/);
    const mentions = a.readChat(-1, 2);
    assert.equal(
        mentions.messages.every(m => m.mention),
        true,
    );
    assert.match(a.summary(), /public chat: 5 \(mentions: 0\)/);
    assert.equal(a.readChat().messages.length, 5);
    assert.equal(a.readChat(0, 50).messages.length, 9);
});

test('messages and read positions survive close/reopen; Minecraft names are case-insensitive', t => {
    const f = fixture(t),
        a = f.open('Ashlar'),
        b = f.open('Moss');
    b.sendDM('ashlar', 'read');
    b.sendDM('Ashlar', 'unread');
    a.receiveChat('Human', 'read chat');
    a.receiveChat('Human', '@Ashlar unread chat');
    a.readDMs('moss', -1, 1);
    a.readChat(-1, 1);
    a.close();
    b.close();
    const reopened = f.open('ashlar');
    assert.match(reopened.summary(), /Moss=1; public chat: 1 \(mentions: 1\)/);
    assert.deepEqual(text(reopened.readDMs()), ['unread']);
    assert.deepEqual(text(reopened.readChat()), ['@Ashlar unread chat']);
    assert.equal(reopened.readDMs('', 0).messages.length, 2);
    assert.equal(reopened.readChat(0).messages.length, 2);
});

test('reject invalid names, text, cursors and limits without mutating or truncating', t => {
    const f = fixture(t),
        a = f.open('Ashlar');
    for (const name of ['', 'a'.repeat(17), 'has space', '../peer', 'bad-name', 'é', 'Moss\n', 'Moss\r', 4, null]) {
        assert.throws(() => new MailboxStore(f.file, name), TypeError);
        assert.throws(() => a.sendDM(name, 'hi'), TypeError);
        assert.throws(() => a.receiveChat(name, 'hi'), TypeError);
        if (name !== '') assert.throws(() => a.readDMs(name), TypeError);
    }
    for (const value of ['', '   ', '\n', 'x'.repeat(2001), null, 3, {}]) {
        assert.throws(() => a.sendDM('Moss', value), TypeError);
        assert.throws(() => a.receiveChat('Human', value), TypeError);
    }
    for (const cursor of [-2, 0.1, NaN, Infinity, '0', null, Number.MAX_SAFE_INTEGER + 1]) {
        assert.throws(() => a.readDMs('', cursor), TypeError);
        assert.throws(() => a.readChat(cursor === -2 ? -3 : cursor), TypeError);
    }
    for (const limit of [0, -1, 51, 1.2, '20', null, NaN]) {
        assert.throws(() => a.readDMs('', -1, limit), TypeError);
        assert.throws(() => a.readChat(-1, limit), TypeError);
    }
    const payload = 'x'.repeat(1997) + '  \n';
    a.sendDM('Ashlar', payload);
    a.receiveChat('Human', payload);
    assert.equal(a.readDMs().messages[0].text, payload);
    assert.equal(a.readChat().messages[0].text, payload);
});

function child(code, args) {
    return new Promise((resolve, reject) => {
        const proc = spawn(process.execPath, ['--input-type=module', '-e', code, ...args], {
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let out = '',
            err = '';
        proc.stdout.on('data', b => (out += b));
        proc.stderr.on('data', b => (err += b));
        proc.on('error', reject);
        proc.on('close', status => (status === 0 ? resolve(out) : reject(new Error(`child exit ${status}: ${err}`))));
    });
}

const moduleUrl = new URL('../../src/comms/mailbox-store.js', import.meta.url).href;

test('cross-process concurrent first opens and senders retain every receipt', async t => {
    const f = fixture(t);
    const code = `
        import { MailboxStore } from ${JSON.stringify(moduleUrl)};
        const [file, name, start] = process.argv.slice(1);
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(0, Number(start) - Date.now()));
        const box = new MailboxStore(file, name);
        for (let i = 0; i < 80; i++) {
            box.sendDM('Ashlar', name + ':' + i);
            box.receiveChat('Human', name + ':' + i);
        }
        box.close();
    `;
    const start = String(Date.now() + 300);
    const runs = await Promise.allSettled(
        ['Moss', 'Rove', 'Flint', 'Wren'].map(name => child(code, [f.file, name, start])),
    );
    for (const run of runs) assert.equal(run.status, 'fulfilled', run.reason?.stack);
    const a = f.open('Ashlar');
    const received = [];
    for (;;) {
        const page = a.readDMs('', -1, 50);
        received.push(...page.messages);
        if (!page.hasMore) break;
    }
    assert.equal(received.length, 320);
    assert.equal(new Set(received.map(m => m.id)).size, 320);
    assert.equal(new Set(received.map(m => m.text)).size, 320);
    assert.equal(a.readChat().messages.length, 0);
    assert.match(f.open('Moss').summary(), /public chat: 80/);
});

test('concurrent readers of one mailbox do not both consume the same unread rows', async t => {
    const f = fixture(t),
        b = f.open('Moss');
    for (let i = 0; i < 80; i++) b.sendDM('Ashlar', String(i));
    const code = `
        import { MailboxStore } from ${JSON.stringify(moduleUrl)};
        const box = new MailboxStore(process.argv[1], 'Ashlar');
        const ids = box.readDMs('', -1, 50).messages.map(m => m.id);
        console.log(JSON.stringify(ids));
        box.close();
    `;
    const results = await Promise.all([child(code, [f.file]), child(code, [f.file])]);
    const ids = results.flatMap(result => JSON.parse(result));
    assert.equal(ids.length, 80);
    assert.equal(new Set(ids).size, 80);
});

test('public max-size pages never acknowledge the lookahead row', t => {
    const f = fixture(t),
        a = f.open('Ashlar');
    for (let i = 0; i < 51; i++) a.receiveChat('Human', `chat ${i}`);
    const first = a.readChat(-1, 50);
    assert.equal(first.messages.length, 50);
    assert.equal(first.hasMore, true);
    assert.match(a.summary(), /public chat: 1/);
    const last = a.readChat();
    assert.deepEqual(text(last), ['chat 50']);
    assert.equal(last.hasMore, false);
    assert.deepEqual(a.readChat(last.nextAfter), { messages: [], nextAfter: last.nextAfter, hasMore: false });
});

test('failed read transaction rolls back all acknowledgements', t => {
    const f = fixture(t),
        a = f.open('Ashlar'),
        b = f.open('Moss');
    b.sendDM('Ashlar', 'first');
    const second = b.sendDM('Ashlar', 'second');
    const db = new DatabaseSync(f.file);
    try {
        db.exec(`CREATE TRIGGER fail_receipt BEFORE INSERT ON mailbox_dm_reads
            WHEN NEW.message_id = ${second} BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;`);
        assert.throws(() => a.readDMs(), /synthetic failure/);
        assert.match(a.summary(), /Moss=2/);
        db.exec('DROP TRIGGER fail_receipt');
        assert.deepEqual(text(a.readDMs()), ['first', 'second']);
    } finally {
        db.close();
    }
});

test('a whisper from a player lands in the mailbox and read_dms returns it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mailbox-whisper-'));
    const box = new MailboxStore(join(dir, 'mailbox.sqlite'), 'Agent');
    box.receiveDM('Steve', 'can you build a door?');
    assert.match(box.summary(), /Unread DMs: Steve=1/);
    const { messages } = box.readDMs('', -1, 20);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].sender, 'Steve');
    assert.equal(messages[0].recipient, 'Agent');
    assert.match(box.summary(), /Unread DMs: 0/);
    box.close();
});
