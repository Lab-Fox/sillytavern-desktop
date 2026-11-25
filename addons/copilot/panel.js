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
        for (const line of m.summary || []) d.append(el('div', null, cut(line, 160)));
        // Exactly what went back to the model.
        if (m.content) { const r = el('details', 'read'); r.append(el('summary', null, 'Show what it read'), el('pre', null, m.content)); d.append(r); }
        return d;
    }
    const d = el('div', `msg${pending ? ' pending' : ''}${m.stopped ? ' stopped' : ''}${m.invalid ? ' invalid' : ''}`);
    d.dataset.role = m.role;
    d.append(el('span', 'text', m.content || ''));
    if (m.lookups?.length && !m.content) d.querySelector('.text').textContent = 'Looking things up…';
    for (const p of m.proposals || []) d.append(proposal(p));
    if ((m.proposals || []).length > 1) applyAllRow(d, m.proposals);
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
    create_persona: p => `New persona "${p.name}"`, edit_persona: p => `Persona ${p.avatar ?? (p.shown?.avatar ? p.shown.avatar + ' (in use)' : 'in use')}`,
    create_preset: p => `New preset "${p.name}"`, edit_preset_setting: p => `Preset ${p.name}: ${p.key}`,
    edit_preset_prompt: p => `Preset ${p.name}, prompt ${p.identifier}`, add_preset_prompt: p => `Preset ${p.name}: new prompt`,
    remove_preset_prompt: p => `Preset ${p.name}: remove prompt ${p.identifier}`, reorder_preset_prompts: p => `Preset ${p.name}: prompt order`,
};
const show = v => (typeof v === 'string' ? v : JSON.stringify(v, null, 1));
const cut = (t, n) => (String(t).length > n ? `${String(t).slice(0, n)}…` : String(t));
const targetOf = p => cut((TARGET[p.op] || (() => p.op))(p), 100);
const isOpen = p => p.state === 'pending' || (p.state === 'failed' && !p.change);

// Apply all: the reply's open cards that are not deletes and were part of
// what the user asked; it lists them (and what is left out) and asks once.
// What a change touches (as the main part counts it): a second change to the
// same thing would find it changed since its card was shown.
const keyOf = p => ({ edit_card: `card:${p.avatar}:${p.field}`, edit_lorebook_entry: `entry:${p.book}:${p.uid}`, delete_lorebook_entry: `entry:${p.book}:${p.uid}`,
    edit_message: `message:${p.index}`, edit_persona: `persona:${p.avatar ?? p.shown?.avatar}`, edit_preset_setting: `preset:${p.name}:${p.key}`,
    edit_preset_prompt: `prompt:${p.name}:${p.identifier}`, add_preset_prompt: `order:${p.name}`, remove_preset_prompt: `order:${p.name}`, reorder_preset_prompts: `order:${p.name}` }[p.op] || null);
function applyAllRow(d, proposals) {
    const open = proposals.filter(p => p.id && isOpen(p) && APPLIES.has(p.op));
    const seen = new Set();
    const why = new Map();
    for (const p of open) {
        const k = keyOf(p);
        if (DELETES.has(p.op)) why.set(p, 'a delete');
        else if (p.outside) why.set(p, 'not part of what you asked');
        else if (k && seen.has(k)) why.set(p, 'changes the same thing as an earlier one');
        if (k) seen.add(k);
    }
    const take = open.filter(p => !why.has(p));
    if (take.length < 2) return;
    const row = el('div', 'applyall');
    const b = el('button', 'primary', `Apply all (${take.length})…`);
    row.append(b);
    b.addEventListener('click', () => {
        const box = el('div', 'confirm');
        box.append(el('div', 'q', `Apply these ${take.length} changes?`));
        for (const p of take) box.append(el('div', 'item', targetOf(p)));
        const left = open.filter(p => !take.includes(p));
        if (left.length) {
            box.append(el('div', 'label', 'Left out (each needs its own click):'));
            for (const p of left) box.append(el('div', 'item left', `${targetOf(p)}: ${why.get(p)}`));
        }
        const go = el('button', 'primary', `Apply these ${take.length}`), no = el('button', null, 'Cancel');
        const r = el('div', 'actions');
        r.append(go, no);
        box.append(r);
        row.replaceChildren(box);
        no.addEventListener('click', () => refresh());
        go.addEventListener('click', async () => {
            go.disabled = no.disabled = true;
            go.textContent = `Applying ${take.length} changes…`;
            try {
                const res = await P.invoke('applyAll', take.map(p => p.id));
                const bad = res.filter(x => !x.ok);
                await refresh();
                if (bad.length) showError(`Applied ${res.length - bad.length} of ${res.length}. ${bad.map(x => x.error).join(' ')}`);
            } catch (e) { showError(e); await refresh(); }
        });
    });
    d.append(row);
}
// The kinds of change this version can apply; the others are shown only.
const APPLIES = new Set(['edit_card', 'create_card', 'create_lorebook', 'add_lorebook_entry', 'edit_lorebook_entry', 'delete_lorebook_entry',
    'edit_message', 'add_message', 'delete_messages', 'hide_messages', 'unhide_messages', 'create_persona', 'edit_persona',
    'create_preset', 'edit_preset_setting', 'edit_preset_prompt', 'add_preset_prompt', 'remove_preset_prompt', 'reorder_preset_prompts']);
const DELETES = new Set(['delete_lorebook_entry', 'delete_messages', 'remove_preset_prompt']);
const STATE_TEXT = { applied: 'Applied.', rejected: 'Rejected.', undone: 'Undone.', failed: 'Not applied.', kept: 'Applied, kept as it is now.', expired: 'Applied; its backup is gone.' };
function proposal(p) {
    const c = el('div', `proposal ${p.state || 'pending'}${DELETES.has(p.op) ? ' delete' : ''}`);
    c.dataset.id = p.id || '';
    c.append(el('div', 'target', targetOf(p)));
    // Not pointed at by the user's message (perhaps an instruction in what it read).
    if (p.outside && isOpen(p)) c.append(el('div', 'outside', `${p.outside} Check it before you apply it.`));
    // What goes (as read when the reply came) and what comes.
    const now = p.shown && 'current' in p.shown ? p.shown.current : undefined;
    if ('find' in p) { c.append(el('div', 'del', show(p.find)), el('div', 'add', show(p.replace))); }
    else if ('set' in p) { if (now !== undefined && now !== '') c.append(el('div', 'del', show(now))); c.append(el('div', 'add', show(p.set))); }
    else if (p.op === 'delete_lorebook_entry' && now) c.append(el('div', 'del', [now.comment, now.content].filter(Boolean).join('\n')));
    else if ('value' in p) { if (now !== undefined && now !== null) c.append(el('div', 'del', show(now))); c.append(el('div', 'add', show(p.value))); }
    else if (p.op === 'remove_preset_prompt' && now) c.append(el('div', 'del', show(now)));
    else if (['delete_messages', 'hide_messages', 'unhide_messages'].includes(p.op)) {
        // The messages it touches, as they were when the reply came (cut short).
        const cut = t => (t.length > 300 ? `${t.slice(0, 300)}…` : t);
        for (const m of p.shown?.messages || []) c.append(el('div', p.op === 'delete_messages' ? 'del' : 'msgline', `#${m.index} ${m.message?.name ?? ''}: ${cut(String(m.message?.mes ?? ''))}`));
        if (!(p.shown?.messages || []).length) c.append(el('div', 'later', 'The messages couldn\'t be read when the reply came.'));
    }
    else if (p.text != null) c.append(el('div', 'add', `${p.isUser ? 'You' : (p.name || 'Character')}: ${p.text}`));
    else if (p.entry || p.fields || p.prompt) c.append(el('div', 'add', show(p.entry || p.fields || p.prompt)));
    else if (p.description != null) c.append(el('div', 'add', show(p.description)));
    else if (p.order) { if (Array.isArray(now)) c.append(el('div', 'del', now.join(' → '))); c.append(el('div', 'add', p.order.join(' → '))); }
    c.append(el('div', 'why', p.why));
    if (!p.id) return c;
    if (!APPLIES.has(p.op)) { c.append(el('div', 'later', 'Applying this kind of change comes in the next version.')); return c; }
    const BUSY = { Apply: 'Applying…', Delete: 'Deleting…', Undo: 'Undoing…' };
    const act = (label, cls, fn) => {
        const b = el('button', cls, label);
        b.addEventListener('click', async () => {
            b.disabled = true;
            if (BUSY[label]) b.textContent = BUSY[label];
            try { const r = await fn(); if (r && r.ok === false && r.error) showError(r.error); } catch (e) { showError(e); }
            await refresh();
        });
        return b;
    };
    const row = el('div', 'actions');
    if (STATE_TEXT[p.state]) row.append(el('span', 'state', STATE_TEXT[p.state]));
    // (a failure after writing has a change: that one is undone, not applied again)
    if (p.state === 'pending' || (p.state === 'failed' && !p.change)) {
        row.append(act(DELETES.has(p.op) ? 'Delete' : 'Apply', DELETES.has(p.op) ? 'danger' : 'primary', () => P.invoke('apply', p.id)));
        row.append(act('Reject', '', () => P.invoke('reject', p.id)));
    }
    if (p.change && (p.state === 'applied' || p.state === 'failed') && !p.conflict) row.append(act('Undo', '', () => P.invoke('undo', p.id)));
    c.append(row);
    if (p.error && p.state === 'failed') c.append(el('div', 'err', p.error));
    if (p.undoError) c.append(el('div', 'err', p.undoError));
    if (p.undoNote && p.state === 'undone') c.append(el('div', 'note', p.undoNote));
    // Undo found the item changed since: both versions, and the user picks.
    if (p.conflict) {
        const MADE = { create_card: 'Delete the card anyway', create_lorebook: 'Delete the lorebook anyway', create_persona: 'Delete the persona anyway', create_preset: 'Delete the preset anyway' };
        const made = Object.hasOwn(MADE, p.op);
        // SillyTavern holds these and saves them whole: only the item can go back.
        const pageHeld = /_message|_messages|persona|preset/.test(p.op);
        const box = el('div', 'conflict');
        box.append(el('div', 'q', 'This changed after the co-pilot\'s change. What should Undo do?'));
        box.append(el('div', 'label', 'Now:'), el('div', 'now', show(p.conflict.current)));
        if (!made) box.append(el('div', 'label', 'Before the co-pilot\'s change:'), el('div', 'before', show(p.conflict.before)));
        const r = el('div', 'actions');
        r.append(act('Keep it as it is now', '', () => P.invoke('undo', p.id, 'keep')));
        if (made) r.append(act(MADE[p.op], 'danger', () => P.invoke('undo', p.id, 'mine')));
        else {
            if (!p.conflict.noMine) r.append(act('Put back what it was before', '', () => P.invoke('undo', p.id, 'mine')));
            if (!pageHeld) {
                const w = act('Put the whole file back', '', () => P.invoke('undo', p.id, 'file'));
                w.title = 'The file as it was before the co-pilot\'s change: later changes to it are lost too.';
                r.append(w);
            }
        }
        box.append(r);
        c.append(box);
    }
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
function showNote(text) {
    const log = $('#log');
    log.append(el('div', 'msg info', text));
    log.scrollTop = log.scrollHeight;
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

let sending = false; // a second Send while the first is on its way does nothing
async function sendOrStop({ fromKey = false } = {}) {
    if (st?.busy) {
        if (!fromKey) await P.invoke('stop').catch(showError); // Enter never stops a reply
        return;
    }
    const input = $('#input');
    const text = input.value.trim();
    if (!text || sending) return;
    sending = true;
    input.value = ''; // taken now: what is typed from here on stays
    try {
        await P.invoke('send', text);
        await refresh();
    } catch (e) {
        if (!input.value) input.value = text;
        showError(e);
    } finally { sending = false; }
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
    // Characters with the same name are told apart by their file name.
    const seen = {};
    for (const x of addItems) seen[x.label] = (seen[x.label] || 0) + 1;
    $('#addList').replaceChildren(...addItems.filter(x => !q || x.label.toLowerCase().includes(q)).slice(0, 500).map(x => {
        const o = el('option', null, seen[x.label] > 1 && x.value ? `${x.label} (${x.value})` : x.label);
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

// ---- Changes in this session: newest first, Undo each or all, how long backups are kept ----
function changesOf() {
    const out = [];
    for (const m of st?.current?.messages || []) for (const p of m.proposals || []) if (p.change) out.push({ p, at: parseInt(String(p.change.journal).split('-')[0], 36) || m.at });
    return out.sort((a, b) => b.at - a.at);
}
const STATE_LIST = { applied: 'Applied', failed: 'Partly applied', undone: 'Undone', kept: 'Kept as it is now', expired: 'Backup gone' };
const changesNote = (text, bad = false) => { const n = $('#changesNote'); n.textContent = text; n.classList.toggle('err', bad); n.hidden = !text; };
function renderChanges() {
    const list = changesOf();
    $('#changesList').replaceChildren(...(list.length ? list.map(({ p, at }) => {
        const row = el('div', `change ${p.state}`);
        row.dataset.id = p.id;
        row.append(el('span', 'label', targetOf(p)), el('span', 'when', at ? new Date(at).toLocaleString() : ''));
        if (p.conflict) {
            const b = el('button', null, 'Needs your choice');
            b.addEventListener('click', () => { $('#changesBox').hidden = true; document.querySelector(`#log .proposal[data-id="${p.id}"]`)?.scrollIntoView({ block: 'center' }); });
            row.append(b);
        } else if (['applied', 'failed'].includes(p.state)) {
            const b = el('button', null, 'Undo');
            b.addEventListener('click', async () => {
                b.disabled = true; b.textContent = 'Undoing…';
                let r = null;
                try { r = await P.invoke('undo', p.id); } catch (e) { r = { ok: false, error: String(e.message || e) }; }
                await refresh(); renderChanges();
                if (r?.conflict) changesNote('It changed after the co-pilot\'s change: its card shows both versions.', true);
                else if (r && r.ok === false) changesNote(r.error, true);
            });
            row.append(b);
        } else row.append(el('span', 'state', STATE_LIST[p.state] || p.state));
        if (p.undoError && p.state !== 'undone') row.append(el('span', 'err', p.undoError));
        return row;
    }) : [el('div', 'empty', 'Nothing has been changed in this session.')]));
    const undoable = list.filter(({ p }) => p.change && ['applied', 'failed'].includes(p.state) && !p.conflict).length;
    $('#btnUndoAll').disabled = !undoable;
    $('#undoAllAsk').hidden = true;
    $('#undoAllRow').hidden = false;
    $('#undoAllQ').textContent = `Undo ${undoable} change${undoable === 1 ? '' : 's'}, newest first?`;
    changesNote('');
}
async function loadKeep() {
    try {
        const b = await P.invoke('backups');
        $('#keepDays').value = String(b.days);
        $('#keepCount').value = String(b.keep);
        $('#keepSize').textContent = `Backups of changes use ${(b.size / 1048576).toFixed(1)} MB.`;
    } catch (e) { $('#keepSize').textContent = String(e.message || e); }
}
$('#btnChanges').addEventListener('click', () => { renderChanges(); loadKeep(); $('#changesBox').hidden = false; });
$('#btnChangesClose').addEventListener('click', () => { $('#changesBox').hidden = true; });
$('#btnUndoAll').addEventListener('click', () => { $('#undoAllRow').hidden = true; $('#undoAllAsk').hidden = false; });
$('#btnUndoAllNo').addEventListener('click', () => renderChanges());
$('#btnUndoAllYes').addEventListener('click', async () => {
    $('#btnUndoAllYes').disabled = $('#btnUndoAllNo').disabled = true;
    try {
        const r = await P.invoke('undoAll');
        await refresh();
        renderChanges();
        const said = [`Undid ${r.undone} change${r.undone === 1 ? '' : 's'}.`];
        if (r.stopped) said.push('One changed after the co-pilot\'s change: its card shows both versions. Undo stopped there.');
        if (r.waiting) said.push(`${r.waiting} already wait for your choice on their cards.`);
        for (const f of r.failed || []) said.push(f.error);
        changesNote(said.join(' '), !!(r.stopped || (r.failed || []).length));
    } catch (e) { showError(e); }
    $('#btnUndoAllYes').disabled = $('#btnUndoAllNo').disabled = false;
});
$('#btnKeepSave').addEventListener('click', async () => {
    try {
        await P.invoke('retentionSet', Number($('#keepDays').value), Number($('#keepCount').value));
        await loadKeep();
    } catch (e) { $('#keepSize').textContent = String(e.message || e); }
});
