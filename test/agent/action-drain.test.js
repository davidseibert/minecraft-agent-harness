import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, sleep, flush } from './drain-fixture.js';
const settle = promise =>
    promise.then(
        value => ({ value }),
        error => ({ error }),
    );

test('timed cleanup: caller waits for both cooperative work and stop controller', async () => {
    const f = await fixture({ settleTimeoutMs: 500 });
    let releaseWork, releaseStop;
    try {
        f.b.pathfinder.stop = () =>
            new Promise(r => {
                releaseStop = r;
            });
        const controller = new AbortController();
        let returned = false;
        const pending = settle(
            f.action.run(
                'slow',
                () =>
                    new Promise(r => {
                        releaseWork = r;
                    }),
                { signal: controller.signal },
            ),
        ).then(x => {
            returned = true;
            return x;
        });
        await flush();
        controller.abort();
        await flush();
        assert.equal(returned, false);
        releaseWork();
        await flush();
        assert.equal(returned, false);
        releaseStop();
        const outcome = await pending;
        assert.equal(outcome.error.name, 'AbortError');
        assert.equal(f.action.status.active, null);
        assert.equal(f.action.status.blocked, false);
    } finally {
        f.b.pathfinder.stop = () => {};
        releaseWork?.();
        releaseStop?.();
        await f.close();
    }
});

test('hanging body: cancellation returns only after bounded poison and future work is rejected', async () => {
    let fatals = 0,
        quits = 0;
    const f = await fixture({
        settleTimeoutMs: 40,
        onFatal: () => {
            fatals++;
        },
    });
    f.b.quit = () => {
        quits++;
    };
    try {
        const controller = new AbortController();
        const pending = settle(f.action.run('hung', () => new Promise(() => {}), { signal: controller.signal }));
        await flush();
        const start = Date.now();
        controller.abort();
        const outcome = await pending;
        assert.equal(outcome.error.name, 'AbortError');
        assert.ok(Date.now() - start < 1000);
        assert.equal(f.action.status.blocked, true);
        assert.equal(f.action.status.active, null);
        await assert.rejects(
            f.action.run('later', () => {}),
            /reconnect required/,
        );
        assert.equal(fatals, 1);
        assert.equal(quits, 1);
    } finally {
        await f.close();
    }
});

test('hanging stop controller: no cancellation settlement before finite poison', async () => {
    const f = await fixture({ settleTimeoutMs: 40 });
    try {
        f.b.pathfinder.stop = () => new Promise(() => {});
        const controller = new AbortController();
        const pending = settle(f.action.run('work', async () => sleep(20), { signal: controller.signal }));
        await flush();
        controller.abort();
        await pending;
        assert.equal(f.action.status.blocked, true);
        assert.equal(f.action.status.active, null);
    } finally {
        f.b.pathfinder.stop = () => {};
        await f.close();
    }
});

test('timeout retains reason and poisons finite grace for an uncooperative body', async () => {
    const f = await fixture({ defaultTimeoutMs: 20, settleTimeoutMs: 40 });
    try {
        const start = Date.now();
        await assert.rejects(
            f.action.run('hung', () => new Promise(() => {})),
            /deadline exceeded/,
        );
        assert.equal(f.action.status.blocked, true);
        assert.ok(Date.now() - start < 1000);
    } finally {
        await f.close();
    }
});

test('queued expired action remains prompt, does not stop predecessor, never executes', async () => {
    const f = await fixture();
    let release;
    try {
        const first = f.action.run(
            'first',
            () =>
                new Promise(r => {
                    release = r;
                }),
        );
        await flush();
        let invoked = false;
        await assert.rejects(
            f.action.run(
                'queued',
                () => {
                    invoked = true;
                },
                { timeoutMs: 10 },
            ),
            /deadline/,
        );
        assert.equal(f.action.status.active, 'first');
        assert.equal(f.evidence.stops, 0);
        release();
        await first;
        await flush();
        assert.equal(invoked, false);
    } finally {
        release?.();
        await f.close();
    }
});

test('queued successor starts only after cancelled predecessor has drained', async () => {
    const f = await fixture();
    let release;
    try {
        const controller = new AbortController();
        const order = [];
        const first = settle(
            f.action.run(
                'first',
                async () => {
                    await new Promise(r => {
                        release = r;
                    });
                    order.push('drained');
                },
                { signal: controller.signal },
            ),
        );
        await flush();
        const second = f.action.run('second', () => {
            order.push('second');
        });
        controller.abort();
        await flush();
        assert.deepEqual(order, []);
        release();
        await first;
        await second;
        assert.deepEqual(order, ['drained', 'second']);
        assert.equal(f.action.status.blocked, false);
    } finally {
        release?.();
        await f.close();
    }
});

test('death stop with uncooperative action: session.close completes after finite fatal grace', async () => {
    const f = await fixture({ settleTimeoutMs: 40 });
    try {
        f.b.attack = () => new Promise(() => {});
        f.fake.script = async () => {
            await f.fake.context();
            await f.fake.call('attack', { id: 1, until_dead: true });
        };
        f.runner.start();
        await f.clock.advance();
        assert.equal(f.action.status.active, 'attack');
        const start = Date.now();
        await f.action.stop();
        await f.runner.close();
        assert.ok(Date.now() - start < 1000);
        assert.equal(f.action.status.active, null);
        assert.equal(f.action.status.blocked, true);
        await f.clock.advance(10000);
        assert.equal(f.evidence.prompts, 1);
        assert.equal(f.runner.timer, null);
    } finally {
        await f.close();
    }
});
