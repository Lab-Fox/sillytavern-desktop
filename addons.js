// "Get add-ons": desktop extensions to download from a catalog (a JSON file
// in the sillytavern-desktop-extensions repository). Each entry points to a
// zip with its SHA256; the zip is checked, unpacked into
// <userData>/extensions/<id>, and the extension stays off until the user
// turns it on (extensions.js asks). Updates keep what the extension saved
// for itself: data.json, downloads/ and user/.
import { net } from 'electron';
import fs from 'fs';
import path from 'path';
import { fetchTo, unzip, swapIn } from './runtime.js';

const CATALOG_URL = process.env.ST_DESKTOP_ADDONS_URL
    || 'https://raw.githubusercontent.com/Lab-Fox/sillytavern-desktop-extensions/main/catalog.json';
const CACHE_MS = 6 * 60 * 60 * 1000;
const MAX_ZIP = 50 * 1024 * 1024; // 50 MiB
const KEEP = ['data.json', 'downloads', 'user'];
export const SOURCE_FILE = '.desktop-addon.json'; // where an installed add-on came from
const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

// What an add-on says it uses (manifest/catalog "uses"), in the launcher's words.
export const USES = {
    pages: 'Changes SillyTavern pages',
    contextMenu: 'Right-click menu',
    menu: 'Window menu',
    panel: 'Launcher panel',
    download: 'Downloads files',
    spellcheck: 'Spellchecker words',
    files: 'Reads your SillyTavern files',
};

let log = () => {};
let cacheFile = '';
let extDir = '';
export function initAddons({ logLine, userData, extensionsDir }) {
    log = logLine;
    cacheFile = path.join(userData, 'addon-catalog.json');
    extDir = extensionsDir;
}

const semver = v => String(v || '').split(/[.-]/).slice(0, 3).map(n => parseInt(n, 10) || 0);
export function isNewer(a, b) {
    const pa = semver(a), pb = semver(b);
    for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] > pb[i];
    return false;
}

const str = (v, n) => String(v ?? '').slice(0, n);
// Tests with a local fake catalog (ST_DESKTOP_ADDONS_URL) may use plain http on 127.0.0.1.
const testHttp = u => !!process.env.ST_DESKTOP_ADDONS_URL && u.protocol === 'http:' && u.hostname === '127.0.0.1';
// Only well-formed entries: an odd catalog can't make the launcher do odd things.
function clean(raw) {
    const out = [];
    for (const a of Array.isArray(raw?.addons) ? raw.addons : []) {
        try {
            if (!ID.test(a.id) || out.some(x => x.id === a.id)) continue;
            const dl = new URL(a.download);
            if (!(dl.protocol === 'https:' || testHttp(dl)) || !/^[0-9a-f]{64}$/i.test(a.sha256)) continue;
            const home = a.homepage && /^https:\/\//i.test(a.homepage) ? str(a.homepage, 300) : '';
            out.push({
                id: a.id, name: str(a.name || a.id, 60), version: str(a.version, 20), author: str(a.author, 60),
                description: str(a.description, 400), homepage: home, minAppVersion: str(a.minAppVersion, 20),
                uses: (Array.isArray(a.uses) ? a.uses : []).filter(u => USES[u]),
                download: dl.href, sha256: a.sha256.toLowerCase(), size: Math.min(Number(a.size) || 0, MAX_ZIP),
            });
        } catch { /* bad URL */ }
    }
    return out;
}

function readCache() {
    try { return JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch { return null; }
}

// { addons, fetched, url, error? }; the cached copy when offline.
export async function catalog({ fresh = false } = {}) {
    const cached = readCache();
    if (!fresh && cached?.url === CATALOG_URL && Date.now() - cached.fetched < CACHE_MS) return cached;
    try {
        const res = await net.fetch(CATALOG_URL, { cache: 'no-store' });
        if (!res.ok) throw new Error(`the add-on list answered ${res.status}`);
        const data = { url: CATALOG_URL, fetched: Date.now(), addons: clean(await res.json()) };
        fs.writeFileSync(cacheFile, JSON.stringify(data));
        return data;
    } catch (e) {
        if (cached?.url === CATALOG_URL) return { ...cached, error: `Could not refresh the add-on list (${e.message}); showing the one from ${new Date(cached.fetched).toLocaleString()}.` };
        return { url: CATALOG_URL, fetched: 0, addons: [], error: `Could not load the add-on list: ${e.message}` };
    }
}

export function installedSource(id) {
    try { return JSON.parse(fs.readFileSync(path.join(extDir, id, SOURCE_FILE), 'utf8')); } catch { return null; }
}

// The folder in the zip that has manifest.json: its root, or one folder down.
function manifestRoot(dir) {
    if (fs.existsSync(path.join(dir, 'manifest.json'))) return dir;
    const subs = fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory());
    if (subs.length === 1 && fs.existsSync(path.join(dir, subs[0].name, 'manifest.json'))) return path.join(dir, subs[0].name);
    return null;
}

// Downloads, checks and unpacks; the caller turns the extension off first
// (and on again afterwards) when it is running.
export async function install(entry, appVersion) {
    if (entry.minAppVersion && isNewer(entry.minAppVersion, appVersion)) throw new Error(`it needs SillyTavern Desktop ${entry.minAppVersion} or newer`);
    const dest = path.join(extDir, entry.id);
    const work = path.join(extDir, `.get-${entry.id}`);
    const zipFile = `${work}.zip`;
    fs.rmSync(work, { recursive: true, force: true });
    try {
        await fetchTo({ url: entry.download, sha256: entry.sha256, size: entry.size, maxBytes: MAX_ZIP }, zipFile);
        fs.mkdirSync(work, { recursive: true });
        await unzip(zipFile, work, false);
        const top = manifestRoot(work);
        if (!top) throw new Error('the download has no manifest.json');
        const m = JSON.parse(fs.readFileSync(path.join(top, 'manifest.json'), 'utf8'));
        if (!m || typeof m !== 'object' || !m.name) throw new Error('its manifest.json has no name');
        // What the extension saved for itself survives the update.
        for (const k of KEEP) {
            const from = path.join(dest, k);
            if (fs.existsSync(from)) fs.cpSync(from, path.join(top, k), { recursive: true });
        }
        fs.writeFileSync(path.join(top, SOURCE_FILE), JSON.stringify({ source: 'catalog', catalog: CATALOG_URL, version: entry.version || String(m.version || ''), sha256: entry.sha256, installed: new Date().toISOString() }, null, 2));
        swapIn(top, dest);
        log(`Installed the add-on "${entry.name}" ${entry.version}.`);
        return { id: entry.id };
    } finally {
        fs.rmSync(zipFile, { force: true });
        fs.rmSync(work, { recursive: true, force: true });
    }
}

// The whole folder, including what it saved. The caller asks first.
export function remove(id) {
    if (!ID.test(id)) throw new Error('not an extension id');
    const dest = path.join(extDir, id);
    if (!fs.existsSync(path.join(dest, 'manifest.json'))) throw new Error('not installed');
    fs.rmSync(dest, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    log(`Removed the desktop extension "${id}".`);
}
