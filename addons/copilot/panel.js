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
    loadTray();
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
    // The question of the latest reply can be answered with a click.
    const lastAsk = !st.busy && msgs.length && msgs.at(-1).role === 'assistant' && msgs.at(-1).ask ? msgs.length - 1 : -1;
    const items = msgs.map((m, i) => message(m, false, i === lastAsk));
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

function message(m, pending = false, askable = false) {
    // What the co-pilot looked up: one quiet line per lookup.
    if (m.role === 'lookup') {
        const d = el('div', 'step');
        d.dataset.role = 'lookup';
        for (const line of m.summary || []) d.append(el('div', null, line));
        return d;
    }
    const d = el('div', `msg${pending ? ' pending' : ''}${m.stopped ? ' stopped' : ''}${m.invalid ? ' invalid' : ''}`);
    d.dataset.role = m.role;
    d.append(el('span', 'text', m.content || ''));
    if (m.lookups?.length && !m.content) d.querySelector('.text').textContent = 'Looking things up…';
    for (const p of m.proposals || []) d.append(proposal(p));
    if (m.ask) {
        const a = el('div', 'ask');
        a.append(el('div', 'q', m.ask.question));
        for (const c of m.ask.choices || []) {
            const b = el('button', 'choice', c);
            b.disabled = !askable;
            // Sent as an answer to the question; what is typed in the box stays.
            b.addEventListener('click', () => P.invoke('answer', m.ask.question, c).then(refresh, showError));
            a.append(b);
        }
        d.append(a);
    }
    if (m.invalid && m.raw) { const r = el('details', 'raw'); r.append(el('summary', null, 'What the model wrote'), el('pre', null, m.raw)); d.append(r); }
    if (m.note) d.append(el('span', 'note', m.note));
    if (m.stopped) d.append(el('span', 'note', 'Stopped.'));
    if (m.fallback) d.append(el('span', 'note', 'Sent through SillyTavern\'s current connection (no Connection Profile).'));
    if (m.error) d.append(el('span', 'err', m.error));
    return d;
}

// A proposed change, shown only: applying comes in the next version.
const TARGET = {
    edit_card: p => `Card ${p.avatar}: ${p.field}`, create_card: p => `New card "${p.name}"`,
    create_lorebook: p => `New lorebook "${p.name}"`, add_lorebook_entry: p => `Lorebook ${p.book}: new entry`,
    edit_lorebook_entry: p => `Lorebook ${p.book}, entry ${p.uid}: ${p.field}`, delete_lorebook_entry: p => `Lorebook ${p.book}: delete entry ${p.uid}`,
    edit_message: p => `Message #${p.index}`, add_message: p => `New message after #${p.after}`,
    delete_messages: p => `Delete messages ${p.indexes.join(', ')}`, hide_messages: p => `Hide messages ${p.indexes.join(', ')}`, unhide_messages: p => `Unhide messages ${p.indexes.join(', ')}`,
    create_persona: p => `New persona "${p.name}"`, edit_persona: p => `Persona ${p.avatar ?? 'in use'}`,
    create_preset: p => `New preset "${p.name}"`, edit_preset_setting: p => `Preset ${p.name}: ${p.key}`,
    edit_preset_prompt: p => `Preset ${p.name}, prompt ${p.identifier}`, add_preset_prompt: p => `Preset ${p.name}: new prompt`,
    remove_preset_prompt: p => `Preset ${p.name}: remove prompt ${p.identifier}`, reorder_preset_prompts: p => `Preset ${p.name}: prompt order`,
};
const show = v => (typeof v === 'string' ? v : JSON.stringify(v, null, 1));
function proposal(p) {
    const c = el('div', 'proposal');
    c.append(el('div', 'target', (TARGET[p.op] || (() => p.op))(p)));
    if ('find' in p) { c.append(el('div', 'del', show(p.find)), el('div', 'add', show(p.replace))); }
    else if ('set' in p) c.append(el('div', 'add', show(p.set)));
    else if ('value' in p) c.append(el('div', 'add', show(p.value)));
    else if (p.text != null) c.append(el('div', 'add', show(p.text)));
    else if (p.entry || p.fields || p.prompt) c.append(el('div', 'add', show(p.entry || p.fields || p.prompt)));
    else if (p.description != null) c.append(el('div', 'add', show(p.description)));
    else if (p.order) c.append(el('div', 'add', p.order.join(' → ')));
    c.append(el('div', 'why', p.why));
    c.append(el('div', 'later', 'Applying comes in the next version.'));
    return c;
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
    if (m?.type === 'step') { refresh(); return; }
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

// ---- the context tray: what the co-pilot sees ----
const fmt = n => Number(n || 0).toLocaleString('en-US');
// One look at a time; asks that come in meanwhile become one more look after it.
let trayBusy = false, trayAgain = false;
async function loadTray() {
    const tray = $('#tray');
    tray.hidden = !st?.available;
    if (tray.hidden) return;
    if (trayBusy) { trayAgain = true; return; }
    trayBusy = true;
    try {
        do {
            trayAgain = false;
            try { renderTray(await P.invoke('context')); } catch (e) { $('#trayTotal').textContent = String(e.message || e); }
        } while (trayAgain);
    } finally { trayBusy = false; }
}
function renderTray(v) {
    const total = $('#trayTotal');
    total.dataset.total = String(v.total);
    total.classList.toggle('over', !!v.over);
    total.textContent = `${fmt(v.total)} tokens${v.maxContext ? ` of ${fmt(v.maxContext)}` : ''}${v.over ? ': too much for this profile, untick something' : ''}`;
    $('#trayList').replaceChildren(...v.items.map(it => {
        const row = el('div', `ctx${it.on ? '' : ' off'}`);
        row.dataset.id = it.id;
        const box = el('input');
        box.type = 'checkbox';
        box.checked = !!it.on;
        box.addEventListener('change', () => P.invoke('contextToggle', it.id, box.checked).then(loadTray, showError));
        const tokens = el('span', 'tokens', it.error ? '' : fmt(it.tokens));
        tokens.dataset.tokens = String(it.tokens || 0);
        const rm = el('button', 'rm', '×');
        rm.title = 'Remove';
        rm.addEventListener('click', () => P.invoke('contextRemove', it.id).then(loadTray, showError));
        row.append(box, el('span', 'label', it.label), tokens);
        if (it.error) row.append(el('span', 'err', it.error));
        row.append(rm);
        return row;
    }));
}

// Adding: a kind, then "last N" / a range for messages, or a pick from a list.
let addItems = [];
let addJob = 0; // a late answer for a kind no longer chosen is dropped
const ACTIVE = '__in-use__';
$('#btnAdd').addEventListener('click', () => {
    $('#addBox').hidden = false;
    $('#addKind').value = '';
    $('#addRange').hidden = $('#addPick').hidden = true;
    $('#btnAddOk').disabled = true;
});
$('#btnAddCancel').addEventListener('click', () => { $('#addBox').hidden = true; });
$('#addKind').addEventListener('change', async () => {
    const kind = $('#addKind').value;
    $('#addRange').hidden = kind !== 'messages';
    $('#addPick').hidden = !kind || kind === 'messages';
    $('#btnAddOk').disabled = true;
    addItems = [];
    $('#addList').replaceChildren();
    if (!kind) return;
    const job = ++addJob;
    try {
        const c = await P.invoke('contextChoices', kind);
        if (job !== addJob) return;
        if (kind === 'messages') {
            $('#addTotal').textContent = c.chatId ? `This chat has ${fmt(c.total)} messages (0 is the first).` : 'Open a chat first.';
            $('#addTo').value = String(Math.max(0, (c.total || 1) - 1));
            $('#btnAddOk').disabled = !c.chatId;
            return;
        }
        addItems = c.items;
        $('#addSearch').value = '';
        fillList();
    } catch (e) { showError(e); }
});
function fillList() {
    const q = $('#addSearch').value.trim().toLowerCase();
    $('#addList').replaceChildren(...addItems.filter(x => !q || x.label.toLowerCase().includes(q)).slice(0, 500).map(x => {
        const o = el('option', null, x.label);
        o.value = x.value ?? ACTIVE;
        return o;
    }));
    $('#btnAddOk').disabled = !$('#addList').value;
}
$('#addSearch').addEventListener('input', fillList);
$('#addList').addEventListener('change', () => { $('#btnAddOk').disabled = !$('#addList').value; });
$('#btnAddOk').addEventListener('click', async () => {
    const kind = $('#addKind').value;
    const v = $('#addList').value;
    const spec = kind === 'messages'
        ? ($('#addModeRange').checked ? { kind, from: $('#addFrom').value, to: $('#addTo').value } : { kind, last: $('#addLast').value })
        : kind === 'card' ? { kind, avatar: v }
        : kind === 'persona' ? { kind, avatar: v === ACTIVE ? null : v }
        : { kind, name: v };
    try {
        await P.invoke('contextAdd', spec);
        $('#addBox').hidden = true;
        loadTray();
    } catch (e) { showError(e); }
});

// The exact request the next message would send, as text.
$('#btnPreview').addEventListener('click', async () => {
    try {
        const msgs = await P.invoke('preview', $('#input').value);
        $('#previewText').textContent = msgs.map(m => `[${m.role}]\n${m.content}`).join('\n\n');
        $('#previewBox').hidden = false;
    } catch (e) { showError(e); }
});
$('#btnPreviewClose').addEventListener('click', () => { $('#previewBox').hidden = true; });
