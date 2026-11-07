// What does the page really underline? Types into a scratch editable box and right-clicks each word,
// reading misspelledWord from the app. Prints only words from public test lists. node marks.mjs <list.json>
import { connect } from './lib.mjs';
import fs from 'node:fs';
const url = process.env.ST || 'localhost:8123';
const { send, ev, sleep, close, key } = await connect(url);
const list = await (await fetch('http://127.0.0.1:9244/json/list')).json();
const ws = new WebSocket(list[0].webSocketDebuggerUrl);
await new Promise(r => { ws.onopen = r; });
let id = 0; const wait = new Map();
ws.onmessage = m => { const d = JSON.parse(m.data); if (wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); } };
const main = expr => new Promise(r => { const i = ++id; wait.set(i, d => r(d.result?.result?.value)); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: expr, includeCommandLineAPI: true, returnByValue: true } })); });
const part = JSON.stringify(url);
console.log('hook', await main(`(() => { const { Menu, webContents } = require('electron');
  if (!globalThis.__patched) { globalThis.__patched = true; const real = Menu.buildFromTemplate; Menu.buildFromTemplate = t => ({ popup() {}, closePopup() {} , items: [] }); }
  globalThis.__cm = [];
  const wc = webContents.getAllWebContents().find(w => w.getURL().includes(${part}));
  if (!wc.__hooked) { wc.__hooked = true; wc.on('context-menu', (_e, p) => globalThis.__cm.push({ w: p.misspelledWord, s: p.dictionarySuggestions.length, sel: p.selectionText })); }
  return !!wc; })()`));
const rightAt = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', clickCount: 1 });
};
const mkBox = `(() => { document.getElementById('wh_ce')?.remove(); const d = document.createElement('div'); d.id = 'wh_ce'; d.contentEditable = 'true'; d.spellcheck = true; d.style.cssText = 'position:fixed;left:40px;top:40px;width:420px;height:640px;overflow:hidden;z-index:2147483600;background:#111;color:#ddd;font:15px/20px sans-serif;white-space:pre-wrap'; document.body.append(d); d.focus(); return 1; })()`;
const rects = `(() => { const d = document.getElementById('wh_ce'); const out = []; const w = document.createTreeWalker(d, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { const m = /\\S+/.exec(n.data); if (!m) continue; const r = document.createRange(); r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length); const b = r.getBoundingClientRect(); if (b.width) out.push({ t: m[0], x: b.left + Math.min(b.width / 2, 12), y: b.top + b.height / 2 }); } return out; })()`;
export async function check(words) {
  const flagged = [];
  for (let i = 0; i < words.length; i += 14) {
    const part = words.slice(i, i + 14);
    await ev(mkBox);
    await send('Input.insertText', { text: part.join(' \n') + ' \n' });
    await sleep(1600);
    const rs = await ev(rects);
    await main(`globalThis.__cm.length = 0; 0`);
    for (const r of rs) { await rightAt(r.x, r.y); await sleep(70); }
    await sleep(150);
    const cm = await main(`globalThis.__cm.slice()`);
    for (const c of cm) if (c.w) flagged.push(c.w);
    if (cm.length !== rs.length) console.log('  got', cm.length, 'of', rs.length);
    await ev(`document.getElementById('wh_ce')?.remove(); 0`);
  }
  return flagged;
}
const words = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const out = await check(words);
console.log('checked', words.length, 'flagged', out.length, ':', out.join(' '));
close(); ws.close();
