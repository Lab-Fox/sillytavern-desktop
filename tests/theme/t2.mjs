// SillyTavern window + top bar on isolated data with the throwaway clone. node t2.mjs <exe> <app|-> <userData> <clone>
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
const [exe, app, ud, clone] = process.argv.slice(2);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const CDP = 9701, INS = 9702;
fs.rmSync(ud, { recursive: true, force: true });
fs.mkdirSync(path.join(ud, 'themes', 'packages', 'test-pack'), { recursive: true });
fs.writeFileSync(path.join(ud, 'themes', 'packages', 'test-pack', 'a.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ sillytavernPath: clone, port: 8123, host: 'localhost', autoStart: false, checkUpdatesOnLaunch: false, checkAppUpdates: false, theme: 'fox', confirmBeforeQuit: false, language: 'en' }));
const pr = spawn(exe, [...(app === '-' ? [] : [app]), `--user-data-dir=${ud}`, `--remote-debugging-port=${CDP}`, `--inspect=${INS}`], { stdio: 'ignore' });
const list = async () => (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
async function ws(url) {
    const s = new WebSocket(url); await new Promise(r => { s.onopen = r; });
    let id = 0; const w = new Map(), events = [];
    s.onmessage = m => { const d = JSON.parse(m.data); if (d.id) { w.get(d.id)?.(d); } else events.push(d); };
    const send = (method, params = {}) => new Promise((r, j) => { const i = ++id; w.set(i, r); s.send(JSON.stringify({ id: i, method, params })); setTimeout(() => j(new Error('timeout ' + method)), 30000); });
    const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true, userGesture: true, replMode: true, includeCommandLineAPI: true }); return r.result.exceptionDetails ? 'EXC ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300) : r.result.result.value; };
    return { send, ev, events };
}
let page; for (let i = 0; i < 40 && !page; i++) { await sleep(500); try { page = (await list()).find(x => x.url.endsWith('launcher.html')); } catch { /* starting */ } }
await sleep(3000);
const L = await ws(page.webSocketDebuggerUrl);
console.log('start:', JSON.stringify(await L.ev(`await D.startServer(); 'called'`)));
let bar; for (let i = 0; i < 80 && !bar; i++) { await sleep(500); bar = (await list()).find(x => x.url.endsWith('stbar.html')); }
console.log('bar found:', !!bar);
if (bar) {
    await sleep(4000);
    const B = await ws(bar.webSocketDebuggerUrl);
    await B.send('Runtime.enable'); await B.send('Log.enable');
    const r = await B.ev(`await (async () => {
      const img = u => new Promise(r => { const i = new Image(); i.onload = () => r(i.naturalWidth); i.onerror = () => r(-1); i.src = u; });
      await document.fonts.ready;
      const before = [...document.querySelectorAll('.tab')].length;
      return { tabs: before, font: document.fonts.check('16px "Departure Mono"'), theme: await img('st-theme://test-pack/a.png'), file: await img('file:///C:/Windows/Web/Wallpaper/Windows/img0.jpg'), bg: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() };
    })()`);
    console.log('bar:', JSON.stringify(r));
    const fav = await B.ev(`[...document.querySelectorAll('.tab img')].map(i => i.naturalWidth > 0)`);
    console.log('tab favicons shown:', JSON.stringify(fav));
    await sleep(500);
    console.log('bar errors:', JSON.stringify(B.events.filter(e => e.method === 'Runtime.exceptionThrown' || (e.method === 'Log.entryAdded' && e.params.entry.level === 'error')).map(e => (e.params.entry?.text || e.params.exceptionDetails?.text || '').slice(0, 140))));
}
const pg = (await list()).filter(x => x.url.includes(':8123')).map(x => x.url.slice(0, 40));
console.log('SillyTavern pages:', JSON.stringify(pg));
const log = fs.readFileSync(path.join(ud, 'desktop-debug.log'), 'utf8');
console.log('blocked lines:', JSON.stringify(log.split('\n').filter(l => l.includes('Blocked a page')).map(l => l.slice(11, 110))));
await L.ev(`await D.stopServer(); 'stopped'`).catch(() => {});
await sleep(2500);
const t = await (await fetch(`http://127.0.0.1:${INS}/json/list`)).json();
const M = await ws(t[0].webSocketDebuggerUrl);
M.ev(`const { app } = require('electron'); setTimeout(() => app.exit(0), 100); 1`).catch(() => {});
await sleep(1500);
process.exit(0);
