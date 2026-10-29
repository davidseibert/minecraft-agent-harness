import { readFileSync } from 'node:fs';

const arena = JSON.parse(readFileSync(new URL('./arena.json', import.meta.url), 'utf8'));

export default function createTools({ bot, schema, options }) {
    const referee = options.referee ?? `http://127.0.0.1:${arena.refereePort}`;
    const call = async (path, body) => {
        const res = await fetch(`${referee}${path}`, {
            method: body ? 'POST' : 'GET',
            headers: { 'content-type': 'application/json' },
            body: body ? JSON.stringify(body) : undefined,
            signal: AbortSignal.timeout(15000),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? `Referee answered ${res.status}`);
        return data;
    };
    const prices = [
        ...Object.entries(arena.shop).map(([key, v]) => `${key}=${v.cost[1]} ${v.cost[0]} -> ${v.label}`),
        ...Object.entries(arena.upgrades).map(
            ([key, v]) => `${key}=${v.costs.join('/')} diamond -> ${v.label} (team upgrade)`,
        ),
    ].join('; ');
    return [
        {
            name: 'buy',
            description: `Bed Wars shop. Works within 8 blocks of your team's spawn point on your base island. The referee takes the price from your inventory. Prices: ${prices}.`,
            properties: {
                item: schema.choice([...Object.keys(arena.shop), ...Object.keys(arena.upgrades)]),
                quantity: schema.integer(1, 8),
            },
            required: ['item'],
            run: args => call('/buy', { player: bot.username, item: args.item, quantity: args.quantity ?? 1 }),
        },
        {
            name: 'bedwars_status',
            description:
                'Bed Wars scoreboard: game status, time left, which beds stand, who is alive or eliminated, kills and final kills, team upgrades.',
            properties: {},
            run: async () => ({
                you: bot.username,
                ...(await call(`/status?player=${encodeURIComponent(bot.username)}`)),
            }),
        },
    ];
}
