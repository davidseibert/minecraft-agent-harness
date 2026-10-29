import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
    resolveConfig,
    toSettings,
    toAgentOptions,
    readConfigFile,
    fromEnv,
    parseModelRef,
    DEFAULTS,
} from './config.js';

export { resolveConfig, toSettings, toAgentOptions, readConfigFile, fromEnv, parseModelRef, DEFAULTS };
export { buildSystemPrompt } from './prompt.js';
export { createGameTools } from './tools/game-tools.js';
export { createMinecraftSession } from './model/session.js';

export async function startAgent(config, hooks = {}) {
    mkdirSync(path.join(config.stateDir, 'shared'), { recursive: true, mode: 0o700 });
    const { startAgent: run } = await import('./agent.js');
    return run(toSettings(config), { ...toAgentOptions(config), ...hooks });
}
