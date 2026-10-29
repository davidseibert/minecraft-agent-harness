import { KEEP_MOVING_TOOLS } from '../tools/game-tools.js';
import { isStarvationDamage } from './hurt-cause.js';

export function installDamageWake(bot, getRunner, actionRunner) {
    let lastHealth = bot.health;
    bot.on('health', () => {
        const lost = bot.health < lastHealth;
        lastHealth = bot.health;
        const active = actionRunner.status.active;
        if (!lost || bot.health <= 0) return;
        if (isStarvationDamage(bot)) {
            getRunner()?.enqueue(
                { kind: 'damage', cause: 'starvation', health: bot.health, hunger: bot.food },
                { key: 'damage', urgent: false, interrupt: false },
            );
            return;
        }
        getRunner()?.enqueue(
            { kind: 'damage', health: bot.health, hunger: bot.food },
            {
                key: 'damage',
                urgent: true,
                interrupt: Boolean(active) && String(active) !== 'attack' && !KEEP_MOVING_TOOLS.has(String(active)),
            },
        );
    });
}
