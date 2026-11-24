// Personas (addons/copilot/apply-persona.cjs through apply.cjs) against a
// stand-in page: power_user in memory, saved whole to a real settings.json,
// pictures as files, personaState / personaApply answering like the app's
// page functions.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { openJournal } from '../../changes.js';

const require = createRequire(import.meta.url);
const apply = require('../../addons/copilot/apply.cjs');

const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.mkdtempSync(path.join(process.env.ST_TEST_DATA || os.tmpdir(), 'app-')); made.push(d); return d; };
const J = v => JSON.stringify(v ?? null);
const copy = v => (v === undefined ? null : JSON.parse(JSON.stringify(v)));

function fakePersonas() {
    const root = tmp(), addon = tmp();
    fs.writeFileSync(path.join(root, 'server.js'), '');
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'sillytavern' }));
    const user = path.join(root, 'data', 'default-user');
    const pics = path.join(user, 'User Avatars');
    fs.mkdirSync(pics, { recursive: true });
    for (const f of ['user-default.png', '1700000000000-Wren.png']) fs.writeFileSync(path.join(pics, f), 'png');
    const st = {
        current: 'user-default.png', ready: true,
        settings: { theme: 'dark', power_user: { personas: { 'user-default.png': 'Wren', '1700000000000-Wren.png': 'Captain Wren' }, default_persona: null,
            persona_descriptions: { 'user-default.png': { description: 'Wren keeps the lighthouse.', position: 0, depth: 2, role: 0, lorebook: '', title: '' },
                '1700000000000-Wren.png': { description: 'Wren at sea.', position: 0, depth: 2, role: 0, lorebook: '', title: '' } },
            persona_description: 'Wren keeps the lighthouse.' } },
    };
    const file = path.join(user, 'settings.json');
    const save = () => fs.writeFileSync(file, JSON.stringify(st.settings, null, 4));
    save();
    const pu = () => st.settings.power_user;
    function personaApply({ op, avatar, name, description, expect }) {
        if (!st.ready) return { refused: 'still starting' };
        if (op === 'create') {
            if (pu().personas[avatar] || fs.existsSync(path.join(pics, avatar))) return { refused: 'taken', changed: true };
            fs.writeFileSync(path.join(pics, avatar), 'png');
            pu().personas[avatar] = name;
            pu().persona_descriptions[avatar] = { description: description || '', position: 0, depth: 2, role: 0, lorebook: '', title: '' };
            save();
            return { ok: true, descriptor: copy(pu().persona_descriptions[avatar]) };
        }
        if (!pu().personas[avatar]) return { refused: 'gone', changed: true };
        if (op === 'set') {
            const d = pu().persona_descriptions[avatar];
            if (expect !== undefined && d.description !== expect) return { refused: 'changed', changed: true };
            d.description = description;
            if (st.current === avatar) pu().persona_description = description;
            save();
            return { ok: true };
        }
        if (op === 'remove') {
            if (st.current === avatar) return { refused: 'That persona is in use in SillyTavern: switch to another persona first.' };
            if (expect && (pu().personas[avatar] !== expect.name || J(pu().persona_descriptions[avatar]) !== J(expect.descriptor))) return { refused: 'changed', changed: true };
            fs.rmSync(path.join(pics, avatar), { force: true });
            delete pu().personas[avatar]; delete pu().persona_descriptions[avatar];
            save();
            return { ok: true };
        }
        throw new Error('unknown');
    }
    const api = {
        dir: addon, changes: openJournal(addon),
        sillytavern: {
            folder: () => root,
            async request(m, p) { if (p === '/api/users/me') return { handle: 'default-user' }; throw new Error(`unexpected request ${p}`); },
            async page(n, a = {}) {
                if (n === 'personaState') {
                    const id = a.avatar ?? st.current;
                    const exists = Object.hasOwn(pu().personas, id);
                    return { ready: st.ready, current: st.current, avatar: id, exists, name: exists ? pu().personas[id] : null, descriptor: exists ? copy(pu().persona_descriptions[id]) : null, isDefault: false, names: Object.values(pu().personas) };
                }
                if (n === 'personaApply') return personaApply(a);
                throw new Error(`unexpected page ${n}`);
            },
        },
    };
    const read = () => JSON.parse(fs.readFileSync(file, 'utf8'));
    return { st, api, pics, read, save, pu };
}
const stamped = async (s, p) => ({ ...p, shown: await apply.currentOf(s.api, p) });

test('editing the persona in use: "in use" is fixed when the card is shown; Undo puts the description back', async () => {
    const s = fakePersonas();
    const p = await stamped(s, { op: 'edit_persona', avatar: null, find: 'lighthouse', replace: 'harbour light', why: 'x' });
    assert.equal(p.shown.avatar, 'user-default.png');
    s.st.current = '1700000000000-Wren.png'; // the user switched persona before clicking Apply
    const r = await apply.applyProposal(s.api, p);
    assert.equal(r.ok, true, r.error);
    assert.equal(s.read().power_user.persona_descriptions['user-default.png'].description, 'Wren keeps the harbour light.');
    assert.equal(s.read().power_user.persona_descriptions['1700000000000-Wren.png'].description, 'Wren at sea.');
    assert.equal(s.read().theme, 'dark');
    const u = await apply.undoChange(s.api, r.change);
    assert.equal(u.ok, true, u.error || JSON.stringify(u));
    assert.equal(s.read().power_user.persona_descriptions['user-default.png'].description, 'Wren keeps the lighthouse.');
});

test('Undo never puts settings.json back whole: a setting changed since stays', async () => {
    const s = fakePersonas();
    const r = await apply.applyProposal(s.api, await stamped(s, { op: 'edit_persona', avatar: '1700000000000-Wren.png', set: 'Wren on the ferry.', why: 'x' }));
    assert.equal(r.ok, true, r.error);
    s.st.settings.theme = 'light'; s.save();
    assert.equal((await apply.undoChange(s.api, r.change, { choice: 'file' })).ok, false);
    assert.equal((await apply.undoChange(s.api, r.change)).ok, true);
    assert.equal(s.read().theme, 'light');
    assert.equal(s.read().power_user.persona_descriptions['1700000000000-Wren.png'].description, 'Wren at sea.');
});

test('the description changed after the card was shown, or after Apply: refused / asks', async () => {
    const s = fakePersonas();
    const p = await stamped(s, { op: 'edit_persona', avatar: 'user-default.png', set: 'New.', why: 'x' });
    s.pu().persona_descriptions['user-default.png'].description = 'Typed by the user.'; s.save();
    const r = await apply.applyProposal(s.api, p);
    assert.equal(r.ok, false); assert.match(r.error, /changed since/); assert.equal(r.change, undefined);
    const r2 = await apply.applyProposal(s.api, await stamped(s, { op: 'edit_persona', avatar: 'user-default.png', set: 'Co-pilot text.', why: 'x' }));
    s.pu().persona_descriptions['user-default.png'].description = 'Typed again.'; s.save();
    const u = await apply.undoChange(s.api, r2.change);
    assert.ok(u.conflict, JSON.stringify(u));
    assert.equal(u.conflict.current, 'Typed again.');
    assert.equal((await apply.undoChange(s.api, r2.change, { choice: 'mine' })).ok, true);
    assert.equal(s.read().power_user.persona_descriptions['user-default.png'].description, 'Typed by the user.');
});

test('a new persona gets its own picture, is not switched to, and Undo removes both', async () => {
    const s = fakePersonas();
    const r = await apply.applyProposal(s.api, { op: 'create_persona', name: 'Ferry Pilot', description: 'Runs the night ferry.', why: 'x' });
    assert.equal(r.ok, true, r.error);
    const id = r.change.target.avatar;
    assert.match(id, /^\d+-FerryPilot\.png$/);
    assert.equal(s.read().power_user.personas[id], 'Ferry Pilot');
    assert.ok(fs.existsSync(path.join(s.pics, id)));
    assert.equal(s.st.current, 'user-default.png');
    const u = await apply.undoChange(s.api, r.change);
    assert.equal(u.ok, true, u.error || JSON.stringify(u));
    assert.equal(s.read().power_user.personas[id], undefined);
    assert.equal(fs.existsSync(path.join(s.pics, id)), false);
});

test('Undo of a new persona the user has switched to is refused; a same name is refused at Apply', async () => {
    const s = fakePersonas();
    const r = await apply.applyProposal(s.api, { op: 'create_persona', name: 'Deckhand', description: '', why: 'x' });
    s.st.current = r.change.target.avatar;
    const u = await apply.undoChange(s.api, r.change);
    assert.equal(u.ok, false); assert.match(u.error, /in use/);
    const twin = await apply.applyProposal(s.api, { op: 'create_persona', name: 'captain wren', description: '', why: 'x' });
    assert.equal(twin.ok, false); assert.match(twin.error, /Captain Wren/);
});

test('"the persona in use" means the one in use when the turn began; an unchecked card is refused', async () => {
    const s = fakePersonas();
    const p = { op: 'edit_persona', avatar: null, set: 'x', why: 'x' };
    const shown = await apply.currentOf(s.api, p, { persona: '1700000000000-Wren.png' });
    assert.equal(shown.avatar, '1700000000000-Wren.png');
    const r = await apply.applyProposal(s.api, p);
    assert.equal(r.ok, false); assert.match(r.error, /checked against a persona/);
});
