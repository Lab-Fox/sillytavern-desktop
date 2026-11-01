// appupdate.js — updates for the desktop app itself, from its GitHub releases.
// The installed app downloads the new installer and runs it silently; the
// portable exe downloads the new exe and swaps it in once the app has quit.
import { app, net } from 'electron';
import { spawn } from 'child_process';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { t } from './i18n.js';

const REPO = 'Lab-Fox/sillytavern-desktop';
// For testing only: point the checks at a local copy of the releases API.
const LATEST_URL = process.env.ST_DESKTOP_UPDATE_URL || `https://api.github.com/repos/${REPO}/releases/latest`;
// Preview channel: GitHub's "latest" is never a pre-release, so read the list.
const LIST_URL = process.env.ST_DESKTOP_RELEASES_URL || `https://api.github.com/repos/${REPO}/releases?per_page=15`;
const VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
export const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;
export const releasePage = () => (state.version && ['available', 'downloading', 'ready'].includes(state.status)
    ? `https://github.com/${REPO}/releases/tag/v${encodeURIComponent(state.version)}` : RELEASES_PAGE);
const ASSET = { installed: 'SillyTavern-Desktop-Setup.exe', portable: 'SillyTavern-Desktop.exe' };

let logLine = () => {};
let send = () => {};
// status: idle | checking | current | available | downloading | ready | error
let state = { status: 'idle' };
let release = null; // { version, asset } of the update on offer
let file = null;    // the downloaded update
let cacheFile = null;
let retryTimer = null;
let wantsPreview = () => false;
const sourceUrl = () => (wantsPreview() ? LIST_URL : LATEST_URL);

// GitHub answers 60 unauthenticated API requests per hour per internet
// connection (shared by everyone behind a VPN). So the answer is kept for a
// few hours and reused on launch, and a refused check is retried once GitHub
// allows it again.
const CACHE_HOURS = 6;

export function initAppUpdate(opts) {
    ({ logLine, send } = opts);
    if (opts.preview) wantsPreview = opts.preview;
    cacheFile = path.join(opts.userData, 'app-update-check.json');
}

export const getState = () => state;
function set(next) {
    state = next;
    send(state);
    return state;
}

// How this copy runs, which decides how it can be updated.
function kind() {
    if (!app.isPackaged) return 'source';
    return process.env.PORTABLE_EXECUTABLE_FILE ? 'portable' : 'installed';
}

// "1.10.0" is newer than "1.9.2", and "1.6.0" than its preview "1.6.0-preview.2"
// (semver: a pre-release comes before its release; numeric parts compare as numbers).
export function isNewer(a, b) {
    const [ca, pa = ''] = a.split(/-(.*)/s);
    const [cb, pb = ''] = b.split(/-(.*)/s);
    const na = ca.split('.').map(Number), nb = cb.split('.').map(Number);
    for (let i = 0; i < 3; i++) if (na[i] !== nb[i]) return na[i] > nb[i];
    if (pa === pb) return false;
    if (!pa || !pb) return !pa;
    const xa = pa.split('.'), xb = pb.split('.');
    for (let i = 0; i < Math.max(xa.length, xb.length); i++) {
        if (xa[i] === undefined || xb[i] === undefined) return xb[i] === undefined;
        if (xa[i] === xb[i]) continue;
        const da = /^\d+$/.test(xa[i]), db = /^\d+$/.test(xb[i]);
        if (da && db) return Number(xa[i]) > Number(xb[i]);
        if (da !== db) return db; // words sort after numbers
        return xa[i] > xb[i];
    }
    return false;
}

const updateDir = () => path.join(app.getPath('temp'), 'sillytavern-desktop-update');
// Downloads from earlier updates (~100 MB each).
function removeDownloads() {
    fs.rm(updateDir(), { recursive: true, force: true }, () => { /* in use or gone: next time */ });
}

function readCache() {
    try {
        const c = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        return c.url === sourceUrl() ? c : null;
    } catch { return null; }
}

function writeCache(r) {
    const keep = { tag_name: r.tag_name, body: r.body, prerelease: !!r.prerelease, assets: (r.assets || []).map(a => ({ name: a.name, size: a.size, digest: a.digest, browser_download_url: a.browser_download_url })) };
    try { fs.writeFileSync(cacheFile, JSON.stringify({ url: sourceUrl(), checkedAt: Date.now(), release: keep })); } catch { /* next time */ }
}

function retryAt(time) {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => check({ quiet: true, fresh: true }), Math.max(60e3, time - Date.now()));
}

// The latest release: from the cache when it's recent (unless `fresh`), else
// from GitHub. When GitHub refuses, an older answer beats none.
async function latestRelease(fresh) {
    const cached = readCache();
    if (!fresh && cached && Date.now() - cached.checkedAt < CACHE_HOURS * 3600e3) return cached.release;
    const res = await net.fetch(sourceUrl(), { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
    if (res.ok) {
        let r = await res.json();
        // The list (preview channel): the newest published release, pre-releases included.
        if (Array.isArray(r)) {
            const tag = x => String(x.tag_name || '').replace(/^v/, '');
            r = r.filter(x => !x.draft && VERSION.test(tag(x))).reduce((best, x) => (!best || isNewer(tag(x), tag(best)) ? x : best), null);
            if (!r) throw new Error(t('GitHub lists no releases'));
        }
        writeCache(r);
        return r;
    }
    if (res.status === 429 || (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0')) {
        const resetAt = Number(res.headers.get('x-ratelimit-reset')) * 1000 || Date.now() + 3600e3;
        retryAt(resetAt + 60e3);
        if (cached) return cached.release;
        const at = new Date(resetAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        throw new Error(t('GitHub only allows a few checks per hour; the app tries again at {time}', { time: at }));
    }
    throw new Error(`GitHub answered ${res.status}`);
}

// On launch (when the setting is on): check now, then every few hours while the app runs.
export function startChecking() {
    check({ quiet: true });
    setInterval(() => check({ quiet: true, fresh: true }), CACHE_HOURS * 3600e3);
}

// quiet: the check on launch shouldn't fill the log when the PC is offline.
// fresh: ask GitHub even if the remembered answer is recent ("Check for app updates").
export async function check({ quiet = false, fresh = false } = {}) {
    if (['checking', 'downloading', 'ready'].includes(state.status)) return state;
    set({ status: 'checking' });
    try {
        const r = await latestRelease(fresh);
        const version = String(r.tag_name || '').replace(/^v/, '');
        if (!VERSION.test(version)) throw new Error(`unexpected release tag "${r.tag_name}"`);
        if (!isNewer(version, app.getVersion())) {
            release = null;
            removeDownloads();
            return set({ status: 'current', version: app.getVersion() });
        }
        const asset = (r.assets || []).find(a => a.name === ASSET[kind()]);
        release = { version, asset };
        logLine(`SillyTavern Desktop ${version}${r.prerelease ? ' (preview)' : ''} is available (this is ${app.getVersion()}).`);
        // Without a matching download (running from source, or an older
        // release without an installer) the launcher links to the release page.
        return set({ status: 'available', version, preview: !!r.prerelease, notes: String(r.body || '').slice(0, 6000), canInstall: !!asset, kind: kind() });
    } catch (e) {
        if (!quiet) logLine(`Could not check for app updates: ${e.message}`);
        return set({ status: 'error', error: e.message });
    }
}

export async function download() {
    if (state.status !== 'available' || !release?.asset) return state;
    const { asset, version } = release;
    const dir = updateDir();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* an old file still in use */ }
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, `${version}-${asset.name}`);
    const base = { ...state, error: undefined };
    set({ ...base, status: 'downloading', percent: 0 });
    try {
        const res = await net.fetch(asset.browser_download_url);
        if (!res.ok) throw new Error(`the server answered ${res.status}`);
        const total = asset.size || Number(res.headers.get('content-length')) || 0;
        const hash = crypto.createHash('sha256');
        let got = 0;
        let shown = 0;
        const meter = new Transform({
            transform(chunk, _enc, done) {
                hash.update(chunk);
                got += chunk.length;
                const percent = total ? Math.floor((got * 100) / total) : 0;
                if (percent !== shown) { shown = percent; set({ ...base, status: 'downloading', percent }); }
                done(null, chunk);
            },
        });
        await pipeline(Readable.fromWeb(res.body), meter, fs.createWriteStream(dest));
        if (asset.size && got !== asset.size) throw new Error(`incomplete (${got} of ${asset.size} bytes)`);
        const sha = hash.digest('hex');
        // GitHub publishes a SHA256 for every release file.
        if (asset.digest && asset.digest.toLowerCase() !== `sha256:${sha}`) throw new Error(t('the file does not match the SHA256 GitHub published for it'));
        file = dest;
        logLine(`Downloaded SillyTavern Desktop ${version} (SHA256 ${sha.toUpperCase()}).`);
        return set({ ...base, status: 'ready', percent: 100 });
    } catch (e) {
        try { fs.rmSync(dest, { force: true }); } catch { /* nothing to clean */ }
        logLine(`ERROR: downloading the app update failed: ${e.message}`);
        return set({ ...base, status: 'available', error: e.message });
    }
}

// The app is already quitting by then; this only leaves a trace in the log.
const launchFailed = e => logLine(`ERROR: could not start the update: ${e.message}`);

// Starts the update, then quits through `quit` (which stops the servers).
export function install(quit) {
    if (state.status !== 'ready' || !file) return false;
    // Windows may have cleaned the temp folder since the download.
    if (!fs.existsSync(file)) {
        file = null;
        logLine('The downloaded update is gone. Download it again.');
        set({ ...state, status: 'available', error: 'the downloaded file is gone' });
        return false;
    }
    if (kind() === 'installed') {
        // Silent install that opens the new version when done, like
        // electron-updater; --updated skips installer.nsh's "is running" prompt.
        spawn(file, ['--updated', '/S', '--force-run'], { detached: true, stdio: 'ignore' }).on('error', launchFailed).unref();
    } else {
        // The portable exe stays locked until this app has quit, so a hidden
        // helper keeps trying to swap the new one in (up to a minute), then
        // starts it. A batch file: a detached PowerShell (no console) exits
        // without running anything.
        const helper = path.join(path.dirname(file), 'swap.cmd');
        fs.writeFileSync(helper, [
            '@echo off',
            'for /l %%i in (1,1,60) do (',
            '  move /y "%ST_NEW%" "%ST_OLD%" >nul 2>&1',
            '  if not errorlevel 1 (',
            '    start "" "%ST_OLD%"',
            '    exit /b 0',
            '  )',
            '  ping -n 2 127.0.0.1 >nul',
            ')',
            'exit /b 1',
        ].join('\r\n'));
        const env = { ...process.env, ST_NEW: file, ST_OLD: process.env.PORTABLE_EXECUTABLE_FILE };
        for (const k of Object.keys(env)) if (k.startsWith('PORTABLE_EXECUTABLE')) delete env[k];
        spawn('cmd.exe', ['/d', '/s', '/c', `""${helper}""`], { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true, env }).on('error', launchFailed).unref();
    }
    logLine(`Installing SillyTavern Desktop ${release.version}. The app restarts by itself.`);
    quit();
    return true;
}
