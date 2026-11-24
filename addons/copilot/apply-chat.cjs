// Co-pilot: changes to the open chat. SillyTavern's page holds the open chat
// and saves it whole, so every change goes through the page (chatState /
// chatApply in the app's stpage.js). Messages have no id: a change names the
// message it expects, as the co-pilot's card showed it, and is refused when
// the chat moved on. The chat file is copied into the change journal before
// SillyTavern's own pending save goes out (that save can rewrite an old
// chat). Undo is per message: the user may have chatted on since.
'use strict';
const fs = require('fs');
const path = require('path');
const { fail, same, copy, checkValue, edited, handleOf, written, CHANGED } = require('./apply-util.cjs');

const OPS = new Set(['edit_message', 'add_message', 'delete_messages', 'hide_messages', 'unhide_messages']);
const MAX_MESSAGES = 200;
const NOT_OPEN = 'The chat the co-pilot worked on isn\'t open in SillyTavern now: open it, then try again.';

const state = (api, indexes = []) => api.sillytavern.page('chatState', { indexes });
// The messages a proposal is about (shown on its card, checked at Apply).
const touched = p => (p.op === 'edit_message' ? [p.index] : p.op === 'add_message' ? [p.after] : Array.isArray(p.indexes) ? p.indexes : [])
    .filter(i => Number.isInteger(i) && i >= 0);
// A message as the user sees it: SillyTavern adds things of its own to
// messages in memory (token counts, for one), so whole objects can't be
// compared. The page's chatApply compares the same way.
const fp = m => JSON.stringify([m?.name ?? '', !!m?.is_user, !!m?.is_system, m?.send_date ?? null, m?.mes ?? '', m?.swipe_id ?? null, Array.isArray(m?.swipes) ? m.swipes : null]);
const sameMsg = (a, b) => (a == null || b == null ? a == null && b == null : fp(a) === fp(b));
// The fields an edit or hide changes, as a patch from one version to another.
const patchTo = (from, to) => {
    const fields = {}, extra = {};
    for (const k of ['mes', 'swipes']) if (!same(from?.[k], to?.[k]) && to?.[k] !== undefined) fields[k] = to[k];
    // (a message without is_system counts as shown)
    if (!!from?.is_system !== !!to?.is_system) fields.is_system = !!to?.is_system;
    if (!same(from?.extra?.display_text, to?.extra?.display_text)) extra.display_text = to?.extra?.display_text ?? null;
    return { fields, extra };
};
const describe = m => (m ? `${m.is_system ? '(hidden) ' : ''}${String(m.mes ?? '')}` : '(not in the chat)');

// turn.chatId: the chat open when the user sent the message (the one the
// model read). Another chat open by the time the reply ends: the card names
// the turn's chat and has no messages, so Apply refuses.
async function currentOf(api, p, turn = {}) {
    const st = await state(api, touched(p));
    if (turn.chatId && st.chatId !== turn.chatId) return { chatId: turn.chatId, messages: [] };
    if (!st.chatId) return null;
    const out = { chatId: st.chatId, messages: st.messages };
    if (p.op === 'edit_message') {
        const m = st.messages.find(x => x.index === p.index);
        if (m) out.current = String(m.message.mes ?? '');
    }
    return out;
}

// Reads the chat and checks what every change needs: a chat open, the same
// one the card was about, SillyTavern not busy, the messages there and as
// shown, the file in the data folder. need: indexes that must exist; extra:
// indexes read too (the neighbours of deleted messages).
async function begin(api, p, need, extra = []) {
    const st = await state(api, [...need, ...extra].filter(i => i >= 0));
    if (!st.chatId || !st.file) return { error: 'No chat is open in SillyTavern: open the chat first.' };
    // A card is only applied to the chat and messages it was checked against.
    if (!p.shown?.chatId) return { error: 'This card wasn\'t checked against a chat when it was made (no chat was open, or SillyTavern didn\'t answer): ask the co-pilot again with the chat open.' };
    if (st.chatId !== p.shown.chatId) return { error: NOT_OPEN };
    if (st.busy) return { error: st.busy };
    const at = new Map(st.messages.map(m => [m.index, m.message]));
    for (const i of need) if (!at.has(i)) return { error: `The open chat has no message ${i}.` };
    const shown = new Map((p.shown.messages || []).map(m => [m.index, m.message]));
    for (const i of need) if (!shown.has(i)) return { error: CHANGED };
    for (const [i, m] of shown) if (!sameMsg(at.get(i), m)) return { error: CHANGED };
    const rel = `data/${await handleOf(api)}/${st.file}`;
    if (!fs.existsSync(path.join(api.sillytavern.folder(), rel))) return { error: 'This chat\'s file isn\'t in this SillyTavern\'s data folder, so no copy could be kept: nothing was written.' };
    return { st, at, rel };
}

// The chat file's lines: [header, ...messages].
const lines = (api, rel) => fs.readFileSync(path.join(api.sillytavern.folder(), rel), 'utf8').split('\n').filter(l => l.trim());
const lineIs = (all, index, m) => { try { return sameMsg(JSON.parse(all[index + 1]), m); } catch { return false; } };
// Every message line once, as fingerprints (a check looks many up).
const fps = all => new Set(all.slice(1).map(l => { try { return fp(JSON.parse(l)); } catch { return ''; } }));

// Copy, change through the page, check the file. A refusal before the write
// (busy, another chat, the chat moved on) keeps nothing to undo.
async function run(api, b, p, { kind, target, before, after, ops, check }) {
    const folder = api.sillytavern.folder();
    const journal = await api.changes.record({ folder, kind, target: { chatId: b.st.chatId, ...target }, before, after, files: [b.rel] });
    const change = { journal, op: p.op, target: { chatId: b.st.chatId, ...target }, file: b.rel };
    let res = null;
    const r = await written(api, journal, change, async () => {
        res = await api.sillytavern.page('chatApply', { chatId: b.st.chatId, ops });
        if (res?.refused) throw new Error(res.changed ? CHANGED : res.refused);
        if (res?.made?.[0]) change.added = res.made[0];
    }, async () => {
        const all = lines(api, b.rel);
        if (all.length - 1 !== res.length) return 'SillyTavern didn\'t save the chat as expected. Undo puts it back.';
        return check(all, res, change);
    });
    return !r.ok && res?.refused ? fail(r.error) : r;
}

async function applyChat(api, p) {
    if (p.op === 'edit_message') {
        const b = await begin(api, p, [p.index]);
        if (b.error) return fail(b.error);
        const m = b.at.get(p.index);
        const r = edited(m.mes, p, 'text');
        if (r.error) return fail(r.error);
        if (r.value === m.mes) return fail('It is already like that: nothing to change.');
        const next = copy(m);
        next.mes = r.value;
        // The shown swipe is the message's text too.
        if (Array.isArray(next.swipes) && Number.isInteger(next.swipe_id) && next.swipe_id >= 0 && next.swipe_id < next.swipes.length) next.swipes[next.swipe_id] = r.value;
        // A translation shown instead of the text would hide the change.
        if (next.extra && Object.hasOwn(next.extra, 'display_text')) delete next.extra.display_text;
        return run(api, b, p, {
            kind: 'chat-messages', target: { index: p.index },
            before: { sets: [{ index: p.index, message: m }] }, after: { sets: [{ index: p.index, message: next }] },
            ops: [{ kind: 'set', index: p.index, expect: m, patch: patchTo(m, next) }],
            check: all => (lineIs(all, p.index, next) ? null : 'SillyTavern saved something else than proposed. Undo puts the message back.'),
        });
    }
    if (p.op === 'hide_messages' || p.op === 'unhide_messages') {
        const hide = p.op === 'hide_messages';
        const idx = [...new Set(p.indexes || [])].sort((a, c) => a - c);
        if (!idx.length || idx.length > MAX_MESSAGES) return fail(`Name 1 to ${MAX_MESSAGES} messages.`);
        const b = await begin(api, p, idx);
        if (b.error) return fail(b.error);
        const sets = [];
        for (const i of idx) {
            const m = b.at.get(i);
            if (!!m.is_system === hide) continue;
            // Narrator and comment messages are system messages by nature.
            if (!hide && ['narrator', 'comment'].includes(m.extra?.type)) return fail(`Message ${i} is a narrator or comment message: it can't be shown as a chat message.`);
            sets.push({ index: i, before: m, after: { ...copy(m), is_system: hide } });
        }
        if (!sets.length) return fail('It is already like that: nothing to change.');
        return run(api, b, p, {
            kind: 'chat-messages', target: { indexes: sets.map(x => x.index) },
            before: { sets: sets.map(x => ({ index: x.index, message: x.before })) }, after: { sets: sets.map(x => ({ index: x.index, message: x.after })) },
            ops: sets.map(x => ({ kind: 'set', index: x.index, expect: x.before, patch: patchTo(x.before, x.after) })),
            check: all => (sets.every(x => lineIs(all, x.index, x.after)) ? null : 'SillyTavern saved something else than proposed. Undo puts the messages back.'),
        });
    }
    if (p.op === 'add_message') {
        if (!Number.isInteger(p.after) || p.after < -1) return fail('"after" must be a message index (or -1 for the start).');
        const bad = checkValue('text', p.text);
        if (bad || !String(p.text).trim()) return fail(`The message ${bad || 'is empty'}.`);
        const b = await begin(api, p, p.after >= 0 ? [p.after] : []);
        if (b.error) return fail(b.error);
        if (p.after >= b.st.length) return fail(`The open chat has no message ${p.after}.`);
        let name = '';
        if (p.isUser) {
            if (p.name != null && p.name !== b.st.userName) return fail(`Your messages are written as the persona in use ("${b.st.userName}"). Switch persona in SillyTavern to write as someone else.`);
        } else if (b.st.groupId) {
            if (!b.st.members.includes(p.name)) return fail(`In this group chat, "name" must be one of: ${b.st.members.join(', ')}.`);
            name = p.name;
        } else {
            if (p.name != null && p.name !== b.st.characterName) return fail(`In this chat, character messages are written as "${b.st.characterName}".`);
            name = b.st.characterName;
        }
        const index = p.after + 1;
        const prev = p.after >= 0 ? b.at.get(p.after) : null;
        return run(api, b, p, {
            kind: 'chat-message-add', target: { index },
            before: { prev }, after: { isUser: !!p.isUser, name, text: p.text },
            ops: [{ kind: 'insert', index, prev, make: { isUser: !!p.isUser, name, text: p.text } }],
            check: (all, res) => {
                const m = res.made?.[0];
                return m && m.mes === p.text && lineIs(all, index, m) ? null : 'SillyTavern saved something else than proposed. Undo takes the message out.';
            },
        });
    }
    if (p.op === 'delete_messages') {
        const idx = [...new Set(p.indexes || [])].sort((a, c) => a - c);
        if (!idx.length || idx.length > MAX_MESSAGES) return fail(`Name 1 to ${MAX_MESSAGES} messages.`);
        const b = await begin(api, p, idx, idx.map(i => i - 1));
        if (b.error) return fail(b.error);
        // Each with the message before it in the chat as it is now (Undo puts them back there).
        const removed = idx.map(i => ({ index: i, message: b.at.get(i), prev: i > 0 ? b.at.get(i - 1) : null }));
        const length = b.st.length;
        return run(api, b, p, {
            kind: 'chat-messages-delete', target: { indexes: idx },
            before: { removed }, after: null,
            ops: [...removed].reverse().map(x => ({ kind: 'remove', index: x.index, expect: x.message })),
            check: all => (all.length - 1 === length - idx.length ? null : 'SillyTavern didn\'t save the chat as expected. Undo puts the messages back.'),
        });
    }
    return fail('Applying this kind of change comes in the next version of the co-pilot.');
}

// Undo, per message. choice: undefined (decide), 'mine' (put it back over a
// later change), 'keep' is handled by the caller.
async function undoChat(api, change, e, { choice } = {}) {
    const st = await state(api);
    if (!st.chatId) return fail('Open the chat this change was made in, then Undo.');
    if (st.chatId !== change.target.chatId) return fail('The chat this change was made in isn\'t open in SillyTavern: open it, then Undo.');
    if (st.busy) return fail(st.busy);
    const mine = choice === 'mine';
    let ops, check, conflict;
    if (change.op === 'add_message') {
        const m = change.added;
        if (!m) return fail('The added message wasn\'t read back, so it can\'t be found again.');
        const ident = { send_date: m.send_date, name: m.name, is_user: m.is_user };
        ops = [{ kind: 'remove', index: change.target.index, ...(mine ? { identity: ident } : { expect: m }), search: true }];
        conflict = async () => ({ current: describe((await state(api, [change.target.index])).messages[0]?.message), before: '(no message)', after: m.mes });
        check = all => (fps(all).has(fp(m)) ? 'The message is still there.' : null);
    } else if (change.op === 'delete_messages') {
        const removed = e.before.removed;
        const now = await state(api, removed.map(x => x.index));
        const still = removed.filter(x => sameMsg(now.messages.find(m => m.index === x.index)?.message, x.message));
        if (still.length === removed.length) return { ok: true, how: 'nothing to undo', note: 'The messages were never deleted.' };
        if (still.length) return fail('Some of these messages are still in the chat, so Undo can\'t tell where the others belong: nothing was written.');
        ops = removed.map(x => ({ kind: 'insert', index: x.index, message: x.message, ...(mine ? {} : { prev: x.prev }) }));
        conflict = async () => ({ current: 'The messages around them changed since.', before: removed.map(x => x.message.mes).join('\n'), after: '(deleted)' });
        check = all => (removed.every(x => lineIs(all, x.index, x.message)) ? null : 'SillyTavern saved something else. The messages may be in other places.');
    } else {
        const sets = e.before.sets.map((x, k) => ({ index: x.index, before: x.message, after: e.after.sets[k].message }));
        ops = sets.map(x => ({ kind: 'set', index: x.index, patch: patchTo(x.after, x.before), search: true,
            ...(mine ? { identity: { send_date: x.before.send_date, name: x.before.name, is_user: x.before.is_user } } : { expect: x.after }) }));
        conflict = async () => {
            const now = await state(api, sets.map(x => x.index));
            return { current: sets.map(x => describe(now.messages.find(m => m.index === x.index)?.message)).join('\n'), before: sets.map(x => describe(x.before)).join('\n'), after: sets.map(x => describe(x.after)).join('\n') };
        };
        check = all => { const have = fps(all); return sets.every(x => have.has(fp(x.before))) ? null : 'SillyTavern saved something else than expected.'; };
    }
    try {
        const res = await api.sillytavern.page('chatApply', { chatId: change.target.chatId, ops });
        if (res?.refused) {
            if (!res.changed) return fail(res.refused);
            if (mine) return fail('That message can\'t be found for sure (it is gone, or several messages look the same): nothing was written.');
            return { conflict: await conflict() };
        }
        const problem = check(lines(api, change.file));
        return problem ? fail(problem) : { ok: true, how: 'item' };
    } catch (err) {
        return fail(err.message || String(err));
    }
}

module.exports = { OPS, applyChat, undoChat, currentOf };
