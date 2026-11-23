// Side panels for add-ons: a docked view in the SillyTavern window that talks
// both ways with its add-on. Needs ST_CLONE (a throwaway SillyTavern) and ST_RUNS.
import fs from 'fs';
import http from 'http';
import path from 'path';
import { launch, check, finish, sleep, RUNS, CLONE, TEST_SETTINGS } from './lib.mjs';

if (!CLONE) { console.log('Set ST_CLONE to a throwaway SillyTavern.'); process.exit(1); }
const NAME = 'sidepanel';
const DATA = path.join(RUNS, NAME);
const ID = 'panel-test', OTHER = 'panel-other';
const FAKE = path.join(RUNS, 'sidepanel-st2'); // a second "SillyTavern" for the profile switch

// Test add-ons, written before the app starts.
function seed(enabled) {
    fs.rmSync(DATA, { recursive: true, force: true });
    const write = (id, files) => {
        const dir = path.join(DATA, 'extensions', id);
        fs.mkdirSync(dir, { recursive: true });
        for (const [f, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), text);
    };
    write(ID, {
        'manifest.json': JSON.stringify({ name: 'Panel test', version: '1.0.0', main: 'main.cjs', sidepanel: 'panel.html' }),
        'main.cjs': `const fs = require('fs'), path = require('path');
module.exports = { activate(api) {
    api.sidepanel?.handle('echo', x => x * 2);
    api.sidepanel?.handle('fail', () => { throw new Error('nope'); });
    api.sidepanel?.onOpen(() => { api.sidepanel.send({ hello: 1 }); api.sidepanel.send({ hello: 2 }); });
    api.on('profile-switched', p => fs.writeFileSync(path.join(api.dir, 'profile.json'), JSON.stringify(p)));
    api.on('quit', async () => { await new Promise(r => setTimeout(r, 300)); const up = await fetch('http://localhost:8123/').then(r => r.status < 500, () => false); fs.writeFileSync(path.join(api.dir, 'quit.txt'), up ? 'up' : 'down'); });
} };`,
        'panel.html': `<!doctype html><meta charset="utf-8"><title>Panel test</title><body>Panel
<script>window.got = []; window.desktopPanel?.onMessage(m => window.got.push(m)); window.tabs = 0; window.desktopPanel?.onTab(() => window.tabs++);</script>`,
    });
    write(OTHER, {
        'manifest.json': JSON.stringify({ name: 'Panel other', version: '1.0.0', main: 'main.cjs', sidepanel: 'other.html' }),
        'main.cjs': `module.exports = { activate() {} };`,
        'other.html': `<!doctype html><meta charset="utf-8"><title>Panel other</title><body>Other`,
    });
    fs.writeFileSync(path.join(DATA, 'outside.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));
    fs.copyFileSync(path.join(DATA, 'outside.png'), path.join(DATA, 'extensions', ID, 'inside.png'));
    fs.mkdirSync(FAKE, { recursive: true });
    fs.writeFileSync(path.join(FAKE, 'server.js'), '');
    fs.writeFileSync(path.join(FAKE, 'package.json'), JSON.stringify({ name: 'sillytavern', version: '0.0.1' }));
    fs.writeFileSync(path.join(DATA, 'settings.json'), JSON.stringify({
        ...TEST_SETTINGS, sillytavernPath: CLONE, desktopExtensions: enabled,
        profiles: [{ id: 'p1', name: 'Clone', path: CLONE }, { id: 'p2', name: 'Fake', path: FAKE }],
    }));
}

// Bounds of the views in the SillyTavern window, from the main process.
const VIEWS = `(() => {
    const { BaseWindow, BrowserWindow } = require('electron');
    const w = BaseWindow.getAllWindows().find(x => !(x instanceof BrowserWindow) && x.contentView.children.length > 1);
    if (!w) return null;
    const [width, height] = w.getContentSize();
    const views = w.contentView.children.map(v => ({ url: v.webContents.getURL(), id: v.webContents.id, visible: v.getVisible(), ...v.getBounds() }));
    return { width, height, full: w.isFullScreen(), views };
})()`;
const views = a => a.main.ev(VIEWS);
const tabView = v => v?.views.find(x => x.visible && /localhost:8123/.test(x.url));
const panelView = (v, file = 'panel.html') => v?.views.find(x => x.url.endsWith(`/${file}`));
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; let r; while (Date.now() < end) { r = await fn(); if (r) return r; await sleep(300); } return r; };

// 1. No panel add-on turned on: no button.
seed({});
let a = await launch({ name: NAME, keep: true });
await a.launcher.ev(`await D.startServer(); 'ok'`);
let bar = await a.page('stbar.html');
await until(() => views(a).then(tabView));
check('bar button hidden without a panel add-on', await bar.ev(`document.querySelector('#btnPanel')?.hidden === true`));
bar.close();
await a.quit();
await sleep(1000);

// 2. With two turned on (the button then offers a menu; the test names the panel).
seed({ [ID]: true, [OTHER]: true });
a = await launch({ name: NAME, keep: true });
await a.launcher.ev(`await D.startServer(); 'ok'`);
bar = await a.page('stbar.html');
await until(() => views(a).then(tabView));
check('bar button shows', await until(() => bar.ev(`document.querySelector('#btnPanel')?.hidden === false`), 10000));

const panelPage = async file => { const pg = await a.page(file); await until(() => pg.ev(`document.readyState === 'complete' && !!window.desktopPanel`).catch(() => false), 10000); return pg; };
const openPanel = id => bar.ev(`bar.action('side-panel', { id: '${id}' }); 'ok'`);
await openPanel(ID);
let v = await until(async () => { const x = await views(a); return x && panelView(x) && x; });
const W = v?.width;
check('panel opens docked', !!(v && panelView(v) && tabView(v).width === W - 380 && panelView(v).x === W - 380 && panelView(v).width === 380),
    v && JSON.stringify({ W, tab: tabView(v)?.width, panel: panelView(v) && [panelView(v).x, panelView(v).width] }));

// The bridge.
const P = await panelPage(`${ID}/panel.html`);
const tryIt = expr => P.ev(`await (async () => { try { return { ok: await ${expr} }; } catch (e) { return { err: String(e.message || e) }; } })()`);
let r = await tryIt(`desktopPanel.invoke('echo', 21)`);
check('invoke round trip', r.ok === 42, JSON.stringify(r));
r = await tryIt(`desktopPanel.invoke('fail')`);
check('errors reach the panel', /nope/.test(r.err || ''), JSON.stringify(r));
r = await tryIt(`desktopPanel.invoke('nothing')`);
check('unknown channel', /No handler for nothing/.test(r.err || ''), JSON.stringify(r));
const got = await until(() => P.ev(`window.got?.length >= 2 ? window.got : null`), 5000);
check('push in order', JSON.stringify(got) === '[{"hello":1},{"hello":2}]', JSON.stringify(got));
r = await tryIt(`desktopPanel.tab()`);
check('tab info', r.ok?.kind === 'main' && path.resolve(r.ok.folder || '.').toLowerCase() === path.resolve(CLONE).toLowerCase() && /localhost:8123/.test(r.ok.url), JSON.stringify(r));
// The panel page gets none of a browser's extras, and nothing outside its folder.
r = await tryIt(`Notification.requestPermission()`);
check('no permissions', r.ok === 'denied', JSON.stringify(r));
const img = f => P.ev(`await new Promise(done => { const i = new Image(); i.onload = () => done('loaded'); i.onerror = () => done('blocked'); i.src = new URL('${f}', location.href).href; })`);
check('its own files load', (await img('inside.png')) === 'loaded');
check('files outside its folder are blocked', (await img('../../outside.png')) === 'blocked');
const web = http.createServer((q, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<p>a web page</p>'); }).listen(20125, '127.0.0.1');
await P.ev(`const f = document.createElement('iframe'); f.src = 'http://127.0.0.1:20125/'; document.body.append(f); 'ok'`);
await sleep(2500);
web.close();
// A cross-site frame runs in its own process: look for it among the debug targets.
const framed = (await a.list()).filter(t => t.url.startsWith('http://127.0.0.1:20125'));
check('frames cannot load web pages', framed.length === 0, JSON.stringify(framed.map(t => t.type)));
P.close();

await openPanel(ID);
v = await until(async () => { const x = await views(a); return x && !panelView(x) && x; });
check('toggle closes', !!(v && tabView(v).width === v.width), v && `${tabView(v)?.width} of ${v.width}`);

await openPanel(OTHER);
const O = await panelPage(`${OTHER}/other.html`);
r = await O.ev(`await (async () => { try { return { ok: await desktopPanel.invoke('echo', 1) }; } catch (e) { return { err: String(e.message || e) }; } })()`);
check("another add-on can't call it", /No handler for echo/.test(r.err || ''), JSON.stringify(r));
O.close();

// 3. Resize, tabs, reloads, full screen, events.
await openPanel(ID);
await until(async () => { const x = await views(a); return panelView(x); });
const Q = await panelPage(`${ID}/panel.html`);
const panelId = panelView(await views(a)).id;
// A real mouse stays put on the screen while the panel's edge moves under
// it; CDP's x is relative to the panel, so it is corrected by how much the
// panel has grown since the press.
const drag = async (fromX, toX) => {
    const m = (type, x) => Q.send('Input.dispatchMouseEvent', { type, x, y: 200, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
    const pw = async () => panelView(await views(a)).width;
    const start = await pw();
    await m('mousePressed', fromX);
    for (let i = 1; i <= 5; i++) { await m('mouseMoved', fromX + (toX - fromX) * i / 5 + (await pw() - start)); await sleep(60); }
    await m('mouseReleased', toX + (await pw() - start));
    await sleep(500);
};
const settingsWidth = () => JSON.parse(fs.readFileSync(path.join(DATA, 'settings.json'), 'utf8')).sidePanelWidth;
await drag(3, -97);
v = await views(a);
check('resize saves', panelView(v)?.width === 480 && tabView(v)?.width === v.width - 480 && settingsWidth() === 480, `panel ${panelView(v)?.width}, saved ${settingsWidth()}`);
await drag(3, -3000);
v = await views(a);
check('clamped', panelView(v)?.width === Math.round(v.width / 2), `panel ${panelView(v)?.width} of ${v.width}`);
await drag(3, 3 + panelView(v).width - 400); // back to 400
v = await views(a);
const PW = panelView(v)?.width;
check('resize back', PW === 400, String(PW));

const firstTab = await bar.ev(`document.querySelector('.tab.on')?.dataset.id`);
await bar.ev(`bar.action('tab-new'); 'ok'`);
await until(async () => (await bar.ev(`document.querySelectorAll('.tab').length`)) === 2);
await sleep(1500);
v = await views(a);
check('tab switch keeps it', panelView(v)?.id === panelId && tabView(v)?.width === v.width - PW && tabView(v)?.id !== Number(firstTab), `panel ${panelView(v)?.id}/${panelId}, tab ${tabView(v)?.width}`);
check('panel told about the tab change', (await Q.ev(`window.tabs`)) >= 1, String(await Q.ev(`window.tabs`)));
await bar.ev(`bar.action('tab-select', { id: ${firstTab} }); 'ok'`);
await bar.ev(`bar.action('reload'); 'ok'`);
await sleep(3000);
check('page reload keeps it', panelView(await views(a))?.id === panelId && (await Q.ev(`window.got.length`)) === 2);

await bar.ev(`bar.action('fullscreen'); 'ok'`);
v = await until(async () => { const x = await views(a); return x?.full && x; }, 8000);
await sleep(800);
v = await views(a);
check('full screen', !!(v?.full && panelView(v)?.y === 0 && panelView(v)?.height === v.height && tabView(v)?.width === v.width - PW && tabView(v)?.y === 0),
    v && JSON.stringify({ full: v.full, panel: panelView(v), tab: tabView(v)?.width, W: v.width }));
await bar.ev(`bar.action('fullscreen'); 'ok'`);
await until(async () => { const x = await views(a); return x && !x.full; }, 8000);
await sleep(800);

await a.launcher.ev(`await D.stopServer(); 'ok'`);
await until(async () => (await a.launcher.ev(`(await D.getState()).running`)) === false, 15000); // or the switch asks first
await a.launcher.ev(`await D.profileUse('p2'); 'ok'`);
const profFile = path.join(DATA, 'extensions', ID, 'profile.json');
await until(() => fs.existsSync(profFile), 10000);
let prof = null; try { prof = JSON.parse(fs.readFileSync(profFile, 'utf8')); } catch { /* none */ }
check('profile event', prof && path.resolve(prof.folder).toLowerCase() === path.resolve(FAKE).toLowerCase(), JSON.stringify(prof));
Q.close();

bar.close();
await a.quit();
check('quit event', fs.existsSync(path.join(DATA, 'extensions', ID, 'quit.txt')));

// 4. Closing the last window with the server running: quit handlers still reach it.
const sf = path.join(DATA, 'settings.json');
const st = JSON.parse(fs.readFileSync(sf, 'utf8')); st.sillytavernPath = CLONE; fs.writeFileSync(sf, JSON.stringify(st));
fs.rmSync(path.join(DATA, 'extensions', ID, 'quit.txt'), { force: true });
a = await launch({ name: NAME, keep: true });
await a.launcher.ev(`await D.startServer(); 'ok'`);
await until(() => views(a).then(tabView));
await sleep(2000);
await a.main.ev(`const { BaseWindow } = require('electron'); setTimeout(() => BaseWindow.getAllWindows().forEach(w => w.close()), 300); 'ok'`).catch(() => {});
a.launcher.close(); a.main.close();
await Promise.race([new Promise(r => a.proc.once('exit', r)), sleep(20000)]);
const q = fs.existsSync(path.join(DATA, 'extensions', ID, 'quit.txt')) ? fs.readFileSync(path.join(DATA, 'extensions', ID, 'quit.txt'), 'utf8') : 'none';
check('closing the window: quit handlers run before the server stops', q === 'up', q);
finish();
