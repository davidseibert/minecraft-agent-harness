# Bed Wars

Two teams of agents play Bed Wars on floating islands over the void. Each team defends a bed: while it stands, its
players respawn; once it is broken, their next death eliminates them. Generators drop iron and gold at each base and
diamonds and emeralds on the middle islands, and agents spend them in a shop through a `buy` tool.

The example is three pieces on top of the normal harness:

- `referee.mjs` builds the arena over RCON, holds players in a sealed lobby until everyone is online, starts the game,
  hands out kits, runs the generators, watches the beds, reads deaths from the server log, scores the game and serves
  the shop. It writes `state.json` while the game runs and `result.json` at the end.
- `tools.mjs` adds `buy` and `bedwars_status` to every agent through the harness's `toolsModule` option. Both call the
  referee on `127.0.0.1`, so the referee checks the price, the player's position and inventory before anything changes.
- `red.json` and `blue.json` are ordinary team files: two agents each, their own state directory (so DMs, notes and
  the shared machine stay inside the team) and the objective that explains the rules.

`arena.json` holds the layout, generator rates, shop prices, team upgrades, player names and game length.

## Run it

From the repository root, with a model key in `.env`:

```sh
npm run server -- --dir server-bedwars --world void --rcon-password change-me
```

In a second terminal, once the server says `Done`:

```sh
node examples/bedwars/referee.mjs --server server-bedwars --minutes 10
```

Then start both teams (two more terminals, or background them):

```sh
npx minecraft-agent team examples/bedwars/red.json
npx minecraft-agent team examples/bedwars/blue.json
```

The referee starts the game as soon as all four players are in the lobby (or after `startTimeoutSeconds` if each team
has at least one player online). Join `localhost:25565` from Minecraft 1.21.6 to watch; `/gamemode spectator` needs
`op <you>` in the server console first.

When a team is wiped out or the clock runs out, the referee announces the winner, kicks everyone with a `Game over`
message (the harness treats that as final and does not reconnect) and writes
`.agent-state/bedwars/result.json`:

```json
{
  "status": "over",
  "winner": "blue",
  "reason": "last team standing",
  "teams": {
    "red": { "bed": false, "alive": [], "finalKills": 0 },
    "blue": { "bed": true, "alive": ["Blue1", "Blue2"] }
  }
}
```

## Changing it

- More players: add names to `arena.json` and the matching `agents` lists in `red.json` and `blue.json`.
- Different models per team: set `model` in `red.json` or `blue.json`.
- Shop and upgrades: edit `shop` and `upgrades` in `arena.json`. Items list what they give; armor entries replace the
  leggings and boots.
- The server needs RCON for the referee. `--world void` only matters the first time the world is created; delete
  `server-bedwars/world*` to rebuild it.

Rules in short: final kills decide a timed-out game, then beds still standing, then kills. Falling into the void
counts as a death. Players who join late are kitted and sent to their base as long as they are not eliminated.
