// Changes to the open chat (addons/copilot/apply-chat.cjs through apply.cjs)
// against a stand-in page: the chat in memory, saved to a real .jsonl file the
// way SillyTavern saves it, and chatState / chatApply answering like the
// app's page functions.
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
const tmp = () => { const d = fs.mkdtempSync(path.join(process.env.ST_TEST_DATA || os.tmpdir(), 'apc-')); made.push(d); return d; };
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const J = v => JSON.stringify(v ?? null);
const copy = v => JSON.parse(JSON.stringify(v));

function msg(i, isUser) {
    const m = { name: isUser ? 'Wren' : 'Kit', is_user: isUser, is_system: false, send_date: `2026-11-20T10:${String(i).padStart(2, '0')}:00.000Z`, mes: `Message ${i} ${isUser ? 'from Wren' : 'from Kit'}.`, extra: {} };
    if (!isUser) { m.swipe_id = 0; m.swipes = [m.mes]; m.swipe_info = [{ send_date: m.send_date, extra: {} }]; }
    return m;
}

function fakeChat({ count = 8 } = {}) {
    const root = tmp(), addon = tmp();
    fs.writeFileSync(path.join(root, 'server.js'), '');
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'sillytavern' }));
    const dir = path.join(root, 'data', 'default-user', 'chats', 'kit');
    fs.mkdirSync(dir, { recursive: true });
    const chatId = 'Kit - 2026-11-20@10h00m00s';
    const file = path.join(dir, `${chatId}.jsonl`);
    const st = { chatId, open: chatId, busy: null, header: { chat_metadata: { integrity: 'abc' }, user_name: 'unused', character_name: 'unused' }, chat: [] };
    for (let i = 0; i < count; i++) st.chat.push(msg(i, i % 2 === 1));
    const save = () => fs.writeFileSync(file, [st.header, ...st.chat].map(x => JSON.stringify(x)).join('\n'));
    save();
    const calls = [];
    const state = (indexes = []) => ({
        chatId: st.open, groupId: null, avatar: 'kit.png', characterName: 'Kit', members: [], userName: 'Wren',
        file: st.open ? `chats/kit/${st.open}.jsonl` : null, busy: st.busy, length: st.chat.length,
        messages: [...new Set(indexes)].filter(i => i >= 0 && i < st.chat.length).map(i => ({ index: i, message: copy(st.chat[i]) })),
    });
    function chatApply({ chatId: id, ops }) {
        if (st.failNext) { st.failNext = false; throw new Error('SillyTavern reloaded during the request.'); }
        if (st.busy) return { refused: st.busy, changed: false };
        if (st.open !== id) return { refused: 'The chat the co-pilot worked on isn\'t open in SillyTavern now.', changed: false };
        const sim = st.chat.slice();
        const fp = m => JSON.stringify([m?.name ?? '', !!m?.is_user, !!m?.is_system, m?.send_date ?? null, m?.mes ?? '', m?.swipe_id ?? null, Array.isArray(m?.swipes) ? m.swipes : null]);
        const same = (m, op) => m !== undefined && (op.identity ? m.send_date === op.identity.send_date && m.name === op.identity.name && !!m.is_user === !!op.identity.is_user : fp(m) === fp(op.expect));
        const locate = op => {
            if (op.identity) { const f = sim.map((m, i) => (same(m, op) ? i : -1)).filter(i => i >= 0); return f.length === 1 ? f[0] : -1; }
            if (Number.isInteger(op.index) && same(sim[op.index], op)) return op.index;
            if (op.search) { const f = sim.map((m, i) => (same(m, op) ? i : -1)).filter(i => i >= 0); if (f.length === 1) return f[0]; }
            return -1;
        };
        const madeNow = [];
        for (const op of ops) {
            if (op.kind === 'set') {
                const i = locate(op); if (i < 0) return { refused: 'that message changed or moved', changed: true };
                const n = copy(sim[i]); Object.assign(n, op.patch.fields || {});
                for (const [k, v] of Object.entries(op.patch.extra || {})) { if (v === null) { if (n.extra) delete n.extra[k]; } else (n.extra || (n.extra = {}))[k] = v; }
                sim[i] = n;
            }
            else if (op.kind === 'remove') { const i = locate(op); if (i < 0) return { refused: 'that message changed or moved', changed: true }; sim.splice(i, 1); }
            else if (op.kind === 'insert') {
                if (op.index < 0 || op.index > sim.length) return { refused: 'shorter', changed: true };
                if (op.prev !== undefined && (op.prev === null ? op.index !== 0 : fp(sim[op.index - 1]) !== fp(op.prev))) return { refused: 'the message before that place changed', changed: true };
                let m = op.message ? copy(op.message) : null;
                if (!m) { const k = op.make; m = k.isUser ? { name: 'Wren', is_user: true, is_system: false, send_date: '2026-11-24T00:00:00.000Z', mes: k.text, extra: {} } : { name: k.name, is_user: false, is_system: false, send_date: '2026-11-24T00:00:00.000Z', mes: k.text, extra: {}, swipe_id: 0, swipes: [k.text], swipe_info: [{ send_date: '2026-11-24T00:00:00.000Z', extra: {} }] }; }
                sim.splice(op.index, 0, m); madeNow.push(copy(m));
            }
        }
        st.chat.splice(0, st.chat.length, ...sim);
        save();
        return { length: st.chat.length, made: madeNow };
    }
    const api = {
        dir: addon,
        changes: openJournal(addon),
        sillytavern: {
            folder: () => root,
            async request(method, p) { if (p === '/api/users/me') return { handle: 'default-user' }; throw new Error(`unexpected request ${p}`); },
            async page(name, a = {}) {
                calls.push([name, a]);
                if (name === 'chatState') return state(a.indexes);
                if (name === 'chatApply') return chatApply(a);
                throw new Error(`unexpected page ${name}`);
            },
        },
    };
    // The user chatting in between: a message at the end, saved.
    const userSays = text => { st.chat.push({ ...msg(st.chat.length, true), mes: text }); save(); };
    const lines = () => fs.readFileSync(file, 'utf8').split('\n').map(l => JSON.parse(l));
    return { root, st, api, calls, file, userSays, lines, save };
}

// A proposal as the co-pilot stamps it at reply time.
const stamped = async (s, p) => ({ ...p, shown: await apply.currentOf(s.api, p) });

test('editing a message changes its text and the shown swipe; Undo puts the file back byte for byte', async () => {
    const s = fakeChat();
    s.st.chat[2].extra.display_text = 'Translated text';
    s.save();
    const h0 = sha(s.file);
    const p = await stamped(s, { op: 'edit_message', index: 2, find: 'from Kit', replace: 'from the ferry pilot', why: 'x' });
    assert.equal(p.shown.chatId, s.st.chatId);
    assert.equal(p.shown.current, 'Message 2 from Kit.');
    const r = await apply.applyProposal(s.api, p);
    assert.equal(r.ok, true, r.error);
    const m = s.lines()[3];
    assert.equal(m.mes, 'Message 2 from the ferry pilot.');
    assert.equal(m.swipes[0], 'Message 2 from the ferry pilot.');
    assert.equal(m.extra.display_text, undefined, 'the old translation no longer hides the new text');
    const u = await apply.undoChange(s.api, r.change);
    assert.equal(u.ok, true, u.error || JSON.stringify(u));
    assert.equal(sha(s.file), h0);
});

test('nothing is written when another chat is open, SillyTavern is busy, or the message moved', async () => {
    const s = fakeChat();
    const p = await stamped(s, { op: 'edit_message', index: 4, set: 'New text.', why: 'x' });
    const h0 = sha(s.file);
    s.st.open = 'Kit - another chat';
    let r = await apply.applyProposal(s.api, p);
    assert.equal(r.ok, false); assert.match(r.error, /isn't open/); assert.equal(r.change, undefined);
    s.st.open = s.st.chatId; s.st.busy = 'SillyTavern is writing a reply: wait until it is done.';
    r = await apply.applyProposal(s.api, p);
    assert.equal(r.ok, false); assert.match(r.error, /writing a reply/); assert.equal(r.change, undefined);
    s.st.busy = null;
    s.st.chat.splice(1, 0, msg(40, true)); s.save(); // a message appeared before it: index 4 is another message now
    r = await apply.applyProposal(s.api, p);
    assert.equal(r.ok, false); assert.match(r.error, /changed since/i); assert.equal(r.change, undefined);
    assert.notEqual(sha(s.file), h0); // (the user's own message)
    assert.equal(s.lines().some(m => m.mes === 'New text.'), false);
});

test('the user chats between Apply and Undo: Undo restores only that message', async () => {
    const s = fakeChat();
    const r = await apply.applyProposal(s.api, await stamped(s, { op: 'edit_message', index: 3, set: 'Edited by the co-pilot.', why: 'x' }));
    assert.equal(r.ok, true, r.error);
    s.userSays('A new message from Wren.');
    s.userSays('And another one.');
    const u = await apply.undoChange(s.api, r.change);
    assert.equal(u.ok, true, u.error || JSON.stringify(u));
    const l = s.lines();
    assert.equal(l[4].mes, 'Message 3 from Wren.');
    assert.equal(l.at(-1).mes, 'And another one.');
    assert.equal(l.length, 1 + 10);
});

test('Undo after the user changed the same message asks; "mine" puts the old text back', async () => {
    const s = fakeChat();
    const r = await apply.applyProposal(s.api, await stamped(s, { op: 'edit_message', index: 5, set: 'Co-pilot text.', why: 'x' }));
    s.st.chat[5] = { ...s.st.chat[5], mes: 'The user typed this.' }; s.save();
    const u = await apply.undoChange(s.api, r.change);
    assert.ok(u.conflict, JSON.stringify(u));
    assert.equal(u.conflict.current, 'The user typed this.');
    assert.equal(u.conflict.before, 'Message 5 from Wren.');
    const m = await apply.undoChange(s.api, r.change, { choice: 'mine' });
    assert.equal(m.ok, true, m.error);
    assert.equal(s.lines()[6].mes, 'Message 5 from Wren.');
});

test('adding a message puts it after the given one; Undo takes it out', async () => {
    const s = fakeChat();
    const h0 = sha(s.file);
    const r = await apply.applyProposal(s.api, await stamped(s, { op: 'add_message', after: 2, isUser: false, text: 'An added line.', why: 'x' }));
    assert.equal(r.ok, true, r.error);
    const l = s.lines();
    assert.equal(l[4].mes, 'An added line.'); assert.equal(l[4].name, 'Kit'); assert.equal(l.length, 1 + 9);
    s.userSays('Chatting on.');
    const u = await apply.undoChange(s.api, r.change);
    assert.equal(u.ok, true, u.error || JSON.stringify(u));
    assert.equal(s.lines().some(m => m.mes === 'An added line.'), false);
    assert.equal(s.lines().at(-1).mes, 'Chatting on.');
    void h0;
});

test('a user message is written as the persona in use; a character message only as the character', async () => {
    const s = fakeChat();
    let r = await apply.applyProposal(s.api, await stamped(s, { op: 'add_message', after: 0, isUser: true, name: 'Someone else', text: 'x', why: 'x' }));
    assert.equal(r.ok, false); assert.match(r.error, /Wren/);
    r = await apply.applyProposal(s.api, await stamped(s, { op: 'add_message', after: 0, isUser: false, name: 'Mira', text: 'x', why: 'x' }));
    assert.equal(r.ok, false); assert.match(r.error, /Kit/);
    r = await apply.applyProposal(s.api, await stamped(s, { op: 'add_message', after: 0, isUser: true, text: 'From Wren.', why: 'x' }));
    assert.equal(r.ok, true, r.error);
    assert.equal(s.lines()[2].name, 'Wren');
});

test('deleting messages and Undo bring them back in their places, byte for byte', async () => {
    const s = fakeChat();
    const h0 = sha(s.file);
    const r = await apply.applyProposal(s.api, await stamped(s, { op: 'delete_messages', indexes: [4, 2], why: 'x' }));
    assert.equal(r.ok, true, r.error);
    assert.equal(s.lines().length, 1 + 6);
    assert.equal(s.lines().some(m => m.mes === 'Message 2 from Kit.' || m.mes === 'Message 4 from Kit.'), false);
    const u = await apply.undoChange(s.api, r.change);
    assert.equal(u.ok, true, u.error || JSON.stringify(u));
    assert.equal(sha(s.file), h0);
});

test('hiding and showing messages, and Undo', async () => {
    const s = fakeChat();
    const h0 = sha(s.file);
    const r = await apply.applyProposal(s.api, await stamped(s, { op: 'hide_messages', indexes: [1, 3], why: 'x' }));
    assert.equal(r.ok, true, r.error);
    assert.equal(s.lines()[2].is_system, true); assert.equal(s.lines()[4].is_system, true);
    const again = await apply.applyProposal(s.api, await stamped(s, { op: 'hide_messages', indexes: [1], why: 'x' }));
    assert.equal(again.ok, false); assert.match(again.error, /already/);
    const show = await apply.applyProposal(s.api, await stamped(s, { op: 'unhide_messages', indexes: [3], why: 'x' }));
    assert.equal(show.ok, true, show.error);
    assert.equal(s.lines()[4].is_system, false);
    assert.equal((await apply.undoChange(s.api, show.change)).ok, true);
    assert.equal((await apply.undoChange(s.api, r.change)).ok, true);
    assert.equal(sha(s.file), h0);
});

test('a message index that does not exist, or no chat open, is refused before anything', async () => {
    const s = fakeChat();
    let r = await apply.applyProposal(s.api, await stamped(s, { op: 'edit_message', index: 99, set: 'x', why: 'x' }));
    assert.equal(r.ok, false); assert.match(r.error, /no message 99/i);
    s.st.open = null;
    r = await apply.applyProposal(s.api, { op: 'delete_messages', indexes: [1], why: 'x' });
    assert.equal(r.ok, false); assert.match(r.error, /no chat is open/i);
    assert.equal(s.api.changes.list({}).length, 0);
});

test('SillyTavern adding token counts to messages between reads changes nothing for the co-pilot', async () => {
    const s = fakeChat();
    const p = await stamped(s, { op: 'edit_message', index: 4, set: 'Edited with token counts around.', why: 'x' });
    for (const m of s.st.chat) m.extra.token_count = 7; // done by SillyTavern after a render
    s.save();
    const h1 = sha(s.file);
    const r = await apply.applyProposal(s.api, p);
    assert.equal(r.ok, true, r.error);
    assert.equal(s.lines()[5].extra.token_count, 7, 'its token count stays');
    for (const m of s.st.chat) m.extra.token_count = 9;
    s.save();
    const d = await apply.applyProposal(s.api, await stamped(s, { op: 'delete_messages', indexes: [2], why: 'x' }));
    assert.equal(d.ok, true, d.error);
    for (const m of s.st.chat) m.extra.token_count = 11;
    s.save();
    assert.equal((await apply.undoChange(s.api, d.change)).ok, true);
    const u = await apply.undoChange(s.api, r.change);
    assert.equal(u.ok, true, u.error || JSON.stringify(u));
    assert.equal(s.lines()[5].mes, 'Message 4 from Kit.');
    void h1;
});

// ---- review fixes (Batch 8) ----
test('a chat card that was never checked against a chat is refused', async () => {
    const s = fakeChat();
    const r = await apply.applyProposal(s.api, { op: 'delete_messages', indexes: [2, 3], why: 'x' });
    assert.equal(r.ok, false); assert.match(r.error, /checked against a chat/);
    assert.equal(s.lines().length, 1 + 8);
    assert.equal(s.api.changes.list({}).length, 0);
});

test('a card made while another chat opened names the chat the turn read, and is refused', async () => {
    const s = fakeChat();
    const turn = { chatId: 'Kit - the chat the model read' };
    const p = { op: 'edit_message', index: 2, set: 'x', why: 'x' };
    const stamped2 = { ...p, shown: await apply.currentOf(s.api, p, turn) };
    assert.equal(stamped2.shown.chatId, turn.chatId);
    let r = await apply.applyProposal(s.api, stamped2);
    assert.equal(r.ok, false); assert.match(r.error, /isn't open/);
    s.st.open = turn.chatId;
    r = await apply.applyProposal(s.api, stamped2);
    assert.equal(r.ok, false); assert.match(r.error, /changed since/);
});

test('Undo of hiding a message that had no is_system field shows it again', async () => {
    const s = fakeChat();
    delete s.st.chat[3].is_system; s.save();
    const r = await apply.applyProposal(s.api, await stamped(s, { op: 'hide_messages', indexes: [3], why: 'x' }));
    assert.equal(r.ok, true, r.error);
    assert.equal(s.lines()[4].is_system, true);
    const u = await apply.undoChange(s.api, r.change);
    assert.equal(u.ok, true, u.error || JSON.stringify(u));
    assert.equal(!!s.lines()[4].is_system, false);
});

test('"Put back" is refused when several messages look the same, and overwrites nothing', async () => {
    const s = fakeChat();
    for (const i of [2, 4, 6]) s.st.chat[i].send_date = '2026-11-20T10:00:00.000Z'; // as an import writes them
    s.save();
    const r = await apply.applyProposal(s.api, await stamped(s, { op: 'edit_message', index: 4, set: 'Co-pilot text.', why: 'x' }));
    assert.equal(r.ok, true, r.error);
    s.st.chat.splice(1, 1); s.st.chat[3] = { ...s.st.chat[3], mes: 'The user edited this.' }; s.save();
    const u = await apply.undoChange(s.api, r.change);
    assert.ok(u.conflict, JSON.stringify(u));
    const before = s.lines().map(m => m.mes);
    const m = await apply.undoChange(s.api, r.change, { choice: 'mine' });
    assert.equal(m.ok, false); assert.match(m.error, /for sure/);
    assert.deepEqual(s.lines().map(x => x.mes), before);
});

test('Undo of a delete that never happened (the page reloaded during Apply) writes nothing', async () => {
    const s = fakeChat();
    s.st.failNext = true;
    const r = await apply.applyProposal(s.api, await stamped(s, { op: 'delete_messages', indexes: [2, 3], why: 'x' }));
    assert.equal(r.ok, false); assert.ok(r.change, 'the copy was taken, so the change is kept');
    const u = await apply.undoChange(s.api, r.change);
    assert.equal(u.ok, true, u.error || JSON.stringify(u)); assert.equal(u.how, 'nothing to undo');
    assert.equal(s.lines().length, 1 + 8, 'no copies put in');
});
