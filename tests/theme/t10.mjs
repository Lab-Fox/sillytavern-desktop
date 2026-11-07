// Every page in other languages, and startup time. node t10.mjs <exe> <app|-> <userData> <clone> [lang…]
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
const [exe, app, ud, clone, ...langs] = process.argv.slice(2);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const port = 27000 + Math.floor(Math.random() * 500);
const res = []; const check = (n, ok, x = '') => { res.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x !== '' ? '  -> ' + String(x).slice(0, 220) : ''}`); };
fs.rmSync(ud, { recursive: true, force: true }); fs.mkdirSync(ud, { recursive: true });
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ sillytavernPath: clone, port: 8123, host: 'localhost', autoStart: false, checkUpdatesOnLaunch: false, checkAppUpdates: false, theme: 'fox', confirmBeforeQuit: false, language: langs[0] || 'en' }));
async function ws(url) {
    const s = new WebSocket(url); await new Promise(r => { s.onopen = r; });
    let id = 0; const w = new Map(), events = [];
    s.onmessage = m => { const d = JSON.parse(m.data); if (d.id) w.get(d.id)?.(d); else events.push(d); };
    const send = (method, params = {}) => new Promise((r, j) => { const i = ++id; w.set(i, r); s.send(JSON.stringify({ id: i, method, params })); setTimeout(() => j(new Error('timeout ' + method + ' ' + String(params.expression).slice(0, 70))), 30000); });
    const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true, userGesture: true, replMode: true, includeCommandLineAPI: true }); if (r.result.exceptionDetails) throw new Error(e.slice(0, 80) + ' => ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300)); return r.result.result.value; };
    return { send, ev, events };
}
spawn(exe, [...(app === '-' ? [] : [app]), `--user-data-dir=${ud}`, `--remote-debugging-port=${port}`, `--inspect=${port + 1}`, '--disable-features=CalculateNativeWinOcclusion'], { stdio: 'ignore' });
const list = async () => (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
let page; for (let i = 0; i < 60 && !page; i++) { await sleep(500); try { page = (await list()).find(x => x.url.endsWith('launcher.html')); } catch { /* starting */ } }
await sleep(3500);
let L = await ws(page.webSocketDebuggerUrl);
await L.send('Runtime.enable'); await L.send('Log.enable'); await L.send('Page.enable');
const M = await ws((await (await fetch(`http://127.0.0.1:${port + 1}/json/list`)).json())[0].webSocketDebuggerUrl);
await M.ev(`const { BrowserWindow, dialog, app: a0 } = require('electron'); globalThis.W = BrowserWindow.getAllWindows()[0]; globalThis.A = a0; dialog.showMessageBox = async () => ({ response: 0 }); W.show(); W.moveTop(); 1`);
// startup: time until Home shows the version, marked inside the page
async function startup(n) {
    await L.send('Page.addScriptToEvaluateOnNewDocument', { source: `new MutationObserver((_, o) => { const e = document.getElementById('infoVersion'); if (e && /\\d/.test(e.textContent)) { window.__ver = Math.round(performance.now()); o.disconnect(); } }).observe(document, { subtree: true, childList: true, characterData: true });` });
    const times = [];
    for (let i = 0; i < n; i++) {
        await L.send('Page.reload'); await sleep(1800);
        const t = await L.ev(`window.__ver ?? -1`); times.push(t);
    }
    return times.sort((a, b) => a - b);
}
if (!langs.length) {
    const t = await startup(9);
    console.log('STARTUP default theme', JSON.stringify(t), 'median', t[4]);
    if (await L.ev(`typeof D.themeExamples === 'function'`)) {
        await L.ev(`await D.themeExamples(); await D.setTheme('pkg:soft-glass'); 1`); await sleep(800);
        const u = await startup(9); console.log('STARTUP Soft Glass', JSON.stringify(u), 'median', u[4]);
    }
    M.ev(`setTimeout(() => A.exit(0), 100); 1`).catch(() => {}); await sleep(1200); process.exit(0);
}
await L.ev(`await D.themeExamples(); 1`); await sleep(500);
const VISIT = `await (async () => {
  const bad = [];
  const scan = where => { const p = document.querySelector('.page.show'); if (p && p.scrollWidth > p.clientWidth + 1) bad.push(where + ': sideways scroll'); if (document.documentElement.scrollWidth > innerWidth) bad.push(where + ': page wider than window');
    for (const c of document.querySelectorAll('.page.show .card, .page.show .set-group')) { const r = c.getBoundingClientRect(); if (!r.width) continue; for (const e of c.querySelectorAll('button, select, input, .tag')) { const q = e.getBoundingClientRect(); if (q.width && q.right > r.right + 2) { bad.push(where + ': sticks out: ' + (e.textContent || e.id).trim().slice(0, 30)); break; } } } };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  for (const p of ['home', 'profiles', 'migrate', 'backups', 'maintenance']) { go(p); await wait(220); scan(p); }
  go('extensions'); for (const b of document.querySelectorAll('[data-ext-tab]')) { b.click(); await wait(200); scan('extensions ' + b.dataset.extTab); }
  go('aiapps'); for (const g of ['text', 'image', 'voice', 'tools']) { showAiGroup(g); await wait(200); scan('ai ' + g); }
  go('settings'); for (const p of ['look', 'start', 'window', 'server', 'phone', 'about']) { showSetPane(p); await wait(180); scan('settings ' + p); }
  showSetPane('look'); document.querySelector('details.set-more').open = true; await wait(120); scan('creators');
  $('btnNewTheme').click(); await wait(500); document.querySelector('[data-preset="rounded"]').click(); await wait(250); scan('studio'); const leftEnglish = [...document.querySelectorAll('.studio b, #stPreset button')].map(e => e.textContent).filter(t => /^[A-Za-z -]+$/.test(t)); $('btnCancelTheme').click(); await wait(300);
  return { bad, leftEnglish };
})()`;
for (const [i, lang] of langs.entries()) {
    if (i) { await L.ev(`await D.setLanguage(${JSON.stringify(lang)}); 1`).catch(() => {}); await sleep(2500); page = (await list()).find(x => x.url.endsWith('launcher.html')); L = await ws(page.webSocketDebuggerUrl); await L.send('Runtime.enable'); await L.send('Log.enable'); await L.send('Page.enable'); await sleep(500); }
    for (const [w, h] of [[820, 560], [1040, 720]]) {
        await L.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
        for (const theme of ['fox', 'pkg:soft-glass']) {
            await L.ev(`await D.setTheme(${JSON.stringify(theme)}); 1`); await sleep(500);
            const r = await L.ev(VISIT);
            check(`${lang} ${w} ${theme}: fits`, !r.bad.length, r.bad.slice(0, 5).join(' | '));
            if (r.leftEnglish.length && lang !== 'en') check(`${lang}: studio translated`, false, r.leftEnglish.join(', '));
        }
    }
    await L.send('Emulation.setDeviceMetricsOverride', { width: 1040, height: 720, deviceScaleFactor: 1, mobile: false });
    await L.ev(`await D.setTheme('pkg:tavern-night'); go('settings'); showSetPane('look'); $('btnNewTheme').click(); 1`); await sleep(700);
    await L.ev(`$('console').innerHTML = ''; $('dockLast').textContent = ''; document.querySelector('.studio').scrollIntoView(); 1`); await sleep(300);
    fs.writeFileSync(path.join(path.dirname(ud), `lang-${lang}.png`), Buffer.from((await L.send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
    await L.ev(`$('btnCancelTheme').click(); 1`); await sleep(300);
    await L.send('Emulation.clearDeviceMetricsOverride');
    const errs = L.events.filter(e => e.method === 'Runtime.exceptionThrown' || (e.method === 'Log.entryAdded' && e.params.entry.level === 'error'));
    check(`${lang}: no page errors`, !errs.length, JSON.stringify(errs.map(e => (e.params.entry?.text || e.params.exceptionDetails?.exception?.description || '').slice(0, 140))));
}
console.log(`\n${res.filter(Boolean).length}/${res.length} passed`);
M.ev(`setTimeout(() => A.exit(0), 100); 1`).catch(() => {}); await sleep(1500); process.exit(0);
