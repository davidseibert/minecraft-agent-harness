import { abortError, failWith, withFailureCode } from './failures.js';
import { guardBuiltBlocks } from './guards.js';
import { requireFunction } from './runtime.js';

export function createPlacement(ctx) {
    const {
        DIRS,
        at,
        cellKey,
        passable,
        pathfinderModule,
        perception,
        r2,
        replaceable,
        skills,
        solidSupport,
        stallWatch,
    } = ctx;
    function standHint(active, cell, supports, reach) {
        const sight = requireFunction(perception, 'supportFaceSight');
        const seen = requireFunction(perception, 'isBlockVisible');
        const eyeH = active.entity.eyeHeight ?? 1.62,
            P = active.entity.position;
        const V = P.constructor;
        let best = null;
        for (let X = cell.x - 4; X <= cell.x + 4; X++)
            for (let Z = cell.z - 4; Z <= cell.z + 4; Z++)
                for (let Y = cell.y - 3; Y <= cell.y + 1; Y++) {
                    if (
                        Math.hypot(X + 0.5 - cell.x, Y - cell.y, Z + 0.5 - cell.z) < 1.1 ||
                        Math.hypot(X + 0.5 - cell.x, Y + 1 - cell.y, Z + 0.5 - cell.z) < 1.1
                    )
                        continue;
                    const floor = at(active, X, Y - 1, Z);
                    if (!solidSupport(floor) || !seen(active, floor, 64)) continue;
                    const feet = at(active, X, Y, Z),
                        head = at(active, X, Y + 1, Z);
                    if (!passable(feet) || !passable(head) || !seen(active, feet, 64) || !seen(active, head, 64))
                        continue;
                    const ghost = {
                        entity: { position: new V(X + 0.5, Y, Z + 0.5), eyeHeight: eyeH },
                        world: active.world,
                    };
                    for (const s of supports) {
                        const m = sight(ghost, s.block, s.faceVec);
                        if (!(m.valid && m.facing && m.clear && m.distance <= reach)) continue;
                        const move = Math.hypot(X + 0.5 - P.x, Y - P.y, Z + 0.5 - P.z);
                        if (!best || move < best.move)
                            best = {
                                move,
                                stand: { x: X, y: Y, z: Z },
                                floor: floor.name,
                                side: s.side,
                                faceDistance: r2(m.distance),
                            };
                    }
                }
        return (
            best && {
                stand: best.stand,
                standOn: best.floor,
                face: best.side,
                faceDistanceFromThere: best.faceDistance,
                moveDistance: r2(best.move),
            }
        );
    }
    function repositionAdvice(active, cell, supports, reach, base) {
        const eyeY = base.eye.y,
            feetY = r2(active.entity.position.y);
        const facts = { feetY, targetBottomVsEye: r2(cell.y - eyeY) };
        const hint = standHint(active, cell, supports, reach);
        if (hint) {
            const s = hint.stand;
            return {
                facts: { ...facts, suggestion: hint },
                text: ` Suggested spot: stand at ${s.x},${s.y},${s.z} (on the ${hint.standOn} there); from there the ${hint.face} support face is ${hint.faceDistanceFromThere} blocks away with a clear view (walking route there not checked).`,
            };
        }
        if (cell.y >= eyeY - 0.5) {
            const needFeet = cell.y - 1;
            return {
                facts: { ...facts, needFeetAtLeast: needFeet },
                text: ` This row is at or above your eye height (eyes y=${eyeY}); a block below it can only be clicked on its top face with your eyes above y=${cell.y}. Stand on a block so your feet are at y=${needFeet} or higher (e.g. on a block at y=${needFeet - 1}) within ${reach} blocks.`,
            };
        }
        return { facts, text: '' };
    }
    function placementPlan(active, a) {
        const target = at(active, a.x, a.y, a.z);
        const cell = { x: a.x, y: a.y, z: a.z };
        if (!target) throw failWith('not_visible_or_range', 'Target cell is not loaded.', { target: cell });
        if (!replaceable.includes(target.name)) {
            if (!requireFunction(perception, 'isBlockVisible')(active, target, 64))
                throw failWith('not_visible_or_range', 'Target cell is not empty and not visible from here.', {
                    target: cell,
                });
            throw failWith(
                'occupied_target',
                `Target is occupied by ${target.name}; use explicit break_block first if removal is appropriate.`,
                { target: cell, observed: target.name },
            );
        }
        const sight = requireFunction(perception, 'supportFaceSight');
        const reach = requireFunction(perception, 'placementReach')(active);
        const pref =
            a.face && a.face !== 'side'
                ? [a.face]
                : a.face === 'side'
                  ? ['north', 'south', 'east', 'west']
                  : ['bottom'];
        const order = [...pref, ...Object.keys(DIRS).filter(k => !pref.includes(k))];
        const candidates = [],
            supports = [];
        for (const side of order) {
            const [dx, dy, dz] = DIRS[side];
            const support = at(active, a.x + dx, a.y + dy, a.z + dz);
            if (!solidSupport(support)) continue;
            if (requireFunction(perception, 'isBlockVisible')(active, support, 64))
                supports.push({ side, block: support, faceVec: { x: -dx, y: -dy, z: -dz } });
            const m = sight(active, support, { x: -dx, y: -dy, z: -dz });
            if (!m.valid) continue;
            candidates.push({
                side,
                support: support.name,
                at: { x: a.x + dx, y: a.y + dy, z: a.z + dz },
                faceDistance: r2(m.distance),
                facing: m.facing,
                clear: m.clear,
                obstruction: m.obstruction ?? null,
            });
        }
        const p = active.entity.position;
        const eye = { x: r2(p.x), y: r2(p.y + (active.entity.eyeHeight ?? 1.62)), z: r2(p.z) };
        const base = { target: cell, eye, reach };
        const noFace = () => {
            const adv = repositionAdvice(active, cell, supports, reach, base);
            return failWith(
                'no_support',
                'No support face is visible from here: either nothing solid touches this cell, or the only support is on the far side. Move to another side, or place a support block next to it first.' +
                    adv.text,
                { ...base, ...adv.facts },
            );
        };
        if (!candidates.length) throw noFace();
        const usable = candidates.find(c => c.facing && c.clear && c.faceDistance <= reach);
        if (usable) return { ...usable, reach };
        const visible = candidates.filter(c => c.facing && c.clear).sort((x, y) => x.faceDistance - y.faceDistance);
        if (visible.length) {
            const c = visible[0];
            const adv = repositionAdvice(active, cell, supports, reach, base);
            throw failWith(
                'out_of_reach',
                `Nearest clickable support face (${c.support} ${c.side} of target) is ${c.faceDistance} blocks from your eyes; reach is ${reach}. Move closer; turning your view will not help.` +
                    adv.text,
                { ...base, faceDistance: c.faceDistance, nearestFace: c, ...adv.facts },
            );
        }
        const blocked = candidates
            .filter(c => c.facing && c.obstruction)
            .sort((x, y) => x.faceDistance - y.faceDistance);
        if (blocked.length) {
            const o = blocked[0].obstruction;
            const adv = repositionAdvice(active, cell, supports, reach, base);
            throw failWith(
                'occluded',
                `Line of sight to the support face is blocked by ${o.name} at ${o.x},${o.y},${o.z}. Move to a spot with a clear view of a support face; turning your view will not help.` +
                    adv.text,
                { ...base, obstruction: o, nearestFace: blocked[0], ...adv.facts },
            );
        }
        throw noFace();
    }
    async function placeOne(active, a) {
        if (['air', 'cave_air', 'void_air'].includes(a.block))
            throw withFailureCode(new Error('Removing a block requires explicit break_block.'), 'validation');
        const plan = placementPlan(active, a);
        const placementBot = new Proxy(active, {
            get(target, key) {
                if (key === 'dig')
                    return () => {
                        throw withFailureCode(
                            new Error('Placement cannot mine; use explicit break_block first.'),
                            'occupied_target',
                        );
                    };
                return Reflect.get(target, key);
            },
        });
        const logStart = (active.output ?? '').length;
        const done = await requireFunction(skills, 'placeAt')(placementBot, a.block, a.x, a.y, a.z, plan.side);
        if (done === false) {
            const log = (active.output ?? '').slice(logStart);
            if (/Placement not confirmed: expected |Failed to place \S+ at /.test(log)) {
                let seen = at(active, a.x, a.y, a.z)?.name ?? 'unloaded';
                for (let i = 0; i < 15 && seen !== a.block; i++) {
                    await new Promise(resolve => setTimeout(resolve, 200));
                    seen = at(active, a.x, a.y, a.z)?.name ?? 'unloaded';
                }
                if (seen === a.block)
                    return {
                        placed: { x: a.x, y: a.y, z: a.z },
                        against: { side: plan.side, block: plan.support, faceDistance: plan.faceDistance },
                        confirmedLate: true,
                    };
                throw failWith(
                    'placement_unconfirmed',
                    `Placement click was sent but ${a.block} was not observed at ${a.x},${a.y},${a.z} (found ${seen}). Observe before retrying.`,
                    {
                        target: { x: a.x, y: a.y, z: a.z },
                        observed: seen,
                        clicked: { side: plan.side, block: plan.support, faceDistance: plan.faceDistance },
                        log: log.trim().split('\n').slice(-2),
                    },
                );
            }
        }
        return done === false
            ? false
            : {
                  placed: { x: a.x, y: a.y, z: a.z },
                  against: { side: plan.side, block: plan.support, faceDistance: plan.faceDistance },
              };
    }
    const placeFailures = new Map();
    const SCAFFOLD = 'dirt';
    const tooCloseToPlace = (feet, cell) =>
        Math.hypot(feet.x - cell.x, feet.y - cell.y, feet.z - cell.z) < 1.1 ||
        Math.hypot(feet.x - cell.x, feet.y + 1 - cell.y, feet.z - cell.z) < 1.1;
    const reachMargin = (cell, eyeY) => (cell.y >= eyeY - 0.5 ? 0.8 : 0.3);
    function standCandidates(active, cell) {
        const sight = requireFunction(perception, 'supportFaceSight');
        const reach = requireFunction(perception, 'placementReach')(active);
        const eyeH = active.entity.eyeHeight ?? 1.62,
            P = active.entity.position,
            V = P.constructor;
        const supports = [];
        for (const side of Object.keys(DIRS)) {
            const [dx, dy, dz] = DIRS[side];
            const s = at(active, cell.x + dx, cell.y + dy, cell.z + dz);
            if (solidSupport(s)) supports.push({ side, block: s, faceVec: { x: -dx, y: -dy, z: -dz } });
        }
        const out = [];
        for (let X = cell.x - 5; X <= cell.x + 5; X++)
            for (let Z = cell.z - 5; Z <= cell.z + 5; Z++)
                for (let Y = cell.y - 4; Y <= cell.y + 2; Y++) {
                    if (tooCloseToPlace({ x: X + 0.5, y: Y, z: Z + 0.5 }, cell)) continue;
                    if (!passable(at(active, X, Y, Z)) || !passable(at(active, X, Y + 1, Z))) continue;
                    const floor = at(active, X, Y - 1, Z);
                    const standable = solidSupport(floor);
                    if (!standable && !passable(floor)) continue;
                    const ghost = {
                        entity: { position: new V(X + 0.5, Y, Z + 0.5), eyeHeight: eyeH },
                        world: active.world,
                    };
                    const margin = reachMargin(cell, Y + eyeH);
                    let bestFace = null;
                    for (const s of supports) {
                        const m = sight(ghost, s.block, s.faceVec);
                        if (
                            m.valid &&
                            m.facing &&
                            m.clear &&
                            m.distance <= reach - margin &&
                            (!bestFace || m.distance < bestFace.d)
                        )
                            bestFace = { side: s.side, d: r2(m.distance) };
                    }
                    if (bestFace)
                        out.push({
                            stand: { x: X, y: Y, z: Z },
                            standable,
                            face: bestFace.side,
                            faceDistance: bestFace.d,
                            move: r2(Math.hypot(X + 0.5 - P.x, Y - P.y, Z + 0.5 - P.z)),
                        });
                }
        return { supports: supports.length, candidates: out.sort((a, b) => a.move - b.move) };
    }
    function missingSupport(active, cell) {
        const seen = requireFunction(perception, 'isBlockVisible');
        const start = cellKey(cell),
            prev = new Map([[start, null]]);
        const order = ['bottom', 'north', 'south', 'east', 'west', 'top'];
        let frontier = [cell];
        for (let depth = 0; depth < 8 && frontier.length; depth++) {
            const next = [];
            for (const c of frontier)
                for (const side of order) {
                    const [dx, dy, dz] = DIRS[side];
                    const n = { x: c.x + dx, y: c.y + dy, z: c.z + dz },
                        k = cellKey(n);
                    if (prev.has(k)) continue;
                    const b = at(active, n.x, n.y, n.z);
                    if (!b) continue;
                    if (solidSupport(b)) {
                        const face = requireFunction(perception, 'supportFaceSight')(active, b, {
                            x: -dx,
                            y: -dy,
                            z: -dz,
                        });
                        if (c === cell || !(seen(active, b, 64) || (face.valid && face.facing && face.clear))) continue;
                        const chain = [];
                        let cur = cellKey(c);
                        while (cur && cur !== start) {
                            const [x, y, z] = cur.split(',').map(Number);
                            chain.push({ x, y, z });
                            cur = prev.get(cur);
                        }
                        return {
                            placeFirst: chain[0],
                            touchesTarget: chain[chain.length - 1],
                            blocksNeeded: chain.length,
                        };
                    }
                    if (!passable(b)) continue;
                    prev.set(k, cellKey(c));
                    next.push(n);
                }
            frontier = next;
        }
        return {
            placeFirst: { x: cell.x, y: cell.y - 1, z: cell.z },
            touchesTarget: { x: cell.x, y: cell.y - 1, z: cell.z },
            blocksNeeded: null,
        };
    }
    const fmt = (b, c) => `place(${c.x},${c.y},${c.z},${b})`;
    async function walkTo(active, chosen, moves, signal) {
        const { goals } = await pathfinderModule();
        const onAbort = () => {
            try {
                active.pathfinder.setGoal(null);
                active.pathfinder.stop();
            } catch {}
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        try {
            active.pathfinder.setMovements(moves);
            const watch = stallWatch(active);
            try {
                await active.pathfinder.goto(new goals.GoalBlock(chosen.stand.x, chosen.stand.y, chosen.stand.z));
            } catch (error) {
                if (!watch.stalled) throw error;
            } finally {
                watch.stop();
            }
            if (watch.stalled)
                throw new Error(
                    `stuck jumping in place at ${watch.at} without gaining height; could not reach stand spot ${cellKey(chosen.stand)}`,
                );
        } finally {
            signal?.removeEventListener('abort', onAbort);
        }
    }
    async function tower(active, chosen, signal, placedCells) {
        const item = active.inventory.findInventoryItem(SCAFFOLD);
        if (!item) throw new Error('no scaffold block available');
        await active.equip(item, 'hand');
        const V = active.entity.position.constructor;
        for (let level = 0; level < chosen.height; level++) {
            if (signal?.aborted) throw signal.reason ?? abortError('Tool cancelled');
            const floorY = Math.floor(active.entity.position.y + 0.01);
            const cell = { x: chosen.stand.x, y: floorY, z: chosen.stand.z };
            const below = at(active, cell.x, cell.y - 1, cell.z);
            await active.lookAt(new V(cell.x + 0.5, cell.y - 0.5, cell.z + 0.5), true);
            active.setControlState('jump', true);
            const t0 = Date.now();
            while (active.entity.position.y < floorY + 1.05 && Date.now() - t0 < 4000)
                await new Promise(r => setTimeout(r, 25));
            active.setControlState('jump', false);
            if (active.entity.position.y < floorY + 1.05) throw new Error(`jump did not clear y=${floorY + 1}`);
            try {
                await active.placeBlock(below, new V(0, 1, 0));
            } catch (error) {
                if (at(active, cell.x, cell.y, cell.z)?.name !== SCAFFOLD)
                    throw new Error(
                        `scaffold at ${cellKey(cell)} refused: ${String(error?.message ?? error).slice(0, 80)}`,
                    );
            }
            placedCells.push(cell);
            for (let i = 0; i < 40 && !(active.entity.onGround && active.entity.position.y >= floorY + 0.99); i++)
                await new Promise(r => setTimeout(r, 100));
            if (!(active.entity.position.y >= floorY + 0.99))
                throw new Error(`did not land on scaffold at ${cellKey(cell)}`);
        }
    }
    async function removeScaffold(active, cells, target) {
        const removed = [],
            left = [];
        const sorted = [...new Map(cells.map(c => [cellKey(c), c])).values()].sort((a, b) => b.y - a.y);
        for (const c of sorted) {
            if (cellKey(c) === cellKey(target)) continue;
            const b = at(active, c.x, c.y, c.z);
            if (b?.name !== SCAFFOLD) {
                left.push({ ...c, reason: `now ${b?.name ?? 'unloaded'}, not touched` });
                continue;
            }
            const eye = active.entity.position.offset(0, active.entity.eyeHeight ?? 1.62, 0);
            if (Math.hypot(eye.x - c.x - 0.5, eye.y - c.y - 0.5, eye.z - c.z - 0.5) > 5) {
                left.push({ ...c, reason: 'out of reach' });
                continue;
            }
            const feetBefore = active.entity.position.y;
            const underFeet = c.y === Math.floor(feetBefore + 0.01) - 1;
            try {
                await active.dig(b, true);
            } catch (e) {
                left.push({ ...c, reason: String(e?.message ?? e).slice(0, 80) });
                continue;
            }
            removed.push(c);
            if (underFeet)
                for (let i = 0; i < 40 && !(active.entity.position.y < feetBefore - 0.5 && active.entity.onGround); i++)
                    await new Promise(r => setTimeout(r, 100));
        }
        return { removed: removed.length, left };
    }
    function bridgeSupports(active, cell) {
        const P = active.entity.position,
            out = [];
        for (const side of ['north', 'south', 'east', 'west']) {
            const [dx, , dz] = DIRS[side];
            const ref = { x: cell.x + dx, y: cell.y, z: cell.z + dz };
            if (!solidSupport(at(active, ref.x, ref.y, ref.z))) continue;
            if (!passable(at(active, ref.x, ref.y + 1, ref.z)) || !passable(at(active, ref.x, ref.y + 2, ref.z)))
                continue;
            out.push({
                side,
                ref,
                stand: { x: ref.x, y: ref.y + 1, z: ref.z },
                dir: { x: -dx, z: -dz },
                move: Math.hypot(ref.x + 0.5 - P.x, ref.y + 1 - P.y, ref.z + 0.5 - P.z),
            });
        }
        return out.sort((x, y) => x.move - y.move);
    }
    const onStand = (active, st) => {
        const p = active.entity.position;
        return Math.floor(p.x) === st.x && Math.floor(p.z) === st.z && Math.abs(p.y - st.y) < 0.6;
    };
    async function bridgeApproach(active, cell, signal) {
        const opts = bridgeSupports(active, cell);
        if (!opts.length) return { none: true };
        const { Movements, goals } = await pathfinderModule();
        const plain = new Movements(active);
        guardBuiltBlocks(active, plain);
        plain.allowFreeMotion = false;
        const checked = [];
        let chosen = opts.find(o => onStand(active, o.stand)) ?? null;
        if (!chosen)
            for (const o of opts) {
                if (signal?.aborted) throw abortError('Tool cancelled');
                const r = active.pathfinder.getPathTo(plain, new goals.GoalBlock(o.stand.x, o.stand.y, o.stand.z), 250);
                checked.push({ stand: o.stand, status: r?.status });
                if (r?.status === 'success') {
                    chosen = o;
                    break;
                }
            }
        if (!chosen) return { unreachable: checked };
        const t0 = Date.now();
        if (!onStand(active, chosen.stand)) await walkTo(active, chosen, plain, signal);
        const V = active.entity.position.constructor,
            d = chosen.dir;
        const along = () => (d.x ? active.entity.position.x * d.x : active.entity.position.z * d.z);
        const base = d.x ? chosen.stand.x : chosen.stand.z,
            sgn = d.x || d.z;
        const plane = (sgn > 0 ? base + 1 : base) * sgn;
        active.setControlState('sneak', true);
        try {
            await active.lookAt(
                new V(chosen.stand.x + 0.5 + d.x * 4, active.entity.position.y + 1.3, chosen.stand.z + 0.5 + d.z * 4),
                true,
            );
            active.setControlState('forward', true);
            let best = along(),
                bestT = Date.now();
            const t1 = Date.now();
            while (along() < plane + 0.1 && Date.now() - t1 < 4000) {
                if (signal?.aborted) throw signal.reason ?? abortError('Tool cancelled');
                await new Promise(r => setTimeout(r, 25));
                if (along() > best + 0.005) {
                    best = along();
                    bestT = Date.now();
                } else if (Date.now() - bestT > 700) break;
            }
        } finally {
            active.setControlState('forward', false);
        }
        await new Promise(r => setTimeout(r, 150));
        if (active.entity.position.y < chosen.stand.y - 0.4) {
            active.setControlState('sneak', false);
            throw new Error('lost footing at the edge');
        }
        return { chosen, walkMs: Date.now() - t0, fromEdge: r2(plane - along()) };
    }
    async function bridgeClick(active, a, chosen) {
        const V = active.entity.position.constructor;
        let ok = false;
        try {
            const item = active.inventory.items().find(i => i.name === a.block);
            if (!item) throw withFailureCode(new Error(`Don't have any ${a.block} to place.`), 'missing_item');
            await active.equip(item, 'hand');
            const ref = at(active, chosen.ref.x, chosen.ref.y, chosen.ref.z);
            if (!solidSupport(ref))
                throw withFailureCode(
                    new Error(`The block to bridge from at ${cellKey(chosen.ref)} is now ${ref?.name ?? 'unloaded'}.`),
                    'no_support',
                );
            try {
                await active.placeBlock(ref, new V(chosen.dir.x, 0, chosen.dir.z));
            } catch (error) {
                let seen = at(active, a.x, a.y, a.z)?.name;
                for (let i = 0; i < 10 && seen !== a.block; i++) {
                    await new Promise(r => setTimeout(r, 150));
                    seen = at(active, a.x, a.y, a.z)?.name;
                }
                if (seen !== a.block)
                    throw withFailureCode(
                        new Error(
                            `Bridging click on the side of ${ref.name} at ${cellKey(chosen.ref)} was not confirmed (cell holds ${seen ?? 'unloaded'}): ${String(error?.message ?? error).slice(0, 100)}.`,
                        ),
                        'placement_unconfirmed',
                    );
            }
            ok = true;
            return { placed: { x: a.x, y: a.y, z: a.z }, against: { side: chosen.side, block: ref.name } };
        } finally {
            if (!ok) {
                active.setControlState('back', true);
                await new Promise(r => setTimeout(r, 400));
                active.setControlState('back', false);
            }
            active.setControlState('sneak', false);
        }
    }
    return {
        SCAFFOLD,
        bridgeApproach,
        bridgeClick,
        fmt,
        missingSupport,
        placeFailures,
        placeOne,
        placementPlan,
        removeScaffold,
        standCandidates,
        tooCloseToPlace,
        tower,
        walkTo,
    };
}
