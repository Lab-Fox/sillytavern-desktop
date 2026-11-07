// Layers, animation and pause rules. node t5.mjs <exe> <app|-> <userData> <clone> <workDir>
import { spawn, execFileSync } from 'child_process';
import { createRequire } from 'module';
import zlib from 'zlib';
import fs from 'fs';
import path from 'path';
const require = createRequire(new URL('../../package.json', import.meta.url));
const yazl = require('yazl');
const [exe, app, ud, clone, work] = process.argv.slice(2);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const port = 21000 + Math.floor(Math.random() * 500);
const res = []; const check = (n, ok, x = '') => { res.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x !== '' ? '  -> ' + String(x).slice(0, 170) : ''}`); };
fs.rmSync(ud, { recursive: true, force: true }); fs.mkdirSync(ud, { recursive: true });
fs.rmSync(work, { recursive: true, force: true }); fs.mkdirSync(work, { recursive: true });
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ sillytavernPath: clone, port: 8123, host: 'localhost', autoStart: false, checkUpdatesOnLaunch: false, checkAppUpdates: false, theme: 'fox', confirmBeforeQuit: false, language: 'en' }));

// a real PNG and a real animated GIF
function crc(b) { let c, r = ~0; for (const x of b) { c = (r ^ x) & 255; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; r = (r >>> 8) ^ c; } return (~r) >>> 0; }
function png(w, h, f) {
    const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
    const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
    const raw = Buffer.alloc((w * 3 + 1) * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [r, g, b] = f(x, y); raw.set([r, g, b], y * (w * 3 + 1) + 1 + x * 3); }
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function gif(w, h, frames) {   // frames: functions (x, y) → colour index 0-3
    const out = [Buffer.from('GIF89a'), Buffer.from([w & 255, w >> 8, h & 255, h >> 8, 0xf1, 0, 0]), Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]),
        Buffer.from([0x21, 0xff, 11, ...Buffer.from('NETSCAPE2.0'), 3, 1, 0, 0, 0])];
    for (const f of frames) {
        out.push(Buffer.from([0x21, 0xf9, 4, 0, 5, 0, 0, 0, 0x2c, 0, 0, 0, 0, w & 255, w >> 8, h & 255, h >> 8, 0, 2]));
        let bits = 0, n = 0; const bytes = []; const put = c => { bits |= c << n; n += 3; while (n >= 8) { bytes.push(bits & 255); bits >>= 8; n -= 8; } };
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { put(4); put(f(x, y)); }
        put(5); if (n) bytes.push(bits & 255);
        for (let i = 0; i < bytes.length; i += 255) { const s = bytes.slice(i, i + 255); out.push(Buffer.from([s.length, ...s])); }
        out.push(Buffer.from([0]));
    }
    out.push(Buffer.from([0x3b]));
    return Buffer.concat(out);
}
const BG = png(320, 200, (x, y) => [20 + x / 8, 30 + y / 8, 60]);
const DOT = png(64, 64, (x, y) => (Math.hypot(x - 32, y - 32) < 30 ? [240, 180, 60] : [30, 30, 30]));
const GIF = gif(32, 32, [(x, y) => (x < 16 ? 0 : 1), (x, y) => (x < 16 ? 2 : 3)]);
const COLORS = { bg: '#101820', panel: '#1b2a38', border: '#33506a', accent: '#39c5bb', text: '#dfeaf2', title: '#ffffff', muted: '#8aa3b5' };
const LAYERS = [
    { id: 'corner', src: 'assets/a.gif', slot: 'sidebar', anchor: 'bottom-right', width: '40%', minWidth: '40px', maxWidth: '120px', x: '5%', y: '2%', pixelated: true },
    { id: 'vid', src: 'assets/v.webm', slot: 'page', anchor: 'top-right', width: '30%', x: '2%', y: '2%' },
    { id: 'sleep', src: 'assets/dot.png', slot: 'header', anchor: 'left', height: '100%', when: { server: 'stopped' } },
    { id: 'awake', src: 'assets/dot.png', slot: 'header', anchor: 'right', height: '100%', when: { server: 'running' } },
    { id: 'homeonly', src: 'assets/dot.png', slot: 'hero', anchor: 'right', width: '10%', when: { page: 'home' } },
    { id: 'over', src: 'assets/dot.png', slot: 'window', anchor: 'center', width: '10%', z: 'above', opacity: 0.5 },
    { id: 'small', src: 'assets/dot.png', slot: 'console', anchor: 'bottom-right', width: '5%', hideBelow: 900 },
];
const MANIFEST = { format: 2, apiVersion: 1, name: 'Layers Test', author: 'Tester', colors: COLORS, wallpaper: 'assets/bg.png', layers: LAYERS };
const CSS = `:root { --app-bg: transparent; --sidebar-bg: color-mix(in srgb, var(--surface) 70%, transparent); }
[data-layer="over"] { animation: spin 3s linear infinite; }`;
function zip(file, entries) {
    return new Promise(r => { const z = new yazl.ZipFile(); for (const [n, d] of entries) z.addBuffer(Buffer.isBuffer(d) ? d : Buffer.from(d), n); z.end(); z.outputStream.pipe(fs.createWriteStream(file)).on('close', r); });
}
const f = n => path.join(work, n + '.sttheme');

async function ws(url) {
    const s = new WebSocket(url); await new Promise(r => { s.onopen = r; });
    let id = 0; const w = new Map(), events = [];
    s.onmessage = m => { const d = JSON.parse(m.data); if (d.id) w.get(d.id)?.(d); else events.push(d); };
    const send = (method, params = {}) => new Promise((r, j) => { const i = ++id; w.set(i, r); s.send(JSON.stringify({ id: i, method, params })); setTimeout(() => j(new Error('timeout ' + method + ' ' + String(params.expression).slice(0, 70))), 30000); });
    const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true, userGesture: true, replMode: true, includeCommandLineAPI: true }); if (r.result.exceptionDetails) throw new Error(e.slice(0, 80) + ' => ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300)); return r.result.result.value; };
    return { send, ev, events };
}
const pr = spawn(exe, [...(app === '-' ? [] : [app]), `--user-data-dir=${ud}`, `--remote-debugging-port=${port}`, `--inspect=${port + 1}`, ...(process.env.XARG ? [process.env.XARG] : [])], { stdio: 'ignore' });
const list = async () => (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
let page; for (let i = 0; i < 60 && !page; i++) { await sleep(500); try { page = (await list()).find(x => x.url.endsWith('launcher.html')); } catch { /* starting */ } }
await sleep(3500);
const L = await ws(page.webSocketDebuggerUrl);
await L.send('Runtime.enable'); await L.send('Log.enable'); await L.send('Page.enable');
const M = await ws((await (await fetch(`http://127.0.0.1:${port + 1}/json/list`)).json())[0].webSocketDebuggerUrl);
await M.ev(`const { BrowserWindow, dialog, app: a0 } = require('electron'); globalThis.W = BrowserWindow.getAllWindows()[0]; globalThis.A = a0; dialog.showMessageBox = async () => ({ response: 0 }); W.show(); W.moveTop(); W.focus(); 1`);

// a real WebM, recorded from a canvas
const webm = Buffer.from(await L.ev(`await new Promise(done => {
  const c = document.createElement('canvas'); c.width = 160; c.height = 90; const g = c.getContext('2d'); let i = 0;
  const t = setInterval(() => { g.fillStyle = i % 2 ? '#39c5bb' : '#f28c38'; g.fillRect(0, 0, 160, 90); g.fillStyle = '#fff'; g.fillRect(i * 4 % 160, 30, 20, 20); i++; }, 40);
  const r = new MediaRecorder(c.captureStream(25), { mimeType: 'video/webm' }), parts = [];
  r.ondataavailable = e => parts.push(e.data);
  r.onstop = async () => { clearInterval(t); const b = new Uint8Array(await new Blob(parts).arrayBuffer()); let s = ''; for (let k = 0; k < b.length; k += 8192) s += String.fromCharCode(...b.subarray(k, k + 8192)); done(btoa(s)); };
  r.start(); setTimeout(() => r.stop(), 1200);
})`), 'base64');
check('made a real WebM', webm.length > 1000 && webm.readUInt32BE(0) === 0x1a45dfa3, webm.length + ' bytes');
const FILES = [['assets/a.gif', GIF], ['assets/v.webm', webm], ['assets/dot.png', DOT], ['assets/bg.png', BG]];
await zip(f('good'), [['theme.json', JSON.stringify(MANIFEST)], ['theme.css', CSS], ...FILES]);
const bad = {
    'layers not a list': { layers: 'x' }, 'no src': { layers: [{}] }, 'src escapes': { layers: [{ src: '../x.png' }] }, 'src html': { layers: [{ src: 'a.html' }] }, 'src missing': { layers: [{ src: 'assets/none.png' }] },
    'bad slot': { layers: [{ src: 'assets/dot.png', slot: 'body' }] }, 'bad anchor': { layers: [{ src: 'assets/dot.png', anchor: 'x' }] }, 'css in width': { layers: [{ src: 'assets/dot.png', width: '10px;background:url(x)' }] },
    'calc in x': { layers: [{ src: 'assets/dot.png', x: 'calc(1px)' }] }, 'bad opacity': { layers: [{ src: 'assets/dot.png', opacity: 3 }] }, 'bad when': { layers: [{ src: 'assets/dot.png', when: { nope: 'x' } }] },
    'bad when value': { layers: [{ src: 'assets/dot.png', when: { page: '<b>' } }] }, 'bad id': { layers: [{ id: '"x', src: 'assets/dot.png' }] }, 'same ids': { layers: [{ id: 'a', src: 'assets/dot.png' }, { id: 'a', src: 'assets/dot.png' }] },
    'too many': { layers: Array.from({ length: 25 }, () => ({ src: 'assets/dot.png' })) }, 'too many videos': { layers: Array.from({ length: 5 }, () => ({ src: 'assets/v.webm' })) }, 'bad wallpaper': { wallpaper: 'C:/x.png' },
};
for (const [n, m] of Object.entries(bad)) {
    await zip(f('bad'), [['theme.json', JSON.stringify({ apiVersion: 1, name: 'Bad', colors: COLORS, ...m })], ...FILES]);
    const r = await L.ev(`await D.installTheme(${JSON.stringify(f('bad'))})`);
    check('refused: ' + n, r?.error, r?.error || JSON.stringify(r));
}
const r0 = await L.ev(`await D.installTheme(${JSON.stringify(f('good'))})`); check('installs', r0?.ok, JSON.stringify(r0));
await sleep(1200);

const size = async (w, h) => { await M.ev(`W.setBounds({ x: 100, y: 40, width: ${w}, height: ${h} }); 1`); await sleep(500); };
const rect = `n => { const r = document.querySelector(n).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom }; }`;
const R = async n => L.ev(`(${rect})(${JSON.stringify(n)})`);
const near = (a, b, t = 1.5) => Math.abs(a - b) <= t;
await L.ev(`go('home'); 1`);
for (const [w, h] of [[1040, 720], [1500, 950], [830, 570]]) {
    await size(w, h);
    const a = await R('aside'), c = await R('[data-layer="corner"]');
    const want = Math.min(120, Math.max(40, a.w * 0.4));
    check(`corner size at ${w}`, near(c.w, want), `${c.w} wanted ${want}`);
    const inner = await L.ev(`document.querySelector('.layer-slot[data-slot="sidebar"]').clientWidth`);
    check(`corner place at ${w}`, near(a.r - c.r, (a.w - inner) + inner * 0.05) && near(a.b - c.b, a.h * 0.02), JSON.stringify({ right: a.r - c.r, bottom: a.b - c.b, inner }));
    const p = await R('.page.show'), v = await R('[data-layer="vid"]'), cw = await L.ev(`document.querySelector('.page.show').clientWidth`);
    check(`video follows the page at ${w}`, near(v.w, cw * 0.3) && near(v.y, p.y + p.h * 0.02) && v.b <= p.b + 1, JSON.stringify({ vw: v.w, cw, vy: v.y, py: p.y, ph: p.h }));
    const wall = await R('[data-layer="wallpaper"]'), body = await R('body');
    check(`wallpaper fills at ${w}`, near(wall.w, body.w) && near(wall.h, body.h));
    const o = await R('[data-layer="over"]');
    check(`centered at ${w}`, near(o.x + o.w / 2, body.w / 2) && near(o.y + o.h / 2, body.h / 2));
    check(`no sideways scroll at ${w}`, await L.ev(`document.documentElement.scrollWidth <= innerWidth && document.querySelector('.page.show').scrollWidth <= document.querySelector('.page.show').clientWidth`));
}
await size(1040, 720);
check('zoom 150 % keeps the proportions', await L.ev(`await (async () => { const x = document.querySelector('[data-layer="over"]').offsetWidth / innerWidth; await D.setZoom(150); await new Promise(r => setTimeout(r, 500)); const y = document.querySelector('[data-layer="over"]').offsetWidth / innerWidth; await D.setZoom(100); await new Promise(r => setTimeout(r, 300)); return Math.abs(x - y) < .005; })()`));
// the console moves the page slot
await L.ev(`if ($('dock').classList.contains('closed')) $('dockToggle').click(); 1`); await sleep(200);
const v1 = await R('[data-layer="vid"]'), s1 = await R('.layer-slot[data-slot="page"]');
await L.ev(`$('dockToggle').click(); 1`); await sleep(300);
const s2 = await R('.layer-slot[data-slot="page"]'), p2 = await R('.page.show');
check('slot grows when the console closes', s2.h > s1.h + 50 && near(s2.h, p2.h), `${s1.h} → ${s2.h}, page ${p2.h}`);
await L.ev(`$('dockToggle').click(); 1`); await sleep(300);
// video and gif play
const vs = await L.ev(`await (async () => { const v = document.querySelector('[data-layer="vid"]'); const t0 = v.currentTime; await new Promise(r => setTimeout(r, 900)); return { paused: v.paused, ready: v.readyState, moved: v.currentTime !== t0, w: v.videoWidth, muted: v.muted, loop: v.loop, dur: v.duration }; })()`);
check('real video plays through the route', !vs.paused && vs.ready >= 2 && vs.moved && vs.w === 160 && vs.muted && vs.loop, JSON.stringify(vs));
const loops = await L.ev(`await (async () => { const v = document.querySelector('[data-layer="vid"]'); v.currentTime = 1e9; await new Promise(r => setTimeout(r, 1500)); return { t: v.currentTime, p: v.paused }; })()`);
check('video loops', !loops.p, JSON.stringify(loops));
check('GIF loaded', await L.ev(`(() => { const g = document.querySelector('[data-layer="corner"]'); return g.tagName === 'IMG' && g.naturalWidth === 32; })()`));
// clicks pass through
check('above layer lets clicks through', await L.ev(`(() => { const o = document.querySelector('[data-layer="over"]').getBoundingClientRect(); const e = document.elementFromPoint(o.x + o.width / 2, o.y + o.height / 2); return !e.closest('.layer-slot'); })()`));
check('behind stays behind the page', await L.ev(`(() => { const o = document.querySelector('[data-layer="wallpaper"]'); return getComputedStyle(o.parentElement).zIndex === '0' && getComputedStyle(document.querySelector('aside')).zIndex === '1'; })()`));
const modal = await L.ev(`(() => { $('dlModal').classList.add('show'); const e = document.elementFromPoint(innerWidth / 2, innerHeight / 2); const ok = !!e.closest('#dlModal'); const z = getComputedStyle($('dlModal')).zIndex; $('dlModal').classList.remove('show'); return { ok, z }; })()`);
check('dialogs sit above layers', modal.ok && modal.z === '60', JSON.stringify(modal));
// when
const shown = id => L.ev(`!document.querySelector('[data-layer="${id}"]').hidden`);
check('when: stopped', await shown('sleep') && !(await shown('awake')));
await L.ev(`rootState.server = 'running'; 1`); await sleep(150);
check('when: running swaps', !(await shown('sleep')) && await shown('awake'));
await L.ev(`rootState.server = 'stopped'; 1`); await sleep(100);
await L.ev(`go('backups'); 1`); await sleep(200); check('when: page hides', !(await shown('homeonly')));
await L.ev(`go('home'); 1`); await sleep(200); check('when: page shows', await shown('homeonly'));
await size(840, 600); check('hideBelow hides', !(await shown('small'))); await size(1040, 720); check('hideBelow shows', await shown('small'));
// pause rules
const motion = () => L.ev(`await (async () => { await new Promise(r => setTimeout(r, 350)); const v = document.querySelector('[data-layer="vid"]'), g = document.querySelector('[data-layer="corner"]'), o = document.querySelector('[data-layer="over"]'), spin = document.querySelector('.spin'); return { attr: rootState.motion, video: v.paused, gif: g.tagName, css: getComputedStyle(o).animationPlayState, spin: getComputedStyle(spin).animationPlayState }; })()`);
await L.ev(`go('settings'); showSetPane('look'); 1`); await sleep(300);
const setMode = m => L.ev(`$('setThemeMotion').value = ${JSON.stringify(m)}; await $('setThemeMotion').onchange(); 1`);
await setMode('off');
let m = await motion();
check('off: video paused', m.video, JSON.stringify(m)); check('off: GIF frozen', m.gif === 'CANVAS'); check('off: CSS animation paused', m.css === 'paused'); check('off: busy spinner keeps going', m.spin === 'running');
const fr = await R('[data-layer="corner"]'); check('frozen GIF keeps its place', fr.w > 30 && fr.h > 30, JSON.stringify(fr));
await setMode('on'); m = await motion();
check('on again', !m.video && m.gif === 'IMG' && m.css === 'running' && m.attr === 'on', JSON.stringify(m));
check('GIF source back', await L.ev(`document.querySelector('[data-layer="corner"]').src.startsWith('st-theme://layers-test/')`));
check('setting saved', JSON.parse(fs.readFileSync(path.join(ud, 'settings.json'), 'utf8')).themeAnimations === 'on');
await setMode('focused');
await L.ev(`window.dispatchEvent(new Event('blur')); 1`);
await L.ev(`document.hasFocus = () => false; window.dispatchEvent(new Event('blur')); 1`); m = await motion(); check('focused mode: not in use = stopped', m.video && m.gif === 'CANVAS', JSON.stringify(m));
await L.ev(`document.hasFocus = () => true; window.dispatchEvent(new Event('focus')); 1`); m = await motion(); check('focused mode: in use = moving', !m.video && m.gif === 'IMG', JSON.stringify(m));
await L.ev(`delete document.hasFocus; 1`); await setMode('on');
await L.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }); m = await motion();
check('Windows animation effects off', m.attr === 'off' && m.video && m.gif === 'CANVAS', JSON.stringify(m));
await L.send('Emulation.setEmulatedMedia', { features: [] }); m = await motion(); check('...and back', m.attr === 'on' && !m.video);
await L.ev(`go('home'); 1`); await sleep(300);

// measuring
const ps = path.join(work, 'gpu.ps1');
fs.writeFileSync(ps, `$ids = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq '${exe.replace(/\//g, '\\')}' -or $_.Name -like '*SillyTavern Desktop*' } | ForEach-Object { $_.ProcessId })
$s = (Get-Counter '\\GPU Engine(*engtype_3D)\\Utilization Percentage' -SampleInterval 2 -MaxSamples 3).CounterSamples
$t = 0; foreach ($c in $s) { if ($c.InstanceName -match 'pid_(\\d+)_' -and $ids -contains [int]$Matches[1]) { $t += $c.CookedValue } }
Write-Output ("pids=" + $ids.Count + " samples=" + $s.Count)
[math]::Round($t / 3, 1)`);
const gpu = () => { const o = execFileSync('pwsh', ['-NoProfile', '-File', ps], { encoding: 'utf8' }).trim(); return o.split(/\s+/).at(-1) + (process.env.GPURAW ? ' raw[' + o + ']' : ''); };
const cpu = async () => { await M.ev(`A.getAppMetrics(); 1`); await sleep(3000); return Math.round(await M.ev(`A.getAppMetrics().reduce((n, p) => n + p.cpu.percentCPUUsage, 0)`) * 10) / 10; };
const mem = () => M.ev(`Math.round(A.getAppMetrics().reduce((n, p) => n + p.memory.workingSetSize, 0) / 1024)`);
const report = async n => console.log(`MEASURE ${n}: GPU ${await gpu()} %, CPU ${await cpu()} %, memory ${await mem()} MB`);
await M.ev(`W.show(); W.moveTop(); W.focus(); 1`); await sleep(800);
await report('theme moving, window in front');
await M.ev(`W.minimize(); 1`); await sleep(1200);
const hid = await L.ev(`({ vis: document.visibilityState, paused: document.querySelector('[data-layer="vid"]').paused })`);
check('minimized: video paused', hid.vis === 'hidden' && hid.paused, JSON.stringify(hid));
await report('theme moving, window minimized');
await M.ev(`W.setAlwaysOnTop(true); W.restore(); 1`);
for (const ms of [300, 1000, 2000]) { await sleep(ms); console.log('after restore +' + ms, JSON.stringify(await L.ev(`({ vis: document.visibilityState, focus: document.hasFocus(), paused: document.querySelector('[data-layer="vid"]').paused, motion: rootState.motion, min: 0 })`)), await M.ev(`JSON.stringify({ min: W.isMinimized(), vis: W.isVisible(), focused: W.isFocused() })`)); }
check('restored: video plays again', !(await L.ev(`document.querySelector('[data-layer="vid"]').paused`)));
await L.ev(`go('settings'); showSetPane('look'); 1`); await setMode('off'); await L.ev(`go('home'); 1`); await sleep(800);
await report('on top: animations off');
await setMode('on'); await sleep(800); await report('on top: theme moving, window in front');
const shot = async n => fs.writeFileSync(path.join(work, n), Buffer.from((await L.send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
await L.ev(`$('console').innerHTML = ''; 1`); await sleep(300); await shot('layers.png');

// leaving the theme
await L.ev(`await D.setTheme('fox'); 1`); await sleep(500);
check('default theme: nothing left', await L.ev(`!document.querySelector('.layer-slot, .layer, [data-has-layers]')`));
await L.ev(`await D.setTheme('pkg:layers-test'); 1`); await sleep(500);
check('and back', await L.ev(`document.querySelectorAll('.layer').length`) === 8);
await report('no theme change: same theme again');
await L.ev(`await D.setTheme('fox'); 1`); await sleep(800);
await report('on top: default theme, nothing moving');
await M.ev(`W.setAlwaysOnTop(false); 1`);
const errs = L.events.filter(e => e.method === 'Runtime.exceptionThrown' || (e.method === 'Log.entryAdded' && e.params.entry.level === 'error'));
check('no page errors', !errs.length, JSON.stringify(errs.map(e => (e.params.entry?.text || e.params.exceptionDetails?.exception?.description || '').slice(0, 140))));
console.log(`\n${res.filter(Boolean).length}/${res.length} passed`);
M.ev(`setTimeout(() => A.exit(0), 100); 1`).catch(() => {});
await sleep(1500);
process.exit(0);
