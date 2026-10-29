# Contributing

## Setup

```sh
npm ci
npm test
```

Use Node.js 22.19 or newer. Installation applies the dependency fixes in `patches/`.
The test suite needs no Minecraft server and no model key. The live Docker sandbox test runs when Docker is up and
`node:22-bookworm` is pulled, and is skipped otherwise.

## Checks

Run all of these before opening a pull request:

```sh
npm run lint
npm run format:check
npm test
```

`npm run check` runs the three in order.

## Trying a change end to end

Start the local Paper server in one terminal:

```sh
npm run server
```

Run an agent in another:

```sh
npm start -- -o "Build a 5x5 oak platform at spawn" --duration 10
```

Watch `.agent-state/<name>/telemetry.jsonl` for tool calls, failures and hits, or join the server yourself.

## Conventions

- ES modules, 4-space indentation, Prettier formatting (`npm run format`).
- No inline comments. Say it with names, small functions and tests; put explanations in `docs/`.
- New tools go in `src/tools/`. Body tools must honour the `AbortSignal` they receive and settle only after their world
  action has stopped. Return structured results and use `withFailureCode` so the model gets a stable reason.
- Tests live in `test/`, mirroring `src/`, and use `node:test`.
- Changes to the prompt (`src/prompt.js`) or to tool descriptions change agent behaviour; mention them in the pull
  request.
- Modifying a dependency? Edit it under `node_modules/`, then `npx patch-package <name>` to regenerate its patch.
