// Writing helper — the launcher panel (runs with `panel` and `ext` in scope).
// Laid out like the launcher's Settings (needs SillyTavern Desktop 1.8.0):
// headed groups of rows, explanations behind ⓘ.
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const tip = text => `<span class="tip" tabindex="0" role="note" aria-label="${esc(text)}"><svg class="i"><use href="#i-info"/></svg></span>`;
// [setting, title, explanation (ⓘ), group]
const SWITCHES = [
    ['suggestions', 'Word suggestions', 'Up to three words next to the text cursor while you type, in every SillyTavern text box and popup. Pick one with the keys below or a click.', 'main'],
    ['autocorrect', 'Autocorrect', 'Fixes clear typos when you finish a word ("teh" → "the", "dont" → "don\'t", "i" → "I"). Press Backspace right after to undo it.', 'main'],
    ['adult', 'Adult words', 'Explicit and slang words count as spelled right and can be suggested.', 'adult'],
    ['adultRow', 'Second row of explicit words', 'Up to three explicit words above the normal suggestions, marked 18+. ↑ twice reaches them, or Alt+4/5/6.', 'adult'],
    ['sceneBoost', 'Notice explicit scenes', 'When what you write and the last chat messages are explicit, explicit words come first in the normal suggestions (marked 18+). It fades as soon as the scene moves on.', 'adult'],
    ['names', 'Names from SillyTavern', 'Character, persona and group names and lorebook keywords count as words.', 'learn'],
    ['learnTyping', 'Learn from what I send', 'Remembers the words you use (also new ones, like names, once you used them twice) and which words follow which. Saved only on this PC.', 'learn'],
    ['learnCharacters', 'Also learn from the characters\' messages', 'When it learns from your chats, the characters\' messages count too: the words and phrasing of your stories. Use "Learn from my chats again" after turning it on.', 'learn'],
];
const box = (id, title, body, extra = '') => `<h3 class="set-h">${title}${extra}</h3><div class="set-group" id="${id}">${body}</div>`;

panel.innerHTML = `
  <p class="muted small" id="whStatus">…</p>
  ${box('whModeBox', 'Suggestions and autocorrect from', `
    <div class="set-row set-wrap"><div class="seg" id="whMode"><button data-mode="helper">This add-on</button><button data-mode="windows">Windows</button><button data-mode="off">Off</button></div>
      <span class="set-desc" id="whModeNote" style="flex-basis:100%"></span></div>
    <div id="whSw-main"></div>`)}
  <div id="whKeysBox">${box('whKeysGroup', 'Picking a word', `
    <div class="set-row set-wrap"><div class="seg" id="whPreset"><button data-preset="windows">Like Windows</button><button data-preset="tab">Tab takes the first</button><button data-preset="custom" disabled>My own keys</button></div>
      <span class="set-desc" id="whKeysNote" style="flex-basis:100%"></span></div>
    <label class="set-row"><div class="set-text"><b>Show the keys in the suggestions</b></div><div class="set-ctl"><input type="checkbox" class="tgl" data-k="keyHints"></div></label>
    <details class="set-row set-free"><summary>Change the keys</summary>
      <div id="whKeys" style="margin-top:6px"></div>
      <div class="row" style="margin-top:8px"><button class="btn sm ghost" id="whKeysReset">Back to the defaults</button></div>
    </details>`)}</div>
  ${box('whSw-adult', 'Explicit words', '')}
  ${box('whLearnBox', 'Learning', `
    <div id="whSw-learn"></div>
    <div class="set-row set-free"><span class="set-desc" id="whLearn"></span>
      <div class="row" style="margin-top:8px"><button class="btn sm" id="whChats">Learn from my chats</button><button class="btn sm ghost" id="whForget">Forget what it learned</button></div></div>`)}
  ${box('whEngineBox', 'Red underlines', `
    <div class="set-row set-free"><span class="set-desc">Windows' spellchecker marks misspelled words in SillyTavern. This add-on tells it about your words, the packs, the names and the everyday words it wrongly rejects.</span></div>`)}
  ${box('whDictBox', 'My dictionary', `
    <div class="set-row set-free">
      <div class="row">
        <input type="text" id="whNew" maxlength="40" placeholder="Add a word" style="flex:1;min-width:140px">
        <button class="btn sm" id="whAdd">Add</button>
        <button class="btn sm ghost" id="whImport">Import…</button>
        <button class="btn sm ghost" id="whExport">Export…</button>
      </div>
      <input type="text" id="whSearch" placeholder="Search my words" style="margin-top:8px;width:100%">
      <div id="whList" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;max-height:220px;overflow:auto"></div>
    </div>`, ` ${tip('Adding a word adds both "word" and "Word"; a word with capitals inside ("McKenzie") is kept as written. In SillyTavern, right-click a word to add it, or select a word that keeps being suggested or autocorrected wrongly and choose Never suggest.')}`)}
  <details style="margin-top:14px"><summary class="small muted">Word lists and credits</summary>
    <p class="muted small" style="margin-top:6px">Word lists: <a style="color:var(--accent)" href="https://github.com/en-wl/wordlist">SCOWL / en-wl wordlist</a> (MIT-like licence), word frequencies from <a style="color:var(--accent)" href="https://github.com/hermitdave/FrequencyWords">FrequencyWords</a> by Hermit Dave (CC BY-SA 4.0, from OpenSubtitles), which words follow which counted in public-domain books from <a style="color:var(--accent)" href="https://www.gutenberg.org/">Project Gutenberg</a>. The adult, roleplay and scene word lists were written for this add-on.</p>
  </details>`;

const $ = id => panel.querySelector('#' + id);
let state = null;

// ---------- keys for picking a word ----------
const ACTIONS = [
    ['enter', 'Move into the suggestions', 'out'],
    ['next', 'Next word', 'in'],
    ['prev', 'Previous word', 'in'],
    ['pick', 'Take the highlighted word', 'in'],
    ['leave', 'Back to the text', 'in'],
    ['close', 'Hide the suggestions', 'both'],
    ['pickFirst', 'Take the first word right away', 'out'],
    ['pick1', 'Take word 1 right away', 'out'],
    ['pick2', 'Take word 2 right away', 'out'],
    ['pick3', 'Take word 3 right away', 'out'],
    ['pick4', 'Take explicit word 1 right away', 'out'],
    ['pick5', 'Take explicit word 2 right away', 'out'],
    ['pick6', 'Take explicit word 3 right away', 'out'],
];
const PRETTY = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Escape: 'Esc' };
const pretty = combo => combo.split('+').map(p => PRETTY[p] || p).join('+');
function comboOf(e) {
    let k = e.key === ' ' ? 'Space' : e.key;
    if (k.length === 1) k = k.toUpperCase();
    if (e.shiftKey && /^Digit\d$/.test(e.code)) k = e.code.slice(5);
    return `${e.ctrlKey ? 'Ctrl+' : ''}${e.altKey ? 'Alt+' : ''}${e.shiftKey ? 'Shift+' : ''}${e.metaKey ? 'Meta+' : ''}${k}`;
}
// Keys SillyTavern or this app already use for something.
const TAKEN = {
    'Ctrl+Enter': 'SillyTavern uses Ctrl+Enter (send or regenerate, depending on its settings).',
    'Alt+Enter': 'SillyTavern uses Alt+Enter (continue the last message).',
    'Ctrl+ArrowUp': 'SillyTavern uses Ctrl+↑ (edit your last message).',
    'Ctrl+Shift+ArrowUp': 'SillyTavern uses Ctrl+Shift+↑ (edit the last message).',
    'Ctrl+PageUp': 'This app uses Ctrl+PgUp to switch tabs.', 'Ctrl+PageDown': 'This app uses Ctrl+PgDn to switch tabs.',
    'Ctrl+Shift+PageUp': 'This app uses Ctrl+Shift+PgUp to move tabs.', 'Ctrl+Shift+PageDown': 'This app uses Ctrl+Shift+PgDn to move tabs.',
    F11: 'This app uses F11 for full screen.',
};
for (const k of 'ZYXCVA') TAKEN[`Ctrl+${k}`] = `Ctrl+${k} is a usual editing key (undo, copy, paste…).`;
const sameKeys = (a, b) => ACTIONS.every(([id]) => JSON.stringify(a[id] || []) === JSON.stringify(b[id] || []));
const presets = () => ({ windows: state.defaultKeys, tab: { ...state.defaultKeys, pickFirst: ['Tab'] } });

// Why a key may not do what the user expects, or ''.
function keyWarning(keys, action, combo) {
    const where = ACTIONS.find(a => a[0] === action)[2];
    const other = ACTIONS.find(([id, , w]) => id !== action && (keys[id] || []).includes(combo) && (w === 'both' || where === 'both' || w === where));
    if (other) return `Also set for "${other[1]}".`;
    if (where === 'in') return ''; // only while a word is highlighted: any key is fine
    if (combo === 'Enter') return 'Enter sends your message: whenever suggestions show, it would take a word instead.';
    if (combo === 'Shift+Enter') return 'Shift+Enter adds a new line in SillyTavern: whenever suggestions show, it would take a word instead.';
    if (/^(Shift\+)?(.|Space|Backspace|Delete)$/.test(combo)) return `${pretty(combo)} types: whenever suggestions show, it would take a word instead.`;
    return TAKEN[combo] || '';
}

let recording = null; // the action waiting for a key
let refused = '';     // a key just pressed that can't be used
function renderKeys() {
    const s = state.settings;
    const keys = s.keys;
    const p = presets();
    const preset = sameKeys(keys, p.windows) ? 'windows' : sameKeys(keys, p.tab) ? 'tab' : 'custom';
    panel.querySelectorAll('[data-preset]').forEach(b => b.classList.toggle('on', b.dataset.preset === preset));
    panel.querySelector('[data-k=keyHints]').checked = !!s.keyHints;
    const k = a => (keys[a] || []).map(pretty).join(' or ') || '—';
    $('whKeysNote').textContent = (keys.enter.length ? `${k('enter')} moves into the suggestions, ${k('prev')} and ${k('next')} choose, ${k('pick')} takes the word, ${k('leave')} goes back to typing.` : '')
        + (keys.pickFirst.length ? ` ${k('pickFirst')} takes the first word right away.` : '')
        + (keys.pick1.length || keys.pick2.length || keys.pick3.length ? ` ${[1, 2, 3].map(i => k(`pick${i}`)).join(', ')} take word 1, 2 or 3.` : '')
        + (s.adultRow && s.adult ? ` In the explicit row: ${k('enter')} once more to get there, ${[4, 5, 6].map(i => k(`pick${i}`)).join(', ')} right away.` : '')
        + (!keys.enter.length && !keys.pickFirst.length && !keys.pick1.length ? ' No key takes a word now: only a click does.' : '')
        + (refused ? ` ${refused} can't be used: pick a letter, digit, F key, arrow, Enter, Tab, Esc, Space or a mark like ; or /, with or without Ctrl, Alt or Shift.` : '');
    refused = '';
    $('whKeys').innerHTML = ACTIONS.map(([id, label]) => {
        const list = keys[id] || [];
        const chips = list.map(c => {
            const warn = keyWarning(keys, id, c);
            return `<span class="tag${warn ? ' warn' : ''}" style="display:inline-flex;gap:6px;align-items:center"${warn ? ` title="${esc(warn)}"` : ''}>${esc(pretty(c))}<button class="link" data-key-rm="${id}" data-combo="${esc(c)}" title="Remove">×</button></span>`;
        }).join(' ');
        const warns = list.map(c => keyWarning(keys, id, c)).filter(Boolean);
        return `<div style="display:flex;flex-wrap:wrap;gap:4px 10px;align-items:center;padding:6px 0;border-top:var(--px) dashed var(--border)">
          <span style="flex:1 1 220px">${esc(label)}</span>
          <span style="display:inline-flex;flex-wrap:wrap;gap:6px;align-items:center">${chips}${list.length < 3 ? `<button class="btn sm ghost" data-key-add="${id}">${recording === id ? 'Press a key…' : '+ Key'}</button>` : ''}</span>
          ${warns.length ? `<span class="small" style="flex-basis:100%;color:var(--warn)">${warns.map(esc).join(' ')}</span>` : ''}
        </div>`;
    }).join('');
    $('whKeys').querySelectorAll('[data-key-rm]').forEach(b => b.onclick = () => saveKeys({ ...keys, [b.dataset.keyRm]: keys[b.dataset.keyRm].filter(c => c !== b.dataset.combo) }));
    $('whKeys').querySelectorAll('[data-key-add]').forEach(b => b.onclick = () => { recording = recording === b.dataset.keyAdd ? null : b.dataset.keyAdd; renderKeys(); });
}
async function saveKeys(keys) {
    await ext.invoke('set', 'keys', keys);
    await load();
}
// While recording, the next key (with its modifiers) becomes the action's key.
window.addEventListener('keydown', function onRecordKey(e) {
    if (!panel.isConnected) { window.removeEventListener('keydown', onRecordKey, true); return; }
    if (!recording) return;
    if (['Shift', 'Control', 'Alt', 'Meta', 'AltGraph'].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    const action = recording;
    recording = null;
    const keys = state.settings.keys;
    const combo = comboOf(e);
    // The same keys main.cjs accepts (letters, digits, F keys, arrows, Enter…).
    if (!/^(?:Ctrl\+)?(?:Alt\+)?(?:Shift\+)?(?:Meta\+)?(?:[A-Z0-9]|F\d{1,2}|Space|Enter|Tab|Escape|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Arrow(?:Up|Down|Left|Right)|[`\-=[\]\\;',./])$/.test(combo)) {
        refused = pretty(combo);
        renderKeys();
        return;
    }
    if ((keys[action] || []).includes(combo)) { renderKeys(); return; }
    saveKeys({ ...keys, [action]: [...(keys[action] || []), combo] });
}, true);
panel.addEventListener('mousedown', e => { if (recording && !e.target.closest('[data-key-add]')) { recording = null; renderKeys(); } });

async function load() {
    state = await ext.invoke('status');
    if (!panel.isConnected) return; // the page changed meanwhile
    const s = state.settings;
    $('whStatus').textContent = state.state === 'ready' ? `Ready: ${state.text}.` : state.text;
    $('whStatus').style.color = state.state === 'error' ? 'var(--bad)' : '';
    panel.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === s.mode));
    const win = state.windows === true ? 'Windows\' text suggestions are on.' : state.windows === false ? 'Windows\' text suggestions are off in Windows.' : '';
    $('whModeNote').innerHTML = s.mode === 'windows'
        ? `This add-on stays quiet and Windows shows its own suggestions. ${win} <button class="link" id="whWinSettings">Open Windows typing settings</button>`
        : s.mode === 'off' ? 'No suggestions or autocorrect from this add-on or from Windows. Your dictionary still counts for the red underlines.'
            : 'Only this add-on\'s suggestions show in SillyTavern; Windows\' own box stays hidden there.';
    $('whWinSettings')?.addEventListener('click', () => ext.invoke('windows-typing'));
    const off = k => (s.mode !== 'helper' && ['suggestions', 'autocorrect', 'adultRow', 'sceneBoost'].includes(k)) || (!s.adult && ['adultRow', 'sceneBoost'].includes(k));
    for (const group of ['main', 'adult', 'learn']) {
        const el = $(`whSw-${group}`);
        el.innerHTML = SWITCHES.filter(x => x[3] === group).map(([k, t, d]) => `<label class="set-row"><div class="set-text"><b>${esc(t)}</b> ${tip(d)}</div><div class="set-ctl"><input type="checkbox" class="tgl" data-k="${k}"${s[k] ? ' checked' : ''}${off(k) ? ' disabled' : ''}></div></label>`).join('');
        el.querySelectorAll('[data-k]').forEach(c => c.onchange = async () => { c.disabled = true; await ext.invoke('set', c.dataset.k, c.checked); load(); });
    }
    $('whKeysBox').hidden = s.mode !== 'helper' || !s.suggestions;
    renderKeys();

    const c = state.chats;
    $('whLearn').textContent = `Knows ${state.learned.toLocaleString('en-US')} of your words and ${state.pairs.toLocaleString('en-US')} word pairs`
        + (c && (c.messages || c.characters) ? `, including ${c.messages.toLocaleString('en-US')} of your messages${c.characters ? ` and ${c.characters.toLocaleString('en-US')} of the characters'` : ''} from ${c.files} chats.` : '.')
        + ` "Learn from my chats" reads ${s.learnCharacters ? 'your and the characters\' messages' : 'your own messages'} in your newest 400 saved chats, on this PC only.`;
    $('whChats').disabled = state.learning || state.state !== 'ready';
    $('whForget').disabled = state.learning; // it would save what it learned right after
    $('whChats').textContent = state.learning ? 'Learning…' : c ? 'Learn from my chats again' : 'Learn from my chats';
    renderWords();
}

async function renderWords() {
    const r = await ext.invoke('words', $('whSearch').value);
    if (!panel.isConnected) return;
    const chip = (w, kind) => `<span class="tag" style="display:inline-flex;gap:6px;align-items:center">${esc(w)}${kind ? ` <i class="muted">(${kind})</i>` : ''}<button class="link" data-rm="${esc(w)}" title="${kind === 'never suggested' ? 'Suggest it again' : 'Remove'}">×</button></span>`;
    // Thousands of chips would slow the whole launcher down: searching finds the rest.
    const all = [...r.words.map(w => [w]), ...r.ignored.map(w => [w, 'ignored']), ...r.blocked.map(w => [w, 'never suggested'])];
    const shown = all.slice(0, 300);
    $('whList').innerHTML = all.length
        ? shown.map(([w, kind]) => chip(w, kind)).join('') + (all.length > shown.length ? `<span class="muted small" style="flex-basis:100%">Showing ${shown.length} of ${all.length.toLocaleString('en-US')}. Search to find the others.</span>` : '')
        : `<span class="muted small">${$('whSearch').value ? 'No match.' : 'No words of your own yet.'}</span>`;
    $('whList').querySelectorAll('[data-rm]').forEach(b => b.onclick = async () => { await ext.invoke('remove-word', b.dataset.rm); renderWords(); });
}

panel.querySelectorAll('[data-mode]').forEach(b => b.onclick = async () => { await ext.invoke('set', 'mode', b.dataset.mode); load(); });
panel.querySelectorAll('[data-preset]').forEach(b => b.onclick = () => { const p = presets()[b.dataset.preset]; if (p) saveKeys(p); });
panel.querySelector('[data-k=keyHints]').onchange = async e => { await ext.invoke('set', 'keyHints', e.target.checked); load(); };
$('whKeysReset').onclick = async () => { await ext.invoke('set', 'keys', null); load(); };
$('whAdd').onclick =async () => { const w = $('whNew').value.trim(); if (w && await ext.invoke('add-word', w)) { $('whNew').value = ''; renderWords(); } };
$('whNew').onkeydown = e => { if (e.key === 'Enter') $('whAdd').click(); };
$('whSearch').oninput = () => renderWords();
$('whImport').onclick = async () => { const n = await ext.invoke('import'); if (n) renderWords(); };
$('whExport').onclick = () => ext.invoke('export');
$('whChats').onclick = async () => { await ext.invoke('learn-chats'); load(); setTimeout(load, 3000); };
$('whForget').onclick = async () => { await ext.invoke('forget'); load(); };
panel.querySelectorAll('a[href]').forEach(a => a.onclick = e => { e.preventDefault(); window.desktop?.openUrl(a.href); });

load();
// While the dictionary builds or learns, show its progress.
const poll = setInterval(() => { if (!panel.isConnected) clearInterval(poll); else if (state && (state.state !== 'ready' || state.learning)) load(); }, 1500);
