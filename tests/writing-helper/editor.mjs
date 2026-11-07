// The frame after clicking into SillyTavern's big editor, with the add-on off
// (the control: SillyTavern's popup alone) and on, in turns. Counts and timings only.
// node editor.mjs <test character name> [rounds]
import { connect } from './lib.mjs';
const NAME = process.argv[2];
const ROUNDS = Number(process.argv[3] || 6);
const { send, ev, sleep, close } = await connect(process.env.ST || 'localhost:8123');
const list = await (await fetch('http://127.0.0.1:9244/json/list')).json();
const ws = new WebSocket(list[0].webSocketDebuggerUrl);
await new Promise(r => { ws.onopen = r; });
let id = 0; const wait = new Map();
ws.onmessage = m => { const d = JSON.parse(m.data); if (wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); } };
const main = expr => new Promise(r => { const i = ++id; wait.set(i, d => r(d.result?.result?.value)); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: expr, includeCommandLineAPI: true, returnByValue: true, awaitPromise: true, replMode: true } })); });
const launcherList = await (await fetch('http://127.0.0.1:9444/json/list')).json();
const lws = new WebSocket(launcherList.find(x => x.url.endsWith('launcher.html')).webSocketDebuggerUrl);
await new Promise(r => { lws.onopen = r; });
let lid = 0; const lwait = new Map();
lws.onmessage = m => { const d = JSON.parse(m.data); if (lwait.has(d.id)) { lwait.get(d.id)(d); lwait.delete(d.id); } };
const launcher = expr => new Promise(r => { const i = ++lid; lwait.set(i, d => r(d.result?.result?.value)); lws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise: true, replMode: true, userGesture: true } })); });

await main(`const { dialog } = require('electron'); dialog.showMessageBox = async () => ({ response: 0 }); 'ok'`);
await send('Performance.enable');
const metrics = async () => Object.fromEntries((await send('Performance.getMetrics')).result.metrics.map(m => [m.name, m.value]));
const guard = async () => {
    const w = await ev(`(() => { const c = SillyTavern.getContext(); return c.characters[c.characterId]?.name ?? null; })()`).catch(() => null);
    if (w !== NAME) { console.log('STOP: the test character is no longer open'); close(); process.exit(1); }
};
const click = async (x, y) => { for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: type === 'mouseMoved' ? 0 : 1 }); };
const para = 'The lantern light moved slowly across the old stone walls while the rain kept falling outside the tavern, and everyone in the room pretended not to notice the stranger by the fire. ';

await guard();
await ev(`(() => { const el = document.querySelector('#description_textarea'); el.value = ${JSON.stringify(para.repeat(420))}; el.blur(); return 0; })()`);
const rows = [];
for (let r = 0; r < ROUNDS; r++) {
    const on = r % 2 === 1;
    await launcher(`await D.extSetEnabled('writing-helper', ${on}); 'ok'`);
    await sleep(2500);
    await guard();
    // Frames from the click that opens the editor, too: that is where the strip moves now.
    await ev(`document.querySelector('#description_textarea').scrollIntoView({ block: 'center' }); window.__fo = []; window.__so = false; (function f(t){ if (window.__so) return; window.__fo.push(t); requestAnimationFrame(f); })(performance.now()); 0`);
    const opened = await ev(`await (async () => { const z = document.querySelector('.editor_maximize[data-for="description_textarea"]'); if (!z) return false; z.click(); await new Promise(r => setTimeout(r, 900)); return !!document.querySelector('dialog[open] textarea'); })()`);
    if (!opened) { console.log('big editor did not open'); break; }
    const m = await ev(`(() => { const t = document.querySelector('dialog[open] textarea'); t.scrollTop = t.scrollHeight * 0.4; const r = t.getBoundingClientRect(); return { x: r.x + r.width * 0.5, y: r.y + r.height / 2 }; })()`);
    const fo = await ev(`window.__so = true; window.__fo`);
    const openMax = Math.round(Math.max(...fo.slice(1).map((v, i) => v - fo[i])));
    await sleep(300);
    await ev(`window.__fr = []; window.__stop = false; (function f(t){ if (window.__stop) return; window.__fr.push(t); requestAnimationFrame(f); })(performance.now()); window.__t0 = performance.now(); 0`);
    const a = await metrics();
    await click(m.x, m.y);
    await sleep(1200);
    const z = await metrics();
    const fr = await ev(`window.__stop = true; ({ fr: window.__fr, t0: window.__t0, open: !!document.querySelector('#desktop-writing-helper')?.matches(':popover-open'), inDialog: !!document.querySelector('#desktop-writing-helper')?.closest('dialog') })`);
    const d = fr.fr.slice(1).map((v, i) => ({ ms: v - fr.fr[i], at: fr.fr[i] - fr.t0 }));
    const worst = d.reduce((p, q) => (q.ms > p.ms ? q : p), { ms: 0, at: 0 });
    // Then scrolling in the editor, as heavy.mjs does.
    await ev(`window.__fs = []; window.__ss = false; (function f(t){ if (window.__ss) return; window.__fs.push(t); requestAnimationFrame(f); })(performance.now()); 0`);
    for (let i = 0; i < 80; i++) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: m.x, y: m.y, deltaX: 0, deltaY: i % 40 < 20 ? 120 : -120 }); await sleep(16); }
    const fs = await ev(`window.__ss = true; window.__fs`);
    const scrollMax = Math.round(Math.max(...fs.slice(1).map((v, i) => v - fs[i])));
    rows.push({
        addon: on ? 'on' : 'off', box: fr.open, inDialog: fr.inDialog, openFrame: openMax, scrollMax,
        maxFrame: Math.round(worst.ms), atMs: Math.round(worst.at), over50: d.filter(x => x.ms > 50).length,
        styleMs: Math.round((z.RecalcStyleDuration - a.RecalcStyleDuration) * 1000), layoutMs: Math.round((z.LayoutDuration - a.LayoutDuration) * 1000), scriptMs: Math.round((z.ScriptDuration - a.ScriptDuration) * 1000),
    });
    console.log(JSON.stringify(rows.at(-1)));
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(150);
    await ev(`document.querySelector('dialog[open] .popup-button-ok, dialog[open] .popup-button-close, dialog[open] .popup-button-cancel')?.click(); 0`);
    await sleep(900);
}
await launcher(`await D.extSetEnabled('writing-helper', true); 'ok'`);
const avg = k => w => Math.round(rows.filter(x => x.addon === w).reduce((s, x) => s + x[k], 0) / Math.max(1, rows.filter(x => x.addon === w).length));
console.log('average: click into the editor off', avg('maxFrame')('off'), 'on', avg('maxFrame')('on'), 'ms | opening the editor off', avg('openFrame')('off'), 'on', avg('openFrame')('on'), 'ms | scrolling off', avg('scrollMax')('off'), 'on', avg('scrollMax')('on'), 'ms | style off', avg('styleMs')('off'), 'on', avg('styleMs')('on'));
close(); ws.close(); lws.close();
