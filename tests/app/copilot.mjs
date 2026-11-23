// The co-pilot add-on (addons/copilot) in its side panel: sessions, the
// profile picker, a streamed conversation with a fake model, Stop, and the
// panel's states. Needs ST_CLONE (a throwaway SillyTavern; it gets a test
// Connection Profile) and ST_RUNS. Nothing reaches a real AI provider.
import fs from 'fs';
import path from 'path';
import { launch, check, finish, sleep, RUNS, CLONE, ROOT, TEST_SETTINGS } from './lib.mjs';
import { start as fakeModel } from '../copilot/fake-model.mjs';

if (!CLONE) { console.log('Set ST_CLONE to a throwaway SillyTavern.'); process.exit(1); }
const NAME = 'copilot';
const DATA = path.join(RUNS, NAME);
const ID = 'copilot';
const FAKE_ST = path.join(RUNS, 'copilot-st2'); // a second "SillyTavern" for the profile switch
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; let r; while (Date.now() < end) { r = await fn().catch(() => null); if (r) return r; await sleep(200); } return r; };

// The run's data: the add-on copied from the repository, turned on.
fs.rmSync(DATA, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, 'addons', ID), path.join(DATA, 'extensions', ID), { recursive: true, filter: src => !/[\\/](user|downloads)$|data\.json$/.test(src) });
fs.mkdirSync(FAKE_ST, { recursive: true });
fs.writeFileSync(path.join(FAKE_ST, 'server.js'), '');
fs.writeFileSync(path.join(FAKE_ST, 'package.json'), JSON.stringify({ name: 'sillytavern', version: '0.0.1' }));
fs.writeFileSync(path.join(DATA, 'settings.json'), JSON.stringify({
    ...TEST_SETTINGS, sillytavernPath: CLONE, desktopExtensions: { [ID]: true }, warnSecondServer: false,
    profiles: [{ id: 'p1', name: 'Clone', path: CLONE }, { id: 'p2', name: 'Fake', path: FAKE_ST }],
}));

const fake = await fakeModel({ port: 20130 });
const a = await launch({ name: NAME, keep: true });
await a.launcher.ev(`await D.startServer(); 'ok'`);
const P = await a.page('localhost:8123/', 240);
await until(() => P.ev(`!!window.SillyTavern?.getContext && !!SillyTavern.getContext().extensionSettings?.connectionManager`), 90000);
await sleep(3000);
await P.ev(`(() => { const c = SillyTavern.getContext(); const cm = c.extensionSettings.connectionManager;
    cm.profiles = cm.profiles.filter(p => p.id !== 'desktop-test');
    cm.profiles.push({ id: 'desktop-test', name: 'Desktop test (fake model)', mode: 'cc', api: 'custom', model: 'fake-model', 'api-url': '${fake.url}', preset: 'Default' });
    c.saveSettingsDebounced(); return 'ok'; })()`);
const bar = await a.page('stbar.html');
await bar.ev(`bar.action('side-panel', { id: '${ID}' }); 'ok'`);
const Q = await a.page(`${ID}/panel.html`);
await until(() => Q.ev(`document.readyState === 'complete' && !!document.querySelector('#input')`));
const state = () => Q.ev(`document.querySelector('#state').dataset.state`);
check('panel opens', (await until(async () => (await state()) === 'ok' && 'ok', 15000)) === 'ok', await state());

// Profiles: the test profile, and where it sends.
await until(() => Q.ev(`[...document.querySelectorAll('#profileSel option')].some(o => o.value === 'desktop-test')`), 15000);
await Q.ev(`const s = document.querySelector('#profileSel'); s.value = 'desktop-test'; s.dispatchEvent(new Event('change')); 'ok'`);
await sleep(500);
const where = await Q.ev(`document.querySelector('#profileWhere').textContent`);
check('profiles listed with where they go', /custom/i.test(where) && /fake-model/.test(where), where);

// A streamed reply.
const lastText = () => Q.ev(`[...document.querySelectorAll('#log .msg[data-role=assistant] .text')].at(-1)?.textContent ?? ''`);
const send = text => Q.ev(`(() => { const i = document.querySelector('#input'); i.value = ${JSON.stringify(text)}; document.querySelector('#btnSend').click(); return 'ok'; })()`);
const idle = () => until(() => Q.ev(`document.querySelector('#btnSend').dataset.mode === 'send'`), 20000);
// Sends and waits until that turn's reply is in (finished, stopped or failed).
const done = () => Q.ev(`document.querySelectorAll('#log .msg[data-role=assistant]:not(.pending)').length`);
const sendAndWait = async text => { const n = await done(); await send(text); await until(async () => (await done()) > n && (await Q.ev(`document.querySelector('#btnSend').dataset.mode === 'send'`)), 20000); };
const REPLY = 'Hello! I can help you with presets, cards and chats.';
fake.reply({ text: REPLY, chunks: 6, delayMs: 150 });
await send('Hi there');
const seen = new Set();
for (let i = 0; i < 40; i++) { seen.add(await lastText()); if (await Q.ev(`document.querySelector('#btnSend').dataset.mode === 'send'`)) break; await sleep(60); }
await idle();
check('send streams into the panel', seen.size >= 3 && (await lastText()) === REPLY, `${seen.size} texts, final ${JSON.stringify(await lastText())}`);
let sent = fake.requests.at(-1)?.body?.messages || [];
check('request = system prompt + conversation', sent.length === 2 && sent[0].role === 'system' && /co-pilot/i.test(sent[0].content) && sent[1].role === 'user' && sent[1].content === 'Hi there', JSON.stringify(sent).slice(0, 200));

// SHOT=<file.png>: a picture of the panel (test data only).
if (process.env.SHOT) { const r = await Q.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(process.env.SHOT, Buffer.from(r.result.data, 'base64')); }

// Stop mid-reply.
fake.reply({ text: 'x'.repeat(300), chunks: 30, delayMs: 150 });
await send('Tell me a long story');
await until(async () => (await lastText()).length > 0 && (await Q.ev(`document.querySelector('#btnSend').dataset.mode`)) === 'stop', 10000);
await sleep(400);
await Q.ev(`document.querySelector('#btnSend').click(); 'ok'`);
await idle();
const stopped = await Q.ev(`(() => { const m = [...document.querySelectorAll('#log .msg[data-role=assistant]')].at(-1); return { stopped: m.classList.contains('stopped'), len: m.querySelector('.text').textContent.length }; })()`);
check('stop keeps the partial reply marked stopped', stopped.stopped && stopped.len > 0 && stopped.len < 300, JSON.stringify(stopped));

// A failed request: shown on its message, not sent next time.
fake.reply({ status: 500, error: 'boom' });
await sendAndWait('This one fails');
const err = await Q.ev(`[...document.querySelectorAll('#log .msg[data-role=assistant]')].at(-1)?.querySelector('.err')?.textContent || ''`);
fake.reply({ text: 'Fine again.' });
await sendAndWait('Again');
sent = fake.requests.at(-1)?.body?.messages || [];
const roles = sent.map(m => m.role).join(',');
// (the stopped partial reply is sent as said; the failed one is not)
check('error shown on the message, not sent next time', /boom|500/.test(err) && roles === 'system,user,assistant,user,assistant,user,user', `${err} | ${roles}`);

// Sessions.
const sessionDir = () => { const d = path.join(DATA, 'extensions', ID, 'user', 'sessions'); const sub = fs.existsSync(d) ? fs.readdirSync(d) : []; return sub.length ? fs.readdirSync(path.join(d, sub[0])).filter(f => f.endsWith('.json')) : []; };
const options = () => Q.ev(`[...document.querySelectorAll('#sessionSel option')].map(o => o.textContent)`);
await Q.ev(`document.querySelector('#btnNew').click(); 'ok'`);
await until(async () => (await options()).length === 2);
const fresh = await Q.ev(`document.querySelectorAll('#log .msg').length`);
await Q.ev(`document.querySelector('#btnRename').click(); 'ok'`);
await Q.ev(`(() => { const i = document.querySelector('#renameInput'); i.value = 'Renamed session'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return 'ok'; })()`);
await until(async () => (await options()).includes('Renamed session'));
const files2 = sessionDir().length;
await Q.ev(`document.querySelector('#btnDelete').click(); 'ok'`);
await Q.ev(`document.querySelector('#btnDeleteYes').click(); 'ok'`);
await until(async () => (await options()).length === 1);
check('new / rename / delete session', fresh === 0 && files2 === 2 && sessionDir().length === 1 && !(await options()).includes('Renamed session'), `fresh ${fresh}, files ${files2} → ${sessionDir().length}, ${JSON.stringify(await options())}`);
// Enter while a reply streams: the reply goes on, the typed text stays.
fake.reply({ text: 'A full answer that keeps going for a while.', chunks: 8, delayMs: 150 });
await send('Another question');
await until(async () => (await Q.ev(`document.querySelector('#btnSend').dataset.mode`)) === 'stop', 10000);
await Q.ev(`(() => { const i = document.querySelector('#input'); i.value = 'typed meanwhile'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return 'ok'; })()`);
await idle();
await sleep(300);
const enter = await Q.ev(`({ last: [...document.querySelectorAll('#log .msg[data-role=assistant]')].at(-1)?.textContent || '', input: document.querySelector('#input').value })`);
check('Enter while answering does not stop it', enter.last.startsWith('A full answer that keeps going for a while.') && enter.input === 'typed meanwhile', JSON.stringify(enter));
await Q.ev(`document.querySelector('#input').value = ''; 'ok'`);

// The reply can't be saved (a file in the way): the panel isn't stuck.
const sdir = () => { const d = path.join(DATA, 'extensions', ID, 'user', 'sessions'); return path.join(d, fs.readdirSync(d)[0]); };
const curId = await Q.ev(`document.querySelector('#sessionSel').value`);
fake.reply({ text: 'This reply will not save.', chunks: 4, delayMs: 200 });
await send('Save test');
await sleep(300);
fs.mkdirSync(path.join(sdir(), `${curId}.json.tmp`), { recursive: true }); // the save's temp file can't be written now
await sleep(2500);
const stuck = await Q.ev(`({ mode: document.querySelector('#btnSend').dataset.mode, err: [...document.querySelectorAll('#log .err')].at(-1)?.textContent || '' })`);
fs.rmSync(path.join(sdir(), `${curId}.json.tmp`), { recursive: true, force: true });
fake.reply({ text: 'Saved fine.' });
await sendAndWait('After the failed save');
check('a failed save does not leave the panel stuck', stuck.mode === 'send' && /save|EISDIR|EPERM/i.test(stuck.err) && (await lastText()) === 'Saved fine.', JSON.stringify(stuck));

// Rename keeps to the session it was opened for, even if another one opens meanwhile.
const renameTarget = await Q.ev(`document.querySelector('#sessionSel').value`);
await Q.ev(`document.querySelector('#btnRename').click(); 'ok'`);
await Q.ev(`await (async () => { await desktopPanel.invoke('sessionNew', await desktopPanel.tab()); await refresh(); return 'ok'; })()`);
await sleep(300);
await Q.ev(`(() => { const i = document.querySelector('#renameInput'); i.value = 'Kept target'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return 'ok'; })()`);
await sleep(800);
const named = await Q.ev(`await (async () => (await desktopPanel.invoke('state', await desktopPanel.tab())).sessions.map(s => [s.id, s.name]))()`);
const renamedRight = named.some(([id, n]) => id === renameTarget && n === 'Kept target') && named.filter(([, n]) => n === 'Kept target').length === 1;
check('rename keeps to its session', renamedRight, JSON.stringify(named));
// (back to the renamed one, drop the empty new one)
const emptyOne = named.find(([id]) => id !== renameTarget && !/Kept target/.test(id))?.[0];
await Q.ev(`await (async () => { const tab = await desktopPanel.tab(); const st = await desktopPanel.invoke('state', tab); for (const s of st.sessions) if (s.count === 0) await desktopPanel.invoke('sessionDelete', s.id, tab); await desktopPanel.invoke('sessionOpen', ${JSON.stringify(renameTarget)}, tab); await refresh(); return 'ok'; })()`);
void emptyOne;

// A broken session file doesn't break the panel.
fs.writeFileSync(path.join(sdir(), 'zz0000000-abcdef.json'), '{}');
await Q.ev(`refresh().then(() => 'ok')`);
await sleep(500);
check('a broken session file is skipped', (await state()) === 'ok' && !(await options()).includes(undefined) && (await options()).length >= 1, JSON.stringify(await options()));
fs.rmSync(path.join(sdir(), 'zz0000000-abcdef.json'), { force: true });

// A profile that no longer exists: the choice is dropped, the line says so.
await P.ev(`(() => { const c = SillyTavern.getContext(); const cm = c.extensionSettings.connectionManager; cm.profiles = cm.profiles.filter(p => p.id !== 'desktop-test'); return 'ok'; })()`);
await Q.ev(`document.querySelector('#profileSel').dispatchEvent(new Event('focus')); 'ok'`);
await sleep(1500);
const gone = await Q.ev(`await (async () => ({ sel: document.querySelector('#profileSel').value, where: document.querySelector('#profileWhere').textContent, stored: (await desktopPanel.invoke('state', await desktopPanel.tab())).profileId }))()`);
check('a deleted profile is not used', gone.sel === '' && gone.stored === null && /current/i.test(gone.where), JSON.stringify(gone));
await P.ev(`(() => { const c = SillyTavern.getContext(); const cm = c.extensionSettings.connectionManager;
    cm.profiles.push({ id: 'desktop-test', name: 'Desktop test (fake model)', mode: 'cc', api: 'custom', model: 'fake-model', 'api-url': '${fake.url}', preset: 'Default' }); c.saveSettingsDebounced(); return 'ok'; })()`);

const count = await Q.ev(`document.querySelectorAll('#log .msg').length`);

// Server stopped and started again while the panel is open.
await a.launcher.ev(`await D.stopServer(); 'ok'`);
const st1 = await until(async () => (await state()) === 'server-stopped' && 'yes', 20000);
await a.launcher.ev(`await D.startServer(); 'ok'`);
const st2 = await until(async () => (await state()) === 'ok' && 'yes', 60000);
const profilesBack = await until(() => Q.ev(`[...document.querySelectorAll('#profileSel option')].some(o => o.value === 'desktop-test')`), 30000);
check('profiles load again after the server starts', !!profilesBack);
check('server stop and start keep the session', st1 === 'yes' && st2 === 'yes' && (await Q.ev(`document.querySelectorAll('#log .msg').length`)) === count, `${st1} ${st2} ${count}`);

// A read-only tab: not available there; back on the main tab, available again.
await a.main.ev(`(() => { const { Menu } = require('electron'); globalThis.__realBuild = Menu.buildFromTemplate; Menu.buildFromTemplate = t => { globalThis.__menu = t; return { popup() {} }; }; return 'ok'; })()`);
await bar.ev(`bar.action('new-menu'); 'ok'`);
await sleep(500);
await a.main.ev(`(() => { const it = globalThis.__menu.find(i => /^Read-only copy/.test(i.label || '')); require('electron').Menu.buildFromTemplate = globalThis.__realBuild; it.click(); return 'ok'; })()`);
const ro = await until(async () => (await state()) === 'other-tab' && 'yes', 15000);
const firstTab = await bar.ev(`document.querySelector('.tab')?.dataset.id`);
await bar.ev(`bar.action('tab-select', { id: ${firstTab} }); 'ok'`);
const back = await until(async () => (await state()) === 'ok' && 'yes', 15000);
check('read-only tab says not available, main tab back', ro === 'yes' && back === 'yes', `${ro} ${back}`);

// Another profile: its own sessions; back again: the old ones.
const before = await options();
await a.launcher.ev(`await D.stopServer(); 'ok'`);
await until(async () => (await a.launcher.ev(`(await D.getState()).running`)) === false, 15000);
await a.launcher.ev(`await D.profileUse('p2'); 'ok'`);
const other = await until(async () => { const o = await options(); return JSON.stringify(o) !== JSON.stringify(before) && o; }, 15000);
await a.launcher.ev(`await D.profileUse('p1'); 'ok'`);
const again = await until(async () => { const o = await options(); return JSON.stringify(o) === JSON.stringify(before) && o; }, 15000);
check('profile switch shows that folder\'s sessions, switching back brings them back', !!other && !!again, `${JSON.stringify(before)} → ${JSON.stringify(other)} → ${JSON.stringify(again)}`);

Q.close(); bar.close(); P.close();
await a.quit();
await fake.close();
finish();
