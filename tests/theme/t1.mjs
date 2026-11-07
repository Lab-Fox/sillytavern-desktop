// Drives the app on an isolated user data folder. Usage: node t1.mjs <exe> <appArgOr-> <userData>
import { spawn, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
const [exe, appArg, ud] = process.argv.slice(2);
let CDP = 9444, INS = 9231;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = [];
const check = (name, ok, extra = '') => { out.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + extra : ''}`); };

function prepare() {
    fs.rmSync(ud, { recursive: true, force: true });
    const p = path.join(ud, 'themes', 'packages', 'test-pack');
    fs.mkdirSync(path.join(p, 'sub'), { recursive: true });
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    fs.writeFileSync(path.join(p, 'a.png'), png);
    fs.writeFileSync(path.join(p, 'sub', 'b c.png'), png);
    fs.copyFileSync(new URL('../../fonts/departure-mono-400.woff2', import.meta.url), path.join(p, 'f.woff2'));
    fs.writeFileSync(path.join(p, 'clip.webm'), Buffer.alloc(5000, 7));
    fs.writeFileSync(path.join(p, 'evil.html'), '<script>1</script>');
    fs.writeFileSync(path.join(p, 'theme.css'), 'body{}');
    const outside = path.join(ud, 'outside'); fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'secret.png'), png);
    fs.writeFileSync(path.join(ud, 'themes', 'other.png'), png);
    execSync(`cmd /c mklink /J "${path.join(p, 'link')}" "${outside}"`, { stdio: 'ignore' });
    fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ autoStart: false, checkUpdatesOnLaunch: false, checkAppUpdates: false, theme: 'fox', confirmBeforeQuit: false, language: 'en' }));
}

async function ws(url) {
    const s = new WebSocket(url); await new Promise((r, j) => { s.onopen = r; s.onerror = j; });
    let id = 0; const wait = new Map(), events = [];
    s.onmessage = m => { const d = JSON.parse(m.data); if (d.id) { wait.get(d.id)?.(d); wait.delete(d.id); } else events.push(d); };
    return { events, close: () => s.close(), send: (method, params = {}) => new Promise((r, j) => { const i = ++id; wait.set(i, r); s.send(JSON.stringify({ id: i, method, params })); setTimeout(() => j(new Error('timeout ' + method + ' ' + (params.expression||'').slice(0,60))), 9000); }) };
}
async function launch(args = []) { CDP++; INS++;
    const a = [...(appArg === '-' ? [] : [appArg]), `--user-data-dir=${ud}`, `--remote-debugging-port=${CDP}`, `--inspect=${INS}`, ...args];
    const pr = spawn(exe, a, { stdio: 'ignore' });
    let page, main;
    for (let i = 0; i < 60 && !page; i++) {
        await sleep(500);
        try { const l = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json(); page = l.find(x => x.url.endsWith('launcher.html')); } catch { /* starting */ }
    }
    if (!page) { console.log(await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).text().catch(e=>String(e))); throw new Error('no launcher'); }
    await sleep(3000); const c = await ws(page.webSocketDebuggerUrl);
    await c.send('Runtime.enable'); await c.send('Log.enable');
    const t = await (await fetch(`http://127.0.0.1:${INS}/json/list`)).json();
    const m = await ws(t[0].webSocketDebuggerUrl);
    main = async e => { const r = await m.send('Runtime.evaluate', { expression: e, includeCommandLineAPI: true, awaitPromise: true, returnByValue: true, replMode: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400)); return r.result.result.value; };
    const ev = async e => { const r = await c.send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true, userGesture: true, replMode: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400)); return r.result.result.value; };
    await sleep(1500);
    return { pr, c, ev, main };
}
async function quit(a) {
    await a.main(`const { app } = require('electron'); setTimeout(() => app.exit(0), 100); 1`).catch(() => {});
    await sleep(2500);
}
const settings = () => JSON.parse(fs.readFileSync(path.join(ud, 'settings.json'), 'utf8'));
const logText = () => { try { return fs.readFileSync(path.join(ud, 'desktop-debug.log'), 'utf8'); } catch { return ''; } };

prepare();
let a = await launch();
check('isolated user data used', fs.existsSync(path.join(ud, 'DevToolsActivePort')) || fs.existsSync(path.join(ud, 'Local State')));
const f = (u, h = {}) => a.main(`const { session } = require('electron'); const r = await session.defaultSession.fetch(${JSON.stringify(u)}, { headers: ${JSON.stringify(h)} }); const b = await r.arrayBuffer(); ({ s: r.status, n: b.byteLength, t: r.headers.get('content-type'), cr: r.headers.get('content-range'), ns: r.headers.get('x-content-type-options') })`);

// --- route
let r = await f('st-theme://test-pack/a.png');
check('package image served', r.s === 200 && r.t === 'image/png' && r.ns === 'nosniff', JSON.stringify(r));
r = await f('st-theme://test-pack/sub/b%20c.png'); check('space + subfolder', r.s === 200, r.s);
r = await f('st-theme://test-pack/clip.webm', { Range: 'bytes=100-199' }); check('range 100-199', r.s === 206 && r.n === 100 && r.cr === 'bytes 100-199/5000', JSON.stringify(r));
r = await f('st-theme://test-pack/clip.webm', { Range: 'bytes=4990-' }); check('open range', r.s === 206 && r.n === 10, JSON.stringify(r));
r = await f('st-theme://test-pack/clip.webm', { Range: 'bytes=-20' }); check('suffix range', r.s === 206 && r.n === 20, JSON.stringify(r));
r = await f('st-theme://test-pack/clip.webm', { Range: 'bytes=9000-' }); check('range past the end = 416', r.s === 416, r.s);
for (const u of [
    'st-theme://test-pack/../other.png', 'st-theme://test-pack/%2e%2e/other.png', 'st-theme://test-pack/..%2fother.png',
    'st-theme://test-pack/..%5cother.png', 'st-theme://test-pack/%2e%2e%5cother.png', 'st-theme://test-pack/sub/..%252fa.png',
    'st-theme://test-pack/link/secret.png', 'st-theme://test-pack/evil.html', 'st-theme://test-pack/theme.css',
    'st-theme://test-pack/a.png:ads.png', 'st-theme://test-pack/con.png', 'st-theme://test-pack/a.png./', 'st-theme://test-pack/a.png%00.png',
    'st-theme://test-pack/missing.png', 'st-theme://test-pack/sub', 'st-theme://nothing/a.png', 'st-theme://user:pw@test-pack/a.png',
    'st-theme://c/windows/web/wallpaper/windows/img0.jpg',
]) { let s; try { s = (await f(u)).s; } catch (e) { s = 'threw'; } check(`refused ${u.slice(11)}`, s !== 200 && s !== 206, s); }

r = await f('st-theme://test-pack/a.png', { Origin: 'https://evil.example' }); check('outside web page refused', r.s === 403, r.s);
// --- page use
const pageRes = await a.ev(`await (async () => {
  const img = u => new Promise(r => { const i = new Image(); i.onload = () => r(i.naturalWidth); i.onerror = () => r(-1); i.src = u; });
  const ff = new FontFace('TP', 'url("st-theme://test-pack/f.woff2")'); let font = false; try { await ff.load(); font = true; } catch {}
  return { img: await img('st-theme://test-pack/a.png'), font, own: document.fonts.check('16px "Departure Mono"'), fileImg: await img('file:///C:/Windows/Web/Wallpaper/Windows/img0.jpg') };
})()`);
check('launcher shows theme image', pageRes.img === 1, JSON.stringify(pageRes));
check('launcher loads theme font', pageRes.font === true);
check('app font still loads', pageRes.own === true);
check('<img> file: blocked', pageRes.fileImg === -1);

// CSS with file: and UNC paths, CSP loosened? no: tests the network guard through font-src 'self'
await a.ev(`await (async () => { const s = document.createElement('style');
 s.textContent = '@font-face{font-family:X1;src:url("file:///C:/Windows/Fonts/arial.ttf")} @font-face{font-family:X2;src:url("file://127.0.0.1/c$/x.ttf")} body{font-family:X1,X2,var(--pixel-font)}';
 document.head.append(s); for (const n of ['X1','X2']) { try { await document.fonts.load('16px ' + n); } catch {} } await new Promise(r=>setTimeout(r,600)); s.remove(); })()`);
await sleep(300);
const lg = logText();
check('guard stopped local font', lg.includes('Blocked a page from loading file:///C:/Windows/Fonts/arial.ttf'));
check('guard stopped network share', lg.includes('file://127.0.0.1/c$/x.ttf'));
const appBlocked = lg.split('\n').filter(l => l.includes('Blocked a page') && !/arial|x\.ttf|img0/.test(l));
check('no app file blocked', appBlocked.length === 0, appBlocked.join(' | ').slice(0, 200));

// --- pages
await a.c.send('Page.enable'); a.c.events.length = 0;
await a.ev(`location.reload()`).catch(() => {}); await sleep(2500);
const pages = ['home', 'profiles', 'extensions', 'aiapps', 'backups', 'migrate', 'maintenance', 'settings'];
for (const p of pages) { await a.ev(`go(${JSON.stringify(p)})`); await sleep(350); }
const bad = a.c.events.filter(e => e.method === 'Runtime.exceptionThrown' || (e.method === 'Log.entryAdded' && e.params.entry.level === 'error') || (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error'));
check('every page, no errors', bad.length === 0, JSON.stringify(bad.map(b => b.params.exceptionDetails?.exception?.description || b.params.entry?.text || b.params.args?.[0]?.value)).slice(0, 400));
{ const v = await a.ev(`(await D.listThemes()).active + '/' + (await D.listThemes()).safe`); check('saved theme active normally', v === 'fox/false', v + ' saved=' + settings().theme); }
check('safe note hidden', await a.ev(`$('themeSafeNote').hidden`));
await a.ev(`D.setTheme('fox')`);

// reset key
await a.main(`const { BrowserWindow } = require('electron'); const w = BrowserWindow.getAllWindows()[0].webContents; w.emit('before-input-event', { preventDefault() {} }, { type: 'keyDown', key: 'T', code: '', control: true, alt: true, shift: true }); 1`);
await sleep(500);
check('reset key: default theme saved', settings().theme === 'sillytavern', settings().theme);
check('reset key: page recoloured', (await a.ev(`getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()`)) === '#d65a52');
await a.ev(`D.setTheme('fox')`); await sleep(300);
console.log('quitting');await quit(a);console.log('relaunching');

// --- safe start by flag
a = await launch(['--safe-theme']);
check('flag: default theme for the run', (await a.ev(`(await D.listThemes()).active + '/' + (await D.listThemes()).safe`)) === 'sillytavern/true');
check('flag: saved choice untouched', settings().theme === 'fox');
check('flag: note shown', !(await a.ev(`$('themeSafeNote').hidden`)));
check('flag: default colours', (await a.ev(`getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()`)) === '#d65a52');
await a.ev(`D.setTheme('fox')`); await sleep(400);
check('picking a theme ends it', (await a.ev(`(await D.listThemes()).active + '/' + (await D.listThemes()).safe`)) === 'fox/false' && await a.ev(`$('themeSafeNote').hidden`));
await quit(a);
console.log(`\n${out.filter(Boolean).length}/${out.length} passed`);
process.exit(0);
