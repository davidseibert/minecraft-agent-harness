const installed = new WeakSet();

export function installOxygenIsolation(bot) {
    if (installed.has(bot)) return bot;
    const client = bot._client;
    if (typeof client?.emit !== 'function' || typeof bot.emit !== 'function') {
        throw new Error('Oxygen isolation requires a Mineflayer client and bot emitter.');
    }
    const descriptor = Object.getOwnPropertyDescriptor(bot, 'oxygenLevel');
    if (descriptor && (!descriptor.configurable || descriptor.get || descriptor.set || !descriptor.writable)) {
        throw new Error('Oxygen isolation requires an ordinary writable oxygenLevel property.');
    }
    let oxygen = bot.oxygenLevel;
    let foreignMetadata = false;
    Object.defineProperty(bot, 'oxygenLevel', {
        configurable: true,
        enumerable: descriptor?.enumerable ?? true,
        get: () => oxygen,
        set: value => {
            if (!foreignMetadata) oxygen = value;
        },
    });
    const emitClient = client.emit;
    client.emit = function (name, packet, ...rest) {
        if (name !== 'entity_metadata') return emitClient.call(this, name, packet, ...rest);
        const previous = foreignMetadata;
        foreignMetadata = bot.entity?.id == null || packet?.entityId !== bot.entity.id;
        try {
            return emitClient.call(this, name, packet, ...rest);
        } finally {
            foreignMetadata = previous;
        }
    };
    const emitBot = bot.emit;
    bot.emit = function (name, ...args) {
        if (name === 'breath' && foreignMetadata) return false;
        return emitBot.call(this, name, ...args);
    };
    installed.add(bot);
    return bot;
}
