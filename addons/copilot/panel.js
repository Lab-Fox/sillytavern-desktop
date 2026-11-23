// Co-pilot: the side panel. Everything from the model or from SillyTavern is
// shown as text (textContent), never as HTML.
'use strict';
const $ = s => document.querySelector(s);
const P = window.desktopPanel;
let st = null;          // the main part's state
let tab = null;         // the SillyTavern tab beside the panel
let profiles = null;    // { available, profiles, selected, error }
let retry = null;       // a failed profile list is asked again
let target = null;      // the session Rename / Delete were opened for

const REASONS = {
    'other-tab': 'The co-pilot works on this PC\'s SillyTavern, the one the launcher uses. Switch to its tab.',
    'server-stopped': 'SillyTavern isn\'t running. Start it from the launcher.',
};

async function refresh() {
    tab = await P.tab();
    st = await P.invoke('state', tab);
    render();
    if (st.available && (!profiles || profiles.error)) loadProfiles();
}

// Asked again whenever it failed (SillyTavern's page still loading after a
// server start) and when the picker gets focus (profiles edited meanwhile).
async function loadProfiles() {
    clearTimeout(retry);
    try { profiles = await P.invoke('profiles'); } catch (e) { profiles = { available: false, profiles: [], selected: null, error: String(e.message || e) }; }
    if (st && 'profileId' in profiles) st.profileId = profiles.profileId;
    renderProfiles();
    if (profiles.error && st?.available) retry = setTimeout(loadProfiles, 2000);
}

function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
}

function render() {
    const s = $('#state');
    s.dataset.state = st.available ? 'ok' : st.reason;
    s.hidden = st.available;
    s.textContent = st.available ? '' : REASONS[st.reason] || '';
    // Sessions
    const sel = $('#sessionSel');
    sel.replaceChildren(...(st.sessions.length ? st.sessions : [{ id: '', name: 'New session' }]).map(x => {
        const o = el('option', null, x.name);
        o.value = x.id;
        return o;
    }));
    sel.value = st.current?.id || '';
    $('#btnRename').disabled = $('#btnDelete').disabled = !st.current;
    // Conversation
    const log = $('#log');
    const msgs = st.current?.messages || [];
    const items = msgs.map(m => message(m));
    if (st.busy && st.busy.sessionId === st.current?.id) items.push(message({ role: 'assistant', content: st.busy.text }, true));
    if (!items.length) items.push(el('div', 'empty', 'Ask about a preset, a card, a persona, a lorebook or a chat.'));
    log.replaceChildren(...items);
    log.scrollTop = log.scrollHeight;
    // Send / Stop
    const b = $('#btnSend');
    b.dataset.mode = st.busy ? 'stop' : 'send';
    b.textContent = st.busy ? 'Stop' : 'Send';
    b.disabled = !st.busy && !st.available;
    $('#input').disabled = !st.available;
}

function message(m, pending = false) {
    const d = el('div', `msg${pending ? ' pending' : ''}${m.stopped ? ' stopped' : ''}`);
    d.dataset.role = m.role;
    d.append(el('span', 'text', m.content || ''));
    if (m.stopped) d.append(el('span', 'note', 'Stopped.'));
    if (m.fallback) d.append(el('span', 'note', 'Sent through SillyTavern\'s current connection (no Connection Profile).'));
    if (m.error) d.append(el('span', 'err', m.error));
    return d;
}

function renderProfiles() {
    const sel = $('#profileSel');
    const list = profiles?.available ? profiles.profiles : [];
    const opts = [el('option', null, 'SillyTavern\'s current connection')];
    opts[0].value = '';
    for (const p of list) { const o = el('option', null, p.name); o.value = p.id; opts.push(o); }
    sel.replaceChildren(...opts);
    sel.value = list.some(p => p.id === st?.profileId) ? st.profileId : '';
    renderWhere();
}

function renderWhere() {
    const p = profiles?.profiles?.find(x => x.id === $('#profileSel').value);
    $('#profileWhere').textContent = profiles?.error ? profiles.error
        : p ? `Sends to: ${[p.api, p.model].filter(Boolean).join(' · ')}${p.preset ? ` (sampler settings of "${p.preset}")` : ''}`
        : profiles && !profiles.available ? 'Connection Manager is off: SillyTavern\'s current Chat Completion connection is used.'
        : 'Sends through SillyTavern\'s current Chat Completion connection.';
}

// ---- actions ----
async function act(fn) {
    try { st = await fn(); render(); } catch (e) { showError(e); }
}
function showError(e) {
    const log = $('#log');
    log.append(el('div', 'msg err', String(e.message || e)));
    log.scrollTop = log.scrollHeight;
}

$('#sessionSel').addEventListener('change', e => act(() => P.invoke('sessionOpen', e.target.value, tab)));
$('#btnNew').addEventListener('click', () => act(() => P.invoke('sessionNew', tab)));
$('#btnRename').addEventListener('click', () => {
    target = st.current?.id || null;
    $('#deleteBox').hidden = true;
    $('#renameBox').hidden = false;
    $('#renameInput').value = st.current?.name || '';
    $('#renameInput').focus();
    $('#renameInput').select();
});
const rename = () => {
    const name = $('#renameInput').value;
    $('#renameBox').hidden = true;
    if (target) act(() => P.invoke('sessionRename', target, name, tab));
};
$('#btnRenameOk').addEventListener('click', rename);
$('#renameInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); rename(); }
    if (e.key === 'Escape') $('#renameBox').hidden = true;
});
$('#btnDelete').addEventListener('click', () => { target = st.current?.id || null; $('#renameBox').hidden = true; $('#deleteBox').hidden = false; });
$('#btnDeleteNo').addEventListener('click', () => { $('#deleteBox').hidden = true; });
$('#btnDeleteYes').addEventListener('click', () => {
    $('#deleteBox').hidden = true;
    if (target) act(() => P.invoke('sessionDelete', target, tab));
});
$('#profileSel').addEventListener('focus', () => loadProfiles());
$('#profileSel').addEventListener('change', async e => {
    renderWhere();
    try { await P.invoke('setProfile', e.target.value || null); st.profileId = e.target.value || null; } catch (err) { showError(err); }
});

async function sendOrStop({ fromKey = false } = {}) {
    if (st?.busy) {
        if (!fromKey) await P.invoke('stop').catch(showError); // Enter never stops a reply
        return;
    }
    const input = $('#input');
    const text = input.value.trim();
    if (!text) return;
    try {
        await P.invoke('send', text);
        input.value = '';
        await refresh();
    } catch (e) { showError(e); }
}
$('#btnSend').addEventListener('click', sendOrStop);
$('#input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendOrStop({ fromKey: true }); }
});

// Pushed by the main part: a reply streaming in, or a state change.
P.onMessage(m => {
    if (m?.type === 'state') { profiles = null; refresh(); return; }
    if (m?.type !== 'turn' || !st) return;
    if (m.done) { refresh().then(() => { if (m.saveError) showError(m.saveError); }); return; }
    if (m.sessionId !== st.current?.id) return;
    const last = [...document.querySelectorAll('#log .msg.pending .text')].at(-1);
    if (last) last.textContent = m.text;
    else { st.busy = { sessionId: m.sessionId, text: m.text }; render(); }
    const log = $('#log');
    log.scrollTop = log.scrollHeight;
});
P.onTab(() => refresh());
refresh();
