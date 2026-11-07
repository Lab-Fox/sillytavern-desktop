// Everything on: two rows, full dictionary. Prints counts and timings only, never words or names.
// node heavy.mjs <expected character name or ->
import { connect } from './lib.mjs';
const NAME = process.argv[2] || '-';
const { send, ev, sleep, close, key } = await connect(process.env.ST || 'localhost:8123');
await send('Performance.enable');
let pass = 0, fail = 0;
const ok = (name, cond, info = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name} ${info}`); };
const metrics = async () => Object.fromEntries((await send('Performance.getMetrics')).result.metrics.map(m => [m.name, m.value]));
const S = `document.querySelector('#desktop-writing-helper')`;
const strip = () => ev(`(() => { const s = ${S}; if (!s) return { open: false, rows: 0, adult: 0, normal: 0, sel: null, tags: 0 }; return { open: s.matches(':popover-open'), rows: s.shadowRoot.querySelectorAll('.wh-row').length, adult: s.shadowRoot.querySelectorAll('.wh-row.adult button').length, normal: s.shadowRoot.querySelectorAll('.wh-row:not(.adult) button').length, sel: s.shadowRoot.querySelector('.sel')?.dataset.r ?? null, tags: s.shadowRoot.querySelectorAll('.wh-tag').length }; })()`);
const wheel = async (x, y, n = 120) => {
  await ev(`window.__fr = []; window.__stop = false; (function f(t){ if (window.__stop) return; window.__fr.push(t); requestAnimationFrame(f); })(performance.now()); 0`);
  const a = await metrics();
  for (let i = 0; i < n; i++) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: i % 40 < 20 ? 120 : -120 }); await sleep(16); }
  const z = await metrics();
  const fr = await ev(`window.__stop = true; window.__fr`);
  const d = fr.slice(1).map((v, i) => v - fr[i]).sort((p, q) => p - q);
  return { frames: d.length, p50: +d[d.length >> 1].toFixed(1), p95: +d[Math.floor(d.length * .95)].toFixed(1), max: +d[d.length - 1].toFixed(1), layouts: z.LayoutCount - a.LayoutCount, layoutMs: Math.round((z.LayoutDuration - a.LayoutDuration) * 1000), scriptMs: Math.round((z.ScriptDuration - a.ScriptDuration) * 1000) };
};
const click = async (x, y) => { for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: type === 'mouseMoved' ? 0 : 1 }); };
const typeLatency = async (text, n = 24) => {
  // From a key to the strip being redrawn, in the page's own clock.
  await ev(`window.__lat = []; window.__mo?.disconnect(); window.__t0 = 0; window.__mo = new MutationObserver(() => { if (window.__t0) { window.__lat.push(performance.now() - window.__t0); window.__t0 = 0; } }); window.__mo.observe(document.querySelector('#desktop-writing-helper').shadowRoot.querySelector('.box'), { childList: true }); document.addEventListener('beforeinput', window.__bi = () => { window.__t0 = performance.now(); }, true); 0`);
  for (let i = 0; i < n; i++) { await send('Input.insertText', { text: text[i % text.length] }); await sleep(90); }
  const l = await ev(`document.removeEventListener('beforeinput', window.__bi, true); window.__mo.disconnect(); window.__lat`);
  l.sort((a, b) => a - b);
  return { n: l.length, p50: +(l[l.length >> 1] ?? 0).toFixed(1), max: +(l[l.length - 1] ?? 0).toFixed(1) };
};

// Safety: the description field must belong to the test character.
const who = await ev(`(() => { const c = SillyTavern.getContext(); return c.characters[c.characterId]?.name ?? null; })()`);
if (NAME !== '-' && who !== NAME) { console.log('STOP: the open character is not the test character'); process.exit(1); }
// The page can reload and open the last real chat at any time: check again before every step that types.
const guard = async () => { if (NAME === '-') return; const w = await ev(`(() => { const c = SillyTavern.getContext(); return c.characters[c.characterId]?.name ?? null; })()`).catch(() => null); if (w !== NAME) { console.log('STOP: the test character is no longer open'); close(); process.exit(1); } };

const para = 'The lantern light moved slowly across the old stone walls while the rain kept falling outside the tavern, and everyone in the room pretended not to notice the stranger by the fire. ';
await guard();
const b = await ev(`await (async () => {
  const el = document.querySelector('#description_textarea');
  el.value = ${JSON.stringify(para.repeat(420))}; el.style.height = '420px'; el.blur(); el.scrollIntoView({ block: 'center' }); el.scrollTop = el.scrollHeight * 0.6;
  await new Promise(r => setTimeout(r, 300));
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width * 0.45, y: r.y + r.height / 2, h: r.height, nodes: document.querySelectorAll('*').length };
})()`);
console.log('page elements', b.nodes);
await click(b.x, b.y); await sleep(600);
let s = await strip();
ok('click on a word opens both rows', s.open, JSON.stringify(s));
let w = await wheel(b.x, b.y);
ok('scroll, two rows open, long paragraph', w.layouts === 0 && w.p95 < 12, JSON.stringify(w));
s = await strip(); ok('box still open after the scroll', s.open);

// Two rows: walk with the keys (no Enter in the chat box: it could send).
await guard(); await send('Input.insertText', { text: ' co' }); await sleep(400);
s = await strip();
ok('two rows for a word start', s.adult > 0 && s.normal > 0, JSON.stringify(s));
await key('ArrowUp', 'ArrowUp', 38); await sleep(40); s = await strip(); ok('up: normal row', s.sel === '0');
await key('ArrowUp', 'ArrowUp', 38); await sleep(40); s = await strip(); ok('up again: explicit row', s.sel === '1');
await key('ArrowRight', 'ArrowRight', 39); await sleep(40);
await key('ArrowDown', 'ArrowDown', 40); await sleep(40); s = await strip(); ok('down: normal row', s.sel === '0');
await key('ArrowDown', 'ArrowDown', 40); await sleep(40); s = await strip(); ok('down: back to the text', s.sel === null);
await guard();
const v0 = await ev(`document.querySelector('#description_textarea').value.length`);
await key('4', 'Digit4', 52, 1); await sleep(300);
const v1 = await ev(`document.querySelector('#description_textarea').value.length`);
ok('Alt+4 takes an explicit word', v1 > v0, `+${v1 - v0} chars`);

// Typing speed in the long text.
await key('Escape', 'Escape', 27);
await guard(); await send('Input.insertText', { text: ' ' });
let l = await typeLatency('the story ');
ok('words follow typing in a 76 KB paragraph', l.n > 8 && l.p50 < 45, JSON.stringify(l));

// A new paragraph each time: the slowest measuring case.
await guard();
const t0 = await ev(`await (async () => { const el = document.querySelector('#description_textarea'); const t = []; for (let i = 0; i < 6; i++) { const at = Math.floor(el.value.length * (0.1 + i * 0.15)); el.setSelectionRange(at, at); const a = performance.now(); el.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowLeft', bubbles: true })); await new Promise(r => setTimeout(r, 120)); t.push(Math.round(performance.now() - a - 120)); } return t; })()`);
ok('moving the cursor far in the text stays quick', Math.max(...t0) < 80, JSON.stringify(t0));

// The maximized editor: a modal dialog, the strip lives inside it.
await guard();
const opened = await ev(`await (async () => { const z = document.querySelector('.editor_maximize[data-for="description_textarea"]'); if (!z) return false; z.click(); await new Promise(r => setTimeout(r, 900)); return !!document.querySelector('dialog[open] textarea'); })()`);
if (opened) {
  const m = await ev(`await (async () => { const t = document.querySelector('dialog[open] textarea'); t.focus(); t.scrollTop = t.scrollHeight * 0.4; await new Promise(r => setTimeout(r, 200)); const r = t.getBoundingClientRect(); return { x: r.x + r.width * 0.5, y: r.y + r.height / 2 }; })()`);
  await click(m.x, m.y); await sleep(600);
  s = await strip();
  // The box shows above the dialog from the page, and moves in only when the mouse comes close.
  const before = await ev(`!!${S}.closest('dialog')`);
  ok('in the big editor: box opens, still outside the dialog', s.open && !before, JSON.stringify({ open: s.open, inside: before }));
  w = await wheel(m.x, m.y, 80);
  ok('scroll in the big editor, box open', w.layouts === 0 && w.p95 < 12, JSON.stringify(w));
  const bb = await ev(`(() => { const r = ${S}.shadowRoot.querySelector('.box button').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: bb.x, y: bb.y + 40, button: 'none' }); await sleep(80);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: bb.x, y: bb.y, button: 'none' }); await sleep(200);
  const after = await ev(`!!${S}.closest('dialog')`);
  ok('mouse comes close: box moves into the dialog', after && (await strip()).open, JSON.stringify({ inside: after }));
  await guard();
  const len0 = await ev(`document.querySelector('dialog[open] textarea').value.length`);
  for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: bb.x, y: bb.y, button: 'left', clickCount: 1 });
  await sleep(300);
  const len1 = await ev(`document.querySelector('dialog[open] textarea').value.length`);
  const focused = await ev(`document.activeElement === document.querySelector('dialog[open] textarea')`);
  ok('a real click on a word in the dialog takes it, focus stays', len1 !== len0 && focused, JSON.stringify({ changed: len1 - len0, focused }));
  await key('Escape', 'Escape', 27); await sleep(100);
  await ev(`document.querySelector('dialog[open] .popup-button-ok, dialog[open] .popup-button-close, dialog[open] .popup-button-cancel')?.click(); 0`); await sleep(700);
  ok('big editor closed, box gone', !(await strip()).open);
} else ok('big editor opened', false);

// An editable element that scrolls.
const ce = await ev(`await (async () => { document.getElementById('wh_ce')?.remove(); const d = document.createElement('div'); d.id = 'wh_ce'; d.contentEditable = 'true'; d.style.cssText = 'position:fixed;left:200px;top:120px;width:420px;height:260px;overflow:auto;z-index:99999;background:#222;color:#ddd'; d.textContent = ${JSON.stringify(para.repeat(120))}; document.body.append(d); d.focus(); d.scrollTop = 1500; await new Promise(r => setTimeout(r, 200)); const r = d.getBoundingClientRect(); return { x: r.x + 200, y: r.y + 130 }; })()`);
await click(ce.x, ce.y); await sleep(500);
await send('Input.insertText', { text: 'th' }); await sleep(400);
s = await strip();
w = await wheel(ce.x, ce.y, 80);
ok('editable element: box follows without layouts', s.open && w.layouts < 5 && w.p95 < 12, JSON.stringify({ open: s.open, ...w }));
await ev(`document.getElementById('wh_ce').remove(); 0`);

// The chat box, typing only (never Enter).
await guard(); await ev(`document.querySelector('#send_textarea').focus(); 0`); await sleep(100);
l = await typeLatency('she looked at him ');
ok('words follow typing in the chat box', l.n > 8 && l.p50 < 45, JSON.stringify(l));
await ev(`(() => { const t = document.querySelector('#send_textarea'); t.value = ''; t.dispatchEvent(new Event('input', { bubbles: true })); t.blur(); return 0; })()`);
await sleep(200);
ok('box closes when the chat box is emptied and left', !(await strip()).open);
console.log(`\n${pass} passed, ${fail} failed`);
close();
