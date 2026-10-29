const NAMES = ['peaceful', 'easy', 'normal', 'hard'];
const normalize = d => (typeof d === 'number' ? NAMES[d] : NAMES.includes(String(d)) ? String(d) : undefined);
export function installDifficulty(bot) {
    const client = bot?._client;
    if (!client?.on || bot.pi_difficultyInstalled) return;
    bot.pi_difficultyInstalled = true;
    client.on('difficulty', p => {
        const d = normalize(p?.difficulty);
        if (d) bot.pi_difficulty = d;
    });
}
export const currentDifficulty = bot => bot?.pi_difficulty ?? normalize(bot?.game?.difficulty);
