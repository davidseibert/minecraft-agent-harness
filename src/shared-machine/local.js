import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { OUT_CAP, sharedReadme, logEntry, serveSharedMachine } from './server.js';

export async function startLocalSharedMachine({ socketPath, root, peers = [] }) {
    for (const d of ['plans', 'notes', 'tools']) fs.mkdirSync(path.join(root, d), { recursive: true });
    const readme = path.join(root, 'README.md');
    if (!fs.existsSync(readme)) fs.writeFileSync(readme, sharedReadme(peers, { root }));
    const logFile = path.join(root, 'log');
    fs.appendFileSync(logFile, '');
    const clip = (b, n) =>
        b.length > n
            ? { text: b.subarray(0, n).toString('utf8'), truncated: true }
            : { text: b.toString('utf8'), truncated: false };
    const run = req =>
        new Promise(resolve => {
            const started = Date.now();
            const child = spawn('/bin/bash', ['-c', req.command], {
                cwd: root,
                detached: true,
                stdio: ['ignore', 'pipe', 'pipe'],
                env: {
                    PATH: '/usr/local/bin:/usr/bin:/bin',
                    HOME: root,
                    LANG: 'C.UTF-8',
                    TERM: 'dumb',
                    AGENT: req.agent,
                    TMPDIR: '/tmp',
                },
            });
            const bufs = { stdout: [], stderr: [] },
                sizes = { stdout: 0, stderr: 0 };
            for (const k of ['stdout', 'stderr'])
                child[k].on('data', d => {
                    if (sizes[k] <= OUT_CAP) bufs[k].push(d);
                    sizes[k] += d.length;
                });
            let timedOut = false;
            const t = setTimeout(() => {
                timedOut = true;
                try {
                    process.kill(-child.pid, 'SIGKILL');
                } catch {}
            }, req.timeout * 1000);
            child.on('close', (code, signal) => {
                clearTimeout(t);
                try {
                    process.kill(-child.pid, 'SIGKILL');
                } catch {}
                const o = clip(Buffer.concat(bufs.stdout), OUT_CAP),
                    e = clip(Buffer.concat(bufs.stderr), OUT_CAP);
                const res = {
                    exitCode: code,
                    signal,
                    timedOut,
                    stdout: o.text,
                    stderr: e.text,
                    truncated: o.truncated || e.truncated,
                    ms: Date.now() - started,
                };
                try {
                    fs.appendFileSync(logFile, logEntry(started, req, res));
                } catch {}
                resolve(res);
            });
            child.on('error', err => {
                clearTimeout(t);
                resolve({
                    exitCode: null,
                    error: String(err.message).slice(0, 200),
                    stdout: '',
                    stderr: '',
                    ms: Date.now() - started,
                });
            });
        });
    return serveSharedMachine({ socketPath, run, concurrency: 4 });
}
