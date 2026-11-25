// Test data in the throwaway SillyTavern, set up through its open page.
// P: a CDP connection to the SillyTavern page (tests/app/lib.mjs).
export const PROFILE_ID = 'desktop-test';
export const LORE = 'Desktop test lore';
export const MESSAGES = 25; // greeting + 24 made-up messages

// A Connection Profile pointing at the fake model.
export const addProfile = (P, url) => P.ev(`(() => { const c = SillyTavern.getContext(); const cm = c.extensionSettings.connectionManager;
    cm.profiles = cm.profiles.filter(p => p.id !== '${PROFILE_ID}');
    cm.profiles.push({ id: '${PROFILE_ID}', name: 'Desktop test (fake model)', mode: 'cc', api: 'custom', model: 'fake-model', 'api-url': '${url}', preset: 'Default' });
    c.saveSettingsDebounced(); return 'ok'; })()`);

// A small lorebook, listed in SillyTavern.
export const addLorebook = P => P.ev(`await (async () => {
    const c = SillyTavern.getContext();
    const data = { entries: {
        0: { uid: 0, key: ['lantern'], keysecondary: [], comment: 'The lantern', content: 'An old brass lantern hangs above the bar.', constant: false, disable: false, order: 100, position: 0 },
        1: { uid: 1, key: ['cellar'], keysecondary: ['door'], comment: 'The cellar', content: 'The cellar door is always locked.', constant: true, disable: false, order: 90, position: 1 },
    } };
    await fetch('/api/worldinfo/edit', { method: 'POST', headers: c.getRequestHeaders(), body: JSON.stringify({ name: '${LORE}', data }) });
    const wi = await import('/scripts/world-info.js');
    await wi.updateWorldInfoList?.();
    return 'ok';
})()`);

// Opens the first character and gives it a made-up chat of MESSAGES messages.
export const openTestChat = P => P.ev(`await (async () => {
    const wait = async (ok, ms = 30000) => { for (let t = 0; t < ms / 100 && !ok(); t++) await new Promise(r => setTimeout(r, 100)); return ok(); };
    // A fresh SillyTavern waits on its welcome dialog before it loads the characters.
    if (!SillyTavern.getContext().characters.length) await SillyTavern.getContext().getCharacters();
    if (!await wait(() => SillyTavern.getContext().characters.length > 0, 10000)) throw new Error('no characters loaded');
    const c = SillyTavern.getContext();
    // As on a heavy user's install: SillyTavern writes token counts into messages in the background.
    c.powerUserSettings.message_token_count_enabled = true;
    const i = c.characters.findIndex(x => x.name === 'Seraphina');
    await c.selectCharacterById(i >= 0 ? i : 0);
    if (!await wait(() => !!SillyTavern.getContext().getCurrentChatId() && SillyTavern.getContext().chat.length > 0, 10000)) throw new Error('the chat did not open');
    const ctx = SillyTavern.getContext();
    ctx.chat.splice(1);
    // As SillyTavern writes them: distinct dates, and a character message's text also as its first swipe.
    const t0 = Date.now() - ${MESSAGES} * 60000;
    for (let n = 1; n < ${MESSAGES}; n++) {
        const send_date = new Date(t0 + n * 60000).toISOString(), mes = 'Test message ' + n + ' about the lantern.';
        const m = { name: n % 2 ? ctx.name1 : ctx.name2, is_user: n % 2 === 1, is_system: false, send_date, mes, extra: {} };
        if (!m.is_user) Object.assign(m, { swipes: [mes], swipe_id: 0, swipe_info: [{ send_date, extra: {} }] });
        ctx.chat.push(m);
    }
    await ctx.saveChat();
    await ctx.printMessages();
    return SillyTavern.getContext().chat.length;
})()`);

// A fresh SillyTavern waits on its welcome screen before its settings count
// as ready (saving a card does nothing until then): mark the throwaway clone
// as past its first run, as Tools → "Show the welcome tour" off does.
import fs from 'fs';
import path from 'path';
export function skipWelcome(clone) {
    const file = path.join(clone, 'data', 'default-user', 'settings.json');
    try {
        const s = JSON.parse(fs.readFileSync(file, 'utf8'));
        // Connection Manager on (a test that turns it off may not have saved turning it back on).
        const off = s.extension_settings?.disabledExtensions || [];
        if (s.firstRun === false && !off.includes('connection-manager')) return;
        s.firstRun = false;
        if (s.extension_settings) s.extension_settings.disabledExtensions = off.filter(x => x !== 'connection-manager');
        fs.writeFileSync(file, JSON.stringify(s, null, 4));
    } catch { /* no settings yet: SillyTavern makes them */ }
}
