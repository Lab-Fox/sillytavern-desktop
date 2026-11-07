// A brand-new profile underlines misspelled words on its very first launch.
// Reads the app's own answer through a right-click; correct words are the control.
import { launch, check, finish, sleep } from './lib.mjs';

const BAD = ['wrongg', 'helllo'], GOOD = ['house', 'garden'];
async function run(label, keep) {
const a = await launch({ name: 'underlines', keep });
await a.launcher.ev(`await D.startServer(); 'ok'`);
const P = await a.page('localhost:8123/');
await sleep(9000);

await a.main.ev(`const { Menu, webContents, BaseWindow } = require('electron');
    Menu.buildFromTemplate = () => ({ popup() {}, closePopup() {}, items: [] });
    globalThis.__cm = [];
    const wc = webContents.getAllWebContents().find(w => w.getURL().includes('localhost:8123'));
    wc.on('context-menu', (_e, p) => globalThis.__cm.push(p.misspelledWord));
    BaseWindow.getAllWindows().forEach(w => { if (w.contentView?.children?.length) { w.show(); w.focus(); } }); wc.focus(); 'ok'`);
await P.ev(`document.querySelectorAll('dialog[open]').forEach(d => d.close());
    const d = document.createElement('div'); d.id = 'ut'; d.contentEditable = 'true'; d.spellcheck = true;
    d.style.cssText = 'position:fixed;left:40px;top:40px;width:400px;z-index:99999;background:#fff;color:#000;font-size:20px';
    document.body.append(d); d.focus(); 'ok'`);
const words = [...BAD, ...GOOD];
await P.send('Input.insertText', { text: words.join(' \n') + ' \n' });
// A new profile's first check takes about 6 s (1 to 2 s afterwards).
await sleep(12000);
console.log(label, 'page has focus:', await P.ev('document.hasFocus()'));
const spots = await P.ev(`(() => { const out = []; const w = document.createTreeWalker(document.getElementById('ut'), NodeFilter.SHOW_TEXT); let n;
    while ((n = w.nextNode())) { const m = /\\S+/.exec(n.data); if (!m) continue; const r = document.createRange(); r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length);
    const b = r.getBoundingClientRect(); out.push({ word: m[0], x: b.left + b.width / 2, y: b.top + b.height / 2 }); } return out; })()`);
for (const s of spots) {
    await a.main.ev(`globalThis.__cm.length = 0; 'ok'`);
    for (const type of ['mousePressed', 'mouseReleased']) await P.send('Input.dispatchMouseEvent', { type, x: s.x, y: s.y, button: 'right', clickCount: 1 });
    await sleep(250);
    const got = await a.main.ev(`globalThis.__cm.slice()`);
    const flagged = got[0] === s.word;
    check(`${label} ${s.word}: ${BAD.includes(s.word) ? 'underlined' : 'not underlined'}`, got.length === 1 && flagged === BAD.includes(s.word), JSON.stringify(got));
}
check(`${label} every word checked`, spots.length === words.length, `${spots.length}`);
P.close();
await a.quit();
}
await run('first launch', false);
await run('second launch', true);
finish();
