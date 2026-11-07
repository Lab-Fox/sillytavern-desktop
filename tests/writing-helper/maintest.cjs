// main.cjs outside the app with a stand-in `api`: broken data, how long the event loop is blocked, saving at quit.
const Module = require('module'), fs = require('fs'), path = require('path'), os = require('os');
const handlers = {}, quit = [];
const orig = Module._load;
Module._load = function (r, ...a) { return r === 'electron' ? { app: { on: (e, f) => quit.push(f), off: () => {} } } : orig.call(this, r, ...a); };
const ADDON = process.argv[2] || require('path').resolve(__dirname, '../../addons/writing-helper');
const DL = process.env.ST_WORD_LISTS || path.join(__dirname, 'keep');
const dir = fs.mkdtempSync(path.join(process.env.ST_TEST_DATA || os.tmpdir(), 'mt-'));
fs.mkdirSync(path.join(dir, 'downloads'));
for (const f of fs.readdirSync(DL)) fs.copyFileSync(path.join(DL, f), path.join(dir, 'downloads', f));
const st = path.join(dir, 'st'), root = path.join(st, 'data/default-user');
for (const d of ['characters', 'groups', 'worlds']) fs.mkdirSync(path.join(root, d), { recursive: true });
fs.writeFileSync(path.join(root, 'characters', 'Zorvexia.png'), '');
fs.writeFileSync(path.join(root, 'groups', 'bad.json'), 'null');
fs.writeFileSync(path.join(root, 'groups', 'bad2.json'), '{oops');
fs.writeFileSync(path.join(root, 'settings.json'), 'null');
fs.writeFileSync(path.join(root, 'worlds', 'a.json'), JSON.stringify({ entries: { 0: null, 1: { key: 'notarray' }, 2: { key: [5, null, 'Quillanthe'] }, 3: { keysecondary: {} } } }));
fs.writeFileSync(path.join(root, 'worlds', 'b.json'), 'null');
fs.writeFileSync(path.join(root, 'worlds', 'c.json'), JSON.stringify({ entries: 'text' }));
const store = { adult: true, learnChats: false };
const logs = [];
const pageHandlers = {};
const api = {
    dir, log: m => logs.push(m), storage: { all: () => store, set: (k, v) => { store[k] = v; } },
    sillytavern: { folder: () => st }, spellcheck: { add() {}, remove() {}, engine: () => ({}), setEngine() {} },
    download: async () => { throw new Error('no download in tests'); },
    pages: { run() {}, addScript() {}, handle: (c, f) => { pageHandlers[c] = f; } },
    contextMenu: { add() {} }, handle: (c, f) => { handlers[c] = f; }, on() {}, app: {},
};
let worst = 0, last = performance.now();
const t = setInterval(() => { const n = performance.now(); worst = Math.max(worst, n - last - 5); last = n; }, 5);
process.on('unhandledRejection', e => { console.log('FAIL unhandled rejection:', e.message); process.exitCode = 1; });
(async () => {
    const m = require(path.join(ADDON, 'main.cjs'));
    const t0 = performance.now();
    m.activate(api);
    for (;;) { const s = await handlers.status(); if (s.state === 'ready' || s.state === 'error') { console.log(s.state, '| names', s.names, '|', Math.round(performance.now() - t0), 'ms, longest block', Math.round(worst), 'ms'); break; } await new Promise(r => setTimeout(r, 20)); }
    const s1 = pageHandlers.suggest(null, 'Zorv', '', '', '');
    const s2 = pageHandlers.suggest(null, 'Quill', '', '', '');
    console.log(s1.words.includes('Zorvexia') ? 'ok   name from a card' : 'FAIL name', s2.words.includes('Quillanthe') ? '| ok lorebook key next to broken entries' : '| FAIL key');
    worst = 0;
    const big = 'あ'.repeat(5000);
    let a = performance.now(); pageHandlers.suggest(null, big, '', '', ''); console.log('long run', (performance.now() - a).toFixed(1), 'ms');
    a = performance.now(); pageHandlers.suggest(null, 'qwertyuiopasdfghjklzxcvbnmqwer', '', '', ''); console.log('30 letters', (performance.now() - a).toFixed(1), 'ms');
    a = performance.now(); pageHandlers.suggest(null, 'qwertyuiopasdfgh', '', '', ''); console.log('16 unknown letters', (performance.now() - a).toFixed(1), 'ms');
    a = performance.now(); pageHandlers.suggest(null, '日本語', '', '', ''); console.log('short Japanese', (performance.now() - a).toFixed(1), 'ms');
    pageHandlers.learn(null, 'the marvelous glimmerfoxen walked and glimmerfoxen sang');
    for (const f of quit) f();
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'user/learned.json'), 'utf8'));
    console.log(saved.fresh.some(x => x[0] === 'glimmerfoxen') ? 'ok   learned words saved at quit' : 'FAIL not saved at quit');
    pageHandlers.learn(null, 'another glimmerfoxen here');
    await handlers.set('adult', false);
    const again = JSON.parse(fs.readFileSync(path.join(dir, 'user/learned.json'), 'utf8'));
    console.log(again.fresh.find(x => x[0] === 'glimmerfoxen')?.[2] === 3 ? 'ok   a rebuild keeps what was just learned' : 'FAIL lost learning in a rebuild');
    clearInterval(t);
    m.deactivate();
    fs.rmSync(dir, { recursive: true, force: true });
    if (logs.some(l => /ERROR/.test(l))) console.log(logs.filter(l => /ERROR/.test(l)));
    process.exit();
})();
