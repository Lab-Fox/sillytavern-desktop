// Co-pilot: chat completion presets. SillyTavern keeps every preset in the
// page's memory and works on a copy of the selected one (which can hold
// unsaved edits), so a change is saved to the file through SillyTavern's
// route (the whole preset, only the touched part changed) and then given to
// the page: its copy of the preset, and for the selected preset the working
// copy too (through SillyTavern's own controls). A change is refused when the
// selected preset has unsaved edits in what it touches.
//
// Only settings that shape the reply can be changed: never the connection
// (API, model, address, proxy, keys), tools, costs, pictures or the preset's
// extensions (regex scripts). Undo puts the whole file back when nothing
// changed it since (presets are only written when someone saves them),
// otherwise just the item.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { fail, same, copy, fold, checkValue, edited, handleOf, written, hashNow, CHANGED, RESERVED, BAD_NAME, MAX_TEXT } = require('./apply-util.cjs');

const OPS = new Set(['create_preset', 'edit_preset_setting', 'edit_preset_prompt', 'add_preset_prompt', 'remove_preset_prompt', 'reorder_preset_prompts']);
const ORDER = '100001'; // the prompt order Chat Completion uses
// Preset settings the co-pilot may change, and their kind.
const SETTINGS = {
    temperature: 'number', frequency_penalty: 'number', presence_penalty: 'number', top_p: 'number', top_k: 'int', top_a: 'number',
    min_p: 'number', repetition_penalty: 'number', openai_max_context: 'int', openai_max_tokens: 'int', seed: 'int', names_behavior: 'names',
    reasoning_effort: 'choice', verbosity: 'choice', continue_postfix: 'postfix',
    stream_openai: 'bool', use_sysprompt: 'bool', squash_system_messages: 'bool', continue_prefill: 'bool', show_thoughts: 'bool',
    send_if_empty: 'text', impersonation_prompt: 'text', new_chat_prompt: 'text', new_group_chat_prompt: 'text', new_example_chat_prompt: 'text',
    continue_nudge_prompt: 'text', wi_format: 'text', scenario_format: 'text', personality_format: 'text', group_nudge_prompt: 'text',
    assistant_prefill: 'text', assistant_impersonation: 'text',
};
// Settings whose controls are radio buttons (no limits to read from the page).
const FIXED = { names: [-1, 0, 1, 2], postfix: ['', ' ', '\n', '\n\n'] };
const ROLES = ['system', 'user', 'assistant'];
// Names that every JavaScript object already has: SillyTavern's name list is a plain object.
const OBJECT_NAMES = new Set(Object.getOwnPropertyNames(Object.prototype).concat(['prototype']));
const MAX_NAME = 100;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

const page = (api, name, args) => api.sillytavern.page(name, args);
const orderOf = preset => (preset?.prompt_order || []).find(e => String(e.character_id) === ORDER) || null;
const promptOf = (preset, id) => (preset?.prompts || []).find(p => p.identifier === id) || null;
// What counts in a prompt when comparing the working copy with the file
// (SillyTavern adds fields of its own to the working copy).
const promptCore = p => (p ? { identifier: p.identifier, name: p.name ?? '', role: p.role ?? '', content: p.content ?? '', injection_position: p.injection_position ?? 0, injection_depth: p.injection_depth ?? 4,
    injection_order: p.injection_order ?? 100, injection_trigger: p.injection_trigger ?? [], forbid_overrides: !!p.forbid_overrides } : null);
const orderCore = e => (e?.order || []).map(x => [x.identifier, !!x.enabled]);

// The preset as it is on disk (the truth) and as the page holds it.
async function load(api, name, keys = []) {
    if (typeof name !== 'string' || !name) return { error: 'Name the preset.' };
    const st = await page(api, 'presetState', { name, keys });
    if (!st.ready) return { error: 'SillyTavern is still starting (is its welcome screen open?). Try again in a moment.' };
    if (!st.exists) return { error: `There is no chat completion preset called "${name}".` };
    const h = await handleOf(api);
    const rel = `data/${h}/OpenAI Settings/${name}.json`;
    const abs = path.join(api.sillytavern.folder(), rel);
    // The file must carry the preset's own name (SillyTavern changes some characters in file names).
    let listed = [];
    try { listed = fs.readdirSync(path.dirname(abs)); } catch { /* none */ }
    if (!listed.includes(`${name}.json`)) return { error: `The preset "${name}" isn't saved under its own name in this SillyTavern's data folder, so no copy could be kept: nothing was written.` };
    let file;
    try { file = JSON.parse(fs.readFileSync(abs, 'utf8')); } catch { return { error: `The preset file of "${name}" can't be read.` }; }
    if (!file || typeof file !== 'object' || Array.isArray(file)) return { error: `The preset file of "${name}" isn't a preset.` };
    return { st, rel, abs, file, name };
}

// Unsaved edits in the selected preset, in what this change touches (null: none).
function unsaved(b, { settings = [], prompts = [], order = false }) {
    if (!b.st.isSelected) return null;
    for (const k of settings) {
        if (b.file[k] !== undefined && !same(b.st.working?.[k], b.file[k])) return `SillyTavern has unsaved changes to "${k}" in this preset: save the preset or undo that change in SillyTavern first.`;
    }
    for (const id of prompts) {
        const w = (b.st.workingPrompts || []).find(p => p.identifier === id) || null;
        if (!same(promptCore(w), promptCore(promptOf(b.file, id)))) return `SillyTavern has unsaved changes to the prompt "${id}" in this preset: save the preset or undo that change in SillyTavern first.`;
    }
    if (order && !same(orderCore(b.st.workingOrder), orderCore(orderOf(b.file)))) return 'SillyTavern has unsaved changes to the order of this preset\'s prompts: save the preset or undo that change in SillyTavern first.';
    return null;
}

// Saves the preset through SillyTavern, then the page's copies.
async function save(api, name, next, working, { add = false } = {}) {
    const r = await api.sillytavern.request('POST', '/api/presets/save', { apiId: 'openai', name, preset: next });
    if (r?.name !== undefined && r.name !== name) {
        // Saved under another file name: that file goes again (the journal doesn't cover it).
        try { await api.sillytavern.request('POST', '/api/presets/delete', { apiId: 'openai', name: r.name }); } catch { /* reported below */ }
        throw new Error(`SillyTavern changed the name to "${r.name}": nothing was kept.`);
    }
    const put = await page(api, 'presetPut', { name, preset: next, add, working });
    if (put?.refused) throw new Error(put.refused);
    return put;
}

function checkSetting(b, key, value) {
    const kind = SETTINGS[key];
    const c = b.st.controls?.[key];
    if (kind === 'number') {
        if (typeof value !== 'number' || !Number.isFinite(value)) return `"${key}" must be a number.`;
        if (c?.min != null && value < c.min) return `"${key}" must be at least ${c.min}.`;
        if (c?.max != null && value > c.max) return `"${key}" must be at most ${c.max} (SillyTavern's limit for it now).`;
        if (c?.options && !c.options.includes(String(value))) return `"${key}" must be one of ${c.options.join(', ')}.`;
        return null;
    }
    if (kind === 'int') {
        if (!Number.isInteger(value)) return `"${key}" must be a whole number.`;
        if (c?.min != null && value < c.min) return `"${key}" must be at least ${c.min}.`;
        if (c?.max != null && value > c.max) return `"${key}" must be at most ${c.max} (SillyTavern's limit for it now).`;
        if (c?.min == null && value < (key === 'seed' ? -1 : 0)) return `"${key}" must be ${key === 'seed' ? '-1 or more' : '0 or more'}.`;
        return null;
    }
    if (FIXED[kind]) return FIXED[kind].includes(value) ? null : `"${key}" must be one of ${FIXED[kind].map(v => JSON.stringify(v)).join(', ')}.`;
    if (kind === 'bool') return typeof value === 'boolean' ? null : `"${key}" must be true or false.`;
    if (kind === 'choice') {
        if (typeof value !== 'string') return `"${key}" must be text.`;
        if (c?.options && !c.options.includes(value)) return `"${key}" must be one of ${c.options.join(', ')}.`;
        return null;
    }
    const bad = checkValue('text', value);
    return bad ? `"${key}" ${bad}.` : null;
}

// One change: the touched part of the preset before and after, the new
// preset, and what the selected preset's working copy gets.
async function plan(api, p) {
    if (p.op === 'edit_preset_setting') {
        if (!Object.hasOwn(SETTINGS, p.key)) return { error: `"${String(p.key).slice(0, 60)}" isn't a preset setting the co-pilot can change (connection, tool and cost settings stay as they are). It can change: ${Object.keys(SETTINGS).join(', ')}.` };
        const b = await load(api, p.name, [p.key]);
        if (b.error) return b;
        const bad = checkSetting(b, p.key, p.value);
        if (bad) return { error: bad };
        const before = b.file[p.key];
        if (same(before, p.value)) return { error: 'It is already like that: nothing to change.' };
        return { b, touch: { settings: [p.key] }, next: { ...b.file, [p.key]: p.value }, item: { kind: 'setting', key: p.key, before: before === undefined ? null : before, after: p.value, absent: before === undefined, workingBefore: b.st.isSelected ? (b.st.working?.[p.key] ?? null) : null }, working: { settings: { [p.key]: p.value } } };
    }
    if (p.op === 'edit_preset_prompt') {
        const b = await load(api, p.name);
        if (b.error) return b;
        const pr = promptOf(b.file, p.identifier);
        if (!pr) return { error: `The preset "${p.name}" has no prompt "${p.identifier}".` };
        if (pr.marker) return { error: `"${p.identifier}" is a placeholder SillyTavern fills in (chat history, card fields…): it has no text to change.` };
        const r = edited(pr.content ?? '', p, 'text');
        if (r.error) return r;
        if (r.value === (pr.content ?? '')) return { error: 'It is already like that: nothing to change.' };
        const after = { ...pr, content: r.value };
        const next = { ...b.file, prompts: b.file.prompts.map(x => (x.identifier === p.identifier ? after : x)) };
        return { b, touch: { prompts: [p.identifier] }, next, item: { kind: 'prompt', identifier: p.identifier, before: pr, after }, working: { prompts: [p.identifier] } };
    }
    if (p.op === 'add_preset_prompt') {
        const g = p.prompt;
        if (!g || typeof g !== 'object' || Array.isArray(g)) return { error: '"prompt" must be an object.' };
        const allowed = ['identifier', 'name', 'role', 'content', 'enabled', 'injection_position', 'injection_depth'];
        const extra = Object.keys(g).find(k => !allowed.includes(k));
        if (extra) return { error: `"${extra.slice(0, 40)}" can't be set on a new prompt (it takes ${allowed.join(', ')}).` };
        if (typeof g.name !== 'string' || !g.name.trim() || g.name.length > MAX_NAME) return { error: 'A new prompt needs a short "name".' };
        if (g.role !== undefined && !ROLES.includes(g.role)) return { error: `"role" must be one of ${ROLES.join(', ')}.` };
        const bad = checkValue('text', g.content ?? '');
        if (bad) return { error: `"content" ${bad}.` };
        if (g.enabled !== undefined && typeof g.enabled !== 'boolean') return { error: '"enabled" must be true or false.' };
        if (g.injection_position !== undefined && ![0, 1].includes(g.injection_position)) return { error: '"injection_position" must be 0 (in the prompt) or 1 (in the chat at a depth).' };
        if (g.injection_depth !== undefined && !(Number.isInteger(g.injection_depth) && g.injection_depth >= 0 && g.injection_depth <= 10000)) return { error: '"injection_depth" must be a whole number, 0 or more.' };
        if (g.identifier !== undefined && !(typeof g.identifier === 'string' && ID.test(g.identifier))) return { error: '"identifier" may use letters, digits, - and _ only.' };
        const b = await load(api, p.name);
        if (b.error) return b;
        const id = g.identifier ?? `copilot-${crypto.randomBytes(4).toString('hex')}`;
        if (promptOf(b.file, id)) return { error: `The preset "${p.name}" has a prompt "${id}" already.` };
        const ord = orderOf(b.file);
        if (!ord) return { error: 'This preset has no prompt order yet: open it once in SillyTavern and save it, then try again.' };
        const pr = { identifier: id, name: g.name.trim(), role: g.role ?? 'system', content: g.content ?? '', system_prompt: false, marker: false, injection_position: g.injection_position ?? 0, injection_depth: g.injection_depth ?? 4 };
        const next = { ...b.file, prompts: [...(b.file.prompts || []), pr],
            prompt_order: b.file.prompt_order.map(e => (String(e.character_id) === ORDER ? { ...e, order: [...(e.order || []), { identifier: id, enabled: g.enabled ?? true }] } : e)) };
        return { b, touch: { prompts: [id], order: true }, next, item: { kind: 'prompt-add', identifier: id, after: pr }, working: { prompts: [id], order: true } };
    }
    if (p.op === 'remove_preset_prompt') {
        const b = await load(api, p.name);
        if (b.error) return b;
        const idx = (b.file.prompts || []).findIndex(x => x.identifier === p.identifier);
        if (idx < 0) return { error: `The preset "${p.name}" has no prompt "${p.identifier}".` };
        const pr = b.file.prompts[idx];
        if (pr.system_prompt || pr.marker) return { error: `"${p.identifier}" is one of SillyTavern's own prompts: it can be turned off in SillyTavern, not removed.` };
        // Where it was in every order list (Undo puts it back there).
        const places = (b.file.prompt_order || []).map(e => ({ character_id: e.character_id, index: (e.order || []).findIndex(x => x.identifier === p.identifier), entry: (e.order || []).find(x => x.identifier === p.identifier) || null })).filter(x => x.index >= 0);
        const next = { ...b.file, prompts: b.file.prompts.filter(x => x.identifier !== p.identifier),
            prompt_order: (b.file.prompt_order || []).map(e => ({ ...e, order: (e.order || []).filter(x => x.identifier !== p.identifier) })) };
        return { b, touch: { prompts: [p.identifier], order: true }, next, item: { kind: 'prompt-remove', identifier: p.identifier, before: pr, index: idx, places }, working: { prompts: [p.identifier], order: true } };
    }
    if (p.op === 'reorder_preset_prompts') {
        const b = await load(api, p.name);
        if (b.error) return b;
        const ord = orderOf(b.file);
        if (!ord) return { error: 'This preset has no prompt order yet: open it once in SillyTavern and save it, then try again.' };
        const now = (ord.order || []).map(x => x.identifier);
        const want = Array.isArray(p.order) ? p.order : [];
        if (want.length !== now.length || new Set(want).size !== want.length || !want.every(id => now.includes(id))) return { error: `"order" must list each of the preset's prompts once: ${now.join(', ')}.` };
        if (same(want, now)) return { error: 'It is already like that: nothing to change.' };
        const after = want.map(id => ord.order.find(x => x.identifier === id));
        const next = { ...b.file, prompt_order: b.file.prompt_order.map(e => (String(e.character_id) === ORDER ? { ...e, order: after } : e)) };
        return { b, touch: { order: true }, next, item: { kind: 'order', before: ord.order, after }, working: { order: true } };
    }
    return { error: 'Applying this kind of change comes in the next version of the co-pilot.' };
}

// What the card shows before Apply.
async function currentOf(api, p) {
    if (p.op === 'edit_preset_setting' && Object.hasOwn(SETTINGS, p.key)) {
        const b = await load(api, p.name, [p.key]);
        if (b.error) return null;
        return { current: b.file[p.key] !== undefined ? b.file[p.key] : b.st.isSelected ? (b.st.working?.[p.key] ?? null) : null };
    }
    if (p.op === 'edit_preset_prompt' || p.op === 'remove_preset_prompt') { const b = await load(api, p.name); const pr = b.error ? null : promptOf(b.file, p.identifier); return pr ? { current: pr.content ?? '' } : null; }
    if (p.op === 'reorder_preset_prompts') { const b = await load(api, p.name); return b.error ? null : { current: (orderOf(b.file)?.order || []).map(x => x.identifier) }; }
    return null;
}

async function createPreset(api, p) {
    const name = typeof p.name === 'string' ? p.name : '';
    if (!name.trim() || name !== name.trim() || name.length > MAX_NAME || Buffer.byteLength(name) > 200 || OBJECT_NAMES.has(name) || BAD_NAME.test(name) || RESERVED.test(name) || /[. ]$/.test(name)) return fail('That name can\'t be a preset name (empty, too long, characters a file name can\'t have, or invisible characters).');
    const src = await page(api, 'presetState', { name: p.from ?? '' });
    if (!src.ready) return fail('SillyTavern is still starting (is its welcome screen open?). Try again in a moment.');
    const twin = src.names.find(n => fold(n) === fold(name));
    if (twin) return fail(`There is a preset called "${twin}" already.`);
    // SillyTavern switches to a preset named like a character or group when that chat opens.
    if ([...src.characters, ...src.groups].some(n => fold(n) === fold(name))) return fail(`"${name}" is also the name of a character or group: SillyTavern would switch to this preset whenever that chat opens. Pick another name.`);
    const from = p.from ?? src.selected;
    if (!from) return fail('Say which preset to copy ("from").');
    const b = await load(api, from);
    if (b.error) return fail(b.error);
    const next = copy(b.file);
    const rel = `data/${await handleOf(api)}/OpenAI Settings/${name}.json`;
    if (fs.existsSync(path.join(api.sillytavern.folder(), rel))) return fail(`There is a preset file called "${name}" already.`);
    const folder = api.sillytavern.folder();
    const journal = await api.changes.record({ folder, kind: 'preset-create', target: { name, from }, before: null, after: { from }, files: [rel] });
    const change = { journal, op: p.op, target: { name, from }, file: rel };
    return written(api, journal, change, () => save(api, name, next, null, { add: true }),
        async () => (fs.existsSync(path.join(folder, rel)) && same(JSON.parse(fs.readFileSync(path.join(folder, rel), 'utf8')), next) ? null : 'SillyTavern didn\'t save the new preset as expected. Undo removes it.'));
}

async function applyPreset(api, p) {
    if (p.op === 'create_preset') return createPreset(api, p);
    const x = await plan(api, p);
    if (x.error) return fail(x.error);
    const { b } = x;
    if (p.shown && Object.hasOwn(p.shown, 'current')) {
        const now = await currentOf(api, p);
        if (!same(now?.current ?? null, p.shown.current)) return fail(CHANGED);
    }
    const busy = unsaved(b, x.touch);
    if (busy) return fail(busy);
    const folder = api.sillytavern.folder();
    const target = { name: b.name, selected: b.st.isSelected, ...(x.item.key ? { key: x.item.key } : {}), ...(x.item.identifier ? { identifier: x.item.identifier } : {}) };
    const journal = await api.changes.record({ folder, kind: `preset-${x.item.kind}`, target, before: { item: x.item }, after: { item: x.item }, files: [b.rel] });
    const change = { journal, op: p.op, target, file: b.rel, touch: x.touch, working: x.working };
    let put = null;
    return written(api, journal, change, async () => { put = await save(api, b.name, x.next, b.st.isSelected ? x.working : null); }, async () => {
        if (!same(JSON.parse(fs.readFileSync(b.abs, 'utf8')), x.next)) return 'SillyTavern saved something else than proposed. Undo puts the preset back.';
        if (b.st.isSelected && put?.working) {
            for (const [k, v] of Object.entries(x.working.settings || {})) if (!same(put.working[k], v)) return `SillyTavern shows "${k}" as ${JSON.stringify(put.working[k])}. Undo puts it back.`;
        }
        return null;
    });
}

// The item as it is now in a preset file, to compare with what the change left.
function itemNow(file, item) {
    if (item.kind === 'setting') return file[item.key] ?? null;
    if (item.kind === 'prompt' || item.kind === 'prompt-add') return promptOf(file, item.identifier);
    if (item.kind === 'prompt-remove') return promptOf(file, item.identifier);
    if (item.kind === 'order') return orderOf(file)?.order || null;
    return null;
}
const itemAfter = item => (item.kind === 'prompt-remove' ? null : item.after ?? null);
const itemBefore = item => (item.kind === 'setting' ? item.before : item.kind === 'prompt-add' ? null : item.before ?? null);
const show = v => (v == null ? '(none)' : typeof v === 'string' ? v : Array.isArray(v) ? v.map(x => x.identifier ?? x).join(', ') : JSON.stringify(v));

// The preset file with the item put back as it was.
function putBack(file, item) {
    if (item.kind === 'setting') { const n = { ...file }; if (item.absent) delete n[item.key]; else n[item.key] = item.before; return n; }
    if (item.kind === 'prompt') return promptOf(file, item.identifier) ? { ...file, prompts: file.prompts.map(x => (x.identifier === item.identifier ? item.before : x)) } : null;
    if (item.kind === 'prompt-add') return { ...file, prompts: file.prompts.filter(x => x.identifier !== item.identifier), prompt_order: (file.prompt_order || []).map(e => ({ ...e, order: (e.order || []).filter(x => x.identifier !== item.identifier) })) };
    if (item.kind === 'prompt-remove') {
        // (put back once, wherever a copy of it is now)
        file = { ...file, prompts: (file.prompts || []).filter(x => x.identifier !== item.identifier),
            prompt_order: (file.prompt_order || []).map(e => ({ ...e, order: (e.order || []).filter(x => x.identifier !== item.identifier) })) };
        const prompts = [...(file.prompts || [])];
        prompts.splice(Math.min(item.index, prompts.length), 0, item.before);
        const prompt_order = (file.prompt_order || []).map(e => {
            const at = item.places.find(pl => String(pl.character_id) === String(e.character_id));
            if (!at) return e;
            const order = [...(e.order || [])];
            order.splice(Math.min(at.index, order.length), 0, at.entry);
            return { ...e, order };
        });
        return { ...file, prompts, prompt_order };
    }
    if (item.kind === 'order') return { ...file, prompt_order: file.prompt_order.map(e => (String(e.character_id) === ORDER ? { ...e, order: item.before } : e)) };
    return file;
}

// A setting the file didn't have, on a preset selected since: SillyTavern keeps
// using the co-pilot's value until the preset is picked again.
const workingNote = (b, item) => (item.kind === 'setting' && item.absent && item.workingBefore == null && b.st.isSelected && same(b.st.working?.[item.key], item.after)
    ? `SillyTavern still uses ${JSON.stringify(item.after)} for "${item.key}" until you pick the preset again.` : '');

async function undoPreset(api, change, e, { choice } = {}) {
    const mine = choice === 'mine';
    const t = e.target || change.target;
    const f = e.files[0];
    try {
        if (change.op === 'create_preset') {
            const st = await page(api, 'presetState', { name: t.name });
            if (!st.exists) {
                // Not in the page's list, but its file may be there.
                if (!fs.existsSync(f.path)) return { ok: true, how: 'gone already' };
                if (hashNow(f.path) !== f.afterSha256 && !mine) return { conflict: { current: 'The preset was changed after it was made.', before: '(no preset)', after: t.name } };
                await api.sillytavern.request('POST', '/api/presets/delete', { apiId: 'openai', name: t.name });
                return fs.existsSync(f.path) ? fail('SillyTavern didn\'t delete the preset file.') : { ok: true, how: 'item' };
            }
            if (st.isSelected) return fail('That preset is selected in SillyTavern: pick another preset first, then Undo.');
            // A Connection Profile that uses it would stop working.
            let users = [];
            try { users = ((await page(api, 'profiles')).profiles || []).filter(x => x.preset === t.name).map(x => x.name); } catch { /* no Connection Manager */ }
            if (users.length) return fail(`The Connection Profile ${users.map(n => `"${n}"`).join(', ')} uses this preset now: change the profile first, then Undo.`);
            if (hashNow(f.path) !== f.afterSha256 && !mine) return { conflict: { current: 'The preset was changed after it was made.', before: '(no preset)', after: t.name } };
            const r = await page(api, 'presetPut', { name: t.name, remove: true });
            if (r?.refused) return fail(r.refused);
            return fs.existsSync(f.path) ? fail('SillyTavern didn\'t delete the preset file.') : { ok: true, how: 'item' };
        }
        const item = e.before.item;
        const keys = item.kind === 'setting' ? [item.key] : [];
        const b = await load(api, t.name, keys);
        if (b.error) return fail(b.error);
        const touch = change.touch || (item.kind === 'setting' ? { settings: [item.key] } : item.kind === 'order' ? { order: true } : { prompts: [item.identifier], order: item.kind !== 'prompt' });
        const working = change.working || (item.kind === 'setting' ? { settings: { [item.key]: item.before } } : { prompts: item.identifier ? [item.identifier] : [], order: !!touch.order });
        // The selected preset with unsaved edits in this item: those stay unless the user says so.
        const busy = unsaved(b, touch);
        if (busy && !mine) return { conflict: { current: busy, before: show(itemBefore(item)), after: show(itemAfter(item)) }, noMine: false };
        // A setting the file didn't have: the working copy gets back what it had before.
        const backWorking = file => (item.kind !== 'setting' ? working
            : item.absent ? { settings: item.workingBefore == null ? {} : { [item.key]: item.workingBefore } } : { settings: { [item.key]: file[item.key] } });
        if (hashNow(f.path) === f.afterSha256 && !busy) {
            // Nothing changed the file since: all of it back, byte for byte.
            await api.changes.restoreFile(change.journal, f.path);
            const restored = JSON.parse(fs.readFileSync(f.path, 'utf8'));
            const put = await page(api, 'presetPut', { name: t.name, preset: restored, working: b.st.isSelected ? backWorking(restored) : null });
            if (put?.refused) return fail(put.refused);
            return { ok: true, how: 'file', note: workingNote(b, item) };
        }
        if (!same(itemNow(b.file, item), itemAfter(item)) && !mine) return { conflict: { current: show(itemNow(b.file, item)), before: show(itemBefore(item)), after: show(itemAfter(item)) } };
        const next = putBack(b.file, item);
        if (!next) return fail(`The prompt "${item.identifier}" isn't in the preset any more, so there is nothing to put back.`);
        await save(api, t.name, next, b.st.isSelected ? backWorking(next) : null);
        const saved = JSON.parse(fs.readFileSync(b.abs, 'utf8'));
        if (!same(saved, next) || !same(itemNow(saved, item), itemBefore(item))) return fail('SillyTavern saved something else than expected.');
        return { ok: true, how: 'item', note: workingNote(b, item) };
    } catch (err) {
        return fail(err.message || String(err));
    }
}

module.exports = { OPS, SETTINGS, applyPreset, undoPreset, currentOf };
