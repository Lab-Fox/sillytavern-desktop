// Writing helper — the launcher panel (runs with `panel` and `ext` in scope).
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const SWITCHES = [
    ['suggestions', 'Word suggestions', 'Up to three words above the text box while you type. Tab or Alt+1 takes the first, Alt+2/Alt+3 the others, Esc hides them.'],
    ['autocorrect', 'Autocorrect', 'Fixes clear typos when you finish a word ("teh" → "the", "dont" → "don\'t", "i" → "I"). Press Backspace right after to undo it.'],
    ['tabAccepts', 'Tab takes the first suggestion', 'Only while suggestions show. Off: use Alt+1.'],
    ['adult', 'Adult words', 'Explicit and slang words count as spelled right and can be suggested.'],
    ['names', 'Names from SillyTavern', 'Character, persona and group names and lorebook keywords count as words.'],
    ['learnTyping', 'Learn from what I send', 'Remembers the words you use and which words follow which, for better suggestions. Saved only on this PC.'],
];

panel.innerHTML = `
  <p class="muted small" id="whStatus" style="margin-bottom:10px">…</p>
  <div class="field"><label>Suggestions and autocorrect from</label>
    <div class="seg" id="whMode" style="width:max-content;max-width:100%;flex-wrap:wrap">
      <button data-mode="helper">This add-on</button><button data-mode="windows">Windows</button><button data-mode="off">Off</button>
    </div>
    <p class="muted small" id="whModeNote" style="margin-top:4px"></p>
  </div>
  <div id="whSwitches" class="stack" style="gap:0"></div>
  <div class="field" style="margin-top:12px;padding-top:10px;border-top:var(--px) dashed var(--border)"><label>Red underlines (spellchecker)</label>
    <p class="muted small" id="whEngine"></p>
    <div class="row" style="margin-top:6px"><button class="btn sm" id="whEngineBtn" hidden></button><button class="btn sm primary" id="whRestart" hidden>Restart now</button></div>
  </div>
  <div class="field" style="margin-top:12px;padding-top:10px;border-top:var(--px) dashed var(--border)"><label>Learning</label>
    <p class="muted small" id="whLearn"></p>
    <div class="row" style="margin-top:6px"><button class="btn sm" id="whChats">Learn from my chats</button><button class="btn sm ghost" id="whForget">Forget what it learned</button></div>
  </div>
  <div class="field" style="margin-top:12px;padding-top:10px;border-top:var(--px) dashed var(--border)"><label>My dictionary</label>
    <div class="row">
      <input type="text" id="whNew" maxlength="40" placeholder="Add a word" style="flex:1;min-width:140px">
      <button class="btn sm" id="whAdd">Add</button>
      <button class="btn sm ghost" id="whImport">Import…</button>
      <button class="btn sm ghost" id="whExport">Export…</button>
    </div>
    <p class="muted small" style="margin-top:4px">Adds both "word" and "Word". A word with capitals inside ("McKenzie") is kept as written. Right-click a word in SillyTavern to add it from there.</p>
    <input type="text" id="whSearch" placeholder="Search my words" style="margin-top:8px">
    <div id="whList" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;max-height:220px;overflow:auto"></div>
  </div>
  <p class="muted small" style="margin-top:12px">Word lists: <a style="color:var(--accent)" href="https://github.com/en-wl/wordlist">SCOWL / en-wl wordlist</a> (MIT-like licence), word frequencies from <a style="color:var(--accent)" href="https://github.com/hermitdave/FrequencyWords">FrequencyWords</a> by Hermit Dave (CC BY-SA 4.0, from OpenSubtitles). The adult and roleplay packs were written for this add-on.</p>`;

const $ = id => panel.querySelector('#' + id);
let state = null;

async function load() {
    state = await ext.invoke('status');
    const s = state.settings;
    $('whStatus').textContent = state.state === 'ready' ? `Ready: ${state.text}.` : state.text;
    $('whStatus').style.color = state.state === 'error' ? 'var(--bad)' : '';
    panel.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === s.mode));
    $('whModeNote').innerHTML = s.mode === 'windows'
        ? 'This add-on stays quiet; Windows\' own text suggestions work if they are on in Windows. <button class="link" id="whWinSettings">Open Windows typing settings</button>'
        : s.mode === 'off' ? 'No suggestions or autocorrect. Your dictionary still counts for the red underlines.' : 'Works in every SillyTavern text box.';
    $('whWinSettings')?.addEventListener('click', () => ext.invoke('windows-typing'));
    $('whSwitches').innerHTML = SWITCHES.map(([k, t, d]) => `<label class="switch"><input type="checkbox" data-k="${k}"${s[k] ? ' checked' : ''}${s.mode !== 'helper' && ['suggestions', 'autocorrect', 'tabAccepts'].includes(k) ? ' disabled' : ''}><div><b>${t}</b><span>${d}</span></div></label>`).join('');
    $('whSwitches').querySelectorAll('[data-k]').forEach(c => c.onchange = async () => { c.disabled = true; await ext.invoke('set', c.dataset.k, c.checked); load(); });

    const e = state.engine;
    const builtin = e.chosen === 'builtin';
    $('whEngine').textContent = (e.engine === 'builtin' ? 'Using the built-in English spellchecker. ' : 'Using Windows\' spellchecker: it marks mistakes only in languages installed in Windows, so on many PCs English isn\'t underlined at all. ')
        + 'Your words, the packs and the names count as spelled right in both.';
    $('whEngineBtn').hidden = false;
    $('whEngineBtn').textContent = builtin ? 'Use Windows\' spellchecker' : 'Use the built-in English spellchecker';
    $('whEngineBtn').onclick = async () => { await ext.invoke('engine', builtin ? 'windows' : 'builtin'); load(); };
    $('whRestart').hidden = e.chosen === e.engine;
    $('whRestart').textContent = 'Restart now to switch';

    const c = state.chats;
    $('whLearn').textContent = `Knows ${state.learned.toLocaleString('en-US')} of your words and ${state.pairs.toLocaleString('en-US')} word pairs`
        + (c ? `, including ${c.messages.toLocaleString('en-US')} of your messages from ${c.files} chats.` : '.')
        + ' "Learn from my chats" reads your own messages (not the characters\') in your newest 400 saved chats, on this PC only.';
    $('whChats').disabled = state.learning || state.state !== 'ready';
    $('whChats').textContent = state.learning ? 'Learning…' : c ? 'Learn from my chats again' : 'Learn from my chats';
    renderWords();
}

async function renderWords() {
    const r = await ext.invoke('words', $('whSearch').value);
    const chip = (w, kind) => `<span class="tag" style="display:inline-flex;gap:6px;align-items:center">${esc(w)}${kind ? ' <i class="muted">(ignored)</i>' : ''}<button class="link" data-rm="${esc(w)}" title="Remove">×</button></span>`;
    $('whList').innerHTML = r.words.length || r.ignored.length
        ? [...r.words.map(w => chip(w)), ...r.ignored.map(w => chip(w, 'ignored'))].join('')
        : `<span class="muted small">${$('whSearch').value ? 'No match.' : 'No words of your own yet.'}</span>`;
    $('whList').querySelectorAll('[data-rm]').forEach(b => b.onclick = async () => { await ext.invoke('remove-word', b.dataset.rm); renderWords(); });
}

panel.querySelectorAll('[data-mode]').forEach(b => b.onclick = async () => { await ext.invoke('set', 'mode', b.dataset.mode); load(); });
$('whAdd').onclick = async () => { const w = $('whNew').value.trim(); if (w && await ext.invoke('add-word', w)) { $('whNew').value = ''; renderWords(); } };
$('whNew').onkeydown = e => { if (e.key === 'Enter') $('whAdd').click(); };
$('whSearch').oninput = () => renderWords();
$('whImport').onclick = async () => { const n = await ext.invoke('import'); if (n) renderWords(); };
$('whExport').onclick = () => ext.invoke('export');
$('whRestart').onclick = () => ext.invoke('relaunch');
$('whChats').onclick = async () => { await ext.invoke('learn-chats'); load(); setTimeout(load, 3000); };
$('whForget').onclick = async () => { await ext.invoke('forget'); load(); };
panel.querySelectorAll('a[href]').forEach(a => a.onclick = e => { e.preventDefault(); window.desktop?.openUrl(a.href); });

load();
// While the dictionary builds or learns, show its progress.
const poll = setInterval(() => { if (!panel.isConnected) clearInterval(poll); else if (state && (state.state !== 'ready' || state.learning)) load(); }, 1500);
