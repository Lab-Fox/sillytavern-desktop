// Co-pilot: the main part. Keeps the sessions (one list per SillyTavern
// folder), sends the conversation through the Connection Profile the user
// picked (api.sillytavern.page('generate')) and streams the reply to the
// side panel. This first version only talks: it reads and changes nothing.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SYSTEM_PROMPT = [
    'You are the co-pilot inside SillyTavern Desktop, an app around SillyTavern.',
    'You help the user with SillyTavern: chat completion presets, character cards, personas, lorebooks and chats.',
    'For now you can only talk with the user: you can\'t read or change anything in SillyTavern yet. Say so if asked to.',
    'Answer briefly and plainly.',
].join('\n');
const MAX_TOKENS = 2048;

let api = null;
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
function newSession() {
    const s = { id: `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`, name: 'New session', createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
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

function state(tab) {
    const reason = availability(tab);
    return {
        available: !reason, reason, folder: folder(),
        sessions: listSessions(), current: currentSession(),
        profileId: perFolder('profile'),
        busy: busy ? { sessionId: busy.sessionId, text: busy.text } : null,
    };
}

const push = message => api.sidepanel.send(message);

// What the model is sent: the system prompt and the conversation. Replies
// that failed aren't part of it.
const conversation = s => [{ role: 'system', content: SYSTEM_PROMPT },
    ...s.messages.filter(m => !m.error && m.content).map(m => ({ role: m.role, content: m.content }))];

async function send(text) {
    text = String(text || '').trim();
    if (!text) throw new Error('Write a message first.');
    if (busy) throw new Error('The co-pilot is still answering.');
    if (!api.sillytavern.info().running) throw new Error('SillyTavern isn\'t running.');
    const s = currentSession() || newSession();
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
            const r = await api.sillytavern.page('generate', { profileId: perFolder('profile'), messages: conversation(s), maxTokens: MAX_TOKENS, stream: true }, {
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
        h('sessionNew', tab => { newSession(); return state(tab); });
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
