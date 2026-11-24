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
