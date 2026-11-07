// The theme contract. node t3.mjs <exe> <app|-> <userData> <clone> <outDir>
import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
const [exe, app, ud, clone, out] = process.argv.slice(2);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const CDP = 9900 + Math.floor(Math.random() * 40), INS = CDP + 50;
const res = []; const check = (n, ok, x = '') => { res.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '  -> ' + x : ''}`); };
fs.rmSync(ud, { recursive: true, force: true }); fs.mkdirSync(ud, { recursive: true }); fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ sillytavernPath: clone, port: 8123, host: 'localhost', autoStart: false, checkUpdatesOnLaunch: false, checkAppUpdates: false, theme: 'fox', confirmBeforeQuit: false, language: 'en' }));
const pr = spawn(exe, [...(app === '-' ? [] : [app]), `--user-data-dir=${ud}`, `--remote-debugging-port=${CDP}`, `--inspect=${INS}`], { stdio: 'ignore' });
const list = async () => (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
async function ws(url) {
    const s = new WebSocket(url); await new Promise(r => { s.onopen = r; });
    let id = 0; const w = new Map();
    s.onmessage = m => { const d = JSON.parse(m.data); if (d.id) w.get(d.id)?.(d); };
    const send = (method, params = {}) => new Promise((r, j) => { const i = ++id; w.set(i, r); s.send(JSON.stringify({ id: i, method, params })); setTimeout(() => j(new Error('timeout ' + method)), 30000); });
    const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true, userGesture: true, replMode: true, includeCommandLineAPI: true }); if (r.result.exceptionDetails) throw new Error(e.slice(0, 80) + ' => ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300)); return r.result.result.value; };
    return { send, ev };
}
let page; for (let i = 0; i < 60 && !page; i++) { await sleep(500); try { page = (await list()).find(x => x.url.endsWith('launcher.html')); } catch { /* starting */ } }
await sleep(3500);
const L = await ws(page.webSocketDebuggerUrl);
const t = await (await fetch(`http://127.0.0.1:${INS}/json/list`)).json();
const M = await ws(t[0].webSocketDebuggerUrl);
await M.ev(`const { BrowserWindow } = require('electron'); const b = BrowserWindow.getAllWindows()[0]; b.show(); b.moveTop(); 1`);
await L.send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 720, deviceScaleFactor: 1, mobile: false });
const themes = fs.readFileSync(new URL('../../themes.js', import.meta.url), 'utf8');
const listOf = n => [...new RegExp(`export const ${n} = \\[([\\s\\S]*?)\\];`).exec(themes)[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
const TOKENS = listOf('TOKENS'), PARTS = listOf('PARTS'), CLASSES = listOf('CLASSES');
const launcherSrc = fs.readFileSync(new URL('../../launcher.html', import.meta.url), 'utf8'), barSrc = fs.readFileSync(new URL('../../stbar.html', import.meta.url), 'utf8');
const BAR_ONLY = ['tab-radius', 'bar-bg', 'tab-active-bg'];
const freeze = `document.getAnimations().forEach(a => { a.pause(); a.currentTime = 0; }); $('console').innerHTML = ''; $('dockLast').textContent = ''; document.activeElement?.blur?.(); 1`;
const inject = css => L.ev(`let s = document.getElementById('tt'); if (!s) { s = document.createElement('style'); s.id = 'tt'; document.head.append(s); } s.textContent = ${JSON.stringify(css ? `@layer theme { ${css} }` : '')}; 1`);
async function hashAll() {
    const h = crypto.createHash('sha1');
    for (const [p, js] of [['home', ''], ['backups', ''], ['settings', `showSetPane('look')`], ['settings', `showSetPane('window')`]]) {
        await L.ev(`go(${JSON.stringify(p)}); ${js}; 1`); await sleep(120); await L.ev(freeze); await sleep(60);
        h.update((await L.send('Page.captureScreenshot', { format: 'png' })).result.data);
    }
    return h.digest('hex');
}
for (const k of TOKENS) if (!new RegExp(`--${k}\\s*:`).test(launcherSrc + barSrc)) check(`token --${k} defined`, false);
check('every token is defined', TOKENS.every(k => new RegExp(`--${k}\\s*:`).test(launcherSrc + barSrc)), TOKENS.length + ' tokens');
const missParts = PARTS.filter(p => !(launcherSrc + barSrc).includes(`data-part="${p}"`)); check('every part exists', !missParts.length, missParts.join(' '));
const missCls = CLASSES.filter(c => !new RegExp(`\\.${c}\\b`).test(launcherSrc + barSrc)); check('every class exists', !missCls.length, missCls.join(' '));

// tokens are live
await L.ev(`if (!$('dock').classList.contains('closed')) 1; 1`);
await L.ev(`showSetPane('look'); 1`);
const base = await hashAll();
check('same page twice = same picture', base === await hashAll());
const VAL = { radius: '9px', 'btn-radius': '9px', 'card-radius': '9px', 'input-radius': '9px', 'tag-radius': '9px', 'nav-radius': '9px', 'switch-radius': '9px',
    'border-w': '5px', divider: '4px solid red', 'shadow-card': '6px 6px 0 red', 'shadow-btn': '4px 4px 0 red', 'nav-active-mark': 'inset 8px 0 0 red', transition: 'all 1s',
    'pixel-font': 'serif', 'body-font': 'serif', 'heading-font': 'serif', 'sidebar-w': '300px', 'card-pad': '40px', 'scrollbar-w': '30px', 'icon-stroke': '4', 'logo-render': 'auto' };
const SKIP = ['btn-press', 'transition', ...BAR_ONLY];   // only show on press / over time / in the bar
const dead = [];
for (const k of TOKENS.filter(k => !SKIP.includes(k) && k !== 'card-pad')) {
    await inject(`:root { --${k}: ${VAL[k] || '#ff00ff'}; }`);
    if ((await hashAll()) === base) dead.push(k);
}
await inject('');
check('every token changes the screen', !dead.length, dead.join(' '));
await inject(`:root { --card-pad: 40px; }`); await L.ev(`go('profiles'); 1`); await sleep(200); { const v = await L.ev(`[...document.querySelectorAll('#page-profiles .card')].map(c => getComputedStyle(c).paddingTop).join(' ')`); check('--card-pad applies', v.includes('40px'), v); }
await inject(`.btn:active { transition: none; } :root { --transition: all 1s; --btn-press: scale(.5); }`);
const tr = await L.ev(`getComputedStyle(document.querySelector('.btn')).transitionDuration`); check('--transition applies', tr === '1s', tr);
await inject('');

// a theme that tries to hide things, !important and all
await inject(`
 .warn-line, .warnbox, .modal, #btnPower, [data-part="power-button"] { display: none !important; visibility: hidden !important; opacity: 0 !important; }
 [hidden] { display: block !important; }`);
await L.ev(`go('extensions'); document.querySelector('[data-ext-tab=chrome]').click(); 1`); await sleep(300);
const g = await L.ev(`await (async () => { const v = e => { const s = getComputedStyle(e); return [s.display, s.visibility, s.opacity].join(' '); };
 const w = document.querySelector('#page-extensions p.warn-line:not([hidden])') ;
 $('remWarn').hidden = false; const wb = v($('remWarn')); $('remWarn').hidden = true; const hid = getComputedStyle($('remWarn')).display;
 $('dlModal').classList.add('show'); const m = v($('dlModal')); $('dlModal').classList.remove('show');
 return { warn: w ? v(w) : 'none', warnbox: wb, hidden: hid, modal: m, power: v($('btnPower')) }; })()`);
check('warning stays', g.warn === 'block visible 1', g.warn);
check('warn box stays', g.warnbox === 'block visible 1', g.warnbox);
check('hidden stays hidden', g.hidden === 'none', g.hidden);
check('dialog stays', g.modal === 'block visible 1', g.modal);
check('power button stays', /flex visible 1/.test(g.power), g.power);
await inject('');

// state
const st = () => L.ev(`JSON.stringify({ ...document.documentElement.dataset })`);
await L.ev(`go('backups'); 1`); await sleep(200);
let d = JSON.parse(await st());
check('data-page follows', d.page === 'backups', await st());
check('data-time set', ['morning', 'day', 'evening', 'night'].includes(d.time), d.time);
await L.ev(`setBusy('x'); 1`); check('data-busy yes', JSON.parse(await st()).busy === 'yes'); await L.ev(`setBusy(''); 1`); check('data-busy no', JSON.parse(await st()).busy === 'no');
await L.ev(`loadInfo({ behind: 2, version: '1', commit: 'a', branch: 'x' }); 1`).catch(() => {}); await sleep(200); check('data-update available', JSON.parse(await st()).update === 'available');
await L.ev(`await loadInfo(); 1`); check('data-update none', JSON.parse(await st()).update === 'none');
check('server stopped', JSON.parse(await st()).server === 'stopped');
await L.ev(`await D.startServer(); 1`);
let bar; for (let i = 0; i < 80 && !bar; i++) { await sleep(500); bar = (await list()).find(x => x.url.endsWith('stbar.html')); }
await sleep(3000);
check('server running', JSON.parse(await st()).server === 'running', (await st()).slice(0, 80));

// bar tokens + a sample look
const B = await ws(bar.webSocketDebuggerUrl);
await B.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 34, deviceScaleFactor: 2, mobile: false });
const bshot = async () => { await B.ev(`document.getAnimations().forEach(a => { a.pause(); a.currentTime = 0; }); 1`); await sleep(150); return (await B.send('Page.captureScreenshot', { format: 'png' })).result.data; };
await B.ev(`const q = document.createElement('style'); q.className = 'q'; q.textContent = ''; document.head.append(q); 1`); const b0 = await bshot(); const bdead = [];
for (const k of ['bar-bg', 'radius', 'btn-radius', 'border-w']) {
    await B.ev(`let s = document.getElementById('tt'); if (!s) { s = document.createElement('style'); s.id = 'tt'; document.head.append(s); } s.textContent = ${JSON.stringify(`@layer theme { :root { --${k}: ${VAL[k] || '#ff00ff'}; } }`)}; 1`);
    await B.ev(`bar; 1`).catch(() => {});
    if (k === 'btn-radius') await B.ev(`document.getElementById('btnMenu').style.background = '#555'; 1`);
    const x = await bshot(); if (x === b0) bdead.push(k);
    if (k === 'btn-radius') await B.ev(`document.getElementById('btnMenu').style.background = ''; 1`);
}
check('bar tokens change the bar', !bdead.length, bdead.join(' '));
{ const v = await B.ev(`await (async () => { document.getElementById('tabs').classList.remove('solo'); const s = document.getElementById('tt'); s.textContent = '@layer theme { :root { --tab-radius: 9px; --tab-active-bg: rgb(1, 2, 3); } }'; const t = document.querySelector('.tab'); t.classList.add('on'); const c = getComputedStyle(t); return c.borderTopLeftRadius + ' ' + c.borderBottomLeftRadius + ' ' + document.querySelectorAll('.q').length + c.backgroundColor; })()`); check('--tab-radius and --tab-active-bg apply', v.startsWith('9px 0px'), v); }
await B.ev(`document.getElementById('tt').textContent = ''; 1`);
await L.ev(`await D.stopServer(); 1`).catch(() => {}); await sleep(2500);
check('server stopped again', JSON.parse(await st()).server === 'stopped');

// sample for the user: rounded and soft, no base changes
await L.send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 720, deviceScaleFactor: 1, mobile: false });
const SAMPLE = `:root { --radius: 8px; --btn-radius: 999px; --tag-radius: 999px; --switch-radius: 999px; --border-w: 1px; --divider: 1px solid var(--border);
  --shadow-card: 0 6px 18px color-mix(in srgb, #000 35%, transparent); --shadow-btn: none; --btn-press: scale(.97); --transition: all .12s ease;
  --nav-active-mark: none; --heading-font: "Segoe UI"; --body-font: "Segoe UI", system-ui; --icon-stroke: 1.5; --logo-render: auto; --hero-bg: linear-gradient(135deg, color-mix(in srgb, var(--accent) 22%, var(--panel)), var(--panel)); }
  svg.i { shape-rendering: auto; stroke-linecap: round; stroke-linejoin: round; } body { -webkit-font-smoothing: auto; }`;
await inject(SAMPLE);
for (const [n, p, js] of [['sample-home', 'home', ''], ['sample-settings', 'settings', `showSetPane('look')`]]) {
    await L.ev(`go(${JSON.stringify(p)}); ${js}; document.activeElement?.blur?.(); $('console').innerHTML = ''; 1`); await sleep(600);
    fs.writeFileSync(path.join(out, n + '.png'), Buffer.from((await L.send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
}
console.log(`\n${res.filter(Boolean).length}/${res.length} passed`);
M.ev(`const { app } = require('electron'); setTimeout(() => app.exit(0), 100); 1`).catch(() => {});
await sleep(1200);
process.exit(0);
