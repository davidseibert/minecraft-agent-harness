import { createServer } from 'node:http';
import { existsSync, mkdirSync, openSync, readFileSync, readSync, statSync, writeFileSync, closeSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { Rcon } from './rcon.mjs';
import { parseDeath } from './deaths.mjs';

const { values } = parseArgs({
    options: {
        arena: { type: 'string', default: new URL('./arena.json', import.meta.url).pathname },
        server: { type: 'string', default: 'server-bedwars' },
        out: { type: 'string', default: '.agent-state/bedwars' },
        minutes: { type: 'string' },
        'rcon-host': { type: 'string', default: '127.0.0.1' },
        help: { type: 'boolean', short: 'h' },
    },
});
if (values.help) {
    console.log(
        'Usage: node examples/bedwars/referee.mjs [--server server-bedwars] [--arena arena.json] [--minutes 20]',
    );
    process.exit(0);
}

const arena = JSON.parse(readFileSync(values.arena, 'utf8'));
const serverDir = path.resolve(values.server);
const props = Object.fromEntries(
    readFileSync(path.join(serverDir, 'server.properties'), 'utf8')
        .split('\n')
        .filter(l => l.includes('=') && !l.startsWith('#'))
        .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
if (props['enable-rcon'] !== 'true' || !props['rcon.password']) {
    console.error(
        'RCON is off. Start the server with: npm run server -- --dir server-bedwars --world void --rcon-password <secret>',
    );
    process.exit(2);
}
const rcon = new Rcon({
    host: values['rcon-host'],
    port: Number(props['rcon.port']),
    password: props['rcon.password'],
});
const out = path.resolve(values.out);
mkdirSync(out, { recursive: true });
const durationSec = Math.round(Number(values.minutes ?? arena.durationMinutes) * 60);
const teams = arena.teams;
const teamOf = Object.fromEntries(Object.entries(teams).flatMap(([t, d]) => d.players.map(p => [p, t])));
const players = Object.keys(teamOf);
const xyz = v => v.join(' ');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = () => Date.now() / 1000;

const state = {
    status: 'setting_up',
    startedAt: null,
    endsAt: null,
    durationSec,
    winner: null,
    reason: null,
    recent: [],
    teams: Object.fromEntries(
        Object.entries(teams).map(([t, d]) => [
            t,
            {
                bed: true,
                bedBrokenAt: null,
                upgrades: {},
                players: Object.fromEntries(
                    d.players.map(p => [p, { eliminated: false, kills: 0, finalKills: 0, deaths: 0 }]),
                ),
            },
        ]),
    ),
};
const events = [];
function event(kind, data = {}) {
    const entry = { t: new Date().toISOString(), event: kind, ...data };
    events.push(entry);
    console.log(JSON.stringify(entry));
}
function snapshot() {
    const view = structuredClone(state);
    if (view.endsAt) {
        view.secondsLeft = Math.max(0, Math.round(view.endsAt - now()));
        view.endsAt = new Date(view.endsAt * 1000).toISOString();
    }
    for (const team of Object.values(view.teams)) {
        const list = Object.values(team.players);
        team.alive = Object.entries(team.players)
            .filter(([, v]) => !v.eliminated)
            .map(([p]) => p);
        team.kills = list.reduce((n, v) => n + v.kills, 0);
        team.finalKills = list.reduce((n, v) => n + v.finalKills, 0);
    }
    return view;
}
function save() {
    writeFileSync(path.join(out, 'state.json'), JSON.stringify(snapshot(), null, 1));
}
async function announce(message, color = 'gold') {
    state.recent = [...state.recent, message].slice(-15);
    await rcon.send(`tellraw @a ${JSON.stringify({ text: `[BedWars] ${message}`, color })}`);
}

async function buildArena() {
    await rcon.send('forceload add -64 -48 64 48');
    for (const rule of [
        'gamerule doMobSpawning false',
        'gamerule doDaylightCycle false',
        'gamerule doWeatherCycle false',
        'gamerule doImmediateRespawn true',
        'gamerule keepInventory false',
        'gamerule announceAdvancements false',
        'gamerule spawnRadius 0',
        'gamerule doInsomnia false',
        'gamerule doFireTick false',
        'time set 6000',
        'weather clear',
        'difficulty easy',
    ])
        await rcon.send(rule);
    for (const [, d] of Object.entries(teams)) {
        await rcon.send(`fill ${xyz(d.island.from)} ${xyz(d.island.to)} minecraft:${d.island.block}`);
        await rcon.send(`setblock ${xyz(d.generator.map((v, i) => (i === 1 ? v - 1 : v)))} minecraft:iron_block`);
    }
    for (const island of arena.islands)
        await rcon.send(`fill ${xyz(island.from)} ${xyz(island.to)} minecraft:${island.block}`);
    for (const at of arena.diamondGenerators)
        await rcon.send(`setblock ${at[0]} ${at[1] - 1} ${at[2]} minecraft:diamond_block`);
    for (const at of arena.emeraldGenerators)
        await rcon.send(`setblock ${at[0]} ${at[1] - 1} ${at[2]} minecraft:emerald_block`);
    await placeBeds();
    const [lx, ly, lz] = arena.lobby;
    await rcon.send(`fill ${lx - 4} ${ly - 1} ${lz - 4} ${lx + 4} ${ly + 4} ${lz + 4} minecraft:barrier hollow`);
    await rcon.send(`fill ${lx - 3} ${ly + 4} ${lz - 3} ${lx + 3} ${ly + 4} ${lz + 3} minecraft:air`);
    await rcon.send(`setworldspawn ${xyz(arena.lobby)}`);
    await rcon.send('kill @e[type=item]');
}
async function placeBeds() {
    for (const [t, d] of Object.entries(teams)) {
        await rcon.send(`setblock ${xyz(d.bed.foot)} minecraft:air`);
        await rcon.send(`setblock ${xyz(d.bed.head)} minecraft:air`);
        await rcon.send(`setblock ${xyz(d.bed.foot)} minecraft:${t}_bed[facing=${d.bed.facing},part=foot]`);
        await rcon.send(`setblock ${xyz(d.bed.head)} minecraft:${t}_bed[facing=${d.bed.facing},part=head]`);
    }
}

async function online(player) {
    return (await rcon.send(`execute if entity @a[name=${player}]`)).includes('Test passed');
}
async function holdInLobby(player) {
    await rcon.send(`clear ${player}`);
    await rcon.send(`gamemode survival ${player}`);
    await rcon.send(`tp ${player} ${xyz(arena.lobby)}`);
    await rcon.send(`effect give ${player} minecraft:resistance infinite 255 true`);
    await rcon.send(`effect give ${player} minecraft:saturation infinite 0 true`);
}
async function kit(player, first) {
    const t = teamOf[player];
    const d = teams[t];
    const cmds = [
        ...(first ? [`clear ${player}`, `effect clear ${player} minecraft:resistance`] : []),
        `tag ${player} add bw_${t}`,
        `spawnpoint ${player} ${xyz(d.spawn)}`,
        ...(first ? [`tp ${player} ${xyz(d.spawn)}`] : []),
        `gamemode survival ${player}`,
        `give ${player} minecraft:wooden_sword 1`,
        ...(first ? [`give ${player} minecraft:${t}_wool 16`] : []),
        `item replace entity ${player} armor.head with minecraft:leather_helmet[dyed_color=${d.color}]`,
        `item replace entity ${player} armor.chest with minecraft:leather_chestplate[dyed_color=${d.color}]`,
        `effect give ${player} minecraft:saturation infinite 0 true`,
    ];
    for (const c of cmds) await rcon.send(c);
    await applyUpgrades(t);
}

const enchant = (name, level) =>
    JSON.stringify({ function: 'minecraft:set_enchantments', enchantments: { [`minecraft:${name}`]: level } });
async function applyUpgrades(t) {
    const u = state.teams[t].upgrades;
    const who = `@a[tag=bw_${t},gamemode=survival]`;
    if (u.sharpness)
        for (let i = 0; i < 9; i++)
            await rcon.send(
                `execute as ${who} if items entity @s hotbar.${i} #minecraft:swords unless items entity @s hotbar.${i} *[minecraft:enchantments~[{enchantments:"minecraft:sharpness"}]] run item modify entity @s hotbar.${i} ${enchant('sharpness', 1)}`,
            );
    if (u.protection)
        for (const slot of ['head', 'chest', 'legs', 'feet'])
            await rcon.send(
                `execute as ${who} if items entity @s armor.${slot} * run item modify entity @s armor.${slot} ${enchant('protection', Math.min(3, u.protection))}`,
            );
}

const logFile = path.join(serverDir, 'logs', 'latest.log');
let logPos = existsSync(logFile) ? statSync(logFile).size : 0;
function newLogLines() {
    if (!existsSync(logFile)) return [];
    const size = statSync(logFile).size;
    if (size < logPos) logPos = 0;
    if (size === logPos) return [];
    const fd = openSync(logFile, 'r');
    const buf = Buffer.alloc(size - logPos);
    readSync(fd, buf, 0, buf.length, logPos);
    closeSync(fd);
    logPos = size;
    return buf.toString('utf8').split('\n');
}

const pendingKits = new Map();
async function onDeath({ victim, killer, message }) {
    const t = teamOf[victim];
    const me = state.teams[t].players[victim];
    if (state.status !== 'running' || me.eliminated) return;
    me.deaths++;
    const final = !state.teams[t].bed;
    if (killer && teamOf[killer] !== t) {
        const k = state.teams[teamOf[killer]].players[killer];
        k.kills++;
        if (final) k.finalKills++;
    }
    event('death', { victim, killer, final, message });
    if (final) {
        me.eliminated = true;
        await announce(`${victim} is ELIMINATED${killer ? ` by ${killer}` : ''}.`, 'red');
        await rcon.send(`kick ${victim} Eliminated: your bed was gone when you died. Game over for you.`);
    } else pendingKits.set(victim, Date.now() + 1500);
}
async function checkBeds() {
    for (const [t, d] of Object.entries(teams)) {
        const team = state.teams[t];
        if (!team.bed) continue;
        const standing = (await rcon.send(`execute if block ${xyz(d.bed.head)} minecraft:${t}_bed`)).includes(
            'Test passed',
        );
        if (standing) continue;
        team.bed = false;
        team.bedBrokenAt = new Date().toISOString();
        event('bed_broken', { team: t });
        await announce(`${t.toUpperCase()} BED DESTROYED! Their next deaths are final.`, 'red');
        await rcon.send(`title @a[tag=bw_${t}] title ${JSON.stringify({ text: 'Your bed is gone', color: 'red' })}`);
    }
}
const drop = (at, item, n = 1) =>
    rcon.send(
        `summon minecraft:item ${at[0] + 0.5} ${at[1] + 0.2} ${at[2] + 0.5} {Item:{id:"minecraft:${item}",count:${n}},PickupDelay:0,Motion:[0.0,0.0,0.0]}`,
    );
const last = {};
async function generators() {
    const g = arena.generators;
    const due = (key, every) => {
        if (now() - (last[key] ?? 0) < every) return false;
        last[key] = now();
        return true;
    };
    for (const [t, d] of Object.entries(teams)) {
        const speed = 1 + 0.5 * (state.teams[t].upgrades.forge ?? 0);
        if (due(`iron_${t}`, g.ironEverySeconds / speed)) await drop(d.generator, 'iron_ingot');
        if (due(`gold_${t}`, g.goldEverySeconds / speed)) await drop(d.generator, 'gold_ingot');
        if (state.teams[t].upgrades.heal_pool && due(`heal_${t}`, 5))
            await rcon.send(
                `effect give @a[tag=bw_${t},x=${d.spawn[0]},y=${d.spawn[1]},z=${d.spawn[2]},distance=..10] minecraft:regeneration 6 0 true`,
            );
    }
    if (due('diamond', g.diamondEverySeconds)) for (const at of arena.diamondGenerators) await drop(at, 'diamond');
    if (due('emerald', g.emeraldEverySeconds)) for (const at of arena.emeraldGenerators) await drop(at, 'emerald');
}

async function finish(winner, reason) {
    state.status = 'over';
    state.winner = winner;
    state.reason = reason;
    state.endedAt = new Date().toISOString();
    const message = winner ? `${winner.toUpperCase()} TEAM WINS (${reason})` : `DRAW (${reason})`;
    event('game_over', { winner, reason });
    await announce(message, 'green');
    await rcon.send(`title @a title ${JSON.stringify({ text: message, color: 'green' })}`);
    save();
    writeFileSync(path.join(out, 'result.json'), JSON.stringify({ ...snapshot(), events }, null, 1));
    await sleep(3000);
    for (const p of players) if (await online(p)) await rcon.send(`kick ${p} Game over: ${message}`);
    console.log(`Result written to ${path.join(out, 'result.json')}`);
}
function decide() {
    const view = snapshot();
    const alive = Object.entries(view.teams).filter(([, d]) => d.bed || d.alive.length > 0);
    if (alive.length === 1) return [alive[0][0], 'last team standing'];
    if (alive.length === 0) return [null, 'everyone eliminated'];
    if (now() < state.endsAt) return null;
    const rank = ([, d]) => [d.finalKills, d.bed ? 1 : 0, d.kills];
    const sorted = Object.entries(view.teams).sort((a, b) => {
        const [x, y] = [rank(a), rank(b)];
        for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return y[i] - x[i];
        return 0;
    });
    const tie = rank(sorted[0]).join() === rank(sorted[1]).join();
    return tie ? [null, 'time up, tied'] : [sorted[0][0], 'time up: final kills, then beds, then kills'];
}

async function buy({ player, item, quantity = 1 }) {
    const t = teamOf[player];
    if (!t) throw new Error(`${player} is not on a team`);
    if (state.status !== 'running') throw new Error(`The game is ${state.status}; the shop opens when it starts.`);
    if (state.teams[t].players[player].eliminated) throw new Error('You are eliminated.');
    const pos = (await rcon.send(`data get entity ${player} Pos`))
        .match(/-?\d+(\.\d+)?/g)
        ?.map(Number)
        .slice(-3);
    if (!pos) throw new Error(`${player} is not online`);
    const shopAt = teams[t].spawn;
    const distance = Math.hypot(pos[0] - shopAt[0], pos[1] - shopAt[1], pos[2] - shopAt[2]);
    if (distance > 8)
        throw new Error(`You are ${distance.toFixed(1)} blocks from your shop; go to ${xyz(shopAt)} first.`);
    const upgrade = arena.upgrades[item];
    const offer = arena.shop[item];
    if (!upgrade && !offer) throw new Error(`Unknown item ${item}`);
    const q = upgrade ? 1 : Math.max(1, Math.min(8, Math.floor(quantity)));
    const level = upgrade ? (state.teams[t].upgrades[item] ?? 0) : 0;
    if (upgrade && level >= upgrade.costs.length) throw new Error(`Your team already has ${item} at its top level.`);
    const [currency, price] = upgrade ? ['diamond', upgrade.costs[level]] : [offer.cost[0], offer.cost[1] * q];
    const found = Number((await rcon.send(`clear ${player} minecraft:${currency} 0`)).match(/(\d+)/)?.[1] ?? 0);
    if (found < price) throw new Error(`Need ${price} ${currency}; you have ${found}.`);
    const removed = await rcon.send(`clear ${player} minecraft:${currency} ${price}`);
    if (!/Removed \d+/.test(removed)) throw new Error(`Payment failed: ${removed}`);
    if (upgrade) {
        state.teams[t].upgrades[item] = level + 1;
        await applyUpgrades(t);
        event('upgrade', { player, team: t, item, level: level + 1 });
        return {
            bought: `${item} level ${level + 1} for your whole team`,
            effect: upgrade.label,
            paid: `${price} diamond`,
        };
    }
    for (let i = 0; i < q; i++) {
        if (offer.armor)
            for (const piece of ['legs', 'feet'])
                await rcon.send(
                    `item replace entity ${player} armor.${piece} with minecraft:${offer.armor}_${piece === 'legs' ? 'leggings' : 'boots'}`,
                );
        for (const [id, n] of offer.gives ?? [])
            await rcon.send(`give ${player} minecraft:${id === 'team_wool' ? `${t}_wool` : id} ${n}`);
    }
    await applyUpgrades(t);
    event('buy', { player, team: t, item, quantity: q, paid: price, currency });
    return { bought: `${q}x ${item}`, received: offer.label, paid: `${price} ${currency}` };
}

function startHttp() {
    const server = createServer(async (req, res) => {
        const reply = (code, data) => {
            res.writeHead(code, { 'content-type': 'application/json' });
            res.end(JSON.stringify(data));
        };
        try {
            const url = new URL(req.url, 'http://referee');
            if (req.method === 'GET' && url.pathname === '/status') {
                const view = snapshot();
                const player = url.searchParams.get('player');
                return reply(200, { ...(player && teamOf[player] ? { yourTeam: teamOf[player] } : {}), ...view });
            }
            if (req.method === 'POST' && url.pathname === '/buy') {
                let body = '';
                for await (const chunk of req) body += chunk;
                return reply(200, await buy(JSON.parse(body || '{}')));
            }
            reply(404, { error: 'not found' });
        } catch (error) {
            reply(400, { error: String(error?.message ?? error) });
        }
    });
    server.listen(arena.refereePort, '127.0.0.1');
    return server;
}

async function main() {
    await rcon.connect();
    await buildArena();
    const http = startHttp();
    state.status = 'waiting';
    save();
    event('ready', { players, lobby: arena.lobby, port: arena.refereePort });
    const held = new Set();
    const waitUntil = now() + arena.startTimeoutSeconds;
    while (state.status === 'waiting') {
        for (const p of players)
            if (!held.has(p) && (await online(p))) {
                await holdInLobby(p);
                held.add(p);
                event('lobby', { player: p, team: teamOf[p] });
            }
        const everyone = held.size === players.length;
        const someEachSide = Object.values(teams).every(d => d.players.some(p => held.has(p)));
        if ((arena.startWhenOnline && everyone) || (now() > waitUntil && someEachSide)) break;
        await sleep(2000);
    }
    await placeBeds();
    state.status = 'running';
    state.startedAt = new Date().toISOString();
    state.endsAt = now() + durationSec;
    for (const p of players) if (await online(p)) await kit(p, true);
    const kitted = new Set(players.filter(p => held.has(p)));
    event('game_start', { minutes: durationSec / 60 });
    await announce(`Game on! ${Math.round(durationSec / 60)} minutes. Protect your bed, break theirs.`, 'green');
    let lastBedCheck = 0;
    for (;;) {
        for (const line of newLogLines()) {
            const death = parseDeath(line, teamOf);
            if (death) await onDeath(death);
        }
        for (const [p, at] of pendingKits)
            if (Date.now() >= at) {
                pendingKits.delete(p);
                if (await online(p)) await kit(p, false);
            }
        for (const p of players)
            if (!kitted.has(p) && !state.teams[teamOf[p]].players[p].eliminated && (await online(p))) {
                await kit(p, true);
                kitted.add(p);
            }
        if (now() - lastBedCheck >= 1) {
            lastBedCheck = now();
            await checkBeds();
        }
        await generators();
        save();
        const verdict = decide();
        if (verdict) {
            await finish(...verdict);
            break;
        }
        await sleep(500);
    }
    http.close();
    rcon.close();
}

main().catch(error => {
    console.error(`referee: ${error.message}`);
    process.exit(1);
});
