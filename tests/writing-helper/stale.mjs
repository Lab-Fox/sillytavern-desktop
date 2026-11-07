// Does a word stay underlined after autocorrect or a pick replaced it? And do the new words reach the box?
// Works in a scratch box only; prints only the test's own words.
import { connect } from './lib.mjs';
const url = process.env.ST || 'localhost:8123';
const { send, ev, sleep, close, key } = await connect(url);
const list = await (await fetch('http://127.0.0.1:9244/json/list')).json();
const ws = new WebSocket(list[0].webSocketDebuggerUrl);
await new Promise(r => { ws.onopen = r; });
let id = 0; const wait = new Map();
ws.onmessage = m => { const d = JSON.parse(m.data); if (wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); } };
const main = expr => new Promise(r => { const i = ++id; wait.set(i, d => r(d.result?.result?.value)); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: expr, includeCommandLineAPI: true, returnByValue: true } })); });
await main(`(() => { const { Menu, webContents } = require('electron');
  if (!globalThis.__patched) { globalThis.__patched = true; Menu.buildFromTemplate = t => ({ popup() {}, closePopup() {}, items: [] }); }
  globalThis.__cm = [];
  const wc = webContents.getAllWebContents().find(w => w.getURL().includes(${JSON.stringify(url)}));
  if (!wc.__hooked) { wc.__hooked = true; wc.on('context-menu', (_e, p) => globalThis.__cm.push({ w: p.misspelledWord })); }
  return 1; })()`);
let pass = 0, fail = 0;
const ok = (n, c, i = '') => { c ? pass++ : fail++; console.log(`${c ? 'ok  ' : 'FAIL'} ${n} ${i}`); };
const mk = () => ev(`(() => { document.getElementById('wh_ce')?.remove(); const d = document.createElement('div'); d.id = 'wh_ce'; d.contentEditable = 'true'; d.spellcheck = true; d.style.cssText = 'position:fixed;left:40px;top:60px;width:640px;height:200px;overflow:hidden;z-index:2147483600;background:#111;color:#ddd;font:18px/26px sans-serif;white-space:pre-wrap'; document.body.append(d); d.focus(); return 1; })()`);
const typeKeys = async t => { for (const c of t) { await send('Input.dispatchKeyEvent', { type: 'keyDown', text: c, key: c, unmodifiedText: c }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: c }); await sleep(45); } };
const text = () => ev(`document.getElementById('wh_ce').textContent`);
const words = () => ev(`document.querySelector('#desktop-writing-helper').shadowRoot.querySelectorAll('button').length ? [...document.querySelector('#desktop-writing-helper').shadowRoot.querySelectorAll('.wh-row:not(.adult) button')].map(b => b.firstChild.textContent) : []`);
// Right-clicks every word; returns those still underlined.
const flagged = async () => {
  const rs = await ev(`(() => { const d = document.getElementById('wh_ce'), out = []; const w = document.createTreeWalker(d, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { for (const m of n.data.matchAll(/[^\\s*"]+/g)) { const r = document.createRange(); r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length); const b = r.getBoundingClientRect(); if (b.width) out.push({ x: b.left + b.width / 2, y: b.top + b.height / 2 }); } } return out; })()`);
  await main(`globalThis.__cm.length = 0; 0`);
  for (const r of rs) { await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'right', clickCount: 1 }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'right', clickCount: 1 }); await sleep(30); }
  await sleep(200);
  return (await main(`globalThis.__cm.slice()`)).map(c => c.w).filter(Boolean);
};
const ALT = 1;

await mk(); await typeKeys('xqzzkk here '); await sleep(1500);
let f = await flagged();
ok('control: a nonsense word is underlined', f.includes('xqzzkk'), JSON.stringify(f));

await mk(); await typeKeys('the recieve cat wierd dog '); await sleep(1800);
let t = await text(); f = await flagged();
ok('autocorrect fixed them', /the receive cat weird dog/.test(t), JSON.stringify(t));
ok('nothing stays red after autocorrect', f.length === 0, JSON.stringify(f));

await mk(); await typeKeys('she is pregna'); await sleep(1200);
await key('1', 'Digit1', 49, ALT); await sleep(300); await typeKeys('now '); await sleep(1800);
t = await text(); f = await flagged();
ok('word picked after a partial word', /pregnant/.test(t), JSON.stringify(t));
ok('picked word is not red', f.length === 0, JSON.stringify(f));

await mk(); await typeKeys('she is pregnant with the doctor and they kinda gotta take the train '); await sleep(1800);
f = await flagged(); ok('words Windows rejected are clean', f.length === 0, JSON.stringify(f));
await mk(); await typeKeys('Pregnant PREGNANT Doctor DOCTOR '); await sleep(1800);
f = await flagged(); ok('capitals too', f.length === 0, JSON.stringify(f));
await mk(); await typeKeys("I can't and won't and don't, she's sure they'll say it's fine "); await sleep(1800);
f = await flagged(); ok('contractions are clean', f.length === 0, JSON.stringify(f));
await mk(); await typeKeys('*she smiled at the doctor* "it is a pregnant pause" '); await sleep(1800);
f = await flagged(); ok('inside * and quotes', f.length === 0, JSON.stringify(f));

await mk(); await typeKeys('she can'); await sleep(500);
let w = await words(); ok('can offers can\'t', w.includes("can't"), JSON.stringify(w.length));
await mk(); await typeKeys('she cant'); await sleep(500);
w = await words(); ok('cant offers can\'t first', w[0] === "can't", '');
await typeKeys(' go '); await sleep(400); t = await text(); ok('cant corrected by a space', t.includes("can't go"), JSON.stringify(t));
await mk(); await typeKeys('she is pregn'); await sleep(500);
w = await words(); ok('pregn offers pregnant', w.includes('pregnant'));
await mk(); await typeKeys('he smiled tentativel'); await sleep(500);
w = await words(); ok('a rare word is offered', w.includes('tentatively'));
await mk(); await typeKeys('she couldn'); await sleep(500);
w = await words(); ok("couldn offers couldn't", w.includes("couldn't"));

await ev(`document.getElementById('wh_ce')?.remove(); 0`);
console.log(`\n${pass} passed, ${fail} failed`);
close(); ws.close();
