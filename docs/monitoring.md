# Watching from in game

`monitor-plugin/` is a Paper plugin that shows what the agents are doing inside Minecraft, so you can play fullscreen
instead of watching logs. Nothing is installed on your client. `docker compose up --build` builds it into the server
image.

Operators get the monitor automatically. Give yourself operator status once:

```sh
docker compose exec server rcon-cli op <your-name>
```

## What you see

The **sidebar** shows each agent's health, hunger, current action and held item. The action is green when the agent is
working, yellow when it is thinking or idle, and red when something is wrong:

| Label          | Meaning                                                      |
| -------------- | ------------------------------------------------------------ |
| `blocked`      | the body is stuck and the agent cannot act                   |
| `failing x3`   | three or more tool failures in a row with no success between |
| `no heartbeat` | the agent has not written its status for 15 seconds          |

The **feed** appears in chat. It is sent only to you, so agents never hear it. Hover over a line for the arguments or
the cause of death, and click a name to spectate that agent.

## Commands

| Command                                     | Does                                                     |
| ------------------------------------------- | -------------------------------------------------------- |
| `/watch`                                    | list agents with clickable `[inv]`, `[spectate]`, `[tp]` |
| `/inv <agent>`                              | read-only view of inventory, armor and offhand           |
| `/watch spectate <agent>`                   | switch to spectator and follow the agent                 |
| `/watch tp <agent>`                         | teleport to the agent                                    |
| `/watch back`                               | return to where you were, in your previous game mode     |
| `/watch dms`, `failures`, `deaths`, `tools` | toggle a part of the feed                                |
| `/watch sidebar`                            | toggle the sidebar                                       |

`dms`, `failures` and `deaths` start on. `tools` shows every tool call, plus cancellations (an action interrupted by a
DM, which is routine). Your toggles are saved on your player.

## How it works

Health, inventory and deaths come from Paper. DMs and tool calls never reach the server, so the plugin follows each
agent's `telemetry.jsonl` and `runtime-status.json` from the state directory, which compose mounts read-only at
`/agent-state`.

- DM text is limited by telemetry to about 500 characters. Longer messages end in `…`.
- The agents' own reasoning is not in telemetry, so it stays in `docker compose logs`.
- The feed starts from the moment the server starts. Earlier history is not replayed.
- An agent stays in the sidebar as `offline` for 10 minutes after it stops writing status.

To use the plugin with `npm run server`, build the jar, copy it to `server/plugins/` and start the server with
`AGENT_STATE_DIR` set to your state directory (by default `.agent-state`).

Tests run as part of the image build. To run them alone:

```sh
docker build --target build monitor-plugin
```
