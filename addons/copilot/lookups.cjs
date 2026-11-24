// Co-pilot: running the read-only lookups a reply asks for. Every result goes
// back to the model as data (fenced in <lookup_results>), never acted on; an
// error is reported to the model as text, not thrown.
'use strict';
const { trimPreset } = require('./context.cjs');

const MAX_RESULT = 20000; // characters of one result
const MAX_LIST = 100;
const SEARCH_SCAN = 5000; // newest messages a search looks at

const fence = text => String(text).replace(/<\/lookup_results/gi, '<\\/lookup_results');

// What one lookup shows in the panel's step line.
const SUMMARY = {
    list_characters: a => (a.search ? `Searched characters for "${a.search}"` : 'Listed characters'),
    read_card: a => `Read the card ${a.avatar}`,
    list_chats: a => `Listed the chats of ${a.avatar}`,
    read_messages: a => `Read messages ${a.from}–${a.to}`,
    search_messages: a => `Searched the chat for "${a.text}"`,
    list_presets: () => 'Listed presets',
    read_preset: a => `Read the preset ${a.name}`,
    list_personas: () => 'Listed personas',
    read_persona: a => `Read the persona ${a.avatar ?? 'in use'}`,
    list_lorebooks: () => 'Listed lorebooks',
    read_lorebook: a => `Read the lorebook ${a.name}`,
    read_lorebook_entry: a => `Read entry ${a.uid} of ${a.name}`,
    count_tokens: () => 'Counted tokens',
};

// api: the add-on's api (api.sillytavern.page / request).
async function runOne(api, tool, a) {
    const page = (n, x) => api.sillytavern.page(n, x);
    switch (tool) {
        case 'list_characters': {
            const q = String(a.search || '').toLowerCase();
            const all = (await page('lists')).characters.filter(c => !q || c.name.toLowerCase().includes(q));
            return { count: all.length, characters: all.slice(0, MAX_LIST) };
        }
        case 'read_card': return page('character', { avatar: a.avatar });
        case 'list_chats': {
            const r = await api.sillytavern.request('POST', '/api/characters/chats', { avatar_url: a.avatar });
            // No chats folder: SillyTavern answers { error: true }.
            const list = (Array.isArray(r) ? r : []).filter(c => c && c.file_name);
            // Older chats keep dates as text ("2023-5-13 @14h 22m"): passed on as they are.
            const when = v => { const d = new Date(v); return Number.isNaN(d.getTime()) ? String(v ?? '') : d.toISOString(); };
            return { count: list.length, chats: list.slice(0, MAX_LIST).map(c => ({ file_name: c.file_name, messages: c.chat_items ?? null, size: c.file_size ?? null, last_used: c.last_mes ? when(c.last_mes) : null })) };
        }
        case 'read_messages': {
            const from = Math.max(0, a.from), to = Math.min(a.to, from + 199);
            return page('chatMessages', { from, to });
        }
        case 'search_messages': {
            const c = await page('context');
            if (!c.chatId) throw new Error('No chat is open.');
            const q = String(a.text).toLowerCase(), limit = Math.max(1, Math.min(50, a.limit || 20));
            const found = [];
            for (let to = c.messageCount - 1; to >= 0 && to >= c.messageCount - SEARCH_SCAN && found.length < limit; to -= 500) {
                const got = await page('chatMessages', { from: Math.max(0, to - 499), to });
                for (const m of got.messages.reverse()) {
                    if (m.text.toLowerCase().includes(q)) found.push({ index: m.index, name: m.name, isUser: m.isUser, text: m.text.slice(0, 400) });
                    if (found.length >= limit) break;
                }
            }
            return { chatId: c.chatId, matches: found.sort((x, y) => x.index - y.index) };
        }
        case 'list_presets': return { presets: (await page('lists')).presets };
        case 'read_preset': { const p = await page('preset', { name: a.name }); return { name: p.name, ...trimPreset(p.preset) }; }
        case 'list_personas': return { personas: (await page('lists')).personas };
        case 'read_persona': return page('persona', { avatar: a.avatar ?? null });
        case 'list_lorebooks': return { lorebooks: (await page('lists')).lorebooks };
        case 'read_lorebook': return page('lorebook', { name: a.name });
        case 'read_lorebook_entry': {
            const b = await page('lorebook', { name: a.name });
            const e = b.entries.find(x => x.uid === a.uid);
            if (!e) throw new Error(`The lorebook ${a.name} has no entry ${a.uid}.`);
            return e;
        }
        case 'count_tokens': return { count: (await page('tokenCounts', { texts: [a.text] })).counts[0] };
        default: throw new Error(`Unknown tool ${tool}.`);
    }
}

// Runs them in order. Returns { content (the message for the model), summary (lines for the panel) }.
async function run(api, lookups, signal) {
    const results = [], summary = [];
    for (const { tool, args } of lookups) {
        if (signal?.aborted) break;
        const label = (SUMMARY[tool] || (() => tool))(args);
        try {
            let text = JSON.stringify(await runOne(api, tool, args), null, 1);
            if (text.length > MAX_RESULT) text = `${text.slice(0, MAX_RESULT)}\n…(cut: ${text.length - MAX_RESULT} more characters; ask for less)`;
            results.push(`${tool} ${JSON.stringify(args)}:\n${text}`);
            summary.push(label);
        } catch (e) {
            const msg = String(e.message || e).slice(0, 300);
            results.push(`${tool} ${JSON.stringify(args)}:\nERROR: ${msg}`);
            summary.push(`${label}: ${msg}`);
        }
    }
    return { content: `<lookup_results>\n${fence(results.join('\n\n'))}\n</lookup_results>`, summary };
}

module.exports = { run, MAX_RESULT };
