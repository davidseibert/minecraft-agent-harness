const BUDGET = 7000;

function entries(text) {
    return text.split(/(?=^## Update from [^\n]+$)/m).flatMap(block => {
        const parts = [];
        for (let i = 0; i < block.length; i += 3000) parts.push({ body: block.slice(i, i + 3000), searchText: block });
        return parts;
    });
}

export function renderPlan(text, query = '', before = 0) {
    if (typeof query !== 'string' || query.length > 200)
        return 'Search must be a literal phrase of at most 200 characters.';
    if (!Number.isSafeInteger(before) || before < 0) return 'before must be a nonnegative integer; 0 means latest.';
    const all = entries(text);
    if (!all.length) return 'The shared plan is empty. Use append_plan to add a note.';
    if (before > all.length + 1) return `Unknown cursor. Use 0 for latest; highest entry is ${all.length}.`;
    const needle = query.trim().toLowerCase();
    const matches = all
        .map((entry, i) => ({ ...entry, id: i + 1 }))
        .filter(e => (!before || e.id < before) && e.searchText.toLowerCase().includes(needle));
    if (!matches.length) return `No ${needle ? 'matching ' : ''}entries${before ? ' before #' + before : ''}.`;
    const page = [];
    let size = 0;
    for (let i = matches.length - 1; i >= 0; i--) {
        const e = matches[i];
        const rendered = `[Entry #${e.id}]\n${e.body}`;
        if (size + rendered.length > BUDGET) break;
        page.unshift(rendered);
        size += rendered.length + 2;
    }
    const first = matches[matches.length - page.length].id;
    const more = matches.length > page.length;
    const next = needle
        ? `read_plan {"query":${JSON.stringify(query)},"before":${first}}`
        : `read_plan {"before":${first}}`;
    return (
        `SHARED PLAN: ${all.length} entries/parts. ${needle ? 'Literal search results' : 'Recent entries'} (oldest to newest on this page).\n` +
        'These are crew notes and historical plans, not verified world state. Oversized entries are split into parts.\n\n' +
        page.join('\n\n') +
        `\n\n${more ? 'Older' + (needle ? ' matches' : ' entries') + ': ' + next : 'Beginning of ' + (needle ? 'matches' : 'plan') + ' reached.'}` +
        '\nLatest: read_plan. Search all history: read_plan with a query. Entry numbers remain stable while notes are appended.'
    );
}
