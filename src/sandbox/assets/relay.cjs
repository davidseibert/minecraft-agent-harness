const http = require('http');
const [port, token] = [Number(process.argv[2] || 7777), process.argv[3] || ''];
const queue = [];
const waiting = [];
const pending = new Map();
let seq = 0;
const CALL_TIMEOUT = 600000,
    POLL_TIMEOUT = 20000;
const body = req =>
    new Promise((res, rej) => {
        let s = '';
        req.on('data', c => {
            s += c;
            if (s.length > 1e6) req.destroy();
        });
        req.on('end', () => res(s));
        req.on('error', rej);
    });
const send = (res, code, obj) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(obj === undefined ? '' : JSON.stringify(obj));
};
const wake = () => {
    while (queue.length && waiting.length) {
        const w = waiting.shift();
        clearTimeout(w.timer);
        send(w.res, 200, queue.shift());
    }
};
http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/health') return send(res, 200, { ok: true, queued: queue.length, pending: pending.size });
    if (req.headers['x-token'] !== token) return send(res, 401, { error: 'bad token' });
    try {
        if (req.method === 'POST' && url.pathname === '/call') {
            const { name, args } = JSON.parse((await body(req)) || '{}');
            if (typeof name !== 'string') return send(res, 400, { error: 'name required' });
            const id = String(++seq);
            const timer = setTimeout(() => {
                pending.delete(id);
                send(res, 504, { ok: false, error: 'tool call timed out' });
            }, CALL_TIMEOUT);
            pending.set(id, { res, timer });
            queue.push({ id, name, args: args ?? {} });
            wake();
            return;
        }
        if (req.method === 'GET' && url.pathname === '/next') {
            if (queue.length) return send(res, 200, queue.shift());
            const w = {
                res,
                timer: setTimeout(() => {
                    waiting.splice(waiting.indexOf(w), 1);
                    send(res, 204);
                }, POLL_TIMEOUT),
            };
            waiting.push(w);
            req.on('close', () => {
                clearTimeout(w.timer);
                const i = waiting.indexOf(w);
                if (i >= 0) waiting.splice(i, 1);
            });
            return;
        }
        if (req.method === 'POST' && url.pathname === '/result') {
            const r = JSON.parse((await body(req)) || '{}');
            const p = pending.get(String(r.id));
            if (!p) return send(res, 404, { error: 'unknown id' });
            clearTimeout(p.timer);
            pending.delete(String(r.id));
            send(p.res, 200, { ok: !!r.ok, result: r.result, error: r.error });
            return send(res, 200, { ok: true });
        }
        send(res, 404, { error: 'not found' });
    } catch (e) {
        send(res, 500, { error: String((e && e.message) || e) });
    }
}).listen(port, '0.0.0.0', () => console.log(`relay listening ${port}`));
