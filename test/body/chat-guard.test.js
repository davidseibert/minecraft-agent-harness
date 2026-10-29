import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guardPlayerChat } from '../../src/body/chat-guard.js';
test('guards final packets including multiline/chunk split commands before login', () => {
    const sent = [];
    const client = { write: (n, d) => sent.push([n, d]) };
    guardPlayerChat(client);
    const chat = message => {
        for (const line of message.split('\n'))
            for (let i = 0; i < line.length; i += 256) {
                const p = line.substring(i, i + 256);
                client.write(p.startsWith('/') ? 'chat_command' : 'chat_message', { message: p });
            }
    };
    chat('hello\n/kill');
    chat('a'.repeat(256) + '/gamemode creative');
    client.write('chat_command_signed', { command: 'tp 0 0 0' });
    client.write('chat', { message: '  /tp 0 0 0' });
    client.write('position', { x: 1 });
    assert.deepEqual(sent, [
        ['chat_message', { message: 'hello' }],
        ['chat_message', { message: 'a'.repeat(256) }],
        ['position', { x: 1 }],
    ]);
});

test('only a whisper the harness itself just sent passes the guard', async () => {
    const { allowWhisper } = await import('../../src/body/chat-guard.js');
    const sent = [];
    const client = { write: (n, d) => sent.push([n, d]) };
    guardPlayerChat(client);
    client.write('chat_command', { command: 'tell Steve hi' });
    allowWhisper(client, 'Steve');
    client.write('chat_command', { command: 'tell Steve hello there' });
    client.write('chat_command', { command: 'tell Alex sneaky' });
    client.write('chat_command', { command: 'op Steve' });
    assert.deepEqual(sent, [['chat_command', { command: 'tell Steve hello there' }]]);
});
