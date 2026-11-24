// Co-pilot: applying a proposal, and taking it back. Every change follows
// the same steps: save the user's pending typing, read the item fresh,
// check the change still fits it (and still matches what the card showed),
// copy the file into the change journal (api.changes), write through
// SillyTavern (never around it), show the page the result, and read it back.
// Once the journal has the copy, every outcome keeps the change, so it can
// always be undone.
//
// Undo saves pending typing first, then puts the whole file back when
// nothing else changed it since (byte for byte); otherwise it puts back just
// this item when the item is still as the change left it; otherwise it shows
// both versions and lets the user pick.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Our card field names → where SillyTavern keeps them: [top level, data.*].
const CARD = {
    description: ['description', 'description'], personality: ['personality', 'personality'], scenario: ['scenario', 'scenario'],
    first_mes: ['first_mes', 'first_mes'], mes_example: ['mes_example', 'mes_example'], creator_notes: ['creatorcomment', 'creator_notes'],
    tags: ['tags', 'tags'], alternate_greetings: [null, 'alternate_greetings'], system_prompt: [null, 'system_prompt'],
    post_history_instructions: [null, 'post_history_instructions'],
};
const CARD_LISTS = new Set(['tags', 'alternate_greetings']);
// Our lorebook entry field names → SillyTavern's, and their kind.
const ENTRY = {
    content: ['content', 'text'], comment: ['comment', 'text'], keys: ['key', 'list'], secondaryKeys: ['keysecondary', 'list'],
    constant: ['constant', 'bool'], disabled: ['disable', 'bool'], order: ['order', 'int'], position: ['position', 'int'],
};
const MAX_TEXT = 100000, MAX_LIST = 200, MAX_ITEM = 2000, MAX_NAME = 100;
// Windows device names, with or without an extension.
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
// Characters a file name can't have, and invisible ones (control and format
// characters: SillyTavern's file name cleaning drops some of them, and they
// let a name look like another one).
const BAD_NAME = /[\p{Cc}\p{Cf}\\/:*?"<>|]/u;
// SillyTavern's merge route deletes a field given this value.
const UNSET = '__@@UNSET@@__';

const fail = (error, extra = {}) => ({ ok: false, error, ...extra });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const hashNow = file => (fs.existsSync(file) ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null);
const fold = s => String(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

function checkValue(kind, v) {
    if (kind === 'text') return typeof v === 'string' && v.length <= MAX_TEXT && v !== UNSET ? null : `must be text (at most ${MAX_TEXT} characters)`;
    if (kind === 'list') return Array.isArray(v) && v.length <= MAX_LIST && v.every(x => typeof x === 'string' && x.length <= MAX_ITEM && x !== UNSET) ? null : `must be a list of short texts (at most ${MAX_LIST})`;
    if (kind === 'bool') return typeof v === 'boolean' ? null : 'must be true or false';
    if (kind === 'int') return Number.isInteger(v) && v >= 0 && v <= 100000 ? null : 'must be a whole number, 0 or more';
    return 'has an unknown kind';
}

// find/replace (find must appear exactly once, as typed) or set.
function edited(current, p, kind) {
    if ('set' in p) {
        const bad = checkValue(kind, p.set);
        return bad ? { error: `The new value ${bad}.` } : { value: p.set };
    }
    if (kind !== 'text') return { error: 'That field can only be changed with "set".' };
    const hay = String(current ?? '');
    const n = p.find ? hay.split(p.find).length - 1 : 0;
    if (n === 0) return { error: 'Can\'t apply: the text to replace isn\'t there (it changed, or was quoted wrong).' };
    if (n > 1) return { error: `Can't apply: the text to replace appears ${n} times, so it's not clear which one is meant.` };
    const value = hay.replace(p.find, () => p.replace);
    const bad = checkValue('text', value);
    return bad ? { error: `The result ${bad}.` } : { value };
}

async function handleOf(api) {
    try { const me = await api.sillytavern.request('GET', '/api/users/me'); if (me?.handle && /^[a-z0-9_-]+$/i.test(me.handle)) return me.handle; } catch { /* default */ }
    return 'default-user';
}
const cardRel = (h, avatar) => `data/${h}/characters/${avatar}`;
const bookRel = (h, name) => `data/${h}/worlds/${name}.json`;
const cardValue = (card, field) => {
    const [top, d] = CARD[field];
    const v = card?.data?.[d] ?? (top ? card?.[top] : undefined);
    return v ?? (CARD_LISTS.has(field) ? [] : '');
};
const cardPatch = (avatar, field, value) => {
    const [top, d] = CARD[field];
    const body = { avatar, data: { [d]: value } };
    if (top) body[top] = value;
    return body;
};

// A file name for a new card: unique in the folder whatever the case
// (Windows ignores it), and not the name of a chats folder an older
// character left behind (SillyTavern would put the new card's chats there).
function cardFileName(userDir, name) {
    let base = String(name).replace(/[\p{Cc}\p{Cf}\\/:*?"<>|]/gu, '').replace(/[. ]+$/, '').trim().slice(0, MAX_NAME);
    if (!base || RESERVED.test(base)) base = 'character';
    const names = dir => { try { return fs.readdirSync(dir).map(f => f.toLowerCase()); } catch { return []; } };
    const cards = new Set(names(path.join(userDir, 'characters')));
    const chats = new Set(names(path.join(userDir, 'chats')));
    for (let i = 0; i < 10000; i++) {
        const c = `${base}${i || ''}`;
        if (!cards.has(`${c}.png`.toLowerCase()) && !chats.has(c.toLowerCase())) return c;
    }
    throw new Error('No free file name for that card.');
}

// What's wrong with a new lorebook's name (null: nothing).
function bookNameProblem(name, existing) {
    if (typeof name !== 'string' || !name.trim()) return 'A lorebook needs a name.';
    if (name !== name.trim() || /[. ]$/.test(name)) return 'A lorebook name can\'t start or end with a space or end with a dot.';
    if (BAD_NAME.test(name) || RESERVED.test(name)) return 'That name can\'t be a file name on Windows, or has characters you can\'t see.';
    if (Buffer.byteLength(name) > 200) return 'That name is too long.';
    const twin = existing.find(n => fold(n) === fold(name));
    if (twin) return `There is a lorebook called "${twin}" already.`;
    return null;
}

const entryOf = (data, uid) => {
    const ks = Object.keys(data?.entries || {}).filter(k => data.entries[k]?.uid === uid);
    return ks.length === 1 ? data.entries[ks[0]] : null;
};
const entryShown = e => (e ? { comment: e.comment ?? '', content: e.content ?? '' } : null);

// Our field values → SillyTavern's, checked. For a new entry.
function entryValues(given) {
    if (!given || typeof given !== 'object' || Array.isArray(given)) return { error: 'The entry must be an object.' };
    const out = {};
    for (const [k, v] of Object.entries(given)) {
        if (!Object.hasOwn(ENTRY, k)) return { error: `"${k}" isn't a lorebook entry field the co-pilot can set (${Object.keys(ENTRY).join(', ')}).` };
        const [raw, kind] = ENTRY[k];
        const bad = checkValue(kind, v);
        if (bad) return { error: `"${k}" ${bad}.` };
        if (k === 'position' && v > 7) return { error: '"position" must be 0 to 7.' };
        out[raw] = v;
    }
    return { values: out };
}

const lists = api => api.sillytavern.page('lists');
const changedSince = (p, now) => p.shown && Object.hasOwn(p.shown, 'current') && !same(p.shown.current, now);
const CHANGED = 'It changed since the card was shown: nothing was written. Ask the co-pilot again.';

// What a card shows before Apply: the value it replaces, or the entry it deletes.
async function currentOf(api, p) {
    try {
        if (p.op === 'edit_card' && Object.hasOwn(CARD, p.field)) return { current: cardValue(await api.sillytavern.request('POST', '/api/characters/get', { avatar_url: p.avatar }), p.field) };
        if (p.op === 'edit_lorebook_entry' && Object.hasOwn(ENTRY, p.field)) {
            const e = entryOf(await api.sillytavern.request('POST', '/api/worldinfo/get', { name: p.book }), p.uid);
            return e ? { current: e[ENTRY[p.field][0]] } : null;
        }
        if (p.op === 'delete_lorebook_entry') {
            const e = entryOf(await api.sillytavern.request('POST', '/api/worldinfo/get', { name: p.book }), p.uid);
            return e ? { current: entryShown(e) } : null;
        }
    } catch { /* nothing to show */ }
    return null;
}

// ---- applying ----
async function applyProposal(api, p) {
    const folder = api.sillytavern.folder();
    try {
        switch (p.op) {
            case 'edit_card': return await editCard(api, folder, p);
            case 'create_card': return await createCard(api, folder, p);
            case 'create_lorebook': return await createBook(api, folder, p);
            case 'edit_lorebook_entry': return await editEntry(api, folder, p);
            case 'add_lorebook_entry': return await addEntry(api, folder, p);
            case 'delete_lorebook_entry': return await deleteEntry(api, folder, p);
            default: return fail('Applying this kind of change comes in the next version of the co-pilot.');
        }
    } catch (e) {
        return fail(e.message || String(e));
    }
}

// From the journal copy on: write, then finish and check whatever happens,
// so the change (and its Undo) is never lost. verify(): null or a problem.
async function written(api, journal, change, write, verify) {
    let problem = null;
    try { await write(); } catch (e) { problem = e.message || String(e); }
    try { await api.changes.finish(journal); } catch { /* the journal still has the copy */ }
    if (!problem) { try { problem = await verify(); } catch (e) { problem = e.message || String(e); } }
    return problem ? fail(problem, { change }) : { ok: true, change };
}

async function editCard(api, folder, p) {
    if (!Object.hasOwn(CARD, p.field)) return fail(`"${p.field}" isn't a card field the co-pilot can change.`);
    if (!(await lists(api)).characters.some(c => c.avatar === p.avatar)) return fail(`There is no character ${p.avatar}.`);
    const h = await handleOf(api);
    const rel = cardRel(h, p.avatar);
    if (!fs.existsSync(path.join(folder, rel))) return fail(`The card ${p.avatar} isn't in this SillyTavern's data folder, so no copy could be kept: nothing was written.`);
    await api.sillytavern.page('characterFlush', { avatar: p.avatar }); // the user's typing in the open form goes first
    const card = await api.sillytavern.request('POST', '/api/characters/get', { avatar_url: p.avatar });
    const kind = CARD_LISTS.has(p.field) ? 'list' : 'text';
    const current = cardValue(card, p.field);
    if (changedSince(p, current)) return fail(CHANGED);
    const r = edited(current, p, kind);
    if (r.error) return fail(r.error);
    if (same(r.value, current)) return fail('It is already like that: nothing to change.');
    const journal = await api.changes.record({ folder, kind: 'card-field', target: { avatar: p.avatar, field: p.field }, before: { value: current }, after: { value: r.value }, files: [rel] });
    const change = { journal, op: p.op, target: { avatar: p.avatar, field: p.field, name: card.name }, file: rel };
    return written(api, journal, change, async () => {
        await api.sillytavern.request('POST', '/api/characters/merge-attributes', cardPatch(p.avatar, p.field, r.value));
        // The form shows the new value (and saves the user's typing with it).
        await api.sillytavern.page('characterRefresh', { avatar: p.avatar, field: p.field });
    }, async () => {
        const check = await api.sillytavern.request('POST', '/api/characters/get', { avatar_url: p.avatar });
        return same(cardValue(check, p.field), r.value) ? null : 'SillyTavern saved something else than proposed. Undo puts the card back.';
    });
}

async function createCard(api, folder, p) {
    const name = typeof p.name === 'string' ? p.name.trim() : '';
    if (!name || name.length > MAX_NAME) return fail('A new character needs a name (at most 100 characters).');
    const body = { ch_name: name };
    for (const [k, v] of Object.entries(p.fields || {})) {
        if (!Object.hasOwn(CARD, k)) return fail(`"${k}" isn't a card field the co-pilot can set.`);
        const bad = checkValue(CARD_LISTS.has(k) ? 'list' : 'text', v);
        if (bad) return fail(`"${k}" ${bad}.`);
        body[k] = v;
    }
    const h = await handleOf(api);
    const userDir = path.join(folder, 'data', h);
    if (!fs.existsSync(path.join(userDir, 'characters'))) return fail('This SillyTavern\'s characters aren\'t in its data folder, so no copy could be kept: nothing was made.');
    const base = cardFileName(userDir, name);
    const avatar = `${base}.png`;
    const rel = cardRel(h, avatar);
    const journal = await api.changes.record({ folder, kind: 'card-create', target: { avatar }, before: null, after: { name, fields: p.fields || {} }, files: [rel] });
    const change = { journal, op: p.op, target: { avatar, name, chats: base }, file: rel };
    let made = '';
    return written(api, journal, change, async () => {
        made = String(await api.sillytavern.request('POST', '/api/characters/create', { ...body, file_name: base })).trim();
        await api.sillytavern.page('characterListRefresh');
    }, async () => (made === avatar && fs.existsSync(path.join(folder, rel)) ? null : `SillyTavern made the card as ${made || 'nothing'} instead of ${avatar}.`));
}

async function createBook(api, folder, p) {
    const problem = bookNameProblem(p.name, (await lists(api)).lorebooks || []);
    if (problem) return fail(problem);
    const h = await handleOf(api);
    const rel = bookRel(h, p.name);
    if (!fs.existsSync(path.dirname(path.join(folder, rel)))) return fail('This SillyTavern\'s lorebooks aren\'t in its data folder, so no copy could be kept: nothing was made.');
    if (fs.existsSync(path.join(folder, rel))) return fail(`There is a lorebook file called ${p.name} already.`);
    const journal = await api.changes.record({ folder, kind: 'lorebook-create', target: { book: p.name }, before: null, after: { entries: {} }, files: [rel] });
    const change = { journal, op: p.op, target: { book: p.name }, file: rel };
    return written(api, journal, change,
        () => api.sillytavern.page('lorebookSave', { name: p.name, data: { entries: {} } }),
        async () => (fs.existsSync(path.join(folder, rel)) ? null : 'SillyTavern didn\'t save the new lorebook.'));
}

// The book, read fresh after the editor's pending save went out.
async function readBook(api, folder, name) {
    if (!((await lists(api)).lorebooks || []).includes(name)) throw new Error(`There is no lorebook called ${name}.`);
    const h = await handleOf(api);
    const rel = bookRel(h, name);
    if (!fs.existsSync(path.join(folder, rel))) throw new Error(`The lorebook ${name} isn't in this SillyTavern's data folder, so no copy could be kept: nothing was written.`);
    await api.sillytavern.page('lorebookFlush');
    return { data: await api.sillytavern.request('POST', '/api/worldinfo/get', { name }), rel };
}
const bookNow = (api, name) => api.sillytavern.request('POST', '/api/worldinfo/get', { name });

async function editEntry(api, folder, p) {
    if (!Object.hasOwn(ENTRY, p.field)) return fail(`"${p.field}" isn't a lorebook entry field the co-pilot can change.`);
    const [raw, kind] = ENTRY[p.field];
    const { data, rel } = await readBook(api, folder, p.book);
    const entry = entryOf(data, p.uid);
    if (!entry) return fail(`The lorebook ${p.book} has no entry ${p.uid} (or more than one).`);
    if (changedSince(p, entry[raw])) return fail(CHANGED);
    const r = edited(entry[raw], p, kind);
    if (r.error) return fail(r.error);
    if (p.field === 'position' && r.value > 7) return fail('"position" must be 0 to 7.');
    if (same(r.value, entry[raw])) return fail('It is already like that: nothing to change.');
    const afterEntry = { ...entry, [raw]: r.value };
    const journal = await api.changes.record({ folder, kind: 'lorebook-entry', target: { book: p.book, uid: p.uid, field: p.field }, before: { entry }, after: { entry: afterEntry }, files: [rel] });
    const change = { journal, op: p.op, target: { book: p.book, uid: p.uid, field: p.field }, file: rel };
    return written(api, journal, change,
        () => api.sillytavern.page('lorebookEntry', { name: p.book, op: 'set', uid: p.uid, values: { [raw]: r.value }, expect: entry }),
        async () => { const now = entryOf(await bookNow(api, p.book), p.uid); return now && same(now[raw], r.value) ? null : 'SillyTavern saved something else than proposed. Undo puts the entry back.'; });
}

async function addEntry(api, folder, p) {
    const v = entryValues(p.entry);
    if (v.error) return fail(v.error);
    if (!v.values.content && !(v.values.key || []).length) return fail('A new entry needs some content or keys.');
    const { rel } = await readBook(api, folder, p.book);
    const journal = await api.changes.record({ folder, kind: 'lorebook-entry-add', target: { book: p.book }, before: null, after: { values: v.values }, files: [rel] });
    const change = { journal, op: p.op, target: { book: p.book, uid: null }, file: rel };
    return written(api, journal, change, async () => {
        const r = await api.sillytavern.page('lorebookEntry', { name: p.book, op: 'add', values: v.values });
        change.target.uid = r?.uid ?? null;
    }, async () => {
        const added = entryOf(await bookNow(api, p.book), change.target.uid);
        change.added = added;
        return added && Object.entries(v.values).every(([k, x]) => same(added[k], x)) ? null : 'SillyTavern saved something else than proposed. Undo takes the entry out.';
    });
}

async function deleteEntry(api, folder, p) {
    const { data, rel } = await readBook(api, folder, p.book);
    const entry = entryOf(data, p.uid);
    if (!entry) return fail(`The lorebook ${p.book} has no entry ${p.uid} (or more than one).`);
    if (changedSince(p, entryShown(entry))) return fail(CHANGED);
    const journal = await api.changes.record({ folder, kind: 'lorebook-entry-delete', target: { book: p.book, uid: p.uid }, before: { entry }, after: null, files: [rel] });
    const change = { journal, op: p.op, target: { book: p.book, uid: p.uid, comment: entry.comment }, file: rel };
    return written(api, journal, change,
        () => api.sillytavern.page('lorebookEntry', { name: p.book, op: 'delete', uid: p.uid, expect: entry }),
        async () => (entryOf(await bookNow(api, p.book), p.uid) ? 'The entry is still there.' : null));
}

// ---- taking it back ----
// choice: undefined (decide), 'mine' (put mine back over a later change),
// 'file' (put the whole file back as it was), 'keep' (leave it as it is now).
async function undoChange(api, change, { choice } = {}) {
    const e = api.changes.get(change.journal);
    if (!e) return fail('The backup of this change is gone (backups are kept 30 days).');
    if (choice === 'keep') return { ok: true, how: 'kept' };
    const f = e.files[0];
    // Op and target come from the journal, not from anything stored with the proposal.
    const op = change.op;
    const t = e.target || change.target;
    const isCard = op === 'edit_card' || op === 'create_card';
    try {
        // The user's pending typing goes first, so nothing of it is lost or saved over the undo.
        if (op === 'edit_card') await api.sillytavern.page('characterFlush', { avatar: t.avatar });
        else if (!isCard) await api.sillytavern.page('lorebookFlush');
        const unchanged = e.finished && f.existed !== undefined && hashNow(f.path) === f.afterSha256 && (f.afterSha256 !== null || !f.existed);
        const refresh = async () => {
            if (op === 'edit_card') await api.sillytavern.page('characterRefresh', { avatar: t.avatar, field: t.field });
            else if (op === 'create_card') await api.sillytavern.page('characterListRefresh');
            else await api.sillytavern.page('lorebookReload', { name: t.book });
        };
        const wholeFile = async () => { await api.changes.restoreFile(change.journal, f.path, { force: true }); await refresh(); return { ok: true, how: 'file' }; };
        if (choice === 'file') {
            if (op === 'create_card' || op === 'create_lorebook') return fail('Use "Delete" for something the co-pilot made.');
            return await wholeFile();
        }
        switch (op) {
            case 'edit_card': {
                if (!f.existed) return fail('No copy of this card was kept, so it can\'t be put back.');
                if (unchanged && !choice) return await wholeFile();
                const current = cardValue(await api.sillytavern.request('POST', '/api/characters/get', { avatar_url: t.avatar }), t.field);
                if (!same(current, e.after.value) && choice !== 'mine') return { conflict: { current, before: e.before.value, after: e.after.value } };
                await api.sillytavern.request('POST', '/api/characters/merge-attributes', cardPatch(t.avatar, t.field, e.before.value));
                await refresh();
                return { ok: true, how: 'item' };
            }
            case 'edit_lorebook_entry': {
                if (unchanged && !choice) return await wholeFile();
                const raw = ENTRY[t.field][0];
                const now = entryOf(await bookNow(api, t.book), t.uid);
                if (!now) return { conflict: { current: '(the entry was deleted)', before: e.before.entry[raw], after: e.after.entry[raw] }, noMine: true };
                if (!same(now[raw], e.after.entry[raw]) && choice !== 'mine') return { conflict: { current: now[raw], before: e.before.entry[raw], after: e.after.entry[raw] } };
                await api.sillytavern.page('lorebookEntry', { name: t.book, op: 'set', uid: t.uid, values: { [raw]: e.before.entry[raw] }, expect: now });
                return { ok: true, how: 'item' };
            }
            case 'add_lorebook_entry': {
                if (unchanged && !choice) return await wholeFile();
                const uid = change.target?.uid;
                const now = entryOf(await bookNow(api, t.book), uid);
                if (!now) return { ok: true, how: 'gone already' };
                if (!same(now, change.added) && choice !== 'mine') return { conflict: { current: now.content, before: '(no entry)', after: change.added?.content ?? '' } };
                await api.sillytavern.page('lorebookEntry', { name: t.book, op: 'delete', uid, expect: now });
                return { ok: true, how: 'item' };
            }
            case 'delete_lorebook_entry': {
                if (unchanged && !choice) return await wholeFile();
                const now = entryOf(await bookNow(api, t.book), t.uid);
                if (now) return { conflict: { current: now.content, before: e.before.entry.content, after: '(deleted)' }, noMine: true };
                await api.sillytavern.page('lorebookEntry', { name: t.book, op: 'put', uid: t.uid, entry: e.before.entry });
                return { ok: true, how: 'item' };
            }
            case 'create_card': {
                if (!fs.existsSync(f.path)) return { ok: true, how: 'gone already' };
                if (!unchanged && choice !== 'mine') return { conflict: { current: 'The card was changed after it was made (perhaps by chatting with it).', before: '(no card)', after: change.target?.name ?? t.avatar } };
                // Chats made with it stay: only the card goes.
                const chatsDir = path.join(path.dirname(path.dirname(f.path)), 'chats', change.target?.chats ?? t.avatar.replace(/\.png$/i, ''));
                let keepChats = false;
                try { keepChats = fs.readdirSync(chatsDir).length > 0; } catch { /* no chats folder */ }
                await api.sillytavern.page('characterDelete', { avatar: t.avatar, keepChats });
                return { ok: true, how: 'item', note: keepChats ? 'The card is deleted; its chats were kept.' : '' };
            }
            case 'create_lorebook': {
                if (!fs.existsSync(f.path)) return { ok: true, how: 'gone already' };
                if (!unchanged && choice !== 'mine') return { conflict: { current: 'The lorebook was changed after it was made.', before: '(no lorebook)', after: t.book } };
                await api.sillytavern.page('lorebookDelete', { name: t.book });
                return { ok: true, how: 'item' };
            }
            default: return fail('This change can\'t be undone here.');
        }
    } catch (err) {
        return fail(err.message || String(err));
    }
}

module.exports = { applyProposal, undoChange, currentOf, CARD, ENTRY, cardFileName, bookNameProblem, edited, entryValues };
