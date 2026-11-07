// Page behaviour tests for the Writing helper. node suite.mjs
import { connect } from './lib.mjs';
const { send, ev, sleep, close, key } = await connect();
await send('Performance.enable');
let pass = 0, fail = 0;
const ok = (name, cond, info = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name} ${info}`); };
const ALT = 1;
const strip = () => ev(`(() => { const s = document.querySelector('#desktop-writing-helper'); return { open: s.matches(':popover-open'), words: [...s.shadowRoot.querySelectorAll('button')].map(x => x.firstChild.textContent) }; })()`);
const mk = (value, caret = value.length) => ev(`(() => { document.getElementById('wh_t')?.remove(); const t = document.createElement('textarea'); t.id = 'wh_t'; t.style.cssText = 'position:fixed;left:200px;top:200px;width:500px;height:200px;z-index:99999'; document.body.append(t); t.value = ${JSON.stringify(value)}; t.focus(); t.setSelectionRange(${caret}, ${caret}); return 1; })()`);
const val = () => ev(`document.getElementById('wh_t').value`);
const type = async (t, wait = 250) => { await send('Input.insertText', { text: t }); await sleep(wait); };
const alt1 = () => key('1', 'Digit1', 49, ALT);
const mouse = async (x, y, button = 'left') => { for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : button, clickCount: type === 'mouseMoved' ? 0 : 1 }); };

// --- where the box is, in a long text with a scrollbar
{
  const truth = `(() => { const el = document.querySelector('#description_textarea'), cs = getComputedStyle(el), b = el.getBoundingClientRect();
    const c = el.cloneNode(); c.removeAttribute('id'); c.value = el.value.slice(0, el.selectionStart); c.style.cssText = 'position:fixed;left:0;top:0;height:10px;overflow-y:scroll;width:' + b.width + 'px'; document.body.append(c);
    const h = c.scrollHeight - parseFloat(cs.paddingBottom) - parseFloat(cs.paddingTop); c.remove(); return { h, cs: { pt: parseFloat(cs.paddingTop), bt: parseFloat(cs.borderTopWidth) }, top: b.top }; })()`;
  const para = 'The lantern light moved slowly across the old stone walls while the rain kept falling outside the tavern. ';
  await ev(`(() => { const el = document.querySelector('#description_textarea'); el.value = ${JSON.stringify(para.repeat(300))}; el.style.height = '420px'; el.focus(); el.scrollIntoView({ block: 'center' }); return 1; })()`);
  const line = await ev(`(() => { const el = document.querySelector('#description_textarea'); const c = document.createElement('span'); c.textContent = 'x'; c.style.font = getComputedStyle(el).font; document.body.append(c); const h = c.getBoundingClientRect().height; c.remove(); return h; })()`);
  let worst = 0;
  for (const f of [0.02, 0.2, 0.5, 0.77, 0.98]) {
    await ev(`(() => { const el = document.querySelector('#description_textarea'); const at = el.value.indexOf(' ', Math.floor(el.value.length * ${f})) + 1; el.focus(); el.setSelectionRange(at, at); return 1; })()`);
    await type('th', 300);
    const t = await ev(truth);
    await ev(`(() => { const el = document.querySelector('#description_textarea'); el.scrollTop = ${t.h} - 200; return 1; })()`);
    await sleep(120);
    const r = await ev(`(() => { const el = document.querySelector('#description_textarea'), s = document.querySelector('#desktop-writing-helper'); return { open: s.matches(':popover-open'), bottom: s.shadowRoot.querySelector('.box').getBoundingClientRect().bottom, st: el.scrollTop }; })()`);
    const caretBottom = t.top + t.cs.bt + t.cs.pt + t.h - r.st;
    const off = Math.abs((r.bottom + 6) - (caretBottom - line));
    worst = Math.max(worst, off);
    await ev(`(() => { const el = document.querySelector('#description_textarea'); const p = el.selectionStart; el.setRangeText('', p - 2, p, 'end'); return 1; })()`);
  }
  ok('box sits at the caret in a long scrolled text', worst <= 3, `worst ${worst.toFixed(1)} px, line ${line}`);
}

// --- a long run of letters with no spaces
for (const [name, run] of [['Japanese text', 'あいう'.repeat(20000)], ['one long code', 'QmFzZTY0'.repeat(8000)]]) {
  await mk(run);
  const t0 = Date.now();
  await send('Input.insertText', { text: 'a' });
  const done = await Promise.race([ev(`await new Promise(r => setTimeout(r, 60)); 1`), sleep(8000).then(() => 0)]);
  await sleep(300);
  const main = await Promise.race([ev(`await window.SillyTavernDesktop.invoke('writing-helper', 'config').then(() => 1)`), sleep(15000).then(() => 0)]);
  const total = Date.now() - t0;
  ok(`${name}: the app stays responsive`, done && main && total < 1500, `${total} ms`);
}

// --- picking
await mk('He looked at th'); await type('e', 300);
let s = await strip();
ok('words show', s.open, JSON.stringify(s.words));
await ev(`document.getElementById('wh_t').value = 'changed by the page'; 1`);
await alt1(); await sleep(150);
ok('a stale pick leaves changed text alone', (await val()) === 'changed by the page', JSON.stringify(await val()));

await mk('She gave a *smi*', 15); await type('l', 300);
await alt1(); await sleep(200);
ok('no space before a closing *', /^She gave a \*\w+\*$/.test(await val()), JSON.stringify(await val()));

await mk('She said "wa"', 12); await type('l', 300); await alt1(); await sleep(200);
ok('no space before a closing quote', /"\w+"$/.test(await val()), JSON.stringify(await val()));

await mk('She gave a *'); await type('wierd', 60); await type('*', 300);
ok('autocorrect after a closing *', (await val()) === 'She gave a *weird*', JSON.stringify(await val()));

// --- mouse on the box
await mk('He looked at th'); await type('e', 300);
let box = await ev(`(() => { const b = document.querySelector('#desktop-writing-helper').shadowRoot.querySelector('button').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
const before = await val();
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'right', clickCount: 1 }); await sleep(60);
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'right', clickCount: 1 }); await sleep(150);
await key('Escape', 'Escape', 27);
ok('a right click on a word does not take it', (await val()) === before, JSON.stringify(await val()));
await sleep(100);
await mk('He looked at th'); await type('e', 300);
box = await ev(`(() => { const b = document.querySelector('#desktop-writing-helper').shadowRoot.querySelector('.box').getBoundingClientRect(); return { x: b.left + 3, y: b.top + 2 }; })()`);
await mouse(box.x, box.y); await sleep(150);
ok('a click on the box edge keeps the focus', (await ev(`document.activeElement.id`)) === 'wh_t', await ev(`document.activeElement.tagName`));

// --- closing
await mk('He looked at th'); await send('Input.insertText', { text: 'e' }); await key('Escape', 'Escape', 27); await sleep(300);
ok('Esc right after typing stays closed', !(await strip()).open);

await mk('He looked at th'); await type('e', 300);
await ev(`document.getElementById('wh_t').remove(); 1`); await sleep(200);
ok('box goes when the field is removed', !(await strip()).open);

await mk('He looked at th'); await type('e', 300);
await ev(`document.getElementById('wh_t').style.display = 'none'; window.dispatchEvent(new Event('resize')); 1`); await sleep(200);
ok('box goes when the field is hidden', !(await strip()).open);

await mk('He left the room. ');
await ev(`(() => { const t = document.getElementById('wh_t'); t.dispatchEvent(new InputEvent('input', { bubbles: true })); return 1; })()`); await sleep(300);
s = await strip();
ok('next-word suggestions start with a capital after a full stop', s.open && s.words.every(w => /^\p{Lu}/u.test(w)), JSON.stringify(s));

await ev(`document.getElementById('wh_t')?.remove(); 1`);
console.log(`\n${pass} passed, ${fail} failed`);
close();
