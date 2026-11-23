// Co-pilot: the main part. Keeps the sessions (one list per SillyTavern
// folder), sends the conversation through the Connection Profile the user
// picked (api.sillytavern.page('generate')) and streams the reply to the
// side panel. This first version only talks: it reads and changes nothing.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ctx = require('./context.cjs');

const SYSTEM_PROMPT = [
    'You are the co-pilot inside SillyTavern Desktop, an app around SillyTavern.',
    'You help the user with SillyTavern: chat completion presets, character cards, personas, lorebooks and chats.',
    'You see only the material the user ticked for you, in <data> blocks. For now you can\'t change anything in SillyTavern: say so if asked to, and show the user what to change instead.',
    'Answer briefly and plainly.',
].join('\n');
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
const talk = s => s.messages.filter(m => !m.error && m.content).map(m => ({ role: m.role, content: m.content }));
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

async function send(text) {
    text = String(text || '').trim();
    if (!text) throw new Error('Write a message first.');
    if (busy) throw new Error('The co-pilot is still answering.');
    if (!api.sillytavern.info().running) throw new Error('SillyTavern isn\'t running.');
    const s = currentSession() || await newSession();
    if (!s.messages.length && s.name === 'New session') s.name = text.replace(/\s+/g, ' ').slice(0, 40);
    s.messages.push({ role: 'user', content: text, at: Date.now() });
    saveSession(s);
    setOpen(s.id);
    const dir = sessionsDir();
    const ctl = new AbortController();
    busy = { sessionId: s.id, text: '', ctl };
    (async () => {
        const reply = { role: 'assistant', content: '', at: Date.now() };
        let saveError = '';
        try {
            const r = await api.sillytavern.page('generate', { profileId: perFolder('profile'), messages: await requestFor(s), maxTokens: MAX_TOKENS, stream: true }, {
                signal: ctl.signal,
                onChunk: c => { busy.text = c.text; push({ type: 'turn', sessionId: s.id, text: c.text, done: false }); },
            });
            reply.content = r.text;
            if (r.fallback) reply.fallback = true;
        } catch (e) {
            reply.content = busy.text;
            if (ctl.signal.aborted) reply.stopped = true;
            else reply.error = e.message || String(e);
        }
        try {
            const latest = readSession(s.id, dir); // renamed meanwhile? keep that
            if (latest) {
                latest.messages.push(reply);
                saveSession(latest, dir);
            }
        } catch (e) {
            saveError = `The reply couldn't be saved: ${e.message || e}`;
        } finally {
            // Whatever happened, the co-pilot is free again.
            busy = null;
            push({ type: 'turn', sessionId: s.id, text: reply.content, done: true, stopped: !!reply.stopped, error: reply.error || '', saveError });
        }
    })();
    return { ok: true, sessionId: s.id };
}

module.exports = {
    activate(a) {
        api = a;
        count = ctx.counter(page);
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
        h('contextAdd', async spec => { const item = await ctx.itemFrom(page, spec); changeContext(list => [...list, item]); return item; });
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
        h('stop', () => { busy?.ctl.abort(); return true; });
        for (const ev of ['server-started', 'server-stopped', 'profile-switched']) api.on(ev, () => push({ type: 'state' }));
    },
    deactivate() { busy?.ctl.abort(); },
};
