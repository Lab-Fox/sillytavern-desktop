// The change journal add-ons use before they change SillyTavern's files.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { openJournal } from '../../changes.js';

const made = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(process.env.ST_TEST_DATA || os.tmpdir(), 'ch-')); made.push(d); return d; };
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

// A pretend SillyTavern folder with a little data.
function fakeSt() {
    const root = tmp();
    fs.writeFileSync(path.join(root, 'server.js'), '');
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'sillytavern' }));
    fs.writeFileSync(path.join(root, 'config.yaml'), 'port: 8000\n');
    const user = path.join(root, 'data', 'default-user');
    fs.mkdirSync(path.join(user, 'worlds'), { recursive: true });
    fs.mkdirSync(path.join(root, 'public', 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(user, 'worlds', 'Lore.json'), JSON.stringify({ entries: { 0: { content: 'old' } } }));
    fs.writeFileSync(path.join(user, 'settings.json'), '{"a":1}');
    return { root, user, addon: tmp() };
}

test('round trip byte-identical', async () => {
    const { root, user, addon } = fakeSt();
    const j = openJournal(addon);
    const f = path.join(user, 'worlds', 'Lore.json');
    const before = sha(f);
    const id = await j.record({ folder: root, kind: 'lorebook-entry', target: { book: 'Lore', uid: 0 }, before: { content: 'old' }, after: { content: 'new' }, files: [f] });
    fs.writeFileSync(f, JSON.stringify({ entries: { 0: { content: 'new' } } }));
    await j.finish(id);
    const e = j.get(id);
    assert.equal(e.kind, 'lorebook-entry');
    assert.deepEqual(e.target, { book: 'Lore', uid: 0 });
    assert.deepEqual(e.before, { content: 'old' });
    assert.equal(e.files[0].rel, 'data/default-user/worlds/Lore.json');
    assert.equal(e.files[0].sha256, before);
    assert.equal(sha(j.safetyCopy(id, f)), before);
    await j.restoreFile(id, f);
    assert.equal(sha(f), before);
});

test('relative paths and a file that did not exist', async () => {
    const { root, user, addon } = fakeSt();
    const j = openJournal(addon);
    const id = await j.record({ folder: root, kind: 'lorebook', target: 'New', files: ['data/default-user/worlds/New.json'] });
    const f = path.join(user, 'worlds', 'New.json');
    fs.writeFileSync(f, '{}');
    await j.finish(id);
    assert.equal(j.get(id).files[0].existed, false);
    assert.equal(j.safetyCopy(id, f), null);
    await j.restoreFile(id, f);
    assert.equal(fs.existsSync(f), false);
});

test('refuses outside data/public', async () => {
    const { root, user, addon } = fakeSt();
    const j = openJournal(addon);
    const bad = [path.join(root, 'config.yaml'), path.join(user, '..', '..', 'config.yaml'), 'data/../config.yaml', path.join(os.tmpdir(), 'x.json'), path.join(root, 'server.js')];
    for (const f of bad) await assert.rejects(() => j.record({ folder: root, kind: 'x', target: 'x', files: [f] }), /inside|outside/i, f);
    assert.equal(j.list({ folder: root }).length, 0);
    // SillyTavern's own code in public/ is refused; third-party extensions there are allowed.
    await assert.rejects(() => j.record({ folder: root, kind: 'x', target: 'x', files: [path.join(root, 'public', 'scripts', 'a.js')] }), /inside|outside/i);
    await assert.rejects(() => j.record({ folder: root, kind: 'x', target: 'x', files: [path.join(root, 'public', 'index.html')] }), /inside|outside/i);
    await j.record({ folder: root, kind: 'x', target: 'x', files: [path.join(root, 'public', 'scripts', 'extensions', 'third-party', 'my-ext', 'index.js')] });
    // odd Windows names
    for (const f of ['settings.json:stream', 'x.json.', 'x.json ', 'CON', 'nul.json']) await assert.rejects(() => j.record({ folder: root, kind: 'x', target: 'x', files: [path.join(user, f)] }), /name/i, f);
});

test('refuses links and junctions', async () => {
    const { root, user, addon } = fakeSt();
    const outside = tmp();
    fs.writeFileSync(path.join(outside, 'secret.json'), '{}');
    fs.symlinkSync(outside, path.join(user, 'linked'), 'junction');
    const j = openJournal(addon);
    await assert.rejects(() => j.record({ folder: root, kind: 'x', target: 'x', files: [path.join(user, 'linked', 'secret.json')] }), /link|junction|outside/i);
    await assert.rejects(() => j.record({ folder: root, kind: 'x', target: 'x', files: [path.join(user, 'linked', 'new.json')] }), /link|junction|outside/i);
});

test('emoji and long names', async () => {
    const { root, user, addon } = fakeSt();
    const j = openJournal(addon);
    const dir = path.join(user, 'chats', 'Ünïcode 🦊 ' + 'x'.repeat(80));
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, `🍺 chat ${'y'.repeat(60)}.jsonl`);
    fs.writeFileSync(f, '{"a":"🦊"}\n');
    const before = sha(f);
    const id = await j.record({ folder: root, kind: 'chat', target: 'x', files: [f] });
    fs.writeFileSync(f, 'changed');
    await j.restoreFile(id, f, { force: true });
    assert.equal(sha(f), before);
});

test('record before the write leaves the file untouched', async () => {
    const { root, user, addon } = fakeSt();
    const j = openJournal(addon);
    const f = path.join(user, 'settings.json');
    const before = sha(f);
    const id = await j.record({ folder: root, kind: 'persona', target: 'p', files: [f] });
    // (the add-on crashes here, before writing)
    const again = openJournal(addon); // a fresh start reads it from disk
    assert.ok(again.get(id));
    assert.equal(again.get(id).finished, false);
    assert.equal(sha(f), before);
});

test('changed since is refused, force restores', async () => {
    const { root, user, addon } = fakeSt();
    const j = openJournal(addon);
    const f = path.join(user, 'settings.json');
    const before = sha(f);
    const id = await j.record({ folder: root, kind: 'persona', target: 'p', files: [f] });
    fs.writeFileSync(f, '{"a":2}');
    await j.finish(id);
    fs.writeFileSync(f, '{"a":3}'); // SillyTavern saved it again
    await assert.rejects(() => j.restoreFile(id, f), /changed since/i);
    assert.notEqual(sha(f), before);
    await j.restoreFile(id, f, { force: true });
    assert.equal(sha(f), before);
});

test('prune keeps the newest and the recent', async () => {
    const { root, user, addon } = fakeSt();
    const j = openJournal(addon);
    const f = path.join(user, 'settings.json');
    const ids = [];
    for (let i = 0; i < 6; i++) ids.push(await j.record({ folder: root, kind: 'x', target: i, files: [f] }));
    // the first four are 40 days old
    const old = Date.now() - 40 * 864e5;
    for (const id of ids.slice(0, 4)) {
        const p = path.join(addon, 'user', 'changes', id, 'entry.json');
        const e = JSON.parse(fs.readFileSync(p, 'utf8')); e.at = old; fs.writeFileSync(p, JSON.stringify(e));
    }
    const removed = j.prune({ days: 30, keep: 3 });
    assert.equal(removed, 3); // old ones beyond the newest 3: ids 0, 1, 2 (id 3 is among the newest 3)
    assert.deepEqual(j.list({ folder: root }).map(e => e.id).sort(), ids.slice(3).sort());
});

test('not a SillyTavern folder refused', async () => {
    const addon = tmp(), other = tmp();
    fs.mkdirSync(path.join(other, 'data'));
    fs.writeFileSync(path.join(other, 'data', 'a.json'), '{}');
    await assert.rejects(() => openJournal(addon).record({ folder: other, kind: 'x', target: 'x', files: [path.join(other, 'data', 'a.json')] }), /SillyTavern folder/i);
});

test('list is per folder and newest first, without item data', async () => {
    const a = fakeSt(), b = fakeSt();
    const j = openJournal(a.addon);
    const one = await j.record({ folder: a.root, kind: 'x', target: 1, before: { big: 'x' }, files: [path.join(a.user, 'settings.json')] });
    const two = await j.record({ folder: a.root, kind: 'x', target: 2, files: [path.join(a.user, 'settings.json')] });
    await j.record({ folder: b.root, kind: 'x', target: 3, files: [path.join(b.user, 'settings.json')] });
    const l = j.list({ folder: a.root });
    assert.deepEqual(l.map(e => e.id), [two, one]);
    assert.equal('before' in l[0], false);
});

test('a half-written entry is ignored', async () => {
    const { root, user, addon } = fakeSt();
    const j = openJournal(addon);
    await j.record({ folder: root, kind: 'x', target: 'x', files: [path.join(user, 'settings.json')] });
    fs.mkdirSync(path.join(addon, 'user', 'changes', 'broken', 'files'), { recursive: true }); // copies but no entry.json
    assert.equal(j.list({ folder: root }).length, 1);
    assert.equal(j.get('broken'), null);
    assert.equal(j.get('../x'), null);
});

test('a link to something missing is refused too', async () => {
    const { root, user, addon } = fakeSt();
    const gone = path.join(tmp(), 'not-there');
    fs.symlinkSync(gone, path.join(user, 'dangling'), 'junction');
    const j = openJournal(addon);
    await assert.rejects(() => j.record({ folder: root, kind: 'x', target: 'x', files: [path.join(user, 'dangling', 'x.json')] }), /link|junction/i);
    await assert.rejects(() => j.record({ folder: root, kind: 'x', target: 'x', files: [path.join(user, 'dangling')] }), /link|junction/i);
});

test('a data folder moved elsewhere with a junction still works', async () => {
    const { root, user, addon } = fakeSt();
    const moved = path.join(tmp(), 'data');
    fs.cpSync(path.join(root, 'data'), moved, { recursive: true });
    fs.rmSync(path.join(root, 'data'), { recursive: true });
    fs.symlinkSync(moved, path.join(root, 'data'), 'junction');
    const j = openJournal(addon);
    const f = path.join(user, 'settings.json');
    const before = sha(f);
    const id = await j.record({ folder: root, kind: 'x', target: 'x', files: [f] });
    fs.writeFileSync(f, 'changed');
    await j.restoreFile(id, f, { force: true });
    assert.equal(sha(f), before);
});

test('restore before finish: refused when the file changed, nothing to do when it did not', async () => {
    const { root, user, addon } = fakeSt();
    const j = openJournal(addon);
    const f = path.join(user, 'settings.json');
    const id = await j.record({ folder: root, kind: 'x', target: 'x', files: [f] });
    assert.equal(await j.restoreFile(id, f), true); // unchanged: fine
    fs.writeFileSync(f, '{"a":9}');           // the write failed to finish, then SillyTavern saved
    await assert.rejects(() => j.restoreFile(id, f), /changed since/i);
    assert.equal(fs.readFileSync(f, 'utf8'), '{"a":9}');
    // a file that didn't exist, made by SillyTavern since: not deleted
    const n = path.join(user, 'worlds', 'Made.json');
    const id2 = await j.record({ folder: root, kind: 'x', target: 'x', files: [n] });
    fs.writeFileSync(n, '{}');
    await assert.rejects(() => j.restoreFile(id2, n), /changed since/i);
    assert.equal(fs.existsSync(n), true);
});

test('a damaged copy is never restored', async () => {
    const { root, user, addon } = fakeSt();
    const j = openJournal(addon);
    const f = path.join(user, 'settings.json');
    const id = await j.record({ folder: root, kind: 'x', target: 'x', files: [f] });
    fs.writeFileSync(j.safetyCopy(id, f), 'garbage');
    fs.writeFileSync(f, '{"a":5}');
    await assert.rejects(() => j.restoreFile(id, f, { force: true }), /damaged/i);
    assert.equal(fs.readFileSync(f, 'utf8'), '{"a":5}');
});

test('the same file content is stored once', async () => {
    const { root, user, addon } = fakeSt();
    const j = openJournal(addon);
    const f = path.join(user, 'worlds', 'Lore.json');
    const a = await j.record({ folder: root, kind: 'x', target: 1, files: [f] });
    const b = await j.record({ folder: root, kind: 'x', target: 2, files: [f] });
    assert.equal(j.safetyCopy(a, f), j.safetyCopy(b, f));
    assert.equal(j.size(), fs.statSync(f).size);
    j.prune({ days: 0, keep: 1 }); // a goes, b keeps the copy
    assert.ok(fs.existsSync(j.safetyCopy(b, f)));
    j.prune({ days: 0, keep: 0 });
    assert.equal(j.size(), 0);
});

test('entries stay small: item data is kept apart', async () => {
    const { root, user, addon } = fakeSt();
    const j = openJournal(addon);
    const id = await j.record({ folder: root, kind: 'x', target: 'x', before: { text: 'B'.repeat(1000) }, after: { text: 'A' }, files: [path.join(user, 'settings.json')] });
    const entry = fs.readFileSync(path.join(addon, 'user', 'changes', id, 'entry.json'), 'utf8');
    assert.equal(entry.includes('BBBB'), false);
    assert.equal(j.get(id).before.text.length, 1000);
});

test('a failed record leaves nothing behind', async () => {
    const { root, user, addon } = fakeSt();
    const j = openJournal(addon);
    const dirFile = path.join(user, 'worlds'); // a folder, not a file
    await assert.rejects(() => j.record({ folder: root, kind: 'x', target: 'x', files: [path.join(user, 'settings.json'), dirFile] }));
    const left = fs.existsSync(path.join(addon, 'user', 'changes')) ? fs.readdirSync(path.join(addon, 'user', 'changes')).filter(x => x !== 'blobs') : [];
    assert.deepEqual(left, []);
    assert.equal(j.size(), 0);
});
