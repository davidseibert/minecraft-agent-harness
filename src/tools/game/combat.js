import { abortError, failWith } from './failures.js';
import { requireFunction } from './runtime.js';
import { integer, number } from './schema.js';

export function createCombat(ctx) {
    const { add, body, pathfinderModule, perception, r2, sleepAbortable } = ctx;
    add(
        'attack',
        'Fight a visible entity: chases it, aims and swings when in reach, respecting weapon cooldown. Stops when it dies, after `swings` swings, after `seconds` (default 20, max 60), if you lose sight of it for 3s, if chasing takes you more than `max_distance` blocks (default 16) from where you started. It never backs off on its own because of your health; call flee yourself if you want out. Hits from this target do not stop the fight; a hit from anything else, or fire/fall/drowning damage, stops it so you can decide. chase=false: hold your ground and only swing when it is in reach. Equip a weapon first for more damage.',
        {
            id: integer(0, Number.MAX_SAFE_INTEGER),
            swings: integer(1, 100),
            seconds: number(1, 60),
            chase: { type: 'boolean' },
            max_distance: integer(2, 64),
            until_dead: { type: 'boolean' },
        },
        async (a, { bot: active, signal }) => {
            const maxSwings = a.swings ?? (a.until_dead === false ? 1 : Infinity);
            const chase = a.chase !== false,
                maxDist = a.max_distance ?? 16;
            const until = Date.now() + (a.seconds ?? 20) * 1000;
            const start = active.entities[a.id];
            if (!start || start.isValid === false)
                throw failWith('not_found', `Entity ${a.id} is not here (gone, killed or despawned).`);
            const vis = e => requireFunction(perception, 'isEntityVisible')(active, e, 24);
            const face = async e => {
                if (e.position.distanceTo(active.entity.position) <= 24)
                    await active.lookAt(e.position.offset(0, (e.height ?? 1.8) * 0.6, 0), true);
            };
            if (!vis(start)) await face(start);
            if (!vis(start))
                throw failWith(
                    'not_visible_or_range',
                    `Entity ${a.id} is not visible within 24 blocks; get closer or look around first.`,
                );
            const label = start.username ?? start.displayName ?? start.name ?? 'target';
            const origin = active.entity.position.offset(0, 0, 0);
            const { goals, Movements } = await pathfinderModule();
            const stopPath = () => {
                try {
                    active.pathfinder.setGoal(null);
                } catch {}
            };
            signal?.addEventListener('abort', stopPath, { once: true });
            let swings = 0,
                landed = 0,
                died = false,
                lastStrike = 0,
                lastSeen = Date.now(),
                following = false,
                outcome = null;
            const onHurt = e => {
                if (e?.id === a.id) landed++;
            };
            const onDead = e => {
                if (e?.id === a.id) died = true;
            };
            active.on?.('entityHurt', onHurt);
            active.on?.('entityDead', onDead);
            active.pi_attackTargetId = a.id;
            active.pi_attackStop = null;
            try {
                while (!signal?.aborted && Date.now() < until) {
                    if (active.pi_attackStop) {
                        outcome = active.pi_attackStop;
                        break;
                    }
                    const e = active.entities[a.id];
                    if (!e || e.isValid === false) {
                        outcome = died || swings ? 'killed' : 'gone';
                        break;
                    }
                    if (swings >= maxSwings) {
                        outcome = 'swings';
                        break;
                    }
                    let seen = vis(e);
                    if (!seen) {
                        await face(e);
                        seen = vis(e);
                    }
                    if (seen) lastSeen = Date.now();
                    else if (Date.now() - lastSeen > 3000) {
                        outcome = 'lost_sight';
                        break;
                    }
                    if (chase && active.entity.position.distanceTo(origin) > maxDist) {
                        outcome = 'too_far';
                        break;
                    }
                    const eye = active.entity.position.offset(0, active.entity.height ?? 1.62, 0);
                    const aim = e.position.offset(0, (e.height ?? 1.8) * 0.6, 0);
                    const dist = eye.distanceTo(aim);
                    if (dist > 3.0) {
                        if (chase && !following) {
                            active.pathfinder.setMovements(new Movements(active));
                            active.pathfinder.setGoal(new goals.GoalFollow(e, 1.5), true);
                            following = true;
                        }
                    } else {
                        if (following) {
                            stopPath();
                            following = false;
                        }
                        await active.lookAt(aim, true);
                        if (Date.now() - lastStrike >= 625 && seen) {
                            await requireFunction(active, 'attack')(e);
                            swings++;
                            lastStrike = Date.now();
                        }
                    }
                    await sleepAbortable(50, signal);
                }
            } finally {
                stopPath();
                signal?.removeEventListener('abort', stopPath);
                active.removeListener?.('entityHurt', onHurt);
                active.removeListener?.('entityDead', onDead);
                active.pi_attackTargetId = null;
                active.pi_attackStop = null;
            }
            if (signal?.aborted) throw signal.reason ?? abortError('Tool cancelled');
            const e = active.entities[a.id];
            const alive = e && e.isValid !== false;
            const hp = alive ? (e.health ?? e.metadata?.[9]) : null;
            if (died || hp === 0) outcome = 'killed';
            const result = {
                target: label,
                id: a.id,
                swings,
                landed,
                targetDied: died || outcome === 'killed',
                stoppedBecause: outcome ?? 'timeout',
                ...(alive
                    ? {
                          distanceNow: r2(active.entity.position.distanceTo(e.position)),
                          ...(typeof hp === 'number' ? { targetHealth: r2(hp) } : {}),
                      }
                    : {}),
                yourHealth: active.health,
            };
            if (!swings && outcome !== 'gone')
                result.note =
                    outcome === 'lost_sight'
                        ? 'never got within reach before losing sight of it'
                        : 'never got within reach (no path, it outran you, or chase=false and it stayed away)';
            active.emit?.('pi_tool_result', 'attack', result);
            return result;
        },
        { ...body, required: ['id'] },
    );
    add(
        'flee',
        'Run away from hostiles: sprints along a walkable route (no digging) that keeps away from every hostile within reach, re-planning about twice a second as they move or new ones appear, until you are `distance` blocks (default 16) from all of them or `seconds` pass (default 30). In a narrow passage with an attacker close behind, or when no route leads away, it blocks the passage between you and the attacker with a block from your inventory (`wall`, default true). Omit id to flee whatever last hurt you, or the nearest hostile. Reports how far you got, whether you are safe, whether you walled off the passage, or that you are cornered (it gives up within a couple of seconds when pinned, so you can fight).',
        {
            id: integer(0, Number.MAX_SAFE_INTEGER),
            distance: integer(4, 48),
            seconds: number(1, 60),
            wall: { type: 'boolean' },
        },
        async (a, { bot: active, signal }) => {
            const live = i => {
                const e = i != null ? active.entities?.[i] : null;
                return e && e.isValid !== false && e !== active.entity && e.position ? e : null;
            };
            const hostile = e =>
                e &&
                e !== active.entity &&
                e.isValid !== false &&
                e.position &&
                (e.type === 'hostile' || e.kind === 'Hostile mobs');
            const me = () => active.entity.position;
            const hostilesWithin = r =>
                Object.values(active.entities ?? {})
                    .filter(e => hostile(e) && e.position.distanceTo(me()) <= r)
                    .sort((p, q) => p.position.distanceTo(me()) - q.position.distanceTo(me()));
            let target = live(a.id),
                note;
            if (!target) {
                target = live(active.pi_lastAttacker) ?? hostilesWithin(16)[0] ?? null;
                if (target && a.id != null)
                    note = `entity ${a.id} is gone (killed, despawned or exploded); fleeing ${target.name ?? 'the nearest threat'} ${target.id} instead`;
            }
            if (!target)
                throw failWith(
                    'not_found',
                    a.id != null
                        ? `Entity ${a.id} is gone and no hostile is within 16 blocks; nothing to flee from.`
                        : 'Nothing has hurt you recently and no hostile is within 16 blocks; give the id of the entity to flee from.',
                );
            const dist = a.distance ?? 16,
                until = Date.now() + (a.seconds ?? 30) * 1000,
                wall = a.wall !== false;
            const threats = () => {
                const t = live(target.id);
                const hs = hostilesWithin(dist + 8);
                return t && !hs.includes(t) ? [t, ...hs] : hs;
            };
            const nearest = ts => ts.reduce((m, t) => Math.min(m, t.position.distanceTo(me())), Infinity);
            const before = target.position.distanceTo(me());
            const seen = new Set();
            const { goals, Movements } = await pathfinderModule();
            const Base = goals.Goal ?? class {};
            class GoalAway extends Base {
                constructor(points) {
                    super();
                    this.points = points;
                }
                heuristic(n) {
                    let h = 0;
                    for (const p of this.points) h += Math.max(0, dist - Math.hypot(n.x - p.x, n.y - p.y, n.z - p.z));
                    return h;
                }
                isEnd(n) {
                    return this.points.every(p => Math.hypot(n.x - p.x, n.y - p.y, n.z - p.z) >= dist + 4);
                }
                hasChanged() {
                    return false;
                }
                isValid() {
                    return true;
                }
            }
            let mv = null;
            try {
                mv = new Movements(active);
                mv.canDig = false;
                mv.allowSprinting = true;
                active.pi_terrainGuard?.(mv);
                active.pathfinder.setMovements(mv);
            } catch {}
            const stopPath = () => {
                try {
                    active.pathfinder.setGoal(null);
                } catch {}
            };
            signal?.addEventListener('abort', stopPath, { once: true });
            let noPath = false;
            const onPath = r => {
                noPath =
                    r?.status === 'noPath' || (r?.status !== 'success' && r?.status !== 'partial' && !r?.path?.length);
            };
            active.on?.('path_update', onPath);
            const open = (x, y, z) => {
                const b = active.blockAt?.(new (me().constructor)(x, y, z));
                return (
                    b &&
                    (b.boundingBox === 'empty' ||
                        /^(air|cave_air|void_air|water|short_grass|tall_grass|fern|snow)$/.test(b.name))
                );
            };
            const solid = (x, y, z) => {
                const b = active.blockAt?.(new (me().constructor)(x, y, z));
                return b && b.boundingBox === 'block';
            };
            const exits = () => {
                const f = me().floored();
                return [
                    [1, 0],
                    [-1, 0],
                    [0, 1],
                    [0, -1],
                ].filter(([dx, dz]) => open(f.x + dx, f.y, f.z + dz) && open(f.x + dx, f.y + 1, f.z + dz)).length;
            };
            const WALL_BLOCKS = [
                'cobblestone',
                'cobbled_deepslate',
                'dirt',
                'netherrack',
                'stone',
                'deepslate',
                'andesite',
                'diorite',
                'granite',
                'tuff',
                'blackstone',
                'oak_planks',
                'spruce_planks',
                'birch_planks',
                'sand',
                'gravel',
            ];
            const wallOff = async t => {
                const item = active.inventory?.items?.().find(i => WALL_BLOCKS.includes(i.name));
                if (!item) return { ok: false, why: 'no blocks to wall with' };
                const f = me().floored();
                const dx = t.position.x - me().x,
                    dz = t.position.z - me().z;
                const [sx, sz] = Math.abs(dx) >= Math.abs(dz) ? [Math.sign(dx) || 1, 0] : [0, Math.sign(dz) || 1];
                const cx = f.x + sx,
                    cz = f.z + sz;
                const occupied = (x, y, z) =>
                    Object.values(active.entities ?? {}).some(
                        e =>
                            e !== active.entity &&
                            e.position &&
                            Math.abs(e.position.x - (x + 0.5)) < 0.85 &&
                            Math.abs(e.position.z - (z + 0.5)) < 0.85 &&
                            e.position.y > y - 2 &&
                            e.position.y < y + 1,
                    );
                const beyond = () => {
                    const tl = live(t.id) ?? t;
                    return sx ? (tl.position.x - (cx + 0.5)) * sx > 0.4 : (tl.position.z - (cz + 0.5)) * sz > 0.4;
                };
                if (occupied(cx, f.y, cz) || !beyond())
                    return { ok: false, why: 'the attacker is standing in the gap' };
                const placed = [];
                stopPath();
                stoppedForWall = true;
                try {
                    await active.equip?.(item, 'hand');
                } catch {}
                for (const y of [f.y, f.y + 1]) {
                    if (!open(cx, y, cz)) continue;
                    const V = me().constructor;
                    const refs = [
                        [0, -1, 0],
                        [0, 1, 0],
                        [sx, 0, sz],
                        [sz, 0, sx],
                        [-sz, 0, -sx],
                    ];
                    let done = false;
                    for (const [rx, ry, rz] of refs) {
                        if (
                            !solid(cx + rx, y + ry, cz + rz) &&
                            !placed.some(p => p.x === cx + rx && p.y === y + ry && p.z === cz + rz)
                        )
                            continue;
                        const ref = active.blockAt(new V(cx + rx, y + ry, cz + rz));
                        try {
                            await active.placeBlock(ref, new V(-rx, -ry, -rz));
                            placed.push({ x: cx, y, z: cz });
                            done = true;
                            break;
                        } catch {}
                    }
                    if (!done) break;
                }
                const sealedNow = placed.some(c => c.y === f.y) && solid(cx, f.y, cz) && beyond();
                if (placed.length && !sealedNow)
                    return { ok: false, why: 'the attacker got into the gap before it closed' };
                return placed.length
                    ? { ok: true, placed, block: item.name }
                    : { ok: false, why: 'could not place a block there' };
            };
            let stoppedForWall = false,
                cornerSince = 0;
            let lastPts = null,
                lastIds = '',
                lastSet = 0,
                best = nearest(threats()),
                lastGain = Date.now(),
                walled = null,
                cornered = false,
                stoppedBecause = null,
                wallNote;
            try {
                while (true) {
                    if (signal?.aborted) throw signal.reason ?? abortError('Tool cancelled');
                    const ts = threats();
                    ts.forEach(t => seen.add(t.id));
                    const m = nearest(ts);
                    if (m >= dist) break;
                    if (Date.now() >= until) {
                        stoppedBecause = 'time limit';
                        break;
                    }
                    if (m > best + 0.5) {
                        best = m;
                        lastGain = Date.now();
                        cornerSince = 0;
                    }
                    const close = ts.find(t => t.position.distanceTo(me()) <= 3.5);
                    const stuck = noPath || Date.now() - lastGain > 2500;
                    if (wall && close && exits() <= 2) {
                        stoppedForWall = false;
                        const r = await wallOff(close);
                        if (r.ok) {
                            walled = {
                                block: r.block,
                                cells: r.placed,
                                against: close.name ?? close.username ?? 'hostile',
                                id: close.id,
                            };
                            stoppedBecause = 'walled off';
                            break;
                        }
                        wallNote = r.why;
                        if (stuck) {
                            cornered = true;
                            cornerSince ||= Date.now();
                        }
                        if (stoppedForWall) lastPts = null;
                    } else if (stuck && close) {
                        cornered = true;
                        cornerSince ||= Date.now();
                    }
                    if (cornerSince && Date.now() - cornerSince > 1500) {
                        stoppedBecause = 'cornered';
                        break;
                    }
                    const pts = ts.map(t => ({ x: t.position.x, y: t.position.y, z: t.position.z }));
                    const ids = ts
                        .map(t => t.id)
                        .sort()
                        .join(',');
                    const idle = typeof active.pathfinder?.isMoving === 'function' && !active.pathfinder.isMoving();
                    if (!lastPts || ids !== lastIds || idle || Date.now() - lastSet > 2000) {
                        noPath = false;
                        try {
                            active.pathfinder.setGoal(new GoalAway(pts), false);
                        } catch {}
                        lastPts = pts;
                        lastIds = ids;
                        lastSet = Date.now();
                    }
                    await sleepAbortable(250, signal);
                }
            } finally {
                stopPath();
                signal?.removeEventListener('abort', stopPath);
                active.removeListener?.('path_update', onPath);
            }
            const ts = threats();
            const now = nearest(ts);
            const t = live(target.id);
            const result = {
                fledFrom: target.username ?? target.displayName ?? target.name ?? 'unknown',
                id: target.id,
                distanceBefore: r2(before),
                distanceNow: t ? r2(t.position.distanceTo(me())) : 'target gone',
                nearestHostile: Number.isFinite(now) ? r2(now) : 'none nearby',
                safe: !Number.isFinite(now) || now >= dist || Boolean(walled),
                ...(seen.size > 1 ? { alsoAvoided: seen.size - 1 } : {}),
                ...(walled ? { walled } : {}),
                ...(cornered && !walled
                    ? { cornered: true, reason: wallNote ?? 'no route leads away and the passage could not be blocked' }
                    : {}),
                ...(note ? { note } : {}),
                ...(stoppedBecause && stoppedBecause !== 'walled off' && stoppedBecause !== 'cornered'
                    ? { stoppedBecause }
                    : {}),
            };
            active.emit?.('pi_tool_result', 'flee', result);
            return result;
        },
        { ...body, required: [] },
    );
}
