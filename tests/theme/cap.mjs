// Screens of every page. node cap.mjs <exe> <app|-> <userData> <clone> <outDir>
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
const [exe, app, ud, clone, out] = process.argv.slice(2);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const CDP = 9800 + Math.floor(Math.random() * 90), INS = CDP + 100;
fs.rmSync(ud, { recursive: true, force: true }); fs.mkdirSync(ud, { recursive: true });
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ sillytavernPath: clone, port: 8123, host: 'localhost', autoStart: false, checkUpdatesOnLaunch: false, checkAppUpdates: false, theme: 'fox', confirmBeforeQuit: false, language: 'en' }));
const pr = spawn(exe, [...(app === '-' ? [] : [app]), `--user-data-dir=${ud}`, `--remote-debugging-port=${CDP}`, `--inspect=${INS}`], { stdio: 'ignore' });
const list = async () => (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
async function ws(url) {
    const s = new WebSocket(url); await new Promise(r => { s.onopen = r; });
    let id = 0; const w = new Map(), events = [];
    s.onmessage = m => { const d = JSON.parse(m.data); if (d.id) w.get(d.id)?.(d); else events.push(d); };
    const send = (method, params = {}) => new Promise((r, j) => { const i = ++id; w.set(i, r); s.send(JSON.stringify({ id: i, method, params })); setTimeout(() => j(new Error('timeout ' + method)), 30000); });
    const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true, userGesture: true, replMode: true, includeCommandLineAPI: true }); if (r.result.exceptionDetails) throw new Error(e.slice(0, 80) + ' => ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300)); return r.result.result.value; };
    return { send, ev, events };
}
let page; for (let i = 0; i < 60 && !page; i++) { await sleep(500); try { page = (await list()).find(x => x.url.endsWith('launcher.html')); } catch { /* starting */ } }
await sleep(3500);
const L = await ws(page.webSocketDebuggerUrl);
await L.send('Runtime.enable'); await L.send('Log.enable'); await L.send('Page.enable');
const t = await (await fetch(`http://127.0.0.1:${INS}/json/list`)).json();
const M = await ws(t[0].webSocketDebuggerUrl);
await M.ev(`const { BrowserWindow } = require('electron'); const b = BrowserWindow.getAllWindows()[0]; b.show(); b.moveTop(); 1`);
const freeze = `document.getAnimations().forEach(a => { a.pause(); a.currentTime = 0; }); if (window.$) { const c = $('console'); if (c) c.innerHTML = ''; const l = $('dockLast'); if (l) l.textContent = ''; } document.activeElement?.blur?.(); 1`;
async function shot(name) {
    await sleep(250); await L.ev(freeze); await sleep(120);
    const r = await L.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(out, name + '.png'), Buffer.from(r.result.data, 'base64'));
}
const STOPS = [['home'], ['profiles'], ['migrate'], ['backups'], ['maintenance'],
    ...['SillyTavern', 'Desktop add-ons', 'Chrome'].map((x, i) => ['extensions', `document.querySelectorAll('#page-extensions .seg button, #page-extensions [data-ext-tab]')[${i}]?.click()`, 'ext' + i]),
    ...['text', 'image', 'voice', 'tools'].map(g => ['aiapps', `showAiGroup(${JSON.stringify(g)})`, g]),
    ...['look', 'start', 'window', 'server', 'phone', 'about'].map(p => ['settings', `showSetPane(${JSON.stringify(p)})`, p])];
for (const [w, h] of [[1024, 720], [820, 560]]) {
    await L.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    for (const theme of ['fox', 'sillytavern']) {
        await L.ev(`await D.setTheme(${JSON.stringify(theme)}); 1`); await sleep(400);
        for (const [p, js, tag] of STOPS) {
            await L.ev(`go(${JSON.stringify(p)}); ${js || ''}; 1`);
            await sleep(p === 'extensions' || p === 'aiapps' ? 700 : 250);
            await shot(`${w}-${theme}-${p}${tag ? '-' + tag : ''}`);
        }
    }
}
// dialogs and the console
await L.send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 720, deviceScaleFactor: 1, mobile: false });
await L.ev(`go('profiles'); document.querySelector('.modal')?.classList.add('show'); 1`); await shot('modal');
await L.ev(`document.querySelectorAll('.modal.show').forEach(m => m.classList.remove('show')); go('home'); 1`);
await L.ev(`if ($('dock').classList.contains('closed')) $('dockToggle').click(); 1`); await shot('dock-open');
await L.ev(`$('dockToggle').click(); 1`); await shot('dock-closed');
await L.ev(`$('busy').classList.add('show'); $('busyText').textContent = 'Working…'; 1`); await shot('busy');
await L.ev(`$('busy').classList.remove('show'); 1`);
const errs = L.events.filter(e => e.method === 'Runtime.exceptionThrown' || (e.method === 'Log.entryAdded' && e.params.entry.level === 'error' && !/favicon/i.test(e.params.entry.text)));
// top bar with the clone
await L.send('Emulation.clearDeviceMetricsOverride');
await L.ev(`await D.startServer(); 1`);
let bar; for (let i = 0; i < 80 && !bar; i++) { await sleep(500); bar = (await list()).find(x => x.url.endsWith('stbar.html')); }
if (bar) {
    await sleep(5000);
    const B = await ws(bar.webSocketDebuggerUrl);
    await B.send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 34, deviceScaleFactor: 1, mobile: false });
    await sleep(500); await B.ev(`document.getAnimations().forEach(a => { a.pause(); a.currentTime = 0; }); 1`);
    fs.writeFileSync(path.join(out, 'topbar.png'), Buffer.from((await B.send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
}
await L.ev(`await D.stopServer(); 1`).catch(() => {});
await sleep(2500);
console.log('shots', fs.readdirSync(out).length, 'errors', JSON.stringify(errs.map(e => (e.params.entry?.text || e.params.exceptionDetails?.exception?.description || '').slice(0, 160))));
M.ev(`const { app } = require('electron'); setTimeout(() => app.exit(0), 100); 1`).catch(() => {});
await sleep(1200);
process.exit(0);
