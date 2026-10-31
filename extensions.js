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
import crypto from 'crypto';
import { net, session } from 'electron';
import { contextsOf } from './contextmenu.js';

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
    // (.old: left over from an update that was interrupted)
    try { ids = fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory() && ID.test(d.name) && !d.name.endsWith('.old')).map(d => d.name); } catch { /* no folder yet */ }
    return ids.map(id => {
        const e = { id, name: id, version: '', author: '', description: '', uses: [], enabled: host.isEnabled(id), active: loaded.has(id) && !loaded.get(id).error, hasPanel: false, fromCatalog: fs.existsSync(path.join(dir, id, '.desktop-addon.json')), error: loaded.get(id)?.error || '' };
        try {
            const m = readManifest(id);
            Object.assign(e, {
                name: String(m.name || id).slice(0, 60), version: String(m.version || '').slice(0, 20),
                author: String(m.author || '').slice(0, 60), description: String(m.description || '').slice(0, 300),
                hasPanel: !!m.panel,
                uses: (Array.isArray(m.uses) ? m.uses : []).map(String).slice(0, 12),
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
    const reg = { menu: [], context: [], styles: [], scripts: [], handlers: new Map(), pageHandlers: new Map(), events: [] };
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
    reg.context.length = 0;
    reg.pageHandlers.clear();
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
            // Page code calls it with SillyTavernDesktop.invoke(<id>, channel, ...args).
            // fn(page, ...args): page = { url, run(code), insertText(text) }.
            handle(channel, fn) { reg.pageHandlers.set(String(channel), fn); },
        }),
        // Entries in the right-click menu of SillyTavern pages.
        contextMenu: Object.freeze({
            add(item) {
                const it = {
                    label: String(item.label || '').slice(0, 80),
                    contexts: (Array.isArray(item.contexts) && item.contexts.length ? item.contexts : ['all']).map(String),
                    when: typeof item.when === 'function' ? item.when : null,
                    click: item.click,
                };
                reg.context.push(it);
                return { remove: () => { const i = reg.context.indexOf(it); if (i >= 0) reg.context.splice(i, 1); } };
            },
        }),
        // A file from the web into <extension>/downloads/ (kept on updates).
        download: (url, o = {}) => downloadFor(id, url, o),
        // Words SillyTavern's red underline accepts (Chromium's own dictionary,
        // in every session SillyTavern pages use). Words stay after the
        // extension turns off; remove them yourself if you need to.
        spellcheck: Object.freeze({
            add: words => forSessions(s => words.forEach(w => s.addWordToSpellCheckerDictionary(String(w)))),
            remove: words => forSessions(s => words.forEach(w => s.removeWordFromSpellCheckerDictionary(String(w)))),
            list: () => session.defaultSession.listWordsInSpellCheckerDictionary(),
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

// Right-click entries for what was clicked (p: Electron's context-menu params).
// An extension with more than two matching entries gets a submenu.
export function contextItems(p, wc) {
    const ctx = contextsOf(p);
    const info = Object.freeze({
        contexts: [...ctx],
        selectionText: p.selectionText || '',
        linkURL: p.linkURL || '',
        srcURL: p.srcURL || '',
        pageURL: p.pageURL || '',
        frameURL: p.frameURL || '',
        isEditable: !!p.isEditable,
        misspelledWord: p.misspelledWord || '',
        suggestions: [...(p.dictionarySuggestions || [])],
        page: pageHandle(wc),
    });
    const sel = info.selectionText.replace(/\s+/g, ' ').trim();
    const shown = sel.length > 24 ? `${sel.slice(0, 23)}…` : sel;
    const items = [];
    for (const [id, entry] of loaded) {
        const mine = [];
        for (const it of entry.reg.context) {
            if (!it.contexts.some(c => ctx.has(c))) continue;
            try { if (it.when && !it.when(info)) continue; } catch (err) { say(id, `ERROR in a menu entry's "when": ${err.message}`); continue; }
            mine.push({
                label: it.label.replace(/%s/g, shown),
                click: () => { Promise.resolve().then(() => it.click?.(info)).catch(err => say(id, `ERROR in a right-click entry: ${err.message}`)); },
            });
        }
        if (mine.length > 2) items.push({ label: entry.manifest?.name || id, submenu: mine });
        else items.push(...mine);
    }
    return items;
}

const pageHandle = wc => Object.freeze({
    url: wc.getURL(),
    run: code => runIn(wc, String(code), 'page'),
    insertText: text => { if (!wc.isDestroyed()) wc.insertText(String(text)); },
});

// From page code: SillyTavernDesktop.invoke(id, channel, ...args) (st-preload.js).
export async function pageInvoke(wc, id, channel, args) {
    if (!pages.has(wc)) throw new Error('only SillyTavern pages can call desktop extensions');
    const fn = loaded.get(String(id))?.reg.pageHandlers.get(String(channel));
    if (!fn) throw new Error(`Desktop extension "${id}" has no page handler "${channel}" (is it turned on?).`);
    return fn(pageHandle(wc), ...args);
}

// Every session a SillyTavern page uses (main, read-only, other installs, remotes).
function forSessions(fn) {
    const all = new Set([session.defaultSession]);
    for (const wc of pages) if (!wc.isDestroyed()) all.add(wc.session);
    for (const s of all) fn(s);
}

const MAX_DOWNLOAD = 200 * 1024 * 1024; // 200 MiB
// https only; the name stays inside downloads/; optional SHA256 check.
// Written to a .partial file first, so a broken download never replaces a good file.
async function downloadFor(id, url, { file, sha256, maxBytes = MAX_DOWNLOAD } = {}) {
    const u = new URL(String(url));
    if (u.protocol !== 'https:') throw new Error('downloads must use https');
    const base = path.join(dir, id, 'downloads');
    const name = String(file || path.basename(u.pathname) || 'download').replace(/\\/g, '/');
    const out = path.resolve(base, name);
    if (!out.startsWith(path.resolve(base) + path.sep)) throw new Error('the file name must stay inside downloads/');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const res = await net.fetch(u.href, { cache: 'no-store' });
    if (!res.ok) throw new Error(`the download answered ${res.status}`);
    const hash = crypto.createHash('sha256');
    const tmp = `${out}.partial`;
    const fd = fs.openSync(tmp, 'w');
    let bytes = 0;
    try {
        for await (const chunk of res.body) {
            bytes += chunk.length;
            if (bytes > maxBytes) throw new Error(`the file is bigger than ${Math.round(maxBytes / 1048576)} MiB`);
            hash.update(chunk);
            fs.writeSync(fd, chunk);
        }
    } catch (e) {
        fs.closeSync(fd);
        fs.rmSync(tmp, { force: true });
        throw e;
    }
    fs.closeSync(fd);
    const digest = hash.digest('hex');
    if (sha256 && digest !== String(sha256).toLowerCase()) { fs.rmSync(tmp, { force: true }); throw new Error('the file does not match its SHA256'); }
    fs.renameSync(tmp, out);
    say(id, `downloaded ${name} (${bytes} bytes).`);
    return { path: out, bytes, sha256: digest };
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
