const WHISPER = /^(tell|msg|w) ([A-Za-z0-9_]{1,16}) /;

export function allowWhisper(client, username, ms = 2000) {
    client.pi_whisperAllowance = { to: String(username).toLowerCase(), until: Date.now() + ms };
}

function isAllowedWhisper(client, command) {
    const grant = client.pi_whisperAllowance;
    const match = WHISPER.exec(String(command ?? ''));
    return Boolean(grant && match && Date.now() <= grant.until && match[2].toLowerCase() === grant.to);
}

export function guardPlayerChat(client) {
    const send = client.write.bind(client);
    client.write = (name, data, ...rest) => {
        if (name.startsWith('chat_command') && isAllowedWhisper(client, data?.command))
            return send(name, data, ...rest);
        if (
            name.startsWith('chat_command') ||
            ((name === 'chat' || name === 'chat_message') &&
                String(data?.message || '')
                    .trimStart()
                    .startsWith('/'))
        ) {
            console.warn('Refused slash command from survival agent.');
            return;
        }
        return send(name, data, ...rest);
    };
}
