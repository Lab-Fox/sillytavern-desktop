// Chat completion presets (addons/copilot/apply-preset.cjs through apply.cjs)
// against a stand-in SillyTavern: preset files saved as its route saves them,
// the page's copies of every preset, and a working copy of the selected one.
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
const tmp = () => { const d = fs.mkdtempSync(path.join(process.env.ST_TEST_DATA || os.tmpdir(), 'apr-')); made.push(d); return d; };
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const copy = v => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
// Preset key → working copy key, as SillyTavern's settingsToUpdate maps a few of them.
const MAP = { temperature: 'temp_openai', top_p: 'top_p_openai', openai_max_tokens: 'openai_max_tokens', stream_openai: 'stream_openai', impersonation_prompt: 'impersonation_prompt' };

function preset(extra = {}) {
    return { temperature: 1, top_p: 1, openai_max_tokens: 300, stream_openai: true, impersonation_prompt: 'Write as {{user}}.', reverse_proxy: '', custom_url: '',
        prompts: [
            { identifier: 'main', name: 'Main Prompt', system_prompt: true, role: 'system', content: 'Write the next reply.' },
            { identifier: 'chatHistory', name: 'Chat History', system_prompt: true, marker: true },
            { identifier: 'tone', name: 'Tone', system_prompt: false, role: 'system', content: 'Keep it light.', injection_position: 0, injection_depth: 4 },
        ],
        prompt_order: [{ character_id: 100000, order: [{ identifier: 'main', enabled: true }] }, { character_id: 100001, order: [{ identifier: 'main', enabled: true }, { identifier: 'tone', enabled: true }, { identifier: 'chatHistory', enabled: true }] }],
        extensions: {}, ...extra };
}

function fakePresets() {
    const root = tmp(), addon = tmp();
    fs.writeFileSync(path.join(root, 'server.js'), '');
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'sillytavern' }));
    const dir = path.join(root, 'data', 'default-user', 'OpenAI Settings');
    fs.mkdirSync(dir, { recursive: true });
    const file = n => path.join(dir, `${n}.json`);
    const write = (n, v) => fs.writeFileSync(file(n), JSON.stringify(v, null, 4));
    write('Default', preset());
    write('Story', preset({ temperature: 0.8 }));
    const st = { selected: 'Default', memory: { Default: preset(), Story: preset({ temperature: 0.8 }) }, working: null, characters: ['Kit'], groups: ['Harbour'] };
    // The working copy of the selected preset (keys as SillyTavern names them).
    const select = n => { st.selected = n; const p = copy(st.memory[n]); st.working = { prompts: p.prompts, prompt_order: p.prompt_order }; for (const [k, w] of Object.entries(MAP)) st.working[w] = p[k]; };
    select('Default');
    const api = {
        dir: addon, changes: openJournal(addon),
        sillytavern: {
            folder: () => root,
            async request(m, p, body) {
                if (p === '/api/users/me') return { handle: 'default-user' };
                if (p === '/api/presets/save') { write(body.name, body.preset); return { name: body.name }; }
                throw new Error(`unexpected request ${p}`);
            },
            async page(n, a = {}) {
                if (n === 'presetState') {
                    const exists = Object.hasOwn(st.memory, a.name);
                    const out = { ready: true, names: Object.keys(st.memory), selected: st.selected, exists, isSelected: exists && st.selected === a.name, saved: exists ? copy(st.memory[a.name]) : null, characters: st.characters, groups: st.groups, controls: { temperature: { tag: 'input', type: 'range', min: 0, max: 2, options: null } } };
                    if (out.isSelected) {
                        out.working = {}; for (const k of a.keys || []) if (MAP[k]) out.working[k] = copy(st.working[MAP[k]]);
                        out.workingPrompts = copy(st.working.prompts); out.workingOrder = copy(st.working.prompt_order.find(e => String(e.character_id) === '100001'));
                    }
                    return out;
                }
                if (n === 'profiles') return { available: true, profiles: st.profiles || [] };
                if (n === 'presetPut') {
                    if (a.remove) { if (st.selected === a.name) return { refused: 'selected' }; delete st.memory[a.name]; fs.rmSync(file(a.name)); return { ok: true }; }
                    if (a.add) { st.memory[a.name] = copy(a.preset); return { ok: true }; }
                    st.memory[a.name] = copy(a.preset);
                    const out = { ok: true };
                    if (a.working && st.selected === a.name) {
                        for (const [k, v] of Object.entries(a.working.settings || {})) st.working[MAP[k]] = v;
                        for (const id of a.working.prompts || []) { const p = a.preset.prompts.find(x => x.identifier === id); const i = st.working.prompts.findIndex(x => x.identifier === id); if (p && i >= 0) st.working.prompts[i] = copy(p); else if (p) st.working.prompts.push(copy(p)); else if (i >= 0) st.working.prompts.splice(i, 1); }
                        if (a.working.order) { const i = st.working.prompt_order.findIndex(e => String(e.character_id) === '100001'); st.working.prompt_order[i] = copy(a.preset.prompt_order.find(e => String(e.character_id) === '100001')); }
                        out.working = {}; for (const k of Object.keys(a.working.settings || {})) out.working[k] = copy(st.working[MAP[k]]);
                    }
                    return out;
                }
                throw new Error(`unexpected page ${n}`);
            },
        },
    };
    const read = n => JSON.parse(fs.readFileSync(file(n), 'utf8'));
    return { st, api, file, read, write, select };
}
const stamped = async (s, p) => ({ ...p, shown: await apply.currentOf(s.api, p) });

test('a setting of a preset that is not selected: the file and the page copy change; Undo byte for byte', async () => {
    const s = fakePresets();
    const h0 = sha(s.file('Story'));
    const r = await apply.applyProposal(s.api, await stamped(s, { op: 'edit_preset_setting', name: 'Story', key: 'temperature', value: 1.2, why: 'x' }));
    assert.equal(r.ok, true, r.error);
    assert.equal(s.read('Story').temperature, 1.2);
    assert.equal(s.st.memory.Story.temperature, 1.2);
    assert.equal(s.read('Story').top_p, 1);
    assert.equal(s.st.working.temp_openai, 1, 'the selected preset is untouched');
    const u = await apply.undoChange(s.api, r.change);
    assert.equal(u.ok, true, u.error || JSON.stringify(u));
    assert.equal(sha(s.file('Story')), h0);
    assert.equal(s.st.memory.Story.temperature, 0.8);
});

test('connection, address, tool and extension settings are never changed; values outside the control are refused', async () => {
    const s = fakePresets();
    for (const key of ['custom_url', 'reverse_proxy', 'chat_completion_source', 'extensions', 'function_calling', 'proxy_password']) {
        const r = await apply.applyProposal(s.api, { op: 'edit_preset_setting', name: 'Story', key, value: 'x', why: 'x' });
        assert.equal(r.ok, false, key); assert.match(r.error, /can change/, key);
    }
    const r = await apply.applyProposal(s.api, { op: 'edit_preset_setting', name: 'Story', key: 'temperature', value: 5, why: 'x' });
    assert.equal(r.ok, false); assert.match(r.error, /at most 2/);
    assert.equal(s.api.changes.list({}).length, 0);
});

test('the selected preset: its working copy changes too; an unsaved edit in that setting is refused, one in another stays', async () => {
    const s = fakePresets();
    s.st.working.temp_openai = 1.5; // unsaved in SillyTavern
    let r = await apply.applyProposal(s.api, await stamped(s, { op: 'edit_preset_setting', name: 'Default', key: 'temperature', value: 0.7, why: 'x' }));
    assert.equal(r.ok, false); assert.match(r.error, /unsaved/); assert.equal(r.change, undefined);
    s.st.working.temp_openai = 1;
    s.st.working.top_p_openai = 0.5; // unsaved, in another setting
    r = await apply.applyProposal(s.api, await stamped(s, { op: 'edit_preset_setting', name: 'Default', key: 'temperature', value: 0.7, why: 'x' }));
    assert.equal(r.ok, true, r.error);
    assert.equal(s.read('Default').temperature, 0.7);
    assert.equal(s.st.working.temp_openai, 0.7);
    assert.equal(s.st.working.top_p_openai, 0.5, 'the other unsaved edit stays');
    const u = await apply.undoChange(s.api, r.change);
    assert.equal(u.ok, true, u.error || JSON.stringify(u));
    assert.equal(s.st.working.temp_openai, 1);
    assert.equal(s.read('Default').temperature, 1);
});

test('a prompt\'s text, and Undo after another change to the file puts back only that prompt', async () => {
    const s = fakePresets();
    const r = await apply.applyProposal(s.api, await stamped(s, { op: 'edit_preset_prompt', name: 'Story', identifier: 'tone', find: 'light', replace: 'dark', why: 'x' }));
    assert.equal(r.ok, true, r.error);
    assert.equal(s.read('Story').prompts.find(x => x.identifier === 'tone').content, 'Keep it dark.');
    const later = s.read('Story'); later.top_p = 0.9; s.write('Story', later); // saved by the user later
    const u = await apply.undoChange(s.api, r.change);
    assert.equal(u.ok, true, u.error || JSON.stringify(u));
    assert.equal(s.read('Story').prompts.find(x => x.identifier === 'tone').content, 'Keep it light.');
    assert.equal(s.read('Story').top_p, 0.9);
    const marker = await apply.applyProposal(s.api, { op: 'edit_preset_prompt', name: 'Story', identifier: 'chatHistory', set: 'x', why: 'x' });
    assert.equal(marker.ok, false); assert.match(marker.error, /placeholder/);
});

test('adding a prompt puts it in the order Chat Completion uses; removing one of SillyTavern\'s own is refused; Undo of a removal puts it back in place', async () => {
    const s = fakePresets();
    const h0 = sha(s.file('Story'));
    const add = await apply.applyProposal(s.api, { op: 'add_preset_prompt', name: 'Story', prompt: { identifier: 'weather', name: 'Weather', content: 'It is raining.' }, why: 'x' });
    assert.equal(add.ok, true, add.error);
    const f = s.read('Story');
    assert.ok(f.prompts.some(x => x.identifier === 'weather'));
    assert.deepEqual(f.prompt_order.find(e => e.character_id === 100001).order.at(-1), { identifier: 'weather', enabled: true });
    assert.equal(f.prompt_order.find(e => e.character_id === 100000).order.length, 1);
    assert.equal((await apply.undoChange(s.api, add.change)).ok, true);
    assert.equal(sha(s.file('Story')), h0);
    const own = await apply.applyProposal(s.api, { op: 'remove_preset_prompt', name: 'Story', identifier: 'main', why: 'x' });
    assert.equal(own.ok, false); assert.match(own.error, /SillyTavern's own/);
    const rm = await apply.applyProposal(s.api, { op: 'remove_preset_prompt', name: 'Story', identifier: 'tone', why: 'x' });
    assert.equal(rm.ok, true, rm.error);
    assert.equal(s.read('Story').prompts.some(x => x.identifier === 'tone'), false);
    const later = s.read('Story'); later.seed = 3; s.write('Story', later);
    assert.equal((await apply.undoChange(s.api, rm.change)).ok, true);
    const back = s.read('Story');
    assert.equal(back.prompts[2].identifier, 'tone');
    assert.deepEqual(back.prompt_order.find(e => e.character_id === 100001).order.map(x => x.identifier), ['main', 'tone', 'chatHistory']);
    assert.equal(back.seed, 3);
});

test('reordering takes each prompt once', async () => {
    const s = fakePresets();
    const bad = await apply.applyProposal(s.api, { op: 'reorder_preset_prompts', name: 'Story', order: ['tone', 'main'], why: 'x' });
    assert.equal(bad.ok, false); assert.match(bad.error, /each of/);
    const r = await apply.applyProposal(s.api, await stamped(s, { op: 'reorder_preset_prompts', name: 'Story', order: ['tone', 'main', 'chatHistory'], why: 'x' }));
    assert.equal(r.ok, true, r.error);
    assert.deepEqual(s.read('Story').prompt_order.find(e => e.character_id === 100001).order.map(x => x.identifier), ['tone', 'main', 'chatHistory']);
    assert.equal((await apply.undoChange(s.api, r.change)).ok, true);
    assert.deepEqual(s.read('Story').prompt_order.find(e => e.character_id === 100001).order.map(x => x.identifier), ['main', 'tone', 'chatHistory']);
});

test('a new preset is a copy, never named like another preset or a character; Undo deletes it unless it is selected', async () => {
    const s = fakePresets();
    for (const name of ['story', 'Kit', 'harbour', 'Bad‎Name']) {
        const r = await apply.applyProposal(s.api, { op: 'create_preset', name, from: 'Story', why: 'x' });
        assert.equal(r.ok, false, name);
    }
    const r = await apply.applyProposal(s.api, { op: 'create_preset', name: 'Story copy', from: 'Story', why: 'x' });
    assert.equal(r.ok, true, r.error);
    assert.deepEqual(s.read('Story copy'), s.read('Story'));
    assert.ok(s.st.memory['Story copy']);
    s.select('Story copy');
    let u = await apply.undoChange(s.api, r.change);
    assert.equal(u.ok, false); assert.match(u.error, /selected/);
    s.select('Default');
    u = await apply.undoChange(s.api, r.change);
    assert.equal(u.ok, true, u.error || JSON.stringify(u));
    assert.equal(fs.existsSync(s.file('Story copy')), false);
});

// ---- review fixes (Batch 8) ----
test('settings shown as radio buttons take only their own values; whole numbers stay whole', async () => {
    const s = fakePresets();
    for (const [key, value] of [['names_behavior', 7], ['continue_postfix', 'x'], ['seed', 1.5], ['openai_max_tokens', -3]]) {
        const r = await apply.applyProposal(s.api, { op: 'edit_preset_setting', name: 'Story', key, value, why: 'x' });
        assert.equal(r.ok, false, key);
    }
    assert.equal((await apply.applyProposal(s.api, { op: 'edit_preset_setting', name: 'Story', key: 'names_behavior', value: 2, why: 'x' })).ok, true);
    assert.equal((await apply.applyProposal(s.api, { op: 'edit_preset_setting', name: 'Story', key: 'continue_postfix', value: '\n', why: 'x' })).ok, true);
});

test('preset names every object already has, or too long for a file, are refused', async () => {
    const s = fakePresets();
    for (const name of ['__proto__', 'constructor', 'toString', 'é'.repeat(120)]) {
        const r = await apply.applyProposal(s.api, { op: 'create_preset', name, from: 'Story', why: 'x' });
        assert.equal(r.ok, false, name.slice(0, 12));
    }
});

test('Undo of a new preset waits while a Connection Profile uses it', async () => {
    const s = fakePresets();
    const r = await apply.applyProposal(s.api, { op: 'create_preset', name: 'Story two', from: 'Story', why: 'x' });
    s.st.profiles = [{ id: 'p1', name: 'Night writing', preset: 'Story two' }];
    const u = await apply.undoChange(s.api, r.change);
    assert.equal(u.ok, false); assert.match(u.error, /Night writing/);
    assert.ok(fs.existsSync(s.file('Story two')));
});

test('an unsaved edit to the order number of a prompt in the selected preset is kept', async () => {
    const s = fakePresets();
    s.st.working.prompts.find(x => x.identifier === 'tone').injection_order = 50; // unsaved in SillyTavern
    const r = await apply.applyProposal(s.api, await stamped(s, { op: 'edit_preset_prompt', name: 'Default', identifier: 'tone', set: 'Keep it calm.', why: 'x' }));
    assert.equal(r.ok, false); assert.match(r.error, /unsaved/);
});

test('"Put back" of a removed prompt never makes a second copy; of an edit whose prompt is gone, says so', async () => {
    const s = fakePresets();
    const rm = await apply.applyProposal(s.api, { op: 'remove_preset_prompt', name: 'Story', identifier: 'tone', why: 'x' });
    const f = s.read('Story'); f.prompts.push({ identifier: 'tone', name: 'Tone', role: 'system', content: 'Made again by the user.' }); f.prompt_order.find(e => e.character_id === 100001).order.push({ identifier: 'tone', enabled: true }); s.write('Story', f);
    const u = await apply.undoChange(s.api, rm.change);
    if (u.conflict) assert.equal((await apply.undoChange(s.api, rm.change, { choice: 'mine' })).ok, true);
    assert.equal(s.read('Story').prompts.filter(x => x.identifier === 'tone').length, 1);
    assert.equal(s.read('Story').prompt_order.find(e => e.character_id === 100001).order.filter(x => x.identifier === 'tone').length, 1);
    const ed = await apply.applyProposal(s.api, await stamped(s, { op: 'edit_preset_prompt', name: 'Story', identifier: 'tone', set: 'Edited.', why: 'x' }));
    const g = s.read('Story'); g.prompts = g.prompts.filter(x => x.identifier !== 'tone'); s.write('Story', g);
    const m = await apply.undoChange(s.api, ed.change, { choice: 'mine' });
    assert.equal(m.ok, false); assert.match(m.error, /isn't in the preset/);
});
