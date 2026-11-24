// SillyTavern access for add-ons: requests to its server routes, and named page
// functions incl. streamed generation through a Connection Profile pointing at
// a fake model (tests/copilot/fake-model.mjs: nothing reaches a real provider).
// Needs ST_CLONE (a throwaway SillyTavern; its settings get a test profile) and ST_RUNS.
import fs from 'fs';
import path from 'path';
import { launch, check, finish, sleep, RUNS, CLONE, TEST_SETTINGS } from './lib.mjs';
import { start as fakeModel } from '../copilot/fake-model.mjs';
import { addLorebook, openTestChat, LORE, MESSAGES as CHAT_LEN, skipWelcome } from '../copilot/clone-setup.mjs';

if (!CLONE) { console.log('Set ST_CLONE to a throwaway SillyTavern.'); process.exit(1); }
skipWelcome(CLONE);
const NAME = 'st-access';
const DATA = path.join(RUNS, NAME);
const ID = 'st-test';
const ONLY = process.env.ONLY || ''; // 'requests' or 'page'

function seed(settings = {}) {
    fs.rmSync(DATA, { recursive: true, force: true });
    const dir = path.join(DATA, 'extensions', ID);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ name: 'ST test', version: '1.0.0', main: 'main.cjs' }));
    // Launcher → add-on handlers; errors come back as { err }.
    fs.writeFileSync(path.join(dir, 'main.cjs'), `
const wrap = fn => async (...a) => { try { return { ok: await fn(...a) }; } catch (e) { return { err: String(e && e.message || e) }; } };
let last = null;
module.exports = { activate(api) {
    api.handle('req', wrap((m, p, b) => api.sillytavern.request(m, p, b)));
    api.handle('page', wrap((n, a) => api.sillytavern.page(n, a)));
    // The change journal: record a file, change it, put it back.
    api.handle('chg', wrap(async file => {
        const fs = require('fs'), crypto = require('crypto');
        const h = () => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
        const before = h();
        const id = await api.changes.record({ folder: api.sillytavern.folder(), kind: 'test', target: 'desktop-test', files: [file] });
        fs.writeFileSync(file, '{"changed":true}');
        await api.changes.finish(id);
        const listed = api.changes.list({ folder: api.sillytavern.folder() }).some(e => e.id === id);
        await api.changes.restoreFile(id, file);
        let refused = '';
        try { await api.changes.record({ folder: api.sillytavern.folder(), kind: 'test', target: 'x', files: ['config.yaml'] }); } catch (e) { refused = e.message; }
        return { same: h() === before, listed, refused };
    }));
    api.handle('genStopIn', wrap(async (args, ms) => {
        const ctl = new AbortController(); const t0 = Date.now();
        setTimeout(() => ctl.abort(), ms);
        try { await api.sillytavern.page('generate', args, { signal: ctl.signal }); return { done: true, ms: Date.now() - t0 }; }
        catch (e) { e.message = e.message + ' | after ' + (Date.now() - t0) + ' ms'; throw e; }
    }));
    api.handle('gen', wrap(async (args, stopAfter) => {
        const chunks = [];
        const ctl = new AbortController();
        last = ctl;
        try {
            const result = await api.sillytavern.page('generate', args, { signal: ctl.signal, onChunk: c => { chunks.push(c.text); if (stopAfter && chunks.length >= stopAfter) ctl.abort(); } });
            return { chunks, result };
        } catch (e) { e.message = e.message + ' | chunks ' + chunks.length; throw e; }
    }));
} };`);
    fs.writeFileSync(path.join(DATA, 'settings.json'), JSON.stringify({ ...TEST_SETTINGS, sillytavernPath: CLONE, profiles: [], desktopExtensions: { [ID]: true }, ...settings }));
}
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; let r; while (Date.now() < end) { r = await fn(); if (r) return r; await sleep(300); } return r; };

let a;
const call = (ch, ...args) => a.launcher.ev(`await D.extInvoke('${ID}', '${ch}', ...${JSON.stringify(args)})`);

if (ONLY !== 'page') {
    // ---- Task 2.1: requests ----
    seed();
    a = await launch({ name: NAME, keep: true });
    await a.launcher.ev(`await D.startServer(); 'ok'`);
    await until(async () => (await a.launcher.ev(`(await D.getState()).running`)) === true, 60000);
    let r = await call('req', 'POST', '/api/characters/all', {});
    check('route read', Array.isArray(r.ok), JSON.stringify(r).slice(0, 120));
    r = await call('req', 'GET', '/version');
    check('version route', typeof r.ok?.pkgVersion === 'string', JSON.stringify(r).slice(0, 120));
    await a.launcher.ev(`await D.serverRestart(); 'ok'`);
    await until(async () => (await a.launcher.ev(`(await D.getState()).running`)) === true, 60000);
    await sleep(1500);
    r = await call('req', 'POST', '/api/characters/all', {});
    check('survives a server restart', Array.isArray(r.ok), JSON.stringify(r).slice(0, 160));
    r = await call('req', 'GET', '/api/../csrf-token/../x');
    const r2 = await call('req', 'GET', 'http://example.com/api/x');
    const r3 = await call('req', 'DELETE', '/api/characters/all');
    const testFile = path.join(CLONE, 'data', 'default-user', 'worlds', 'desktop-test-journal.json');
    fs.writeFileSync(testFile, '{"entries":{}}');
    const rc = await call('chg', testFile);
    fs.rmSync(testFile, { force: true });
    check('api.changes through an add-on', rc.ok?.same === true && rc.ok.listed === true && /outside/i.test(rc.ok.refused), JSON.stringify(rc).slice(0, 200));
    const r4 = await call('req', 'POST', '/api/secrets/view', {});
    check('a refusal of its own is not "user accounts"', !!r4.err && !/user accounts/i.test(r4.err), JSON.stringify(r4).slice(0, 160));
    check('only SillyTavern\'s API', !!(r.err && r2.err && r3.err), JSON.stringify([r, r2, r3]).slice(0, 200));
    await a.quit();
    await sleep(1000);

    seed({ serverOverrides: { enableUserAccounts: true } });
    a = await launch({ name: NAME, keep: true });
    await a.launcher.ev(`await D.startServer(); 'ok'`);
    await until(async () => (await a.launcher.ev(`(await D.getState()).running`)) === true, 60000);
    await sleep(1500);
    r = await call('req', 'POST', '/api/characters/all', {});
    check('user accounts on', /user accounts/i.test(r.err || ''), JSON.stringify(r).slice(0, 160));
    await a.quit();
    await sleep(1000);
}


if (ONLY !== 'requests') {
    // ---- Task 2.2: page functions ----
    const fake = await fakeModel({ port: 20130 });
    seed();
    a = await launch({ name: NAME, keep: true });
    await a.launcher.ev(`await D.startServer(); 'ok'`);
    const P = await a.page('localhost:8123/', 240);
    await until(() => P.ev(`!!window.SillyTavern?.getContext && !!SillyTavern.getContext().extensionSettings?.connectionManager`).catch(() => false), 90000);
    await sleep(3000);
    // A test profile in the throwaway clone: Custom (OpenAI-compatible) → the fake model.
    await P.ev(`(() => { const c = SillyTavern.getContext(); const cm = c.extensionSettings.connectionManager;
        cm.profiles = cm.profiles.filter(p => p.id !== 'desktop-test');
        cm.profiles.push({ id: 'desktop-test', name: 'Desktop test (fake model)', mode: 'cc', api: 'custom', model: 'fake-model', 'api-url': '${fake.url}', preset: 'Default' });
        c.saveSettingsDebounced(); return 'ok'; })()`);
    const MESSAGES = [{ role: 'system', content: 'You help with tests.' }, { role: 'user', content: 'Say something.' }];
    const args = extra => ({ profileId: 'desktop-test', messages: MESSAGES, maxTokens: 100, stream: true, ...extra });

    let r = await call('page', 'version');
    check('version', typeof r.ok?.version === 'string' && r.ok.version.length > 0, JSON.stringify(r));
    r = await call('page', 'profiles');
    check('profiles list the test profile', r.ok?.available === true && r.ok.profiles.some(p => p.id === 'desktop-test' && p.model === 'fake-model'), JSON.stringify(r).slice(0, 200));
    r = await call('page', 'tokenCount', { text: 'Hello world, this is a test.' });
    check('token count', r.ok?.count > 0, JSON.stringify(r));
    r = await call('page', 'nothing');
    check('unknown function', /no page function/i.test(r.err || ''), JSON.stringify(r));

    // ---- Task 5.1: what the co-pilot can read ----
    await addLorebook(P);
    const msgCount = await openTestChat(P);
    await sleep(1500);
    r = await call('page', 'context');
    check('context of the open chat', r.ok?.characterName === 'Seraphina' && r.ok.messageCount === CHAT_LEN && !!r.ok.chatId && msgCount === CHAT_LEN, 'setup ' + JSON.stringify(msgCount) + ' ' + JSON.stringify(r).slice(0, 200));
    r = await call('page', 'chatMessages', { from: CHAT_LEN - 20, to: CHAT_LEN - 1 });
    const cm = r.ok?.messages || [];
    check('chat messages by range', cm.length === 20 && cm[0].index === 5 && cm[19].index === 24 && /Test message 24/.test(cm[19].text) && r.ok.total === CHAT_LEN && typeof cm[0].isUser === 'boolean', JSON.stringify(r).slice(0, 200));
    const lists = (await call('page', 'lists')).ok;
    const sera = lists?.characters.find(x => x.name === 'Seraphina');
    check('lists', !!sera && lists.presets.includes('Default') && lists.lorebooks.includes(LORE) && Array.isArray(lists.personas), JSON.stringify(lists).slice(0, 200));
    r = await call('page', 'character', { avatar: sera?.avatar });
    check('character fields raw', r.ok?.name === 'Seraphina' && r.ok.description.length > 100 && /\{\{char\}\}|\{\{user\}\}/.test(r.ok.description + r.ok.first_mes + r.ok.mes_example), JSON.stringify(r).slice(0, 160));
    r = await call('page', 'persona', { avatar: null });
    check('persona', typeof r.ok?.name === 'string' && r.ok.name.length > 0 && typeof r.ok.description === 'string', JSON.stringify(r).slice(0, 160));
    r = await call('page', 'preset', { name: 'Default' });
    check('preset has prompts', r.ok?.name === 'Default' && Array.isArray(r.ok.preset?.prompts) && r.ok.preset.prompts.some(p => p.identifier === 'main') && typeof r.ok.preset.temperature === 'number', JSON.stringify(r).slice(0, 160));
    r = await call('page', 'lorebook', { name: LORE });
    const ents = r.ok?.entries || [];
    check('lorebook entries', ents.length === 2 && ents.some(e => e.uid === 1 && e.constant === true && e.keys.includes('cellar') && e.secondaryKeys.includes('door')), JSON.stringify(r).slice(0, 200));
    r = await call('page', 'tokenCounts', { texts: ['one', 'one two three four five six', ''] });
    check('token counts in order', r.ok?.counts?.length === 3 && r.ok.counts[1] > r.ok.counts[0] && r.ok.counts[2] === 0, JSON.stringify(r));
    r = await call('page', 'profiles');
    await P.ev(`(() => { const cm = SillyTavern.getContext().extensionSettings.connectionManager;
        cm.profiles = cm.profiles.filter(p => !['desktop-tc-size', 'desktop-cc-nopreset'].includes(p.id));
        cm.profiles.push({ id: 'desktop-tc-size', name: 'Desktop test (TC size)', mode: 'tc', api: 'koboldcpp', 'api-url': 'http://127.0.0.1:20131', preset: 'Default' });
        cm.profiles.push({ id: 'desktop-cc-nopreset', name: 'Desktop test (no preset)', mode: 'cc', api: 'custom', model: 'x', 'api-url': 'http://127.0.0.1:20130/v1', preset: '' });
        return 'ok'; })()`);
    const sizes = await call('page', 'profiles');
    const tcMax = await P.ev(`SillyTavern.getContext().maxContext`);
    const tcSize = sizes.ok?.profiles?.find(x => x.id === 'desktop-tc-size')?.maxContext;
    const noPreset = sizes.ok?.profiles?.find(x => x.id === 'desktop-cc-nopreset')?.maxContext;
    check('text completion profiles use their own context size', tcSize === tcMax && noPreset === sizes.ok.currentMaxContext, JSON.stringify({ tcSize, tcMax, noPreset, current: sizes.ok?.currentMaxContext }));
    await P.ev(`(() => { const cm = SillyTavern.getContext().extensionSettings.connectionManager; cm.profiles = cm.profiles.filter(p => !['desktop-tc-size', 'desktop-cc-nopreset'].includes(p.id)); return 'ok'; })()`);
    check('profiles have a context size', r.ok?.profiles?.find(p => p.id === 'desktop-test')?.maxContext > 0, JSON.stringify(r).slice(0, 200));

    // ---- Task 7.1: writing safely (page functions) ----
    const SERA = 'default_Seraphina.png';
    const getCard = async () => (await call('req', 'POST', '/api/characters/get', { avatar_url: SERA })).ok;
    const card0 = await getCard();
    await call('req', 'POST', '/api/characters/merge-attributes', { avatar: SERA, scenario: 'DESKTOP TEST SCENARIO', data: { scenario: 'DESKTOP TEST SCENARIO' } });
    r = await call('page', 'characterRefresh', { avatar: SERA });
    const formScenario = await P.ev(`document.querySelector('#scenario_pole').value`);
    check('merge write + characterRefresh refills the open form', !r.err && formScenario === 'DESKTOP TEST SCENARIO', JSON.stringify(r) + ' | ' + formScenario);

    await P.ev(`(() => { const d = document.querySelector('#description_textarea'); d.value = d.value + ' TYPED BY TEST'; return 'ok'; })()`);
    r = await call('page', 'characterFlush', { avatar: SERA });
    const afterFlush = await getCard();
    check('characterFlush saves pending typing first', r.ok?.flushed === true && (afterFlush?.data?.description || afterFlush?.description || '').endsWith(' TYPED BY TEST'), JSON.stringify(r) + ' | ' + JSON.stringify(String(afterFlush?.data?.description || '').slice(-40)));
    r = await call('page', 'characterFlush', { avatar: SERA });
    check('characterFlush with nothing typed saves nothing', r.ok?.flushed === false, JSON.stringify(r));
    // With a field: only that box changes; typing in another box stays.
    await P.ev(`(() => { const d = document.querySelector('#personality_textarea'); d.value = 'TYPED IN ANOTHER BOX'; return 'ok'; })()`);
    await call('req', 'POST', '/api/characters/merge-attributes', { avatar: SERA, scenario: 'SECOND TEST SCENARIO', data: { scenario: 'SECOND TEST SCENARIO' } });
    r = await call('page', 'characterRefresh', { avatar: SERA, field: 'scenario' });
    const boxes = await P.ev(`({ scenario: document.querySelector('#scenario_pole').value, personality: document.querySelector('#personality_textarea').value })`);
    check('characterRefresh with a field keeps typing in the other boxes', r.ok?.box === true && boxes.scenario === 'SECOND TEST SCENARIO' && boxes.personality === 'TYPED IN ANOTHER BOX', JSON.stringify(r) + ' | ' + JSON.stringify(boxes));
    await P.ev(`(() => { document.querySelector('#personality_textarea').value = ${JSON.stringify(card0.data?.personality ?? card0.personality ?? '')}; return 'ok'; })()`);
    // back as it was
    await call('req', 'POST', '/api/characters/merge-attributes', { avatar: SERA, scenario: card0.scenario, description: card0.description, data: { scenario: card0.data.scenario, description: card0.data.description } });
    await call('page', 'characterRefresh', { avatar: SERA });

    // Lorebook: open it in the World Info editor first.
    await P.ev(`await (async () => { const wi = await import('/scripts/world-info.js'); wi.reloadEditor(${JSON.stringify(LORE)}, true); await new Promise(r => setTimeout(r, 1500)); return 'ok'; })()`);
    const book0 = (await call('req', 'POST', '/api/worldinfo/get', { name: LORE })).ok;
    const book1 = structuredClone(book0);
    book1.entries['0'].content = 'Saved through the page by the test.';
    r = await call('page', 'lorebookSave', { name: LORE, data: book1 });
    const disk1 = (await call('req', 'POST', '/api/worldinfo/get', { name: LORE })).ok;
    const cache1 = await P.ev(`await (async () => { const wi = await import('/scripts/world-info.js'); return (await wi.loadWorldInfo(${JSON.stringify(LORE)})).entries['0'].content; })()`);
    check('lorebookSave updates file, cache and editor', !r.err && disk1.entries['0'].content === 'Saved through the page by the test.' && cache1 === 'Saved through the page by the test.', JSON.stringify(r) + ' | ' + cache1);

    const book2 = structuredClone(book0);
    book2.entries['0'].content = 'Written from outside the page.';
    await call('req', 'POST', '/api/worldinfo/edit', { name: LORE, data: book2 });
    r = await call('page', 'lorebookReload', { name: LORE });
    const cache2 = await P.ev(`await (async () => { const wi = await import('/scripts/world-info.js'); return (await wi.loadWorldInfo(${JSON.stringify(LORE)})).entries['0'].content; })()`);
    check('lorebookReload after an outside write', !r.err && cache2 === 'Written from outside the page.', JSON.stringify(r) + ' | ' + cache2);

    r = await call('page', 'lorebookFlush');
    check('lorebookFlush runs', !r.err, JSON.stringify(r));
    await call('page', 'lorebookSave', { name: LORE, data: book0 });


    // lorebookEntry: one entry changed inside the page with SillyTavern's own helpers.
    const bookNow = async () => (await call('req', 'POST', '/api/worldinfo/get', { name: LORE })).ok;
    const e0 = (await bookNow()).entries['1'];
    r = await call('page', 'lorebookEntry', { name: LORE, op: 'set', uid: 1, values: { content: 'Changed by lorebookEntry.', disable: true }, expect: e0 });
    let bk = await bookNow();
    check('lorebookEntry set', !r.err && bk.entries['1'].content === 'Changed by lorebookEntry.' && bk.entries['1'].disable === true && bk.entries['0'].content === book0.entries['0'].content, JSON.stringify(r));
    r = await call('page', 'lorebookEntry', { name: LORE, op: 'set', uid: 1, values: { content: 'x' }, expect: e0 });
    check('lorebookEntry refuses when the entry changed meanwhile', /changed/i.test(r.err || ''), JSON.stringify(r));
    r = await call('page', 'lorebookEntry', { name: LORE, op: 'add', values: { key: ['harbour'], content: 'A new entry.', comment: 'Added' } });
    bk = await bookNow();
    const newUid = r.ok?.uid;
    check('lorebookEntry add', Number.isInteger(newUid) && bk.entries[String(newUid)]?.content === 'A new entry.' && bk.entries[String(newUid)].key[0] === 'harbour', JSON.stringify(r));
    const added = bk.entries[String(newUid)];
    r = await call('page', 'lorebookEntry', { name: LORE, op: 'delete', uid: newUid, expect: added });
    bk = await bookNow();
    check('lorebookEntry delete', !r.err && !(String(newUid) in bk.entries), JSON.stringify(r));
    r = await call('page', 'lorebookEntry', { name: LORE, op: 'put', uid: newUid, entry: added });
    bk = await bookNow();
    check('lorebookEntry put back with its uid', !r.err && bk.entries[String(newUid)]?.content === 'A new entry.', JSON.stringify(r));
    // Typing in the editor that SillyTavern hasn't saved yet (its save waits) is kept.
    await P.ev(`await (async () => { const wi = await import('/scripts/world-info.js'); const d = await wi.loadWorldInfo(${JSON.stringify(LORE)}); d.entries['0'].comment = 'PENDING EDITOR TYPING'; wi.saveWorldInfo(${JSON.stringify(LORE)}, d); return 'ok'; })()`);
    r = await call('page', 'lorebookEntry', { name: LORE, op: 'set', uid: 1, values: { content: 'Set while the editor waited.' }, expect: (await bookNow()).entries['1'] });
    await sleep(2500);
    bk = await bookNow();
    check('lorebookEntry keeps the editor\'s pending typing', !r.err && bk.entries['0'].comment === 'PENDING EDITOR TYPING' && bk.entries['1'].content === 'Set while the editor waited.', JSON.stringify(r) + ' | ' + JSON.stringify([bk.entries['0'].comment, bk.entries['1'].content]));
    await call('page', 'lorebookSave', { name: LORE, data: book0 });

    await call('req', 'POST', '/api/worldinfo/edit', { name: 'Desktop delete me', data: { entries: {} } });
    await call('page', 'lorebookReload', { name: 'Desktop delete me' });
    const listed = (await call('page', 'lists')).ok.lorebooks.includes('Desktop delete me');
    r = await call('page', 'lorebookDelete', { name: 'Desktop delete me' });
    const gone = !(await call('page', 'lists')).ok.lorebooks.includes('Desktop delete me');
    check('lorebookDelete', listed && gone && !r.err, JSON.stringify({ listed, gone, r }));

    const made = await call('req', 'POST', '/api/characters/create', { ch_name: 'Desktop new card', description: 'Made by the test.', first_mes: 'Hi.', file_name: 'Desktop new card test' });
    r = await call('page', 'characterListRefresh');
    const has = (await call('page', 'lists')).ok.characters.some(c => c.avatar === 'Desktop new card test.png');
    const del = await call('page', 'characterDelete', { avatar: 'Desktop new card test.png' });
    const hasAfter = (await call('page', 'lists')).ok.characters.some(c => c.avatar === 'Desktop new card test.png');
    check('characterListRefresh lists a new card; characterDelete removes it', !made.err && has && !hasAfter && !del.err, JSON.stringify({ made: made.ok ?? made.err, has, hasAfter, del }));

    const TEXT = 'The quick brown fox jumps over the lazy dog near the old tavern.';
    fake.reply({ text: TEXT, chunks: 5, delayMs: 80 });
    r = await call('gen', args());
    const ch = r.ok?.chunks || [];
    check('streamed in order', ch.length >= 3 && ch.every((c, i) => i === 0 || c.length > ch[i - 1].length) && r.ok.result.text === TEXT, JSON.stringify(r).slice(0, 240));
    const sent = fake.requests.at(-1)?.body;
    check('no preset prompts sent', JSON.stringify((sent?.messages || []).map(m => ({ role: m.role, content: m.content }))) === JSON.stringify(MESSAGES) && sent?.stream === true,
        JSON.stringify(sent?.messages)?.slice(0, 240));

    fake.reply({ text: 'Plain answer.' });
    r = await call('gen', args({ stream: false }));
    check('not streamed', r.ok?.result?.text === 'Plain answer.' && r.ok.chunks.length === 0, JSON.stringify(r).slice(0, 200));

    fake.reply({ text: 'x'.repeat(400), chunks: 20, delayMs: 200 });
    r = await call('gen', args(), 2);
    await sleep(800);
    check('stop mid-stream', /abort/i.test(r.err || '') && fake.requests.at(-1)?.closedEarly === true, JSON.stringify(r).slice(0, 200) + ' closedEarly=' + fake.requests.at(-1)?.closedEarly);

    // A navigation that starts but never commits (a link that opens in the browser, a download).
    fake.reply({ text: 'z'.repeat(100), chunks: 10, delayMs: 150 });
    await a.launcher.ev(`window.__nav = D.extInvoke('${ID}', 'gen', ${JSON.stringify(args())}); 'ok'`);
    await sleep(500);
    await a.main.ev(`(() => { const { webContents } = require('electron'); const wc = webContents.getAllWebContents().find(w => w.getURL().startsWith('http://localhost:8123')); wc.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false, url: 'http://localhost:8123/elsewhere' }, 'http://localhost:8123/elsewhere', false, true); return 'ok'; })()`);
    r = await a.launcher.ev(`await window.__nav`);
    check('a navigation that never happens is not a reload', r.ok?.result?.text === 'z'.repeat(100), JSON.stringify(r).slice(0, 160));

    // Stop while the page is busy (a long script, a dialog): the add-on hears at once.
    fake.reply({ text: 'w'.repeat(200), chunks: 20, delayMs: 200 });
    await a.launcher.ev(`window.__busy = D.extInvoke('${ID}', 'genStopIn', ${JSON.stringify(args())}, 1500); 'ok'`);
    await sleep(800);
    P.send('Runtime.evaluate', { expression: 'setTimeout(() => { const t = Date.now(); while (Date.now() - t < 7000); }, 0); 1' }).catch(() => {});
    r = await a.launcher.ev(`await window.__busy`);
    const ms = Number(/after (\d+) ms/.exec(r.err || '')?.[1] || 99999);
    check('stop answers while the page is busy', /abort/i.test(r.err || '') && ms < 4000, JSON.stringify(r).slice(0, 160));
    await sleep(7000);

    // Text completion profiles keep their roles (the instruct template formats them).
    await P.ev(`(() => { const c = SillyTavern.getContext(); const cm = c.extensionSettings.connectionManager;
        cm.profiles = cm.profiles.filter(p => p.id !== 'desktop-tc');
        cm.profiles.push({ id: 'desktop-tc', name: 'Desktop test (text completion)', mode: 'tc', api: 'koboldcpp', 'api-url': 'http://127.0.0.1:20131', instruct: 'ChatML', preset: 'Default' });
        // Test only: answer SillyTavern's text completion request in the page and keep what it sent.
        if (!window.__realFetch) window.__realFetch = window.fetch;
        window.fetch = async (url, init) => {
            if (String(url).includes('/api/backends/text-completions/generate')) { window.__tcSent = JSON.parse(init.body); return new Response(JSON.stringify({ results: [{ text: 'TC answer' }], choices: [{ text: 'TC answer', index: 0 }] }), { headers: { 'content-type': 'application/json' } }); }
            return window.__realFetch(url, init);
        };
        return 'ok'; })()`);
    r = await call('gen', args({ profileId: 'desktop-tc', stream: false }));
    const prompt = await P.ev(`String(window.__tcSent?.prompt ?? '')`);
    await P.ev(`window.fetch = window.__realFetch; 'ok'`);
    check('text completion keeps the roles', r.ok?.result?.text === 'TC answer' && /<\|im_start\|>system/.test(prompt) && /<\|im_start\|>user\s*\nSay something\./.test(prompt), JSON.stringify(r).slice(0, 100) + ' ' + JSON.stringify(prompt.slice(0, 160)));

    fake.reply({ text: 'y'.repeat(400), chunks: 20, delayMs: 300 });
    const bar = await a.page('stbar.html');
    await a.launcher.ev(`window.__gen = D.extInvoke('${ID}', 'gen', ${JSON.stringify(args())}); 'ok'`);
    await sleep(1500);
    await bar.ev(`bar.action('reload'); 'ok'`);
    r = await a.launcher.ev(`await Promise.race([window.__gen, new Promise(r => setTimeout(() => r({ err: 'still waiting after 20 s' }), 20000))])`);
    check('reload mid-request', /reloaded/i.test(r.err || ''), JSON.stringify(r).slice(0, 200));

    // Connection Manager off: the current connection (pointed at the fake model) is used.
    const P2 = await a.page('localhost:8123/', 240);
    await until(() => P2.ev(`!!window.SillyTavern?.getContext && !!SillyTavern.getContext().extensionSettings?.connectionManager`).catch(() => false), 90000);
    await sleep(3000);
    await P2.ev(`(() => { const c = SillyTavern.getContext(); const s = c.chatCompletionSettings;
        $('#main_api').val('openai').trigger('change');
        s.chat_completion_source = 'custom'; s.custom_url = '${fake.url}'; s.custom_model = 'fake-model';
        c.extensionSettings.disabledExtensions.push('connection-manager'); return 'ok'; })()`);
    await sleep(1000);
    fake.reply({ text: 'From the current connection.' });
    r = await call('gen', args({ stream: false }));
    check('no Connection Manager', r.ok?.result?.text === 'From the current connection.' && r.ok.result.fallback === true, JSON.stringify(r).slice(0, 200));
    await P2.ev(`(() => { const c = SillyTavern.getContext(); c.extensionSettings.disabledExtensions = c.extensionSettings.disabledExtensions.filter(x => x !== 'connection-manager'); c.saveSettingsDebounced(); return 'ok'; })()`);
    await sleep(1500);
    P.close(); P2.close(); bar.close();
    await a.quit();
    await fake.close();
}

finish();
