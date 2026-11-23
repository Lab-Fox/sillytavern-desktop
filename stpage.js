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
