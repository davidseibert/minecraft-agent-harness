import { DatabaseSync } from 'node:sqlite';

const NAME = /^[A-Za-z0-9_]{1,16}(?![\s\S])/;

function validName(value) {
    if (typeof value !== 'string' || !NAME.test(value)) {
        throw new TypeError('Minecraft name must contain 1-16 letters, digits, or underscores');
    }
    return value;
}

function validText(value) {
    if (typeof value !== 'string' || !value.trim() || value.length > 2000) {
        throw new TypeError('Message text must be nonblank and at most 2000 characters');
    }
    return value;
}

function enableWAL(db) {
    const deadline = Date.now() + 10000;
    const wait = new Int32Array(new SharedArrayBuffer(4));
    for (;;) {
        try {
            db.exec('PRAGMA journal_mode = WAL');
            return;
        } catch (error) {
            if (error.errcode !== 5 || Date.now() >= deadline) throw error;
            Atomics.wait(wait, 0, 0, 20);
        }
    }
}

function validPage(after, limit, minimumAfter = -1) {
    if (!Number.isSafeInteger(after) || after < minimumAfter) {
        throw new TypeError(
            `after must be ${minimumAfter === -2 ? '-2 (latest), ' : ''}-1 (unread) or a nonnegative safe integer`,
        );
    }
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
        throw new TypeError('limit must be an integer between 1 and 50');
    }
}

export class MailboxStore {
    #db;
    #self;
    #mention;

    constructor(file, self) {
        this.#self = validName(self);
        if (typeof file !== 'string' || !file || file.includes('\0')) {
            throw new TypeError('A database file path is required');
        }
        this.#mention = new RegExp(`(^|[^A-Za-z0-9_@])@${self}(?![A-Za-z0-9_])`, 'i');
        this.#db = new DatabaseSync(file);
        try {
            this.#db.exec('PRAGMA busy_timeout = 10000');
            enableWAL(this.#db);
            this.#db.exec(`
                PRAGMA synchronous = FULL;
                PRAGMA foreign_keys = ON;
            `);
            this.#transaction(() =>
                this.#db.exec(`
                CREATE TABLE IF NOT EXISTS mailbox_dm (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    sender TEXT NOT NULL COLLATE NOCASE,
                    recipient TEXT NOT NULL COLLATE NOCASE,
                    text TEXT NOT NULL,
                    createdAt INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS mailbox_dm_recipient ON mailbox_dm(recipient, id);
                CREATE INDEX IF NOT EXISTS mailbox_dm_sender ON mailbox_dm(sender, id);
                CREATE TABLE IF NOT EXISTS mailbox_dm_reads (
                    owner TEXT NOT NULL COLLATE NOCASE,
                    peer TEXT NOT NULL COLLATE NOCASE,
                    message_id INTEGER NOT NULL REFERENCES mailbox_dm(id),
                    PRIMARY KEY (owner, peer, message_id)
                );
                CREATE TABLE IF NOT EXISTS mailbox_chat (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    observer TEXT NOT NULL COLLATE NOCASE,
                    sender TEXT NOT NULL COLLATE NOCASE,
                    text TEXT NOT NULL,
                    createdAt INTEGER NOT NULL,
                    mention INTEGER NOT NULL,
                    is_read INTEGER NOT NULL DEFAULT 0
                );
                CREATE INDEX IF NOT EXISTS mailbox_chat_observer ON mailbox_chat(observer, id);
            `),
            );
        } catch (error) {
            this.close();
            throw error;
        }
    }

    #transaction(fn) {
        this.#db.exec('BEGIN IMMEDIATE');
        try {
            const result = fn();
            this.#db.exec('COMMIT');
            return result;
        } catch (error) {
            this.#db.exec('ROLLBACK');
            throw error;
        }
    }

    sendDM(to, text) {
        validName(to);
        validText(text);
        const result = this.#db
            .prepare(
                `
            INSERT INTO mailbox_dm (sender, recipient, text, createdAt) VALUES (?, ?, ?, ?)
        `,
            )
            .run(this.#self, to, text, Date.now());
        return Number(result.lastInsertRowid);
    }

    receiveDM(sender, text) {
        validName(sender);
        validText(text);
        const result = this.#db
            .prepare('INSERT INTO mailbox_dm (sender, recipient, text, createdAt) VALUES (?, ?, ?, ?)')
            .run(sender, this.#self, text, Date.now());
        return Number(result.lastInsertRowid);
    }

    receiveChat(sender, text) {
        validName(sender);
        validText(text);
        const result = this.#db
            .prepare(
                `
            INSERT INTO mailbox_chat (observer, sender, text, createdAt, mention, is_read) VALUES (?, ?, ?, ?, ?, ?)
        `,
            )
            .run(
                this.#self,
                sender,
                text,
                Date.now(),
                Number(this.#mention.test(text)),
                Number(sender.toLowerCase() === this.#self.toLowerCase()),
            );
        return Number(result.lastInsertRowid);
    }

    summary() {
        const rows = this.#db
            .prepare(
                `
            SELECT 'dm' AS kind, d.sender AS sender, count(*) AS count, 0 AS mentions
            FROM mailbox_dm d
            WHERE d.recipient = ? AND NOT EXISTS (
                SELECT 1 FROM mailbox_dm_reads r
                WHERE r.owner = d.recipient AND r.peer = d.sender AND r.message_id = d.id
            ) GROUP BY d.sender
            UNION ALL
            SELECT 'chat', '', count(*), coalesce(sum(mention), 0)
            FROM mailbox_chat WHERE observer = ? AND is_read = 0
            ORDER BY kind, sender
        `,
            )
            .all(this.#self, this.#self);
        const chat = rows.find(row => row.kind === 'chat');
        const dms = rows
            .filter(row => row.kind === 'dm')
            .map(row => `${row.sender}=${row.count}`)
            .join(', ');
        return `Unread DMs: ${dms || '0'}; public chat: ${chat.count} (mentions: ${chat.mentions}).`;
    }

    unreadPreview(limit = 10, chars = 200) {
        return this.#db
            .prepare(
                `
            SELECT d.id, d.sender, d.text, d.createdAt FROM mailbox_dm d
            WHERE d.recipient = ? AND NOT EXISTS (
                SELECT 1 FROM mailbox_dm_reads r
                WHERE r.owner = d.recipient AND r.peer = d.sender AND r.message_id = d.id
            ) ORDER BY d.id LIMIT ?
        `,
            )
            .all(this.#self, limit)
            .map(row => ({ ...row, text: row.text.length > chars ? row.text.slice(0, chars) + '…' : row.text }));
    }

    readDMs(peer = '', after = -1, limit = 20) {
        if (peer !== '') validName(peer);
        validPage(after, limit);
        return this.#transaction(() => {
            const where =
                after === -1
                    ? `d.recipient = ? AND NOT EXISTS (
                    SELECT 1 FROM mailbox_dm_reads r
                    WHERE r.owner = d.recipient AND r.peer = d.sender AND r.message_id = d.id
                )`
                    : `(d.sender = ? OR d.recipient = ?) AND d.id > ?`;
            const params = after === -1 ? [this.#self] : [this.#self, this.#self, after];
            const peerFilter =
                peer === '' ? '' : ' AND ((d.sender = ? AND d.recipient = ?) OR (d.sender = ? AND d.recipient = ?))';
            if (peer !== '') params.push(this.#self, peer, peer, this.#self);
            const rows = this.#db
                .prepare(
                    `
                SELECT d.id, d.sender, d.recipient, d.text, d.createdAt FROM mailbox_dm d
                WHERE ${where}${peerFilter} ORDER BY d.id LIMIT ?
            `,
                )
                .all(...params, limit + 1);
            const messages = rows.slice(0, limit).map(row => ({ ...row }));
            const mark = this.#db.prepare(`
                INSERT OR IGNORE INTO mailbox_dm_reads (owner, peer, message_id)
                SELECT recipient, sender, id FROM mailbox_dm WHERE id = ? AND recipient = ?
            `);
            for (const message of messages) mark.run(message.id, this.#self);
            return { messages, nextAfter: messages.at(-1)?.id ?? after, hasMore: rows.length > limit };
        });
    }

    #latestChat(limit, since = 0) {
        return this.#db
            .prepare(
                `
            SELECT id, sender, text, createdAt, mention FROM mailbox_chat
            WHERE observer = ? AND createdAt >= ? ORDER BY id DESC LIMIT ?
        `,
            )
            .all(this.#self, since, limit);
    }

    recentChat() {
        const since = Date.now() - 5 * 60 * 1000;
        const messages = this.#latestChat(6, since)
            .reverse()
            .map(row => ({
                ...row,
                mention: Boolean(row.mention),
                text: row.text.length > 300 ? row.text.slice(0, 300) + '…' : row.text,
            }));
        return { since, messages };
    }

    readChat(after = -1, limit = 20) {
        validPage(after, limit, -2);
        return this.#transaction(() => {
            const where = after === -1 ? 'is_read = 0' : 'id > ?';
            const params = after === -1 ? [this.#self] : [this.#self, after];
            const rows =
                after === -2
                    ? this.#latestChat(limit + 1)
                    : this.#db
                          .prepare(
                              `
                SELECT id, sender, text, createdAt, mention FROM mailbox_chat
                WHERE observer = ? AND ${where} ORDER BY id LIMIT ?
            `,
                          )
                          .all(...params, limit + 1);
            const selected = rows.slice(0, limit);
            if (after === -2) selected.reverse();
            const messages = selected.map(row => ({ ...row, mention: Boolean(row.mention) }));
            const mark = this.#db.prepare('UPDATE mailbox_chat SET is_read = 1 WHERE observer = ? AND id = ?');
            for (const message of messages) mark.run(this.#self, message.id);
            return {
                messages,
                nextAfter: messages.at(-1)?.id ?? after,
                hasMore: after !== -2 && rows.length > limit,
                ...(after === -2 ? { olderAvailable: rows.length > limit } : {}),
            };
        });
    }

    close() {
        if (this.#db) {
            this.#db.close();
            this.#db = undefined;
        }
    }
}
