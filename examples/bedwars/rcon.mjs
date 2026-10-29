import net from 'node:net';

export class Rcon {
    constructor({ host = '127.0.0.1', port = 25575, password }) {
        Object.assign(this, {
            host,
            port,
            password,
            socket: null,
            nextId: 1,
            pending: new Map(),
            buffer: Buffer.alloc(0),
        });
        this.queue = Promise.resolve();
    }

    async connect() {
        this.socket = await new Promise((resolve, reject) => {
            const socket = net.createConnection({ host: this.host, port: this.port }, () => resolve(socket));
            socket.once('error', reject);
        });
        this.socket.on('data', chunk => this.onData(chunk));
        this.socket.on('close', () => {
            for (const { reject } of this.pending.values()) reject(new Error('RCON connection closed'));
            this.pending.clear();
            this.socket = null;
        });
        this.socket.on('error', () => {});
        const auth = await this.request(3, this.password);
        if (auth.id === -1) throw new Error('RCON password rejected');
    }

    onData(chunk) {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        while (this.buffer.length >= 4) {
            const length = this.buffer.readInt32LE(0);
            if (this.buffer.length < length + 4) return;
            const id = this.buffer.readInt32LE(4);
            const body = this.buffer.toString('utf8', 12, length + 2);
            this.buffer = this.buffer.subarray(length + 4);
            const waiter = this.pending.get(id) ?? (id === -1 ? [...this.pending.values()][0] : undefined);
            if (waiter) {
                this.pending.delete(id === -1 ? [...this.pending.keys()][0] : id);
                waiter.resolve({ id, body });
            }
        }
    }

    request(type, body) {
        const id = this.nextId++;
        const payload = Buffer.from(body, 'utf8');
        const packet = Buffer.alloc(14 + payload.length);
        packet.writeInt32LE(10 + payload.length, 0);
        packet.writeInt32LE(id, 4);
        packet.writeInt32LE(type, 8);
        payload.copy(packet, 12);
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error('RCON request timed out'));
            }, 10000);
            this.pending.set(id, {
                resolve: value => {
                    clearTimeout(timer);
                    resolve(value);
                },
                reject: error => {
                    clearTimeout(timer);
                    reject(error);
                },
            });
            this.socket.write(packet);
        });
    }

    send(command) {
        const run = async () => {
            if (!this.socket) await this.connect();
            return (await this.request(2, command)).body.replace(/§./g, '').trim();
        };
        const result = this.queue.then(run, run);
        this.queue = result.catch(() => {});
        return result;
    }

    close() {
        this.socket?.end();
    }
}
