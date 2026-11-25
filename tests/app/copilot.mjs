// The co-pilot add-on (addons/copilot) in its side panel: sessions, the
// profile picker, a streamed conversation with a fake model, Stop, and the
// panel's states. Needs ST_CLONE (a throwaway SillyTavern; it gets a test
// Connection Profile) and ST_RUNS. Nothing reaches a real AI provider.
import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { launch, check, finish, sleep, RUNS, CLONE, ROOT, TEST_SETTINGS } from './lib.mjs';
import { start as fakeModel } from '../copilot/fake-model.mjs';
import { addProfile, addLorebook, openTestChat, skipWelcome } from '../copilot/clone-setup.mjs';

if (!CLONE) { console.log('Set ST_CLONE to a throwaway SillyTavern.'); process.exit(1); }
skipWelcome(CLONE);
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
await addProfile(P, fake.url);
await addLorebook(P);
await openTestChat(P); // the open chat gives a new session its context
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
// The co-pilot's reply format (addons/copilot/protocol.cjs).
const J = (say, extra = {}) => JSON.stringify({ say, ...extra });
const REPLY = 'Hello! I can help you with presets, cards and chats.';
fake.reply({ text: J(REPLY), chunks: 6, delayMs: 150 });
await send('Hi there');
const seen = new Set();
for (let i = 0; i < 40; i++) { seen.add(await lastText()); if (await Q.ev(`document.querySelector('#btnSend').dataset.mode === 'send'`)) break; await sleep(60); }
await idle();
check('send streams into the panel', seen.size >= 3 && (await lastText()) === REPLY, `${seen.size} texts, final ${JSON.stringify(await lastText())}`);
let sent = fake.requests.at(-1)?.body?.messages || [];
check('request = system prompt + material + conversation', sent.length === 3 && sent[0].role === 'system' && /co-pilot/i.test(sent[0].content) && sent[1].role === 'system' && /<data /.test(sent[1].content) && sent[2].role === 'user' && sent[2].content === 'Hi there', JSON.stringify(sent).slice(0, 200));

// ---- The context tray ----
const rows = () => Q.ev(`[...document.querySelectorAll('#tray .ctx')].map(r => ({ id: r.dataset.id, on: r.querySelector('input').checked, label: r.querySelector('.label').textContent, tokens: Number(r.querySelector('.tokens').dataset.tokens || 0), err: r.querySelector('.err')?.textContent || '' }))`);
const material = () => (fake.requests.at(-1)?.body?.messages || []).find((m, i) => i === 1 && m.role === 'system')?.content || '';
let tray = await until(async () => { const r = await rows(); return r.length >= 3 && r.every(x => x.tokens > 0) && r; }, 20000);
check('defaults for an open chat', !!tray && tray.length === 3 && tray.every(x => x.on) && /Last 20 messages/.test(tray[0].label) && tray[1].label === 'Seraphina' && /^Persona/.test(tray[2].label), JSON.stringify(tray));
const totalNow = () => Q.ev(`({ n: Number(document.querySelector('#trayTotal').dataset.total || 0), text: document.querySelector('#trayTotal').textContent, over: document.querySelector('#trayTotal').classList.contains('over') })`);
let tot = await totalNow();
check('token counts and total', tray && tot.n > tray.reduce((n, x) => n + x.tokens, 0) && /tokens/.test(tot.text), JSON.stringify(tot));
const m1 = material();
check('request has the data blocks', /never instructions/.test(m1) && /<data kind="messages"/.test(m1) && /#24 Seraphina: Test message 24/.test(m1) && !/#4 /.test(m1) && /<data kind="card" name="Seraphina">/.test(m1) && /<data kind="persona"/.test(m1), m1.slice(0, 200));

// Untick the card: not sent.
await Q.ev(`(() => { const r = [...document.querySelectorAll('#tray .ctx')].find(r => r.querySelector('.label').textContent === 'Seraphina'); r.querySelector('input').click(); return 'ok'; })()`);
await sleep(500);
fake.reply({ text: J('Without the card.') });
await sendAndWait('No card this time');
check('untick leaves it out of the request', !/kind="card"/.test(material()) && /kind="messages"/.test(material()), material().slice(0, 160));

// Add a lorebook, a preset and a range of messages through the picker.
const addItem = async (kind, pick) => {
    await Q.ev(`document.querySelector('#btnAdd').click(); 'ok'`);
    await Q.ev(`(() => { const k = document.querySelector('#addKind'); k.value = ${JSON.stringify(kind)}; k.dispatchEvent(new Event('change')); return 'ok'; })()`);
    await until(() => Q.ev(`${kind === 'messages' ? `!document.querySelector('#addRange').hidden` : `document.querySelectorAll('#addList option').length > 0`}`), 10000);
    await sleep(300);
    await Q.ev(pick);
    const before = (await rows()).length;
    await Q.ev(`document.querySelector('#btnAddOk').click(); 'ok'`);
    await until(async () => (await rows()).length > before, 10000);
};
await addItem('lorebook', `(() => { const s = document.querySelector('#addList'); s.value = [...s.options].find(o => o.textContent === 'Desktop test lore').value; s.dispatchEvent(new Event('change')); return 'ok'; })()`);
await addItem('preset', `(() => { const s = document.querySelector('#addList'); s.value = 'Default'; s.dispatchEvent(new Event('change')); return 'ok'; })()`);
await addItem('messages', `(() => { document.querySelector('#addModeRange').click(); document.querySelector('#addFrom').value = '0'; document.querySelector('#addTo').value = '2'; return 'ok'; })()`);
tray = await rows();
fake.reply({ text: J('With more.') });
await sendAndWait('Now with the lorebook');
const m2 = material();
check('add a lorebook and a preset', tray.some(x => x.label === 'Lorebook: Desktop test lore') && tray.some(x => x.label === 'Preset: Default') && /An old brass lantern/.test(m2) && /<data kind="preset" name="Default">/.test(m2) && /"identifier": "main"/.test(m2), JSON.stringify(tray.map(x => x.label)));
check('messages range', tray.some(x => x.label === 'Messages 0–2 of this chat') && /messages 0–2/.test(m2) && /#2 /.test(m2), m2.match(/<data kind="messages" name="[^"]*">/g)?.join(' '));

// Remove the range again.
await Q.ev(`(() => { const r = [...document.querySelectorAll('#tray .ctx')].find(r => r.querySelector('.label').textContent === 'Messages 0–2 of this chat'); r.querySelector('button.rm').click(); return 'ok'; })()`);
check('remove', !!(await until(async () => !(await rows()).some(x => /Messages 0–2/.test(x.label)) && 'yes', 10000)));

// "Show request" is exactly what goes out.
await Q.ev(`document.querySelector('#input').value = 'Preview check'; document.querySelector('#btnPreview').click(); 'ok'`);
const shown = await until(() => Q.ev(`!document.querySelector('#previewBox').hidden && document.querySelector('#previewText').textContent`), 10000);
await Q.ev(`document.querySelector('#btnPreviewClose').click(); 'ok'`);
fake.reply({ text: J('Previewed.') });
await sendAndWait('Preview check');
const out = (fake.requests.at(-1)?.body?.messages || []).map(m => `[${m.role}]\n${m.content}`).join('\n\n');
check('show request = what is sent', !!shown && shown === out, `${String(shown).length} vs ${out.length}`);

// A big card: the tray stays quick and warns when the request is too big.
await P.ev(`await (async () => {
    const c = SillyTavern.getContext();
    // made once; later runs use it again
    if (c.characters.some(x => x.avatar === 'Desktop big card.png')) return 'ok';
    const fd = new FormData();
    fd.append('ch_name', 'Desktop big card'); fd.append('description', ${JSON.stringify('The old tavern keeper tells long stories about the lantern. '.repeat(1300))});
    fd.append('first_mes', 'Hello.'); fd.append('personality', ''); fd.append('scenario', ''); fd.append('mes_example', ''); fd.append('creator_notes', ''); fd.append('system_prompt', ''); fd.append('post_history_instructions', ''); fd.append('tags', ''); fd.append('creator', ''); fd.append('character_version', ''); fd.append('talkativeness', '0.5'); fd.append('fav', 'false'); fd.append('world', ''); fd.append('depth_prompt_prompt', ''); fd.append('depth_prompt_depth', '4'); fd.append('depth_prompt_role', 'system'); fd.append('extensions', '{}');
    const h = c.getRequestHeaders(); delete h['Content-Type'];
    await fetch('/api/characters/create', { method: 'POST', headers: h, body: fd });
    await c.getCharacters();
    return 'ok';
})()`);
const t0 = Date.now();
await addItem('card', `(() => { const s = document.querySelector('#addList'); s.value = [...s.options].find(o => o.value === 'Desktop big card.png').value; s.dispatchEvent(new Event('change')); return 'ok'; })()`);
const big = await until(async () => (await rows()).find(x => x.label === 'Desktop big card' && x.tokens > 5000), 15000);
const ms = Date.now() - t0;
tot = await totalNow();
check('big card stays responsive', !!big && ms < 3000, `${ms} ms, ${big?.tokens} tokens`);
check('over the context size warns', tot.over && /over|too/i.test(tot.text), JSON.stringify(tot));
await Q.ev(`(() => { const r = [...document.querySelectorAll('#tray .ctx')].find(r => r.querySelector('.label').textContent === 'Desktop big card'); r.querySelector('button.rm').click(); return 'ok'; })()`);
await sleep(800);


// SHOT=<file.png>: a picture of the panel (test data only).
if (process.env.SHOT) { const r = await Q.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(process.env.SHOT, Buffer.from(r.result.data, 'base64')); }

// Stop mid-reply.
fake.reply({ text: J('x'.repeat(300)), chunks: 30, delayMs: 150 });
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
fake.reply({ text: J('Fine again.') });
await sendAndWait('Again');
sent = fake.requests.at(-1)?.body?.messages || [];
const roles = sent.map(m => m.role).join(',');
// (the stopped partial reply is sent as said; the failed one is not)
check('error shown on the message, not sent next time', /boom|500/.test(err) && roles.endsWith('assistant,user,user') && !sent.some(m => m.role === 'assistant' && m.content === ''), `${err} | ${roles}`);


// ---- The reply format: lookups, retries, questions, proposals ----
const lastReq = () => fake.requests.at(-1)?.body?.messages || [];
const steps = () => Q.ev(`[...document.querySelectorAll('#log .step')].map(s => s.textContent)`);

fake.reply({ text: J('Let me look.', { lookups: [{ tool: 'list_lorebooks' }] }) });
fake.reply({ text: J('There is one lorebook you made: Desktop test lore.') });
await sendAndWait('Which lorebooks do I have?');
let res = lastReq().at(-1)?.content || '';
check('a lookup runs and its result is sent back', (await steps()).some(t => /Listed lorebooks/.test(t)) && /<lookup_results>/.test(res) && /Desktop test lore/.test(res) && (await lastText()) === 'There is one lorebook you made: Desktop test lore.', `${JSON.stringify(await steps())} | ${res.slice(0, 120)}`);

fake.reply({ text: J('Checking.', { lookups: [{ tool: 'read_card', args: { avatar: 'nobody.png' } }] }) });
fake.reply({ text: J('That card does not exist.') });
await sendAndWait('Read the card nobody.png');
res = lastReq().at(-1)?.content || '';
check('a lookup error goes back to the model', /ERROR: No such character/.test(res) && (await steps()).some(t => /nobody\.png: No such character/.test(t)), res.slice(0, 160));

fake.reply({ text: 'Sure, the card looks fine to me.' });
fake.reply({ text: J('Valid now.') });
await sendAndWait('Is the card fine?');
res = lastReq().at(-1)?.content || '';
check('invalid then valid after one retry', (await lastText()) === 'Valid now.' && /couldn't be used/.test(res), `${await lastText()} | ${res.slice(0, 80)}`);

fake.reply({ text: '' });
fake.reply({ text: J('After an empty reply.') });
await sendAndWait('Say something');
const retryMsgs = lastReq();
check('an empty reply is retried with a placeholder', (await lastText()) === 'After an empty reply.' && retryMsgs.at(-2)?.role === 'assistant' && retryMsgs.at(-2)?.content === '(empty reply)', JSON.stringify(retryMsgs.slice(-2)).slice(0, 160));

fake.reply({ text: 'Still just prose.' });
fake.reply({ text: 'Prose again, no JSON.' });
await sendAndWait('Try once more');
const inv = await Q.ev(`(() => { const m = [...document.querySelectorAll('#log .msg[data-role=assistant]')].at(-1); return { invalid: m.classList.contains('invalid'), raw: m.querySelector('.raw pre')?.textContent || '', err: m.querySelector('.err')?.textContent || '' }; })()`);
check('invalid twice shows the raw text', inv.invalid && inv.raw === 'Prose again, no JSON.' && /couldn't produce a valid reply/.test(inv.err), JSON.stringify(inv));

fake.reply({ text: J('Which one do you mean?', { ask: { question: 'Which card?', choices: ['Seraphina', 'Desktop big card'] } }) });
await sendAndWait('Change the card');
const choices = await Q.ev(`[...document.querySelectorAll('#log .ask .choice')].filter(b => !b.disabled).map(b => b.textContent)`);
fake.reply({ text: J('Seraphina it is.') });
const nDone = await done();
await Q.ev(`[...document.querySelectorAll('#log .ask .choice')].find(b => b.textContent === 'Seraphina').click(); 'ok'`);
await until(async () => (await done()) > nDone && (await Q.ev(`document.querySelector('#btnSend').dataset.mode === 'send'`)), 20000);
check('ask with choices sends the pick', JSON.stringify(choices) === '["Seraphina","Desktop big card"]' && lastReq().at(-1)?.content === '(My answer to "Which card?": Seraphina)', `${JSON.stringify(choices)} | ${lastReq().at(-1)?.content}`);

const descBefore = await P.ev(`await (async () => { const c = SillyTavern.getContext(); const i = c.characters.findIndex(x => x.name === 'Seraphina'); await c.unshallowCharacter?.(i); return c.characters[i].data.description; })()`);
fake.reply({ text: J('I suggest one change.', { proposals: [{ op: 'edit_card', avatar: 'default_Seraphina.png', field: 'description', find: descBefore.slice(0, 30), replace: 'CHANGED TEXT', why: 'A test change.' }] }) });
await sendAndWait('Suggest a change to the description');
const prop = await Q.ev(`(() => { const p = [...document.querySelectorAll('#log .proposal')].at(-1); return p ? { target: p.querySelector('.target').textContent, add: p.querySelector('.add')?.textContent, apply: [...p.querySelectorAll('button')].some(b => b.textContent === 'Apply') } : null; })()`);
const descAfter = await P.ev(`SillyTavern.getContext().characters.find(x => x.name === 'Seraphina').data.description`);
check('proposals shown, nothing changed', prop?.target === 'Card default_Seraphina.png: description' && prop.add === 'CHANGED TEXT' && prop.apply && descAfter === descBefore, JSON.stringify(prop));

// ---- Applying and undoing (Batch 7) ----
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const cardPath = path.join(CLONE, 'data', 'default-user', 'characters', 'default_Seraphina.png');
const lorePath = path.join(CLONE, 'data', 'default-user', 'worlds', 'Desktop test lore.json');
const lastProp = () => Q.ev(`(() => { const c = [...document.querySelectorAll('#log .proposal')].at(-1); return c ? { cls: c.className, state: c.querySelector('.state')?.textContent || '', err: [...c.querySelectorAll('.err')].map(e => e.textContent).join(' '), buttons: [...c.querySelectorAll('button')].map(b => b.textContent), conflict: !!c.querySelector('.conflict'), del: c.querySelector('.del')?.textContent ?? null } : null; })()`);
const press = text => Q.ev(`(() => { const c = [...document.querySelectorAll('#log .proposal')].at(-1); const b = [...c.querySelectorAll('button')].find(b => b.textContent === ` + JSON.stringify(text) + `); if (!b) return 'no button'; b.click(); return 'ok'; })()`);
const waitProp = test => until(async () => { const p = await lastProp(); return p && test(p) && p; }, 25000);
const propose = async (proposal, say = 'Here is a change.') => { fake.reply({ text: J(say, { proposals: [proposal] }) }); await sendAndWait('Please do it'); };
const stCard = () => P.ev(`await (async () => { const c = SillyTavern.getContext(); const r = await fetch('/api/characters/get', { method: 'POST', headers: c.getRequestHeaders(), body: JSON.stringify({ avatar_url: 'default_Seraphina.png' }) }); return r.json(); })()`);
const stBook = () => P.ev(`await (async () => { const c = SillyTavern.getContext(); const r = await fetch('/api/worldinfo/get', { method: 'POST', headers: c.getRequestHeaders(), body: JSON.stringify({ name: 'Desktop test lore' }) }); return r.json(); })()`);

// The edit_card proposal shown above: apply it.
const h0 = sha(cardPath);
let res7 = await press('Apply');
let pr = await waitProp(x => /Applied|Not applied/.test(x.state));
let card7 = await stCard();
const formNow = await P.ev(`document.querySelector('#description_textarea').value`);
check('apply edit_card', res7 === 'ok' && pr?.state === 'Applied.' && card7.data.description.startsWith('CHANGED TEXT') && card7.description.startsWith('CHANGED TEXT') && formNow.startsWith('CHANGED TEXT') && sha(cardPath) !== h0, JSON.stringify(pr));
await press('Undo');
pr = await waitProp(x => /Undone/.test(x.state));
check('undo edit_card byte-identical', pr?.state === 'Undone.' && sha(cardPath) === h0, JSON.stringify(pr));

await propose({ op: 'edit_card', avatar: 'default_Seraphina.png', field: 'scenario', find: 'This text is not in the card', replace: 'x', why: 'Test.' });
await press('Apply');
pr = await waitProp(x => /Not applied/.test(x.state));
check('find no longer matches → failed, nothing written', /isn't there/.test(pr?.err || '') && sha(cardPath) === h0, JSON.stringify(pr));

const desc0 = (await stCard()).data.description;
await propose({ op: 'edit_card', avatar: 'default_Seraphina.png', field: 'description', set: 'Replaced description.', why: 'Test.' });
const shownDel = (await lastProp())?.del;
await press('Reject');
const rejected = await waitProp(x => /Rejected/.test(x.state));
check('the card shows the value it replaces; Reject writes nothing', !!desc0 && shownDel === desc0 && !!rejected && (await stCard()).data.description === desc0, JSON.stringify(shownDel).slice(0, 80));
const scen0 = (await stCard()).data.scenario;
await propose({ op: 'edit_card', avatar: 'default_Seraphina.png', field: 'scenario', set: 'Scenario from the co-pilot.', why: 'Test.' });
await press('Apply');
await waitProp(x => /Applied/.test(x.state));
await P.ev(`await (async () => { const c = SillyTavern.getContext(); await fetch('/api/characters/merge-attributes', { method: 'POST', headers: c.getRequestHeaders(), body: JSON.stringify({ avatar: 'default_Seraphina.png', scenario: 'Edited by hand.', data: { scenario: 'Edited by hand.' } }) }); return 'ok'; })()`);
await press('Undo');
pr = await waitProp(x => x.conflict);
const conflictSeen = !!pr?.conflict;
await press('Put back what it was before');
pr = await waitProp(x => /Undone/.test(x.state));
check('conflict after the user changed the item', conflictSeen && pr?.state === 'Undone.' && (await stCard()).data.scenario === scen0, JSON.stringify(pr));

// Lorebook, with the World Info editor showing it.
await P.ev(`await (async () => { const wi = await import('/scripts/world-info.js'); wi.reloadEditor('Desktop test lore', true); await new Promise(r => setTimeout(r, 1500)); return 'ok'; })()`);
const l0 = sha(lorePath);
await propose({ op: 'edit_lorebook_entry', book: 'Desktop test lore', uid: 0, field: 'content', set: 'Lantern text from the co-pilot.', why: 'Test.' });
await press('Apply');
pr = await waitProp(x => /Applied|Not applied/.test(x.state));
const cached = await P.ev(`await (async () => { const wi = await import('/scripts/world-info.js'); return (await wi.loadWorldInfo('Desktop test lore')).entries['0'].content; })()`);
const editEntryOk = pr?.state === 'Applied.' && (await stBook()).entries['0'].content === 'Lantern text from the co-pilot.' && cached === 'Lantern text from the co-pilot.';
await press('Undo');
pr = await waitProp(x => /Undone/.test(x.state));
check('lorebook entry edit and undo with the editor open', editEntryOk && pr?.state === 'Undone.' && sha(lorePath) === l0, JSON.stringify(pr));

await propose({ op: 'add_lorebook_entry', book: 'Desktop test lore', entry: { keys: ['harbour'], content: 'Harbour entry from the co-pilot.', comment: 'Harbour' }, why: 'Test.' });
await press('Apply');
await waitProp(x => /Applied|Not applied/.test(x.state));
const addedOk = Object.values((await stBook()).entries).some(e => e.content === 'Harbour entry from the co-pilot.' && e.key[0] === 'harbour');
await press('Undo');
await waitProp(x => /Undone/.test(x.state));
const addUndone = !Object.values((await stBook()).entries).some(e => e.content === 'Harbour entry from the co-pilot.');
await propose({ op: 'delete_lorebook_entry', book: 'Desktop test lore', uid: 1, why: 'Test.' });
const delButtons = (await lastProp())?.buttons || [];
await press('Delete');
await waitProp(x => /Applied|Not applied/.test(x.state));
const deletedOk = !('1' in (await stBook()).entries);
await press('Undo');
await waitProp(x => /Undone/.test(x.state));
// (the editor's pending save goes out before each change, so "as it was" means the journal's copy from just before the delete)
const journalDir = path.join(DATA, 'extensions', ID, 'user', 'changes');
const delEntry = fs.readdirSync(journalDir).filter(d => d !== 'blobs').map(d => { try { return JSON.parse(fs.readFileSync(path.join(journalDir, d, 'entry.json'), 'utf8')); } catch { return null; } }).filter(e => e && e.kind === 'lorebook-entry-delete').sort((a, b) => b.at - a.at)[0];
check('lorebook entry add and delete, and their undo', addedOk && addUndone && delButtons.includes('Delete') && deletedOk && (await stBook()).entries['1']?.content === 'The cellar door is always locked.' && sha(lorePath) === delEntry?.files[0].sha256, JSON.stringify({ addedOk, addUndone, delButtons, deletedOk, sameAsBefore: sha(lorePath) === delEntry?.files[0].sha256 }));

await propose({ op: 'create_card', name: 'Desktop co-pilot card', fields: { description: 'Made by the co-pilot.', first_mes: 'Hello from a test.' }, why: 'Test.' });
await press('Apply');
pr = await waitProp(x => /Applied|Not applied/.test(x.state));
const hasCard = async () => P.ev(`SillyTavern.getContext().characters.some(c => c.avatar === 'Desktop co-pilot card.png')`);
const cardMade = pr?.state === 'Applied.' && await hasCard();
await press('Undo');
await waitProp(x => /Undone/.test(x.state));
check('create_card and undo', cardMade && !(await hasCard()) && !fs.existsSync(path.join(CLONE, 'data', 'default-user', 'characters', 'Desktop co-pilot card.png')), JSON.stringify(pr));

await propose({ op: 'create_lorebook', name: 'Desktop co-pilot lore', why: 'Test.' });
await press('Apply');
pr = await waitProp(x => /Applied|Not applied/.test(x.state));
const hasBook = async () => P.ev(`SillyTavern.getContext().getWorldInfoNames().includes('Desktop co-pilot lore')`);
const bookMade = pr?.state === 'Applied.' && await hasBook();
await press('Undo');
await waitProp(x => /Undone/.test(x.state));
check('create_lorebook and undo', bookMade && !(await hasBook()), JSON.stringify(pr));

fake.reply({ text: J('Noted.') });
await sendAndWait('What did I do with your changes?');
const note7 = lastReq().map(m => m.content).join('\n');
check('outcome sent to the model next turn', /What happened to your proposals/.test(note7) && /applied, then undone/.test(note7) && /failed: Can't apply/.test(note7), note7.slice(-300));

// ---- The open chat (Batch 8) ----
const chatId8 = await P.ev(`SillyTavern.getContext().getCurrentChatId()`);
const chatPath = path.join(CLONE, 'data', 'default-user', 'chats', 'default_Seraphina', `${chatId8}.jsonl`);
const chatLines = () => fs.readFileSync(chatPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const c0 = sha(chatPath);
const text4 = chatLines()[5].mes;
await propose({ op: 'edit_message', index: 4, set: 'Edited by the co-pilot test.', why: 'Test.' });
const shown8 = (await lastProp())?.del;
await press('Apply');
pr = await waitProp(x => /Applied|Not applied/.test(x.state));
const onScreen = await P.ev(`document.querySelector('#chat .mes[mesid="4"] .mes_text')?.textContent || ''`);
const edited8 = pr?.state === 'Applied.' && chatLines()[5].mes === 'Edited by the co-pilot test.' && onScreen.includes('Edited by the co-pilot test.');
await press('Undo');
pr = await waitProp(x => /Undone|Not/.test(x.state) || x.err);
check('edit a message of the open chat; Undo byte for byte', shown8 === text4 && edited8 && pr?.state === 'Undone.' && sha(chatPath) === c0, JSON.stringify({ shown8, edited8, pr }));

// The user keeps chatting between Apply and Undo (messages added the way SillyTavern adds them; Enter is never pressed).
const userChats = text => P.ev(`await (async () => { const c = SillyTavern.getContext(); const m = { name: c.name1, is_user: true, is_system: false, send_date: new Date().toISOString(), mes: ${JSON.stringify('__T__')}.replace('__T__', ${JSON.stringify(text)}), extra: {} }; c.chat.push(m); c.addOneMessage(m); await c.saveChat(); return c.chat.length; })()`);
await propose({ op: 'edit_message', index: 6, set: 'Second co-pilot edit.', why: 'Test.' });
await press('Apply');
await waitProp(x => /Applied|Not applied/.test(x.state));
const text6 = chatLines()[7].mes;
await userChats('A message typed after the co-pilot edit.');
await userChats('And another one.');
await press('Undo');
pr = await waitProp(x => /Undone|Not/.test(x.state) || x.err || x.conflict);
const l8 = chatLines();
check('the user chats in between: Undo restores only that message', text6 === 'Second co-pilot edit.' && pr?.state === 'Undone.' && l8[7].mes !== 'Second co-pilot edit.' && l8.at(-1).mes === 'And another one.' && l8.at(-2).mes === 'A message typed after the co-pilot edit.', JSON.stringify({ text6, pr, last: l8.at(-1).mes }));

// A message editor open in SillyTavern: nothing is written.
await P.ev(`(document.querySelector('#chat .mes[mesid="2"] .mes_edit')?.click(), 'ok')`);
await until(() => P.ev(`!!document.querySelector('#chat .edit_textarea')`), 5000);
const c1 = sha(chatPath);
await propose({ op: 'edit_message', index: 3, set: 'Not while editing.', why: 'Test.' });
await press('Apply');
pr = await waitProp(x => /Applied|Not applied/.test(x.state));
await P.ev(`(document.querySelector('#chat .mes[mesid="2"] .mes_edit_cancel')?.click(), 'ok')`);
await until(() => P.ev(`!document.querySelector('#chat .edit_textarea')`), 5000);
check('refused while the user edits a message', /being edited/.test(pr?.err || '') && sha(chatPath) === c1, JSON.stringify(pr));
await press('Reject');

await propose({ op: 'delete_messages', indexes: [2, 3], why: 'Test.' });
const delCard = (await lastProp())?.buttons || [];
await press('Delete');
pr = await waitProp(x => /Applied|Not applied/.test(x.state));
const afterDel = chatLines().length;
await press('Undo');
await waitProp(x => /Undone|Not/.test(x.state) || x.err);
check('delete two messages; Undo puts them back byte for byte', delCard.includes('Delete') && pr?.state === 'Applied.' && afterDel === l8.length - 2 && sha(chatPath) === c1, JSON.stringify({ delCard, pr, afterDel }));

await propose({ op: 'hide_messages', indexes: [5], why: 'Test.' });
await press('Apply');
pr = await waitProp(x => /Applied|Not applied/.test(x.state));
const hidden = chatLines()[6].is_system === true && await P.ev(`document.querySelector('#chat .mes[mesid="5"]')?.getAttribute('is_system')`) === 'true';
await press('Undo');
await waitProp(x => /Undone|Not/.test(x.state) || x.err);
check('hide a message; Undo', pr?.state === 'Applied.' && hidden && sha(chatPath) === c1, JSON.stringify({ pr, hidden }));

await propose({ op: 'add_message', after: 1, isUser: false, text: 'A line added by the co-pilot.', why: 'Test.' });
await press('Apply');
pr = await waitProp(x => /Applied|Not applied/.test(x.state));
const added8 = chatLines()[3]?.mes === 'A line added by the co-pilot.' && chatLines()[3].name === 'Seraphina';
await press('Undo');
const u8 = await waitProp(x => /Undone|Not/.test(x.state) || x.err || x.conflict);
check('add a message in the middle; Undo takes it out', pr?.state === 'Applied.' && added8 && sha(chatPath) === c1, JSON.stringify({ pr, added8, u8 }));

// ---- Personas (Batch 8) ----
const setPath = path.join(CLONE, 'data', 'default-user', 'settings.json');
const puNow = () => JSON.parse(fs.readFileSync(setPath, 'utf8')).power_user;
const inUse8 = await P.ev(`(await import('/scripts/personas.js')).user_avatar`);
const pdesc0 = String(puNow().persona_descriptions?.[inUse8]?.description ?? '');
await propose({ op: 'edit_persona', avatar: null, set: 'Persona text from the co-pilot test.', why: 'Test.' });
const target8 = (await Q.ev(`[...document.querySelectorAll('#log .proposal')].at(-1)?.querySelector('.target')?.textContent || ''`));
await press('Apply');
pr = await waitProp(x => /Applied|Not applied/.test(x.state));
const personaBox = await P.ev(`document.querySelector('#persona_description')?.value`);
const personaSet = pr?.state === 'Applied.' && puNow().persona_descriptions[inUse8].description === 'Persona text from the co-pilot test.' && personaBox === 'Persona text from the co-pilot test.';
await press('Undo');
pr = await waitProp(x => /Undone|Not/.test(x.state) || x.err);
check('edit the persona in use; Undo puts the description back', target8.includes(inUse8) && personaSet && pr?.state === 'Undone.' && String(puNow().persona_descriptions[inUse8].description ?? '') === pdesc0, JSON.stringify({ target8, personaSet, pr }));

await propose({ op: 'create_persona', name: 'Desktop co-pilot persona', description: 'Made by the co-pilot test.', why: 'Test.' });
await press('Apply');
pr = await waitProp(x => /Applied|Not applied/.test(x.state));
const madeId = Object.keys(puNow().personas).find(k => puNow().personas[k] === 'Desktop co-pilot persona');
const madePic = madeId && fs.existsSync(path.join(CLONE, 'data', 'default-user', 'User Avatars', madeId));
await press('Undo');
await waitProp(x => /Undone|Not/.test(x.state) || x.err);
check('create a persona (own picture, not switched to); Undo removes it', pr?.state === 'Applied.' && !!madeId && madePic && !Object.values(puNow().personas).includes('Desktop co-pilot persona') && !fs.existsSync(path.join(CLONE, 'data', 'default-user', 'User Avatars', madeId)) && await P.ev(`(await import('/scripts/personas.js')).user_avatar`) === inUse8, JSON.stringify({ pr, madeId, madePic }));

// ---- Chat completion presets (Batch 8) ----
const presetDir = path.join(CLONE, 'data', 'default-user', 'OpenAI Settings');
const pfile = n => path.join(presetDir, `${n}.json`);
const pread = n => JSON.parse(fs.readFileSync(pfile(n), 'utf8'));
const TP = 'Desktop test preset';
const selectedNow = () => P.ev(`(await import('/scripts/openai.js')).oai_settings.preset_settings_openai`);
const selectPreset = async n => { await P.ev(`await (async () => { const pm = SillyTavern.getContext().getPresetManager('openai'); await pm.selectPreset(pm.findPreset(${JSON.stringify(n)})); return 'ok'; })()`); await until(async () => (await selectedNow()) === n, 10000); await sleep(1000); };
const orig = await selectedNow();
await propose({ op: 'create_preset', name: TP, from: orig, why: 'Test.' });
await press('Apply');
pr = await waitProp(x => /Applied|Not applied/.test(x.state));
const createChange = pr;
const listedPreset = await P.ev(`Object.hasOwn((await import('/scripts/openai.js')).openai_setting_names, ${JSON.stringify(TP)})`);
check('create a preset: a copy, listed in SillyTavern, not selected', pr?.state === 'Applied.' && fs.existsSync(pfile(TP)) && JSON.stringify(pread(TP)) === JSON.stringify(pread(orig)) && listedPreset && (await selectedNow()) === orig, JSON.stringify({ pr, listedPreset }));
const createCardIdx = await Q.ev(`[...document.querySelectorAll('#log .proposal')].length - 1`);
const tp0 = sha(pfile(TP));

await propose({ op: 'edit_preset_setting', name: TP, key: 'temperature', value: 1.3, why: 'Test.' });
await press('Apply');
pr = await waitProp(x => /Applied|Not applied/.test(x.state));
const memTemp = await P.ev(`await import('/scripts/openai.js').then(O => O.openai_settings[O.openai_setting_names[${JSON.stringify(TP)}]].temperature)`);
const setOk = pr?.state === 'Applied.' && pread(TP).temperature === 1.3 && memTemp === 1.3;
await press('Undo');
pr = await waitProp(x => /Undone|Not/.test(x.state) || x.err || x.conflict);
check('a setting of a preset that is not selected; Undo byte for byte', setOk && pr?.state === 'Undone.' && sha(pfile(TP)) === tp0, JSON.stringify({ setOk, memTemp, pr }));

await propose({ op: 'edit_preset_setting', name: TP, key: 'reverse_proxy', value: 'http://example.invalid', why: 'Test.' });
await press('Apply');
pr = await waitProp(x => /Applied|Not applied/.test(x.state));
check('a connection setting is refused', /can change/.test(pr?.err || '') && sha(pfile(TP)) === tp0, JSON.stringify(pr));
await press('Reject');

await propose({ op: 'add_preset_prompt', name: TP, prompt: { identifier: 'desktopTest', name: 'Desktop test prompt', content: 'Added by the co-pilot test.' }, why: 'Test.' });
await press('Apply');
pr = await waitProp(x => /Applied|Not applied/.test(x.state));
const ord = pread(TP).prompt_order.find(e => String(e.character_id) === '100001');
const addOk = pr?.state === 'Applied.' && pread(TP).prompts.some(x => x.identifier === 'desktopTest') && ord?.order.at(-1)?.identifier === 'desktopTest';
await press('Undo');
pr = await waitProp(x => /Undone|Not/.test(x.state) || x.err || x.conflict);
check('add a prompt to the order Chat Completion uses; Undo', addOk && pr?.state === 'Undone.' && sha(pfile(TP)) === tp0, JSON.stringify({ addOk, pr }));

// The selected preset: SillyTavern's controls and working copy follow; an unsaved edit there is kept.
await selectPreset(TP);
await propose({ op: 'edit_preset_setting', name: TP, key: 'temperature', value: 0.55, why: 'Test.' });
await press('Apply');
pr = await waitProp(x => /Applied|Not applied/.test(x.state));
const ui = await P.ev(`await (async () => { const O = await import('/scripts/openai.js'); return { control: document.querySelector('#temp_openai')?.value, working: O.oai_settings.temp_openai }; })()`);
const selOk = pr?.state === 'Applied.' && pread(TP).temperature === 0.55 && Number(ui.control) === 0.55 && ui.working === 0.55;
await press('Undo');
pr = await waitProp(x => /Undone|Not/.test(x.state) || x.err || x.conflict);
const ui2 = await P.ev(`await (async () => { const O = await import('/scripts/openai.js'); return O.oai_settings.temp_openai; })()`);
check('a setting of the selected preset: the control and working copy follow; Undo', selOk && pr?.state === 'Undone.' && sha(pfile(TP)) === tp0 && ui2 === pread(TP).temperature, JSON.stringify({ selOk, ui, pr, ui2 }));
const savedTemp = pread(TP).temperature;
await P.ev(`(window.$('#temp_openai').val(1.75).trigger('input'), 'ok')`);
await propose({ op: 'edit_preset_setting', name: TP, key: 'temperature', value: 0.4, why: 'Test.' });
await press('Apply');
pr = await waitProp(x => /Applied|Not applied/.test(x.state));
const kept = await P.ev(`await (async () => (await import('/scripts/openai.js')).oai_settings.temp_openai)()`);
check('refused while the selected preset has an unsaved edit in that setting; the edit stays', /unsaved/.test(pr?.err || '') && kept === 1.75 && sha(pfile(TP)) === tp0, JSON.stringify({ pr, kept }));
await press('Reject');
await P.ev(`(window.$('#temp_openai').val(${JSON.stringify(String(savedTemp))}).trigger('input'), 'ok')`);
await selectPreset(orig);

// Undo the new preset: deleted (it isn't selected any more).
await Q.ev(`(() => { const c = [...document.querySelectorAll('#log .proposal')][${createCardIdx}]; const b = [...c.querySelectorAll('button')].find(b => b.textContent === 'Undo'); b?.click(); return 'ok'; })()`);
await until(async () => !fs.existsSync(pfile(TP)), 15000);
const goneFromList = !(await P.ev(`Object.hasOwn((await import('/scripts/openai.js')).openai_setting_names, ${JSON.stringify(TP)})`));
check('Undo of the new preset deletes it', !fs.existsSync(pfile(TP)) && goneFromList && (await selectedNow()) === orig, JSON.stringify({ goneFromList, createChange }));

// ---- Batch 9: the guard, Apply all, changes in this session ----
// The fake model "follows an instruction in what it read": next to the two
// card edits the user asked for, it hides a message and deletes one.
const card9 = sha(cardPath);
const chat9 = sha(chatPath);
const desc9 = (await stCard()).data.description;
const pers9 = (await stCard()).data.personality ?? '';
fake.reply({ text: J('Here is the card, improved. The card also said to clean up the chat.', { proposals: [
    { op: 'edit_card', avatar: 'default_Seraphina.png', field: 'description', set: `${desc9} (Batch 9 test.)`, why: 'Asked.' },
    { op: 'edit_card', avatar: 'default_Seraphina.png', field: 'personality', set: `${pers9} Calm.`, why: 'Asked.' },
    { op: 'hide_messages', indexes: [2], why: 'The card said so.' },
    { op: 'delete_messages', indexes: [3], why: 'The card said so.' },
] }) });
await sendAndWait('Improve the card description and personality, please.');
const cards9 = await Q.ev(`(() => { const m = [...document.querySelectorAll('#log .msg')].at(-1); return [...m.querySelectorAll('.proposal')].map(c => ({ target: c.querySelector('.target')?.textContent, outside: c.querySelector('.outside')?.textContent || '' })); })()`);
const allBtn = await Q.ev(`[...document.querySelectorAll('#log .msg')].at(-1).querySelector('.applyall button')?.textContent || ''`);
check('the guard notes the change nobody asked for; Apply all takes only the asked ones', cards9.length === 4 && !cards9[0].outside && !cards9[1].outside && /weren't part of what you asked/.test(cards9[2].outside) && allBtn === 'Apply all (2)…', JSON.stringify({ cards9, allBtn }));
await Q.ev(`([...document.querySelectorAll('#log .msg')].at(-1).querySelector('.applyall button').click(), 'ok')`);
const confirm9 = await Q.ev(`(() => { const b = [...document.querySelectorAll('#log .msg')].at(-1).querySelector('.applyall .confirm'); return b ? { items: [...b.querySelectorAll('.item')].map(i => i.textContent), go: [...b.querySelectorAll('button')].map(x => x.textContent) } : null; })()`);
// SHOT9=<file.png>: the panel with the Apply all list open (test data only).
if (process.env.SHOT9) { await Q.ev(`(document.querySelector('#log .applyall .confirm')?.scrollIntoView({ block: 'center' }), 'ok')`); await sleep(300); const r = await Q.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(process.env.SHOT9, Buffer.from(r.result.data, 'base64')); }
await Q.ev(`([...[...document.querySelectorAll('#log .msg')].at(-1).querySelectorAll('.applyall .confirm button')].find(b => /^Apply these/.test(b.textContent)).click(), 'ok')`);
const applied9 = await until(async () => { const s = await Q.ev(`[...[...document.querySelectorAll('#log .msg')].at(-1).querySelectorAll('.proposal .state')].map(x => x.textContent)`); return s.filter(x => x === 'Applied.').length === 2 && s; }, 20000);
const c9 = await stCard();
check('Apply all lists them and what is left out, applies the two, leaves the chat alone', confirm9?.items.length === 4 && confirm9.items.filter(t => /not part of what you asked|a delete/.test(t)).length === 2 && !!applied9 && c9.data.description.endsWith('(Batch 9 test.)') && c9.data.personality.endsWith('Calm.') && sha(chatPath) === chat9, JSON.stringify({ confirm9, applied9 }));
// The main part refuses them too, whatever the panel sends.
const ids9 = await Q.ev(`[...[...document.querySelectorAll('#log .msg')].at(-1).querySelectorAll('.proposal')].map(c => c.dataset.id)`);
const forced9 = await Q.ev(`await (async () => JSON.stringify(await window.desktopPanel.invoke('applyAll', ${JSON.stringify(ids9.slice(2))})))()`);
const still9 = await Q.ev(`[...[...document.querySelectorAll('#log .msg')].at(-1).querySelectorAll('.proposal')].slice(2).map(c => c.querySelector('.state')?.textContent || 'open')`);
check('Apply all in the main part skips a delete and a change nobody asked for, even when sent', /a delete needs its own click/.test(forced9) && /not part of what you asked/.test(forced9) && JSON.stringify(still9) === '["open","open"]' && sha(chatPath) === chat9, JSON.stringify({ forced9, still9 }));

// Changes in this session: the two, then Undo everything.
await Q.ev(`(document.querySelector('#btnChanges').click(), 'ok')`);
await sleep(500);
const rows9 = await Q.ev(`[...document.querySelectorAll('#changesList .change')].map(r => r.querySelector('.label').textContent)`);
const keep9 = await Q.ev(`({ days: document.querySelector('#keepDays').value, keep: document.querySelector('#keepCount').value, size: document.querySelector('#keepSize').textContent })`);
await Q.ev(`(document.querySelector('#btnUndoAll').click(), 'ok')`);
await Q.ev(`(document.querySelector('#btnUndoAllYes').click(), 'ok')`);
const undone9 = await until(async () => (await Q.ev(`[...document.querySelectorAll('#changesList .change')].slice(0, 2).every(r => r.classList.contains('undone'))`)) && 'yes', 20000);
check('the Changes view lists the session\'s changes, keeps backups 30 days / 200 changes, and Undo everything puts the card back byte for byte', rows9.length >= 2 && rows9[0].includes('personality') && keep9.days === '30' && keep9.keep === '200' && /MB/.test(keep9.size) && undone9 === 'yes' && sha(cardPath) === card9, JSON.stringify({ rows9, keep9, undone9 }));
await Q.ev(`(document.querySelector('#keepDays').value = '7', document.querySelector('#keepCount').value = '50', document.querySelector('#btnKeepSave').click(), 'ok')`);
await sleep(500);
const kept9 = await Q.ev(`await (async () => JSON.stringify(await window.desktopPanel.invoke('backups')))()`).catch(e => String(e));
await Q.ev(`(document.querySelector('#keepDays').value = '0', document.querySelector('#btnKeepSave').click(), 'ok')`);
await sleep(500);
const refused9 = await Q.ev(`document.querySelector('#keepSize').textContent`);
await Q.ev(`(document.querySelector('#keepDays').value = '30', document.querySelector('#keepCount').value = '200', document.querySelector('#btnKeepSave').click(), document.querySelector('#btnChangesClose').click(), 'ok')`);
check('how long backups are kept is saved, and nonsense refused', /"days":7/.test(kept9) && /"keep":50/.test(kept9) && /1 to 3650 days/.test(refused9), JSON.stringify({ kept9, refused9 }));

// The same tray item twice is refused; what a lookup read can be shown.
// (the first add must work: a refusal of everything would pass a one-sided check)
const dup9 = await Q.ev(`await (async () => {
    const spec = { kind: 'messages', from: 1, to: 2 };
    let first;
    try { first = await window.desktopPanel.invoke('contextAdd', spec); } catch (e) { return 'first add failed: ' + (e.message || e); }
    let second = 'added twice';
    try { await window.desktopPanel.invoke('contextAdd', spec); } catch (e) { second = String(e.message || e); }
    await window.desktopPanel.invoke('contextRemove', first.id);
    return second;
})()`);
fake.reply({ text: J('Looking.', { lookups: [{ tool: 'list_presets' }] }) });
fake.reply({ text: J('There is one preset.') });
await sendAndWait('Which presets do I have?');
const read9 = await Q.ev(`(() => { const d = [...document.querySelectorAll('#log .step details.read')].at(-1); return d ? d.querySelector('pre').textContent : ''; })()`);
check('the same tray item twice is refused; a lookup line shows what it read', /in the list already/.test(dup9) && /lookup_results/.test(read9) && /presets/.test(read9), JSON.stringify({ dup9, read9: read9.slice(0, 80) }));

// Two changes to the same field in one reply: Apply all takes the first only.
const scen9 = (await stCard()).data.scenario ?? '';
fake.reply({ text: J('Two ideas for the scenario, and a tag.', { proposals: [
    { op: 'edit_card', avatar: 'default_Seraphina.png', field: 'scenario', set: 'Scenario idea one.', why: 'Asked.' },
    { op: 'edit_card', avatar: 'default_Seraphina.png', field: 'scenario', set: 'Scenario idea two.', why: 'Asked.' },
    { op: 'edit_card', avatar: 'default_Seraphina.png', field: 'tags', set: ['b9-test'], why: 'Asked.' },
] }) });
await sendAndWait('Improve the card scenario and tags.');
const same9 = await Q.ev(`[...document.querySelectorAll('#log .msg')].at(-1).querySelector('.applyall button')?.textContent || ''`);
await Q.ev(`([...document.querySelectorAll('#log .msg')].at(-1).querySelector('.applyall button').click(), 'ok')`);
const left9 = await Q.ev(`[...[...document.querySelectorAll('#log .msg')].at(-1).querySelectorAll('.applyall .confirm .item.left')].map(i => i.textContent)`);
await Q.ev(`([...[...document.querySelectorAll('#log .msg')].at(-1).querySelectorAll('.applyall .confirm button')].find(b => /^Apply these/.test(b.textContent)).click(), 'ok')`);
const done9 = await until(async () => { const s = await Q.ev(`[...[...document.querySelectorAll('#log .msg')].at(-1).querySelectorAll('.proposal')].map(c => c.querySelector('.state')?.textContent || 'open')`); return s.filter(x => x === 'Applied.').length === 2 && s; }, 20000);
check('two changes to the same thing: Apply all takes the first and says why for the second', same9 === 'Apply all (2)…' && left9.length === 1 && /same thing/.test(left9[0]) && JSON.stringify(done9) === '["Applied.","open","Applied."]' && (await stCard()).data.scenario === 'Scenario idea one.', JSON.stringify({ same9, left9, done9 }));

// "Keep it as it is now": that change is decided, and Undo everything passes over it.
await P.ev(`await (async () => { const c = SillyTavern.getContext(); await fetch('/api/characters/merge-attributes', { method: 'POST', headers: c.getRequestHeaders(), body: JSON.stringify({ avatar: 'default_Seraphina.png', scenario: 'Edited by hand after the co-pilot.', data: { scenario: 'Edited by hand after the co-pilot.' } }) }); return 'ok'; })()`);
const firstId = await Q.ev(`[...[...document.querySelectorAll('#log .msg')].at(-1).querySelectorAll('.proposal')][0].dataset.id`);
await Q.ev(`([...document.querySelector('#log .proposal[data-id="${firstId}"]').querySelectorAll('button')].find(b => b.textContent === 'Undo').click(), 'ok')`);
await until(() => Q.ev(`!!document.querySelector('#log .proposal[data-id="${firstId}"] .conflict')`), 20000);
await Q.ev(`([...document.querySelector('#log .proposal[data-id="${firstId}"] .conflict').querySelectorAll('button')].find(b => /^Keep it/.test(b.textContent)).click(), 'ok')`);
const kept9b = await until(async () => (await Q.ev(`document.querySelector('#log .proposal[data-id="${firstId}"] .state')?.textContent || ''`)) === 'Applied, kept as it is now.' && 'yes', 20000);
const undoAll9 = await Q.ev(`await (async () => JSON.stringify(await window.desktopPanel.invoke('undoAll')))()`);
const after9 = await stCard();
check('a change kept as it is now is passed over by Undo everything; the rest is undone', kept9b === 'yes' && /"stopped":null/.test(undoAll9) && after9.data.scenario === 'Edited by hand after the co-pilot.' && JSON.stringify(after9.data.tags) !== '["b9-test"]', JSON.stringify({ kept9b, undoAll9, scen: after9.data.scenario, tags: after9.data.tags }));
await P.ev(`await (async () => { const c = SillyTavern.getContext(); await fetch('/api/characters/merge-attributes', { method: 'POST', headers: c.getRequestHeaders(), body: JSON.stringify({ avatar: 'default_Seraphina.png', scenario: ${JSON.stringify(scen9)}, data: { scenario: ${JSON.stringify(scen9)} } }) }); return 'ok'; })()`);


const before6 = fake.requests.length;
for (let i = 0; i < 6; i++) fake.reply({ text: J(`Step ${i}.`, { lookups: [{ tool: 'list_presets' }] }) });
await sendAndWait('Keep looking');
const note = await Q.ev(`[...document.querySelectorAll('#log .msg .note')].at(-1)?.textContent || ''`);
check('step limit', fake.requests.length - before6 === 6 && /Stopped after 6 steps/.test(note), `${fake.requests.length - before6} requests | ${note}`);

fake.reply({ text: J('Looking.', { lookups: [{ tool: 'list_characters' }] }) });
fake.reply({ text: J('y'.repeat(400)), chunks: 40, delayMs: 150 });
await send('Look and then talk a lot');
await until(async () => (await steps()).length > 0 && (await lastText()).length > 10, 15000);
await Q.ev(`document.querySelector('#btnSend').click(); 'ok'`);
await idle();
const st6 = await Q.ev(`(() => { const m = [...document.querySelectorAll('#log .msg[data-role=assistant]')].at(-1); return { stopped: m.classList.contains('stopped'), len: m.querySelector('.text').textContent.length }; })()`);
check('stop after a lookup', st6.stopped && st6.len < 400, JSON.stringify(st6));

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
fake.reply({ text: J('A full answer that keeps going for a while.'), chunks: 8, delayMs: 150 });
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
fake.reply({ text: J('This reply will not save.'), chunks: 4, delayMs: 200 });
await send('Save test');
await sleep(300);
fs.mkdirSync(path.join(sdir(), `${curId}.json.tmp`), { recursive: true }); // the save's temp file can't be written now
await sleep(2500);
const stuck = await Q.ev(`({ mode: document.querySelector('#btnSend').dataset.mode, err: [...document.querySelectorAll('#log .err')].at(-1)?.textContent || '' })`);
fs.rmSync(path.join(sdir(), `${curId}.json.tmp`), { recursive: true, force: true });
fake.reply({ text: J('Saved fine.') });
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

// Two refreshes at once with no session: one session is made, not two.
const twice = await Q.ev(`await (async () => {
    const tab = await desktopPanel.tab();
    const st = await desktopPanel.invoke('state', tab);
    for (const x of st.sessions) await desktopPanel.invoke('sessionDelete', x.id, tab);
    const [a, b] = await Promise.all([desktopPanel.invoke('state', tab), desktopPanel.invoke('state', tab)]);
    return { a: a.sessions.length, b: b.sessions.length, same: a.current?.id === b.current?.id };
})()`);
await Q.ev(`refresh().then(() => 'ok')`);
check('two refreshes at once make one session', twice.a === 1 && twice.b === 1 && twice.same, JSON.stringify(twice));
// (named, so the profile switch below can tell the folders' lists apart)
await Q.ev(`await (async () => { const tab = await desktopPanel.tab(); const st = await desktopPanel.invoke('state', tab); await desktopPanel.invoke('sessionRename', st.current.id, 'After the double refresh', tab); await refresh(); return 'ok'; })()`);

// A 5,000-message chat: the tray stays quick, and a second look is cached.
await P.ev(`await (async () => { const c = SillyTavern.getContext();
    for (let n = c.chat.length; n < 5000; n++) c.chat.push({ name: n % 2 ? c.name1 : c.name2, is_user: n % 2 === 1, is_system: false, send_date: Date.now(), mes: 'Long chat line ' + n + ' with a few more words in it.', extra: {} });
    await c.saveChat(); return c.chat.length; })()`);
const bigItem = await Q.ev(`await desktopPanel.invoke('contextAdd', { kind: 'messages', last: 2000 })`);
let tb = Date.now();
const v1 = await Q.ev(`await desktopPanel.invoke('context')`);
const firstMs = Date.now() - tb;
tb = Date.now();
await Q.ev(`await desktopPanel.invoke('context')`);
const againMs = Date.now() - tb;
const bigRow = v1.items.find(x => x.id === bigItem.id);
check('a 5,000-message chat stays quick', bigRow?.tokens > 10000 && firstMs < 20000 && againMs < 1000, `first ${firstMs} ms, again ${againMs} ms, ${bigRow?.tokens} tokens`);
await Q.ev(`await desktopPanel.invoke('contextRemove', ${JSON.stringify(bigItem.id)})`);
await P.ev(`await (async () => { const c = SillyTavern.getContext(); c.chat.splice(25); await c.saveChat(); await c.printMessages(); return c.chat.length; })()`);

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
