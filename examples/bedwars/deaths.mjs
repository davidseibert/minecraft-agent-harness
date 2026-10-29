const DEATH =
    /\b(was slain|was shot|fell|hit the ground|was doomed|was knocked|was killed|died|drowned|burned|went up in flames|was blown|was squashed|was pummeled|was fireballed|suffocated|starved|withered|tried to swim|walked into|was struck|was impaled|experienced kinetic|left the confines|didn.t want to live|was obliterated|was poked|was stung|froze)\b/;
export function parseDeath(line, known) {
    const m = /\]: (.*)$/.exec(line);
    if (!m) return null;
    const message = m[1].trim();
    const [victim, rest = ''] = message.split(/ (.*)/s);
    if (!known[victim] || !DEATH.test(rest)) return null;
    const killer = (rest.match(/[A-Za-z0-9_]{3,16}/g) ?? []).find(n => known[n] && n !== victim) ?? null;
    return { victim, killer, message };
}
