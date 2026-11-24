// Applying and undoing the co-pilot's proposals (addons/copilot/apply.cjs)
// against a stand-in SillyTavern: a pretend folder with real files (so the
// change journal hashes them for real) and the routes / page functions the
// add-on uses, answered from those files.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { createRequire } from 'module';
import { openJournal } from '../../changes.js';

const require = createRequire(import.meta.url);
const apply = require('../../addons/copilot/apply.cjs');

const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.mkdtempSync(path.join(process.env.ST_TEST_DATA || os.tmpdir(), 'ap-')); made.push(d); return d; };
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

const deepMerge = (a, b) => { for (const [k, v] of Object.entries(b)) { if (v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object') deepMerge(a[k], v); else a[k] = v; } return a; };

// A pretend SillyTavern: cards are JSON in .png files (enough for hashing).
function fakeSt() {
    const root = tmp(), addon = tmp();
    fs.writeFileSync(path.join(root, 'server.js'), '');
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'sillytavern' }));
    const user = path.join(root, 'data', 'default-user');
    for (const d of ['characters', 'worlds', 'chats']) fs.mkdirSync(path.join(user, d), { recursive: true });
    const cardFile = a => path.join(user, 'characters', a);
    const bookFile = n => path.join(user, 'worlds', `${n}.json`);
    const card = (name, extra = {}) => ({ name, description: `${name} is a ferry pilot. She is kind.`, personality: 'gruff', scenario: 'An autumn morning.', first_mes: 'Hello.', mes_example: '', creatorcomment: 'notes', tags: ['ferry'],
        data: { name, description: `${name} is a ferry pilot. She is kind.`, personality: 'gruff', scenario: 'An autumn morning.', first_mes: 'Hello.', mes_example: '', creator_notes: 'notes', tags: ['ferry'], alternate_greetings: [], system_prompt: '', post_history_instructions: '', extensions: { keep: 1 } }, ...extra });
    fs.writeFileSync(cardFile('kit.png'), JSON.stringify(card('Kit')));
    fs.writeFileSync(bookFile('Saltmarsh'), JSON.stringify({ entries: {
        0: { uid: 0, key: ['ferry'], keysecondary: [], comment: 'The ferry', content: 'The ferry is old.', constant: false, disable: false, order: 100, position: 0 },
        7: { uid: 7, key: ['lighthouse'], keysecondary: [], comment: 'Light', content: 'The lighthouse is dark.', constant: false, disable: false, order: 100, position: 0 },
    } }, null, 4));
    const calls = [];
    const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
    const writeJson = (f, v) => fs.writeFileSync(f, JSON.stringify(v));
    const books = () => fs.readdirSync(path.join(user, 'worlds')).map(f => f.replace(/\.json$/, ''));
    const api = {
        dir: addon,
        changes: openJournal(addon),
        sillytavern: {
            folder: () => root,
            async request(method, p, body) {
                calls.push(['request', p, body]);
                if (p === '/api/users/me') return { handle: 'default-user' };
                if (p === '/api/characters/get') { if (!fs.existsSync(cardFile(body.avatar_url))) throw new Error('Not Found'); return readJson(cardFile(body.avatar_url)); }
                if (p === '/api/characters/merge-attributes') { const c = readJson(cardFile(body.avatar)); const { avatar, ...rest } = body; writeJson(cardFile(avatar), deepMerge(c, rest)); return { ok: true }; }
                if (p === '/api/characters/create') { const f = `${body.file_name}.png`; writeJson(cardFile(f), deepMerge(card(body.ch_name), { description: body.description || '', data: { description: body.description || '' } })); return f; }
                if (p === '/api/worldinfo/get') return fs.existsSync(bookFile(body.name)) ? readJson(bookFile(body.name)) : { entries: {} };
                throw new Error(`unexpected request ${p}`);
            },
            async page(name, a = {}) {
                calls.push(['page', name, a]);
                if (['characterFlush'].includes(name)) return { flushed: false };
                if (['characterRefresh', 'characterListRefresh', 'lorebookFlush', 'lorebookReload'].includes(name)) return { ok: true };
                if (name === 'lists') return { characters: fs.readdirSync(path.join(user, 'characters')).map(f => ({ avatar: f, name: readJson(cardFile(f)).name })), lorebooks: books(), presets: [], personas: [] };
                if (name === 'characterDelete') { fs.rmSync(cardFile(a.avatar)); return { ok: true }; }
                if (name === 'lorebookDelete') { fs.rmSync(bookFile(a.name)); return { ok: true }; }
                if (name === 'lorebookSave') { writeJson(bookFile(a.name), a.data); return { ok: true }; }
                if (name === 'lorebookEntry') {
                    const data = readJson(bookFile(a.name));
                    const k = Object.keys(data.entries).find(x => data.entries[x].uid === a.uid);
                    if (a.op === 'set') { if (a.expect && JSON.stringify(data.entries[k]) !== JSON.stringify(a.expect)) throw new Error('The entry changed meanwhile: nothing was written.'); Object.assign(data.entries[k], a.values); }
                    if (a.op === 'add') { let u = 0; while (String(u) in data.entries) u++; data.entries[u] = { uid: u, key: [], keysecondary: [], comment: '', content: '', constant: false, disable: false, order: 100, position: 0, ...a.values }; writeJson(bookFile(a.name), data); return { ok: true, uid: u }; }
                    if (a.op === 'delete') delete data.entries[k];
                    if (a.op === 'put') data.entries[a.uid] = { ...a.entry, uid: a.uid };
                    writeJson(bookFile(a.name), data);
                    return { ok: true };
                }
                throw new Error(`unexpected page ${name}`);
            },
        },
    };
    return { root, user, api, calls, cardFile, bookFile, readJson };
}

test('a card edit changes both copies and nothing else', async () => {
    const s = fakeSt();
    const before = s.readJson(s.cardFile('kit.png'));
    const r = await apply.applyProposal(s.api, { op: 'edit_card', avatar: 'kit.png', field: 'scenario', find: 'autumn', replace: 'winter', why: 'x' });
    assert.equal(r.ok, true, r.error);
    const c = s.readJson(s.cardFile('kit.png'));
    assert.equal(c.scenario, 'An winter morning.');
    assert.equal(c.data.scenario, 'An winter morning.');
    assert.equal(c.description, before.description);
    assert.deepEqual(c.data.extensions, { keep: 1 });
    assert.ok(s.calls.some(x => x[1] === 'characterFlush'), 'typing in the open form saved first');
    assert.ok(s.calls.some(x => x[1] === 'characterRefresh'), 'the page shown the change');
    assert.ok(s.api.changes.get(r.change.journal), 'recorded in the journal');
});

test('creator notes and tags go to the right places', async () => {
    const s = fakeSt();
    assert.equal((await apply.applyProposal(s.api, { op: 'edit_card', avatar: 'kit.png', field: 'creator_notes', set: 'New notes', why: 'x' })).ok, true);
    assert.equal((await apply.applyProposal(s.api, { op: 'edit_card', avatar: 'kit.png', field: 'tags', set: ['ferry', 'sea'], why: 'x' })).ok, true);
    assert.equal((await apply.applyProposal(s.api, { op: 'edit_card', avatar: 'kit.png', field: 'alternate_greetings', set: ['Hi again.'], why: 'x' })).ok, true);
    const c = s.readJson(s.cardFile('kit.png'));
    assert.equal(c.creatorcomment, 'New notes');
    assert.equal(c.data.creator_notes, 'New notes');
    assert.deepEqual(c.tags, ['ferry', 'sea']);
    assert.deepEqual(c.data.tags, ['ferry', 'sea']);
    assert.deepEqual(c.data.alternate_greetings, ['Hi again.']);
});

test('find must match exactly once; nothing is written otherwise', async () => {
    const s = fakeSt();
    const h = sha(s.cardFile('kit.png'));
    let r = await apply.applyProposal(s.api, { op: 'edit_card', avatar: 'kit.png', field: 'scenario', find: 'summer', replace: 'x', why: 'x' });
    assert.equal(r.ok, false);
    assert.match(r.error, /not found|isn't there|changed/i);
    r = await apply.applyProposal(s.api, { op: 'edit_card', avatar: 'kit.png', field: 'description', find: 'e', replace: 'E', why: 'x' });
    assert.equal(r.ok, false);
    assert.match(r.error, /more than once|\d+ times/i);
    r = await apply.applyProposal(s.api, { op: 'edit_card', avatar: 'nobody.png', field: 'scenario', set: 'x', why: 'x' });
    assert.equal(r.ok, false);
    assert.equal(sha(s.cardFile('kit.png')), h);
    assert.equal(s.api.changes.list({}).length, 0);
});

test('undo with the file unchanged puts the whole file back byte for byte', async () => {
    const s = fakeSt();
    const h = sha(s.cardFile('kit.png'));
    const r = await apply.applyProposal(s.api, { op: 'edit_card', avatar: 'kit.png', field: 'scenario', set: 'A winter night.', why: 'x' });
    const u = await apply.undoChange(s.api, r.change);
    assert.equal(u.ok, true, u.error);
    assert.equal(u.how, 'file');
    assert.equal(sha(s.cardFile('kit.png')), h);
});

test('undo after another field changed restores just this one', async () => {
    const s = fakeSt();
    const r = await apply.applyProposal(s.api, { op: 'edit_card', avatar: 'kit.png', field: 'scenario', set: 'A winter night.', why: 'x' });
    await s.api.sillytavern.request('POST', '/api/characters/merge-attributes', { avatar: 'kit.png', personality: 'cheerful', data: { personality: 'cheerful' } }); // the user, meanwhile
    const u = await apply.undoChange(s.api, r.change);
    assert.equal(u.ok, true, u.error);
    assert.equal(u.how, 'item');
    const c = s.readJson(s.cardFile('kit.png'));
    assert.equal(c.data.scenario, 'An autumn morning.');
    assert.equal(c.scenario, 'An autumn morning.');
    assert.equal(c.data.personality, 'cheerful');
});

test('undo after the same field changed asks, and does what is picked', async () => {
    const s = fakeSt();
    const r = await apply.applyProposal(s.api, { op: 'edit_card', avatar: 'kit.png', field: 'scenario', set: 'A winter night.', why: 'x' });
    await s.api.sillytavern.request('POST', '/api/characters/merge-attributes', { avatar: 'kit.png', scenario: 'Edited by hand.', data: { scenario: 'Edited by hand.' } });
    const u = await apply.undoChange(s.api, r.change);
    assert.deepEqual(u.conflict, { current: 'Edited by hand.', before: 'An autumn morning.', after: 'A winter night.' });
    assert.equal(s.readJson(s.cardFile('kit.png')).data.scenario, 'Edited by hand.');
    assert.equal((await apply.undoChange(s.api, r.change, { choice: 'keep' })).ok, true);
    assert.equal(s.readJson(s.cardFile('kit.png')).data.scenario, 'Edited by hand.');
    assert.equal((await apply.undoChange(s.api, r.change, { choice: 'mine' })).ok, true);
    assert.equal(s.readJson(s.cardFile('kit.png')).data.scenario, 'An autumn morning.');
});

test('lorebook entries: our names mapped, values checked', async () => {
    const s = fakeSt();
    let r = await apply.applyProposal(s.api, { op: 'edit_lorebook_entry', book: 'Saltmarsh', uid: 7, field: 'keys', set: ['lighthouse', 'beacon'], why: 'x' });
    assert.equal(r.ok, true, r.error);
    r = await apply.applyProposal(s.api, { op: 'edit_lorebook_entry', book: 'Saltmarsh', uid: 7, field: 'disabled', set: true, why: 'x' });
    assert.equal(r.ok, true, r.error);
    r = await apply.applyProposal(s.api, { op: 'edit_lorebook_entry', book: 'Saltmarsh', uid: 7, field: 'content', find: 'dark', replace: 'lit again', why: 'x' });
    assert.equal(r.ok, true, r.error);
    const e = s.readJson(s.bookFile('Saltmarsh')).entries['7'];
    assert.deepEqual(e.key, ['lighthouse', 'beacon']);
    assert.equal(e.disable, true);
    assert.equal(e.content, 'The lighthouse is lit again.');
    for (const bad of [
        { op: 'edit_lorebook_entry', book: 'Saltmarsh', uid: 7, field: 'position', set: 9, why: 'x' },
        { op: 'edit_lorebook_entry', book: 'Saltmarsh', uid: 99, field: 'content', set: 'x', why: 'x' },
        { op: 'edit_lorebook_entry', book: 'Nowhere', uid: 7, field: 'content', set: 'x', why: 'x' },
        { op: 'add_lorebook_entry', book: 'Saltmarsh', entry: { uid: 3, content: 'x' }, why: 'x' },
        { op: 'add_lorebook_entry', book: 'Saltmarsh', entry: { key: ['raw name'], content: 'x' }, why: 'x' },
        { op: 'add_lorebook_entry', book: 'Saltmarsh', entry: { content: 'x', script: 'evil' }, why: 'x' },
    ]) assert.equal((await apply.applyProposal(s.api, bad)).ok, false, JSON.stringify(bad));
});

test('add and delete entries, and undo them', async () => {
    const s = fakeSt();
    const h = sha(s.bookFile('Saltmarsh'));
    const add = await apply.applyProposal(s.api, { op: 'add_lorebook_entry', book: 'Saltmarsh', entry: { keys: ['tide'], content: 'Spring tides flood the causeway.', comment: 'Tides', constant: true }, why: 'x' });
    assert.equal(add.ok, true, add.error);
    const added = Object.values(s.readJson(s.bookFile('Saltmarsh')).entries).find(e => e.comment === 'Tides');
    assert.deepEqual(added.key, ['tide']);
    assert.equal(added.constant, true);
    assert.equal((await apply.undoChange(s.api, add.change)).ok, true);
    assert.equal(sha(s.bookFile('Saltmarsh')), h);
    const del = await apply.applyProposal(s.api, { op: 'delete_lorebook_entry', book: 'Saltmarsh', uid: 0, why: 'x' });
    assert.equal(del.ok, true, del.error);
    assert.equal('0' in s.readJson(s.bookFile('Saltmarsh')).entries, false);
    // the file changed in between (another entry edited): the entry comes back by itself
    await apply.applyProposal(s.api, { op: 'edit_lorebook_entry', book: 'Saltmarsh', uid: 7, field: 'comment', set: 'Lamp', why: 'x' });
    const u = await apply.undoChange(s.api, del.change);
    assert.equal(u.ok, true, u.error);
    const back = s.readJson(s.bookFile('Saltmarsh')).entries['0'];
    assert.equal(back.content, 'The ferry is old.');
    assert.equal(s.readJson(s.bookFile('Saltmarsh')).entries['7'].comment, 'Lamp');
});

test('a new card gets a file name of its own, and undo deletes it', async () => {
    const s = fakeSt();
    fs.writeFileSync(s.cardFile('Ash.png'), JSON.stringify({ name: 'Ash', data: {} }));
    const r = await apply.applyProposal(s.api, { op: 'create_card', name: 'ash', fields: { description: 'A new one.', first_mes: 'Hi.' }, why: 'x' });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.change.target.avatar, 'ash1.png', 'a different name than Ash.png, whatever the case');
    assert.ok(fs.existsSync(s.cardFile('ash1.png')));
    assert.equal(fs.readFileSync(s.cardFile('Ash.png'), 'utf8'), JSON.stringify({ name: 'Ash', data: {} }), 'the existing card untouched');
    for (const bad of [{ name: 'X', fields: { avatar: 'evil.png' } }, { name: 'X', fields: { description: 5 } }, { name: '', fields: {} }]) {
        assert.equal((await apply.applyProposal(s.api, { op: 'create_card', ...bad, why: 'x' })).ok, false, JSON.stringify(bad));
    }
    const u = await apply.undoChange(s.api, r.change);
    assert.equal(u.ok, true, u.error);
    assert.ok(s.calls.some(x => x[1] === 'characterDelete' && x[2].avatar === 'ash1.png'));
    assert.equal(fs.existsSync(s.cardFile('ash1.png')), false);
});

test('a new lorebook needs a new, plain name', async () => {
    const s = fakeSt();
    for (const name of ['saltmarsh', 'SALTMARSH', 'a:b', 'trail. ', '', 'x'.repeat(201)]) {
        assert.equal((await apply.applyProposal(s.api, { op: 'create_lorebook', name, why: 'x' })).ok, false, JSON.stringify(name));
    }
    const r = await apply.applyProposal(s.api, { op: 'create_lorebook', name: 'Harbour lore', why: 'x' });
    assert.equal(r.ok, true, r.error);
    assert.deepEqual(s.readJson(s.bookFile('Harbour lore')), { entries: {} });
    assert.equal((await apply.undoChange(s.api, r.change)).ok, true);
    assert.equal(fs.existsSync(s.bookFile('Harbour lore')), false);
});

test('ops not handled yet are refused, not guessed', async () => {
    const s = fakeSt();
    const r = await apply.applyProposal(s.api, { op: 'rename_chat', name: 'x', why: 'x' });
    assert.equal(r.ok, false);
    assert.match(r.error, /not yet|next version/i);
});

// ---- review fixes ----
test('a new card never takes the name of a chats folder left by an older character', async () => {
    const s = fakeSt();
    fs.mkdirSync(path.join(s.user, 'chats', 'Mira'));
    fs.writeFileSync(path.join(s.user, 'chats', 'Mira', 'old chat.jsonl'), '{"private":true}\n');
    const r = await apply.applyProposal(s.api, { op: 'create_card', name: 'Mira', fields: { description: 'New.' }, why: 'x' });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.change.target.avatar, 'Mira1.png');
});

test('undo of a new card keeps chats made with it', async () => {
    const s = fakeSt();
    const r = await apply.applyProposal(s.api, { op: 'create_card', name: 'Nova', fields: { description: 'New.' }, why: 'x' });
    fs.mkdirSync(path.join(s.user, 'chats', 'Nova'), { recursive: true });
    fs.writeFileSync(path.join(s.user, 'chats', 'Nova', 'a chat.jsonl'), '{}\n');
    const u = await apply.undoChange(s.api, r.change, { choice: 'mine' });
    assert.equal(u.ok, true, u.error);
    const del = s.calls.find(x => x[1] === 'characterDelete');
    assert.equal(del[2].keepChats, true, 'chats kept');
    assert.match(u.note || '', /chats/i);
});

test('a file that is not where it should be is never changed without a copy', async () => {
    const s = fakeSt();
    fs.rmSync(s.cardFile('kit.png')); // SillyTavern still answers for it (its data is elsewhere)
    const real = s.api.sillytavern.request;
    s.api.sillytavern.request = async (m, p, b) => (p === '/api/characters/get' ? { name: 'Kit', data: { scenario: 'An autumn morning.' } } : real(m, p, b));
    const page = s.api.sillytavern.page;
    s.api.sillytavern.page = async (n, x, o) => (n === 'lists' ? { characters: [{ avatar: 'kit.png', name: 'Kit' }], lorebooks: [], presets: [], personas: [] } : page(n, x, o));
    const r = await apply.applyProposal(s.api, { op: 'edit_card', avatar: 'kit.png', field: 'scenario', set: 'x', why: 'x' });
    assert.equal(r.ok, false);
    assert.match(r.error, /data folder|can't find|isn't in/i);
    assert.equal(s.api.changes.list({}).length, 0);
});

test('names that sanitize to another file are refused', async () => {
    const s = fakeSt();
    for (const name of ['Saltmarsh\u0085', 'Salt\u007fmarsh', 'Harbour\u200e']) {
        assert.equal((await apply.applyProposal(s.api, { op: 'create_lorebook', name, why: 'x' })).ok, false, JSON.stringify(name));
    }
    assert.ok(fs.readFileSync(s.bookFile('Saltmarsh'), 'utf8').includes('ferry'), 'the real book untouched');
});

test('an error after the write keeps the change, so it can be undone', async () => {
    const s = fakeSt();
    const realPage = s.api.sillytavern.page;
    s.api.sillytavern.page = async (n, a) => { if (n === 'characterRefresh') throw new Error('SillyTavern reloaded during the request.'); return realPage(n, a); };
    const h = sha(s.cardFile('kit.png'));
    const r = await apply.applyProposal(s.api, { op: 'edit_card', avatar: 'kit.png', field: 'scenario', set: 'A winter night.', why: 'x' });
    assert.ok(r.change, 'the change is kept');
    assert.ok(r.ok || /reload/i.test(r.error));
    s.api.sillytavern.page = realPage;
    assert.equal((await apply.undoChange(s.api, r.change)).ok, true);
    assert.equal(sha(s.cardFile('kit.png')), h);
});

test('undo saves pending typing before it decides', async () => {
    const s = fakeSt();
    const r = await apply.applyProposal(s.api, { op: 'edit_card', avatar: 'kit.png', field: 'scenario', set: 'A winter night.', why: 'x' });
    s.calls.length = 0;
    await apply.undoChange(s.api, r.change);
    const first = s.calls.findIndex(x => x[1] === 'characterFlush');
    const restore = s.calls.findIndex(x => x[1] === 'characterRefresh');
    assert.ok(first >= 0 && first < restore, JSON.stringify(s.calls.map(x => x[1])));
});

test('SillyTavern\'s "unset" marker is not a value', async () => {
    const s = fakeSt();
    assert.equal((await apply.applyProposal(s.api, { op: 'edit_card', avatar: 'kit.png', field: 'scenario', set: '__@@UNSET@@__', why: 'x' })).ok, false);
    assert.equal((await apply.applyProposal(s.api, { op: 'edit_card', avatar: 'kit.png', field: 'tags', set: ['__@@UNSET@@__'], why: 'x' })).ok, false);
});

test('the avatar must be a character, exactly as named', async () => {
    const s = fakeSt();
    const r = await apply.applyProposal(s.api, { op: 'edit_card', avatar: 'KIT.PNG', field: 'scenario', set: 'x', why: 'x' });
    assert.equal(r.ok, false);
    assert.match(r.error, /no character/i);
});

test('what the card showed must still be there when Apply is clicked', async () => {
    const s = fakeSt();
    const r = await apply.applyProposal(s.api, { op: 'edit_card', avatar: 'kit.png', field: 'scenario', set: 'x', why: 'x', shown: { current: 'Something else.' } });
    assert.equal(r.ok, false);
    assert.match(r.error, /changed since/i);
    const d = await apply.applyProposal(s.api, { op: 'delete_lorebook_entry', book: 'Saltmarsh', uid: 0, why: 'x', shown: { current: { comment: 'Another', content: 'x' } } });
    assert.equal(d.ok, false);
});

test('what to show on a card before it is applied', async () => {
    const s = fakeSt();
    assert.deepEqual(await apply.currentOf(s.api, { op: 'edit_card', avatar: 'kit.png', field: 'scenario', set: 'x' }), { current: 'An autumn morning.' });
    assert.deepEqual(await apply.currentOf(s.api, { op: 'delete_lorebook_entry', book: 'Saltmarsh', uid: 7 }), { current: { comment: 'Light', content: 'The lighthouse is dark.' } });
    assert.equal(await apply.currentOf(s.api, { op: 'create_lorebook', name: 'X' }), null);
});
