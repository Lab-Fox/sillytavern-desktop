// Theme options. node t6.mjs <exe> <app|-> <userData> <clone> <workDir>
import { spawn } from 'child_process';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
const require = createRequire(new URL('../../package.json', import.meta.url));
const yazl = require('yazl');
const [exe, app, ud, clone, work] = process.argv.slice(2);
const sleep = ms => new Promise(r => setTimeout(r, ms));
let port = 23000 + Math.floor(Math.random() * 500);
const res = []; const check = (n, ok, x = '') => { res.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x !== '' ? '  -> ' + String(x).slice(0, 170) : ''}`); };
fs.rmSync(ud, { recursive: true, force: true }); fs.mkdirSync(ud, { recursive: true });
fs.rmSync(work, { recursive: true, force: true }); fs.mkdirSync(work, { recursive: true });
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ sillytavernPath: clone, port: 8123, host: 'localhost', autoStart: false, checkUpdatesOnLaunch: false, checkAppUpdates: false, theme: 'fox', confirmBeforeQuit: false, language: 'en' }));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const COLORS = { bg: '#101820', panel: '#1b2a38', border: '#33506a', accent: '#39c5bb', text: '#dfeaf2', title: '#ffffff', muted: '#8aa3b5' };
const OPTIONS = [
    { id: 'glow', type: 'toggle', label: 'Glowing buttons', description: 'A soft light around buttons.', default: true },
    { id: 'season', type: 'select', label: 'Season', default: 'winter', choices: [{ value: 'spring', label: 'Spring' }, { value: 'winter', label: 'Winter' }] },
    { id: 'round', type: 'slider', label: 'Corners', min: 0, max: 24, step: 2, unit: 'px', default: 8 },
    { id: 'tint', type: 'color', label: 'Tint', default: '#f0a' },
    { id: 'xss', type: 'toggle', label: '<img src=x onerror="window.__xss=1">', description: '<b onclick=1>bold?</b>' },
];
const CSS = `:root { --btn-radius: var(--opt-round); --card-bg: var(--opt-tint); }
html[data-opt-glow="on"] .btn { outline: 3px solid rgb(1, 2, 3); }
html[data-opt-season="spring"] [data-part="sidebar"] { outline: 3px solid rgb(4, 5, 6); }`;
const BAR = `html[data-opt-glow="on"] #bar { outline: 1px solid rgb(7, 8, 9); } :root { --tab-radius: var(--opt-round); }`;
const MANIFEST = { apiVersion: 1, name: 'Options Test', author: 'T', colors: COLORS, options: OPTIONS,
    layers: [{ id: 'snow', src: 'a.png', slot: 'sidebar', width: '10%', when: { 'opt-season': 'winter' } }] };
const zip = (file, entries) => new Promise(r => { const z = new yazl.ZipFile(); for (const [n, d] of entries) z.addBuffer(Buffer.isBuffer(d) ? d : Buffer.from(d), n); z.end(); z.outputStream.pipe(fs.createWriteStream(file)).on('close', r); });
const f = n => path.join(work, n + '.sttheme');
const pack = (m, css = CSS) => [['theme.json', JSON.stringify(m)], ['theme.css', css], ['bar.css', BAR], ['a.png', PNG]];
await zip(f('good'), pack(MANIFEST));
await zip(f('second'), pack({ ...MANIFEST, name: 'Second Test' }));
await zip(f('plain'), pack({ apiVersion: 1, name: 'Plain Test', colors: COLORS }, ''));
const B = { apiVersion: 1, name: 'Bad', colors: COLORS };
const bad = {
    'not a list': { options: {} }, 'bad id': { options: [{ id: 'A B', type: 'toggle', label: 'x' }] }, 'css in id': { options: [{ id: 'x;y', type: 'toggle', label: 'x' }] }, 'no label': { options: [{ id: 'a', type: 'toggle' }] },
    'unknown type': { options: [{ id: 'a', type: 'text', label: 'x' }] }, 'same ids': { options: [{ id: 'a', type: 'toggle', label: 'x' }, { id: 'a', type: 'toggle', label: 'y' }] },
    'select one choice': { options: [{ id: 'a', type: 'select', label: 'x', choices: [{ value: 'a', label: 'A' }] }] }, 'select bad value': { options: [{ id: 'a', type: 'select', label: 'x', choices: [{ value: '"><b', label: 'A' }, { value: 'b', label: 'B' }] }] },
    'select bad default': { options: [{ id: 'a', type: 'select', label: 'x', default: 'z', choices: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] }] },
    'slider min>=max': { options: [{ id: 'a', type: 'slider', label: 'x', min: 5, max: 5 }] }, 'slider step 0': { options: [{ id: 'a', type: 'slider', label: 'x', min: 0, max: 5, step: 0 }] }, 'slider default out': { options: [{ id: 'a', type: 'slider', label: 'x', min: 0, max: 5, default: 9 }] },
    'slider bad unit': { options: [{ id: 'a', type: 'slider', label: 'x', min: 0, max: 5, unit: ';x' }] }, 'color css': { options: [{ id: 'a', type: 'color', label: 'x', default: 'url(x)' }] }, 'toggle default': { options: [{ id: 'a', type: 'toggle', label: 'x', default: 'yes' }] },
    'too many': { options: Array.from({ length: 31 }, (_, i) => ({ id: 'a' + i, type: 'toggle', label: 'x' })) }, 'bad when': { layers: [{ src: 'a.png', when: { 'opt-A;': 'x' } }] },
};
async function ws(url) {
    const s = new WebSocket(url); await new Promise(r => { s.onopen = r; });
    let id = 0; const w = new Map(), events = [];
    s.onmessage = m => { const d = JSON.parse(m.data); if (d.id) w.get(d.id)?.(d); else events.push(d); };
    const send = (method, params = {}) => new Promise((r, j) => { const i = ++id; w.set(i, r); s.send(JSON.stringify({ id: i, method, params })); setTimeout(() => j(new Error('timeout ' + method + ' ' + String(params.expression).slice(0, 70))), 30000); });
    const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true, userGesture: true, replMode: true, includeCommandLineAPI: true }); if (r.result.exceptionDetails) throw new Error(e.slice(0, 80) + ' => ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300)); return r.result.result.value; };
    return { send, ev, events };
}
async function launch(args = []) {
    port += 2; const P = port;
    spawn(exe, [...(app === '-' ? [] : [app]), `--user-data-dir=${ud}`, `--remote-debugging-port=${P}`, `--inspect=${P + 1}`, "--disable-features=CalculateNativeWinOcclusion", ...args], { stdio: 'ignore' });
    const list = async () => (await fetch(`http://127.0.0.1:${P}/json/list`)).json();
    let page; for (let i = 0; i < 60 && !page; i++) { await sleep(500); try { page = (await list()).find(x => x.url.endsWith('launcher.html')); } catch { /* starting */ } }
    await sleep(3500);
    const L = await ws(page.webSocketDebuggerUrl);
    await L.send('Runtime.enable'); await L.send('Log.enable');
    const M = await ws((await (await fetch(`http://127.0.0.1:${P + 1}/json/list`)).json())[0].webSocketDebuggerUrl);
    await M.ev(`const { BrowserWindow, dialog, app: a0 } = require('electron'); globalThis.W = BrowserWindow.getAllWindows()[0]; globalThis.A = a0; dialog.showMessageBox = async () => ({ response: 0 }); W.show(); W.moveTop(); 1`);
    return { L, M, list };
}
const quit = async a => { a.M.ev(`setTimeout(() => A.exit(0), 100); 1`).catch(() => {}); await sleep(2500); };
const settings = () => JSON.parse(fs.readFileSync(path.join(ud, 'settings.json'), 'utf8'));
let a = await launch();
const L = () => a.L;
for (const [n, m] of Object.entries(bad)) {
    await zip(f('bad'), pack({ ...B, ...m }, ''));
    const r = await a.L.ev(`await D.installTheme(${JSON.stringify(f('bad'))})`);
    check('refused: ' + n, r?.error, r?.error || JSON.stringify(r));
}
await a.L.ev(`go('settings'); showSetPane('look'); 1`); await sleep(400);
check('no options: form hidden', await a.L.ev(`$('themeOptions').hidden && $('themeOptHead').hidden`));
let r = await a.L.ev(`await D.installTheme(${JSON.stringify(f('good'))})`); check('installs', r?.ok, JSON.stringify(r));
await sleep(800);
const root = n => a.L.ev(`document.documentElement.getAttribute('data-opt-${n}')`);
const v = n => a.L.ev(`document.documentElement.style.getPropertyValue('--opt-${n}')`);
check('form shown', await a.L.ev(`!$('themeOptions').hidden && $('themeOptions').querySelectorAll('.set-row').length === 5`));
check('defaults: toggle', await root('glow') === 'on'); check('defaults: select', await root('season') === 'winter');
check('defaults: slider', await v('round') === '8px'); check('defaults: colour, short form made long', await v('tint') === '#ff00aa', await v('tint'));
check('default toggle off', await root('xss') === 'off');
check('CSS sees the slider', await a.L.ev(`getComputedStyle(document.querySelector('.btn')).borderTopLeftRadius`) === '8px');
check('CSS sees the toggle', await a.L.ev(`getComputedStyle(document.querySelector('.btn')).outlineColor`) === 'rgb(1, 2, 3)');
check('layer follows the select', await a.L.ev(`!document.querySelector('[data-layer="snow"]').hidden`));
check('label is text, not HTML', await a.L.ev(`!window.__xss && !$('themeOptions').querySelector('img, [onclick]') && $('themeOptions').textContent.includes('<img src=x')`));
// real controls
const row = i => `$('themeOptions').querySelectorAll('.set-row')[${i}]`;
await a.L.ev(`(() => { const e = ${row(0)}.querySelector('input'); e.click(); })(); 1`); await sleep(350);
check('toggle off', await root('glow') === 'off');
await a.L.ev(`(() => { const e = ${row(1)}.querySelector('select'); e.value = 'spring'; e.onchange(); })(); 1`); await sleep(350);
check('select changes', await root('season') === 'spring');
check('select reaches CSS', await a.L.ev(`getComputedStyle(document.querySelector('[data-part=sidebar]')).outlineColor`) === 'rgb(4, 5, 6)');
check('select hides the layer', await a.L.ev(`document.querySelector('[data-layer="snow"]').hidden`));
await a.L.ev(`await (async () => { const e = ${row(2)}.querySelector('input'); e.focus(); for (const x of [10, 12, 14, 16, 18, 20]) { e.value = x; e.oninput(); await new Promise(r => setTimeout(r, 15)); } })(); 1`);
check('slider label follows at once', await a.L.ev(`${row(2)}.querySelector('output').textContent`) === '20px');
await sleep(350);
check('slider applied', await v('round') === '20px');
check('slider keeps focus while dragging', await a.L.ev(`document.activeElement === ${row(2)}.querySelector('input')`));
await a.L.ev(`(() => { const e = ${row(3)}.querySelector('input'); e.value = '#112233'; e.oninput(); })(); 1`); await sleep(350);
check('colour applied', await v('tint') === '#112233');
{ const c = await a.L.ev(`getComputedStyle(document.querySelector('.set-group')).backgroundColor`); check('colour reaches CSS', c === 'rgb(17, 34, 51)', c); }
const saved = settings().themeOptions['pkg:options-test'];
check('saved', saved.glow === false && saved.season === 'spring' && saved.round === 20 && saved.tint === '#112233', JSON.stringify(saved));
check('no keep question for an option', settings().themesKept.length === 1);
// top bar
await a.L.ev(`await D.startServer(); 1`);
let bar; for (let i = 0; i < 80 && !bar; i++) { await sleep(500); bar = (await a.list()).find(x => x.url.endsWith('stbar.html')); }
await sleep(2500);
const Bw = await ws(bar.webSocketDebuggerUrl);
check('top bar gets the values', (await Bw.ev(`document.documentElement.getAttribute('data-opt-glow') + ' ' + document.documentElement.style.getPropertyValue('--opt-round')`)) === 'off 20px');
await a.L.ev(`(() => { const e = ${row(0)}.querySelector('input'); e.click(); })(); 1`); await sleep(400);
check('top bar follows live', (await Bw.ev(`getComputedStyle(document.getElementById('bar')).outlineColor`)) === 'rgb(7, 8, 9)');
await a.L.ev(`await D.stopServer(); 1`).catch(() => {}); await sleep(2000);
// a second theme has its own values
await a.L.ev(`(() => { const e = ${row(0)}.querySelector('input'); e.click(); })(); 1`); await sleep(350);
r = await a.L.ev(`await D.installTheme(${JSON.stringify(f('second'))})`); await sleep(600);
check('other theme starts at its defaults', await v('round') === '8px' && await root('glow') === 'on');
await a.L.ev(`await D.setTheme('pkg:options-test'); 1`); await sleep(600);
check('first theme keeps its values', await v('round') === '20px' && await root('glow') === 'off', await v('round'));
// a slider moved right before picking another theme
await a.L.ev(`go('settings'); showSetPane('look'); 1`); await sleep(300);
await a.L.ev(`(() => { const e = ${row(2)}.querySelector('input'); e.value = 4; e.oninput(); })(); await D.setTheme('pkg:second-test'); 1`); await sleep(2500);
{ const o = settings().themeOptions; check('late value goes to its own theme', o['pkg:options-test'].round === 4 && o['pkg:second-test']?.round !== 4, JSON.stringify(o)); }
check('the other theme is untouched on screen', await v('round') === '8px', await v('round'));
await a.L.ev(`await D.setTheme('fox'); 1`); await sleep(500);
check('default theme: nothing left', await a.L.ev(`!document.documentElement.getAttributeNames().some(n => n.startsWith('data-opt')) && !document.documentElement.style.getPropertyValue('--opt-round') && $('themeOptions').hidden`));
await a.L.ev(`await D.setTheme('pkg:options-test'); 1`); await sleep(500);
const errs = a.L.events.filter(e => e.method === 'Runtime.exceptionThrown' || (e.method === 'Log.entryAdded' && e.params.entry.level === 'error'));
check('no page errors', !errs.length, JSON.stringify(errs.map(e => (e.params.entry?.text || e.params.exceptionDetails?.exception?.description || '').slice(0, 140))));
await a.L.send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 720, deviceScaleFactor: 1, mobile: false });
await a.L.ev(`go('settings'); showSetPane('look'); $('console').innerHTML = ''; $('themeOptHead').scrollIntoView(); 1`); await sleep(500);
fs.writeFileSync(path.join(work, 'options.png'), Buffer.from((await a.L.send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
await a.L.send('Emulation.setDeviceMetricsOverride', { width: 820, height: 560, deviceScaleFactor: 1, mobile: false }); await sleep(300);
check('fits at 820', await a.L.ev(`(() => { const b = $('themeOptions'); return b.scrollWidth <= b.clientWidth + 1 && document.querySelector('.page.show').scrollWidth <= document.querySelector('.page.show').clientWidth; })()`));
await a.L.send('Emulation.clearDeviceMetricsOverride');
await quit(a);
// restart, then values the theme no longer allows
a = await launch();
check('after restart', await v('round') === '4px' && await root('season') === 'spring');
await quit(a);
const s = settings(); s.themeOptions['pkg:options-test'] = { glow: 'yes', season: 'mars', round: 999, tint: 'url(x)', extra: 1 }; fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify(s));
a = await launch();
check('bad stored values: defaults', await v('round') === '8px' && await root('season') === 'winter' && await v('tint') === '#ff00aa' && await root('glow') === 'on', await v('tint'));
await a.L.ev(`go('settings'); showSetPane('look'); 1`); await sleep(400);
await a.L.ev(`(() => { const e = ${row(2)}.querySelector('input'); e.value = 2; e.oninput(); })(); 1`); await sleep(350);
await a.L.ev(`$('btnThemeOptReset').click(); 1`); await sleep(400);
check('Back to the defaults', await v('round') === '8px' && (await a.L.ev(`${row(2)}.querySelector('output').textContent`)) === '8px' && !settings().themeOptions['pkg:options-test']);
await a.L.ev(`(() => { const e = ${row(2)}.querySelector('input'); e.value = 2; e.oninput(); })(); 1`); await sleep(350);
await a.L.ev(`await D.deleteTheme('pkg:options-test'); 1`); await sleep(500);
check('delete forgets the values', !settings().themeOptions['pkg:options-test']);
await a.L.ev(`await D.setTheme('pkg:second-test'); 1`); await sleep(400);
await quit(a);
a = await launch(['--safe-theme']);
check('safe start: no options', await a.L.ev(`!document.documentElement.getAttributeNames().some(n => n.startsWith('data-opt'))`));
await quit(a);
console.log(`\n${res.filter(Boolean).length}/${res.length} passed`);
process.exit(0);
