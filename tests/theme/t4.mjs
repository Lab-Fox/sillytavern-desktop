// .sttheme files in the real app. node t4.mjs <exe> <app|-> <userData> <clone> <workDir>
import { spawn } from 'child_process';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
const require = createRequire(new URL('../../package.json', import.meta.url));
const yazl = require('yazl');
const [exe, app, ud, clone, work] = process.argv.slice(2);
const sleep = ms => new Promise(r => setTimeout(r, ms));
let port = 20000 + Math.floor(Math.random() * 500);
const res = []; const check = (n, ok, x = '') => { res.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x !== '' ? '  -> ' + String(x).slice(0, 170) : ''}`); };
fs.rmSync(ud, { recursive: true, force: true }); fs.mkdirSync(ud, { recursive: true });
fs.rmSync(work, { recursive: true, force: true }); fs.mkdirSync(work, { recursive: true });
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ sillytavernPath: clone, port: 8123, host: 'localhost', autoStart: false, checkUpdatesOnLaunch: false, checkAppUpdates: false, theme: 'fox', confirmBeforeQuit: false, language: 'en' }));

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const FONT = fs.readFileSync(new URL('../../fonts/departure-mono-400.woff2', import.meta.url));
const COLORS = { bg: '#101820', panel: '#1b2a38', border: '#33506a', accent: '#39c5bb', text: '#dfeaf2', title: '#ffffff', muted: '#8aa3b5' };
const MANIFEST = { format: 2, apiVersion: 1, name: 'Soft Test', author: 'Tester', version: '1.0', description: 'A test theme.', colors: COLORS, logo: 'assets/logo.png' };
const CSS = `:root { --btn-radius: 14px; --card-radius: 10px; --hero-bg: url(assets/hero.png) center / cover, var(--panel); }
@font-face { font-family: "TF"; src: url(assets/f.woff2) format("woff2"); }
:root { --heading-font: "TF"; }
html[data-page="backups"] [data-part="sidebar"] { outline: 3px solid rgb(1, 2, 3); }
html[data-server="stopped"] [data-part="brand"] { opacity: .9; }
body::after { content: ""; position: fixed; inset: 0; z-index: 99999; }`;
const BAR = `:root { --bar-bg: rgb(9, 8, 7); --tab-radius: 6px; }`;
function zip(file, entries) {
    return new Promise(res => {
        const z = new yazl.ZipFile();
        for (const [name, data, opt] of entries) z.addBuffer(Buffer.isBuffer(data) ? data : Buffer.from(data), name, { compress: true, ...opt });
        z.end();
        z.outputStream.pipe(fs.createWriteStream(file)).on('close', res);
    });
}
const base = (extra = [], m = {}, css = CSS) => [['theme.json', JSON.stringify({ ...MANIFEST, ...m })], ['theme.css', css], ['bar.css', BAR], ['assets/logo.png', PNG], ['assets/hero.png', PNG], ['assets/f.woff2', FONT], ...extra];
const f = n => path.join(work, n + '.sttheme');
await zip(f('good'), base());
await zip(f('folder'), base().map(([n, d]) => ['My Theme/' + n, d]));
await zip(f('json-only'), [['theme.json', JSON.stringify({ apiVersion: 1, name: 'Plain Pack', colors: COLORS })]]);
const hostile = {
    html: base([['assets/x.html', '<script>1</script>']]), js: base([['evil.js', 'x']]), exe: base([['a.exe', 'MZ']]),
    fakepng: base([['assets/fake.png', 'this is not a picture at all, sorry']]),
    fakefont: base([['assets/fake.woff2', 'this is not a font at all, sorry!!']]),
    symlink: base([['assets/link.png', 'C:/Windows/win.ini', { mode: 0o120777 }]]),
    dupcase: base([['assets/A.png', PNG], ['assets/a.png', PNG]]),
    reserved: base([['assets/con.png', PNG]]), dot: base([['assets/a.png.', PNG]]), ads: base([['assets/a.png:x.png', PNG]]),
    badcss: base([], {}, 'a{background:url(https://evil.example/x.png)}'),
    filecss: base([], {}, ':root{--a:u\\72l("file://host/share/x.png")}'),
    badbarcss: base().map(e => e[0] === 'bar.css' ? ['bar.css', '@import "x";'] : e),
    nomanifest: [['theme.css', 'a{}']], twotops: [['a/theme.json', '{}'], ['b/theme.json', '{}']],
    badjson: [['theme.json', '{nope']], badcolor: base([], { colors: { ...COLORS, bg: 'red;}' } }), noname: base([], { name: '' }),
    future: base([], { apiVersion: 99 }), badapi: base([], { apiVersion: 'x' }),
    logoescape: base([], { logo: '../../settings.json' }), logomissing: base([], { logo: 'assets/none.png' }),
    many: base(Array.from({ length: 2100 }, (_, i) => [`assets/p${i}.png`, PNG])),
    bomb: base([['assets/b.webm', Buffer.alloc(160 * 1024 * 1024)]]),
};
for (const [n, e] of Object.entries(hostile)) await zip(f(n), e);
await zip(f('traversal'), base([['aa/evil.png', PNG]]));
{ const b = fs.readFileSync(f('traversal')); const needle = Buffer.from('aa/evil.png'), rep = Buffer.from('../evil.png'); let i = -1, c = 0; while ((i = b.indexOf(needle, i + 1)) >= 0) { rep.copy(b, i); c++; } fs.writeFileSync(f('traversal'), b); }
fs.writeFileSync(f('notzip'), 'plain text'); fs.writeFileSync(f('empty'), '');
fs.writeFileSync(f('toolarge'), Buffer.alloc(51 * 1024 * 1024));

async function ws(url) {
    const s = new WebSocket(url); await new Promise(r => { s.onopen = r; });
    let id = 0; const w = new Map(), events = [];
    s.onmessage = m => { const d = JSON.parse(m.data); if (d.id) w.get(d.id)?.(d); else events.push(d); };
    const send = (method, params = {}) => new Promise((r, j) => { const i = ++id; w.set(i, r); s.send(JSON.stringify({ id: i, method, params })); setTimeout(() => j(new Error('timeout ' + method + ' ' + String(params.expression).slice(0, 60))), 40000); });
    const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true, userGesture: true, replMode: true, includeCommandLineAPI: true }); if (r.result.exceptionDetails) throw new Error(e.slice(0, 80) + ' => ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300)); return r.result.result.value; };
    return { send, ev, events };
}
async function launch(args = []) {
    port += 2; const CDP = port, INS = port + 1;
    spawn(exe, [...(app === '-' ? [] : [app]), `--user-data-dir=${ud}`, `--remote-debugging-port=${CDP}`, `--inspect=${INS}`, ...args], { stdio: 'ignore' });
    const list = async () => (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
    let page; for (let i = 0; i < 60 && !page; i++) { await sleep(500); try { page = (await list()).find(x => x.url.endsWith('launcher.html')); } catch { /* starting */ } }
    await sleep(3500);
    const L = await ws(page.webSocketDebuggerUrl);
    await L.send('Runtime.enable'); await L.send('Log.enable');
    const t = await (await fetch(`http://127.0.0.1:${INS}/json/list`)).json();
    const M = await ws(t[0].webSocketDebuggerUrl);
    await M.ev(`const { BrowserWindow } = require('electron'); const b = BrowserWindow.getAllWindows()[0]; b.show(); b.moveTop(); 1`);
    return { L, M, list };
}
const STUB = r => `const { dialog } = require('electron'); globalThis.__real = globalThis.__real || dialog.showMessageBox; globalThis.__boxes = globalThis.__boxes || []; dialog.showMessageBox = async (...a) => { const o = a.at(-1); __boxes.push(o.message); return { response: ${r} }; }; 1`;
const quit = async a => { a.M.ev(`const { app } = require('electron'); setTimeout(() => app.exit(0), 100); 1`).catch(() => {}); await sleep(2500); };
const pk = () => fs.readdirSync(path.join(ud, 'themes', 'packages'));
const settings = () => JSON.parse(fs.readFileSync(path.join(ud, 'settings.json'), 'utf8'));
const log = () => fs.readFileSync(path.join(ud, 'desktop-debug.log'), 'utf8');
const install = (a, n) => a.L.ev(`await D.installTheme(${JSON.stringify(f(n))})`);

let a = await launch();
await a.M.ev(STUB(0));
for (const n of [...Object.keys(hostile), 'traversal', 'notzip', 'empty', 'toolarge']) {
    const r = await install(a, n);
    check(`refused: ${n}`, r?.error && !pk().length, r?.error || JSON.stringify(r));
}
check('nothing left behind', pk().length === 0, pk().join(' '));
check('no box for a refused theme', (await a.M.ev(`__boxes.length`)) === 0);

let r = await install(a, 'good');
check('good theme installs', r?.ok && r.id === 'pkg:soft-test', JSON.stringify(r));
await sleep(600);
check('no temp folder', pk().join() === 'soft-test', pk().join());
check('asked, then keep', JSON.stringify(await a.M.ev(`__boxes.slice()`)).includes('Keep this theme'), JSON.stringify(await a.M.ev(`__boxes.slice()`)));
check('saved as active', settings().theme === 'pkg:soft-test');
check('remembered', settings().themesKept?.[0]?.startsWith('pkg:soft-test:'), settings().themesKept);
const v = await a.L.ev(`await (async () => { await new Promise(r => setTimeout(r, 300)); go('home'); await document.fonts.load('16px TF'); const s = getComputedStyle(document.querySelector('.btn')), root = getComputedStyle(document.documentElement);
  const b = $('btnPower').getBoundingClientRect(), hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
  const hero = getComputedStyle(document.querySelector('.hero')).backgroundImage;
  return { radius: s.borderTopLeftRadius, accent: root.getPropertyValue('--accent').trim(), css: $('themeCss').textContent.startsWith('@layer theme'), font: document.fonts.check('16px TF'), hero, hit: !!hit.closest('#btnPower'), logo: document.querySelector('.brand img').src.slice(0, 22) }; })()`);
check('CSS applied', v.css && v.radius === '14px', JSON.stringify(v));
check('colors applied', v.accent === '#39c5bb', v.accent);
check('theme image address', v.hero.includes('st-theme://soft-test/assets/hero.png'), v.hero);
check('theme font loaded', v.font);
check('logo from the theme', v.logo.startsWith('data:image/png'), v.logo);
check('overlay can\'t catch clicks', v.hit);
await a.L.ev(`go('backups'); 1`); await sleep(150);
check('state selector works', (await a.L.ev(`getComputedStyle(document.querySelector('[data-part=sidebar]')).outlineColor`)) === 'rgb(1, 2, 3)');
// list + buttons
await a.L.ev(`go('settings'); showSetPane('look'); 1`); await sleep(400);
const card = await a.L.ev(`[...document.querySelectorAll('.theme-card')].find(c => c.dataset.theme === 'pkg:soft-test').innerText`);
check('listed with its author', /Soft Test/.test(card) && /Tester/.test(card), card.replace(/\n/g, ' '));
check('no Edit on a package', !(await a.L.ev(`!!document.querySelector('[data-edit="pkg:soft-test"]')`)));
// top bar
await a.L.ev(`await D.startServer(); 1`);
let bar; for (let i = 0; i < 80 && !bar; i++) { await sleep(500); bar = (await a.list()).find(x => x.url.endsWith('stbar.html')); }
await sleep(3000);
const B = await ws(bar.webSocketDebuggerUrl);
check('top bar gets its CSS', (await B.ev(`getComputedStyle(document.getElementById('bar')).backgroundColor`)) === 'rgb(9, 8, 7)');
await a.L.ev(`await D.setTheme('fox'); 1`); await sleep(700);
check('top bar loses it with the theme', (await B.ev(`getComputedStyle(document.getElementById('bar')).backgroundColor`)) !== 'rgb(9, 8, 7)');
check('launcher loses it', !(await a.L.ev(`$('themeCss').textContent`)));
await a.L.ev(`await D.stopServer(); 1`).catch(() => {}); await sleep(2000);
// kept: no second question
await a.M.ev(`__boxes.length = 0; 1`);
await a.L.ev(`await D.setTheme('pkg:soft-test'); 1`); await sleep(300);
check('kept theme: no question', (await a.M.ev(`__boxes.length`)) === 0);
await a.L.ev(`await D.setTheme('fox'); 1`);
// go back
await a.M.ev(`const s = JSON.parse(require('fs').readFileSync(${JSON.stringify(path.join(ud, 'settings.json'))}, 'utf8')); 1`);
await zip(f('other'), base([], { name: 'Other Test' }));
await a.M.ev(`const { dialog } = require('electron'); dialog.showMessageBox = async (...a) => ({ response: /^Install/.test(a.at(-1).message) ? 0 : 1 }); 1`);
{ const x = await install(a, 'other'); check('other theme installed', x?.ok, JSON.stringify(x)); } await sleep(500);
check('Go back returns', settings().theme === 'fox', settings().theme);
check('not remembered', !settings().themesKept.some(k => k.startsWith('pkg:other-test')));
// doing nothing
await a.M.ev(`const { dialog } = require('electron'); dialog.showMessageBox = o => new Promise(r => o.signal.addEventListener('abort', () => r({ response: 1 }))); 1`);
const t0 = Date.now();
const pending = a.L.ev(`await D.setTheme('pkg:other-test'); 1`);
await sleep(1000); check('tried while waiting', settings().theme === 'pkg:other-test');
await pending; const took = Date.now() - t0;
check('nothing pressed: back after 15 s', settings().theme === 'fox' && took > 14000 && took < 17000, took + ' ms');
// the real box, untouched: nothing pressed
await a.M.ev(`const { dialog } = require('electron'); dialog.showMessageBox = __real; 1`);
{ const t1 = Date.now(); const q = a.L.ev(`await D.setTheme('pkg:other-test'); 1`); await sleep(2000); check('real box: tried', settings().theme === 'pkg:other-test'); await q; const d = Date.now() - t1; check('real box: closes itself and goes back', settings().theme === 'fox' && d > 14000 && d < 17000, d + ' ms'); }
// export, replace, delete, drop
await a.M.ev(`const { dialog } = require('electron'); dialog.showSaveDialog = async () => ({ filePath: ${JSON.stringify(path.join(work, 'exported.sttheme'))} }); 1`);
await a.L.ev(`await D.exportTheme('pkg:soft-test'); 1`); await sleep(400);
await a.M.ev(STUB(0));
fs.copyFileSync(path.join(work, 'exported.sttheme'), f('exported2'));
r = await install(a, 'exported2'); await sleep(300);
check('export + reinstall replaces', r?.ok && pk().filter(n => n.startsWith('soft-test')).length === 1, pk().join());
await a.L.ev(`await openImport([${JSON.stringify(f('folder'))}]); 1`); await sleep(400);
check('drop route; a zip with a top folder', settings().theme === 'pkg:soft-test', settings().theme);
await zip(f('other-author'), base([], { author: 'Someone Else' }));
r = await install(a, 'other-author'); await sleep(300);
check('same name, other author: kept apart', pk().includes('soft-test-2'), pk().join());
r = await install(a, 'json-only'); await sleep(300);
check('no CSS: no keep question needed', r?.ok && settings().theme === 'pkg:plain-pack', settings().theme);
await a.L.ev(`await D.setTheme('pkg:soft-test-2'); 1`); await sleep(300);
await a.M.ev(STUB(0));
await a.L.ev(`await D.deleteTheme('pkg:soft-test-2'); 1`); await sleep(400);
check('delete removes it', !pk().includes('soft-test-2') && settings().theme === 'sillytavern', settings().theme);
await a.L.ev(`await D.setTheme('pkg:soft-test'); 1`); await sleep(300);
const errs = a.L.events.filter(e => e.method === 'Runtime.exceptionThrown' || (e.method === 'Log.entryAdded' && e.params.entry.level === 'error'));
check('page errors', !errs.length, JSON.stringify(errs.map(e => (e.params.entry?.text || e.params.exceptionDetails?.exception?.description || '').slice(0, 120))));
await quit(a);

// restart: kept theme straight away; then a file changed on disk
a = await launch();
check('after restart', (await a.L.ev(`$('themeCss').textContent.includes('st-theme://soft-test/')`)));
await quit(a);
const cssFile = path.join(ud, 'themes', 'packages', 'soft-test', 'theme.css');
const orig = fs.readFileSync(cssFile, 'utf8');
fs.writeFileSync(cssFile, orig + '\n.x{background:url(https://evil.example/x.png)}');
a = await launch();
check('tampered CSS left out', !(await a.L.ev(`$('themeCss').textContent`)));
check('colors stay', (await a.L.ev(`getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()`)) === '#39c5bb');
check('logged', log().includes('Theme CSS left out'));
await quit(a);
fs.writeFileSync(cssFile, orig);
a = await launch(['--safe-theme']);
check('safe start: no theme CSS', !(await a.L.ev(`$('themeCss').textContent`)) && settings().theme === 'pkg:soft-test');
await quit(a);
console.log(`\n${res.filter(Boolean).length}/${res.length} passed`);
process.exit(0);
