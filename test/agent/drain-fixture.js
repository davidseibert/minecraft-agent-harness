import { EventEmitter } from 'node:events';
import { createMinecraftSession } from '../../src/model/session.js';
import { createGameTools, createActionRunner } from '../../src/tools/game-tools.js';
import { installDamageWake } from '../../src/body/damage.js';
import { move } from '../../src/skills/survival.js';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const flush = async () => {
    for (let i = 0; i < 100; i++) await Promise.resolve();
};
class Clock {
    time = 100000;
    tasks = new Map();
    seq = 0;
    now = () => this.time;
    setTimeout = (fn, delay) => {
        let id = ++this.seq;
        this.tasks.set(id, { at: this.time + delay, fn });
        return id;
    };
    clearTimeout = id => this.tasks.delete(id);
    async advance(ms = 0) {
        this.time += ms;
        for (let i = 0; i < 100; i++) {
            await flush();
            const x = [...this.tasks].find(([, v]) => v.at <= this.time);
            if (!x) return;
            this.tasks.delete(x[0]);
            x[1].fn();
        }
        throw Error('loop');
    }
}
const vec = (x = 0, y = 64, z = 0) => ({
    x,
    y,
    z,
    distanceTo(p) {
        return Math.hypot(x - p.x, y - p.y, z - p.z);
    },
    offset(a, b, c) {
        return vec(x + a, y + b, z + c);
    },
});
const attachHealth = (bot, runner, actionRunner) => installDamageWake(bot, () => runner, actionRunner);
async function fixture(actionOptions = {}) {
    const b = Object.assign(new EventEmitter(), {
        username: 'Synthetic',
        health: 20,
        food: 20,
        game: { gameMode: 'survival' },
        entity: { position: vec() },
        entities: { 1: { id: 1, position: vec(1) } },
        inventory: { items: () => [], slots: Array(46).fill(null) },
    });
    const evidence = {
        strikes: 0,
        controls: [],
        stops: 0,
        telemetry: [],
        cycles: [],
        observations: [],
        aborts: 0,
        prompts: 0,
    };
    b.pathfinder = {
        setGoal: () => {
            evidence.stops++;
        },
        stop: () => {
            evidence.stops++;
        },
        setMovements: () => {},
    };
    b.clearControlStates = () => evidence.controls.push('clear');
    b.setControlState = (name, value) => evidence.controls.push([name, value]);
    b.attack = () => {
        evidence.strikes++;
    };
    b.lookAt = async () => {};
    const action = createActionRunner(b, actionOptions);
    const tools = createGameTools({
        bot: b,
        actionRunner: action,
        skills: { move },
        perception: { isEntityVisible: () => true },
    });
    const entries = [];
    let installed;
    const clock = new Clock();
    const fake = {
        agent: { transformContext: async x => x },
        subscribe: () => () => {},
        abort: async () => {
            evidence.aborts++;
            fake.controller?.abort();
        },
        waitForIdle: async () => {},
        dispose: () => {},
        script: async () => {},
        prompt: async () => {
            evidence.prompts++;
            fake.controller = new AbortController();
            await fake.script(evidence.prompts);
        },
        context: () => fake.agent.transformContext([], fake.controller.signal),
        call: (name, args) => installed.find(t => t.name === name).execute('synthetic', args, fake.controller.signal),
        thinking: () =>
            new Promise(resolve => {
                if (fake.controller.signal.aborted) resolve();
                else fake.controller.signal.addEventListener('abort', resolve, { once: true });
            }),
    };
    const runner = await createMinecraftSession(
        {
            agentId: 'synthetic',
            cwd: '/synthetic',
            sessionDir: '/synthetic/no-files',
            systemPrompt: 'Synthetic',
            tools,
            observe: async ({ events }) => {
                evidence.observations.push(events);
                return { text: 'synthetic' };
            },
            telemetry: x => evidence.telemetry.push(x),
            cycleTelemetry: x => evidence.cycles.push(x),
        },
        {
            clock,
            createSession: async opts => {
                installed = opts.tools;
                return {
                    session: fake,
                    sessionManager: {
                        getEntries: () => entries,
                        appendCustomEntry: (type, data) => entries.push({ type: 'custom', customType: type, data }),
                    },
                };
            },
        },
    );
    attachHealth(b, runner, action);
    const damage = hp => {
        b.health = hp;
        b.emit('health');
    };
    const close = async () => {
        await runner.close();
        await action.stop();
        await sleep(700);
    };
    return { b, action, runner, clock, fake, evidence, damage, close };
}

export { fixture, sleep, flush, attachHealth };
