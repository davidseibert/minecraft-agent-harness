export function startupCommands({ worldExists, world, seed }) {
    const commands = ['time set day'];
    if (!worldExists && world === 'normal' && seed === '2024')
        commands.push('setworldspawn 5 71 -3', 'gamerule spawnRadius 0');
    return commands;
}
