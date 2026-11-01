// Writing helper — a desktop extension for SillyTavern Desktop.
// A dictionary of its own (with adult and roleplay words, your own words and
// your characters' names), word suggestions above SillyTavern's text boxes,
// and autocorrect that a Backspace undoes. Everything stays on your PC: the
// word lists are downloaded once (checked against their SHA256), what it
// learns from your typing is saved in this extension's folder.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const L = require('./lexicon.cjs');

// Word lists, pinned to exact files.
const SOURCES = {
    scowl: {
        url: 'https://github.com/en-wl/wordlist/releases/download/rel-2026.02.25/hunspell-en_US-large-2026.02.25.zip',
        sha256: '06ab5a2a12c29033f100988d3b0a5e53dcad40bf2473ccb78270619d1da99321',
        file: 'hunspell-en_US-large-2026.02.25.zip',
    },
    freq: {
        url: 'https://raw.githubusercontent.com/hermitdave/FrequencyWords/525f9b560de45753a5ea01069454e72e9aa541c6/content/2018/en/en_50k.txt',
        sha256: '5351ff405b1126ef555791dd4d9798a48e3e9a501a9fc481a9da957752cfb458',
        file: 'en_50k.txt',
    },
};

const DEFAULTS = {
    mode: 'helper',      // 'helper' (this add-on), 'windows' (Windows' own suggestions), 'off'
    suggestions: true,   // the strip of words above the text box
    autocorrect: true,   // fix clear typos when you type a space or punctuation
    tabAccepts: true,    // Tab takes the first suggestion (while the strip shows)
    adult: true,         // the adult word pack
    names: true,         // character, persona, group and lorebook names count as words
    learnTyping: true,   // remember words and word pairs from what you send
    learnChats: false,   // also learn from your messages in saved chats (asked first)
};

let api = null;
let lex = null;
let status = { state: 'starting', text: 'Starting…' };
let userWords = { words: [], ignored: [] };
let nameList = [];
let saveTimer = null;
const dir = () => api.dir;
const userFile = f => path.join(dir(), 'user', f);
const settings = () => ({ ...DEFAULTS, ...api.storage.all() });
const readJson = (f, fallback) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; } };
const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(`${f}.tmp`, JSON.stringify(v)); fs.renameSync(`${f}.tmp`, f); };
const pack = name => fs.readFileSync(path.join(__dirname, 'packs', name), 'utf8').split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#'));
const cap = w => (w ? w[0].toUpperCase() + w.slice(1) : w);

function setStatus(state, text) {
    status = { state, text };
    pushConfig();
}

// ---------- word lists ----------
async function ensureFile(src) {
    const file = path.join(dir(), 'downloads', src.file);
    try {
        const hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
        if (hash === src.sha256) return file;
    } catch { /* not downloaded yet */ }
    setStatus('loading', `Downloading ${src.file} …`);
    await api.download(src.url, { file: src.file, sha256: src.sha256 });
    return file;
}

async function build() {
    try {
        setStatus('loading', 'Getting the word lists…');
        const zip = fs.readFileSync(await ensureFile(SOURCES.scowl));
        const freqText = fs.readFileSync(await ensureFile(SOURCES.freq), 'utf8');
        setStatus('loading', 'Building the dictionary…');
        const words = L.expandHunspell(L.unzipEntry(zip, 'en_US-large.aff').toString('utf8'), L.unzipEntry(zip, 'en_US-large.dic').toString('utf8'));
        for (const w of pack('roleplay.txt')) words.set(w, false);
        const s = settings();
        lex = new L.Lexicon({ words, freq: L.parseFreq(freqText), adult: pack('adult.txt'), adultOn: s.adult });
        lex.setUser(userWords.words);
        for (const w of userWords.ignored) lex.ignored.add(w.toLowerCase());
        lex.importLearned(readJson(userFile('learned.json'), null));
        await scanNames();
        lex.suggestable();
        syncSpellchecker();
        setStatus('ready', `${lex.base.size.toLocaleString('en-US')} words, ${lex.vocab.size.toLocaleString('en-US')} suggested`);
        if (s.learnChats && !readJson(userFile('chats-learned.json'), null)) learnFromChats();
    } catch (e) {
        lex = null;
        setStatus('error', `Could not build the dictionary: ${e.message}`);
        api.log(`ERROR: ${e.message}`);
    }
}

// ---------- names from SillyTavern's data ----------
// Character file names, persona names, group names and lorebook keys of the
// SillyTavern in use (its default-user). Only words the dictionary lacks.
async function scanNames() {
    nameList = [];
    if (!settings().names || !lex) { lex?.setNames([]); return; }
    const root = path.join(api.sillytavern.folder() || '', 'data', 'default-user');
    const found = new Set();
    const addText = t => { for (const w of L.tokens(t)) if (w.length >= 2 && w.length <= 30 && !lex.base.has(w.toLowerCase())) found.add(w); };
    const list = d => { try { return fs.readdirSync(path.join(root, d)); } catch { return []; } };
    for (const f of list('characters')) if (/\.png$/i.test(f)) addText(f.replace(/\.png$/i, ''));
    for (const f of list('groups')) if (f.endsWith('.json')) addText(readJson(path.join(root, 'groups', f), {}).name || '');
    const personas = readJson(path.join(root, 'settings.json'), {})?.power_user?.personas || {};
    for (const n of Object.values(personas)) addText(String(n));
    for (const f of list('worlds')) {
        if (!f.endsWith('.json')) continue;
        const entries = readJson(path.join(root, 'worlds', f), {}).entries || {};
        for (const e of Object.values(entries)) for (const k of [...(e.key || []), ...(e.keysecondary || [])]) if (!/[\\^$*+?()[\]{}|/]/.test(k)) addText(k);
    }
    nameList = [...found].slice(0, 20000);
    lex.setNames(nameList);
}

// Chromium's red underline: our extra words (packs, your words, names) are
// spelled right there too. Remembered, so removed words can be taken back out.
function syncSpellchecker() {
    if (!lex) return;
    const want = new Set();
    const s = settings();
    for (const w of [...pack('roleplay.txt'), ...(s.adult ? pack('adult.txt') : [])]) { want.add(w); want.add(cap(w)); }
    for (const w of userWords.words) { want.add(w); if (w === w.toLowerCase()) want.add(cap(w)); }
    for (const w of userWords.ignored) want.add(w);
    for (const n of nameList) want.add(n);
    const had = new Set(readJson(userFile('spellchecker.json'), []));
    const add = [...want].filter(w => !had.has(w) && !/\s/.test(w));
    const remove = [...had].filter(w => !want.has(w));
    if (add.length) api.spellcheck.add(add);
    if (remove.length) api.spellcheck.remove(remove);
    writeJson(userFile('spellchecker.json'), [...want]);
}

// ---------- your dictionary ----------
function saveUserWords() {
    writeJson(userFile('words.json'), userWords);
    if (lex) {
        lex.setUser(userWords.words);
        lex.ignored = new Set(userWords.ignored.map(w => w.toLowerCase()));
    }
    syncSpellchecker();
}
// "word" → both "word" and "Word" (so it counts at the start of a sentence
// too); a word with capitals inside ("iPhone", "McKenzie") as written.
function addWord(word, exact = false) {
    word = String(word || '').trim();
    if (!word || word.length > 40 || /\s/.test(word)) return false;
    const forms = exact || /[A-Z]/.test(word.slice(1)) ? [word] : [word.toLowerCase(), cap(word.toLowerCase())];
    for (const f of forms) if (!userWords.words.includes(f)) userWords.words.push(f);
    userWords.ignored = userWords.ignored.filter(w => w.toLowerCase() !== word.toLowerCase());
    saveUserWords();
    api.log(`Added "${forms.join('", "')}" to your dictionary.`);
    return true;
}
function removeWord(word) {
    const l = String(word || '').toLowerCase();
    const before = userWords.words.length + userWords.ignored.length;
    userWords.words = userWords.words.filter(w => w.toLowerCase() !== l);
    userWords.ignored = userWords.ignored.filter(w => w.toLowerCase() !== l);
    if (userWords.words.length + userWords.ignored.length === before) return false;
    saveUserWords();
    return true;
}
function ignoreWord(word) {
    word = String(word || '').trim();
    if (!word || userWords.ignored.includes(word)) return false;
    userWords.ignored.push(word);
    saveUserWords();
    return true;
}
const inUserDict = w => !!w && (userWords.words.some(x => x.toLowerCase() === w.toLowerCase()) || userWords.ignored.some(x => x.toLowerCase() === w.toLowerCase()));

// ---------- learning ----------
function saveLearnedSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { if (lex) writeJson(userFile('learned.json'), lex.exportLearned()); }, 20000);
}
// Your own messages in saved chats (newest first, at most 400 files / 40 MB).
let chatJob = null;
function learnFromChats() {
    if (chatJob || !lex) return chatJob;
    chatJob = (async () => {
        const chats = path.join(api.sillytavern.folder() || '', 'data', 'default-user', 'chats');
        const files = [];
        try {
            for (const d of fs.readdirSync(chats, { withFileTypes: true })) {
                if (!d.isDirectory()) continue;
                for (const f of fs.readdirSync(path.join(chats, d.name))) if (f.endsWith('.jsonl')) {
                    const p = path.join(chats, d.name, f);
                    try { const st = fs.statSync(p); files.push({ p, t: st.mtimeMs, size: st.size }); } catch { /* gone */ }
                }
            }
        } catch (e) { api.log(`Could not read the chats folder: ${e.message}`); }
        files.sort((a, b) => b.t - a.t);
        let bytes = 0, done = 0, messages = 0;
        for (const f of files) {
            if (done >= 400 || bytes > 40e6) break;
            bytes += f.size;
            done++;
            let text = '';
            try { text = await fs.promises.readFile(f.p, 'utf8'); } catch { continue; }
            for (const line of text.split('\n')) {
                if (!line.includes('"is_user":true')) continue;
                try { const m = JSON.parse(line); if (m.is_user && typeof m.mes === 'string') { lex.learn(m.mes); messages++; } } catch { /* broken line */ }
            }
            setStatus('ready', `Learning from your chats… ${done} of ${Math.min(files.length, 400)}`);
            await new Promise(r => setImmediate(r));
        }
        writeJson(userFile('learned.json'), lex.exportLearned());
        writeJson(userFile('chats-learned.json'), { at: new Date().toISOString(), files: done, messages });
        setStatus('ready', `Learned from ${messages.toLocaleString('en-US')} of your messages in ${done} chats.`);
        api.log(`Learned from ${messages} messages in ${done} chats.`);
    })().finally(() => { chatJob = null; });
    return chatJob;
}

// ---------- pages ----------
const PAGE_CODE = fs.readFileSync(path.join(__dirname, 'page.js'), 'utf8');
function config() {
    const s = settings();
    return { mode: s.mode, suggestions: s.suggestions, autocorrect: s.autocorrect, tabAccepts: s.tabAccepts, learnTyping: s.learnTyping, ready: status.state === 'ready' };
}
function pushConfig() {
    if (!api) return;
    api.pages.run(`window.__desktopWritingHelper?.setConfig(${JSON.stringify(config())})`);
}

// The word for a right-click: the underlined word, or one selected word.
function wordOf(info) {
    if (info.misspelledWord) return info.misspelledWord;
    const s = info.selectionText.trim();
    return s && s.length <= 40 && /^[\p{L}\p{M}'’-]+$/u.test(s) ? s : '';
}

exports.activate = function (a) {
    api = a;
    userWords = readJson(userFile('words.json'), { words: [], ignored: [] });

    api.pages.addScript(PAGE_CODE);
    api.pages.handle('config', () => config());
    api.pages.handle('suggest', (_page, prefix, prev) => {
        // → { words, fixes }: the first `fixes` words are corrections of a misspelled word.
        const s = settings();
        if (!lex || s.mode !== 'helper' || !s.suggestions) return { words: [], fixes: 0 };
        const p = String(prefix || ''), pv = String(prev || '');
        // Endings of the word being typed ("har" → harbor, hard). Only when no
        // word starts like that is it a typo: then corrections ("wierd" → weird).
        const endings = lex.complete(p, pv, 3);
        if (p.length >= 3 && !lex.known(p)) {
            // What a space would correct it to comes first ("teh" → the, "dont" → don't).
            const sure = s.autocorrect ? lex.autocorrect(p, pv) : null;
            if (!endings.length) {
                const fixes = [...new Set([sure, ...lex.corrections(p, 3).map(c => c.word)].filter(Boolean))].slice(0, 3);
                return { words: fixes, fixes: fixes.length };
            }
            if (sure) return { words: [sure, ...endings.filter(w => w !== sure)].slice(0, 3), fixes: 1 };
        }
        return { words: endings, fixes: 0 };
    });
    api.pages.handle('correct', (_page, word, prev) => {
        const s = settings();
        if (!lex || s.mode !== 'helper' || !s.autocorrect) return null;
        return lex.autocorrect(String(word || ''), String(prev || ''));
    });
    api.pages.handle('learn', (_page, text) => {
        if (!lex || !settings().learnTyping) return;
        lex.learn(String(text || '').slice(0, 20000));
        saveLearnedSoon();
    });
    api.pages.handle('add', (_page, word) => addWord(word));

    // Right-click: next to the spellchecker's suggestions.
    api.contextMenu.add({
        group: 'spelling', contexts: ['editable', 'selection', 'misspelled'],
        label: info => { const w = wordOf(info); return w ? (inUserDict(w) ? `Remove "${w}" from my dictionary` : `Add "${w}" to dictionary`) : ''; },
        click: info => { const w = wordOf(info); if (inUserDict(w)) removeWord(w); else addWord(w); },
    });
    api.contextMenu.add({
        group: 'spelling', contexts: ['editable', 'selection', 'misspelled'],
        // "Kael": only with the capital (like a name), not "kael" too.
        label: info => { const w = wordOf(info); return w && !inUserDict(w) && /^\p{Lu}[^\p{Lu}]*$/u.test(w) ? `Add only "${w}" (always with a capital)` : ''; },
        click: info => addWord(wordOf(info), true),
    });
    api.contextMenu.add({
        group: 'spelling', contexts: ['misspelled'],
        label: info => (inUserDict(info.misspelledWord) ? '' : `Ignore "${info.misspelledWord}" (never mark or correct it)`),
        click: info => ignoreWord(info.misspelledWord),
    });
    // A text box without a selected or underlined word: the word at the cursor.
    api.contextMenu.add({
        group: 'spelling', contexts: ['editable'],
        when: info => !wordOf(info),
        label: 'Add the word at the cursor to dictionary',
        click: async info => {
            const w = await info.page.run('window.__desktopWritingHelper?.wordAtCursor() || ""');
            if (w) addWord(w);
        },
    });

    // The launcher panel.
    api.handle('status', () => ({
        ...status, settings: settings(), engine: api.spellcheck.engine(),
        words: userWords.words.length, ignored: userWords.ignored.length, names: nameList.length,
        learned: lex ? lex.learned.size : 0, pairs: lex ? [...lex.bigrams.values()].reduce((n, m) => n + m.size, 0) : 0,
        chats: readJson(userFile('chats-learned.json'), null), learning: !!chatJob,
    }));
    api.handle('set', async (key, value) => {
        if (!(key in DEFAULTS) || typeof value !== typeof DEFAULTS[key]) return false;
        if (key === 'mode' && !['helper', 'windows', 'off'].includes(value)) return false;
        api.storage.set(key, value);
        if (key === 'adult') await build();
        else if (key === 'names') { await scanNames(); syncSpellchecker(); }
        else pushConfig();
        return true;
    });
    api.handle('words', (q = '') => {
        const l = String(q).toLowerCase();
        return { words: userWords.words.filter(w => w.toLowerCase().includes(l)).sort((a, b) => a.localeCompare(b)), ignored: userWords.ignored.filter(w => w.toLowerCase().includes(l)) };
    });
    api.handle('add-word', (w, exact) => addWord(w, !!exact));
    api.handle('remove-word', w => removeWord(w));
    api.handle('import', async () => {
        const { dialog } = require('electron');
        const r = await dialog.showOpenDialog({ title: 'Import words', filters: [{ name: 'Word lists', extensions: ['txt', 'dic'] }], properties: ['openFile'] });
        if (r.canceled || !r.filePaths[0]) return 0;
        // .txt: one word per line; .dic (Hunspell): the first line is a count, "/flags" are dropped.
        const lines = fs.readFileSync(r.filePaths[0], 'utf8').split(/\r?\n/);
        let n = 0;
        for (const [i, line] of lines.entries()) {
            const w = line.split('/')[0].trim();
            if (!w || w.startsWith('#') || (i === 0 && /^\d+$/.test(w)) || /\s/.test(w) || w.length > 40) continue;
            if (!userWords.words.includes(w)) { userWords.words.push(w); n++; }
        }
        saveUserWords();
        return n;
    });
    api.handle('export', async () => {
        const { dialog } = require('electron');
        const r = await dialog.showSaveDialog({ title: 'Export your words', defaultPath: 'my-words.txt', filters: [{ name: 'Text', extensions: ['txt'] }] });
        if (r.canceled || !r.filePath) return false;
        fs.writeFileSync(r.filePath, [...userWords.words].sort((a, b) => a.localeCompare(b)).join('\n') + '\n');
        return true;
    });
    api.handle('learn-chats', () => { api.storage.set('learnChats', true); learnFromChats(); return true; });
    api.handle('forget', () => {
        if (lex) lex.importLearned(null);
        for (const f of ['learned.json', 'chats-learned.json']) fs.rmSync(userFile(f), { force: true });
        api.storage.set('learnChats', false);
        return true;
    });
    api.handle('engine', e => api.spellcheck.setEngine(e));
    api.handle('relaunch', async () => {
        const { dialog } = require('electron');
        const { response } = await dialog.showMessageBox({ type: 'question', buttons: ['Restart', 'Cancel'], defaultId: 0, cancelId: 1, noLink: true, message: 'Restart SillyTavern Desktop now?', detail: 'The spellchecker changes after a restart. The SillyTavern server stops and starts again; unsaved text in SillyTavern pages is lost.' });
        if (response === 0) api.app.relaunch();
        return response === 0;
    });
    api.handle('windows-typing', () => require('electron').shell.openExternal('ms-settings:typing'));
    api.handle('rescan', async () => { await scanNames(); syncSpellchecker(); return nameList.length; });

    // New characters, personas and lorebooks show up after a server start.
    api.on('server-started', () => { scanNames().then(syncSpellchecker); });
    build();
};

exports.deactivate = function () {
    clearTimeout(saveTimer);
    if (lex) writeJson(userFile('learned.json'), lex.exportLearned());
    api.pages.run('window.__desktopWritingHelper?.destroy()');
    lex = null;
};
