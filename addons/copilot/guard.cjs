// Co-pilot: was a proposal part of what the user asked? Text the co-pilot
// reads (cards, chats, lorebooks) can carry instructions, and a model may
// follow them. So a proposal whose target the user's message doesn't point
// at gets a note on its card ("not part of what you asked") and is left out
// of Apply all; the user can still apply it with its own click.
//
// Only the user's own typed message counts: never words the model wrote (a
// prompt's name, a choice it offered). What counts as asked:
// - the target named in the message (its name or file name), or the target
//   is one of the items in front of the user (the open chat and its card, the
//   persona in use, the selected preset, something they ticked) and the
//   message names its kind ("card", "messages", "preset"…). Each word belongs
//   to one kind only, and card phrases ("first message", "system prompt") are
//   taken out before chat, persona and preset words are looked for;
// - something new: a word for making one together with its kind ("a new
//   character", "create a preset"); its name alone proves nothing (the model
//   chose it);
// - a card's system prompt and post-history instructions only when named;
//   when the message names card fields, only those; when it names message
//   numbers, only those messages; a new message only with a word for adding.
'use strict';

const KIND_WORDS = {
    card: ['card', 'cards', 'character', 'characters', 'char', 'bot', 'description', 'personality', 'scenario', 'first message', 'greeting', 'first greeting',
        'example dialogue', 'examples', 'dialogue', 'creator notes', 'tags', 'tag', 'system prompt', 'post history', 'alternate greetings'],
    lorebook: ['lorebook', 'lorebooks', 'lore', 'world info', 'worldinfo', 'entry', 'entries', 'keyword', 'keywords'],
    chat: ['chat', 'chats', 'message', 'messages', 'conversation', 'swipe', 'swipes'],
    persona: ['persona', 'personas'],
    preset: ['preset', 'presets', 'sampler', 'samplers', 'prompt', 'prompts', 'temperature', 'top p', 'top k', 'min p', 'penalty', 'max tokens', 'context size'],
};
// Card phrases that hold other kinds' words ("first message", "system prompt").
const CARD_PHRASES = ['first message', 'system prompt', 'post history', 'example dialogue', 'example messages', 'creator notes'];
const MAKE_WORDS = ['make', 'create', 'new', 'another', 'build', 'generate'];
const MAKE_KIND = { card: ['card', 'character', 'bot'], lorebook: ['lorebook', 'lore', 'world info'], persona: ['persona'], preset: ['preset'] };
const ADD_WORDS = ['add', 'insert', 'write', 'new'];
const FIELDS = {
    description: ['description'], personality: ['personality'], scenario: ['scenario'], first_mes: ['first message', 'greeting', 'first greeting'],
    mes_example: ['example dialogue', 'example messages', 'examples', 'dialogue'], creator_notes: ['creator notes'], tags: ['tags', 'tag'],
    alternate_greetings: ['alternate greetings', 'alternate greeting'], system_prompt: ['system prompt'], post_history_instructions: ['post history'],
};
const SENSITIVE = ['system_prompt', 'post_history_instructions'];
const FIELD_LABEL = { first_mes: 'first message', mes_example: 'example dialogue', creator_notes: 'creator notes', alternate_greetings: 'alternate greetings', system_prompt: 'system prompt', post_history_instructions: 'post-history instructions' };
const LABEL = { card: 'card', lorebook: 'lorebook', chat: 'chat', persona: 'persona', preset: 'preset' };

const fold = s => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[-_]+/g, ' ');
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordRe = w => new RegExp(`(^|[^\\p{L}\\p{N}])${escape(fold(w).trim()).replace(/\s+/g, '\\s+')}($|[^\\p{L}\\p{N}])`, 'u');
// A word or phrase on its own in the text ("card" is not in "cardinal").
const has = (text, word) => fold(word).trim().length >= 2 && wordRe(word).test(text);
const stem = file => String(file ?? '').replace(/\.[a-z0-9]+$/i, '');
const withoutCardPhrases = text => CARD_PHRASES.reduce((t, ph) => t.replace(new RegExp(wordRe(ph).source, 'gu'), ' '), text);

// Message numbers the text names: "message 5", "messages 3-4", "#12", "messages 2, 3 and 7".
function numbersIn(text) {
    const out = new Set();
    const span = /(?:messages?|msgs?)\s*#?\s*(\d+(?:\s*(?:,|and|to|-|–)\s*#?\s*\d+)*)|#\s*(\d+)/gu;
    for (const m of text.matchAll(span)) {
        const part = m[1] ?? m[2];
        for (const piece of part.split(/\s*(?:,|and)\s*/)) {
            const r = piece.match(/(\d+)\s*(?:to|-|–)\s*#?\s*(\d+)/);
            if (r) { for (let i = Number(r[1]); i <= Math.min(Number(r[2]), Number(r[1]) + 200); i++) out.add(i); } else if (/\d/.test(piece)) out.add(Number(piece.replace(/\D/g, '')));
        }
    }
    return [...out];
}

// What a proposal is about: its kind, the names that point at it, whether it
// is one of the current or ticked items, whether it makes something new.
function targetOf(p, { ticked = [], current = {}, names = {} }) {
    const isTicked = (kind, key) => ticked.some(t => t.kind === kind && t.key === key);
    const charName = a => (names.characters || []).find(c => c.avatar === a)?.name;
    const personaName = a => (names.personas || []).find(c => c.avatar === a)?.name;
    switch (p.op) {
        case 'edit_card':
            return { kind: 'card', names: [charName(p.avatar), stem(p.avatar)], label: charName(p.avatar) || p.avatar, near: p.avatar === current.avatar || isTicked('card', p.avatar) };
        case 'create_card': return { kind: 'card', make: true };
        case 'create_lorebook': return { kind: 'lorebook', make: true };
        case 'create_persona': return { kind: 'persona', make: true };
        case 'create_preset': return { kind: 'preset', make: true };
        case 'add_lorebook_entry': case 'edit_lorebook_entry': case 'delete_lorebook_entry':
            return { kind: 'lorebook', names: [p.book], label: p.book, near: isTicked('lorebook', p.book) };
        case 'edit_message': case 'add_message': case 'delete_messages': case 'hide_messages': case 'unhide_messages': {
            const chat = p.shown?.chatId ?? current.chatId;
            return { kind: 'chat', names: [], label: 'the chat', near: !!chat && (chat === current.chatId || isTicked('messages', chat)) };
        }
        case 'edit_persona': {
            const a = p.avatar ?? p.shown?.avatar ?? current.persona;
            return { kind: 'persona', names: [personaName(a), stem(a)], label: personaName(a) || a, near: a === current.persona || isTicked('persona', a) };
        }
        default:
            // Preset settings and prompts. A setting's own name counts like the
            // kind (only allow-listed settings can be applied); prompt names
            // and identifiers are the model's words and don't.
            return { kind: 'preset', names: [p.name], label: p.name, near: p.name === current.preset || isTicked('preset', p.name), words: p.op === 'edit_preset_setting' && p.key ? [p.key] : [] };
    }
}

// null when the proposal is part of what the user asked, else a short reason.
function outside(p, c) {
    const raw = fold(c.text);
    const t = targetOf(p, c);
    const text = t.kind === 'card' ? raw : withoutCardPhrases(raw);
    if (t.make) {
        const ok = MAKE_WORDS.some(w => has(raw, w)) && MAKE_KIND[t.kind].some(w => has(text, w));
        return ok ? null : `A new ${LABEL[t.kind]} wasn't part of what you asked.`;
    }
    const named = t.names.some(n => n && has(text, n));
    const kindNamed = KIND_WORDS[t.kind].some(w => has(text, w)) || (t.words || []).some(w => has(text, w));
    if (!named && !(t.near && kindNamed)) {
        if (t.kind === 'chat') return 'The chat\'s messages weren\'t part of what you asked.';
        return `The ${LABEL[t.kind]} "${t.label}" wasn't part of what you asked.`;
    }
    if (p.op === 'edit_card') {
        const fieldsNamed = Object.keys(FIELDS).filter(f => FIELDS[f].some(w => has(raw, w)));
        if ((SENSITIVE.includes(p.field) || fieldsNamed.length) && !fieldsNamed.includes(p.field)) return `The card's ${FIELD_LABEL[p.field] || p.field} wasn't part of what you asked.`;
    }
    if (t.kind === 'chat') {
        if (p.op === 'add_message') return ADD_WORDS.some(w => has(raw, w)) ? null : 'Adding a message wasn\'t part of what you asked.';
        const nums = numbersIn(text);
        const idx = p.op === 'edit_message' ? [p.index] : (p.indexes || []);
        if (nums.length && idx.some(i => !nums.includes(i))) return `Message${idx.length === 1 ? '' : 's'} ${idx.filter(i => !nums.includes(i)).join(', ')} ${idx.length === 1 ? 'wasn\'t' : 'weren\'t'} part of what you asked.`;
    }
    return null;
}

module.exports = { outside, numbersIn, KIND_WORDS };
