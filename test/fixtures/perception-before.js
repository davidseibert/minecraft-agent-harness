export const SIGHT_RANGE = 64;

export function eyePosition(bot) {
    return bot.entity.position.offset(0, bot.entity.eyeHeight ?? 1.62, 0);
}

export function isBlockVisible(bot, block, maxDistance = SIGHT_RANGE) {
    if (!block?.position || !bot.world?.raycast) return false;
    const eye = eyePosition(bot);
    const delta = block.position.offset(0.5, 0.5, 0.5).minus(eye);
    const distance = delta.norm();
    if (distance > Math.min(maxDistance, SIGHT_RANGE)) return false;
    if (distance < 0.001) return true;
    const hit = bot.world.raycast(eye, delta.scaled(1 / distance), distance + 0.001,
        (candidate, iterator) => candidate.position.equals(block.position) ||
            Boolean(iterator.intersect(candidate.shapes, candidate.position)));
    return Boolean(hit?.position.equals(block.position));
}

export function isEntityVisible(bot, entity, maxDistance = SIGHT_RANGE) {
    if (!entity?.position || entity.id === bot.entity.id || !bot.world?.raycast) return false;
    const eye = eyePosition(bot);
    const target = entity.position.offset(0, (entity.height ?? 1) / 2, 0);
    const delta = target.minus(eye);
    const distance = delta.norm();
    if (distance > Math.min(maxDistance, SIGHT_RANGE)) return false;
    if (distance < 0.001) return true;
    return !bot.world.raycast(eye, delta.scaled(1 / distance), distance);
}
