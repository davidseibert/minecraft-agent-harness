import { pathToFileURL } from 'node:url';

const output = process.stdout;
let input = '';
let inputBytes = 0;
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
    inputBytes += Buffer.byteLength(chunk);
    if (inputBytes > 256 * 1024) process.exit(1);
    input += chunk;
});
process.stdin.on('end', async () => {
    try {
        const { code, outputBytes } = JSON.parse(input);
        if (
            typeof code !== 'string' ||
            Buffer.byteLength(code) > 32768 ||
            !Number.isSafeInteger(outputBytes) ||
            outputBytes < 2048 ||
            outputBytes > 32768
        )
            throw Error();
        await import(pathToFileURL(process.argv[2]).href);
        lockdown({ errorTaming: 'safe', consoleTaming: 'safe', stackFiltering: 'concise' });
        const compartment = new Compartment();
        const serialized = compartment.evaluate(`JSON.stringify((function () { "use strict";\n${code}\n})())`);
        if (typeof serialized !== 'string' || Buffer.byteLength(serialized) > outputBytes - 128) throw Error();
        output.end(`{"ok":true,"result":${serialized}}`);
    } catch {
        output.end('{"ok":false}');
    }
});
