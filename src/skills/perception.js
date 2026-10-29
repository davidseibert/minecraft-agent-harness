import { Vec3 } from 'vec3';
import iterators from 'prismarine-world/src/iterators.js';
const { RaycastIterator } = iterators;
export const SIGHT_RANGE = 64;
const finiteVector = v => v && [v.x, v.y, v.z].every(Number.isFinite);

export function eyePosition(bot) {
    return bot.entity.position.offset(0, bot.entity.eyeHeight ?? 1.62, 0);
}

function sightRay(bot, target, maxDistance, matcher) {
    if (!bot.entity?.position || !bot.world?.getBlock || !finiteVector(target)) return { valid: false };
    const eye = eyePosition(bot);
    if (!finiteVector(eye) || !Number.isFinite(maxDistance) || maxDistance < 0) return { valid: false };
    const delta = target.minus(eye);
    const distance = delta.norm();
    if (!Number.isFinite(distance) || distance > Math.min(maxDistance, SIGHT_RANGE)) return { valid: false };
    if (distance < 0.001) return { valid: true, coincident: true };
    const direction = delta.scaled(1 / distance);
    if (!finiteVector(direction)) return { valid: false };
    const range = distance + (matcher ? 0.001 : 0);
    const iterator = new RaycastIterator(eye, direction, range);
    const maxSteps = Math.ceil(Math.sqrt(3) * range) + 4;
    let pos = eye;
    for (let step = 0; pos && step < maxSteps; step++) {
        if (!finiteVector(pos)) return { valid: false };
        const position = new Vec3(pos.x, pos.y, pos.z);
        const block = bot.world.getBlock(position);
        if (block && (matcher ? matcher(block, iterator) : iterator.intersect(block.shapes, position))) {
            return { valid: true, hit: block };
        }
        pos = iterator.next();
    }
    return { valid: !pos, hit: null };
}

export function isBlockVisible(bot, block, maxDistance = SIGHT_RANGE) {
    if (!finiteVector(block?.position)) return false;
    const result = sightRay(
        bot,
        block.position.offset(0.5, 0.5, 0.5),
        maxDistance,
        (candidate, iterator) =>
            candidate.position.equals(block.position) ||
            Boolean(iterator.intersect(candidate.shapes, candidate.position)),
    );
    return Boolean(result.valid && (result.coincident || result.hit?.position.equals(block.position)));
}

const FACES = [
    [0, 1, 0],
    [0, -1, 0],
    [1, 0, 0],
    [-1, 0, 0],
    [0, 0, 1],
    [0, 0, -1],
];
export function blockSight(bot, block, maxDistance = SIGHT_RANGE) {
    if (!finiteVector(block?.position)) return { visible: false, obstruction: null };
    const own = (candidate, iterator) =>
        candidate.position.equals(block.position) || Boolean(iterator.intersect(candidate.shapes, candidate.position));
    let obstruction = null;
    for (const f of [[0, 0, 0], ...FACES]) {
        const point = block.position.offset(0.5 + f[0] * 0.499, 0.5 + f[1] * 0.499, 0.5 + f[2] * 0.499);
        const r = sightRay(bot, point, maxDistance, own);
        if (r.valid && (r.coincident || r.hit?.position.equals(block.position)))
            return { visible: true, obstruction: null };
        if (!obstruction && r.valid && r.hit)
            obstruction = { name: r.hit.name, x: r.hit.position.x, y: r.hit.position.y, z: r.hit.position.z };
    }
    return { visible: false, obstruction };
}
export function isBlockFaceVisible(bot, block, maxDistance = SIGHT_RANGE) {
    return isBlockVisible(bot, block, maxDistance) || blockSight(bot, block, maxDistance).visible;
}

export function isEntityVisible(bot, entity, maxDistance = SIGHT_RANGE) {
    if (!finiteVector(entity?.position) || entity.id === bot.entity?.id) return false;
    const height = entity.height ?? 1;
    if (!Number.isFinite(height)) return false;
    const target = entity.position.offset(0, height / 2, 0);
    const result = sightRay(bot, target, maxDistance);
    return Boolean(result.valid && !result.hit);
}

export function supportFaceSight(bot, support, faceVec) {
    if (!finiteVector(support?.position) || !finiteVector(faceVec) || !bot.entity?.position) return { valid: false };
    const eye = eyePosition(bot);
    const centre = support.position.offset(0.5 + faceVec.x * 0.5, 0.5 + faceVec.y * 0.5, 0.5 + faceVec.z * 0.5);
    const distance = Math.hypot(eye.x - centre.x, eye.y - centre.y, eye.z - centre.z);
    const outward = (eye.x - centre.x) * faceVec.x + (eye.y - centre.y) * faceVec.y + (eye.z - centre.z) * faceVec.z;
    const facing = outward > 1e-6;
    if (!facing || distance > SIGHT_RANGE) return { valid: true, distance, facing, clear: false, obstruction: null };
    const ray = sightRay(
        bot,
        centre,
        SIGHT_RANGE,
        (candidate, iterator) =>
            candidate.position.equals(support.position) ||
            Boolean(iterator.intersect(candidate.shapes, candidate.position)),
    );
    if (!ray.valid) return { valid: false, distance, facing };
    const clear = Boolean(ray.coincident || ray.hit?.position.equals(support.position));
    return {
        valid: true,
        distance,
        facing,
        clear,
        obstruction:
            clear || !ray.hit
                ? null
                : { name: ray.hit.name, x: ray.hit.position.x, y: ray.hit.position.y, z: ray.hit.position.z },
    };
}

export function placementReach(bot) {
    return bot.game?.gameMode === 'creative' ? 5 : 4.5;
}

export function faceUsable(bot, support, faceVec) {
    const sight = supportFaceSight(bot, support, faceVec);
    return Boolean(sight.valid && sight.facing && sight.clear && sight.distance <= placementReach(bot));
}
