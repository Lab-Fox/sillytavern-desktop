// Break reminder — an example desktop extension for SillyTavern Desktop.
// Every few minutes it shows a small note inside the SillyTavern window.
// It uses every part of the extension API; see EXTENSIONS.md for the docs.
//
// This file runs in the app's main process (CommonJS: .cjs; name it main.mjs
// to use `export function activate`). It is loaded when the user turns the
// extension on, and `deactivate` runs when they turn it off.

const DEFAULTS = { minutes: 60, message: 'Time for a short break: stretch, drink some water.' };

let api = null;
let timer = null;

// Added to every SillyTavern page. Uses SillyTavern's own theme colors.
const STYLE = `
.desktop-break-reminder {
    position: fixed; right: 18px; top: 64px; z-index: 99999; max-width: 320px;
    padding: 12px 16px; border-radius: 10px; cursor: pointer;
    background: var(--SmartThemeBlurTintColor, #222); color: var(--SmartThemeBodyColor, #eee);
    border: 1px solid var(--SmartThemeBorderColor, #555); box-shadow: 0 6px 24px rgba(0, 0, 0, .4);
    font-size: 15px; animation: desktop-break-in .25s ease-out;
}
@keyframes desktop-break-in { from { opacity: 0; transform: translateY(-10px); } }
`;

// Also added to every page: a function the main part calls to show the note.
const SCRIPT = `
window.desktopBreakReminder = text => {
    document.querySelector('.desktop-break-reminder')?.remove();
    const note = document.createElement('div');
    note.className = 'desktop-break-reminder';
    note.textContent = text;
    note.title = 'Click to close';
    note.onclick = () => note.remove();
    document.body.append(note);
    setTimeout(() => note.remove(), 15000);
};
`;

const settings = () => ({ ...DEFAULTS, ...api.storage.all() });

function remind() {
    if (!api.pages.count()) return 0;
    api.pages.run(`window.desktopBreakReminder?.(${JSON.stringify(settings().message)})`);
    api.log('Reminded you to take a break.');
    return api.pages.count();
}

function schedule() {
    clearInterval(timer);
    timer = setInterval(remind, settings().minutes * 60 * 1000);
}

exports.activate = function (extensionApi) {
    api = extensionApi;
    api.pages.addStyle(STYLE);
    api.pages.addScript(SCRIPT);
    api.menu.add({ label: 'Break reminder: remind me now', click: remind });

    // Called from panel.js with ext.invoke('get' | 'save' | 'test', ...).
    api.handle('get', () => settings());
    api.handle('save', ({ minutes, message }) => {
        api.storage.set('minutes', Math.min(600, Math.max(1, Math.round(Number(minutes) || DEFAULTS.minutes))));
        api.storage.set('message', String(message || DEFAULTS.message).slice(0, 200));
        schedule();
        return settings();
    });
    api.handle('test', () => remind());

    api.on('server-started', () => api.log('SillyTavern started. The break timer keeps running.'));
    schedule();
    api.log(`Reminding you every ${settings().minutes} minutes.`);
};

// Timers aren't tracked by the app: stop them here. Everything added through
// `api` (styles, scripts, menu items, handlers, events) is removed for you.
exports.deactivate = function () {
    clearInterval(timer);
};
