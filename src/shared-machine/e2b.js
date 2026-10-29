import fs from 'node:fs';
import { OUT_CAP, sharedReadme, logEntry, serveSharedMachine } from './server.js';

const LIFE = 4 * 3600000;

export async function startE2bSharedMachine({
    socketPath,
    statePath,
    seedPath,
    peers = [],
    apiKey,
    cohort = '',
    log = console.log,
}) {
    const { Sandbox } = await import('e2b');
    let sbx;
    const sh = async (cmd, sec, agent = 'system', cwd = '/shared') => {
        const started = Date.now();
        try {
            const r = await sbx.commands.run(cmd, {
                cwd,
                timeoutMs: sec * 1000,
                envs: { AGENT: agent, HOME: '/shared' },
            });
            return { exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr, ms: Date.now() - started };
        } catch (e) {
            if (typeof e?.exitCode === 'number')
                return {
                    exitCode: e.exitCode,
                    stdout: e.stdout ?? '',
                    stderr: e.stderr ?? '',
                    ms: Date.now() - started,
                };
            const timedOut = /timeout|deadline/i.test(String(e?.message));
            return {
                exitCode: timedOut ? 124 : null,
                timedOut,
                stdout: '',
                stderr: String(e?.message ?? e).slice(0, 500),
                ms: Date.now() - started,
            };
        }
    };
    let id;
    try {
        id = JSON.parse(fs.readFileSync(statePath, 'utf8')).sandboxId;
    } catch {}
    if (id) {
        try {
            sbx = await Sandbox.connect(id, { apiKey });
            await sbx.setTimeout(LIFE);
            log(`shared machine reconnected ${id}`);
        } catch (e) {
            log(`shared machine reconnect failed: ${e.message}`);
            sbx = null;
        }
    }
    if (!sbx) {
        sbx = await Sandbox.create({ apiKey, timeoutMs: LIFE, metadata: { role: 'shared', cohort } });
        fs.writeFileSync(statePath, JSON.stringify({ sandboxId: sbx.sandboxId, created: new Date().toISOString() }));
        log(`shared machine created ${sbx.sandboxId}`);
        await sh(
            'sudo mkdir -p /shared/plans /shared/notes /shared/tools && sudo chmod -R 777 /shared && touch /shared/log',
            60,
            'system',
            '/',
        );
        if (seedPath && fs.existsSync(seedPath)) {
            await sbx.files.write('/tmp/seed.b64', fs.readFileSync(seedPath, 'utf8'));
            await sh('cd /shared && base64 -d /tmp/seed.b64 | tar xzf - 2>&1; ls -la /shared', 60);
        }
        await sbx.files.write('/shared/README.md', sharedReadme(peers, { vm: true }));
    }
    const clip = s => (s.length > OUT_CAP ? [s.slice(0, OUT_CAP), true] : [s, false]);
    const run = async req => {
        const r = await sh(req.command, req.timeout, req.agent);
        const [o, ot] = clip(r.stdout),
            [e, et] = clip(r.stderr);
        const entry = logEntry(Date.now() - r.ms, req, r);
        sh(`printf %s ${Buffer.from(entry).toString('base64')} | base64 -d >> /shared/log`, 20).catch(() => {});
        return { exitCode: r.exitCode, timedOut: r.timedOut, stdout: o, stderr: e, truncated: ot || et, ms: r.ms };
    };
    const server = await serveSharedMachine({ socketPath, run, concurrency: 6 });
    return Object.assign(server, { sandboxId: sbx.sandboxId });
}
