// Desktop extensions: add-ons for this app (not for SillyTavern). Each one
// is a folder in <userData>/extensions/<id>/ with a manifest.json, an
// optional main-process module and an optional launcher panel script.
//
// Extensions are off until the user turns them on: their main module runs
// with full Node access, like the app itself. Everything an extension
// registers through its `api` object is tracked, so turning it off undoes
// it (menu items, page styles/scripts, handlers, events). See EXTENSIONS.md.
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const MANIFEST = 'manifest.json';
const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

let host = null;   // see initExtensions
let dir = '';
const loaded = new Map(); // id → { manifest, module, reg, error }
const pages = new Set();  // SillyTavern page webContents
const ready = new WeakSet(); // pages whose current document passed dom-ready
const listeners = new Map(); // event → Set of { id, fn }

// host: { userData, appVersion, logLine, isEnabled(id),
//         sillytavern: { folder, url, info, openTab(path) } }
export function initExtensions(h) {
    host = h;
    dir = path.join(h.userData, 'extensions');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}
export const extensionsDir = () => dir;

// ---------- discovery ----------
function readManifest(id) {
    const m = JSON.parse(fs.readFileSync(path.join(dir, id, MANIFEST), 'utf8'));
    if (!m || typeof m !== 'object') throw new Error('manifest.json is not an object.');
    for (const k of ['main', 'panel']) {
        if (m[k] == null) continue;
        const file = path.resolve(dir, id, String(m[k]));
        if (!file.startsWith(path.resolve(dir, id) + path.sep)) throw new Error(`"${k}" must point inside the extension folder.`);
    }
    return m;
}

export function list() {
    let ids = [];
    try { ids = fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory() && ID.test(d.name)).map(d => d.name); } catch { /* no folder yet */ }
    return ids.map(id => {
        const e = { id, name: id, version: '', author: '', description: '', enabled: host.isEnabled(id), active: loaded.has(id) && !loaded.get(id).error, hasPanel: false, error: loaded.get(id)?.error || '' };
        try {
            const m = readManifest(id);
            Object.assign(e, {
                name: String(m.name || id).slice(0, 60), version: String(m.version || '').slice(0, 20),
                author: String(m.author || '').slice(0, 60), description: String(m.description || '').slice(0, 300),
                hasPanel: !!m.panel,
            });
            if (m.minAppVersion && newer(m.minAppVersion, host.appVersion)) e.error = `Needs SillyTavern Desktop ${m.minAppVersion} or newer.`;
        } catch (err) { e.error = `Broken manifest.json: ${err.message}`; }
        return e;
    }).sort((a, b) => a.name.localeCompare(b.name));
}

const newer = (a, b) => {
    const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
    for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
    return false;
};

// ---------- lifecycle ----------
export async function activateEnabled() {
    for (const e of list()) if (e.enabled && !e.error) await activate(e.id);
}

export async function activate(id) {
    if (loaded.has(id)) await deactivate(id);
    const reg = { menu: [], styles: [], scripts: [], handlers: new Map(), events: [] };
    const entry = { manifest: null, module: null, reg, error: '' };
    loaded.set(id, entry);
    try {
        entry.manifest = readManifest(id);
        if (entry.manifest.minAppVersion && newer(entry.manifest.minAppVersion, host.appVersion)) throw new Error(`needs SillyTavern Desktop ${entry.manifest.minAppVersion} or newer`);
        if (entry.manifest.main) {
            // Reload must pick up edited files: CommonJS modules are cached by
            // path (cleared here), ES modules by URL (the query string).
            const extDir = path.join(dir, id) + path.sep;
            for (const f of Object.keys(require.cache)) if (f.startsWith(extDir)) delete require.cache[f];
            const url = `${pathToFileURL(path.join(dir, id, entry.manifest.main)).href}?v=${Date.now()}`;
            const mod = await import(url);
            entry.module = mod.activate ? mod : mod.default;
            await entry.module?.activate?.(makeApi(id, entry));
        }
        say(id, 'turned on.');
    } catch (err) {
        entry.error = err.message;
        say(id, `ERROR: could not start: ${err.message}`);
        undo(entry);
    }
}

export async function deactivate(id) {
    const entry = loaded.get(id);
    if (!entry) return;
    try { await entry.module?.deactivate?.(); } catch (err) { say(id, `ERROR while turning off: ${err.message}`); }
    undo(entry);
    say(id, 'turned off.');
    loaded.delete(id);
}

export async function reloadAll() {
    for (const id of [...loaded.keys()]) await deactivate(id);
    await activateEnabled();
}

function undo(entry) {
    const { reg } = entry;
    reg.menu.length = 0;
    for (const s of reg.styles) removeStyle(s);
    reg.styles.length = 0;
    reg.scripts.length = 0;
    reg.handlers.clear();
    for (const ev of reg.events) listeners.get(ev.event)?.delete(ev);
    reg.events.length = 0;
}

const say = (id, msg) => host.logLine(`[extension ${loaded.get(id)?.manifest?.name || id}] ${msg}`);

// ---------- the api object an extension gets ----------
function makeApi(id, entry) {
    const { reg } = entry;
    const dataFile = path.join(dir, id, 'data.json');
    const readData = () => { try { return JSON.parse(fs.readFileSync(dataFile, 'utf8')); } catch { return {}; } };
    return Object.freeze({
        id,
        dir: path.join(dir, id),
        appVersion: host.appVersion,
        log: msg => say(id, String(msg)),
        storage: Object.freeze({
            get: (key, fallback) => { const d = readData(); return key in d ? d[key] : fallback; },
            set: (key, value) => { const d = readData(); d[key] = value; fs.writeFileSync(dataFile, JSON.stringify(d, null, 2)); },
            all: () => readData(),
        }),
        // Events: 'server-started', 'server-stopped'. Returns an unsubscribe function.
        on(event, fn) {
            const ev = { id, event, fn };
            if (!listeners.has(event)) listeners.set(event, new Set());
            listeners.get(event).add(ev);
            reg.events.push(ev);
            return () => { listeners.get(event)?.delete(ev); };
        },
        sillytavern: Object.freeze({
            folder: () => host.sillytavern.folder(),
            url: () => host.sillytavern.url(),
            info: () => host.sillytavern.info(),
            openTab: (p = '/') => host.sillytavern.openTab(String(p)),
        }),
        // SillyTavern pages: styles and scripts apply to every open page and
        // every page loaded later, until removed or the extension is off.
        pages: Object.freeze({
            addStyle(css) {
                const s = { css: String(css), keys: new Map() };
                reg.styles.push(s);
                for (const wc of pages) applyStyle(wc, s);
                return { remove: () => { removeStyle(s); reg.styles.splice(reg.styles.indexOf(s), 1); } };
            },
            addScript(code) {
                const s = { code: String(code) };
                reg.scripts.push(s);
                for (const wc of pages) runIn(wc, s.code, id);
                return { remove: () => { reg.scripts.splice(reg.scripts.indexOf(s), 1); } };
            },
            run: code => Promise.all([...pages].map(wc => runIn(wc, String(code), id))),
            count: () => pages.size,
        }),
        // Items under "Extensions" in the SillyTavern window's menu.
        menu: Object.freeze({
            add(item) {
                const it = { label: String(item.label), click: item.click };
                reg.menu.push(it);
                return { remove: () => { reg.menu.splice(reg.menu.indexOf(it), 1); } };
            },
        }),
        // Called from the extension's launcher panel with ext.invoke(channel, ...args).
        handle(channel, fn) { reg.handlers.set(String(channel), fn); },
    });
}

// ---------- hooks for main.js ----------
export function emit(event, ...args) {
    for (const ev of listeners.get(event) || []) {
        try { ev.fn(...args); } catch (err) { say(ev.id, `ERROR in "${event}" handler: ${err.message}`); }
    }
}

// Every SillyTavern page (any tab, window or instance) is registered here.
export function attachPage(wc) {
    pages.add(wc);
    wc.on('did-navigate', () => ready.delete(wc));
    wc.on('dom-ready', () => {
        ready.add(wc);
        for (const entry of loaded.values()) {
            for (const s of entry.reg.styles) applyStyle(wc, s);
            for (const s of entry.reg.scripts) runIn(wc, s.code, entry.manifest?.name);
        }
    });
    wc.once('destroyed', () => pages.delete(wc));
}

function applyStyle(wc, s) {
    if (wc.isDestroyed()) return;
    wc.insertCSS(s.css).then(key => s.keys.set(wc, key)).catch(() => { /* page gone */ });
}
function removeStyle(s) {
    for (const [wc, key] of s.keys) if (!wc.isDestroyed()) wc.removeInsertedCSS(key).catch(() => {});
    s.keys.clear();
}
function runIn(wc, code, who) {
    if (wc.isDestroyed() || !ready.has(wc)) return Promise.resolve(); // dom-ready will run it
    return wc.executeJavaScript(`try { ${code}\n} catch (e) { console.error('[desktop extension ${String(who).replace(/'/g, '')}]', e); }`).catch(() => {});
}

export function menuItems() {
    const items = [];
    for (const entry of loaded.values()) for (const it of entry.reg.menu) {
        items.push({ label: it.label, click: () => { try { it.click?.(); } catch (err) { host.logLine(`ERROR in extension menu item: ${err.message}`); } } });
    }
    return items;
}

export async function invoke(id, channel, args) {
    const fn = loaded.get(id)?.reg.handlers.get(channel);
    if (!fn) throw new Error(`Extension "${id}" has no handler "${channel}" (is it turned on?).`);
    return fn(...args);
}

export function panelCode(id) {
    const m = readManifest(id);
    if (!m.panel) return null;
    return fs.readFileSync(path.join(dir, id, m.panel), 'utf8');
}

// Copies a bundled example into the extensions folder (never overwrites).
// File by file: in the built app the source is inside the asar archive.
export function addExample(srcDir) {
    const id = path.basename(srcDir);
    const dest = path.join(dir, id);
    if (fs.existsSync(dest)) return { exists: true, id };
    const copy = (from, to) => {
        fs.mkdirSync(to, { recursive: true });
        for (const d of fs.readdirSync(from, { withFileTypes: true })) {
            if (d.isDirectory()) copy(path.join(from, d.name), path.join(to, d.name));
            else fs.writeFileSync(path.join(to, d.name), fs.readFileSync(path.join(from, d.name)));
        }
    };
    copy(srcDir, dest);
    return { id };
}

export const isValidId = id => typeof id === 'string' && ID.test(id) && fs.existsSync(path.join(dir, id, MANIFEST));
