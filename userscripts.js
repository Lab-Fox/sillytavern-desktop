// Built-in userscript manager — the Tampermonkey stand-in for the
// SillyTavern window. Community extensions (e.g. Character Library's
// JanitorAI bridge) ship companion userscripts that expect GM_* APIs;
// without a manager they silently never run inside this app.
//
// Scripts live in <userData>/userscripts/*.user.js. st-preload.js asks us
// which scripts match each frame, then injects them into the page's main
// world with a GM_* shim that calls back here over IPC.
import { BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import fs from 'fs';

let scriptsDir = '';
let valuesFile = '';
let log = () => {};

// ---------- metadata parsing ----------
function parseMeta(code) {
    const block = /\/\/\s*==UserScript==([\s\S]*?)\/\/\s*==\/UserScript==/.exec(code);
    if (!block) return null;
    const meta = {};
    for (const line of block[1].split(/\r?\n/)) {
        const m = /^\s*\/\/\s*@([\w:-]+)(?:\s+(.*))?$/.exec(line);
        if (!m) continue;
        const key = m[1];
        const value = (m[2] || '').trim();
        (meta[key] ||= []).push(value);
    }
    return meta;
}

const escapeRe = s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

// Chrome-style @match pattern -> RegExp
function matchToRegex(pattern) {
    if (pattern === '<all_urls>') return /^(https?|file|ftp):\/\//;
    const m = /^(\*|https?|file|ftp):\/\/([^/]*)(\/.*)$/.exec(pattern);
    if (!m) return null;
    const scheme = m[1] === '*' ? 'https?' : m[1];
    let host;
    if (m[2] === '*') host = '[^/]*';
    else if (m[2].startsWith('*.')) host = `(?:[^/]*\\.)?${escapeRe(m[2].slice(2))}(?::\\d+)?`;
    else host = `${escapeRe(m[2])}(?::\\d+)?`;
    const pathRe = m[3].split('*').map(escapeRe).join('.*');
    return new RegExp(`^${scheme}://${host}${pathRe}$`);
}

// @include / @exclude: glob with *, or /regex/
function includeToRegex(pattern) {
    if (pattern.length > 2 && pattern.startsWith('/') && pattern.endsWith('/')) {
        try { return new RegExp(pattern.slice(1, -1)); } catch { return null; }
    }
    return new RegExp(`^${pattern.split('*').map(escapeRe).join('.*')}$`);
}

// Asked for on every frame SillyTavern loads and every GM request, so the
// parsed scripts are kept until a file is added, removed or changed.
let cache = { key: null, scripts: [] };

function loadScripts() {
    let files = [];
    try { files = fs.readdirSync(scriptsDir).filter(f => f.endsWith('.user.js')); } catch { return []; }
    const key = files.map(f => { try { return `${f}:${fs.statSync(path.join(scriptsDir, f)).mtimeMs}`; } catch { return f; } }).join('|');
    if (key === cache.key) return cache.scripts;
    const scripts = [];
    for (const file of files) {
        let code;
        try { code = fs.readFileSync(path.join(scriptsDir, file), 'utf8'); } catch { continue; }
        const meta = parseMeta(code);
        if (!meta) { log(`Userscript ${file} has no ==UserScript== header — skipped.`); continue; }
        const first = k => meta[k]?.[0] || '';
        scripts.push({
            id: file,
            code,
            name: first('name') || file,
            namespace: first('namespace'),
            version: first('version'),
            description: first('description'),
            runAt: first('run-at') || 'document-idle',
            noframes: 'noframes' in meta,
            connect: meta.connect || [],
            includes: [...(meta.match || []).map(matchToRegex), ...(meta.include || []).map(includeToRegex)].filter(Boolean),
            excludes: [...(meta['exclude-match'] || []).map(matchToRegex), ...(meta.exclude || []).map(includeToRegex)].filter(Boolean),
        });
    }
    cache = { key, scripts };
    return scripts;
}

function findScript(id) {
    return loadScripts().find(s => s.id === id) || null;
}

// @connect allowlist. No @connect at all = allowed (the user installed the
// script on purpose); otherwise the target must match one of the entries.
function connectAllowed(script, url, pageUrl) {
    if (!script.connect.length) return true;
    let host, pageHost;
    try { host = new URL(url).hostname; } catch { return false; }
    try { pageHost = new URL(pageUrl).hostname; } catch { pageHost = ''; }
    return script.connect.some(c => c === '*'
        || (c === 'self' && host === pageHost)
        || (c === 'localhost' && (host === 'localhost' || host === '127.0.0.1'))
        || host === c || host.endsWith(`.${c}`));
}

// ---------- persistent GM values ----------
// Read once, then kept in memory: GM_getValue is a synchronous call from the
// page, so it must not wait for the disk. Every change is still written out.
let values = null;
function readValues() {
    if (!values) { try { values = JSON.parse(fs.readFileSync(valuesFile, 'utf8')); } catch { values = {}; } }
    return values;
}
function writeValues(all) {
    values = all;
    try { fs.writeFileSync(valuesFile, JSON.stringify(all, null, 2)); } catch (e) { log(`Could not save userscript values: ${e.message}`); }
}

// ---------- the main-world GM shim ----------
// Runs in the page, wraps the script so GM_* are lexical names it can see.
function buildInjection(script) {
    const info = {
        script: { name: script.name, namespace: script.namespace, version: script.version, description: script.description },
        scriptHandler: 'SillyTavern Desktop',
        version: '1.0',
    };
    return `(function () {
const __bridge = window.__stDesktopGM;
if (!__bridge) return;
const __id = ${JSON.stringify(script.id)};
const GM_info = ${JSON.stringify(info)};
const unsafeWindow = window;
function GM_xmlhttpRequest(d) {
    let aborted = false;
    const req = {
        method: d.method || 'GET', url: String(new URL(d.url, location.href)),
        headers: d.headers || {}, data: typeof d.data === 'string' ? d.data : undefined,
        timeout: d.timeout || 0, pageUrl: location.href,
    };
    __bridge.request(__id, req).then(r => {
        if (aborted) return;
        if (r.error === 'timeout') return d.ontimeout && d.ontimeout(r);
        if (r.error) return d.onerror && d.onerror(r);
        let response = r.responseText;
        if (d.responseType === 'json') { try { response = JSON.parse(r.responseText); } catch { response = null; } }
        const res = { ...r, response, readyState: 4 };
        d.onload && d.onload(res);
        d.onloadend && d.onloadend(res);
    });
    return { abort() { aborted = true; d.onabort && d.onabort(); } };
}
function GM_openInTab(url, opts) {
    const active = typeof opts === 'boolean' ? !opts : !!(opts && opts.active);
    const tab = { closed: false, onclose: null, close() {} };
    const p = __bridge.openInTab(__id, String(new URL(url, location.href)), active);
    tab.close = () => { tab.closed = true; p.then(tabId => __bridge.closeTab(tabId)); };
    return tab;
}
function GM_getValue(k, def) { const v = __bridge.getValue(__id, k); return v === undefined ? def : v; }
function GM_setValue(k, v) { __bridge.setValue(__id, k, v); }
function GM_deleteValue(k) { __bridge.deleteValue(__id, k); }
function GM_listValues() { return __bridge.listValues(__id); }
function GM_addStyle(css) { const s = document.createElement('style'); s.textContent = css; (document.head || document.documentElement).appendChild(s); return s; }
function GM_registerMenuCommand() { return 0; }
function GM_unregisterMenuCommand() {}
function GM_log(...a) { console.log('[userscript]', ...a); }
const GM = {
    info: GM_info,
    xmlHttpRequest: d => GM_xmlhttpRequest(d),
    openInTab: (u, o) => GM_openInTab(u, o),
    getValue: async (k, def) => GM_getValue(k, def),
    setValue: async (k, v) => GM_setValue(k, v),
    deleteValue: async k => GM_deleteValue(k),
    listValues: async () => GM_listValues(),
    addStyle: async css => GM_addStyle(css),
    registerMenuCommand: GM_registerMenuCommand,
};
try {
${script.code}
} catch (e) { console.error('[SillyTavern Desktop] userscript ' + __id + ' failed:', e); }
})();
//# sourceURL=userscript://${encodeURIComponent(script.id)}`;
}

// ---------- background "tabs" for GM_openInTab ----------
const tabs = new Map();
let nextTabId = 1;

export function setupUserscripts({ userData, logLine }) {
    scriptsDir = path.join(userData, 'userscripts');
    valuesFile = path.join(userData, 'userscript-values.json');
    log = logLine;
    fs.mkdirSync(scriptsDir, { recursive: true });

    const loaded = loadScripts();
    log(loaded.length
        ? `Userscripts loaded: ${loaded.map(s => `${s.name} ${s.version}`.trim()).join(', ')}`
        : `No userscripts installed (folder: ${scriptsDir}).`);

    // Called synchronously by st-preload.js at document start of every frame.
    ipcMain.on('us:for-url', (e, url, isMainFrame) => {
        e.returnValue = loadScripts()
            .filter(s => !(s.noframes && !isMainFrame))
            .filter(s => s.includes.some(r => r.test(url)) && !s.excludes.some(r => r.test(url)))
            .map(s => ({ id: s.id, runAt: s.runAt, code: (s.injection ||= buildInjection(s)) }));
    });

    // GM_xmlhttpRequest: CORS-free, and sends the window's own session
    // cookies (e.g. a cf_clearance earned in a GM_openInTab window).
    ipcMain.handle('us:request', async (e, id, req) => {
        const script = findScript(id);
        if (!script) return { error: 'unknown script', status: 0 };
        if (!connectAllowed(script, req.url, req.pageUrl)) {
            log(`Userscript ${script.name}: blocked request to ${req.url} (not in @connect).`);
            return { error: 'blocked by @connect', status: 0 };
        }
        const ctrl = new AbortController();
        const timer = req.timeout ? setTimeout(() => ctrl.abort(), req.timeout) : null;
        try {
            const res = await e.sender.session.fetch(req.url, {
                method: req.method,
                headers: req.headers,
                body: req.data,
                credentials: 'include',
                signal: ctrl.signal,
            });
            const responseText = await res.text();
            const responseHeaders = [...res.headers].map(([k, v]) => `${k}: ${v}`).join('\r\n');
            return { status: res.status, statusText: res.statusText, responseText, responseHeaders, finalUrl: res.url };
        } catch (err) {
            return { error: ctrl.signal.aborted ? 'timeout' : err.message, status: 0 };
        } finally {
            if (timer) clearTimeout(timer);
        }
    });

    // GM_openInTab: a real Chromium window in the same session, so any
    // cookies it earns (Cloudflare clearance) are shared with the requests
    // above. Background tabs stay hidden but keep running JavaScript.
    ipcMain.handle('us:open-tab', (e, id, url, active) => {
        if (!findScript(id) || !/^https?:/.test(url)) return 0;
        const win = new BrowserWindow({
            width: 1100,
            height: 800,
            show: !!active,
            webPreferences: { session: e.sender.session, backgroundThrottling: false, contextIsolation: true, nodeIntegration: false },
        });
        win.setMenu(null);
        win.loadURL(url);
        const tabId = nextTabId++;
        tabs.set(tabId, win);
        win.on('closed', () => tabs.delete(tabId));
        // Don't leak hidden windows if the page that opened them goes away.
        e.sender.once('destroyed', () => { if (!win.isDestroyed()) win.close(); });
        return tabId;
    });
    ipcMain.handle('us:close-tab', (_e, tabId) => {
        const win = tabs.get(tabId);
        if (win && !win.isDestroyed()) win.close();
    });

    ipcMain.on('us:get-value', (e, id, key) => { e.returnValue = readValues()[id]?.[key]; });
    ipcMain.on('us:list-values', (e, id) => { e.returnValue = Object.keys(readValues()[id] || {}); });
    ipcMain.on('us:set-value', (e, id, key, value) => {
        const all = readValues();
        (all[id] ||= {})[key] = value;
        writeValues(all);
        e.returnValue = true;
    });
    ipcMain.on('us:delete-value', (e, id, key) => {
        const all = readValues();
        if (all[id]) delete all[id][key];
        writeValues(all);
        e.returnValue = true;
    });

    return { scriptsDir };
}
