#!/usr/bin/env node
import { main } from '../src/cli.js';

main().then(
    code => {
        if (code) process.exitCode = code;
    },
    error => {
        console.error(`minecraft-agent: ${error?.message ?? error}`);
        process.exit(1);
    },
);
