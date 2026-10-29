import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
const require = createRequire(import.meta.url);
const { Physics, PlayerState } = require('prismarine-physics');
export const VANILLA_TPS = 20;
export function paceBot(bot, { tickRate = VANILLA_TPS, emit = () => {}, simulate } = {}) {
    if (!(tickRate > 0 && tickRate <= VANILLA_TPS)) throw Error('invalid_tick_rate');
    const world = { getBlock: p => bot.blockAt(p, false) };
    let physics = null;
    const state = { tickRate, frozen: false, source: 'config', steps: 0, dropped: 0 };
    let last = performance.now(),
        acc = 0,
        timer = null;
    const paced = () => state.tickRate < VANILLA_TPS || state.frozen;
    const apply = () => {
        bot.physicsEnabled = !paced();
        last = performance.now();
        acc = 0;
        emit('tick_pace', { ...state, paced: paced(), stepMs: 1000 / state.tickRate });
    };
    const step = () => {
        if (!paced()) return;
        if (bot.physicsEnabled) bot.physicsEnabled = false;
        const now = performance.now(),
            ms = 1000 / state.tickRate;
        acc += now - last;
        last = now;
        if (state.frozen) {
            acc = 0;
            return;
        }
        if (acc < ms) return;
        const extra = Math.floor(acc / ms) - 1;
        if (extra > 0) state.dropped += extra;
        acc = acc % ms;
        if (!bot.entity || bot.blockAt(bot.entity.position) == null) return;
        if (simulate) simulate();
        else {
            physics ??= Physics(bot.registry, world);
            physics.simulatePlayer(new PlayerState(bot, bot.controlState), world).apply(bot);
        }
        state.steps++;
        bot.emit('physicsTick');
    };
    const onTick = p => {
        const r = Number(p.tick_rate ?? p.tickRate);
        if (!Number.isFinite(r)) return;
        state.tickRate = Math.min(VANILLA_TPS, Math.max(1, r));
        state.frozen = !!(p.is_frozen ?? p.isFrozen);
        state.source = 'server';
        apply();
    };
    bot._client.on('set_ticking_state', onTick);
    let baseDig = null;
    const wrapDig = () => {
        if (baseDig || !bot.digTime) return;
        baseDig = bot.digTime;
        bot.digTime = block => Math.round((baseDig(block) * VANILLA_TPS) / state.tickRate);
    };
    wrapDig();
    bot.once('login', wrapDig);
    timer = setInterval(step, 5);
    apply();
    return {
        state,
        tickMs: () => 1000 / state.tickRate,
        scale: () => state.tickRate / VANILLA_TPS,
        close() {
            clearInterval(timer);
            bot._client.removeListener('set_ticking_state', onTick);
            if (baseDig) bot.digTime = baseDig;
            bot.physicsEnabled = true;
        },
    };
}
