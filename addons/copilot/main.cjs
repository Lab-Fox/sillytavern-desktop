// Co-pilot: the main part. Keeps the sessions (one list per SillyTavern
// folder), sends the conversation through the Connection Profile the user
// picked (api.sillytavern.page('generate')) and streams the reply to the
// side panel. This first version only talks: it reads and changes nothing.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ctx = require('./context.cjs');
const protocol = require('./protocol.cjs');
const lookups = require('./lookups.cjs');
const applier = require('./apply.cjs');
const guard = require('./guard.cjs');

const SYSTEM_PROMPT = protocol.systemPrompt();
const MAX_STEPS = 6;
const READ_BUDGET = 80000; // characters of lookup results in one turn
const MAX_TOKENS = 2048;

let api = null;
const page = (name, args) => api.sillytavern.page(name, args);
let busy = null; // { sessionId, text, ctl }

const hashOf = folder => crypto.createHash('sha1').update(path.resolve(folder).toLowerCase()).digest('hex').slice(0, 12);
const folder = () => api.sillytavern.folder();
const sessionsDir = () => path.join(api.dir, 'user', 'sessions', hashOf(folder()));
const SESSION_ID = /^[a-z0-9]+-[a-f0-9]{6}$/;

// dir: a session's folder (a reply that ends after a profile switch still
// goes to the folder it was started in).
function readSession(id, dir = sessionsDir()) {
    if (!SESSION_ID.test(String(id))) return null;
    let s;
    try { s = JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), 'utf8')); } catch { return null; }
    // A damaged or foreign file is skipped, never shown half.
    if (!s || s.id !== id || typeof s.name !== 'string' || !Array.isArray(s.messages)) return null;
    return s;
}
function saveSession(s, dir = sessionsDir()) {
    s.updatedAt = Date.now();
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${s.id}.json`);
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(s));
    fs.renameSync(`${file}.tmp`, file);
}
function listSessions() {
    let files = [];
    try { files = fs.readdirSync(sessionsDir()).filter(f => f.endsWith('.json')); } catch { /* none yet */ }
    return files.map(f => readSession(f.slice(0, -5))).filter(Boolean)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map(s => ({ id: s.id, name: s.name, updatedAt: s.updatedAt, count: s.messages.length }));
}
// A new session starts with the open chat's items ticked (when SillyTavern's page can tell).
async function newSession() {
    let context = [];
    try { context = await ctx.defaults(page); } catch { /* no page yet: start empty */ }
    const s = { id: `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`, name: 'New session', createdAt: Date.now(), updatedAt: Date.now(), messages: [], context };
    saveSession(s);
    setOpen(s.id);
    return s;
}

// Per folder, in the add-on's own settings: the open session and the chosen profile.
const perFolder = key => api.storage.get(key, {})[hashOf(folder())] ?? null;
const setPerFolder = (key, value) => { const m = api.storage.get(key, {}); m[hashOf(folder())] = value; api.storage.set(key, m); };
const setOpen = id => setPerFolder('openSession', id);
function currentSession() {
    const s = readSession(perFolder('openSession'));
    if (s) return s;
    const first = listSessions()[0];
    return first ? readSession(first.id) : null;
}

// The co-pilot works on this PC's SillyTavern of the app's profile, in its
// main tab (where its requests run; a second port's tab can come later).
function availability(tab) {
    const same = tab?.folder && path.resolve(tab.folder).toLowerCase() === path.resolve(folder()).toLowerCase();
    if (!tab || tab.kind !== 'main' || !same) return 'other-tab';
    if (!api.sillytavern.info().running) return 'server-stopped';
    return null;
}

// Two state calls at once (the panel loading and a tab change) make one session.
let creating = null;
async function state(tab) {
    const reason = availability(tab);
    // Where it can work, there is always a session (with the open chat's items).
    if (!reason && !currentSession()) await (creating ??= newSession().finally(() => { creating = null; }));
    return {
        available: !reason, reason, folder: folder(),
        sessions: listSessions(), current: currentSession(),
        profileId: perFolder('profile'),
        busy: busy ? { sessionId: busy.sessionId, text: busy.text } : null,
    };
}

const push = message => api.sidepanel.send(message);

// What the model is sent: the system prompt, the material the user ticked
// (read fresh), and the conversation. Replies that failed aren't part of it.
// The conversation as the model sees it (protocol.history: older lookup
// results only as their summary, failed replies left out).
const talk = s => protocol.history(s.messages);
async function requestFor(s, extra = null) {
    const c = await page('context').catch(() => null);
    const blocks = [];
    for (const item of (s.context || []).filter(i => i.on)) {
        try { blocks.push(await ctx.resolve(page, item, c)); } catch { /* shown in the tray; left out */ }
    }
    const material = ctx.material(blocks);
    return [{ role: 'system', content: SYSTEM_PROMPT }, ...(material ? [{ role: 'system', content: material }] : []), ...talk(s), ...(extra ? [{ role: 'user', content: extra }] : [])];
}

// Token counts through SillyTavern's tokenizer, cached piece by piece (a
// growing chat only costs its new messages).
let count = null;

// The tray: every item with its size, and the total of the next request.
// Kept while nothing it depends on changed (the items, the open chat and its
// length, the profile, the conversation), for at most 30 s.
let view = { key: '', at: 0, value: null };
async function contextView() {
    const s = currentSession();
    if (!s) return { items: [], system: 0, conversation: 0, total: 0, maxContext: 0, over: false };
    const c = await page('context').catch(() => null);
    const key = JSON.stringify([s.id, s.context, c?.chatId, c?.messageCount, perFolder('profile'), s.messages.length]);
    if (view.key === key && Date.now() - view.at < 30000) return view.value;
    const items = [];
    for (const item of s.context || []) {
        try { items.push({ ...item, tokens: (await ctx.measure(page, item, count, c)).tokens, error: '' }); } catch (e) { items.push({ ...item, tokens: 0, error: e.message || String(e) }); }
    }
    const [system, rule, ...turns] = await count([SYSTEM_PROMPT, ctx.MATERIAL_RULE, ...talk(s).map(m => m.content)]);
    const conversation = turns.reduce((n, x) => n + x, 0);
    const ticked = items.filter(it => it.on && !it.error);
    const total = system + conversation + (ticked.length ? rule + ticked.reduce((n, it) => n + it.tokens, 0) : 0);
    let maxContext = 0;
    try {
        const p = await page('profiles');
        const chosen = p.profiles?.find(x => x.id === perFolder('profile'));
        maxContext = chosen?.maxContext || p.currentMaxContext || 0;
    } catch { /* unknown */ }
    // Room is kept for the reply.
    const value = { items, system, conversation, total, maxContext, over: !!maxContext && total + MAX_TOKENS > maxContext };
    view = { key, at: Date.now(), value };
    return value;
}
function changeContext(fn) {
    const s = currentSession();
    if (!s) throw new Error('No session.');
    s.context = fn(s.context || []);
    saveSession(s);
    return true;
}

// One user message: ask, check the reply (one retry when it's not in the
// format), run its lookups and ask again with their results, up to
// MAX_STEPS requests. Nothing a reply proposes is applied here.
// What the user asked this turn: the last message they typed themselves. The
// answers they picked to the co-pilot's questions don't add to it: both the
// question and its choices were written by the model.
function askedText(messages) {
    for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (m.role === 'user' && !m.answer) return String(m.content || '');
    }
    return '';
}
// The items the user ticked in the tray, as the guard names them.
const tickedOf = (context, persona) => (context || []).filter(i => i.on).map(i => ({
    kind: i.kind,
    key: i.kind === 'messages' ? i.ref?.chatId : i.kind === 'card' ? i.ref?.avatar : i.kind === 'persona' ? (i.ref?.avatar ?? persona) : i.ref?.name,
}));

async function send(text, { choice } = {}) {
    text = String(text || '').trim();
    if (!text) throw new Error('Write a message first.');
    if (busy) throw new Error('The co-pilot is still answering.');
    if (!api.sillytavern.info().running) throw new Error('SillyTavern isn\'t running.');
    const s = currentSession() || await newSession();
    if (!s.messages.length && s.name === 'New session') s.name = text.replace(/\s+/g, ' ').slice(0, 40);
    s.messages.push({ role: 'user', content: text, at: Date.now(), ...(choice !== undefined ? { answer: true, choice: String(choice) } : {}) });
    saveSession(s);
    setOpen(s.id);
    const dir = sessionsDir();
    // What the model reads this turn: the chat open now and the persona in use
    // now. Cards are checked against these, not against whatever is open when
    // the reply ends.
    const turn = {};
    const ctl = new AbortController();
    busy = { sessionId: s.id, text: '', ctl };
    let saveError = '';
    // Saved to the session's own folder (a profile switch doesn't move it).
    const append = msg => {
        try {
            const latest = readSession(s.id, dir);
            if (latest) { latest.messages.push(msg); saveSession(latest, dir); }
            return latest;
        } catch (e) {
            saveError = `The reply couldn't be saved: ${e.message || e}`;
            throw Object.assign(new Error(saveError), { saveFailed: true });
        }
    };
    const generate = async messages => {
        busy.text = '';
        return api.sillytavern.page('generate', { profileId: perFolder('profile'), messages, maxTokens: MAX_TOKENS, stream: true }, {
            signal: ctl.signal,
            onChunk: c => {
                const say = protocol.partialSay(c.text);
                if (say !== busy.text) { busy.text = say; push({ type: 'turn', sessionId: s.id, text: say, done: false }); }
            },
        });
    };
    (async () => {
        let last = { role: 'assistant', content: '' };
        let read = 0;
        try {
            try { const c = await page('context'); turn.chatId = c.chatId || null; turn.avatar = c.characterAvatar || null; } catch { /* no page */ }
            try { turn.persona = (await page('personaState', {})).current || null; } catch { /* no page */ }
            try { turn.preset = (await page('presetState', { name: '' })).selected || null; } catch { /* no page */ }
            turn.text = askedText(s.messages);
            turn.ticked = tickedOf(s.context, turn.persona);
            for (let step = 1; step <= MAX_STEPS; step++) {
                const messages = await requestFor(readSession(s.id, dir) || s);
                let r = await generate(messages);
                let parsed = protocol.parse(r.text);
                if (!parsed.ok) {
                    // One more try, told what was wrong; the bad reply isn't kept.
                    // (an empty reply is sent back as a placeholder: some providers refuse empty messages)
                    const again = await generate([...messages, { role: 'assistant', content: r.text || '(empty reply)' }, { role: 'user', content: protocol.retryMessage(parsed.error) }]);
                    const p2 = protocol.parse(again.text);
                    if (!p2.ok) {
                        append({ role: 'assistant', content: '', raw: again.text, invalid: true, error: `The model couldn't produce a valid reply: ${p2.error}`, at: Date.now() });
                        break;
                    }
                    r = again;
                    parsed = p2;
                }
                const { say, lookups: wanted, proposals, ask } = parsed.reply;
                last = { role: 'assistant', content: say, raw: r.text, at: Date.now() };
                if (r.fallback) last.fallback = true;
                if (wanted.length) last.lookups = wanted;
                // Each proposal gets an id, a state and the value it replaces as
                // read now (Apply refuses if that changes before the click).
                // Nothing is applied without a click.
                // A proposal the user's message doesn't point at gets a note (and stays out of Apply all).
                let names = { characters: [], personas: [] };
                if (proposals.length) { try { names = await page('lists'); } catch { /* names unknown: only kinds count */ } }
                if (proposals.length) last.proposals = await Promise.all(proposals.map(async x => {
                    const fields = proposalFields(x);
                    const shown = await applier.currentOf(api, fields, turn);
                    const out = guard.outside({ ...fields, shown }, { text: turn.text, ticked: turn.ticked, names,
                        current: { chatId: turn.chatId, avatar: turn.avatar, persona: turn.persona, preset: turn.preset } });
                    return { ...fields, ...(shown ? { shown } : {}), ...(out ? { outside: out } : {}), id: crypto.randomBytes(4).toString('hex'), state: 'pending' };
                }));
                if (ask) last.ask = ask;
                append(last);
                busy.text = ''; // saved: a stop from here on doesn't save it twice
                if (!wanted.length) break;
                if (step === MAX_STEPS) {
                    append({ role: 'assistant', content: '', note: `Stopped after ${MAX_STEPS} steps of looking things up. Ask again to go on.`, at: Date.now() });
                    break;
                }
                push({ type: 'step', sessionId: s.id });
                // Too much read in this turn: the model answers with what it has.
                const found = read >= READ_BUDGET
                    ? { content: `<lookup_results>\nERROR: too much was read in this turn (over ${READ_BUDGET} characters). Answer with what you have, or ask the user to narrow it down.\n</lookup_results>`, summary: ['Stopped looking things up: too much read in one go'] }
                    : await lookups.run(api, wanted, ctl.signal);
                read += found.content.length;
                if (ctl.signal.aborted) throw new Error('stopped');
                append({ role: 'lookup', content: found.content, summary: found.summary, at: Date.now() });
                push({ type: 'step', sessionId: s.id });
            }
        } catch (e) {
            if (!e.saveFailed) {
                const msg = { role: 'assistant', content: busy?.text || '', at: Date.now() };
                if (ctl.signal.aborted) msg.stopped = true;
                else msg.error = e.message || String(e);
                try { append(msg); } catch { /* saveError says it */ }
            }
        } finally {
            // Whatever happened, the co-pilot is free again.
            busy = null;
            push({ type: 'turn', sessionId: s.id, done: true, saveError });
        }
    })();
    return { ok: true, sessionId: s.id };
}

// ---- applying proposals (one at a time: they may touch the same file) ----
let applying = null; // the id of the proposal being applied or undone
// Where a proposal is: its session, in the folder it was found in. An apply
// or undo writes its outcome there, even when the user opened another
// session or switched profile meanwhile.
function locate(id) {
    const s = currentSession();
    if (!s) throw new Error('No session.');
    const p = s.messages.flatMap(m => m.proposals || []).find(x => x.id === id);
    if (!p) throw new Error('That proposal isn\'t in this session.');
    return { at: { sid: s.id, dir: sessionsDir() }, p: { ...p } };
}
// fn changes the proposal; saved right after.
function withProposal(at, id, fn) {
    const s = readSession(at.sid, at.dir);
    const p = s && s.messages.flatMap(m => m.proposals || []).find(x => x.id === id);
    if (!p) throw new Error('That proposal isn\'t there any more.');
    const out = fn(p);
    saveSession(s, at.dir);
    return out;
}
async function oneAtATime(id, fn) {
    if (applying) throw new Error('Another change is being applied: wait a moment.');
    if (!api.sillytavern.info().running) throw new Error('SillyTavern isn\'t running.');
    applying = id;
    try { return await fn(); } finally { applying = null; }
}
// What the model proposed, without anything only the co-pilot sets.
const proposalFields = p => { const { id, state, change, error, conflict, undoError, undoNote, shown, outside, ...rest } = p; return rest; };
// Still open: never decided, or failed before anything was written (a
// failure after writing has a change, which is undone, not applied again).
const open = p => p.state === 'pending' || (p.state === 'failed' && !p.change);

async function applyOne(id) {
    return oneAtATime(id, async () => {
        const { at, p } = locate(id);
        if (!open(p)) throw new Error('That proposal was already decided.');
        const r = await applier.applyProposal(api, { ...proposalFields(p), ...(p.shown ? { shown: p.shown } : {}) });
        withProposal(at, id, x => {
            x.state = r.ok ? 'applied' : 'failed';
            x.error = r.ok ? '' : r.error;
            if (r.change) x.change = r.change;
            delete x.conflict;
        });
        if (r.change) prune({ throttle: true });
        return r.ok ? { ok: true } : { ok: false, error: r.error };
    });
}

// ---- Apply all, Undo everything, how long backups are kept ----
// Deletes always need their own click, and so does anything the user's
// message didn't point at.
const DELETE_OPS = new Set(['delete_lorebook_entry', 'delete_messages', 'remove_preset_prompt']);
const leftOut = p => (!open(p) ? 'already decided' : DELETE_OPS.has(p.op) ? 'a delete needs its own click' : p.outside ? 'not part of what you asked' : null);
// What a change touches: two changes to the same thing can't both apply
// (the second would find it changed since its card was shown).
function targetKey(p) {
    switch (p.op) {
        case 'edit_card': return `card:${p.avatar}:${p.field}`;
        case 'edit_lorebook_entry': case 'delete_lorebook_entry': return `entry:${p.book}:${p.uid}`;
        case 'edit_message': return `message:${p.index}`;
        case 'edit_persona': return `persona:${p.avatar ?? p.shown?.avatar}`;
        case 'edit_preset_setting': return `preset:${p.name}:${p.key}`;
        case 'edit_preset_prompt': return `prompt:${p.name}:${p.identifier}`;
        case 'add_preset_prompt': case 'remove_preset_prompt': case 'reorder_preset_prompts': return `order:${p.name}`;
        default: return null;
    }
}
// Applies the given proposals of the open session one at a time (new
// messages last: they move the ones after them); a failure doesn't stop the rest.
async function applyAll(ids) {
    const out = [], seen = new Set(), list = [];
    for (const id of (Array.isArray(ids) ? ids : []).map(String)) {
        let p = null, why = null;
        try { p = locate(id).p; why = leftOut(p); } catch (e) { why = e.message; }
        const key = p && targetKey(p);
        if (!why && key && seen.has(key)) why = 'it changes the same thing as an earlier change: apply it on its own';
        if (key) seen.add(key);
        if (why) out.push({ id, ok: false, error: why, skipped: true }); else list.push({ id, last: p.op === 'add_message' });
    }
    for (const { id } of [...list.filter(x => !x.last), ...list.filter(x => x.last)]) {
        try { out.push({ id, ...(await applyOne(id)) }); } catch (e) { out.push({ id, ok: false, error: e.message || String(e) }); }
    }
    prune();
    return out;
}
// When a change was made (its journal entry), for newest-first order.
const madeAt = p => api.changes.get(p.change.journal)?.at || parseInt(String(p.change.journal).split('-')[0], 36) || 0;
// Undoes this session's changes, newest first by when they were made; stops
// at the first one that needs the user's choice (its card shows both
// versions). Changes already waiting for a choice are passed over and counted.
async function undoAll() {
    const s = currentSession();
    if (!s) throw new Error('No session.');
    const all = s.messages.flatMap(m => m.proposals || []).filter(x => x.change && ['applied', 'failed'].includes(x.state));
    const waiting = all.filter(x => x.conflict).length;
    const ids = all.filter(x => !x.conflict).sort((a, b) => madeAt(b) - madeAt(a)).map(x => x.id);
    const done = [], failed = [];
    for (const id of ids) {
        let r;
        try { r = await undoOne(id); } catch (e) { r = { ok: false, error: e.message || String(e) }; }
        if (r?.conflict) return { undone: done.length, stopped: id, failed, waiting };
        if (r?.ok) done.push(id); else failed.push({ id, error: r?.error || 'Undo failed.' });
    }
    return { undone: done.length, stopped: null, failed, waiting };
}
const RETENTION = { days: 30, keep: 200 };
const retention = () => {
    const r = api.storage.get('retention', {}) || {};
    const n = (v, d, min, max) => (Number.isInteger(v) && v >= min && v <= max ? v : d);
    return { days: n(r.days, RETENTION.days, 1, 3650), keep: n(r.keep, RETENTION.keep, 10, 100000) };
};
// Backups older than the days AND beyond the newest count go. Never while
// another change is being recorded; after an apply at most once a minute.
let lastPrune = 0;
function prune({ throttle = false } = {}) {
    if (throttle && Date.now() - lastPrune < 60000) return;
    lastPrune = Date.now();
    try { api.changes.prune(retention()); } catch { /* next time */ }
}
function rejectOne(id) {
    if (applying === id) throw new Error('That proposal is being applied: wait a moment.');
    const { at } = locate(id);
    return withProposal(at, id, x => {
        if (!open(x)) throw new Error('That proposal was already decided.');
        x.state = 'rejected';
        return { ok: true };
    });
}
async function undoOne(id, choice) {
    return oneAtATime(id, async () => {
        const { at, p } = locate(id);
        if (!p.change || !['applied', 'failed'].includes(p.state)) throw new Error('There is nothing to undo for that proposal.');
        const r = await applier.undoChange(api, p.change, { choice: ['mine', 'file', 'keep'].includes(choice) ? choice : undefined });
        withProposal(at, id, x => {
            if (r.conflict) { x.conflict = { ...r.conflict, noMine: !!r.noMine }; return; }
            delete x.conflict;
            // Kept as it is now: decided, no Undo any more. Backup gone: it can't be undone.
            if (r.ok && r.how === 'kept') { x.state = 'kept'; x.undoError = ''; } else if (r.ok) { x.state = 'undone'; x.undoError = ''; x.undoNote = r.note || ''; } else if (r.gone) { x.state = 'expired'; x.undoError = r.error; } else x.undoError = r.error;
        });
        return r;
    });
}

module.exports = {
    activate(a) {
        api = a;
        count = ctx.counter(page);
        prune();
        const h = (name, fn) => api.sidepanel.handle(name, fn);
        h('state', tab => state(tab));
        h('profiles', async () => {
            let r;
            try { r = await api.sillytavern.page('profiles'); } catch (e) { return { available: false, profiles: [], selected: null, error: e.message, profileId: perFolder('profile') }; }
            // A chosen profile that is gone isn't used any more.
            const chosen = perFolder('profile');
            if (chosen && r.available && !r.profiles.some(p => p.id === chosen)) setPerFolder('profile', null);
            return { ...r, error: '', profileId: perFolder('profile') };
        });
        h('setProfile', id => { setPerFolder('profile', id ? String(id) : null); return true; });
        h('sessionNew', async tab => { await newSession(); return state(tab); });
        h('context', () => contextView());
        h('contextToggle', (id, on) => changeContext(list => list.map(i => (i.id === id ? { ...i, on: !!on } : i))));
        h('contextRemove', id => changeContext(list => list.filter(i => i.id !== id)));
        h('contextAdd', async spec => {
            const item = await ctx.itemFrom(page, spec);
            // The same item twice would be sent twice.
            if ((currentSession()?.context || []).some(i => i.kind === item.kind && JSON.stringify(i.ref) === JSON.stringify(item.ref))) throw new Error('That is in the list already.');
            changeContext(list => [...list, item]);
            return item;
        });
        h('contextChoices', kind => ctx.choices(page, String(kind)));
        // The exact messages the next request would send (with the text being written).
        h('preview', async text => { const s = currentSession(); return s ? requestFor(s, String(text || '').trim() || null) : []; });
        h('sessionOpen', (id, tab) => { if (readSession(id)) setOpen(id); return state(tab); });
        h('sessionRename', (id, name, tab) => {
            const s = readSession(id);
            const n = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 80);
            if (s && n) { s.name = n; saveSession(s); }
            return state(tab);
        });
        h('sessionDelete', (id, tab) => {
            if (busy?.sessionId === id) throw new Error('Stop the reply first.');
            if (SESSION_ID.test(String(id))) fs.rmSync(path.join(sessionsDir(), `${id}.json`), { force: true });
            if (perFolder('openSession') === id) setOpen(null);
            return state(tab);
        });
        h('send', text => send(text));
        h('apply', id => applyOne(String(id)));
        h('applyAll', ids => applyAll(ids));
        h('undoAll', () => undoAll());
        h('backups', () => ({ ...retention(), size: api.changes.size() }));
        h('retentionSet', (days, keep) => {
            if (applying) throw new Error('A change is being applied: try again in a moment.');
            const r = { days: Math.floor(Number(days)), keep: Math.floor(Number(keep)) };
            if (!(r.days >= 1 && r.days <= 3650) || !(r.keep >= 10 && r.keep <= 100000)) throw new Error('Keep backups 1 to 3650 days, and at least the last 10 changes.');
            api.storage.set('retention', r);
            prune();
            return { ...retention(), size: api.changes.size() };
        });
        h('reject', id => rejectOne(String(id)));
        h('undo', (id, choice) => undoOne(String(id), choice));
        // A click on one of the co-pilot's choices: sent as the user's answer to that question.
        h('answer', (question, choice) => send(protocol.answerText(question, choice), { choice }));
        h('stop', () => { busy?.ctl.abort(); return true; });
        for (const ev of ['server-started', 'server-stopped', 'profile-switched']) api.on(ev, () => push({ type: 'state' }));
    },
    deactivate() { busy?.ctl.abort(); },
};
