// Co-pilot: personas. They live in the page's settings (power_user), which
// the page saves whole to settings.json, so every change goes through the
// page (personaState / personaApply in the app's stpage.js) and Undo is per
// persona: putting settings.json back would undo every other setting changed
// since. A new persona gets SillyTavern's default picture, as its own Create
// button does, and isn't switched to.
'use strict';
const fs = require('fs');
const path = require('path');
const { fail, same, fold, checkValue, edited, handleOf, written, CHANGED, BAD_NAME } = require('./apply-util.cjs');

const OPS = new Set(['create_persona', 'edit_persona']);
const MAX_NAME = 100;
const state = (api, avatar) => api.sillytavern.page('personaState', { avatar: avatar ?? null });
const settingsOf = (api, rel) => JSON.parse(fs.readFileSync(path.join(api.sillytavern.folder(), rel), 'utf8'));

// The persona the card is about ("the one in use" resolved when the reply came) and its description.
// turn.persona: the persona in use when the user sent the message.
async function currentOf(api, p, turn = {}) {
    if (p.op !== 'edit_persona') return null;
    const st = await state(api, p.avatar ?? turn.persona ?? null);
    return st.exists ? { avatar: st.avatar, current: String(st.descriptor?.description ?? '') } : null;
}

// Copy, change through the page, check settings.json. A refusal before the
// write keeps nothing to undo.
async function run(api, p, { kind, target, before, after, files, op, check }) {
    const folder = api.sillytavern.folder();
    const journal = await api.changes.record({ folder, kind, target, before, after, files });
    const change = { journal, op: p.op, target, file: files[0] };
    let res = null;
    const r = await written(api, journal, change, async () => {
        res = await api.sillytavern.page('personaApply', op);
        if (res?.refused) throw new Error(res.changed ? CHANGED : res.refused);
    }, () => check(res, change));
    return !r.ok && res?.refused ? fail(r.error) : r;
}

async function applyPersona(api, p) {
    const h = await handleOf(api);
    const rel = `data/${h}/settings.json`;
    if (!fs.existsSync(path.join(api.sillytavern.folder(), rel))) return fail('This SillyTavern\'s settings aren\'t in its data folder, so no copy could be kept: nothing was written.');
    if (p.op === 'edit_persona') {
        // "The one in use" means the one in use when the card was shown.
        if (p.avatar == null && !p.shown?.avatar) return fail('This card wasn\'t checked against a persona when it was made: ask the co-pilot again.');
        const avatar = p.avatar ?? p.shown.avatar;
        const st = await state(api, avatar);
        if (!st.ready) return fail('SillyTavern is still starting (is its welcome screen open?). Try again in a moment.');
        if (!st.exists) return fail(avatar ? `There is no persona ${avatar}.` : 'No persona is in use.');
        if (!st.descriptor) return fail('This persona has no description settings yet: open it once in SillyTavern\'s Persona Management, then try again.');
        const current = String(st.descriptor.description ?? '');
        if (p.shown && Object.hasOwn(p.shown, 'current') && !same(p.shown.current, current)) return fail(CHANGED);
        const r = edited(current, p, 'text');
        if (r.error) return fail(r.error);
        if (r.value === current) return fail('It is already like that: nothing to change.');
        return run(api, p, {
            kind: 'persona', target: { avatar: st.avatar, name: st.name }, before: { description: current }, after: { description: r.value }, files: [rel],
            op: { op: 'set', avatar: st.avatar, description: r.value, expect: current },
            check: () => (settingsOf(api, rel).power_user?.persona_descriptions?.[st.avatar]?.description === r.value ? null : 'SillyTavern didn\'t save the new description. Undo puts the old one back.'),
        });
    }
    if (p.op === 'create_persona') {
        const name = typeof p.name === 'string' ? p.name.trim() : '';
        if (!name || name.length > MAX_NAME || /[\p{Cc}\p{Cf}]/u.test(name)) return fail('A new persona needs a name (at most 100 characters, no invisible characters).');
        const bad = checkValue('text', p.description ?? '');
        if (bad) return fail(`The description ${bad}.`);
        const st = await state(api, null);
        if (!st.ready) return fail('SillyTavern is still starting (is its welcome screen open?). Try again in a moment.');
        const twin = (st.names || []).find(n => fold(n) === fold(name));
        if (twin) return fail(`There is a persona called "${twin}" already.`);
        const avatarsDir = `data/${h}/User Avatars`;
        if (!fs.existsSync(path.join(api.sillytavern.folder(), avatarsDir))) return fail('This SillyTavern\'s persona pictures aren\'t in its data folder, so no copy could be kept: nothing was made.');
        // SillyTavern's own naming for a new persona's picture.
        const avatar = `${Date.now()}-${name.replace(/[^a-zA-Z0-9]/g, '')}.png`;
        if (BAD_NAME.test(avatar)) return fail('No picture name for that persona.');
        const pic = `${avatarsDir}/${avatar}`;
        return run(api, p, {
            kind: 'persona-create', target: { avatar, name }, before: null, after: { name, description: p.description ?? '' }, files: [rel, pic],
            op: { op: 'create', avatar, name, description: p.description ?? '' },
            check: (res, change) => {
                change.descriptor = res?.descriptor ?? null;
                return settingsOf(api, rel).power_user?.personas?.[avatar] === name && fs.existsSync(path.join(api.sillytavern.folder(), pic))
                    ? null : 'SillyTavern didn\'t save the new persona. Undo removes what was made.';
            },
        });
    }
    return fail('Applying this kind of change comes in the next version of the co-pilot.');
}

async function undoPersona(api, change, e, { choice } = {}) {
    const mine = choice === 'mine';
    const t = e.target || change.target;
    const st = await state(api, t.avatar);
    if (!st.ready) return fail('SillyTavern is still starting. Try again in a moment.');
    try {
        if (change.op === 'create_persona') {
            if (!st.exists) {
                // A make that stopped halfway can leave its picture: that goes too.
                const left = await api.sillytavern.page('personaApply', { op: 'remove', avatar: t.avatar });
                return { ok: true, how: left?.picture ? 'item' : 'gone already' };
            }
            const res = await api.sillytavern.page('personaApply', { op: 'remove', avatar: t.avatar, ...(mine ? {} : { expect: { name: e.after.name, descriptor: change.descriptor ?? null } }) });
            if (res?.refused) return res.changed && !mine ? { conflict: { current: 'The persona was changed after it was made.', before: '(no persona)', after: e.after.name } } : fail(res.refused);
            return { ok: true, how: 'item' };
        }
        if (!st.exists) return fail('That persona isn\'t there any more.');
        const current = String(st.descriptor?.description ?? '');
        if (current !== e.after.description && !mine) return { conflict: { current, before: e.before.description, after: e.after.description } };
        const res = await api.sillytavern.page('personaApply', { op: 'set', avatar: t.avatar, description: e.before.description, ...(mine ? {} : { expect: e.after.description }) });
        if (res?.refused) return res.changed && !mine ? { conflict: { current: '(changed again)', before: e.before.description, after: e.after.description } } : fail(res.refused);
        return settingsOf(api, change.file).power_user?.persona_descriptions?.[t.avatar]?.description === e.before.description ? { ok: true, how: 'item' } : fail('SillyTavern didn\'t save the description.');
    } catch (err) {
        return fail(err.message || String(err));
    }
}

module.exports = { OPS, applyPersona, undoPersona, currentOf };
