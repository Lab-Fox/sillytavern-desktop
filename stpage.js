// Named functions add-ons can run in a SillyTavern page (api.sillytavern.page).
// Only the functions below run: an add-on picks one by name and passes plain
// data, never code. They run in the page's own world, where SillyTavern's
// getContext() lives, and report back through a small call table the main
// process reads from (so the page gets no new bridge to the app).
import crypto from 'crypto';

// Each one: async (args, { chunk(data), signal }) => result. Page code: keep
// it to what SillyTavern's getContext() offers.
export const FUNCTIONS = {
    version: `async () => {
        const r = await fetch('/version', { cache: 'no-store' });
        const j = await r.json();
        return { version: String(j.pkgVersion || ''), branch: String(j.gitBranch || '') };
    }`,
    profiles: `async () => {
        const c = SillyTavern.getContext();
        const cm = c.extensionSettings.connectionManager;
        const currentMaxContext = Number(c.chatCompletionSettings?.openai_max_context) || 0;
        if (c.extensionSettings.disabledExtensions.includes('connection-manager') || !cm) return { available: false, profiles: [], selected: null, currentMaxContext };
        let list = [];
        try { list = c.ConnectionManagerRequestService.getSupportedProfiles(); } catch { list = []; }
        // A profile's context size: text completion uses SillyTavern's text
        // context size; chat completion its preset's, else the current one.
        const sizeOf = p => {
            if (c.CONNECT_API_MAP?.[p.api]?.selected === 'textgenerationwebui') return Number(c.maxContext) || 0;
            const preset = p.preset ? c.getPresetManager('openai')?.getCompletionPresetByName(p.preset) : null;
            return Number(preset?.openai_max_context) || currentMaxContext;
        };
        return {
            available: true,
            profiles: list.map(p => ({ id: String(p.id), name: String(p.name || ''), api: String(p.api || ''), model: String(p.model || ''), preset: String(p.preset || ''), maxContext: sizeOf(p) })),
            selected: cm.selectedProfile || null,
            currentMaxContext,
        };
    }`,
    tokenCount: `async ({ text } = {}) => ({ count: await SillyTavern.getContext().getTokenCountAsync(String(text ?? '')) })`,
    tokenCounts: `async ({ texts = [] } = {}) => {
        const c = SillyTavern.getContext();
        const counts = [];
        for (const t of Array.isArray(texts) ? texts.slice(0, 200) : []) counts.push(t ? await c.getTokenCountAsync(String(t)) : 0);
        return { counts };
    }`,
    // What is open: the chat, its character, the user's name.
    context: `async () => {
        const c = SillyTavern.getContext();
        const ch = c.characterId !== undefined ? c.characters[c.characterId] : null;
        return {
            chatId: c.getCurrentChatId?.() || null,
            characterAvatar: ch?.avatar || null, characterName: ch?.name || null,
            groupId: c.groupId || null, messageCount: Array.isArray(c.chat) ? c.chat.length : 0,
            userName: String(c.name1 || ''),
        };
    }`,
    // Messages of the open chat by index, at most 500 per call.
    chatMessages: `async ({ from = 0, to } = {}) => {
        const c = SillyTavern.getContext();
        const chat = Array.isArray(c.chat) ? c.chat : [];
        const a = Math.max(0, Math.floor(Number(from)) || 0);
        const b = Math.min(chat.length - 1, to == null ? chat.length - 1 : Math.floor(Number(to)), a + 499);
        const messages = [];
        for (let i = a; i <= b; i++) {
            const m = chat[i] || {};
            messages.push({ index: i, name: String(m.name || ''), isUser: !!m.is_user, isSystem: !!m.is_system, text: String(m.mes ?? '') });
        }
        return { chatId: c.getCurrentChatId?.() || null, total: chat.length, messages };
    }`,
    // A character's card fields as stored (no macros replaced).
    character: `async ({ avatar } = {}) => {
        const c = SillyTavern.getContext();
        const i = c.characters.findIndex(x => x.avatar === avatar);
        if (i < 0) throw new Error('No such character.');
        await c.unshallowCharacter?.(i);
        const ch = c.characters[i], d = ch.data || {};
        const s = v => String(v ?? '');
        return {
            avatar: ch.avatar, name: s(ch.name),
            description: s(d.description ?? ch.description), personality: s(d.personality ?? ch.personality),
            scenario: s(d.scenario ?? ch.scenario), first_mes: s(d.first_mes ?? ch.first_mes), mes_example: s(d.mes_example ?? ch.mes_example),
            alternate_greetings: Array.isArray(d.alternate_greetings) ? d.alternate_greetings.map(s) : [],
            creator_notes: s(d.creator_notes ?? ch.creatorcomment), system_prompt: s(d.system_prompt), post_history_instructions: s(d.post_history_instructions),
            tags: Array.isArray(d.tags) ? d.tags.map(s) : [],
        };
    }`,
    // A persona: avatar null = the one in use now.
    persona: `async ({ avatar = null } = {}) => {
        const c = SillyTavern.getContext();
        const pu = c.powerUserSettings;
        if (avatar == null) return { avatar: null, name: String(c.name1 || ''), description: String(pu.persona_description || '') };
        if (!Object.hasOwn(pu.personas || {}, avatar)) throw new Error('No such persona.');
        return { avatar, name: String(pu.personas[avatar] || ''), description: String(pu.persona_descriptions?.[avatar]?.description || '') };
    }`,
    // A chat completion preset: its settings, prompts and their order. name null = the selected one.
    preset: `async ({ name = null } = {}) => {
        const c = SillyTavern.getContext();
        const pm = c.getPresetManager('openai');
        const n = name ?? pm?.getSelectedPresetName?.();
        const p = n ? pm?.getCompletionPresetByName(n) : null;
        if (!p) throw new Error('No such preset.');
        return { name: n, preset: JSON.parse(JSON.stringify(p)) };
    }`,
    lorebook: `async ({ name } = {}) => {
        const c = SillyTavern.getContext();
        if (!c.getWorldInfoNames().includes(name)) throw new Error('No such lorebook.');
        const data = await c.loadWorldInfo(name);
        const entries = Object.values(data?.entries || {}).map(e => ({
            uid: e.uid, keys: Array.isArray(e.key) ? e.key.map(String) : [], secondaryKeys: Array.isArray(e.keysecondary) ? e.keysecondary.map(String) : [],
            comment: String(e.comment || ''), content: String(e.content || ''), constant: !!e.constant, disabled: !!e.disable,
            order: Number(e.order) || 0, position: Number(e.position) || 0,
        }));
        return { name, entries };
    }`,
    // What there is to pick from.
    lists: `async () => {
        const c = SillyTavern.getContext();
        const pu = c.powerUserSettings;
        return {
            characters: c.characters.map(x => ({ avatar: x.avatar, name: String(x.name || '') })),
            personas: Object.entries(pu.personas || {}).map(([avatar, name]) => ({ avatar, name: String(name || '') })),
            presets: c.getPresetManager('openai')?.getAllPresets?.() || [],
            lorebooks: c.getWorldInfoNames(),
        };
    }`,
    // ---- Writing safely: the page keeps its own copies and saves whole
    // objects from them, so a change made through the server has to be
    // shown to the page, and the user's pending typing saved first. These
    // reach SillyTavern's own modules; a version without them is refused.
    // When the character form shows this card: cancel its pending save and,
    // if the form differs from the stored card, save the user's typing now.
    characterFlush: `async ({ avatar } = {}) => {
        const st = await import('/script.js'), ut = await import('/scripts/utils.js');
        if (typeof st.createOrEditCharacter !== 'function' || typeof ut.cancelDebounce !== 'function') throw new Error('Reload SillyTavern and try again (this version is not supported).');
        const ch = st.this_chid !== undefined ? st.characters[st.this_chid] : null;
        if (!ch || ch.avatar !== avatar || st.menu_type === 'create') return { flushed: false };
        // Before its settings are ready (welcome screen open) SillyTavern's save does nothing.
        if (!st.settingsReady) throw new Error('SillyTavern is still starting (is its welcome screen open?). Try again in a moment.');
        ut.cancelDebounce(st.saveCharacterDebounced);
        const d = ch.data || {};
        const form = { description_textarea: d.description ?? ch.description, personality_textarea: d.personality ?? ch.personality, scenario_pole: d.scenario ?? ch.scenario,
            firstmessage_textarea: d.first_mes ?? ch.first_mes, mes_example_textarea: d.mes_example ?? ch.mes_example, creator_notes_textarea: d.creator_notes ?? ch.creatorcomment,
            system_prompt_textarea: d.system_prompt, post_history_instructions_textarea: d.post_history_instructions };
        // (a text box turns CR LF into LF: compare without that difference)
        const norm = v => String(v ?? '').replace(/\\r\\n?/g, '\\n');
        const changed = Object.entries(form).some(([id, v]) => { const el = document.getElementById(id); return el && norm(el.value) !== norm(v); });
        if (!changed) return { flushed: false };
        await st.createOrEditCharacter();
        return { flushed: true };
    }`,
    // After a change through the server: the page's copy of the card, and
    // the form when it shows this card. With a field that has its own text
    // box, only that box is set, so typing in the rest of the form stays (and
    // a save SillyTavern has pending carries the new value with it).
    characterRefresh: `async ({ avatar, field } = {}) => {
        const st = await import('/script.js');
        if (typeof st.getOneCharacter !== 'function' || typeof st.selectCharacterById !== 'function') throw new Error('Reload SillyTavern and try again (this version is not supported).');
        await st.getOneCharacter(avatar);
        const i = st.characters.findIndex(c => c.avatar === avatar);
        if (i < 0 || String(st.this_chid) !== String(i) || st.menu_type === 'create') return { ok: i >= 0 };
        const BOX = { description: 'description_textarea', personality: 'personality_textarea', scenario: 'scenario_pole', first_mes: 'firstmessage_textarea',
            mes_example: 'mes_example_textarea', creator_notes: 'creator_notes_textarea', system_prompt: 'system_prompt_textarea', post_history_instructions: 'post_history_instructions_textarea' };
        const el = field && Object.hasOwn(BOX, field) ? document.getElementById(BOX[field]) : null;
        if (el) {
            const ch = st.characters[i], d = ch.data || {};
            el.value = String(d[field] ?? (field === 'creator_notes' ? ch.creatorcomment : ch[field]) ?? '');
            return { ok: true, box: true };
        }
        await st.selectCharacterById(i, { switchMenu: false });
        return { ok: true };
    }`,
    // After a card was made or deleted through the server.
    characterListRefresh: `async () => { await SillyTavern.getContext().getCharacters(); return { ok: true }; }`,
    // Deletes a card, and its chats unless keepChats. SillyTavern's own
    // delete closes whatever chat is open, so it's used only when this card
    // is the open one; otherwise the server route, then the list.
    characterDelete: `async ({ avatar, keepChats = false } = {}) => {
        const st = await import('/script.js');
        if (typeof st.deleteCharacter !== 'function' || typeof st.getCharacters !== 'function') throw new Error('Reload SillyTavern and try again (this version is not supported).');
        const i = st.characters.findIndex(c => c.avatar === avatar);
        if (i < 0) throw new Error('No such character.');
        if (String(st.this_chid) === String(i)) {
            if (await st.deleteCharacter(avatar, { deleteChats: !keepChats }) === false) throw new Error('SillyTavern did not delete the character.');
            return { ok: true };
        }
        const r = await fetch('/api/characters/delete', { method: 'POST', headers: SillyTavern.getContext().getRequestHeaders(), body: JSON.stringify({ avatar_url: avatar, delete_chats: !keepChats }) });
        if (!r.ok) throw new Error('SillyTavern did not delete the character.');
        await st.getCharacters();
        return { ok: true };
    }`,
    // Saves the book open in the World Info editor now (its save waits a second).
    lorebookFlush: `async () => {
        const wi = await import('/scripts/world-info.js');
        if (typeof wi.saveWorldInfo !== 'function' || !wi.worldInfoCache) throw new Error('Reload SillyTavern and try again (this version is not supported).');
        const sel = document.querySelector('#world_editor_select');
        const name = sel && sel.value !== '' ? (wi.world_names || [])[Number(sel.value)] : null;
        if (!name || !wi.worldInfoCache.has(name)) return { flushed: null };
        await wi.saveWorldInfo(name, wi.worldInfoCache.get(name), true);
        return { flushed: name };
    }`,
    // Saves a whole book through the page (its cache and the file together), then shows it.
    lorebookSave: `async ({ name, data } = {}) => {
        const wi = await import('/scripts/world-info.js');
        if (typeof wi.saveWorldInfo !== 'function' || typeof wi.updateWorldInfoList !== 'function') throw new Error('Reload SillyTavern and try again (this version is not supported).');
        if (!name || !data || typeof data !== 'object' || !data.entries || typeof data.entries !== 'object') throw new Error('Not a lorebook.');
        const isNew = !(wi.world_names || []).includes(name);
        // An immediate save cancels SillyTavern's pending one, whatever book it was for: save the editor's book first.
        const shownBook = document.querySelector('#world_editor_select');
        const shownName = shownBook && shownBook.value !== '' ? (wi.world_names || [])[Number(shownBook.value)] : null;
        if (shownName && wi.worldInfoCache.has(shownName)) await wi.saveWorldInfo(shownName, wi.worldInfoCache.get(shownName), true);
        await wi.saveWorldInfo(name, data, true);
        if (isNew) await wi.updateWorldInfoList();
        wi.reloadEditor(name);
        return { ok: true };
    }`,
    // After a book changed outside the page: forget the page's copy and show the file.
    lorebookReload: `async ({ name } = {}) => {
        const wi = await import('/scripts/world-info.js');
        if (!wi.worldInfoCache || typeof wi.updateWorldInfoList !== 'function') throw new Error('Reload SillyTavern and try again (this version is not supported).');
        if (wi.worldInfoCache.has(name)) wi.worldInfoCache.delete(name);
        await wi.updateWorldInfoList();
        wi.reloadEditor(name);
        return { ok: true };
    }`,
    // One lorebook entry changed inside the page, read fresh from the file,
    // with SillyTavern's own helpers (a book imported from a card keeps its
    // card copy in step). op: 'set' (values), 'add' (values → the new uid),
    // 'delete', 'put' (an entry back under its old uid). expect: the entry as
    // last read; anything else there now and nothing is written.
    lorebookEntry: `async ({ name, op, uid, values = {}, entry = null, expect = null } = {}) => {
        const wi = await import('/scripts/world-info.js');
        for (const f of ['saveWorldInfo', 'loadWorldInfo', 'createWorldInfoEntry', 'setWIOriginalDataValue', 'deleteWIOriginalDataValue', 'reloadEditor']) {
            if (typeof wi[f] !== 'function') throw new Error('Reload SillyTavern and try again (this version is not supported).');
        }
        if (!(wi.world_names || []).includes(name)) throw new Error('No such lorebook.');
        // An immediate save cancels SillyTavern's pending one, whatever book it was for: save the editor's book first.
        const shownBook = document.querySelector('#world_editor_select');
        const shownName = shownBook && shownBook.value !== '' ? (wi.world_names || [])[Number(shownBook.value)] : null;
        if (shownName && wi.worldInfoCache.has(shownName)) await wi.saveWorldInfo(shownName, wi.worldInfoCache.get(shownName), true);
        if (wi.worldInfoCache.has(name)) wi.worldInfoCache.delete(name);
        const data = structuredClone(await wi.loadWorldInfo(name));
        if (!data || typeof data.entries !== 'object') throw new Error('Not a lorebook.');
        const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
        const keyOf = u => {
            const ks = Object.keys(data.entries).filter(k => data.entries[k] && data.entries[k].uid === u);
            if (ks.length !== 1) throw new Error(ks.length ? 'That lorebook has more than one entry ' + u + '.' : 'That lorebook has no entry ' + u + '.');
            return ks[0];
        };
        const map = wi.originalWIDataKeyMap || {};
        const put = (u, e, key, v) => {
            e[key] = v;
            if (key === 'disable') wi.setWIOriginalDataValue(data, u, 'enabled', !v);
            else if (map[key]) wi.setWIOriginalDataValue(data, u, map[key], v);
        };
        const out = { ok: true };
        if (op === 'set') {
            const k = keyOf(uid);
            if (expect && !same(data.entries[k], expect)) throw new Error('The entry changed meanwhile: nothing was written.');
            for (const [key, v] of Object.entries(values)) put(uid, data.entries[k], key, v);
        } else if (op === 'add') {
            const e = wi.createWorldInfoEntry(name, data);
            if (!e) throw new Error('SillyTavern could not make a new entry.');
            for (const [key, v] of Object.entries(values)) e[key] = v;
            out.uid = e.uid;
        } else if (op === 'delete') {
            const k = keyOf(uid);
            if (expect && !same(data.entries[k], expect)) throw new Error('The entry changed meanwhile: nothing was written.');
            delete data.entries[k];
            wi.deleteWIOriginalDataValue(data, uid);
        } else if (op === 'put') {
            if (!entry || typeof entry !== 'object' || !Number.isInteger(uid) || uid < 0) throw new Error('Nothing to put back.');
            if (String(uid) in data.entries || Object.values(data.entries).some(e => e && e.uid === uid)) throw new Error('The lorebook has an entry ' + uid + ' again: nothing was written.');
            data.entries[String(uid)] = { ...entry, uid };
        } else throw new Error('Unknown change.');
        await wi.saveWorldInfo(name, data, true);
        wi.reloadEditor(name);
        return out;
    }`,
    // SillyTavern's own delete (links from characters and settings cleaned up).
    lorebookDelete: `async ({ name } = {}) => {
        const wi = await import('/scripts/world-info.js');
        if (typeof wi.deleteWorldInfo !== 'function') throw new Error('Reload SillyTavern and try again (this version is not supported).');
        const ok = await wi.deleteWorldInfo(name);
        if (!ok) throw new Error('SillyTavern did not delete the lorebook.');
        return { ok: true };
    }`,
    // ---- The open chat. Messages have no id: a change names the message it
    // expects (a copy as last read) and is refused if the chat moved on.
    // Why SillyTavern would refuse or lose a change now (null: none). A
    // regenerate changes the chat before isGenerating() says so, so the
    // generation events count too (for at most 30 s: an error can end a
    // generation without an event).
    chatState: `async ({ indexes = [] } = {}) => {
        const s = await import('/script.js'), gc = await import('/scripts/group-chats.js');
        if (typeof s.getCurrentChatId !== 'function' || !Array.isArray(s.chat)) throw new Error('Reload SillyTavern and try again (this version is not supported).');
        if (!window.__stDesktopGen) {
            const g = window.__stDesktopGen = { on: false, at: 0 };
            // (a dry run only builds a prompt, e.g. to count tokens, and ends without an event)
            s.eventSource.on(s.event_types.GENERATION_STARTED, (type, params, dryRun) => { if (dryRun) return; g.on = true; g.at = Date.now(); });
            for (const e of [s.event_types.GENERATION_ENDED, s.event_types.GENERATION_STOPPED]) s.eventSource.on(e, () => { g.on = false; });
        }
        const g = window.__stDesktopGen;
        const del = document.querySelector('#dialogue_del_mes');
        const busy = s.isGenerating?.() || (g.on && Date.now() - g.at < 30000) ? 'SillyTavern is writing a reply: wait until it is done.'
            : s.swipeState && s.swipeState !== 'none' ? 'A swipe is in progress in SillyTavern: wait until it is done.'
            : s.isChatSaving ? 'SillyTavern is saving the chat: try again in a moment.'
            : s.reloadChatMutex?.isBusy ? 'SillyTavern is loading the chat: try again in a moment.'
            : document.querySelector('#chat .edit_textarea, #chat .reasoning_edit_textarea') ? 'A message is being edited in SillyTavern: finish or cancel that edit first.'
            : del && del.offsetParent !== null ? 'SillyTavern is choosing messages to delete: finish or cancel that first.' : null;
        const chatId = s.getCurrentChatId() || null;
        const group = gc.selected_group || null;
        const ch = !group && s.this_chid !== undefined ? s.characters[s.this_chid] : null;
        // Where SillyTavern keeps it (inside the user's data folder).
        const file = !chatId ? null : group ? 'group chats/' + chatId + '.jsonl' : ch ? 'chats/' + ch.avatar.replace('.png', '') + '/' + chatId + '.jsonl' : null;
        const members = group ? (gc.groups.find(x => x.id === group)?.members || []).map(a => s.characters.find(c => c.avatar === a)?.name).filter(Boolean) : [];
        const copy = v => JSON.parse(JSON.stringify(v));
        const messages = [...new Set(indexes)].filter(i => Number.isInteger(i) && i >= 0 && i < s.chat.length).map(i => ({ index: i, message: copy(s.chat[i]) }));
        return { chatId, groupId: group, avatar: ch?.avatar ?? null, characterName: ch?.name ?? null, members, userName: String(s.name1 || ''), file, busy, length: s.chat.length, messages };
    }`,
    // Changes the open chat. ops, in order, on the chat as it is now:
    // { kind: 'set', index, expect | identity, patch: { fields, extra }, search? }
    //   changes fields of a message (extra: its extra fields, null = remove);
    //   { kind: 'insert', index, prev?, message | make } adds one (prev: the
    //   message expected just before it, null at the start; make: { isUser,
    //   name, text } builds it here); { kind: 'remove', index, expect |
    //   identity, search? }. expect = the message as last read, compared by
    //   what the user sees (name, sender, hidden, date, text, swipes: SillyTavern
    //   adds things of its own to messages, like token counts); identity =
    //   { send_date, name, is_user } (the same message, whatever its text now);
    //   search = look for it elsewhere when it moved.
    // Every op is checked before anything changes; then the chat is changed
    // in one step, saved, and reloaded when messages were added or removed.
    // A refusal because the chat moved on starts with "CHANGED:".
    chatApply: `async ({ chatId, ops = [] } = {}) => {
        const s = await import('/script.js'), ex = await import('/scripts/extensions.js'), ip = await import('/scripts/itemized-prompts.js'), gc = await import('/scripts/group-chats.js');
        for (const f of ['saveChatConditional', 'cancelDebouncedChatSave', 'updateMessageBlock', 'reloadCurrentChat', 'getCurrentChatId', 'isGenerating']) {
            if (typeof s[f] !== 'function') throw new Error('Reload SillyTavern and try again (this version is not supported).');
        }
        const g = window.__stDesktopGen || { on: false, at: 0 };
        const guard = () => {
            const del = document.querySelector('#dialogue_del_mes');
            const busy = s.isGenerating() || (g.on && Date.now() - g.at < 30000) ? 'SillyTavern is writing a reply: wait until it is done.'
                : s.swipeState && s.swipeState !== 'none' ? 'A swipe is in progress in SillyTavern: wait until it is done.'
                : s.isChatSaving ? 'SillyTavern is saving the chat: try again in a moment.'
                : s.reloadChatMutex?.isBusy ? 'SillyTavern is loading the chat: try again in a moment.'
                : document.querySelector('#chat .edit_textarea, #chat .reasoning_edit_textarea') ? 'A message is being edited in SillyTavern: finish or cancel that edit first.'
                : del && del.offsetParent !== null ? 'SillyTavern is choosing messages to delete: finish or cancel that first.' : null;
            if (busy) throw new Error(busy);
            if ((s.getCurrentChatId() || null) !== chatId) throw new Error('The chat the co-pilot worked on isn\\'t open in SillyTavern now: open it, then try again.');
        };
        let sim = [];
        const removed = [], sets = [], inserted = [];
        let first = Infinity;
        let touched = false, structure = false;
        // Until the change itself, a refusal is an answer (nothing was written), not an error.
        try {
        guard();
        // SillyTavern's pending save goes out first, so what is checked is what is on disk.
        s.cancelDebouncedChatSave();
        ex.cancelDebouncedMetadataSave?.();
        await s.saveChatConditional();
        guard();
        sim = s.chat.slice();
        const fp = m => JSON.stringify([m?.name ?? '', !!m?.is_user, !!m?.is_system, m?.send_date ?? null, m?.mes ?? '', m?.swipe_id ?? null, Array.isArray(m?.swipes) ? m.swipes : null]);
        const same = (m, op) => m !== undefined && (op.identity
            ? m.send_date === op.identity.send_date && m.name === op.identity.name && !!m.is_user === !!op.identity.is_user
            : fp(m) === fp(op.expect));
        const locate = op => {
            // The same message whatever its text: only when exactly one message in the chat fits.
            if (op.identity) {
                const found = sim.map((m, i) => (same(m, op) ? i : -1)).filter(i => i >= 0);
                if (found.length === 1) return found[0];
                throw new Error('CHANGED: that message cannot be found for sure.');
            }
            if (Number.isInteger(op.index) && same(sim[op.index], op)) return op.index;
            if (op.search) {
                const found = sim.map((m, i) => (same(m, op) ? i : -1)).filter(i => i >= 0);
                if (found.length === 1) return found[0];
            }
            throw new Error('CHANGED: that message changed or moved since the co-pilot read it.');
        };
        for (const op of ops) {
            if (op.kind === 'set') {
                const i = locate(op);
                // Only the named fields change; what SillyTavern added to the message stays.
                const n = structuredClone(sim[i]);
                Object.assign(n, op.patch?.fields || {});
                for (const [k, v] of Object.entries(op.patch?.extra || {})) {
                    if (v === null) { if (n.extra) delete n.extra[k]; } else (n.extra || (n.extra = {}))[k] = v;
                }
                sim[i] = n;
                sets.push(i);
                first = Math.min(first, i);
                if (i === 0) touched = true;
            } else if (op.kind === 'remove') {
                const i = locate(op);
                sim.splice(i, 1);
                removed.push(i);
                first = Math.min(first, i);
                structure = true;
            } else if (op.kind === 'insert') {
                if (!Number.isInteger(op.index) || op.index < 0 || op.index > sim.length) throw new Error('CHANGED: the chat is shorter than the co-pilot read it.');
                if (op.prev !== undefined && (op.prev === null ? op.index !== 0 : fp(sim[op.index - 1]) !== fp(op.prev))) throw new Error('CHANGED: the message before that place changed since the co-pilot read it.');
                let m = op.message;
                if (!m) {
                    const k = op.make || {};
                    const text = String(k.text ?? '');
                    const now = new Date().toISOString();
                    // Avatar fields as the nearest message by the same speaker has them.
                    const like = pick => { for (let j = op.index - 1; j >= 0; j--) if (pick(sim[j])) return sim[j]; for (let j = op.index; j < sim.length; j++) if (pick(sim[j])) return sim[j]; return null; };
                    if (k.isUser) {
                        m = { name: String(s.name1 || ''), is_user: true, is_system: false, send_date: now, mes: text, extra: {} };
                        const near = like(x => x && x.is_user && !x.is_system);
                        if (near?.force_avatar) m.force_avatar = near.force_avatar;
                    } else {
                        m = { name: String(k.name || ''), is_user: false, is_system: false, send_date: now, mes: text, extra: {}, swipe_id: 0, swipes: [text], swipe_info: [{ send_date: now, gen_started: null, gen_finished: null, extra: {} }] };
                        const near = like(x => x && !x.is_user && x.name === m.name);
                        if (near?.force_avatar) m.force_avatar = near.force_avatar;
                        if (near?.original_avatar) m.original_avatar = near.original_avatar;
                    }
                }
                sim.splice(op.index, 0, m);
                op.made = m;
                inserted.push(op.index);
                first = Math.min(first, op.index);
                structure = true;
                if (op.index === 0) touched = true;
            } else throw new Error('Unknown change.');
        }
        // All checked: one step, no wait between the checks and the change.
        guard();
        } catch (e) {
            const msg = String(e?.message || e);
            return { refused: msg.replace(/^CHANGED: /, ''), changed: msg.startsWith('CHANGED:') };
        }
        s.chat.splice(0, s.chat.length, ...sim);
        // A one-message chat that is not marked as edited gets its greeting
        // rebuilt from the card when the persona changes: mark it.
        if ((touched || s.chat.length <= 1) && !s.chat_metadata.tainted) s.chat_metadata.tainted = true;
        // SillyTavern's per-message prompt records follow their messages.
        for (const i of removed.sort((a, b) => b - a)) ip.deleteItemizedPromptForMessage?.(i);
        for (const i of inserted) for (const r of Array.isArray(ip.itemizedPrompts) ? ip.itemizedPrompts : []) if (r.mesId >= i) r.mesId += 1;
        if (!structure) {
            for (const i of sets) {
                s.updateMessageBlock(i, s.chat[i]);
                document.querySelector('#chat .mes[mesid="' + i + '"]')?.setAttribute('is_system', String(!!s.chat[i].is_system));
            }
        }
        await s.saveChatConditional();
        // Messages moved: redraw from the first change on (or the first message
        // on screen), from memory. A reload from disk could drop a message the
        // user sends meanwhile, and makes SillyTavern switch presets named after
        // the character.
        if (structure) {
            const shownFirst = Number(document.querySelector('#chat .mes')?.getAttribute('mesid'));
            const start = Math.min(Math.max(first, Number.isFinite(shownFirst) ? shownFirst : 0), s.chat.length);
            if (typeof s.redisplayChat === 'function') await s.redisplayChat({ startIndex: start, fade: false }); else await s.reloadCurrentChat();
        }
        const copy = v => JSON.parse(JSON.stringify(v));
        return { length: s.chat.length, made: ops.filter(o => o.made).map(o => copy(o.made)), sets };
    }`,
    // ---- Personas: kept in the page's settings (power_user), which the page
    // saves whole to settings.json. avatar null = the persona in use.
    personaState: `async ({ avatar = null } = {}) => {
        const S = await import('/script.js'), P = await import('/scripts/personas.js'), pu = (await import('/scripts/power-user.js')).power_user;
        const id = avatar ?? P.user_avatar ?? null;
        const exists = !!id && Object.hasOwn(pu.personas || {}, id);
        const copy = v => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
        return { ready: !!S.settingsReady, current: P.user_avatar || null, avatar: id, exists, name: exists ? String(pu.personas[id]) : null,
            descriptor: exists ? copy(pu.persona_descriptions?.[id]) : null, isDefault: !!id && pu.default_persona === id,
            names: Object.values(pu.personas || {}).map(String) };
    }`,
    // op 'create' { avatar, name, description }: the default picture first,
    //   then the persona (not selected). 'set' { avatar, description,
    //   expect }: its description (and the live copy when it is in use).
    //   'remove' { avatar, expect: { name, descriptor } }: a persona the
    //   co-pilot made (not the one in use). expect: as last read; anything else
    //   there now and nothing is written ({ refused, changed }).
    // The page's pending settings save goes out first and the result is saved
    // at once (settings.json then matches what the page holds).
    personaApply: `async ({ op, avatar, name, description, expect } = {}) => {
        const S = await import('/script.js'), P = await import('/scripts/personas.js'), U = await import('/scripts/utils.js'), pu = (await import('/scripts/power-user.js')).power_user;
        for (const f of ['saveSettings', 'getRequestHeaders']) if (typeof S[f] !== 'function') throw new Error('Reload SillyTavern and try again (this version is not supported).');
        for (const f of ['initPersona', 'getUserAvatars', 'setPersonaDescription']) if (typeof P[f] !== 'function') throw new Error('Reload SillyTavern and try again (this version is not supported).');
        if (!S.settingsReady) return { refused: 'SillyTavern is still starting (is its welcome screen open?). Try again in a moment.' };
        const flush = async () => { U.cancelDebounce(S.saveSettingsDebounced); await S.saveSettings(); };
        await flush();
        const J = v => JSON.stringify(v ?? null);
        if (op === 'create') {
            if (!/^[0-9]+-[A-Za-z0-9]*[.]png$/.test(String(avatar))) throw new Error('Not a persona picture name.');
            if (Object.hasOwn(pu.personas, avatar) || (await P.getUserAvatars(false)).includes(avatar)) return { refused: 'That persona picture name is taken: try again.', changed: true };
            const blob = await (await fetch(S.default_user_avatar)).blob();
            const form = new FormData();
            form.append('avatar', new File([blob], 'avatar.png', { type: 'image/png' }));
            form.append('overwrite_name', avatar);
            const r = await fetch('/api/avatars/upload', { method: 'POST', headers: S.getRequestHeaders({ omitContentType: true }), body: form, cache: 'no-cache' });
            if (!r.ok) throw new Error('SillyTavern did not save the persona picture (' + r.status + ' ' + (await r.text().catch(() => '')).slice(0, 120) + ').');
            if ((await r.json()).path !== avatar) throw new Error('SillyTavern saved the persona picture under another name.');
            const dropPicture = () => fetch('/api/avatars/delete', { method: 'POST', headers: S.getRequestHeaders(), body: JSON.stringify({ avatar }) }).catch(() => null);
            // A picture without a persona would come back as "[Unnamed Persona]": it goes if the rest fails.
            try { await P.initPersona(avatar, String(name), String(description ?? ''), ''); } catch (e) { await dropPicture(); throw e; }
            await flush();
            await P.getUserAvatars(true, avatar);
            return { ok: true, descriptor: J(pu.persona_descriptions[avatar]) === 'null' ? null : JSON.parse(J(pu.persona_descriptions[avatar])) };
        }
        if (!Object.hasOwn(pu.personas || {}, avatar)) {
            // Undo of a make that stopped halfway: only its picture is left (never one a persona uses).
            if (op === 'remove' && /^[0-9]+-[A-Za-z0-9]*[.]png$/.test(String(avatar)) && (await P.getUserAvatars(false)).includes(avatar)) {
                const r = await fetch('/api/avatars/delete', { method: 'POST', headers: S.getRequestHeaders(), body: JSON.stringify({ avatar }) });
                if (!r.ok && r.status !== 404) throw new Error('SillyTavern did not delete the persona picture.');
                await P.getUserAvatars(true);
                return { ok: true, picture: true };
            }
            return { refused: 'That persona isn\\'t there any more.', changed: true };
        }
        if (op === 'set') {
            const d = pu.persona_descriptions?.[avatar];
            if (!d) return { refused: 'This persona has no description settings yet: open it once in SillyTavern\\'s Persona Management, then try again.' };
            if (expect !== undefined && String(d.description ?? '') !== String(expect)) return { refused: 'The description changed since the co-pilot read it.', changed: true };
            d.description = String(description ?? '');
            // The persona in use has a live copy the description box writes to.
            if (P.user_avatar === avatar) { pu.persona_description = d.description; P.setPersonaDescription(); }
            await S.eventSource.emit(S.event_types.PERSONA_UPDATED, avatar);
            await flush();
            await P.getUserAvatars(true, avatar);
            return { ok: true };
        }
        if (op === 'remove') {
            if (P.user_avatar === avatar) return { refused: 'That persona is in use in SillyTavern: switch to another persona first.' };
            if (expect && (String(pu.personas[avatar]) !== String(expect.name) || J(pu.persona_descriptions?.[avatar]) !== J(expect.descriptor))) return { refused: 'The persona changed since the co-pilot made it.', changed: true };
            const r = await fetch('/api/avatars/delete', { method: 'POST', headers: S.getRequestHeaders(), body: JSON.stringify({ avatar }) });
            if (!r.ok && r.status !== 404) throw new Error('SillyTavern did not delete the persona picture.');
            const was = String(pu.personas[avatar]);
            delete pu.personas[avatar];
            delete pu.persona_descriptions[avatar];
            if (pu.default_persona === avatar) pu.default_persona = null;
            await S.eventSource.emit(S.event_types.PERSONA_DELETED, { avatarId: avatar, name: was });
            await flush();
            await P.getUserAvatars(true);
            return { ok: true };
        }
        throw new Error('Unknown change.');
    }`,
    // ---- Chat completion presets: the page keeps every preset in memory
    // (openai_settings) and works on a copy of the selected one (oai_settings,
    // which may hold unsaved edits). keys: preset setting names to report.
    presetState: `async ({ name, keys = [] } = {}) => {
        const O = await import('/scripts/openai.js'), S = await import('/script.js'), gc = await import('/scripts/group-chats.js');
        if (!O.openai_setting_names || !Array.isArray(O.openai_settings) || !O.settingsToUpdate || !O.oai_settings) throw new Error('Reload SillyTavern and try again (this version is not supported).');
        const copy = v => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
        const selected = O.oai_settings.preset_settings_openai ?? null;
        const exists = typeof name === 'string' && Object.hasOwn(O.openai_setting_names, name);
        const out = { ready: !!S.settingsReady, names: Object.keys(O.openai_setting_names), selected, exists, isSelected: exists && selected === name,
            saved: exists ? copy(O.openai_settings[O.openai_setting_names[name]]) : null,
            characters: S.characters.map(c => String(c.name)), groups: (gc.groups || []).map(g => String(g.name)), controls: {} };
        for (const k of keys) {
            const m = O.settingsToUpdate[k];
            const el = m && m[0] ? document.querySelector(m[0]) : null;
            if (!el) continue;
            const num = v => (v === '' || v == null || isNaN(Number(v)) ? null : Number(v));
            out.controls[k] = { tag: el.tagName.toLowerCase(), type: String(el.type || ''), min: num(el.getAttribute('min')), max: num(el.getAttribute('max')),
                options: el.tagName === 'SELECT' ? [...el.options].map(o => o.value) : null };
        }
        if (out.isSelected) {
            out.working = {};
            for (const k of keys) { const m = O.settingsToUpdate[k]; if (m) out.working[k] = copy(O.oai_settings[m[1]]); }
            out.workingPrompts = copy(O.oai_settings.prompts || []);
            out.workingOrder = copy((O.oai_settings.prompt_order || []).find(e => String(e.character_id) === '100001') || null);
        }
        return out;
    }`,
    // After the server saved a preset: the page's copy of it. add: a new
    // preset (listed, not selected); remove: deleted (refused while
    // selected). working (the selected preset only): { settings: { key:
    // value }, prompts: [identifiers], order: true } also go into the working
    // copy, through SillyTavern's own controls, then settings are saved.
    presetPut: `async ({ name, preset, add = false, remove = false, working = null } = {}) => {
        const O = await import('/scripts/openai.js'), S = await import('/script.js'), U = await import('/scripts/utils.js');
        if (!O.openai_setting_names || !Array.isArray(O.openai_settings) || !O.settingsToUpdate) throw new Error('Reload SillyTavern and try again (this version is not supported).');
        const names = O.openai_setting_names;
        if (remove) {
            if (O.oai_settings.preset_settings_openai === name) return { refused: 'That preset is selected in SillyTavern: pick another preset first.' };
            if (!Object.hasOwn(names, name)) return { ok: true, gone: true };
            const pm = SillyTavern.getContext().getPresetManager('openai');
            if (!pm || !(await pm.deletePreset(name))) throw new Error('SillyTavern did not delete the preset.');
            return { ok: true };
        }
        if (!preset || typeof preset !== 'object') throw new Error('Not a preset.');
        if (add) {
            if (Object.hasOwn(names, name)) return { refused: 'There is a preset with that name already.', changed: true };
            O.openai_settings.push(structuredClone(preset));
            names[name] = O.openai_settings.length - 1;
            const opt = document.createElement('option');
            opt.value = String(names[name]);
            opt.textContent = name;
            document.querySelector('#settings_preset_openai')?.append(opt);
            return { ok: true };
        }
        if (!Object.hasOwn(names, name)) return { refused: 'That preset isn\\'t there any more.', changed: true };
        O.openai_settings[names[name]] = structuredClone(preset);
        const out = { ok: true };
        if (working && O.oai_settings.preset_settings_openai === name) {
            for (const [k, v] of Object.entries(working.settings || {})) {
                const m = O.settingsToUpdate[k];
                if (!m || m[3]) continue;
                if (m[0] && window.$) { const el = window.$(m[0]); if (m[2]) el.prop('checked', !!v).trigger('input'); else el.val(v).trigger('input'); }
                O.oai_settings[m[1]] = v;
                // Two settings show as radio buttons (their own inputs are hidden).
                const radios = { names_behavior: ['character_names', [-1, 0, 1, 2], '#character_names_display'], continue_postfix: ['continue_postfix', ['', ' ', String.fromCharCode(10), String.fromCharCode(10, 10)], '#continue_postfix_display'] }[k];
                if (radios && window.$) {
                    const i = radios[1].indexOf(v);
                    const input = document.querySelectorAll('input[name="' + radios[0] + '"]')[i];
                    if (input) { input.checked = true; window.$(radios[2]).text(window.$('input[name="' + radios[0] + '"]:checked ~ span').text().trim()); }
                }
            }
            const list = O.oai_settings.prompts || (O.oai_settings.prompts = []);
            for (const id of working.prompts || []) {
                const p = (preset.prompts || []).find(x => x.identifier === id);
                const i = list.findIndex(x => x.identifier === id);
                if (p && i >= 0) list[i] = structuredClone(p); else if (p) list.push(structuredClone(p)); else if (i >= 0) list.splice(i, 1);
            }
            if (working.order) {
                const want = (preset.prompt_order || []).find(e => String(e.character_id) === '100001');
                const po = O.oai_settings.prompt_order || (O.oai_settings.prompt_order = []);
                const i = po.findIndex(e => String(e.character_id) === '100001');
                if (want) { if (i >= 0) po[i] = structuredClone(want); else po.push(structuredClone(want)); }
            }
            if ((working.prompts || []).length || working.order) { O.promptManager?.sanitizeServiceSettings?.(); O.promptManager?.render?.(false); }
            U.cancelDebounce(S.saveSettingsDebounced);
            await S.saveSettings();
            const copy = v => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
            out.working = {};
            for (const k of Object.keys(working.settings || {})) { const m = O.settingsToUpdate[k]; if (m) out.working[k] = copy(O.oai_settings[m[1]]); }
            out.workingPrompts = copy(O.oai_settings.prompts || []);
            out.workingOrder = copy((O.oai_settings.prompt_order || []).find(e => String(e.character_id) === '100001') || null);
        }
        return out;
    }`,
    // A Connection Profile's connection with its preset's sampler settings;
    // the preset's prompts are not added (SillyTavern builds the request from
    // our messages only). A text completion profile's instruct template only
    // marks the roles (and gives the stop strings), so it is used. No profile, or Connection Manager off: the current
    // Chat Completion connection, said by fallback: true.
    generate: `async ({ profileId = null, messages = [], maxTokens = 1024, stream = true } = {}, { chunk, signal }) => {
        const c = SillyTavern.getContext();
        if (!Array.isArray(messages) || !messages.length) throw new Error('No messages to send.');
        const msgs = messages.map(m => ({ role: String(m.role), content: String(m.content ?? '') }));
        const max = Math.max(1, Math.min(Math.floor(Number(maxTokens)) || 1024, 131072));
        const cmOff = c.extensionSettings.disabledExtensions.includes('connection-manager');
        let res, fallback = false;
        if (profileId && !cmOff) {
            try {
                res = await c.ConnectionManagerRequestService.sendRequest(String(profileId), msgs, max, { stream: !!stream, signal, includePreset: true, includeInstruct: true });
            } catch (e) {
                // SillyTavern says only "API request failed": the provider's own reason is in cause.
                const why = e?.cause?.message;
                throw new Error(why && !String(e.message).includes(why) ? e.message + ': ' + why : e.message, { cause: e });
            }
        } else {
            if (c.mainApi !== 'openai') throw new Error('Pick a Connection Profile: without one, only a Chat Completion connection can be used.');
            fallback = true;
            const s = c.chatCompletionSettings;
            res = await c.ChatCompletionService.processRequest({
                stream: !!stream, messages: msgs, max_tokens: max,
                model: c.getChatCompletionModel(), chat_completion_source: s.chat_completion_source,
                custom_url: s.custom_url, reverse_proxy: s.reverse_proxy, proxy_password: s.proxy_password,
            }, { presetName: c.getPresetManager('openai')?.getSelectedPresetName?.() }, true, signal);
        }
        if (typeof res === 'function') {
            let last = { text: '' };
            let sent = '';
            // Pieces that add nothing (a provider's closing piece) aren't passed on.
            for await (const part of res()) { last = part; const text = String(part.text ?? ''); if (text !== sent) { sent = text; chunk({ text }); } }
            return { text: String(last.text ?? ''), reasoning: String(last.state?.reasoning || ''), fallback };
        }
        return { text: String(res?.content ?? ''), reasoning: String(res?.reasoning || ''), fallback };
    }`,
};

// The call table in the page (made once per page load).
const TABLE = `(() => {
    if (window.__stDesktopCalls) return;
    const calls = new Map();
    const wake = c => { const w = c.wake; c.wake = null; w?.(); };
    window.__stDesktopCalls = Object.freeze({
        start(id, fn, args) {
            const c = { q: [], done: false, result: undefined, error: null, aborted: false, wake: null, ctl: new AbortController() };
            calls.set(id, c);
            Promise.resolve().then(() => fn(args, { chunk: d => { c.q.push(d); wake(c); }, signal: c.ctl.signal })).then(
                r => { c.result = r; c.done = true; wake(c); },
                e => { c.error = String(e?.message || e); c.aborted = c.ctl.signal.aborted || e?.name === 'AbortError'; c.done = true; wake(c); });
        },
        async take(id) {
            const c = calls.get(id);
            if (!c) return { gone: true };
            if (!c.q.length && !c.done) await new Promise(r => { c.wake = r; setTimeout(r, 15000); });
            const out = { chunks: c.q.splice(0), done: c.done, result: c.result, error: c.error, aborted: c.aborted };
            if (c.done) calls.delete(id);
            return out;
        },
        abort(id) { calls.get(id)?.ctl.abort(); },
    });
})();`;

export const RELOADED = 'SillyTavern reloaded during the request.';
const ABORTED = 'The request was stopped (aborted).';

// Runs FUNCTIONS[name] in wc's page. onChunk(data) for each piece a function
// streams; signal stops it. Rejects when the page navigates, reloads,
// crashes or closes before the answer.
const NOT_ANSWERING = "SillyTavern's page stopped answering.";
const TAKE_LIMIT = 30000; // the page answers a take within 15 s

// Runs FUNCTIONS[name] in wc's page. onChunk(data) for each piece a function
// streams; signal stops it (the add-on hears at once, even when the page is
// busy). Rejects when the page loads a new document, crashes or closes
// before the answer; a call given up on is stopped in the page too.
export async function run(wc, name, args = {}, { onChunk, signal } = {}) {
    if (!Object.hasOwn(FUNCTIONS, name)) throw new Error(`No page function "${name}".`);
    if (signal?.aborted) throw new Error(ABORTED);
    const id = crypto.randomBytes(12).toString('hex');
    const data = JSON.parse(JSON.stringify(args ?? {})); // plain data only
    let fail = null;
    const failP = new Promise((_, reject) => { fail = msg => reject(new Error(msg)); });
    failP.catch(() => {});
    // Only a committed new document counts: a navigation that starts but is
    // cancelled (a link that opens in the browser) or turns into a download
    // leaves the page and the call alive.
    const onNav = () => fail(RELOADED);
    const onGone = () => fail(RELOADED);
    wc.on('did-navigate', onNav);
    wc.on('render-process-gone', onGone);
    wc.once('destroyed', onGone);
    const stopInPage = () => { if (!wc.isDestroyed()) wc.executeJavaScript(`window.__stDesktopCalls?.abort(${JSON.stringify(id)})`).catch(() => {}); };
    const onAbort = () => { stopInPage(); fail(ABORTED); };
    signal?.addEventListener('abort', onAbort, { once: true });
    const inPage = (code, limit = 0) => {
        let timer;
        const parts = [wc.executeJavaScript(code), failP];
        if (limit) parts.push(new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(NOT_ANSWERING)), limit); }));
        return Promise.race(parts).finally(() => clearTimeout(timer));
    };
    let finished = false;
    try {
        await inPage(`${TABLE}
window.__stDesktopCalls.start(${JSON.stringify(id)}, ${FUNCTIONS[name]}, ${JSON.stringify(data)});`);
        for (;;) {
            const r = await inPage(`window.__stDesktopCalls ? window.__stDesktopCalls.take(${JSON.stringify(id)}) : { gone: true }`, TAKE_LIMIT);
            if (r?.gone) { finished = true; throw new Error(RELOADED); }
            for (const c of r.chunks || []) { try { onChunk?.(c); } catch { /* the add-on's own error */ } }
            if (!r.done) continue;
            finished = true;
            if (r.error) throw new Error(r.aborted || signal?.aborted ? ABORTED : r.error);
            return r.result;
        }
    } finally {
        wc.removeListener('did-navigate', onNav);
        wc.removeListener('render-process-gone', onGone);
        wc.removeListener('destroyed', onGone);
        signal?.removeEventListener('abort', onAbort);
        if (!finished) stopInPage();
    }
}
