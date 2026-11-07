// Release smoke test of the portable exe. node t11.mjs <exe> <userData> <clone> <themeFile> <version>
import { spawn, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
const [exe, ud, clone, themeFile, version] = process.argv.slice(2);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const port = 28000 + Math.floor(Math.random() * 500);
const res = []; const check = (n, ok, x = '') => { res.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x !== '' ? '  -> ' + String(x).slice(0, 200) : ''}`); };
fs.rmSync(ud, { recursive: true, force: true }); fs.mkdirSync(ud, { recursive: true });
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ sillytavernPath: clone, port: 8123, host: 'localhost', autoStart: false, checkUpdatesOnLaunch: false, checkAppUpdates: false, theme: 'fox', confirmBeforeQuit: false, language: 'en' }));
async function ws(url) {
    const s = new WebSocket(url); await new Promise(r => { s.onopen = r; });
    let id = 0; const w = new Map(), events = [];
    s.onmessage = m => { const d = JSON.parse(m.data); if (d.id) w.get(d.id)?.(d); else events.push(d); };
    const send = (method, params = {}) => new Promise((r, j) => { const i = ++id; w.set(i, r); s.send(JSON.stringify({ id: i, method, params })); setTimeout(() => j(new Error('timeout ' + method + ' ' + String(params.expression).slice(0, 70))), 30000); });
    const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true, userGesture: true, replMode: true, includeCommandLineAPI: true }); if (r.result.exceptionDetails) throw new Error(e.slice(0, 80) + ' => ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300)); return r.result.result.value; };
    return { send, ev, events };
}
spawn(exe, [`--user-data-dir=${ud}`, `--remote-debugging-port=${port}`, `--inspect=${port + 1}`, '--disable-features=CalculateNativeWinOcclusion'], { stdio: 'ignore', detached: true }).unref();
const list = async () => (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
let page; for (let i = 0; i < 80 && !page; i++) { await sleep(500); try { page = (await list()).find(x => x.url.endsWith('launcher.html')); } catch { /* unpacking */ } }
await sleep(3500);
const L = await ws(page.webSocketDebuggerUrl);
await L.send('Runtime.enable'); await L.send('Log.enable');
const M = await ws((await (await fetch(`http://127.0.0.1:${port + 1}/json/list`)).json())[0].webSocketDebuggerUrl);
await M.ev(`const { BrowserWindow, dialog, app: a0 } = require('electron'); globalThis.W = BrowserWindow.getAllWindows()[0]; globalThis.A = a0; globalThis.__boxes = []; dialog.showMessageBox = async (...x) => { __boxes.push(x.at(-1).message); return { response: 0 }; }; W.show(); W.moveTop(); 1`);
const ev = e => L.ev(e);
check('version in the app', (await ev(`$('appVer').textContent`)).includes(version), await ev(`$('appVer').textContent`));
const r = await ev(`await (async () => { const bad = []; const wait = ms => new Promise(r => setTimeout(r, ms));
  for (const p of ['home', 'profiles', 'migrate', 'backups', 'maintenance', 'extensions', 'aiapps', 'settings']) { go(p); await wait(350); const e = document.querySelector('.page.show'); if (e.scrollWidth > e.clientWidth + 1) bad.push(p); }
  for (const p of ['look', 'start', 'window', 'server', 'phone', 'about']) { showSetPane(p); await wait(200); }
  return bad; })()`);
check('every page opens', !r.length, r.join());
await ev(`await D.themeExamples(); 1`); await sleep(500);
await ev(`await D.setTheme('pkg:tavern-night'); 1`); await sleep(700);
check('example theme applies', await ev(`!!document.querySelector('[data-layer="fox-asleep"]') && $('themeCss').textContent.length > 50`));
// Open with, while the app runs: a second copy hands the file over
if (themeFile !== '-') {
const t0 = Date.now();
spawn(exe, [`--user-data-dir=${ud}`, themeFile], { stdio: 'ignore', detached: true }).unref();
for (let i = 0; i < 40; i++) { await sleep(500); if ((await M.ev(`__boxes.length`)) > 0 && (await ev(`(await D.listThemes()).themes.some(t => t.id === 'pkg:open-with-test')`))) break; }
console.log('handed over after', Date.now() - t0, 'ms');
const boxes = await M.ev(`JSON.stringify(__boxes)`);
check('Open with a .sttheme asks to install', boxes.includes('Install the theme'), boxes);
check('and it installs', await ev(`(await D.listThemes()).themes.some(t => t.id === 'pkg:open-with-test')`));
}
// SillyTavern
await ev(`await D.setTheme('fox'); 1`); await sleep(400);
await ev(`await D.startServer(); 1`);
let bar; for (let i = 0; i < 80 && !bar; i++) { await sleep(500); bar = (await list()).find(x => x.url.endsWith('stbar.html')); }
await sleep(3000);
check('SillyTavern opens in its window', !!bar && (await list()).some(x => x.url.includes(':8123')));
check('server shown as running', await ev(`rootState.server`) === 'running');
await ev(`await D.stopServer(); 1`).catch(() => {}); await sleep(3000);
const errs = L.events.filter(e => e.method === 'Runtime.exceptionThrown' || (e.method === 'Log.entryAdded' && e.params.entry.level === 'error'));
check('no page errors', !errs.length, JSON.stringify(errs.map(e => (e.params.entry?.text || e.params.exceptionDetails?.exception?.description || '').slice(0, 140))));
M.ev(`const { app } = require('electron'); setTimeout(() => app.quit(), 100); 1`).catch(() => {});
let q = 0; for (; q < 60 && execSync('tasklist').toString().includes('SillyTavern Desktop'); q++) await sleep(500);
check('clean quit: app gone', q < 60, 'after about ' + q * 0.5 + ' s');
const node = execSync(`pwsh -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \\"name='node.exe'\\" | Where-Object { $_.CommandLine -like '*server.js*' } | Measure-Object).Count"`, { encoding: 'utf8' }).trim();
check('clean quit: no server left', node === '0', node);
console.log(`\n${res.filter(Boolean).length}/${res.length} passed`);
process.exit(0);
