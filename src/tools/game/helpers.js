import { abortError, failWith } from './failures.js';
import { SAFE_DROP } from './guards.js';
import { requireFunction, untilAbort } from './runtime.js';

export function createHelpers(ctx) {
    const { perception, world } = ctx;
    function stallWatch(active, windowMs = 4000) {
        const samples = [];
        const w = { stalled: false, at: null };
        const iv = setInterval(() => {
            const p = active.entity?.position;
            if (!p) return;
            const now = Date.now();
            samples.push({ t: now, x: p.x, y: p.y, z: p.z });
            while (samples.length && now - samples[0].t > windowMs) samples.shift();
            if (now - samples[0].t < windowMs - 700) return;
            if (active.pathfinder?.isMining?.()) {
                samples.length = 0;
                return;
            }
            const xs = samples.map(s => s.x),
                zs = samples.map(s => s.z),
                ys = samples.map(s => s.y);
            const h = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
            if (h < 0.6 && Math.max(...ys) - Math.min(...ys) > 0.3 && ys[ys.length - 1] - ys[0] < 0.5) {
                w.stalled = true;
                w.at = `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`;
                clearInterval(iv);
                try {
                    active.pathfinder.setGoal(null);
                    active.pathfinder.stop();
                } catch {}
            }
        }, 250);
        w.stop = () => clearInterval(iv);
        return w;
    }
    function progressWatch(active, target, { idleMs = 15000, noGainMs = 45000 } = active.pi_goWatch ?? {}) {
        const w = { stalled: null };
        const dist = p => Math.hypot(p.x - target.x, p.y - target.y, p.z - target.z);
        const p0 = active.entity?.position;
        let still = p0 && { x: p0.x, y: p0.y, z: p0.z, t: Date.now() },
            best = p0 ? dist(p0) : Infinity,
            bestT = Date.now();
        const iv = setInterval(() => {
            const p = active.entity?.position;
            if (!p) return;
            const now = Date.now();
            const mining = Boolean(active.pathfinder?.isMining?.() || active.targetDigBlock);
            if (mining || !still || Math.hypot(p.x - still.x, p.y - still.y, p.z - still.z) > 0.5)
                still = { x: p.x, y: p.y, z: p.z, t: now };
            const d = dist(p);
            if (d < best - 0.75) {
                best = d;
                bestT = now;
            }
            const why = now - still.t >= idleMs ? 'idle' : now - bestT >= noGainMs ? 'no_gain' : null;
            if (why) {
                w.stalled = { why, seconds: Math.round((now - (why === 'idle' ? still.t : bestT)) / 1000) };
                clearInterval(iv);
                try {
                    active.pathfinder.setGoal(null);
                    active.pathfinder.stop();
                } catch {}
            }
        }, 500);
        w.stop = () => clearInterval(iv);
        return w;
    }
    function goToHint(active, a) {
        try {
            const p = active.entity.position,
                fx = Math.floor(p.x),
                fy = Math.floor(p.y + 0.01),
                fz = Math.floor(p.z);
            const feet = at(active, a.x, a.y, a.z),
                head = at(active, a.x, a.y + 1, a.z),
                floor = at(active, a.x, a.y - 1, a.z);
            const solid = b => b?.boundingBox === 'block';
            const xyz = `${a.x},${a.y},${a.z}`;
            if (Math.abs(a.x - fx) <= 1 && Math.abs(a.z - fz) <= 1 && a.y < fy)
                return `The target is below you; go_to will not dig out the floor you stand on. To go down, dig a staircase: break_area the 1-wide, 3-high slice one block forward and one lower, step into it with go_to, and repeat.`;
            if (!feet) return `The target ${xyz} is not loaded; go_to a nearer waypoint first.`;
            if (solid(feet) || solid(head)) {
                const b = solid(feet) ? feet : head;
                return `The target ${xyz} is inside solid ${b.name} (go_to needs 2 open blocks to stand in). Aim at an open cell next to it, or break_block / break_area it first.`;
            }
            if (!solid(floor) && !['water', 'lava'].includes(floor?.name))
                return `There is nothing to stand on at ${xyz} (${floor?.name ?? 'unloaded'} below it). Aim at an open cell directly above solid ground.`;
            return null;
        } catch {
            return null;
        }
    }
    async function withDeadline(active, promise, ms) {
        let timer;
        try {
            return await Promise.race([
                promise,
                new Promise((_, reject) => {
                    timer = setTimeout(() => reject(new Error(`gave up after ${ms / 1000}s`)), ms);
                }),
            ]);
        } catch (error) {
            try {
                active.pathfinder.setGoal(null);
                active.pathfinder.stop();
            } catch {}
            throw error;
        } finally {
            clearTimeout(timer);
        }
    }
    async function pickupDrops(active, pos, goals, signal, { radius = 6, ms = 8000, max = 10 } = {}) {
        const until = Date.now() + ms,
            tried = new Set();
        await new Promise(r => setTimeout(r, 600));
        for (let i = 0; i < max && Date.now() < until && !signal?.aborted; i++) {
            const me = active.entity.position;
            const drop = Object.values(active.entities ?? {})
                .filter(
                    e =>
                        e.name === 'item' &&
                        !tried.has(e.id) &&
                        e.position?.distanceTo(pos) < radius &&
                        e.position.y > me.y - SAFE_DROP - 0.5,
                )
                .sort((p, q) => p.position.distanceTo(me) - q.position.distanceTo(me))[0];
            if (!drop) return;
            tried.add(drop.id);
            const d = drop.position;
            try {
                await withDeadline(
                    active,
                    active.pathfinder.goto(new goals.GoalBlock(Math.floor(d.x), Math.floor(d.y), Math.floor(d.z))),
                    Math.max(500, Math.min(3000, until - Date.now())),
                );
            } catch {
                continue;
            }
            await new Promise(r => setTimeout(r, 200));
        }
    }
    const replaceable = [
        'air',
        'cave_air',
        'void_air',
        'water',
        'lava',
        'grass',
        'short_grass',
        'tall_grass',
        'snow',
        'dead_bush',
        'fern',
        'leaf_litter',
    ];
    const DIRS = {
        bottom: [0, -1, 0],
        top: [0, 1, 0],
        north: [0, 0, -1],
        south: [0, 0, 1],
        east: [1, 0, 0],
        west: [-1, 0, 0],
    };
    const solidSupport = b => b?.boundingBox === 'block' && b.shapes?.length > 0 && !replaceable.includes(b.name);
    const at = (active, x, y, z) =>
        active.blockAt(
            active.entity.position.offset(
                x - active.entity.position.x,
                y - active.entity.position.y,
                z - active.entity.position.z,
            ),
        );
    const r2 = v => Math.round(v * 100) / 100;
    const passable = b => b && replaceable.includes(b.name);
    const cellKey = c => `${c.x},${c.y},${c.z}`;
    let pfModule;
    async function pathfinderModule() {
        if (!pfModule) {
            const pf = await import('mineflayer-pathfinder');
            pfModule = pf.default ?? pf;
        }
        return pfModule;
    }
    const invCount = (active, n) =>
        active.inventory
            .items()
            .filter(i => i.name === n)
            .reduce((s, i) => s + i.count, 0);
    const nearestBlock = (active, names, range) =>
        requireFunction(world, 'getNearestBlocks')(active, names, range, 8)[0] ?? null;
    const xyz = b => ({ x: b.position.x, y: b.position.y, z: b.position.z });
    const sleepAbortable = (ms, signal) => untilAbort(new Promise(r => setTimeout(r, ms)), signal);
    async function reachBlock(active, b, signal) {
        const sees = blk => requireFunction(perception, 'isBlockVisible')(active, blk, 4.5);
        if (sees(b)) return b;
        const { Movements, goals } = await pathfinderModule();
        const onAbort = () => {
            try {
                active.pathfinder.setGoal(null);
                active.pathfinder.stop();
            } catch {}
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        let pathError = null;
        try {
            active.pathfinder.setMovements(new Movements(active));
            try {
                await withDeadline(
                    active,
                    active.pathfinder.goto(new goals.GoalLookAtBlock(b.position, active.world, { reach: 4 })),
                    40000,
                );
            } catch (error) {
                if (signal?.aborted) throw signal.reason ?? abortError('Tool cancelled');
                pathError = error;
                try {
                    await withDeadline(
                        active,
                        active.pathfinder.goto(new goals.GoalNear(b.position.x, b.position.y, b.position.z, 2)),
                        15000,
                    );
                } catch {
                    if (signal?.aborted) throw signal.reason ?? abortError('Tool cancelled');
                }
            }
        } finally {
            signal?.removeEventListener('abort', onAbort);
        }
        const centre = b.position.offset(0.5, 0.5, 0.5);
        for (let i = 0; i < 3; i++) {
            const fresh = active.blockAt(b.position) ?? b;
            if (sees(fresh)) return fresh;
            try {
                await active.lookAt(centre, true);
            } catch {}
            await sleepAbortable(400, signal);
        }
        const p = xyz(b);
        const rise = p.y - Math.floor(active.entity.position.y);
        const hint =
            rise > 3
                ? {
                      next: `it is ${rise} blocks above your feet; build up next to it (place blocks under yourself) until it is within 4 blocks, then retry`,
                  }
                : rise < -3
                  ? { next: `it is ${-rise} blocks below your feet; dig or walk down toward it, then retry` }
                  : {};
        if (pathError)
            throw failWith(
                'no_path',
                `Cannot walk to a spot with a view of the ${b.name} at ${p.x},${p.y},${p.z} (${String(pathError?.message ?? pathError).slice(0, 60)})`,
                { target: p, ...hint },
            );
        throw failWith(
            'not_visible_or_range',
            `Walked toward the ${b.name} at ${p.x},${p.y},${p.z} but it is still not visible within reach`,
            { target: p },
        );
    }
    return {
        DIRS,
        at,
        cellKey,
        goToHint,
        invCount,
        nearestBlock,
        passable,
        pathfinderModule,
        pickupDrops,
        progressWatch,
        r2,
        reachBlock,
        replaceable,
        sleepAbortable,
        solidSupport,
        stallWatch,
        withDeadline,
        xyz,
    };
}
