// Chrome extensions from the Chrome Web Store, in SillyTavern pages.
//
// electron-chrome-web-store makes the store's "Add to Chrome" button work
// and keeps installed extensions up to date; electron-chrome-extensions
// gives them the chrome.* APIs Electron lacks (tabs, action buttons and
// popups, context menus, …). Files live in <userData>/chrome-extensions/
// <id>/<version>_0 (not "Extensions": on Windows that is the same folder as
// the desktop add-ons' "extensions").
//
// The main SillyTavern session (Electron's default session) is where the
// store installs and updates. Every other SillyTavern session that can keep
// files (other installs, other computers) mirrors it: what loads or unloads
// there loads or unloads here too. The read-only copy is an in-memory
// session, which can't load extensions (and has no use for them).
import { session as sessions, nativeImage } from 'electron';
import fs from 'fs';
import path from 'path';
import { t, N } from './i18n.js';
import { ElectronChromeExtensions } from 'electron-chrome-extensions';
import { installChromeWebStore, uninstallExtension, updateExtensions } from 'electron-chrome-web-store';

export const STORE_URL = 'https://chromewebstore.google.com/category/extensions';
const ID = /^[a-p]{32}$/; // Chrome extension ids

let host = null;
let dir = '';
const apis = new Map();        // session → ElectronChromeExtensions
const moving = new WeakSet();  // tabs being moved between windows (not closed)
let ready = null;

// What the app knows about how well an extension works here (tested by
// hand; see the README). Others show "not tested yet".
export const KNOWN = {
    oldceeleldhonbafppcapldpdifcinji: { // LanguageTool, tested 2026-11-01 (11.5.0)
        status: 'works',
        note: N('Checks spelling and grammar in SillyTavern\'s text boxes; its button, popup, options and right-click entry work.'),
    },
    kbfnbcaeplbcioakkpcpgfkobkghlhen: { // Grammarly, tested 2026-11-01 (14.1343.0)
        status: 'partly',
        note: N('Loads in SillyTavern pages, but only checks text after you sign in to a Grammarly account (in the tab it opens). Checking with an account was not tested. Its side panel isn\'t available here.'),
    },
};

// Chrome APIs neither Electron nor electron-chrome-extensions provide.
// An extension asking for one of these will miss that part. Checked in an
// extension's worker with Electron 41 (2026-11-01): alarms, downloads,
// privacy and topSites exist; everything below was undefined.
const MISSING = {
    identity: 'signing in with a Google account',
    offscreen: 'off-screen documents',
    sidePanel: 'a side panel',
    tts: 'text to speech',
    ttsEngine: 'text to speech',
    history: 'browsing history',
    bookmarks: 'bookmarks',
    nativeMessaging: 'talking to programs on your PC',
    tabGroups: 'tab groups',
    proxy: 'proxy settings',
    debugger: 'the debugger',
    pageCapture: 'saving pages',
    tabCapture: 'capturing tabs',
    desktopCapture: 'capturing the screen',
    sessions: 'recently closed tabs',
    search: 'the search engine',
    fontSettings: 'font settings',
    contentSettings: 'site settings',
    declarativeNetRequest: 'blocking or changing web requests',
    declarativeNetRequestWithHostAccess: 'blocking or changing web requests',
    declarativeNetRequestFeedback: 'blocking or changing web requests',
    gcm: 'push messages',
    idle: 'idle detection',
};

// host: { userData, logLine, settings() → settings, saveSettings(),
//         createTab(url, { partition, active, windowId }) → [webContents, baseWindow],
//         createWindow(url, partition) → baseWindow, selectTab(wc), closeTab(wc),
//         confirmInstall({ name, permissions, icon, frame }) → bool, changed() }
export function initChromeExtensions(h) {
    host = h;
    dir = path.join(h.userData, 'chrome-extensions');
    fs.mkdirSync(dir, { recursive: true });
    const def = sessions.defaultSession;
    ready = (async () => {
        setup(def);
        // The top bar (default session) shows icons of any session's extensions.
        ElectronChromeExtensions.handleCRXProtocol(def);
        await installChromeWebStore({
            session: def,
            extensionsPath: dir,
            loadExtensions: false, // we load them: turned-off ones stay unloaded
            autoUpdate: true,
            beforeInstall: beforeInstall,
        });
        for (const e of discover()) if (!disabled().has(e.id)) await load(def, e.path);
        def.extensions.on('extension-loaded', (_e, ext) => {
            // Installed or updated by the store library (which loads it
            // itself): add the polyfill, then load it again with it.
            if (!isPatched(ext.path) && patch(ext.path)) {
                def.extensions.removeExtension(ext.id);
                load(def, ext.path); // fires this event again, patched
                return;
            }
            mirrorLoad(ext);
            host.changed();
        });
        def.extensions.on('extension-unloaded', (_e, ext) => { mirrorUnload(ext.id); host.changed(); });
    })().catch(err => host.logLine(`ERROR: Chrome extensions could not start: ${err.message}`));
    return ready;
}

const disabled = () => new Set(host.settings().chromeExtDisabled || []);
const isPersistent = ses => ses === sessions.defaultSession || ses.isPersistent();

function setup(ses) {
    if (apis.has(ses)) return apis.get(ses);
    const partition = partitionOf(ses);
    const api = new ElectronChromeExtensions({
        session: ses,
        createTab: details => {
            // An extension loaded into another session thinks it was just
            // installed and opens its welcome/sign-up page again (seen with
            // Grammarly). The user saw it in the main session already.
            if (Date.now() - (mirroredAt.get(ses) || 0) < WELCOME_MS) throw new Error('Not opening tabs right after loading into this session.');
            return host.createTab(details.url, { partition, active: details.active !== false, windowId: details.windowId });
        },
        selectTab: wc => host.selectTab(wc),
        // Also called when a tab closes or moves; only chrome.tabs.remove should close it.
        removeTab: wc => { if (!wc.isDestroyed() && !moving.has(wc)) host.closeTab(wc); },
        createWindow: details => host.createWindow([].concat(details.url || [])[0] || STORE_URL, partition),
        removeWindow: win => { if (!win.isDestroyed()) win.close(); },
    });
    api.on('browser-action-popup-created', fixPopup);
    apis.set(ses, api);
    return api;
}

// The library's popup (a small frameless window under the button):
// - It is made non-resizable, and on Windows that locks its size: later
//   resizes to the popup page's size were clamped (383 × 400 instead of
//   415 × 416 for LanguageTool), which gave popups scrollbars. Resizable,
//   the sizes apply (a frameless window still shows no border).
// - It closes when it loses focus. Right after opening, the SillyTavern
//   window sometimes takes focus back for a moment (seen while an
//   extension's background worker started), which closed it at once.
const GRACE_MS = 500;
function fixPopup(popup) {
    const win = popup.browserWindow;
    if (!win) return;
    win.setResizable(true);
    let shownAt = 0;
    win.on('show', () => { shownAt = Date.now(); });
    win.off('blur', popup.maybeClose);
    win.on('blur', () => {
        if (win.isDestroyed()) return;
        if (Date.now() - shownAt < GRACE_MS) win.focus();
        else popup.maybeClose();
    });
}

// Partition names of the sessions we set up, for the top bar's icons ('' = default).
const partitions = new Map();
function partitionOf(ses) { return ses === sessions.defaultSession ? '' : partitions.get(ses) || ''; }

// A SillyTavern page's session: give it the installed extensions (once).
// Set up at once (the tab is added to its window right after this), loaded
// once the main session's extensions are in.
export async function attachSession(ses, partition) {
    if (!ses || apis.has(ses) || !isPersistent(ses)) return;
    if (partition) partitions.set(ses, partition);
    setup(ses);
    await ready;
    mirroredAt.set(ses, Date.now());
    const def = sessions.defaultSession;
    for (const ext of def.extensions.getAllExtensions()) await load(ses, ext.path);
}

const WELCOME_MS = 15000;
const mirroredAt = new WeakMap(); // other session → when extensions were last loaded into it
function others() { return [...apis.keys()].filter(s => s !== sessions.defaultSession); }
async function mirrorLoad(ext) {
    for (const ses of others()) {
        mirroredAt.set(ses, Date.now());
        if (ses.extensions.getExtension(ext.id)) ses.extensions.removeExtension(ext.id);
        await load(ses, ext.path);
    }
}
function mirrorUnload(id) {
    for (const ses of others()) if (ses.extensions.getExtension(id)) ses.extensions.removeExtension(id);
}

// Electron's content scripts (an extension's code inside web pages) have
// chrome.storage.sync and .managed, but every call fails ('"sync" is not
// available in this instance of Chrome'); only local works. In the
// extension's own pages and worker, electron-chrome-extensions already
// replaces sync/managed with local. Extensions such as LanguageTool stop at
// that error, so every installed extension gets a tiny script that runs
// first in its content script world and does the same replacement there
// (same data on both sides). Done again after each update (the store
// replaces the folder).
const POLYFILL = '_desktop/storage-sync.js';
const POLYFILL_CODE = `// Added by SillyTavern Desktop: chrome.storage.sync/managed work in content scripts too (Electron supports only local there).
(() => { try { const s = chrome.storage; if (s && s.local) for (const k of ['sync', 'managed']) Object.defineProperty(s, k, { value: s.local, configurable: true, enumerable: true, writable: true }); } catch (e) { /* nothing to fix */ } })();
`;
function patch(extPath) {
    const file = path.join(extPath, 'manifest.json');
    let m;
    try { m = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return false; } // unreadable: leave it as it is
    const scripts = Array.isArray(m.content_scripts) ? m.content_scripts : [];
    if (!scripts.some(c => Array.isArray(c.js) && c.js.length && c.world !== 'MAIN')) return false;
    const code = path.join(extPath, POLYFILL);
    let current = '';
    try { current = fs.readFileSync(code, 'utf8'); } catch { /* not there yet */ }
    if (current !== POLYFILL_CODE) {
        fs.mkdirSync(path.dirname(code), { recursive: true });
        fs.writeFileSync(code, POLYFILL_CODE);
    }
    const todo = scripts.filter(c => Array.isArray(c.js) && c.js.length && c.js[0] !== POLYFILL && c.world !== 'MAIN');
    if (!todo.length) return current !== POLYFILL_CODE;
    for (const c of todo) c.js = [POLYFILL, ...c.js.filter(j => j !== POLYFILL)];
    fs.writeFileSync(file, JSON.stringify(m, null, 2));
    return true;
}
const isPatched = extPath => {
    try {
        const m = JSON.parse(fs.readFileSync(path.join(extPath, 'manifest.json'), 'utf8'));
        return !(m.content_scripts || []).some(c => Array.isArray(c.js) && c.js.length && c.js[0] !== POLYFILL && c.world !== 'MAIN');
    } catch { return true; }
};

async function load(ses, extPath) {
    try {
        patch(extPath);
        const ext = await ses.extensions.loadExtension(extPath);
        // Manifest V3: start its background worker now, like Chrome does.
        if (ext.manifest.manifest_version === 3 && ext.manifest.background?.service_worker) {
            await ses.serviceWorkers.startWorkerForScope(`chrome-extension://${ext.id}`).catch(() => {});
        }
        return ext;
    } catch (err) {
        host.logLine(`ERROR: could not load the Chrome extension in ${extPath}: ${err.message}`);
        return null;
    }
}

// ---------- tabs (from shell.js through main.js) ----------
const apiFor = wc => apis.get(wc.session);
export function tabAdded(wc, baseWindow) {
    moving.delete(wc);
    try { apiFor(wc)?.addTab(wc, baseWindow); } catch { /* other session */ }
}
export function tabSelected(wc) { try { apiFor(wc)?.selectTab(wc); } catch { /* not tracked */ } }
// A tab leaving its window for another one: not a closed tab.
export function tabMoving(wc) {
    const api = apiFor(wc);
    if (!api) return;
    moving.add(wc);
    try { api.removeTab(wc); } catch { /* not tracked */ }
}
export function contextItems(wc, params) {
    try { return apiFor(wc)?.getContextMenuItems(wc, params) || []; } catch { return []; }
}
export const partitionForBar = wc => (wc && apis.has(wc.session) ? partitionOf(wc.session) : null);

// ---------- install, list, on/off, remove ----------
async function beforeInstall(d) {
    const ok = await host.confirmInstall({ id: d.id, name: d.localizedName || d.manifest?.name || d.id, manifest: d.manifest || {}, icon: d.icon, frame: d.frame });
    if (ok) host.logLine(`Installing the Chrome extension "${d.localizedName}" …`);
    return { action: ok ? 'allow' : 'deny' };
}

// What the install dialog says about an extension's permissions.
export function describe(manifest) {
    const perms = [...(manifest.permissions || []), ...(manifest.optional_permissions || [])].map(String);
    const hosts = [...(manifest.host_permissions || []), ...perms.filter(p => p.includes('://') || p === '<all_urls>'), ...(manifest.content_scripts || []).flatMap(c => c.matches || [])];
    const everySite = hosts.some(h => h === '<all_urls>' || /^\*:\/\/\*\/|^https?:\/\/\*\//.test(h));
    const missing = [...new Set(perms.filter(p => MISSING[p]).map(p => MISSING[p]))];
    return { everySite, missing, mv: manifest.manifest_version || 2 };
}

function semverCmp(a, b) {
    const pa = String(a).split('.').map(n => parseInt(n, 10) || 0), pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
    return 0;
}

// Installed extensions on disk: the newest version folder of each.
function discover() {
    const out = [];
    let ids = [];
    try { ids = fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory() && ID.test(d.name)).map(d => d.name); } catch { return out; }
    for (const id of ids) {
        let best = null;
        for (const v of fs.readdirSync(path.join(dir, id), { withFileTypes: true })) {
            if (!v.isDirectory()) continue;
            const p = path.join(dir, id, v.name);
            try {
                const manifest = JSON.parse(fs.readFileSync(path.join(p, 'manifest.json'), 'utf8'));
                if (!best || semverCmp(manifest.version, best.manifest.version) > 0) best = { id, path: p, manifest };
            } catch { /* half-written or not an extension */ }
        }
        if (best) out.push(best);
    }
    return out;
}

// "__MSG_appName__" → the text from _locales (English first).
function localize(e, text) {
    const m = /^__MSG_(\w+)__$/.exec(String(text || ''));
    if (!m) return String(text || '');
    for (const loc of ['en', 'en_US', e.manifest.default_locale].filter(Boolean)) {
        try {
            const msgs = JSON.parse(fs.readFileSync(path.join(e.path, '_locales', loc, 'messages.json'), 'utf8'));
            const hit = Object.entries(msgs).find(([k]) => k.toLowerCase() === m[1].toLowerCase());
            if (hit) return hit[1].message;
        } catch { /* no such locale */ }
    }
    return m[1];
}

function iconOf(e) {
    const icons = e.manifest.icons || {};
    const size = Object.keys(icons).map(Number).sort((a, b) => a - b).find(s => s >= 32) || Object.keys(icons).map(Number).pop();
    if (!size) return '';
    try {
        const img = nativeImage.createFromPath(path.join(e.path, icons[size]));
        return img.isEmpty() ? '' : img.resize({ width: 32, height: 32 }).toDataURL();
    } catch { return ''; }
}

export async function list() {
    await ready;
    const off = disabled();
    return discover().map(e => {
        const d = describe(e.manifest);
        const opts = e.manifest.options_ui?.page || e.manifest.options_page;
        return {
            id: e.id,
            name: localize(e, e.manifest.name).slice(0, 80),
            version: String(e.manifest.version || ''),
            description: localize(e, e.manifest.description).slice(0, 300),
            icon: iconOf(e),
            enabled: !off.has(e.id),
            options: opts ? `chrome-extension://${e.id}/${String(opts).replace(/^\/+/, '')}` : '',
            store: `https://chromewebstore.google.com/detail/${e.id}`,
            ...d,
            known: KNOWN[e.id] ? { ...KNOWN[e.id], note: t(KNOWN[e.id].note) } : null,
        };
    }).sort((a, b) => a.name.localeCompare(b.name));
}

export async function setEnabled(id, on) {
    if (!ID.test(id)) return false;
    await ready;
    const s = host.settings();
    const off = new Set(s.chromeExtDisabled || []);
    if (on) off.delete(id); else off.add(id);
    s.chromeExtDisabled = [...off];
    host.saveSettings();
    const def = sessions.defaultSession;
    if (on) {
        const e = discover().find(x => x.id === id);
        if (e && !def.extensions.getExtension(id)) await load(def, e.path); // mirrored by the event
    } else if (def.extensions.getExtension(id)) {
        def.extensions.removeExtension(id);
    }
    return true;
}

export async function remove(id) {
    if (!ID.test(id)) return false;
    await ready;
    await uninstallExtension(id, { session: sessions.defaultSession, extensionsPath: dir });
    mirrorUnload(id);
    const s = host.settings();
    s.chromeExtDisabled = (s.chromeExtDisabled || []).filter(x => x !== id);
    host.saveSettings();
    host.logLine(`Removed the Chrome extension ${id}.`);
    return true;
}

export async function checkUpdates() {
    await ready;
    await updateExtensions(sessions.defaultSession);
}

export const count = () => discover().length;
