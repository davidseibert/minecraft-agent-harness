import net from 'node:net';
export function sharedExecCall(socketPath, req, { signal, waitMs } = {}) {
    return new Promise((resolve, reject) => {
        const s = net.connect(socketPath);
        let buf = '';
        s.setEncoding('utf8');
        const t = setTimeout(() => {
            s.destroy();
            reject(new Error('shared machine did not answer'));
        }, waitMs);
        const onAbort = () => {
            clearTimeout(t);
            s.destroy();
            reject(Object.assign(new Error('Tool cancelled'), { name: 'AbortError' }));
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        s.on('connect', () => s.write(JSON.stringify(req) + '\n'));
        s.on('data', d => {
            buf += d;
        });
        s.on('end', () => {
            clearTimeout(t);
            signal?.removeEventListener('abort', onAbort);
            try {
                resolve(JSON.parse(buf));
            } catch {
                reject(new Error('shared machine gave no result'));
            }
        });
        s.on('error', e => {
            clearTimeout(t);
            reject(new Error(`shared machine unavailable (${e.code ?? 'error'})`));
        });
    });
}
export function createSharedExecTool({ socketPath, agentName, record = () => {}, sharedPath = '/shared', vm = true }) {
    return {
        name: 'shared_exec',
        label: 'shared exec',
        description: vm
            ? `Run a bash command on the Linux VM you share with the other agents. It is a full machine with a persistent disk, internet access and root (sudo): install packages, run scripts, keep files. Working directory ${sharedPath} (plans/, notes/, tools/, README.md); everyone can read and write it, and ${sharedPath}/log records every command with its author. It cannot see or control the game. Returns stdout, stderr and exit code. timeout is seconds (1-120, default 30).`
            : `Run a bash command on the machine you share with the other agents: run scripts and keep files. Working directory ${sharedPath} (plans/, notes/, tools/, README.md); everyone can read and write it, and ${sharedPath}/log records every command with its author. It cannot see or control the game. Returns stdout, stderr and exit code. timeout is seconds (1-120, default 30).`,
        parameters: {
            type: 'object',
            additionalProperties: false,
            required: ['command'],
            properties: {
                command: { type: 'string', minLength: 1, maxLength: 8000 },
                timeout: { type: 'integer', minimum: 1, maximum: 120 },
            },
        },
        async execute(_id, args, signal) {
            const timeout = Number.isInteger(args?.timeout) ? Math.min(Math.max(args.timeout, 1), 120) : 30;
            const command = typeof args?.command === 'string' ? args.command : '';
            const started = Date.now();
            let res,
                ok = false;
            try {
                if (!command.trim() || command.length > 8000) throw new Error('command must be 1-8000 characters');
                res = await sharedExecCall(
                    socketPath,
                    { agent: agentName, command, timeout },
                    { signal, waitMs: (timeout + 90) * 1000 },
                );
                if (res.error) throw new Error(res.error);
                ok = true;
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                exit_code: res.exitCode,
                                signal: res.signal ?? undefined,
                                timed_out: res.timedOut || undefined,
                                stdout: res.stdout,
                                stderr: res.stderr,
                                truncated: res.truncated || undefined,
                            }),
                        },
                    ],
                    details: { exitCode: res.exitCode },
                };
            } finally {
                record('shared_exec', {
                    command: command.slice(0, 2000),
                    timeout,
                    ok,
                    exitCode: res?.exitCode ?? null,
                    timedOut: res?.timedOut === true,
                    outBytes: (res?.stdout?.length ?? 0) + (res?.stderr?.length ?? 0),
                    ms: Date.now() - started,
                });
            }
        },
    };
}
