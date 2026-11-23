// Frame times of scrolling SillyTavern's chat with an add-on side panel closed
// and open, in turns. Meant for a real, heavy SillyTavern: ST_REAL=<its folder>.
// Prints counts and timings only. Changes nothing on purpose; afterwards it
// restores the user's settings.json and says how many files SillyTavern
// itself changed (per top folder, no names).
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { launch, check, finish, sleep, RUNS, TEST_SETTINGS } from './lib.mjs';

const REAL = process.env.ST_REAL;
if (!REAL) { console.log('Set ST_REAL to the SillyTavern folder to measure.'); process.exit(1); }
const ROUNDS = Number(process.env.ROUNDS || 6);
const running = execFileSync('powershell.exe', ['-NoProfile', '-Command',
    `@(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'SillyTavern Desktop.exe' -or ($_.Name -eq 'node.exe' -and $_.CommandLine -like '*server.js*') }).Count`], { encoding: 'utf8' }).trim();
if (running !== '0') { console.log('STOP: SillyTavern Desktop or a SillyTavern server is running. Close them first.'); process.exit(1); }

const USER = path.join(REAL, 'data', 'default-user');
const SETTINGS = path.join(USER, 'settings.json');
const snap = dir => {
    const out = new Map();
    const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else { const s = fs.statSync(p); out.set(p, `${s.size}:${s.mtimeMs}`); } } };
    walk(dir);
    return out;
};
const before = snap(USER);
const saved = fs.readFileSync(SETTINGS);

const NAME = 'sidepanel-frames';
const DATA = path.join(RUNS, NAME);
fs.rmSync(DATA, { recursive: true, force: true });
const dir = path.join(DATA, 'extensions', 'panel-test');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ name: 'Panel test', version: '1.0.0', main: 'main.cjs', sidepanel: 'panel.html' }));
fs.writeFileSync(path.join(dir, 'main.cjs'), `module.exports = { activate() {} };`);
fs.writeFileSync(path.join(dir, 'panel.html'), `<!doctype html><meta charset="utf-8"><body style="background:#222;color:#ddd;font:14px sans-serif">Panel<p>${'Some text. '.repeat(200)}</p>`);
fs.writeFileSync(path.join(DATA, 'settings.json'), JSON.stringify({ ...TEST_SETTINGS, sillytavernPath: REAL, profiles: [], desktopExtensions: { 'panel-test': true } }));

let a;
try {
    a = await launch({ name: NAME, keep: true });
    await a.launcher.ev(`await D.startServer(); 'ok'`);
    const bar = await a.page('stbar.html');
    const P = await a.page('localhost:8123/', 240);
    for (let i = 0; i < 120; i++) { if (await P.ev(`!!window.SillyTavern?.getContext && document.readyState === 'complete'`).catch(() => false)) break; await sleep(1000); }
    await sleep(8000); // let SillyTavern settle (thumbnails, extensions)
    // Where the scrolling happens: the chat when it is long, else the
    // character list's drawer; then the tallest scrollable area on the page.
    const long = await P.ev(`(() => { const c = document.querySelector('#chat'); return !!c && c.scrollHeight > c.clientHeight + 2000; })()`);
    if (!long) { await P.ev(`document.querySelector('#rightNavDrawerIcon')?.click(); 'ok'`); await sleep(3000); }
    const height = await P.ev(`(() => {
        let best = null, room = 0;
        for (const e of document.querySelectorAll('*')) {
            const oy = getComputedStyle(e).overflowY;
            if ((oy !== 'auto' && oy !== 'scroll') || !e.clientHeight) continue;
            const r = e.scrollHeight - e.clientHeight;
            if (r > room) { room = r; best = e; }
        }
        if (!best) return [0, 0];
        best.setAttribute('data-frame-test', '');
        return [best.scrollHeight, best.clientHeight];
    })()`);
    const box = '[data-frame-test]';
    // Nothing long to scroll (a paged character list, no chat open): one full
    // style and layout pass of the page per frame instead.
    const scroll = height[0] >= height[1] + 2000;
    const count = await P.ev(`document.getElementsByTagName('*').length`);
    console.log(scroll ? `scrolling ${height[0]} px of content in ${height[1]} px` : `nothing long to scroll: a style and layout pass of the whole page (${count} elements) per frame`);
    const measure = () => P.ev(`await new Promise(done => {
        const el = ${scroll} ? document.querySelector('${box}') : null;
        if (el) el.scrollTop = 0;
        const t = [], w = []; let last = 0, n = 0;
        const f = now => { if (last) t.push(now - last); last = now; const a = performance.now(); if (el) { el.scrollTop += 30; void el.offsetHeight; } else { document.body.classList.toggle('desktop-frame-test'); void document.body.offsetHeight; } w.push(performance.now() - a); if (++n < 150) requestAnimationFrame(f); else done({ t, w }); };
        requestAnimationFrame(f);
    })`);
    const stats = t => { const s = [...t].sort((x, y) => x - y); const q = p => s[Math.min(s.length - 1, Math.floor(p * s.length))]; return { p50: q(0.5), p95: q(0.95), max: s.at(-1), slow: t.filter(x => x > 25).length }; };
    // Three kinds of rounds: closed, open, and the control: closed with the
    // window made narrower by the panel's width (same page width, no panel).
    const WIN = `require('electron').BaseWindow.getAllWindows().find(x => !(x instanceof require('electron').BrowserWindow) && x.contentView.children.length > 1)`;
    const [W0, H0] = await a.main.ev(`${WIN}.getContentSize()`);
    const setWidth = w => a.main.ev(`${WIN}.setContentSize(${w}, ${H0}); 'ok'`);
    const res = { closed: { t: [], w: [] }, open: { t: [], w: [] }, narrow: { t: [], w: [] } };
    await measure(); // warm-up, not counted
    const kinds = ['closed', 'open', 'narrow'];
    for (let r = 0; r < ROUNDS * 3 / 2; r++) {
        const kind = kinds[r % 3];
        const isOpen = await bar.ev(`document.querySelector('#btnPanel').classList.contains('on')`);
        if (isOpen !== (kind === 'open')) await bar.ev(`bar.action('side-panel', { id: 'panel-test' }); 'ok'`);
        await setWidth(kind === 'narrow' ? W0 - 380 : W0);
        await sleep(2500);
        const m = await measure();
        res[kind].t.push(...m.t); res[kind].w.push(...m.w);
        const s = stats(m.t), sw = stats(m.w);
        console.log(`round ${r + 1} ${kind.padEnd(6)}: frame p50 ${s.p50.toFixed(1)} ms, p95 ${s.p95.toFixed(1)} ms; work p50 ${sw.p50.toFixed(1)} ms, p95 ${sw.p95.toFixed(1)} ms`);
    }
    await setWidth(W0);
    const S = Object.fromEntries(kinds.map(k => [k, { f: stats(res[k].t), w: stats(res[k].w) }]));
    for (const k of kinds) console.log(`${k.padEnd(6)}: frame p50 ${S[k].f.p50.toFixed(1)} p95 ${S[k].f.p95.toFixed(1)} | work p50 ${S[k].w.p50.toFixed(1)} p95 ${S[k].w.p95.toFixed(1)}`);
    // The panel itself must cost nothing beyond what the narrower page costs.
    check('open panel: work like the same width without it', S.open.w.p50 <= S.narrow.w.p50 * 1.1 + 1, `${S.open.w.p50.toFixed(1)} vs ${S.narrow.w.p50.toFixed(1)}`);
    check('open panel: frames like the same width without it', S.open.f.p50 <= S.narrow.f.p50 + 2, `${S.open.f.p50.toFixed(1)} vs ${S.narrow.f.p50.toFixed(1)}`);
    bar.close(); P.close();
} finally {
    if (a) await a.quit();
    await sleep(2000);
    fs.writeFileSync(SETTINGS, saved);
    const after = snap(USER);
    const changed = {};
    for (const [p, v] of after) if (before.get(p) !== v && p !== SETTINGS) { const top = path.relative(USER, p).split(path.sep)[0]; changed[top] = (changed[top] || 0) + 1; }
    let gone = 0; for (const p of before.keys()) if (!after.has(p)) gone++;
    console.log(`settings.json restored (${saved.length} bytes); files SillyTavern changed or added: ${JSON.stringify(changed)}; removed: ${gone}`);
}
finish();
