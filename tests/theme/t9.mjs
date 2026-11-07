// Example themes: real looks, check results, cost. node t9.mjs <exe> <app|-> <userData> <clone> <workDir>
import { spawn, execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
const [exe, app, ud, clone, work] = process.argv.slice(2);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const port = 26000 + Math.floor(Math.random() * 500);
const res = []; const check = (n, ok, x = '') => { res.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x !== '' ? '  -> ' + String(x).slice(0, 200) : ''}`); };
fs.rmSync(ud, { recursive: true, force: true }); fs.mkdirSync(ud, { recursive: true });
fs.rmSync(work, { recursive: true, force: true }); fs.mkdirSync(work, { recursive: true });
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ sillytavernPath: clone, port: 8123, host: 'localhost', autoStart: false, checkUpdatesOnLaunch: false, checkAppUpdates: false, theme: 'fox', confirmBeforeQuit: false, language: 'en' }));
async function ws(url) {
    const s = new WebSocket(url); await new Promise(r => { s.onopen = r; });
    let id = 0; const w = new Map(), events = [];
    s.onmessage = m => { const d = JSON.parse(m.data); if (d.id) w.get(d.id)?.(d); else events.push(d); };
    const send = (method, params = {}) => new Promise((r, j) => { const i = ++id; w.set(i, r); s.send(JSON.stringify({ id: i, method, params })); setTimeout(() => j(new Error('timeout ' + method + ' ' + String(params.expression).slice(0, 70))), 30000); });
    const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true, userGesture: true, replMode: true, includeCommandLineAPI: true }); if (r.result.exceptionDetails) throw new Error(e.slice(0, 80) + ' => ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300)); return r.result.result.value; };
    return { send, ev, events };
}
spawn(exe, [...(app === '-' ? [] : [app]), `--user-data-dir=${ud}`, `--remote-debugging-port=${port}`, `--inspect=${port + 1}`, '--disable-features=CalculateNativeWinOcclusion'], { stdio: 'ignore' });
let page; for (let i = 0; i < 60 && !page; i++) { await sleep(500); try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(x => x.url.endsWith('launcher.html')); } catch { /* starting */ } }
await sleep(3500);
const L = await ws(page.webSocketDebuggerUrl);
await L.send('Runtime.enable'); await L.send('Log.enable');
const M = await ws((await (await fetch(`http://127.0.0.1:${port + 1}/json/list`)).json())[0].webSocketDebuggerUrl);
await M.ev(`const { BrowserWindow, dialog, app: a0 } = require('electron'); globalThis.W = BrowserWindow.getAllWindows()[0]; globalThis.A = a0; globalThis.__boxes = []; dialog.showMessageBox = async (...x) => { __boxes.push(x.at(-1).message); return { response: 0 }; }; W.show(); W.moveTop(); W.setBounds({ x: 60, y: 30, width: 1100, height: 760 }); 1`);
const ev = e => L.ev(e);
await ev(`go('settings'); showSetPane('look'); 1`); await sleep(400);
await ev(`$('btnThemeExamples').click(); 1`); await sleep(900);
const ids = ['pkg:tavern-night', 'pkg:soft-glass', 'pkg:snowfall'];
check('three examples listed', await ev(`(await D.listThemes()).themes.filter(t => ${JSON.stringify(ids)}.includes(t.id)).length`) === 3);
check('button gone once they are there', await ev(`$('btnThemeExamples').hidden`));
const ps = path.join(work, 'gpu.ps1');
fs.writeFileSync(ps, `$ids = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq '${exe.replace(/\//g, '\\')}' } | ForEach-Object { $_.ProcessId })
$s = (Get-Counter '\\GPU Engine(*engtype_3D)\\Utilization Percentage' -SampleInterval 2 -MaxSamples 3).CounterSamples
$t = 0; foreach ($c in $s) { if ($c.InstanceName -match 'pid_(\\d+)_' -and $ids -contains [int]$Matches[1]) { $t += $c.CookedValue } }
[math]::Round($t / 3, 1)`);
const gpu = () => execFileSync('pwsh', ['-NoProfile', '-File', ps], { encoding: 'utf8' }).trim().replace(',', '.');
const cpu = async () => { await M.ev(`A.getAppMetrics(); 1`); await sleep(3000); return Math.round(await M.ev(`A.getAppMetrics().reduce((n, p) => n + p.cpu.percentCPUUsage, 0)`) * 10) / 10; };
const mem = () => M.ev(`Math.round(A.getAppMetrics().reduce((n, p) => n + p.memory.workingSetSize, 0) / 1024)`);
const report = async n => console.log(`MEASURE ${n}: GPU ${await gpu()} %, CPU ${await cpu()} %, memory ${await mem()} MB`);
const shot = async n => { await ev(`$('console').innerHTML = ''; $('dockLast').textContent = ''; 1`); await sleep(500); fs.writeFileSync(path.join(work, n + '.png'), Buffer.from((await L.send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64')); };
await ev(`if (!$('dock').classList.contains('closed')) $('dockToggle').click(); 1`);
await M.ev(`__boxes.length = 0; 1`);
for (const id of ids) {
    await ev(`await D.setTheme(${JSON.stringify(id)}); 1`); await sleep(900);
    const short = id.slice(4);
    const c = await ev(`await D.themeCheck(${JSON.stringify(id)})`);
    const hard = c.filter(x => x.level === 'bad');
    check(`${short}: check finds nothing bad`, !hard.length, JSON.stringify(c).slice(0, 200));
    console.log('CHECK', short, JSON.stringify(c.map(x => x.text)).slice(0, 400));
    check(`${short}: its CSS loads`, (await ev(`$('themeCss').textContent.length`)) > 50);
    await ev(`go('home'); 1`); await sleep(500); await shot(short + '-home');
    await ev(`go('settings'); showSetPane('look'); 1`); await sleep(500); await shot(short + '-settings');
    await ev(`go('maintenance'); 1`); await sleep(500); await shot(short + '-tools');
    await ev(`go('home'); 1`); await sleep(400);
    await report(short + ' on Home');
    for (const [w, h] of [[820, 560], [1500, 950]]) {
        await M.ev(`W.setBounds({ x: 60, y: 30, width: ${w}, height: ${h} }); 1`); await sleep(400);
        check(`${short}: no sideways scroll at ${w}`, await ev(`document.querySelector('.page.show').scrollWidth <= document.querySelector('.page.show').clientWidth`));
    }
    await M.ev(`W.setBounds({ x: 60, y: 30, width: 1100, height: 760 }); 1`); await sleep(300);
}
// the fox follows the server
await ev(`await D.setTheme('pkg:tavern-night'); 1`); await sleep(500);
const shown = id => ev(`!document.querySelector('[data-layer="${id}"]').hidden`);
check('fox sleeps while stopped', await shown('fox-asleep') && !(await shown('fox-awake')));
await ev(`rootState.server = 'running'; 1`); await sleep(200);
check('fox wakes while running', !(await shown('fox-asleep')) && await shown('fox-awake'));
await ev(`go('home'); 1`); await sleep(300); await shot('tavern-night-running');
await ev(`rootState.server = 'stopped'; 1`);
check('the option hides it', await ev(`await (async () => { const o = themeState.optionValues; o.fox = false; applyThemeOptions((await D.themeOptionsSet(o, themeState.active)).state); await new Promise(r => setTimeout(r, 200)); return document.querySelector('[data-layer="fox-asleep"]').hidden; })()`));
// the scene asked once
const boxes = await M.ev(`JSON.stringify(__boxes)`);
check('asked once about the scene, no keep question', boxes.split('live scene').length === 2 && !boxes.includes('Keep this'), boxes);
check('snow running', (await ev(`await D.setTheme('pkg:snowfall'); await new Promise(r => setTimeout(r, 700)); document.querySelector('iframe.layer')?.hasAttribute('src')`)));
await ev(`go('home'); 1`); await sleep(300);
await M.ev(`W.minimize(); 1`); await sleep(1200); await report('snowfall, minimized');
await M.ev(`W.restore(); W.show(); 1`); await sleep(800);
await ev(`await D.setTheme('fox'); 1`); await sleep(800); await report('default theme');
const errs = L.events.filter(e => e.method === 'Runtime.exceptionThrown' || (e.method === 'Log.entryAdded' && e.params.entry.level === 'error'));
check('no page errors', !errs.length, JSON.stringify(errs.map(e => (e.params.entry?.text || e.params.exceptionDetails?.exception?.description || '').slice(0, 140))));
console.log(`\n${res.filter(Boolean).length}/${res.length} passed`);
M.ev(`setTimeout(() => A.exit(0), 100); 1`).catch(() => {});
await sleep(1500);
process.exit(0);
