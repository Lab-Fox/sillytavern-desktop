// stextensions.js — SillyTavern's third-party extensions, beyond updating:
// safety ratings from the Tavernary catalog, snapshots before updates (so an
// update can be undone), Kits (a saved set of extensions), and installing.
//
// Ratings: the public Tavernary catalog (https://tavernary.org) lists
// extensions with TavernKeeper scan results per commit. Its catalog database
// is under the ODbL-1.0; the launcher shows the required credit. A scan is
// evidence about one version, never a guarantee.
import { net } from 'electron';
import fs from 'fs';
import path from 'path';
import { git } from './maintenance.js';
import { t } from './i18n.js';

const CATALOG_URL = 'https://tavernary.org/catalog/tavernary-catalog-v8.json';
const CATALOG_HOURS = 24;
export const CATALOG_CREDIT = { name: 'Tavernary', url: 'https://tavernary.org', license: 'ODbL-1.0', licenseUrl: 'https://opendatacommons.org/licenses/odbl/1-0/' };
const THIRD_PARTY = ['public', 'scripts', 'extensions', 'third-party'];

let log = () => {};
let userData = '';
export function initStExtensions(opts) { ({ logLine: log, userData } = opts); }

// "https://github.com/User/Repo.git/" → "github.com/user/repo"
export function normUrl(u) {
    return String(u || '').trim().toLowerCase()
        .replace(/^git\+/, '').replace(/^[a-z]+:\/\//, '').replace(/^git@([^:]+):/, '$1/')
        .replace(/^www\./, '').replace(/\/+$/, '').replace(/\.git$/, '');
}

// ---------- catalog ----------
// Kept slim on disk: only what the launcher shows (the full file is ~13 MB).
const catalogFile = () => path.join(userData, 'ext-catalog.json');
let catalog = null; // { checkedAt, etag, generatedAt, byUrl: Map, list }

function slim(p) {
    const tk = p.tavernKeeper || {};
    const r = tk.report || {};
    return {
        id: p.id, name: p.name, summary: String(p.summary || '').slice(0, 400), url: p.canonicalUrl,
        repo: p.install?.repositoryUrl || p.canonicalUrl, folder: p.install?.folderName || '', branch: p.install?.branch || null,
        tags: (p.tags || []).filter(t => t.facet === 'goal').map(t => t.label).slice(0, 4),
        stars: p.community?.stars || 0, lastActivity: p.activity?.latestSourceActivityAt || '', dormant: !!p.activity?.dormant,
        license: p.license?.label || '', sourceStatus: p.sourceStatus || '',
        tk: {
            state: tk.state || 'gray', risk: tk.riskLevel || null, freshness: tk.freshness || 'unassessed', currentSha: tk.currentSha || '',
            headline: r.headline || '', summary: r.summary || '', minor: r.minorCautions || 0, material: r.materialConcerns || 0, high: r.highDanger || 0,
            malicious: r.maliciousEvidence || '', reportUrl: r.reportUrl || '', scannedSha: r.scannedSha || '', scannedAt: r.scannedAt || '',
            // Every commit that was ever scanned, with its result.
            scans: (tk.history || []).filter(h => h.scannedSha).map(h => ({ sha: h.scannedSha, risk: h.riskLevel || null, at: h.scannedAt || '', reportUrl: h.reportUrl || '' })),
        },
    };
}

function useCatalog(c) {
    catalog = { ...c, byUrl: new Map(c.list.map(e => [normUrl(e.url), e]).concat(c.list.map(e => [normUrl(e.repo), e]))) };
    return catalog;
}

// From the remembered copy when it is recent; otherwise asks tavernary.org
// (a 304 answer costs nothing). An old copy beats none when offline.
export async function loadCatalog({ fresh = false } = {}) {
    if (!catalog) { try { useCatalog(JSON.parse(fs.readFileSync(catalogFile(), 'utf8'))); } catch { /* none yet */ } }
    if (!fresh && catalog && Date.now() - catalog.checkedAt < CATALOG_HOURS * 3600e3) return { ok: true, catalog };
    try {
        const res = await net.fetch(CATALOG_URL, { headers: catalog?.etag ? { 'If-None-Match': catalog.etag } : {}, cache: 'no-store' });
        if (res.status === 304 && catalog) {
            catalog.checkedAt = Date.now();
            saveCatalog();
            return { ok: true, catalog };
        }
        if (!res.ok) throw new Error(`tavernary.org answered ${res.status}`);
        const raw = await res.json();
        if (raw.schemaVersion !== 8 || !Array.isArray(raw.projects)) throw new Error(`unexpected catalog format (schema ${raw.schemaVersion})`);
        useCatalog({ checkedAt: Date.now(), etag: res.headers.get('etag') || '', generatedAt: raw.generatedAt || '', list: raw.projects.filter(p => p.kind === 'extension' && p.canonicalUrl).map(slim) });
        saveCatalog();
        return { ok: true, catalog };
    } catch (e) {
        if (catalog) return { ok: true, catalog, stale: e.message };
        return { ok: false, error: e.message };
    }
}
function saveCatalog() {
    const { byUrl, ...keep } = catalog;
    try { fs.writeFileSync(catalogFile(), JSON.stringify(keep)); } catch { /* next time */ }
}
export const catalogInfo = () => (catalog ? { checkedAt: catalog.checkedAt, generatedAt: catalog.generatedAt, count: catalog.list.length, credit: CATALOG_CREDIT } : null);

// What the catalog says about an installed extension (or null: not listed).
// head/headDate: the installed commit; incoming: the commit an update brings.
export function rate({ remote, head, headDate, incoming }) {
    const e = catalog?.byUrl.get(normUrl(remote));
    if (!e) return null;
    const scanOf = sha => (sha ? e.tk.scans.find(s => s.sha === sha) || (e.tk.scannedSha === sha ? { sha, risk: e.tk.risk, at: e.tk.scannedAt, reportUrl: e.tk.reportUrl } : null) : null);
    const mine = scanOf(head);
    // Installs are shallow clones, so "newer" can only be told by date.
    const version = !e.tk.scannedSha ? 'none' : mine ? 'scanned' : headDate && e.tk.scannedAt && new Date(headDate) > new Date(e.tk.scannedAt) ? 'newer' : 'other';
    return {
        id: e.id, name: e.name, url: e.url, summary: e.summary, dormant: e.dormant, lastActivity: e.lastActivity,
        risk: (mine || {}).risk ?? e.tk.risk, latestRisk: e.tk.risk, state: e.tk.state, headline: e.tk.headline, scanSummary: e.tk.summary,
        minor: e.tk.minor, material: e.tk.material, high: e.tk.high, reportUrl: (mine || {}).reportUrl || e.tk.reportUrl, scannedAt: e.tk.scannedAt,
        version, incoming: incoming ? (scanOf(incoming) ? 'scanned' : 'unscanned') : null, incomingRisk: scanOf(incoming)?.risk ?? null,
    };
}

// Catalog search for "Find extensions": name, summary and tags.
export function search(query, limit = 60) {
    if (!catalog) return [];
    const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
    const hit = e => words.every(w => `${e.name} ${e.summary} ${e.tags.join(' ')} ${e.url}`.toLowerCase().includes(w));
    return catalog.list.filter(hit)
        .sort((a, b) => (b.stars - a.stars) || (b.lastActivity > a.lastActivity ? 1 : -1))
        .slice(0, limit)
        .map(e => ({ id: e.id, name: e.name, summary: e.summary, url: e.url, tags: e.tags, stars: e.stars, lastActivity: e.lastActivity, dormant: e.dormant, license: e.license,
            risk: e.tk.risk, state: e.tk.state, headline: e.tk.headline, reportUrl: e.tk.reportUrl, scannedAt: e.tk.scannedAt }));
}
export const catalogEntry = id => catalog?.list.find(e => e.id === id) || null;

// ---------- snapshots (undo an update) ----------
// One file per update run in the SillyTavern folder: which commit each
// extension was at before and after. Undo only touches an extension that is
// still exactly at the "after" commit and has no changes of its own.
const snapDir = stRoot => path.join(stRoot, 'backups', 'desktop', 'extension-snapshots');
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const head = async dir => (await git(dir, ['rev-parse', 'HEAD'], { quiet: true })).out.trim();
const dirty = async dir => !!(await git(dir, ['status', '--porcelain', '--untracked-files=no'], { quiet: true })).out.trim();

export async function snapshotBefore(stRoot, exts) {
    const entries = [];
    for (const e of exts) entries.push({ id: e.id, name: e.name, path: e.path, before: await head(e.path), after: '' });
    return { file: path.join(snapDir(stRoot), `${stamp()}.json`), at: Date.now(), entries };
}
export async function snapshotAfter(snap) {
    for (const s of snap.entries) s.after = await head(s.path);
    snap.entries = snap.entries.filter(s => s.after && s.before && s.after !== s.before);
    if (!snap.entries.length) return null;
    fs.mkdirSync(path.dirname(snap.file), { recursive: true });
    const { file, ...keep } = snap;
    fs.writeFileSync(file, JSON.stringify(keep, null, 1));
    return snap;
}
function snapshots(stRoot) {
    let files = [];
    try { files = fs.readdirSync(snapDir(stRoot)).filter(f => f.endsWith('.json')).sort().reverse(); } catch { return []; }
    return files.map(f => { try { return { file: path.join(snapDir(stRoot), f), ...JSON.parse(fs.readFileSync(path.join(snapDir(stRoot), f), 'utf8')) }; } catch { return null; } }).filter(Boolean);
}
// The newest update that can still be undone, and per extension the version it can go back to.
export async function undoInfo(stRoot, exts) {
    const snaps = snapshots(stRoot).filter(s => !s.undone);
    const back = {};
    for (const e of exts) {
        if (!e.head) continue;
        for (const s of snaps) {
            const hit = s.entries.find(x => sameDir(x.path, e.path) && x.after === e.head && !x.undone);
            if (hit) { back[e.path] = { to: hit.before, at: s.at }; break; }
        }
    }
    const last = snaps[0];
    const lastOk = last ? last.entries.filter(x => !x.undone && exts.some(e => sameDir(e.path, x.path) && e.head === x.after)) : [];
    return { last: lastOk.length ? { at: last.at, count: lastOk.length, names: lastOk.map(x => x.name) } : null, back };
}
const sameDir = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

async function resetTo(dir, sha, name) {
    if (await dirty(dir)) { log(`${name}: has changes of its own, so it was left as it is.`); return false; }
    const r = await git(dir, ['reset', '--hard', sha], { quiet: true });
    if (r.code !== 0) { log(`ERROR: ${name} could not go back: ${r.out.trim().split('\n').pop()}`); return false; }
    return true;
}
// only: an extension path to roll back alone; otherwise the whole last update.
export async function undo(stRoot, only) {
    const snaps = snapshots(stRoot).filter(s => !s.undone);
    const targets = only ? snaps : snaps.slice(0, 1);
    let done = 0;
    for (const s of targets) {
        for (const x of s.entries) {
            if (x.undone || (only && !sameDir(x.path, only))) continue;
            if (!fs.existsSync(x.path) || await head(x.path) !== x.after) continue;
            if (await resetTo(x.path, x.before, x.name)) { x.undone = true; done++; log(`${x.name}: back to the version before the update.`); }
            if (only) break;
        }
        if (s.entries.every(x => x.undone)) s.undone = true;
        const { file, ...keep } = s;
        try { fs.writeFileSync(file, JSON.stringify(keep, null, 1)); } catch { /* read-only? */ }
        if (only && done) break;
    }
    log(done ? `Went back on ${done} extension${done === 1 ? '' : 's'}. Reload SillyTavern to use the old version${done === 1 ? '' : 's'}.` : 'Nothing could be undone (the extensions changed since).');
    return done;
}

// ---------- installing ----------
// Like SillyTavern's own installer: a shallow clone into the user's (or, for
// all users, the third-party) extensions folder, named after the repository.
const SAFE_URL = /^https:\/\/[\w.-]+(:\d+)?\/[\w.\-~/%]+$/;
export function folderFor(url) { return path.basename(new URL(url).pathname, '.git').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/^\.+/, ''); }
export function extensionsDir(stRoot, scope) {
    return scope === 'all users' ? path.join(stRoot, ...THIRD_PARTY) : path.join(stRoot, 'data', scope || 'default-user', 'extensions');
}
export async function install(stRoot, { url, scope = 'default-user', commit = '', branch = null, name = '' }) {
    if (!SAFE_URL.test(url)) return { error: t('Not an https Git address: {url}', { url }) };
    const folder = folderFor(url);
    if (!folder) return { error: t('No folder name in {url}', { url }) };
    const base = extensionsDir(stRoot, scope);
    const dest = path.join(base, folder);
    if (fs.existsSync(dest)) return { error: t('{name} is already installed.', { name: folder }) };
    fs.mkdirSync(base, { recursive: true });
    const label = name || folder;
    log(`Installing ${label} from ${url} ...`);
    const args = ['clone', '--depth', '1', ...(branch ? ['--branch', branch] : []), url, folder];
    const r = await git(base, args, { quiet: true });
    if (r.code !== 0) {
        await fs.promises.rm(dest, { recursive: true, force: true }).catch(() => {});
        return { error: `${label}: ${r.out.trim().split('\n').pop() || 'git clone failed'}` };
    }
    // A Kit can ask for the exact version it was saved with.
    if (commit && /^[0-9a-f]{7,40}$/i.test(commit) && commit !== await head(dest)) {
        const f = await git(dest, ['fetch', '--depth', '1', 'origin', commit], { quiet: true });
        if (f.code !== 0 || !(await resetTo(dest, commit, label))) log(`${label}: the exact version from the Kit isn't available anymore, so the newest one was installed.`);
    }
    if (!fs.existsSync(path.join(dest, 'manifest.json'))) {
        await fs.promises.rm(dest, { recursive: true, force: true }).catch(() => {});
        return { error: t('{name} is not a SillyTavern extension (no manifest.json).', { name: label }) };
    }
    log(`Installed ${label}.`);
    return { ok: true, folder, path: dest };
}

// ---------- Kits ----------
// A Kit is a saved list of extensions (address, scope, version), never their
// files. Stored in the app's data folder, so every profile can use it.
const kitsDir = () => path.join(userData, 'kits');
const KIT_ID = /^[a-z0-9][a-z0-9-]{0,40}$/;
function cleanKit(raw) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.extensions)) throw new Error(t('Not a Kit file.'));
    const name = String(raw.name || '').trim().slice(0, 60);
    if (!name) throw new Error(t('The Kit has no name.'));
    const extensions = raw.extensions.slice(0, 300).map(e => ({
        name: String(e.name || '').slice(0, 80), url: String(e.url || ''),
        scope: e.scope === 'all users' ? 'all users' : 'user', commit: /^[0-9a-f]{7,40}$/i.test(e.commit || '') ? e.commit : '',
    })).filter(e => SAFE_URL.test(e.url));
    if (!extensions.length) throw new Error(t('The Kit lists no extensions with an https address.'));
    return { format: 1, name, description: String(raw.description || '').slice(0, 300), created: Number(raw.created) || Date.now(), extensions };
}
export function kits() {
    let files = [];
    try { files = fs.readdirSync(kitsDir()).filter(f => f.endsWith('.json')); } catch { return []; }
    return files.map(f => { try { return { id: f.slice(0, -5), ...cleanKit(JSON.parse(fs.readFileSync(path.join(kitsDir(), f), 'utf8'))) }; } catch { return null; } })
        .filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
}
export function saveKit(raw) {
    const kit = cleanKit(raw);
    fs.mkdirSync(kitsDir(), { recursive: true });
    const base = kit.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'kit';
    let id = base;
    for (let i = 2; fs.existsSync(path.join(kitsDir(), `${id}.json`)); i++) id = `${base}-${i}`;
    fs.writeFileSync(path.join(kitsDir(), `${id}.json`), JSON.stringify(kit, null, 1));
    return { id, ...kit };
}
export function readKitFile(file) { return cleanKit(JSON.parse(fs.readFileSync(file, 'utf8'))); }
export function deleteKit(id) {
    if (!KIT_ID.test(id)) return false;
    try { fs.unlinkSync(path.join(kitsDir(), `${id}.json`)); return true; } catch { return false; }
}
export const kitJson = id => (KIT_ID.test(id) ? fs.readFileSync(path.join(kitsDir(), `${id}.json`), 'utf8') : null);
