// Co-pilot: helpers every kind of change uses (cards, lorebooks, chats,
// personas, presets).
'use strict';
const fs = require('fs');
const crypto = require('crypto');

const MAX_TEXT = 100000, MAX_LIST = 200, MAX_ITEM = 2000;
// SillyTavern's merge route deletes a field given this value.
const UNSET = '__@@UNSET@@__';
// Windows device names, with or without an extension.
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
// Characters a file name can't have, and invisible ones (control and format
// characters: SillyTavern's file name cleaning drops some of them, and they
// let a name look like another one).
const BAD_NAME = /[\p{Cc}\p{Cf}\\/:*?"<>|]/u;

const fail = (error, extra = {}) => ({ ok: false, error, ...extra });
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const hashNow = file => (fs.existsSync(file) ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null);
const fold = s => String(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const copy = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

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

// From the journal copy on: write, then finish and check whatever happens,
// so the change (and its Undo) is never lost. verify(): null or a problem.
async function written(api, journal, change, write, verify) {
    let problem = null;
    try { await write(); } catch (e) { problem = e.message || String(e); }
    try { await api.changes.finish(journal); } catch { /* the journal still has the copy */ }
    if (!problem) { try { problem = await verify(); } catch (e) { problem = e.message || String(e); } }
    return problem ? fail(problem, { change }) : { ok: true, change };
}

const CHANGED = 'It changed since the card was shown: nothing was written. Ask the co-pilot again.';

module.exports = { MAX_TEXT, MAX_LIST, MAX_ITEM, UNSET, RESERVED, BAD_NAME, CHANGED, fail, same, hashNow, fold, copy, checkValue, edited, handleOf, written };
