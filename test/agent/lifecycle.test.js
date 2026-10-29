import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAgentConfig, safeError, isRefusedLateMutation } from '../../src/lifecycle.js';
import { execFileSync } from 'node:child_process';
const config = () => ({
    host: '127.0.0.1',
    port: 25565,
    auth: 'offline',
    profile: {
        name: 'Test_Agent',
        objective: 'Build one large, shared cobblestone castle.',
        pi: {
            stateRoot: '/a',
            sharedRoot: '/b',
            mailboxPath: '/c/mail.sqlite',
            planPath: '/d/plan.md',
            deadlineAt: '2026-09-22T03:00:00.000Z',
        },
    },
});
test('explicit state paths required; deadline optional but must be in the future', () => {
    assert.equal(validateAgentConfig(config(), 0).deadline, Date.parse('2026-09-22T03:00:00.000Z'));
    assert.throws(() => validateAgentConfig(config(), Date.parse('2026-09-22T03:00:00.000Z')), /passed/);
    const open = config();
    delete open.profile.pi.deadlineAt;
    assert.equal(validateAgentConfig(open, 0).deadline, Infinity);
    for (const field of ['stateRoot', 'sharedRoot', 'mailboxPath', 'planPath']) {
        const s = config();
        s.profile.pi[field] = '../escape';
        assert.throws(() => validateAgentConfig(s, 0), /absolute/);
    }
});
test('profile identity, objective and server address are validated', () => {
    for (const modify of [
        c => (c.profile.name = '../other'),
        c => (c.profile.objective = ''),
        c => {
            c.host = '';
        },
        c => {
            c.port = 'x';
        },
    ]) {
        const c = config();
        modify(c);
        assert.throws(() => validateAgentConfig(c, 0));
    }
    const remote = config();
    remote.host = 'mc.example.com';
    remote.auth = 'microsoft';
    assert.doesNotThrow(() => validateAgentConfig(remote, 0));
});
test('error telemetry cannot expose request or private text', () => {
    const value = safeError({
        name: 'TypeError',
        code: 'ERR_TEST',
        status: 429,
        message: 'SENTINEL_SECRET',
        body: 'SENTINEL_PRIVATE',
    });
    assert.deepEqual(value, { errorName: 'TypeError', errorCode: 'ERR_TEST', httpStatus: 429 });
    assert.equal(safeError({ code: 'secret with spaces' }).errorCode, undefined);
});

test('runtime status exposes only scheduler and gameplay metadata', async () => {
    const { runtimeStatus } = await import('../../src/lifecycle.js');
    const status = runtimeStatus(
        { active: { secret: 'private' }, nextWakeAt: 10000, paused: false, session: 'private' },
        { status: { active: null, blocked: false } },
        {
            health: 20,
            food: 18,
            oxygenLevel: 20,
            time: { timeOfDay: 6000 },
            entity: { position: { x: 1, y: 64, z: 2, secret: 'private' } },
        },
        0,
    );
    assert.equal(status.nextWakeAt, 10000);
    assert.equal(status.activeCycle, true);
    assert.deepEqual(status.position, { x: 1, y: 64, z: 2 });
    assert.equal(JSON.stringify(status).includes('private'), false);
});

test('refused late mutation is recognised only by name AND code, and its code survives safeError', () => {
    const refused = Object.assign(new Error('Native mutation refused: SENTINEL'), {
        name: 'AbortError',
        code: 'LATE_MUTATION_REFUSED',
    });
    assert.equal(isRefusedLateMutation(refused), true);
    assert.equal(isRefusedLateMutation(Object.assign(new Error('x'), { name: 'AbortError' })), false);
    assert.equal(
        isRefusedLateMutation(Object.assign(new Error('x'), { name: 'Error', code: 'LATE_MUTATION_REFUSED' })),
        false,
    );
    assert.equal(isRefusedLateMutation(undefined), false);
    assert.deepEqual(safeError(refused), { errorName: 'AbortError', errorCode: 'LATE_MUTATION_REFUSED' });
});

test('unhandledRejection handler: tagged refusal is recorded and the process lives; anything else still finishes', () => {
    const lifecycle = new URL('../../src/lifecycle.js', import.meta.url).href;
    const script = tagged => `
  import { isRefusedLateMutation, safeError } from ${JSON.stringify(lifecycle)};
  const events=[]; const record=(e,d)=>events.push([e,d]); let finished=null; const finish=r=>{ finished=r; };
  process.on('unhandledRejection', error => {
      if (isRefusedLateMutation(error)) { record('late_mutation_refused', safeError(error)); return; }
      record('unhandled_error', safeError(error)); void finish('unhandled_error');
  });
  const e=Object.assign(new Error('refused'),{name:'AbortError'${tagged ? ',code:"LATE_MUTATION_REFUSED"' : ''}});
  Promise.reject(e); Promise.reject(Object.assign(new Error('second'),{name:'AbortError'${tagged ? ',code:"LATE_MUTATION_REFUSED"' : ''}}));
  setTimeout(()=>{ console.log(JSON.stringify({events,finished})); }, 50);`;
    const run = tagged =>
        JSON.parse(
            execFileSync(process.execPath, ['--input-type=module', '-e', script(tagged)], {
                encoding: 'utf8',
                timeout: 20000,
            }).trim(),
        );
    const ok = run(true);
    assert.deepEqual(ok, {
        events: [
            ['late_mutation_refused', { errorName: 'AbortError', errorCode: 'LATE_MUTATION_REFUSED' }],
            ['late_mutation_refused', { errorName: 'AbortError', errorCode: 'LATE_MUTATION_REFUSED' }],
        ],
        finished: null,
    });
    const bad = run(false);
    assert.equal(bad.finished, 'unhandled_error');
    assert.equal(bad.events[0][0], 'unhandled_error');
});
