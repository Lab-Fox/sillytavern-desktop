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

const REPO = 'Lab-Fox/sillytavern-desktop';
// For testing only: point the check at a local copy of the releases API.
const LATEST_URL = process.env.ST_DESKTOP_UPDATE_URL || `https://api.github.com/repos/${REPO}/releases/latest`;
export const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;
const ASSET = { installed: 'SillyTavern-Desktop-Setup.exe', portable: 'SillyTavern-Desktop.exe' };

let logLine = () => {};
let send = () => {};
// status: idle | checking | current | available | downloading | ready | error
let state = { status: 'idle' };
let release = null; // { version, asset } of the update on offer
let file = null;    // the downloaded update

export function initAppUpdate(opts) {
    ({ logLine, send } = opts);
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

// "1.10.0" is newer than "1.9.2".
function isNewer(a, b) {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] > pb[i];
    return false;
}

const updateDir = () => path.join(app.getPath('temp'), 'sillytavern-desktop-update');
// Downloads from earlier updates (~100 MB each).
function removeDownloads() {
    fs.rm(updateDir(), { recursive: true, force: true }, () => { /* in use or gone: next time */ });
}

// quiet: the check on launch shouldn't fill the log when the PC is offline.
export async function check({ quiet = false } = {}) {
    if (['checking', 'downloading', 'ready'].includes(state.status)) return state;
    set({ status: 'checking' });
    try {
        const res = await net.fetch(LATEST_URL, { headers: { Accept: 'application/vnd.github+json' } });
        if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
        const r = await res.json();
        const version = String(r.tag_name || '').replace(/^v/, '');
        if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`unexpected release tag "${r.tag_name}"`);
        if (!isNewer(version, app.getVersion())) {
            release = null;
            removeDownloads();
            return set({ status: 'current', version: app.getVersion() });
        }
        const asset = (r.assets || []).find(a => a.name === ASSET[kind()]);
        release = { version, asset };
        logLine(`SillyTavern Desktop ${version} is available (this is ${app.getVersion()}).`);
        // Without a matching download (running from source, or an older
        // release without an installer) the launcher links to the release page.
        return set({ status: 'available', version, notes: String(r.body || '').slice(0, 6000), canInstall: !!asset, kind: kind() });
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
        if (asset.digest && asset.digest.toLowerCase() !== `sha256:${sha}`) throw new Error('the file does not match the SHA256 GitHub published for it');
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
