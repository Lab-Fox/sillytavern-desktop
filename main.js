// SillyTavern Desktop — main process
// Wraps the SillyTavern server as a hidden child process and
// renders it in a dedicated Chromium window. No cmd, ever.
import { app, BrowserWindow, Menu, Tray, ipcMain, shell, dialog, clipboard, session, screen } from 'electron';
import { spawn, execFileSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import http from 'http';
import { fileURLToPath } from 'url';
import { setupUserscripts } from './userscripts.js';
import * as mx from './maintenance.js';
import * as setup from './setup.js';
import * as themes from './themes.js';
import { StWindow, windowOf } from './shell.js';
import { MODES as LAYERS } from './winlayer.js';
import * as instances from './instances.js';
import * as ext from './extensions.js';
import * as appUpdate from './appupdate.js';
import * as lan from './lan.js';
import * as prof from './profiles.js';
import * as dl from './downloader.js';
import * as hist from './history.js';
import * as mig from './migrate.js';
import * as sx from './stextensions.js';
import * as rt from './runtime.js';
import * as imp from './importer.js';
import * as bs from './backupsched.js';
import * as remote from './remote.js';
import * as cm from './contextmenu.js';
import * as addons from './addons.js';
import * as crx from './chromeext.js';
import * as i18n from './i18n.js';
import { t } from './i18n.js';
import https from 'https';
import * as so from './serveropts.js';
import * as tunnel from './tunnel.js';
import * as pc from './pccheck.js';
import * as ai from './aiapps.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Packaged builds run from inside a read-only asar — settings and logs must
// live in userData, and the default SillyTavern path must be computed from
// the real exe location (portable exe sits in <root>/ST-Desktop/dist).
const USER_DATA = app.getPath('userData');
fs.mkdirSync(USER_DATA, { recursive: true });
const SETTINGS_FILE = path.join(USER_DATA, 'settings.json');
const DEBUG_LOG = path.join(USER_DATA, 'desktop-debug.log');

// Folders around the app itself, searched first when looking for
// SillyTavern. Portable builds self-extract to a temp dir before running,
// so process.execPath is useless there — electron-builder hands us
// PORTABLE_EXECUTABLE_DIR instead.
function exeBases() {
    if (!app.isPackaged) return [path.resolve(__dirname, '..')];
    const bases = [];
    if (process.env.PORTABLE_EXECUTABLE_DIR) bases.push(process.env.PORTABLE_EXECUTABLE_DIR);
    bases.push(path.dirname(process.execPath));
    return bases;
}

// ---------- settings ----------
// sillytavernPath starts empty: on first launch the app searches for an
// install (see ensureInstall) or asks the user, so the exe can live anywhere.
const DEFAULT_SETTINGS = {
    sillytavernPath: '',
    profiles: [],               // [{ id, name, path }] — SillyTavern folders to switch between (profiles.js)
    remotes: [],                // [{ id, name, url, user, password: { enc } }] — SillyTavern on other computers (remote.js)
    port: 8000,
    host: '127.0.0.1',
    windowWidth: 1280,
    windowHeight: 800,
    windowFullScreen: false,
    windowLayer: 'normal',      // SillyTavern window: 'normal' | 'top' (always on top) | 'bottom' (stays in background)
    tabs: true,                 // pages SillyTavern/extensions open become tabs instead of windows
    warnSecondServer: true,     // explain the shared-data risk before a second server on the same folder
    desktopExtensions: {},      // id → true for desktop extensions the user turned on
    consoleFont: '',            // console/log font; '' = the built-in pixel font
    consoleFontSize: 18,
    uiFont: '',                 // the app's font: '' = Departure Mono, a built-in id (themes.UI_FONTS) or an installed font
    uiZoom: 100,                // launcher size in percent (themes.ZOOMS)
    autoStart: true,      // start server + open ST window immediately on app launch
    confirmBeforeQuit: true,
    closeToTray: false,         // closing the launcher hides it to the tray; the server keeps running
    backupBeforeUpdate: true,   // zip data/ before every update or branch switch
    checkUpdatesOnLaunch: true, // git fetch on startup so the dashboard can say "update available"
    updateOnLaunch: false,      // update SillyTavern on startup, before the server starts
    checkAppUpdates: true,      // look for a new release of this app on startup (never installs by itself)
    appPreview: false,          // also offer pre-releases of this app (preview channel, appupdate.js)
    lanAccess: false,           // phones/tablets on the same network may open SillyTavern (see lan.js)
    lanUser: 'user',            // with lanPassword: SillyTavern's login for other devices
    lanPassword: '',
    backupKeep: 10,             // automatic backups kept; manual ones are never pruned
    backupSchedule: 'off',      // 'off' | 'start' | 'daily' | 'weekly' (backupsched.js)
    backupScheduleScope: 'active', // 'active' profile or 'all' profiles
    backupScheduleDir: '',      // '' = backups/desktop in each SillyTavern folder
    backupScheduleKeep: 7,      // scheduled backups kept per profile
    ownRuntime: false,          // use this app's own Node.js and Git (runtime.js) instead of the PC's
    extInstallNoticeSeen: false, // the "extensions run code" note before installing from the app
    searchEngine: 'google',     // right-click → Search for selected text (contextmenu.js SEARCH_ENGINES)
    inspectMenu: false,         // "Inspect element" in the right-click menu (for extension makers)
    chromeExtDisabled: [],      // Chrome extension ids turned off (installed but not loaded; chromeext.js)
    spellcheckEngine: 'windows', // red underlines: 'windows' (Windows' spellchecker) or 'builtin' (Chromium's Hunspell, English); needs a restart
    theme: 'sillytavern',       // launcher theme id (see themes.js)
    language: '',               // the app's language (i18n.js); '' = Windows' language
    syncStLanguage: true,       // a language change also sets SillyTavern's own language (where it has it)
    stLanguage: null,           // { code, done: [partitions] } after a change: each session gets it once
    serverOverrides: {},        // SillyTavern options the app sets as SILLYTAVERN_* variables (serveropts.js); config.yaml is never written
    https: false,               // serve SillyTavern over https with the app's own certificate (serveropts.certificate)
    companions: [],             // [{ id, name, path, args, stop }] programs started with SillyTavern ("Start with SillyTavern")
    appsDir: '',                // AI apps and models (aiapps.js); '' = "ai-apps" next to the SillyTavern folder
    appOptions: {},             // app id → { model, ctx, layers, port, … }
    appAutostart: {},           // app id → true: started with SillyTavern
};
function loadSettings() {
    try {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) };
    } catch {
        return { ...DEFAULT_SETTINGS };
    }
}
// Write then rename: a crash mid-write must not wipe the settings.
function saveSettings(s) {
    fs.writeFileSync(`${SETTINGS_FILE}.tmp`, JSON.stringify(s, null, 4));
    fs.renameSync(`${SETTINGS_FILE}.tmp`, SETTINGS_FILE);
}
let settings = loadSettings();
// Settings from before profiles: the folder in use becomes the first profile.
if (prof.normalize(settings)) saveSettings(settings);
// What the launcher gets: everything but the phone-access password and the
// remote logins (the launcher asks for remote.list() instead).
const publicSettings = () => ({ ...settings, remotes: undefined, lanPassword: settings.lanPassword ? '********' : '' });
let userscriptsDir = path.join(USER_DATA, 'userscripts');
const systemLanguage = () => { try { return i18n.detect(app.getPreferredSystemLanguages()); } catch { return 'en'; } };
i18n.setLanguage(settings.language || systemLanguage());

// Chromium's native occlusion stays on: together with backgroundThrottling
// (see stWebPreferences) a SillyTavern window hidden behind other windows
// stops drawing. (It used to be turned off because the top bar came back
// blank after "Stay in background"; that no longer happens, checked 2026-10-31.)

// Spellchecker: Windows' own (Electron's default on Windows: needs the
// language installed in Windows, which many PCs don't have for English) or
// Chromium's built-in Hunspell (English dictionary downloaded once from
// Google's servers). A Chromium feature switch, so it must be set before the
// app is ready: changing it needs a restart.
const SPELL_ENGINES = ['windows', 'builtin'];
if (settings.spellcheckEngine === 'builtin') app.commandLine.appendSwitch('disable-features', 'WinUseBrowserSpellChecker');
const spellEngineAtStart = SPELL_ENGINES.includes(settings.spellcheckEngine) ? settings.spellcheckEngine : 'windows';
// The built-in one would follow Windows' language (en-ID here, which it has
// no dictionary for): English for every session SillyTavern pages use.
const spellSessions = new WeakSet();
function useSpellLanguage(ses) {
    if (spellEngineAtStart !== 'builtin' || spellSessions.has(ses)) return;
    spellSessions.add(ses);
    try { ses.setSpellCheckerLanguages(['en-US']); } catch (e) { logLine(`Spellchecker: ${e.message}`); }
}
function setSpellEngine(engine) {
    if (!SPELL_ENGINES.includes(engine)) return { error: t('Unknown spellchecker.') };
    settings.spellcheckEngine = engine;
    saveSettings(settings);
    broadcast('settings', publicSettings());
    return { engine, restart: engine !== spellEngineAtStart };
}

// ---------- single instance lock ----------
// `--quit` comes from the installer before it replaces the app: it closes a
// running copy and never starts one itself.
const quitOnly = process.argv.includes('--quit');
const gotLock = app.requestSingleInstanceLock() && !quitOnly;
if (!gotLock) {
    app.quit();
} else {
    app.on('second-instance', (_e, argv) => {
        if (!argv.includes('--quit')) {
            showLauncher();
            // "Open with SillyTavern Desktop" while the app runs.
            const files = importArgs(argv);
            if (files.length) offerImport(files);
            return;
        }
        // will-quit stops the servers and writes the log.
        logLine('Closing for the installer (update or uninstall).');
        isQuitting = true;
        app.quit();
    });
}

// ---------- server manager ----------
// attached: we found a server we didn't spawn, so we can't stop it.
const serverState = { child: null, running: false, attached: false, startedAt: 0, logs: [] };

function broadcast(channel, ...args) {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, ...args);
    if (channel === 'server-started' || channel === 'server-stopped') { ext.emit(channel); updateTray(); }
}

// The server prints in bursts of hundreds of lines at startup. Lines are
// collected for a moment and then written and sent to the launcher together,
// instead of one disk write and one message per line.
const LOG_FLUSH_MS = 60;
const LOG_MAX_BYTES = 2 * 1024 * 1024; // then the old log moves to desktop-debug.old.log
let pendingLog = [];
let logStream = null;
let logBytes = 0; // size of the current log file, counted while writing

// Checked while the app runs too: a long session used to grow the log far
// past the limit, since the size was only looked at on launch.
function openLog() {
    logBytes = 0;
    try {
        const size = fs.statSync(DEBUG_LOG).size;
        if (size > LOG_MAX_BYTES) fs.renameSync(DEBUG_LOG, DEBUG_LOG.replace(/\.log$/, '.old.log'));
        else logBytes = size;
    } catch { /* no log yet */ }
    logStream = fs.createWriteStream(DEBUG_LOG, { flags: 'a' });
    logStream.on('error', () => { /* disk hiccup — don't die over it */ });
}
function rotateLog() {
    const old = logStream;
    logStream = null;
    // Renamed once the old stream's last write is on disk.
    old.end(() => { if (!logStream) openLog(); });
}

function flushLog({ sync = false } = {}) {
    if (!pendingLog.length) return;
    const lines = pendingLog;
    pendingLog = [];
    const text = `${lines.join('\n')}\n`;
    if (sync) { try { fs.appendFileSync(DEBUG_LOG, text); } catch { /* quitting anyway */ } } else {
        if (!logStream) openLog();
        logStream.write(text);
        logBytes += Buffer.byteLength(text);
        if (logBytes > LOG_MAX_BYTES) rotateLog();
    }
    if (launcherWin && !launcherWin.isDestroyed()) launcherWin.webContents.send('server-log', lines);
}

function logLine(line) {
    // Strip ANSI color codes — the server colors its output for terminals.
    const entry = `[${new Date().toLocaleTimeString()}] ${line.replace(/\x1b\[[0-9;]*m/g, '')}`;
    serverState.logs.push(entry);
    if (serverState.logs.length > 500) serverState.logs.shift();
    if (!pendingLog.length) setTimeout(flushLog, LOG_FLUSH_MS);
    pendingLog.push(entry);
}

// The main server's address: https when it runs with the app's certificate.
const scheme = () => (settings.https ? 'https' : 'http');
const mainUrl = () => `${scheme()}://${settings.host}:${settings.port}/`;
// A request to this PC's own SillyTavern (its certificate is our own, so no CA check).
function probeLocal(url, timeout, onRes, onFail) {
    const mod = url.startsWith('https:') ? https : http;
    const req = mod.get(url, { timeout, rejectUnauthorized: false }, onRes);
    req.on('timeout', () => { req.destroy(); onFail(); });
    req.on('error', onFail);
}
function checkPortOpen() {
    return new Promise(resolve => {
        // Either scheme: a server started elsewhere may use the other one.
        let left = 2, done = false;
        const answer = ok => { if (done) return; if (ok) { done = true; resolve(true); } else if (--left === 0) resolve(false); };
        for (const s of ['http', 'https']) {
            probeLocal(`${s}://${settings.host}:${settings.port}/`, 2500, res => { res.resume(); answer(res.statusCode < 500); }, () => answer(false));
        }
    });
}

// Everything the main server gets on top of the usual variables: phone access,
// the remote link, HTTPS and the SillyTavern options chosen in Settings.
let tunnelWanted = false; // the remote link is on (never remembered across launches)
let tailscaleOn = false;  // Tailscale's addresses may connect (phone access on)
let httpsCert = null;
function mainServerEnv() {
    const env = { ...so.env(settings.serverOverrides), ...lan.serverEnv(settings) };
    if (settings.lanAccess && tailscaleOn && env.SILLYTAVERN_WHITELIST) {
        env.SILLYTAVERN_WHITELIST = JSON.stringify([...JSON.parse(env.SILLYTAVERN_WHITELIST), tunnel.TAILSCALE_RANGE]);
    }
    if (tunnelWanted && settings.lanPassword) {
        // Tunnel visitors come through cloudflared; the password is the gate.
        Object.assign(env, {
            SILLYTAVERN_WHITELISTMODE: 'false',
            SILLYTAVERN_BASICAUTHMODE: 'true',
            SILLYTAVERN_BASICAUTHUSER_USERNAME: settings.lanUser || 'user',
            SILLYTAVERN_BASICAUTHUSER_PASSWORD: settings.lanPassword,
        });
    }
    if (settings.https) {
        try {
            httpsCert = so.certificate(path.join(USER_DATA, 'certs'), ['127.0.0.1', ...lan.localNetworks().map(n => n.address)]);
            Object.assign(env, so.httpsEnv(httpsCert));
        } catch (e) { logLine(`ERROR: could not make the HTTPS certificate: ${e.message}`); }
    }
    return env;
}
// The login the running server asks for (phone access or the remote link), else null.
const serverLogin = () => (serverState.running && serverState.env?.SILLYTAVERN_BASICAUTHMODE === 'true'
    ? { user: serverState.env.SILLYTAVERN_BASICAUTHUSER_USERNAME, password: serverState.env.SILLYTAVERN_BASICAUTHUSER_PASSWORD } : null);
const envKey = env => JSON.stringify(Object.entries(env).filter(([k]) => k !== 'SILLYTAVERN_SSL_CERTPATH' && k !== 'SILLYTAVERN_SSL_KEYPATH').sort());

// ---------- start with SillyTavern ----------
// Programs or scripts started with the server; those marked `stop` end with it.
const companionKids = new Map(); // id → child process
function startCompanion(c) {
    if (companionKids.has(c.id)) return true;
    const file = String(c.path || '');
    if (!fs.existsSync(file)) { logLine(`Start with SillyTavern: "${c.name}" is not at ${file} anymore.`); return false; }
    const ext = path.extname(file).toLowerCase();
    const args = String(c.args || '').match(/"[^"]*"|\S+/g)?.map(a => a.replace(/^"|"$/g, '')) || [];
    if (['.lnk', '.url'].includes(ext)) { shell.openPath(file); logLine(`Started "${c.name}".`); return true; }
    const [cmd, cmdArgs] = ext === '.ps1' ? ['powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file, ...args]]
        : ['.bat', '.cmd'].includes(ext) ? ['cmd.exe', ['/c', file, ...args]] : [file, args];
    try {
        const kid = spawn(cmd, cmdArgs, { cwd: path.dirname(file), detached: !c.stop, stdio: 'ignore', windowsHide: false });
        kid.on('error', e => { companionKids.delete(c.id); logLine(`Could not start "${c.name}": ${e.message}`); });
        kid.on('exit', () => companionKids.delete(c.id));
        if (c.stop) companionKids.set(c.id, kid);
        else kid.unref();
        logLine(`Started "${c.name}".`);
        return true;
    } catch (e) { logLine(`Could not start "${c.name}": ${e.message}`); return false; }
}
// When the app quits, wait for taskkill: an async one never ran before the app was gone.
function stopCompanions({ wait = false } = {}) {
    for (const [id, kid] of companionKids) {
        const args = ['/PID', String(kid.pid), '/T', '/F'];
        if (wait) { try { execFileSync('taskkill', args, { windowsHide: true, stdio: 'ignore', timeout: 5000 }); } catch { /* already gone */ } }
        else spawn('taskkill', args, { windowsHide: true });
        companionKids.delete(id);
    }
}

async function startServer() {
    if (serverState.running) { logLine('Server is already running.'); return; }
    // An update, restore or branch switch is changing SillyTavern's files.
    if (busyStopsServer) { logLine(`Busy with "${busyTask}" — the server starts again when it has finished.`); return; }
    if (await checkPortOpen()) {
        logLine(`Port ${settings.port} is already serving — a SillyTavern server is running elsewhere. Attaching to it instead of starting a duplicate.`);
        serverState.running = true;
        serverState.attached = true;
        serverState.startedAt = Date.now();
        broadcast('server-started');
        return;
    }
    const stRoot = settings.sillytavernPath;
    if (!setup.isStRoot(stRoot)) {
        logLine(stRoot ? `ERROR: SillyTavern not found at ${stRoot}. Choose your SillyTavern folder.` : 'Choose your SillyTavern folder first.');
        broadcast('refresh');
        return;
    }
    warnMisplacedUserscripts(stRoot);
    logLine(`Starting SillyTavern server from ${stRoot} ...`);
    if (settings.lanAccess) tailscaleOn = (await tunnel.tailscale()).running;
    const extraEnv = mainServerEnv();
    if (settings.lanAccess) {
        const where = lan.phoneAddresses(settings.port).map(a => a.url).join(' or ');
        logLine(where ? `Phone access is on: open ${where} on a device on the same network.` : 'Phone access is on, but this PC is not on a home network right now.');
        const older = dl.olderStatus(instances.describe(stRoot).version);
        if (older) logLine(`WARNING: phone access is on with SillyTavern ${instances.describe(stRoot).version}, which is ${older.newer} release${older.newer === 1 ? '' : 's'} behind ${older.latest}${older.fixes.length ? ', and newer releases fixed security problems' : ''}. Other devices on your network can reach it; update it or turn phone access off.`);
        if (lan.hasWhitelistTxt(stRoot)) logLine('WARNING: SillyTavern\'s whitelist.txt decides who may connect, not this app. Add your network there, or remove the file.');
    }
    const opts = Object.keys(so.clean(settings.serverOverrides));
    if (opts.length) logLine(`SillyTavern options set by this app: ${opts.join(', ')}.`);
    if (settings.https) logLine('HTTPS is on (this app\'s own certificate).');
    // Pass the port explicitly so the Settings value is what the server binds to.
    const child = spawn('node', ['server.js', '--port', String(settings.port)], {
        cwd: stRoot,
        windowsHide: true,
        env: instances.serverEnv(extraEnv),
        shell: false,
    });
    serverState.child = child;
    serverState.env = extraEnv;
    serverState.envKey = envKey(extraEnv); // to tell when a settings change needs a restart
    serverState.running = true;
    serverState.startedAt = Date.now();
    broadcast('server-started');
    for (const c of settings.companions) startCompanion(c);
    for (const id of ai.autostartIds()) ai.start(id);

    // If node can't even be spawned (ENOENT etc.) we get 'error', not 'exit'.
    child.on('error', err => {
        serverState.running = false;
        serverState.child = null;
        logLine(`ERROR: failed to launch node: ${err.message}`);
        broadcast('server-stopped');
    });
    mx.onLines(child.stdout, l => { if (l.trim()) logLine(l.trim()); });
    mx.onLines(child.stderr, l => { if (l.trim()) logLine(`[stderr] ${l.trim()}`); });
    child.on('exit', (code) => {
        serverState.running = false;
        serverState.child = null;
        logLine(`Server exited with code ${code}.`);
        stopCompanions();
        // The link points at this server; a restart for new settings brings it back.
        if (tunnel.running() && !restartingForSettings) tunnel.stop();
        broadcast('server-stopped');
    });
}
let restartingForSettings = false;
// The server runs with other variables than the settings now ask for.
const needsRestart = () => serverState.running && !serverState.attached && serverState.envKey !== envKey(mainServerEnv());

// Browser userscripts dropped into plugins/ make SillyTavern try (and fail)
// to load them as server plugins. Point the user at the right place.
function warnMisplacedUserscripts(stRoot) {
    let files = [];
    try { files = fs.readdirSync(path.join(stRoot, 'plugins')).filter(f => f.endsWith('.user.js')); } catch { return; }
    for (const f of files) {
        logLine(`WARNING: plugins/${f} is a browser userscript, not a server plugin — SillyTavern will fail to load it. Move it to the userscripts folder (launcher → Open userscripts folder).`);
    }
}

function stopServer() {
    if (serverState.attached) {
        // Not ours to kill — just detach so the UI reflects reality.
        logLine('This server was started outside the app; detaching. Stop it from where it was launched.');
        serverState.attached = false;
        serverState.running = false;
        broadcast('server-stopped');
        return;
    }
    // Several quit paths call this; one taskkill is enough.
    if (!serverState.child || serverState.child.stopping) return;
    serverState.child.stopping = true;
    logLine('Stopping server...');
    // taskkill /T kills the whole process tree (node spawns children e.g. transformers)
    if (process.platform === 'win32') {
        spawn('taskkill', ['/PID', String(serverState.child.pid), '/T', '/F'], { windowsHide: true });
    } else {
        serverState.child.kill('SIGTERM');
    }
}

// Start the server if needed, then open the window once it answers. Nothing
// to wait for when it didn't start (no install, busy, node missing).
async function startAndOpen() {
    await startServer();
    if (serverState.running) waitForServerThenOpen();
}

// Tabs of a SillyTavern on another computer have nothing to do with this PC's server or extensions.
const onThisPc = inst => inst?.kind !== 'remote';

// Poll the server until it answers, then open the ST window.
let waitingForServer = false;
function waitForServerThenOpen({ reload = false } = {}) {
    // autoStart and the Open button can both land here; only one poller at a time.
    if (waitingForServer) return;
    waitingForServer = true;
    const started = Date.now();
    const timeout = 120000; // transformers.js can take a while on first run
    const tryFetch = () => {
        probeLocal(mainUrl(), 3000, res => {
            res.resume();
            if (res.statusCode && res.statusCode < 500) {
                waitingForServer = false;
                if (reload) stWins.forEach(w => w.reloadAll(onThisPc));
                openSillyTavernWindow();
            }
            else retry();
        }, retry);
    };
    const retry = () => {
        if (!serverState.running) { waitingForServer = false; logLine('Server process died during startup — giving up on opening the window.'); return; }
        if (Date.now() - started > timeout) { waitingForServer = false; logLine('Timed out waiting for the server to respond.'); return; }
        setTimeout(tryFetch, 1000);
    };
    tryFetch();
}

// ---------- maintenance tasks ----------
// One task at a time. Tasks that change SillyTavern's files stop the server
// first (Windows locks files a running node process holds) and start it
// again afterwards if it was running.
let busyTask = '';
let busyStopsServer = false; // the running task needs the server stopped

function stopServerAndWait() {
    return new Promise(resolve => {
        if (!serverState.running) return resolve(true);
        if (serverState.attached) {
            logLine('The server was started outside this app — stop it there first.');
            return resolve(false);
        }
        const timer = setTimeout(() => { logLine('ERROR: the server did not stop within 20 seconds.'); resolve(false); }, 20000);
        serverState.child.once('exit', () => { clearTimeout(timer); setTimeout(() => resolve(true), 500); });
        stopServer();
    });
}

async function runTask(label, fn, { needsStopped = true } = {}) {
    if (busyTask) { logLine(`Busy with "${busyTask}" — wait for it to finish.`); return false; }
    busyTask = label;
    busyStopsServer = needsStopped;
    broadcast('busy', busyTask);
    let restart = false;
    try {
        // Extra servers on the same folder hold its files too; their tabs close.
        if (needsStopped) await instances.stopAll(stRoot());
        if (needsStopped && serverState.running) {
            restart = !serverState.attached;
            if (!(await stopServerAndWait())) return false;
        }
        return await fn();
    } catch (e) {
        logLine(`ERROR: ${e.message}`);
        return false;
    } finally {
        busyTask = '';
        busyStopsServer = false;
        broadcast('busy', '');
        broadcast('refresh');
        if (restart) startServer().then(() => waitForServerThenOpen({ reload: true }));
    }
}

async function confirm(message, detail, okLabel) {
    // From the tray or the SillyTavern window the launcher may be hidden: no owner then.
    const owner = launcherWin && !launcherWin.isDestroyed() && launcherWin.isVisible() ? [launcherWin] : [];
    const { response } = await dialog.showMessageBox(...owner, {
        type: 'question', buttons: [okLabel, t('Cancel')], defaultId: 0, cancelId: 1, message, detail,
    });
    return response === 0;
}

const stRoot = () => settings.sillytavernPath;
const keep = () => settings.backupKeep;

// ---------- windows ----------
let launcherWin = null;
const stWins = new Set(); // SillyTavern windows (several when tabs are off)
let isQuitting = false;   // set once quitting is decided; closing the launcher then really closes it

// A larger launcher (Settings → Size) needs a larger window, or the pages get
// squeezed below the width they're laid out for (at 150 % the smallest
// window was only 536 px wide inside). As large as the screen allows.
const LAUNCHER_MIN = [820, 560];
function fitLauncherToZoom() {
    if (!launcherWin || launcherWin.isDestroyed()) return;
    const z = (settings.uiZoom || 100) / 100;
    const area = screen.getDisplayMatching(launcherWin.getBounds()).workAreaSize;
    const minW = Math.min(Math.round(LAUNCHER_MIN[0] * z), area.width);
    const minH = Math.min(Math.round(LAUNCHER_MIN[1] * z), area.height);
    launcherWin.setMinimumSize(minW, minH);
    const [w, h] = launcherWin.getSize();
    if (!launcherWin.isMaximized() && (w < minW || h < minH)) launcherWin.setSize(Math.max(w, minW), Math.max(h, minH));
}

function createLauncherWindow() {
    launcherWin = new BrowserWindow({
        width: 1040,
        height: 720,
        minWidth: 820,
        minHeight: 560,
        resizable: true,
        backgroundColor: themes.get(settings.theme).colors.bg,
        title: 'SillyTavern Desktop',
        icon: path.join(__dirname, 'icon.ico'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
    Menu.setApplicationMenu(null);
    launcherWin.loadFile('launcher.html');
    attachLauncherMenu(launcherWin.webContents);
    fitLauncherToZoom();
    // With the tray on, closing only hides the launcher.
    launcherWin.on('close', e => {
        if (!tray || isQuitting) return;
        e.preventDefault();
        launcherWin.hide();
        if (!trayHintShown) {
            trayHintShown = true;
            tray.displayBalloon({ iconType: 'info', title: t('SillyTavern Desktop is still running'), content: serverState.running ? t('The server keeps running. Click the tray icon to open the launcher.') : t('Click the tray icon to open the launcher.') });
        }
    });
    // Windows shutting down or signing out must not be held up by the tray.
    launcherWin.on('query-session-end', () => { isQuitting = true; });
    launcherWin.on('session-end', () => { isQuitting = true; });
    launcherWin.on('closed', () => { launcherWin = null; });
}

// ---------- language ----------
// The app's language changes at once: the launcher and the top bars reload,
// menus and dialogs use it from then on. SillyTavern's own language is a
// localStorage value per session; after a change every session gets it once
// (so choosing another one in SillyTavern later sticks).
let stLangReload = false; // open SillyTavern pages still show the old language
// SillyTavern keeps the language per session and address (another port is another value).
const partKey = (instance, wc) => {
    let host = '';
    try { host = new URL(wc.getURL()).host; } catch { /* not loaded yet */ }
    return `${instance.webPreferences?.partition || 'default'}|${host}`;
};
function stLanguageTo(wc, instance, reload) {
    const s = settings.stLanguage;
    if (!/^https?:/.test(wc.getURL())) return false; // a status page, not SillyTavern yet
    const key = partKey(instance, wc);
    if (!s || s.code !== i18n.current().st || s.done.includes(key)) return false;
    s.done.push(key);
    saveSettings(settings);
    const code = JSON.stringify(s.code);
    wc.executeJavaScript(`try { if (localStorage.getItem('language') !== ${code}) { localStorage.setItem('language', ${code}); ${reload ? 'location.reload();' : ''} } } catch {}`).catch(() => {});
    return true;
}
function setAppLanguage(id) {
    if (id && !i18n.byId(id)) return false;
    settings.language = id;
    i18n.setLanguage(id || systemLanguage());
    const code = i18n.current().st;
    settings.stLanguage = settings.syncStLanguage && code ? { code, done: [] } : null;
    let open = 0;
    for (const w of stWins) for (const tab of w.tabs) if (!tab.instance.anyWeb && stLanguageTo(tab.view.webContents, tab.instance, false)) open++;
    stLangReload = open > 0;
    saveSettings(settings);
    logLine(`Language: ${i18n.current().english}.`);
    if (launcherWin && !launcherWin.isDestroyed()) launcherWin.webContents.reload();
    mainInstance();
    if (readOnlyInst) readOnlyInstance();
    for (const w of stWins) w.reloadBar();
    updateTray();
    return true;
}
const languageMenu = () => i18n.LANGUAGES.map(l => ({
    label: l.id === 'en' ? l.name : `${l.name} — ${l.english}`, type: 'radio', checked: i18n.current().id === l.id, click: () => setAppLanguage(l.id),
}));
ipcMain.on('i18n-dict', e => {
    e.returnValue = { ...i18n.forPage(), chosen: settings.language, system: systemLanguage(), stSync: settings.syncStLanguage, stReload: stLangReload && stWins.size > 0 };
});
ipcMain.handle('set-language', (_e, id) => setAppLanguage(String(id || '')));
ipcMain.handle('set-st-language-sync', (_e, on) => {
    settings.syncStLanguage = !!on;
    saveSettings(settings);
    broadcast('settings', publicSettings());
    return true;
});
ipcMain.handle('st-language-reload', async () => {
    stLangReload = false;
    for (const w of stWins) w.reloadAll(inst => !inst.anyWeb);
    return true;
});

// ---------- tray ----------
// Only there while the closeToTray setting is on.
let tray = null;
let trayHintShown = false;

function trayMenu() {
    const w = stWindowState();
    return [
        { label: !w.open ? t('Open SillyTavern') : w.minimized ? t('Restore SillyTavern') : t('Show SillyTavern'), click: () => (serverState.running ? openSillyTavernWindow() : startAndOpen()) },
        ...(w.open && !w.minimized ? [{ label: t('Minimize SillyTavern'), click: minimizeStWindows }] : []),
        { label: t('Show launcher'), click: showLauncher },
        ...(settings.profiles.length > 1 ? [{ label: t('Profile'), submenu: profileMenu() }] : []),
        ...(settings.remotes.length ? [{ label: t('Open on another computer'), submenu: remoteMenuItems(null) }] : []),
        { label: `${t('Language')} (Language)`, submenu: languageMenu() },
        { type: 'separator' },
        serverState.running
            ? { label: t('Stop server'), enabled: !busyTask, click: stopServer }
            : { label: t('Start server'), enabled: !busyTask, click: () => startServer() },
        { type: 'separator' },
        { label: t('Quit'), click: () => app.quit() },
    ];
}

function updateTray() {
    if (tray) tray.setToolTip(`SillyTavern Desktop — ${serverState.running ? t('server running') : t('server stopped')}`);
}

function syncTray() {
    if (settings.closeToTray && !tray) {
        tray = new Tray(path.join(__dirname, 'icon.ico'));
        tray.on('click', showLauncher);
        tray.on('right-click', () => tray.popUpContextMenu(Menu.buildFromTemplate(trayMenu())));
        updateTray();
    } else if (!settings.closeToTray && tray) {
        tray.destroy();
        tray = null;
        // A launcher hidden to the tray would be unreachable without it.
        if (launcherWin && !launcherWin.isVisible()) showLauncher();
    }
}

// Shared by the main ST window and any tab it opens (e.g. Character Library).
// The preload runs in sub-frames too so userscripts reach embedded iframes.
function stWebPreferences() {
    return {
        preload: path.join(__dirname, 'st-preload.js'),
        nodeIntegrationInSubFrames: true,
        contextIsolation: true,
        nodeIntegration: false,
        // Like a browser tab: a minimized, covered or inactive tab stops
        // drawing. Off, an animated background kept the GPU busy behind
        // other windows. (GM_openInTab helper windows set their own.)
        backgroundThrottling: true,
    };
}

// Only web and mail links go to the system. Anything else (file:, custom
// app protocols) could start a program, so it is dropped.
function openExternalSafe(url) {
    try {
        if (['http:', 'https:', 'mailto:'].includes(new URL(url).protocol)) shell.openExternal(url);
        else logLine(`Blocked a link to ${url.slice(0, 120)}: only web links open outside SillyTavern.`);
    } catch { /* not a URL */ }
}

function isLocal(url) {
    try {
        const u = new URL(url);
        return u.hostname === settings.host || u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]';
    } catch { return false; }
}

// A remote SillyTavern's pages stay on its own address; local ones on this PC.
// Web tabs (the Chrome Web Store, pages Chrome extensions open) may show any website.
const insideOf = instance => url => {
    if (instance?.anyWeb) return /^(https?|chrome-extension):/i.test(url);
    if (!instance?.origin) return isLocal(url);
    try { return new URL(url).origin === instance.origin; } catch { return false; }
};

// --- ST-specialized browser behavior ---
// Keeps a page on the local server; external links go to the real browser.
// host: the StWindow the page lives in, which takes new pages as tabs.
// instance: the SillyTavern the page belongs to; pages it opens stay in it.
function lockToServer(wc, host, instance) {
    // Desktop extensions and Chrome extensions belong to SillyTavern pages;
    // web tabs (other websites) get neither the page scripts nor a session of their own.
    if (!instance.anyWeb) {
        ext.attachPage(wc);
        crx.attachSession(wc.session, instance.webPreferences?.partition || '');
    }
    attachPageMenu(wc, host, instance);
    useSpellLanguage(wc.session);
    if (!instance.anyWeb) wc.on('did-finish-load', () => stLanguageTo(wc, instance, true));
    const inside = insideOf(instance);
    wc.on('will-navigate', (e, url) => { if (!inside(url)) { e.preventDefault(); openExternalSafe(url); } });
    wc.setWindowOpenHandler(({ url, disposition }) => {
        // about:blank is how extensions open a tab and fill it in afterwards.
        if (!inside(url) && url !== 'about:blank') {
            openExternalSafe(url);
            return { action: 'deny' };
        }
        const allow = { action: 'allow', overrideBrowserWindowOptions: { icon: path.join(__dirname, 'icon.ico'), autoHideMenuBar: true, webPreferences: instance.webPreferences } };
        // Real popups (window.open with a size) stay windows, as in a browser.
        // The window the tab is in now (tabs can be dragged to other windows).
        const owner = host && (windowOf(wc) || host);
        if (settings.tabs && owner && !owner.isDestroyed() && disposition !== 'new-window') {
            allow.createWindow = options => owner.adoptTab(options, { background: disposition === 'background-tab', instance });
            // Electron closes opened pages with their opener; tabs shouldn't
            // vanish when the tab that opened them is closed.
            allow.outlivesOpener = true;
        }
        return allow;
    });
    wc.on('did-create-window', child => { child.setMenu(null); lockToServer(child.webContents, null, instance); });
}

// Right-click menu of a SillyTavern page. Links and images of the same
// SillyTavern open as tabs of its window (a popup's: the first window).
function attachPageMenu(wc, host, instance) {
    cm.attach(wc, {
        inside: insideOf(instance),
        openTab: url => {
            const own = windowOf(wc) || host;
            const w = own && !own.isDestroyed() ? own : [...stWins].find(x => !x.isDestroyed());
            if (w) { w.openUrl(url, instance); w.focus(); }
        },
        openExternal: openExternalSafe,
        search: () => settings.searchEngine,
        inspect: () => settings.inspectMenu,
        extra: (p, page) => [...ext.contextItems(p, page), ...crx.contextItems(page, p)],
    });
}

// ---------- web tabs and Chrome extensions (chromeext.js) ----------
// A tab for a website: the Chrome Web Store, or a page a Chrome extension
// opens (its options, its sign-in). In the extension's session, so the
// extension sees it; without SillyTavern's preload or desktop extensions.
const webInsts = new Map();
function webInstance(partition = '') {
    if (!webInsts.has(partition)) {
        webInsts.set(partition, {
            kind: 'web', anyWeb: true, url: crx.STORE_URL, chip: 'web',
            tip: t('A website (the Chrome Web Store or a page a Chrome extension opened)'), info: t('Website'),
            webPreferences: { ...(partition ? { partition } : {}), contextIsolation: true, nodeIntegration: false },
        });
    }
    return webInsts.get(partition);
}
const firstStWin = () => [...stWins].find(w => !w.isDestroyed());
function openWebTab(url, partition = '', { windowId, focus = true } = {}) {
    const inst = webInstance(partition);
    let w = [...stWins].find(x => !x.isDestroyed() && x.win.id === windowId) || [...stWins].find(x => !x.isDestroyed() && x.win.isFocused()) || firstStWin();
    if (!w) {
        w = createStWindow({ ...inst, url });
        return w.active;
    }
    const tab = w.openUrl(url, inst);
    if (focus) w.focus();
    return tab;
}
function openChromeStore() { openWebTab(crx.STORE_URL); }

function initChrome() {
    return crx.initChromeExtensions({
        userData: USER_DATA, logLine,
        settings: () => settings,
        saveSettings: () => saveSettings(settings),
        createTab: (url, { partition, active, windowId }) => {
            const tab = openWebTab(url || crx.STORE_URL, partition, { windowId, focus: active });
            return [tab.view.webContents, windowOf(tab.view.webContents).win];
        },
        createWindow: (url, partition) => createStWindow({ ...webInstance(partition), url }).win,
        // Like Chrome's tabs.update({ active }): switches the tab, doesn't pull the window to the front.
        selectTab: wc => { const w = windowOf(wc); if (w) w.activate(w.tabById(wc.id)); },
        closeTab: wc => { const w = windowOf(wc); w?.closeTab(w.tabById(wc.id)); },
        confirmInstall: confirmChromeInstall,
        changed: () => { broadcast('chrome-ext'); stWins.forEach(w => w.push()); },
    });
}

async function confirmChromeInstall({ name, manifest, icon }) {
    const d = crx.describe(manifest);
    const lines = [
        d.everySite ? t('It can read and change every page you open in SillyTavern, including what you type in chats.') : t('It can read and change the pages it was made for.'),
        t('Chrome extensions only partly work in apps like this one: some features may be missing.'),
    ];
    if (d.missing.length) lines.push(t('Not available here: {list}.', { list: d.missing.join(', ') }));
    // No parent window: with the SillyTavern window as parent the box
    // sometimes never appeared (and the store's install waited forever).
    const opts = {
        type: 'question', buttons: [t('Add extension'), t('Cancel')], defaultId: 0, cancelId: 1, noLink: true,
        title: t('Add Chrome extension'), message: t('Add "{name}"?', { name }), detail: lines.join('\n\n'),
        ...(icon && !icon.isEmpty() ? { icon: icon.resize({ width: 48, height: 48 }) } : {}),
    };
    try {
        const { response } = await dialog.showMessageBox(opts);
        return response === 0;
    } catch (err) {
        logLine(`ERROR: could not ask about the Chrome extension "${name}": ${err.message}`);
        return false;
    }
}

// The launcher: only its text fields get a menu (cut, copy, paste).
function attachLauncherMenu(wc) {
    wc.on('context-menu', (_e, p) => {
        if (!p.isEditable && !p.selectionText?.trim()) return;
        const items = cm.build(wc, { ...p, linkURL: '', mediaType: 'none' }, { openExternal: openExternalSafe, inspect: () => settings.inspectMenu });
        if (items.length) Menu.buildFromTemplate(items).popup({ window: launcherWin });
    });
}

// ---------- SillyTavern instances ----------
// What a tab or window shows: the main server, a read-only view of it, the
// same folder on another port, or another install. `chip` goes after the
// tab's title, `info` in the bar for the active tab, `tip` on hover.
const sameDir = (a, b) => !!a && !!b && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const versionText = d => [d.version, d.branch].filter(Boolean).join(' ');
let mainInst = null;
let readOnlyInst = null;

function mainInstance() {
    const url = mainUrl();
    if (!mainInst || mainInst.url !== url) mainInst = { kind: 'main', url, webPreferences: stWebPreferences() };
    const d = instances.describe(stRoot());
    const name = prof.active(settings)?.name;
    return Object.assign(mainInst, {
        chip: `:${settings.port}`,
        tip: `${name ? `${name}: ` : ''}${t('SillyTavern {version} on port {port}', { version: versionText(d), port: String(settings.port) })}`,
        info: `${name ? `${name} · ` : ''}${versionText(d)} · :${settings.port}`,
    });
}

// Same server, but every save, delete and send is blocked (see instances.js).
function readOnlyInstance() {
    instances.readOnlySession();
    const d = instances.describe(stRoot());
    readOnlyInst ||= { kind: 'readonly', readOnly: true, webPreferences: { ...stWebPreferences(), partition: instances.READ_ONLY_PARTITION } };
    return Object.assign(readOnlyInst, {
        url: mainInstance().url,
        chip: `${t('read-only')} :${settings.port}`,
        tip: t('Read-only SillyTavern {version} on port {port} (nothing is saved or sent)', { version: d.version, port: String(settings.port) }),
        info: `${t('READ-ONLY')} · ${d.version} · :${settings.port}`,
    });
}

// A second server: this install on another port, or another install.
async function extraInstance(dir, kind) {
    const port = await instances.freePort(settings.port + 1, [settings.port]);
    const d = instances.describe(dir);
    const second = kind === 'port';
    // Another install is named by its profile (if it has one) in the tip and the bar.
    const name = second ? '' : settings.profiles.find(p => prof.sameDir(p.path, dir))?.name || '';
    const srv = instances.startServer(dir, port, second ? 'second server' : name || `SillyTavern ${d.version}`);
    const inst = {
        kind, server: srv,
        url: `http://${settings.host}:${port}/`,
        webPreferences: { ...stWebPreferences(), partition: instances.partitionFor(dir) },
        chip: second ? `:${port} · ${t('2nd')}` : `${d.version} :${port}`,
        tip: second ? t('SillyTavern {version} on port {port} (second server, same folder)', { version: versionText(d), port: String(port) }) : `${name ? `${name}: ` : ''}${t('SillyTavern {version} on port {port}', { version: versionText(d), port: String(port) })} (${dir})`,
        info: second ? `${versionText(d)} · :${port} · ${t('2nd server')}` : `${name ? `${name} · ` : ''}${versionText(d)} · :${port} · ${dir}`,
        onUnused: () => instances.stopServer(srv),
    };
    // Tabs of a server that stopped (or crashed) would only show an error.
    srv.child.once('exit', () => stWins.forEach(w => w.closeTabsOf(inst)));
    return inst;
}

// SillyTavern on another computer. Its own lasting browser session per
// entry: a login there stays, and nothing mixes with this PC's SillyTavern.
const remoteInsts = new Map();
function remoteInstance(r) {
    const u = new URL(r.url);
    const inst = remoteInsts.get(r.id) || { kind: 'remote', remoteId: r.id, webPreferences: { ...stWebPreferences(), partition: `persist:remote-${r.id}` } };
    remoteInsts.set(r.id, inst);
    return Object.assign(inst, {
        url: r.url, origin: u.origin,
        // The chip stays short (tab titles need the room); the bar's info has the address.
        chip: r.name.length > 14 ? `${r.name.slice(0, 13)}…` : r.name,
        tip: `${r.name}: ${t('SillyTavern at {host}', { host: u.host })}`, info: `${r.name} · ${u.host}`,
    });
}

async function openRemote(id, from) {
    const r = remote.get(settings, id);
    if (!r) return false;
    if (remote.insecure(r.url) && !r.httpOk) {
        const { response, checkboxChecked } = await dialog.showMessageBox({
            type: 'warning', buttons: [t('Open anyway'), t('Cancel')], defaultId: 1, cancelId: 1,
            message: t('"{name}" uses plain http outside your home network.', { name: r.name }),
            detail: `${r.url}\n\n${t('Your password and everything you write travel unencrypted, so others on the way could read them. Use an https address, or a private network such as Tailscale, if you can.')}`,
            checkboxLabel: t('Don\'t warn again for this one'),
        });
        if (response !== 0) return false;
        if (checkboxChecked) { r.httpOk = true; saveSettings(settings); }
    }
    logLine(`Opening "${r.name}" (${new URL(r.url).host}).`);
    openInstance(remoteInstance(r), from);
    return true;
}
const remoteMenuItems = from => remote.list(settings).map(r => ({ label: menuText(`${r.name} — ${new URL(r.url).host}`), click: () => openRemote(r.id, from) }));

// In the window it was asked from as a tab, or in a window of its own.
function openInstance(inst, from) {
    const w = from && !from.isDestroyed() ? from : [...stWins][0];
    if (settings.tabs && w) { w.newTab(inst); w.focus(); }
    else createStWindow(inst);
}

async function openSecondServer(from) {
    if (settings.warnSecondServer) {
        const { response, checkboxChecked } = await dialog.showMessageBox({
            type: 'warning', buttons: [t('Start second server'), t('Cancel')], defaultId: 0, cancelId: 1,
            message: t('Run a second server on the same SillyTavern folder?'),
            detail: t('Both servers use the same chats, characters, presets and settings. If you change the same thing in both, the one that saves last wins. To only look at presets or chats, a read-only copy is safer.'),
            checkboxLabel: t("Don't show this again"),
        });
        if (response !== 0) return;
        if (checkboxChecked) { settings.warnSecondServer = false; saveSettings(settings); }
    }
    openExtra(stRoot(), 'port', from);
}

function openExtra(dir, kind, from) {
    extraInstance(dir, kind).then(inst => openInstance(inst, from), e => logLine(`ERROR: could not start SillyTavern from ${dir}: ${e.message}`));
}

// Other installs for the New SillyTavern menu. Found in the background:
// the search looks at every drive, and menus are built synchronously.
let otherInstalls = [];
function refreshInstalls() {
    setTimeout(() => { otherInstalls = setup.detectInstalls(exeBases()).filter(i => !sameDir(i.path, stRoot())); }, 0);
}

function newSillyTavernMenu(w) {
    const where = settings.tabs ? 'tab' : 'window';
    refreshInstalls();
    const others = otherFolders();
    return [
        { label: settings.tabs ? t('Another tab of this SillyTavern') : t('Another window of this SillyTavern'), accelerator: settings.tabs ? 'Ctrl+T' : undefined, registerAccelerator: false, click: () => openInstance(mainInstance(), w) },
        { label: t('Read-only copy (browse without saving or sending)'), click: () => openInstance(readOnlyInstance(), w) },
        { label: t('This SillyTavern on another port'), click: () => openSecondServer(w) },
        { type: 'separator' },
        ...(others.length
            ? others.map(o => ({ label: menuText(o.label), click: () => openExtra(o.path, 'other', w) }))
            : [{ label: t('No other SillyTavern installs found'), enabled: false }]),
        ...(settings.remotes.length ? [{ type: 'separator' }, { label: t('On other computers'), enabled: false }, ...remoteMenuItems(w)] : []),
        { type: 'separator' },
        { label: t('Chrome Web Store (add Chrome extensions)'), click: openChromeStore },
    ];
}

// "&" marks a keyboard shortcut in Windows menus; "&&" shows one.
const menuText = s => s.replace(/&/g, '&&');

// Other SillyTavern folders to open next to this one: profiles first (by
// name), then installs found on this PC that have no profile.
function otherFolders() {
    const named = settings.profiles
        .filter(p => !prof.sameDir(p.path, stRoot()) && setup.isStRoot(p.path))
        .map(p => ({ path: p.path, label: `${p.name} — SillyTavern ${instances.describe(p.path).version}` }));
    const unnamed = otherInstalls
        .filter(i => !settings.profiles.some(p => prof.sameDir(p.path, i.path)))
        .map(i => ({ path: i.path, label: `SillyTavern ${i.version} — ${i.path}` }));
    return [...named, ...unnamed];
}

// Pick the SillyTavern the app runs: tray menu and the window's menu.
function profileMenu() {
    return settings.profiles.map(p => ({
        label: menuText(p.name), type: 'radio', checked: prof.sameDir(p.path, stRoot()),
        enabled: !busyTask && setup.isStRoot(p.path), click: () => useProfile(p.id),
    }));
}

function openSillyTavernWindow() {
    const wins = [...stWins];
    const w = wins.find(x => x.tabs.some(t => t.instance.kind === 'main'));
    // Only other SillyTavern open (a remote one, a read-only copy): add this PC's as a tab.
    if (!w && wins.length) { openInstance(mainInstance(), wins[0]); return; }
    if (w) {
        // Minimized together from the launcher, so restored together too.
        wins.forEach(x => { if (x !== w && x.win.isMinimized()) x.win.restore(); });
        w.focus();
        return;
    }
    createStWindow(mainInstance());
}

// extra: { tab, x, y } for a tab dragged out of another window.
function createStWindow(instance, extra = {}) {
    const w = new StWindow({
        instance,
        ...extra,
        width: extra.width ?? settings.windowWidth,
        height: extra.height ?? settings.windowHeight,
        fullScreen: extra.tab ? false : settings.windowFullScreen,
        layer: settings.windowLayer,
        colors: themes.get(settings.theme).colors,
        font: () => themes.uiFontCss(settings.uiFont),
        icon: path.join(__dirname, 'icon.ico'),
        setupPage: lockToServer,
        tabsEnabled: () => settings.tabs,
        menu: stWindowMenu,
        newMenu: newSillyTavernMenu,
        detach: detachTab,
        tabHook: (event, tab, w) => {
            const wc = tab.view.webContents;
            if (event === 'bound') crx.tabAdded(wc, w.win);
            else if (event === 'activated') crx.tabSelected(wc);
            else if (event === 'releasing') crx.tabMoving(wc);
        },
        chromePartition: wc => crx.partitionForBar(wc),
        // Remember size and full screen — saved once on close, not on every resize
        // (not from windows made for a dragged-out tab)
        onClose: ({ width, height, fullScreen }) => {
            if (extra.tab) return;
            Object.assign(settings, { windowWidth: width, windowHeight: height, windowFullScreen: fullScreen });
            saveSettings(settings);
        },
    });
    stWins.add(w);
    w.win.on('minimize', pushWindowState);
    w.win.on('restore', pushWindowState);
    w.win.on('closed', () => { stWins.delete(w); pushWindowState(); });
    pushWindowState();
    return w;
}

// A tab dragged out of a window's tab strip (at = screen point, or null from
// the tab's menu): onto another SillyTavern window's tabs, or into a new
// window there. The page moves as it is, nothing reloads.
function detachTab(from, tab, at) {
    const target = at && [...stWins].find(o => o !== from && !o.isDestroyed() && o.barContains(at));
    if (target) {
        from.releaseTab(tab);
        target.takeTab(tab);
        return;
    }
    if (from.tabs.length < 2) return; // already alone in its window
    const b = from.win.getNormalBounds();
    const wa = screen.getDisplayNearestPoint(at || { x: b.x, y: b.y }).workArea;
    // At most 80% of the screen (the source may be maximized), all of it on screen.
    const width = Math.min(b.width, Math.round(wa.width * 0.8));
    const height = Math.min(b.height, Math.round(wa.height * 0.8));
    const pos = at ? { x: at.x - 120, y: at.y - 16 } : { x: b.x + 32, y: b.y + 32 };
    pos.x = Math.max(wa.x, Math.min(pos.x, wa.x + wa.width - width));
    pos.y = Math.max(wa.y, Math.min(pos.y, wa.y + wa.height - height));
    from.releaseTab(tab);
    createStWindow(tab.instance, { tab, width, height, ...pos });
}

// What the launcher's Home shows: Open, Show or Restore, and Minimize.
function stWindowState() {
    const wins = [...stWins].filter(w => !w.isDestroyed());
    return { open: wins.length, minimized: wins.length > 0 && wins.every(w => w.win.isMinimized()) };
}
function pushWindowState() {
    if (launcherWin && !launcherWin.isDestroyed()) launcherWin.webContents.send('st-windows', stWindowState());
}
function minimizeStWindows() {
    stWins.forEach(w => { if (!w.isDestroyed()) w.win.minimize(); });
}

// Right-click menu of the SillyTavern window's top bar.
function stWindowMenu(w) {
    const layerItem = (mode, label) => ({
        label, type: 'radio', checked: w.layer === mode, layerItem: true, click: () => setLayer(mode),
    });
    return [
        layerItem('normal', t('Normal window (default)')),
        layerItem('top', t('Always on top')),
        layerItem('bottom', t('Stay in background')),
        { type: 'separator' },
        { label: t('Full screen'), type: 'checkbox', checked: w.fullScreen, accelerator: 'F11', registerAccelerator: false, click: () => w.toggleFullScreen() },
        { label: t('Reload'), accelerator: 'F5', registerAccelerator: false, click: () => w.reload() },
        { type: 'separator' },
        { label: t('New SillyTavern'), submenu: newSillyTavernMenu(w) },
        ...(settings.profiles.length > 1 ? [{ label: t('Switch profile'), submenu: profileMenu() }] : []),
        ...(ext.menuItems().length ? [{ label: t('Extensions'), submenu: ext.menuItems() }] : []),
        { label: t('Open new pages as tabs'), type: 'checkbox', checked: settings.tabs, click: () => setTabs(!settings.tabs) },
        { label: `${t('Language')} (Language)`, submenu: languageMenu() },
        { type: 'separator' },
        { label: t('Show launcher'), click: showLauncher },
    ];
}

function setTabs(on) {
    settings.tabs = !!on;
    saveSettings(settings);
    stWins.forEach(w => w.push());
    broadcast('settings', publicSettings());
}

function setLayer(mode) {
    if (!LAYERS.includes(mode)) return;
    settings.windowLayer = mode;
    saveSettings(settings);
    stWins.forEach(w => w.setLayer(mode));
    broadcast('settings', publicSettings());
}

function showLauncher() {
    if (!launcherWin) return createLauncherWindow();
    if (launcherWin.isMinimized()) launcherWin.restore();
    launcherWin.show();
    launcherWin.focus();
}

// ---------- IPC ----------
// Fixed lists: the renderer names a place or link, never passes a raw path or URL.
const PLACES = {
    st: () => stRoot(),
    data: () => path.join(stRoot(), 'data'),
    characters: () => path.join(stRoot(), 'data', 'default-user', 'characters'),
    chats: () => path.join(stRoot(), 'data', 'default-user', 'chats'),
    extensions: () => path.join(stRoot(), 'data', 'default-user', 'extensions'),
    backups: () => mx.backupsDir(stRoot()),
    userscripts: () => userscriptsDir,
    desktopExtensions: () => ext.extensionsDir(),
    config: () => path.join(stRoot(), 'config.yaml'),
    logs: () => USER_DATA,
};
const LINKS = {
    docs: 'https://docs.sillytavern.app/',
    discord: 'https://discord.gg/sillytavern',
    reddit: 'https://www.reddit.com/r/SillyTavernAI/',
    github: 'https://github.com/SillyTavern/SillyTavern',
    releases: 'https://github.com/SillyTavern/SillyTavern/releases',
    node: 'https://nodejs.org/en/download',
    git: 'https://git-scm.com/downloads',
    desktop: 'https://github.com/Lab-Fox/sillytavern-desktop',
    // The release on offer (a preview isn't on GitHub's "latest" page), else the latest.
    desktopReleases: () => appUpdate.releasePage(),
    extensionDocs: 'https://github.com/Lab-Fox/sillytavern-desktop/blob/main/EXTENSIONS.md',
    addonRepo: 'https://github.com/Lab-Fox/sillytavern-desktop-extensions',
    translate: 'https://github.com/Lab-Fox/sillytavern-desktop/blob/main/locales/README.md',
    issues: 'https://github.com/Lab-Fox/sillytavern-desktop/issues',
    stIssues: 'https://github.com/SillyTavern/SillyTavern/issues',
    remoteDocs: 'https://docs.sillytavern.app/usage/remoteconnections/',
    tailscale: 'https://tailscale.com/download/windows',
};

ipcMain.handle('get-state', () => ({
    running: serverState.running,
    attached: serverState.attached,
    startedAt: serverState.startedAt,
    busy: busyTask,
    url: mainUrl(),
    settings: publicSettings(),
    logs: serverState.logs,
    appVersion: app.getVersion(),
    windows: stWindowState(),
}));
ipcMain.handle('start-server', () => startAndOpen());
ipcMain.handle('stop-server', () => stopServer());
ipcMain.handle('open-st', () => {
    if (serverState.running) { openSillyTavernWindow(); return; }
    return startAndOpen();
});
ipcMain.handle('minimize-st', () => minimizeStWindows());

// ---------- fallbacks: SillyTavern without this app's window ----------
// For when a new SillyTavern version doesn't work inside the app yet.
ipcMain.handle('open-in-browser', async () => {
    if (!serverState.running) await startServer();
    for (let i = 0; i < 120 && serverState.running; i++) {
        if (await checkPortOpen()) {
            logLine(`Opening ${mainInstance().url} in your browser.`);
            openExternalSafe(mainInstance().url);
            return true;
        }
        await new Promise(r => setTimeout(r, 1000));
    }
    return false;
});

// SillyTavern's own Start.bat in a console window of its own, with nothing
// of this app in between. This app's servers on that folder stop first:
// they hold the port and the files.
ipcMain.handle('start-classic', async () => {
    const root = stRoot();
    if (!setup.isStRoot(root)) return false;
    if (busyTask) { logLine(`Busy with "${busyTask}" — wait for it to finish.`); return false; }
    const bat = fs.existsSync(path.join(root, 'Start.bat'));
    if (!(await confirm(t('Start SillyTavern the classic way?'),
        `${t('{what} runs in a command window of its own, without this app.', { what: bat ? 'Start.bat' : 'node server.js' })}${serverState.running ? ` ${t('This app\'s server stops first.')}` : ''}\n\n${t('Open SillyTavern in your browser once it says it is listening (or use "Open in browser" here). Close the command window to stop it.')}`,
        t('Start')))) return false;
    await instances.stopAll(root);
    if (serverState.running && !(await stopServerAndWait())) return false;
    const env = { ...process.env };
    for (const k of Object.keys(env)) if (/^(ELECTRON_|PORTABLE_EXECUTABLE)/.test(k)) delete env[k];
    const run = bat ? '"Start.bat"' : 'cmd /k node server.js';
    const child = spawn('cmd.exe', ['/d', '/s', '/c', `"start "SillyTavern" /D "${root}" ${run}"`], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true, env });
    child.on('error', e => logLine(`ERROR: could not start SillyTavern: ${e.message}`));
    child.unref();
    logLine(`Started SillyTavern the classic way (${bat ? 'Start.bat' : 'node server.js'}) in its own window. Close that window to stop it.`);
    return true;
});
ipcMain.handle('st-info', () => mx.getInfo(stRoot()));
ipcMain.handle('check-updates', () => mx.checkForUpdates(stRoot()));

// ---------- change history ("What's new") ----------
// Runs a task that changes SillyTavern's files and records what came in.
async function tracked(kind, fn) {
    const dir = stRoot();
    const before = await mx.getInfo(dir);
    const ok = await fn();
    const after = await mx.getInfo(dir);
    if (after.commit && after.commit !== before.commit) {
        const e = await hist.record(kind, dir, before, after);
        if (e) logLine(`What's new: ${describeChange(e)}. Home shows the details.`);
        broadcast('history');
    }
    return ok;
}
function describeChange(e) {
    const v = x => x.version + (x.branch ? ` (${x.branch})` : '');
    const n = e.commitCount ? `${e.commitCount} change${e.commitCount === 1 ? '' : 's'}` : '';
    if (e.kind === 'download') return `downloaded SillyTavern ${v(e.to)}`;
    if (v(e.from) !== v(e.to)) return `SillyTavern ${v(e.from)} → ${v(e.to)}${n ? `, ${n}` : ''}`;
    return `SillyTavern ${v(e.to)}: ${n || 'changed'}`;
}
// Updated outside the app (git pull by hand, SillyTavern's own updater)?
async function checkOutsideChanges(dir = stRoot()) {
    if (!setup.isStRoot(dir)) return;
    const e = await hist.checkOutside(dir, await mx.getInfo(dir));
    if (e) { logLine(`SillyTavern changed since this app last saw it: ${describeChange(e)}.`); broadcast('history'); }
}
ipcMain.handle('history', (_e, id) => {
    const p = id ? settings.profiles.find(x => x.id === id) : prof.active(settings);
    return p ? { profile: { id: p.id, name: p.name, path: p.path }, entries: hist.forPath(p.path) } : { entries: [] };
});
ipcMain.handle('history-unseen', () => (setup.isStRoot(stRoot()) ? hist.unseen(stRoot()) : null));
ipcMain.handle('history-seen', (_e, id) => { hist.markSeen(String(id)); });
// Before updating: what an update would bring (after Check for updates).
ipcMain.handle('st-incoming', async () => {
    const dir = stRoot();
    const log = await mx.git(dir, ['log', '--no-merges', '--max-count=300', '--format=%h%x09%cs%x09%s', 'HEAD..@{u}'], { quiet: true });
    const commits = log.code !== 0 ? [] : hist.parseLog(log.out);
    let version = '';
    const pkg = await mx.git(dir, ['show', '@{u}:package.json'], { quiet: true });
    try { version = JSON.parse(pkg.out).version || ''; } catch { /* no upstream */ }
    return { from: instances.describe(dir).version, to: version, commits };
});
ipcMain.handle('update', () => runTask(t('Updating SillyTavern'), () => tracked('update', () => mx.update(stRoot(), { backupFirst: settings.backupBeforeUpdate, keep: keep() }))));
ipcMain.handle('repair', async (_e, kind) => {
    const labels = { deps: t('Installing dependencies'), 'clean-deps': t('Reinstalling dependencies'), 'reset-lock': t('Resetting package-lock.json') };
    if (!labels[kind]) return false;
    if (kind === 'clean-deps' && !(await confirm(t('Reinstall all dependencies?'), t('Deletes SillyTavern\'s node_modules folder and downloads everything again. Your chats and characters are not touched. Takes a few minutes.'), t('Reinstall')))) return false;
    return runTask(labels[kind], () => mx.repair(stRoot(), kind));
});
ipcMain.handle('switch-branch', async (_e, branch) => {
    const about = branch === 'staging'
        ? t('Staging gets new features first but can be unstable.')
        : t('Release is the stable version most people use.');
    const backup = settings.backupBeforeUpdate
        ? t('Your data is backed up before switching.')
        : t('No backup is made first ("Back up before updating" is off in Settings).');
    if (!(await confirm(t('Switch SillyTavern to {branch}?', { branch }), `${about} ${backup}`, t('Switch')))) return false;
    return runTask(t('Switching to {branch}', { branch }), () => tracked('branch', () => mx.switchBranch(stRoot(), branch, { backupFirst: settings.backupBeforeUpdate, keep: keep() })));
});
ipcMain.handle('backup', () => runTask(t('Backing up'), async () => !!(await mx.createBackup(stRoot(), 'manual', keep())), { needsStopped: false }));
// Backups live in backups/desktop, and scheduled ones maybe in the folder chosen for them.
const activeProfile = () => prof.list(settings).find(p => p.active) || { name: path.basename(stRoot() || 'SillyTavern'), path: stRoot() };
function backupDirs() {
    const dirs = { local: mx.backupsDir(stRoot()) };
    if (settings.backupScheduleDir) {
        const ext = bs.destFor(activeProfile());
        if (path.resolve(ext).toLowerCase() !== path.resolve(dirs.local).toLowerCase()) dirs.elsewhere = ext;
    }
    return dirs;
}
ipcMain.handle('list-backups', () => {
    const dirs = backupDirs();
    return Object.entries(dirs).flatMap(([where, dir]) => mx.listBackups(stRoot(), dir).map(b => ({ ...b, where, dir })))
        .sort((a, b) => b.mtime - a.mtime);
});
// `where` names one of backupDirs(): the launcher never passes a folder.
ipcMain.handle('restore-backup', async (_e, name, where = 'local') => {
    const dir = backupDirs()[where];
    if (!dir) return false;
    if (!(await confirm(t('Restore this backup?'), `${name}\n\n${t('Your current data folder is moved to backups/desktop first, so nothing is lost. The server restarts afterwards.')}`, t('Restore')))) return false;
    return runTask(t('Restoring backup'), () => mx.restoreBackup(stRoot(), name, dir));
});
ipcMain.handle('delete-backup', async (_e, name, where = 'local') => {
    const dir = backupDirs()[where];
    if (!dir) return false;
    if (!(await confirm(t('Delete this backup permanently?'), name, t('Delete')))) return false;
    const ok = mx.deleteBackup(stRoot(), name, dir);
    broadcast('refresh');
    return ok;
});
// ---------- scheduled backups ----------
const scheduleTargets = () => prof.list(settings).filter(p => p.ok && (settings.backupScheduleScope === 'all' || p.active));
ipcMain.handle('backup-schedule', () => bs.status());
ipcMain.handle('backup-schedule-save', (_e, o = {}) => {
    if (bs.MODES.includes(o.mode)) settings.backupSchedule = o.mode;
    if (['active', 'all'].includes(o.scope)) settings.backupScheduleScope = o.scope;
    if (o.keep !== undefined) settings.backupScheduleKeep = Math.min(100, Math.max(1, parseInt(o.keep, 10) || 7));
    if (o.clearDir) settings.backupScheduleDir = '';
    saveSettings(settings);
    broadcast('settings', publicSettings());
    return bs.status();
});
ipcMain.handle('backup-schedule-pick', async () => {
    const dir = await pickFolder('Where should scheduled backups go? (a folder per profile is made inside)', settings.backupScheduleDir || os.homedir());
    if (!dir) return bs.status();
    // Inside a SillyTavern folder they'd be zipped into each other (data/) or moved along with it.
    if (prof.list(settings).some(p => p.ok && (path.resolve(dir).toLowerCase() + path.sep).startsWith(path.resolve(p.path).toLowerCase() + path.sep))) {
        return { ...bs.status(), error: t('Pick a folder outside your SillyTavern folders, for example on another drive.') };
    }
    settings.backupScheduleDir = dir;
    saveSettings(settings);
    return bs.status();
});
ipcMain.handle('backup-schedule-run', () => bs.runDue({ now: true }));
ipcMain.handle('backup-schedule-dismiss', (_e, dir) => { bs.dismiss(String(dir || '')); return bs.status(); });
ipcMain.handle('open-backup-dest', () => {
    const d = settings.backupScheduleDir;
    if (d && fs.existsSync(d)) shell.openPath(d);
});
// ---------- SillyTavern extensions: ratings, update review, undo, Kits, installing ----------
// Installed extensions with their safety rating (when the catalog is loaded)
// and what can be undone.
ipcMain.handle('list-extensions', async (_e, fetch) => {
    const exts = await mx.listExtensions(stRoot(), { fetch: !!fetch });
    for (const x of exts) x.rating = x.remote ? sx.rate(x) : null;
    return { exts, undo: await sx.undoInfo(stRoot(), exts), catalog: sx.catalogInfo() };
});
ipcMain.handle('ext-catalog', async (_e, fresh) => {
    const r = await sx.loadCatalog({ fresh: !!fresh });
    if (!r.ok) logLine(`Could not load the extension catalog: ${r.error}`);
    return { ok: r.ok, error: r.error || '', stale: r.stale || '', info: sx.catalogInfo() };
});
// paths: the extensions the user kept ticked in the review.
ipcMain.handle('update-extensions', (_e, paths) => runTask(t('Updating extensions'), async () => {
    let snap = null;
    const n = await mx.updateExtensions(stRoot(), { only: Array.isArray(paths) ? paths.map(String) : null, before: async exts => { snap = await sx.snapshotBefore(stRoot(), exts); } });
    if (snap && await sx.snapshotAfter(snap)) logLine('The versions from before this update were remembered: Extensions → Undo last update puts them back.');
    return n;
}, { needsStopped: false }));
ipcMain.handle('ext-undo', (_e, onlyPath) => runTask(t('Undoing extension updates'), () => sx.undo(stRoot(), onlyPath ? String(onlyPath) : null), { needsStopped: false }));
// After installing, updating or going back: open SillyTavern pages load the new code.
ipcMain.handle('reload-st', () => { stWins.forEach(w => w.reloadAll(onThisPc)); return stWins.size; });
// Project pages and scan reports from the catalog: web links only.
ipcMain.handle('open-url', (_e, url) => { if (/^https:\/\//i.test(String(url))) openExternalSafe(String(url)); });

// The first install from the app says what extensions are (once, unless asked again).
async function installNotice() {
    if (settings.extInstallNoticeSeen) return true;
    const { response, checkboxChecked } = await dialog.showMessageBox(launcherWin, {
        type: 'warning', buttons: [t('I understand, continue'), t('Cancel')], defaultId: 0, cancelId: 1,
        message: t('Extensions run code inside SillyTavern'),
        detail: t('An extension can read your chats, characters and settings, and talk to other websites. A safety rating is information about one version, not a guarantee. Install only extensions you trust, and read their page first.'),
        checkboxLabel: t("Don't show this again"),
    });
    if (response !== 0) return false;
    if (checkboxChecked) { settings.extInstallNoticeSeen = true; saveSettings(settings); }
    return true;
}
const installedSet = () => new Set(mx.installedRemotes(stRoot()).map(i => sx.normUrl(i.remote)).filter(Boolean));
// Several at once (a Kit) or one (from the catalog). items: [{ url, scope, commit, name, branch }]
async function installMany(label, items) {
    if (busyTask) return { error: t('Busy with "{task}" — wait for it to finish.', { task: busyTask }) };
    if (!setup.isStRoot(stRoot())) return { error: t('Choose your SillyTavern first.') };
    if (!(await installNotice())) return { canceled: true };
    const results = [];
    await runTask(label, async () => {
        for (const it of items) {
            const scope = it.scope === 'all users' ? 'all users' : 'default-user';
            results.push({ name: it.name, ...(await sx.install(stRoot(), { ...it, scope })) });
        }
        const ok = results.filter(r => r.ok).length;
        for (const r of results.filter(x => x.error)) logLine(`ERROR: ${r.error}`);
        logLine(`Installed ${ok} of ${items.length} extension${items.length === 1 ? '' : 's'}.${ok ? ' Reload SillyTavern to use them.' : ''}`);
        return ok > 0;
    }, { needsStopped: false });
    return { results, installed: results.filter(r => r.ok).length };
}
ipcMain.handle('ext-search', (_e, q) => {
    const have = installedSet();
    return sx.search(String(q || '')).map(e => ({ ...e, installed: have.has(sx.normUrl(e.url)) }));
});
ipcMain.handle('ext-install', (_e, id) => {
    const e = sx.catalogEntry(String(id));
    if (!e) return { error: t('That extension is not in the catalog anymore.') };
    if (installedSet().has(sx.normUrl(e.url))) return { error: t('{name} is already installed.', { name: e.name }) };
    return installMany(`Installing ${e.name}`, [{ url: e.repo.replace(/\.git$/, ''), branch: e.branch, name: e.name }]);
});

// Kits: saved sets of extensions, usable in every profile.
ipcMain.handle('kits', () => {
    const have = installedSet();
    return sx.kits().map(k => ({ ...k, extensions: k.extensions.map(x => ({ ...x, installed: have.has(sx.normUrl(x.url)), rating: sx.rate({ remote: x.url, head: x.commit }) })) }));
});
ipcMain.handle('kit-save', async (_e, name, description) => {
    const exts = (await mx.listExtensions(stRoot())).filter(x => x.isGit && x.remote);
    if (!exts.length) return { error: t('No extensions installed with Git, so there is nothing to save.') };
    try {
        const kit = sx.saveKit({ name, description, created: Date.now(), extensions: exts.map(x => ({ name: x.name, url: x.remote, scope: x.scope === 'all users' ? 'all users' : 'user', commit: x.head })) });
        logLine(`Saved the Kit "${kit.name}" (${kit.extensions.length} extensions).`);
        return { ok: true, kit };
    } catch (e) { return { error: e.message }; }
});
ipcMain.handle('kit-import', async () => {
    const r = await dialog.showOpenDialog(launcherWin, { title: t('Import a Kit'), filters: [{ name: 'Kit', extensions: ['json'] }], properties: ['openFile'] });
    if (r.canceled) return { canceled: true };
    try {
        if (fs.statSync(r.filePaths[0]).size > 1024 * 1024) throw new Error('That file is too large to be a Kit.');
        const kit = sx.saveKit(sx.readKitFile(r.filePaths[0]));
        logLine(`Imported the Kit "${kit.name}" (${kit.extensions.length} extensions).`);
        return { ok: true, kit };
    } catch (e) { return { error: e instanceof SyntaxError ? 'That file is not a Kit (invalid JSON).' : e.message }; }
});
ipcMain.handle('kit-export', async (_e, id) => {
    const json = sx.kitJson(String(id));
    if (!json) return false;
    const r = await dialog.showSaveDialog(launcherWin, { title: t('Export Kit'), defaultPath: `${String(id)}.kit.json`, filters: [{ name: 'Kit', extensions: ['json'] }] });
    if (r.canceled) return false;
    fs.writeFileSync(r.filePath, json);
    logLine(`Exported the Kit to ${r.filePath}.`);
    return true;
});
ipcMain.handle('kit-delete', async (_e, id) => {
    const kit = sx.kits().find(k => k.id === id);
    if (!kit || !(await confirm(t('Delete the Kit "{name}"?', { name: kit.name }), t('Only the saved list is deleted. Installed extensions stay.'), t('Delete')))) return false;
    return sx.deleteKit(String(id));
});
// urls: the missing extensions the user kept ticked; exact: the Kit's versions instead of the newest.
ipcMain.handle('kit-install', (_e, id, urls, exact) => {
    const kit = sx.kits().find(k => k.id === id);
    if (!kit) return { error: t('That Kit no longer exists.') };
    const have = installedSet();
    const want = new Set((Array.isArray(urls) ? urls : []).map(u => sx.normUrl(u)));
    const items = kit.extensions.filter(x => !have.has(sx.normUrl(x.url)) && want.has(sx.normUrl(x.url))).map(x => ({ ...x, commit: exact ? x.commit : '' }));
    if (!items.length) return { error: t('Nothing to install: those extensions are already there.') };
    return installMany(`Installing from the Kit "${kit.name}"`, items);
});

ipcMain.handle('health-check', async () => {
    const [checks, used, tr] = await Promise.all([mx.healthCheck(stRoot(), { running: serverState.running }), serverState.running ? null : pc.portUser(settings.port), mx.gitTrouble(stRoot())]);
    if (used) checks.push({ label: t('Port {port}', { port: String(settings.port) }), status: 'bad', detail: t('Used by {name} (PID {pid})', { name: used.name || '?', pid: String(used.pid) }), fix: t('SillyTavern can\'t start on it. Close that program, or pick another port under Troubleshooting.') });
    if (tr.stuck) checks.push({ label: t('Update stopped halfway'), status: 'bad', detail: tr.conflicts.length ? t('{n} file with conflicts|{n} files with conflicts', { n: tr.conflicts.length }) : t('A git merge or rebase is not finished'), fix: t('Troubleshooting → Repair SillyTavern\'s files.') });
    const vpn = pc.vpns();
    if (vpn.length) checks.push({ label: 'VPN', status: 'warn', detail: t('On: {list}', { list: vpn.join(', ') }), fix: t('A VPN can block phone access, the remote link or some AI services. If something can\'t connect, try with the VPN off.') });
    return checks;
});
ipcMain.handle('open-place', (_e, key) => {
    const p = PLACES[key]?.();
    if (!p) return;
    if (key !== 'config') fs.mkdirSync(p, { recursive: true });
    return shell.openPath(p);
});
ipcMain.handle('open-link', (_e, key) => {
    const link = Object.hasOwn(LINKS, key) ? LINKS[key] : null;
    if (link) shell.openExternal(typeof link === 'function' ? link() : link);
});
ipcMain.handle('copy-logs', () => { clipboard.writeText(serverState.logs.join('\n')); });
ipcMain.handle('set-layer', (_e, mode) => setLayer(mode));

// ---------- phone & tablet access ----------
function lanInfo() {
    const ours = serverState.running && !serverState.attached;
    return {
        on: settings.lanAccess,
        user: settings.lanUser,
        hasPassword: !!settings.lanPassword,
        running: serverState.running,
        attached: serverState.attached,
        // Started with different settings than the current ones.
        needsRestart: ours && needsRestart(),
        whitelistTxt: lan.hasWhitelistTxt(stRoot()),
        older: dl.olderStatus(instances.describe(stRoot()).version),
        https: settings.https,
        addresses: [
            ...lan.phoneAddresses(settings.port, scheme()),
            ...(tailscaleInfo?.running ? tailscaleInfo.ips.map(ip => ({ name: 'Tailscale', url: `${scheme()}://${ip}:${settings.port}/`, tailscale: true }))
                .concat(tailscaleInfo.dns ? [{ name: 'Tailscale', url: `${scheme()}://${tailscaleInfo.dns}:${settings.port}/`, tailscale: true }] : []) : []),
        ].map(a => ({ ...a, qr: lan.qrSvg(a.url) })),
        tailscale: tailscaleInfo,
    };
}
let tailscaleInfo = null;
ipcMain.handle('lan-info', async () => {
    if (settings.lanAccess) { tailscaleInfo = await tunnel.tailscale(); tailscaleOn = !!tailscaleInfo.running; }
    return lanInfo();
});
ipcMain.handle('lan-save', async (_e, { on, user, password }) => {
    settings.lanAccess = !!on;
    settings.lanUser = String(user || 'user').trim().slice(0, 64) || 'user';
    // Empty field = keep the saved password; `null` clears it.
    if (password === null) settings.lanPassword = '';
    else if (password) settings.lanPassword = String(password).slice(0, 128);
    saveSettings(settings);
    broadcast('settings', publicSettings());
    const info = lanInfo();
    // Restarting closes extra servers on this folder and reloads the tabs.
    if (info.needsRestart) await runTask(t('Restarting the server for phone access'), async () => true);
    return lanInfo();
});

// SillyTavern's login (phone access with a password) shouldn't ask in the app's own window.
// A wrong answer makes Chromium ask again, so two tries per 10 s, then it's left to fail
// (e.g. the server still runs with the old password until it restarts).
const loginTries = new Map();
app.on('login', (e, _wc, details, authInfo, callback) => {
    if (authInfo.isProxy) return;
    // A remote SillyTavern with basic auth: its saved login, at most twice in 10 s
    // (a wrong password would otherwise loop). Without one, SillyTavern's
    // "unauthorized" page shows, and the entry needs its login filled in.
    // (Any address but this app's own main server, whose login is the phone-access one.)
    const mainServer = isLocal(details.url) && Number(authInfo.port) === settings.port;
    const r = !mainServer && remote.loginFor(settings, details.url);
    if (r) {
        const key = `remote-${r.id}`;
        const recent = (loginTries.get(key) || []).filter(t => Date.now() - t < 10000);
        if (recent.length >= 2) return;
        loginTries.set(key, [...recent, Date.now()]);
        e.preventDefault();
        callback(r.user, r.password);
        return;
    }
    // The main server's login: what it was started with (phone access or the remote link).
    const login = serverLogin() || (settings.lanAccess && settings.lanPassword ? { user: settings.lanUser || 'user', password: settings.lanPassword } : null);
    if (authInfo.isProxy || !login || !isLocal(details.url) || Number(authInfo.port) !== settings.port) return;
    const now = Date.now();
    const recent = (loginTries.get(authInfo.port) || []).filter(t => now - t < 10000);
    if (recent.length >= 2) return;
    loginTries.set(authInfo.port, [...recent, now]);
    e.preventDefault();
    callback(login.user, login.password);
});

// The main server's own certificate (HTTPS on): trusted for this PC's addresses only.
app.on('certificate-error', (e, _wc, url, _error, cert, callback) => {
    let u;
    try { u = new URL(url); } catch { return; }
    if (settings.https && httpsCert && cert.fingerprint === httpsCert.fingerprint && Number(u.port) === settings.port) {
        e.preventDefault();
        callback(true);
    }
});

// ---------- server options, HTTPS, remote link (Launcher.bat's tools) ----------
// A settings change that needs the server started with other variables:
// restart it (if it runs) like any task, keeping the remote link up.
async function applyServerSettings(label) {
    if (!needsRestart()) return true;
    restartingForSettings = true;
    try { return await runTask(label, async () => true); } finally { restartingForSettings = false; }
}
function serverOptionsInfo() {
    if (settings.https && !httpsCert) mainServerEnv(); // makes (or reads) the certificate
    return {
        options: so.describe(stRoot(), settings.serverOverrides),
        https: settings.https,
        cert: settings.https && httpsCert ? { validTo: httpsCert.validTo, names: httpsCert.names } : null,
        needsRestart: needsRestart(),
        running: serverState.running,
    };
}
ipcMain.handle('server-options', () => serverOptionsInfo());
ipcMain.handle('server-options-save', (_e, { overrides, https: on } = {}) => {
    if (overrides) settings.serverOverrides = so.clean(overrides);
    if (typeof on === 'boolean') settings.https = on;
    saveSettings(settings);
    mainInstance(); // its address changes with https
    if (settings.https) mainServerEnv(); // makes the certificate now, so the launcher can show it
    broadcast('settings', publicSettings());
    return serverOptionsInfo();
});
ipcMain.handle('server-restart', async () => { await applyServerSettings(t('Restarting the server')); lanInfo(); return serverOptionsInfo(); });

const tunnelView = s => ({ ...s, qr: s.url ? lan.qrSvg(s.url) : '', hasPassword: !!settings.lanPassword, user: settings.lanUser });
ipcMain.handle('tunnel-status', () => tunnelView(tunnel.status()));
ipcMain.handle('tunnel-start', async () => {
    if (!settings.lanPassword) return { error: t('Set a password first (Settings → Phone & tablet). Anyone with the link reaches the login.') };
    if (serverState.attached) return { error: t('SillyTavern was started outside this app. Stop it there and start it from here.') };
    if (busyTask) return { error: t('Busy with "{task}" — wait for it to finish.', { task: busyTask }) };
    tunnelWanted = true;
    if (!serverState.running) await startServer();
    else await applyServerSettings(t('Turning on the remote link'));
    if (!(await serverUp())) { tunnelWanted = false; return { error: t('SillyTavern did not start (see the Console).') }; }
    return tunnel.start(`${scheme()}://127.0.0.1:${settings.port}`);
});
ipcMain.handle('tunnel-stop', async () => {
    tunnel.stop();
    tunnelWanted = false;
    if (serverState.running) await applyServerSettings(t('Turning off the remote link'));
    return tunnel.status();
});
ipcMain.handle('tailscale-info', async () => { tailscaleInfo = await tunnel.tailscale(); return tailscaleInfo; });
ipcMain.handle('tailscale-install', async () => {
    if (!(await confirm(t('Install Tailscale?'), t('Installs Tailscale from Windows\' package manager (winget). Windows may ask for permission. Afterwards, sign in to Tailscale with the same account on this PC and your phone.'), t('Install')))) return false;
    return runTask(t('Installing Tailscale'), async () => {
        const r = await mx.run('winget', ['install', '--id', 'Tailscale.Tailscale', '-e', '--accept-package-agreements', '--accept-source-agreements'], process.cwd());
        logLine(r.code === 0 ? 'Tailscale is installed. Open it from the Start menu and sign in.' : 'ERROR: winget could not install Tailscale.');
        return r.code === 0;
    }, { needsStopped: false });
});

// ---------- start with SillyTavern ----------
const companionView = () => settings.companions.map(c => ({ ...c, missing: !fs.existsSync(c.path), running: companionKids.has(c.id) }));
ipcMain.handle('companions', () => companionView());
ipcMain.handle('companion-add', async () => {
    const r = await dialog.showOpenDialog(launcherWin, {
        title: t('Choose a program or script to start with SillyTavern'), properties: ['openFile'],
        filters: [{ name: t('Programs and scripts'), extensions: ['exe', 'bat', 'cmd', 'ps1', 'lnk', 'url'] }],
    });
    if (r.canceled || !r.filePaths[0]) return companionView();
    const file = r.filePaths[0];
    settings.companions = [...settings.companions, { id: Date.now().toString(36), name: path.basename(file).replace(/\.[^.]+$/, ''), path: file, args: '', stop: true }].slice(0, 20);
    saveSettings(settings);
    return companionView();
});
ipcMain.handle('companion-save', (_e, id, patch = {}) => {
    const c = settings.companions.find(x => x.id === id);
    if (c) {
        if (typeof patch.stop === 'boolean') c.stop = patch.stop;
        if (typeof patch.args === 'string') c.args = patch.args.slice(0, 500);
        if (typeof patch.name === 'string' && patch.name.trim()) c.name = patch.name.trim().slice(0, 60);
        saveSettings(settings);
    }
    return companionView();
});
ipcMain.handle('companion-remove', (_e, id) => {
    settings.companions = settings.companions.filter(x => x.id !== id);
    saveSettings(settings);
    return companionView();
});
ipcMain.handle('companion-start', (_e, id) => { const c = settings.companions.find(x => x.id === id); if (c) startCompanion(c); return companionView(); });

// ---------- what can this PC run, troubleshooting ----------
ipcMain.handle('pc-check', async (_e, fresh) => {
    const cards = await pc.gpus({ fresh: !!fresh });
    const ramGB = Math.round(os.totalmem() / 1024 ** 3);
    const main = [...cards].sort((a, b) => (a.integrated - b.integrated) || b.vramGB - a.vramGB)[0];
    const vram = main && !main.integrated ? main.vramGB : 0;
    return { cards, ramGB, main: main || null, ...pc.advice(vram, ramGB) };
});
ipcMain.handle('port-user', async () => {
    const user = await pc.portUser(settings.port);
    // This app's own server holds it: that's fine.
    const ours = user && serverState.child && user.pid === serverState.child.pid;
    return { port: settings.port, user, ours: !!ours || (user && serverState.running && !serverState.attached && /node/i.test(user.name)), free: await instances.freePort(settings.port + 1, [settings.port]) };
});
ipcMain.handle('use-port', (_e, port) => {
    port = Number(port);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) return false;
    settings.port = port;
    saveSettings(settings);
    mainInstance();
    broadcast('settings', publicSettings());
    logLine(`SillyTavern now uses port ${port} (starts there next time).`);
    return true;
});
ipcMain.handle('system-report', async () => {
    const info = await mx.getInfo(stRoot()).catch(() => ({}));
    const health = await mx.healthCheck(stRoot()).catch(() => []);
    const cards = await pc.gpus();
    const ts = await tunnel.tailscale();
    const text = pc.report([
        ['SillyTavern Desktop', [['Version', app.getVersion()], ['Installed', app.isPackaged ? (process.env.PORTABLE_EXECUTABLE_DIR ? 'portable' : 'installer') : 'source'], ['Language', i18n.current().id]]],
        ['SillyTavern', [['Folder', stRoot()], ['Version', info.version], ['Branch', info.branch || info.pinned || ''], ['Commit', info.commit], ['Server', serverState.running ? (serverState.attached ? 'running (started elsewhere)' : 'running') : 'stopped'], ['Port', settings.port]]],
        ['Settings', [['Phone access', settings.lanAccess ? `on${settings.lanPassword ? ', with password' : ', no password'}` : 'off'], ['HTTPS', settings.https ? 'on' : 'off'], ['Remote link', tunnel.running() ? 'on' : 'off'], ['Own Node.js/Git', settings.ownRuntime ? 'on' : 'off'], ['Options set by the app', Object.keys(so.clean(settings.serverOverrides)).join(', ') || 'none'], ['Profiles', settings.profiles.length], ['Desktop extensions on', Object.values(settings.desktopExtensions || {}).filter(Boolean).length]]],
        ['PC', [['Windows', `${os.release()} (${os.arch()})`], ['Memory', `${Math.round(os.totalmem() / 1024 ** 3)} GB`], ['Graphics', cards.map(c => `${c.name}${c.vramGB ? ` ${c.vramGB} GB` : ''}`).join('; ')], ['VPN adapters', pc.vpns().join(', ') || 'none'], ['Tailscale', ts.installed ? (ts.running ? 'running' : 'installed') : 'no']]],
        ['Health check', health.map(h => [h.label, `${h.status}: ${h.detail}`])],
    ]);
    clipboard.writeText(text);
    logLine('Copied the system report (no passwords, your user folder shown as %USERPROFILE%).');
    return text;
});
ipcMain.handle('npm-cache', () => runTask(t('Clearing npm\'s cache'), () => mx.clearNpmCache(stRoot()), { needsStopped: false }));
ipcMain.handle('git-trouble', () => mx.gitTrouble(stRoot()));
ipcMain.handle('git-fix', async () => {
    const tr = await mx.gitTrouble(stRoot());
    const what = [tr.stuck && t('an update that stopped halfway'), tr.changed?.length && t('{n} changed program file|{n} changed program files', { n: tr.changed.length }), tr.ahead && t('{n} commit of its own|{n} commits of its own', { n: tr.ahead })].filter(Boolean).join(', ');
    if (!(await confirm(t('Put SillyTavern\'s program files back to the official version?'),
        `${what ? `${t('Found: {what}.', { what })}\n\n` : ''}${t('Everything changed is kept on a backup branch first, and your data folder (characters, chats, settings) is not touched. Then updating works again.')}`, t('Repair')))) return false;
    return runTask(t('Repairing SillyTavern\'s files'), () => mx.fixGit(stRoot()));
});
ipcMain.handle('onboarding', () => mx.users(stRoot()).map(u => ({ user: u, on: mx.onboarding(stRoot(), u) })));
ipcMain.handle('onboarding-set', (_e, user, on) => {
    if (!mx.users(stRoot()).includes(user)) return false;
    return runTask(t('Changing SillyTavern\'s welcome tour'), async () => mx.setOnboarding(stRoot(), user, !!on));
});
// The whole SillyTavern of a profile to the Recycle Bin (never the one in use).
ipcMain.handle('profile-trash', async (_e, id) => {
    const p = settings.profiles.find(x => x.id === id);
    if (!p) return false;
    if (prof.sameDir(p.path, stRoot())) return { error: t('This profile is in use. Switch to another profile first.') };
    if (!setup.isStRoot(p.path) || path.parse(p.path).root === path.resolve(p.path) || exeBases().some(b => prof.sameDir(b, p.path))) return { error: t('This folder can\'t be removed from here.') };
    if (instances.find(p.path)) return { error: t('It is running next to this one. Close its tabs first.') };
    const owner = launcherWin && !launcherWin.isDestroyed() ? [launcherWin] : [];
    const { response } = await dialog.showMessageBox(...owner, {
        type: 'warning', buttons: [t('Back up its data first…'), t('Move to Recycle Bin'), t('Cancel')], defaultId: 0, cancelId: 2, noLink: true,
        message: t('Remove SillyTavern "{name}" from this PC?', { name: p.name }),
        detail: `${p.path}\n\n${t('The whole folder goes to the Recycle Bin: the program, and its characters, chats and settings. Back up its data first if you may want them again.')}`,
    });
    if (response === 2) return false;
    if (response === 0) {
        const r = await dialog.showOpenDialog(launcherWin, { title: t('Choose a folder for the backup of its data'), defaultPath: app.getPath('documents'), properties: ['openDirectory', 'createDirectory'] });
        if (r.canceled || !r.filePaths[0]) return false;
        if (r.filePaths[0].toLowerCase().startsWith(path.resolve(p.path).toLowerCase())) return { error: t('Pick a folder outside the SillyTavern you are removing.') };
        const zip = await runTask(t('Backing up'), async () => mx.createBackup(p.path, 'before-removal', 0, { dir: r.filePaths[0] }), { needsStopped: false });
        if (!zip) return { error: t('The backup failed, so nothing was removed (see the Console).') };
        if (!(await confirm(t('Move "{name}" to the Recycle Bin now?', { name: p.name }), t('The backup is saved. Move the folder to the Recycle Bin?'), t('Move to Recycle Bin')))) return false;
    }
    try {
        await shell.trashItem(path.resolve(p.path)); // backslashes: Windows refuses "C:/…"
    } catch (e) {
        return { error: t('Windows could not move it to the Recycle Bin ({reason}). Delete the folder yourself if you want it gone.', { reason: e.message }) };
    }
    prof.remove(settings, id);
    profilesChanged();
    logLine(`Moved SillyTavern "${p.name}" (${p.path}) to the Recycle Bin.`);
    return true;
});

// ---------- AI apps (aiapps.js) ----------
const aiOverview = async () => ({
    apps: ai.list(), appsDir: ai.appsDir(), modelsDir: ai.modelsDir(), models: ai.models(), free: ai.freeSpace(),
    gpu: await ai.gpuKind(), downloading: ai.downloading(),
});
const appById = id => ai.APPS.find(a => a.id === id);
ipcMain.handle('ai-apps', () => aiOverview());
ipcMain.handle('ai-install', async (_e, id) => {
    const app = appById(id);
    if (!app) return null;
    const free = ai.freeSpace();
    if (free != null && free < 6e9 && !(await confirm(t('Only {free} free where the apps go. Install anyway?', { free: `${(free / 1e9).toFixed(1)} GB` }), ai.appsDir(), t('Install')))) return ai.view(app);
    return ai.install(id);
});
ipcMain.handle('ai-update', (_e, id) => ai.install(id, { update: true }));
ipcMain.handle('ai-latest', (_e, id) => ai.latestVersion(id));
ipcMain.handle('ai-start', (_e, id) => ai.start(id));
ipcMain.handle('ai-stop', (_e, id) => ai.stop(id));
ipcMain.handle('ai-log', (_e, id) => ai.logOf(id));
ipcMain.handle('ai-options', (_e, id, values) => ai.saveOptions(id, values || {}));
ipcMain.handle('ai-autostart', (_e, id, on) => ai.setAutostart(id, on));
ipcMain.handle('ai-open', (_e, id) => { const v = ai.view(appById(id)); openWebTab(v.url); return true; });
ipcMain.handle('ai-folder', (_e, id) => { const app = appById(id); shell.openPath(app ? ai.dirOf(app) : ai.modelsDir()); });
ipcMain.handle('ai-uninstall', async (_e, id) => {
    const app = appById(id);
    if (!app) return null;
    const v = ai.view(app);
    if (!(await confirm(t('Remove {name}?', { name: app.name }), `${v.dir}\n\n${t('Its folder goes to the Recycle Bin. Your models (in the models folder) stay.')}`, t('Move to Recycle Bin')))) return v;
    try { return await ai.uninstall(id); } catch (e) { return { ...v, error: e.message }; }
});
ipcMain.handle('ai-apps-dir', async () => {
    if (ai.running().length) return { error: t('Stop the running AI apps first.') };
    const r = await dialog.showOpenDialog(launcherWin, { title: t('Choose a folder for AI apps and models (they need a lot of space)'), defaultPath: ai.appsDir(), properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return aiOverview();
    settings.appsDir = r.filePaths[0];
    saveSettings(settings);
    logLine(`AI apps and models now go to ${settings.appsDir} (apps already installed elsewhere stay there).`);
    return aiOverview();
});
ipcMain.handle('ai-apps-dir-reset', () => { settings.appsDir = ''; saveSettings(settings); return aiOverview(); });
// Models: suggestions picked for this PC, search, files, downloads.
async function usableVram() {
    const cards = await pc.gpus();
    const main = [...cards].sort((a, b) => (a.integrated - b.integrated) || b.vramGB - a.vramGB)[0];
    return main && !main.integrated ? Math.max(0, main.vramGB - 0.8) : 0;
}
// The best file of a repo for this PC: the largest of the usual quants that fits, else the smallest.
function bestFile(files, usable) {
    const fit = files.filter(f => f.size / 1e9 + 1.5 <= usable && /Q[4-8]_|Q4_K|Q5_K|Q6_K|Q8_0|IQ4/.test(f.quant));
    return fit.at(-1) || files.find(f => f.quant === 'Q4_K_M') || files[0] || null;
}
ipcMain.handle('ai-models-suggested', async () => {
    const usable = await usableVram();
    const fits = pc.advice(usable + 0.8, Math.round(os.totalmem() / 1024 ** 3)).fits;
    return { usable: Math.round(usable * 10) / 10, models: ai.SUGGESTED.map(m => {
        const f = fits.find(x => x.size >= m.size) || fits.at(-1);
        return { ...m, note: t(m.note), fit: f.quant ? 'fits' : f.slowQuant ? 'slow' : 'too large' };
    }) };
});
ipcMain.handle('ai-model-search', async (_e, q) => { try { return { results: await ai.searchModels(String(q || '').slice(0, 100)) }; } catch (e) { return { error: e.message }; } });
ipcMain.handle('ai-model-files', async (_e, repo) => {
    try {
        const files = await ai.repoFiles(String(repo));
        const usable = await usableVram();
        const best = bestFile(files, usable);
        return { files: files.map(f => ({ name: f.name, size: f.size, quant: f.quant, fits: f.size / 1e9 + 1.5 <= usable, best: f === best })), usable };
    } catch (e) { return { error: e.message }; }
});
// The launcher names the repo and file; parts and hashes come from Hugging Face again here.
ipcMain.handle('ai-model-download', async (_e, repo, name) => {
    try {
        const files = await ai.repoFiles(String(repo));
        const usable = await usableVram();
        const f = name ? files.find(x => x.name === name) : bestFile(files, usable);
        if (!f) return { error: t('That file is not in {repo}.', { repo }) };
        const free = ai.freeSpace();
        if (free != null && free < f.size + 1e9) return { error: t('Not enough free space for it ({size} needed, {free} free).', { size: `${(f.size / 1e9).toFixed(1)} GB`, free: `${(free / 1e9).toFixed(1)} GB` }) };
        logLine(`Downloading the model ${repo} / ${f.name} (${(f.size / 1e9).toFixed(1)} GB) into ${ai.modelsDir()} …`);
        const r = await ai.downloadModel({ repo, parts: f.parts });
        logLine(r.ok ? `Model ready: ${r.path}` : r.cancelled ? 'Model download stopped (start it again to continue).' : `ERROR: model download failed: ${r.error}`);
        broadcast('ai-models', ai.models());
        return r;
    } catch (e) { return { error: e.message }; }
});
// TabbyAPI's models are whole repositories (EXL3/EXL2 folders).
ipcMain.handle('ai-model-download-repo', async (_e, appId, repo, ref) => {
    const app = appById(appId);
    if (!app?.modelFolder) return { error: 'no model folder' };
    try {
        // A size per branch (4.0bpw, 6.0bpw…): the launcher asks which one first.
        if (!ref) {
            const branches = await ai.repoBranches(String(repo));
            if (branches.length) return { branches };
        }
        ref = ref || 'main';
        const parts = await ai.repoAll(String(repo), ref);
        if (!parts.some(p => /\.safetensors$/i.test(p.path))) return { error: t('No model files in it (pick one of its sizes, or another model).') };
        const total = parts.reduce((n, p) => n + p.size, 0);
        const free = ai.freeSpace();
        if (free != null && free < total + 1e9) return { error: t('Not enough free space for it ({size} needed, {free} free).', { size: `${(total / 1e9).toFixed(1)} GB`, free: `${(free / 1e9).toFixed(1)} GB` }) };
        const folder = path.join(app.modelFolder(ai.dirOf(app)), `${String(repo).split('/')[1]}${ref === 'main' ? '' : `-${ref}`}`);
        logLine(`Downloading ${repo} (${ref}, ${(total / 1e9).toFixed(1)} GB) into ${folder} …`);
        const r = await ai.downloadModel({ repo, parts, folder, ref });
        // The first model becomes the one it starts with.
        if (r.ok && !ai.optionsOf(app).tabbyModel) ai.saveOptions(appId, { tabbyModel: path.basename(folder) });
        return r.ok ? { ok: true, folder: path.basename(folder) } : r;
    } catch (e) { return { error: e.message }; }
});
ipcMain.handle('ai-model-cancel', () => { ai.cancelDownload(); return true; });
ipcMain.handle('ai-models', () => ai.models());
ipcMain.handle('ai-model-remove', async (_e, file) => {
    if (!(await confirm(t('Move this model to the Recycle Bin?'), String(file), t('Move to Recycle Bin')))) return ai.models();
    try { await ai.removeModel(String(file)); } catch (e) { logLine(`ERROR: ${e.message}`); }
    return ai.models();
});

// ---------- app updates ----------
ipcMain.handle('app-update-state', () => appUpdate.getState());
ipcMain.handle('app-update-check', () => appUpdate.check({ fresh: true }));
// Switching the channel asks GitHub again right away.
ipcMain.handle('set-app-preview', (_e, on) => {
    settings.appPreview = !!on;
    saveSettings(settings);
    logLine(on ? 'This app now also gets preview versions (pre-releases). They are tested less.' : 'This app now only gets regular releases.');
    return appUpdate.check({ fresh: true });
});
ipcMain.handle('app-update-download', () => appUpdate.download());
ipcMain.handle('app-update-install', () => {
    // A restore or SillyTavern update must not be cut off halfway.
    if (busyTask) { logLine(`Busy with "${busyTask}" — update the app when it has finished.`); return false; }
    return appUpdate.install(() => { isQuitting = true; app.quit(); });
});

// ---------- desktop extensions ----------
const EXAMPLE_EXTENSION = path.join(__dirname, 'examples', 'break-reminder');
ipcMain.handle('ext:list', () => ext.list());
ipcMain.handle('ext:set-enabled', async (_e, id, on) => {
    if (!ext.isValidId(id)) return false;
    if (on) {
        const e = ext.list().find(x => x.id === id);
        if (!(await confirm(t('Turn on "{name}"?', { name: e.name }), `${e.description ? `${e.description}\n\n` : ''}${t('Desktop extensions run with full access to your PC, like any program you install. Only turn on extensions you trust.')}`, t('Turn on')))) return false;
    }
    settings.desktopExtensions = { ...settings.desktopExtensions, [id]: !!on };
    if (!on) delete settings.desktopExtensions[id];
    saveSettings(settings);
    await (on ? ext.activate(id) : ext.deactivate(id));
    return true;
});
ipcMain.handle('ext:reload', () => ext.reloadAll());
// "Get add-ons": the catalog with what's installed (addons.js).
ipcMain.handle('addons', async (_e, fresh) => {
    const cat = await addons.catalog({ fresh: !!fresh });
    const installed = new Map(ext.list().map(e => [e.id, e]));
    return {
        error: cat.error || '', uses: Object.fromEntries(Object.entries(addons.USES).map(([k, v]) => [k, t(v)])),
        addons: cat.addons.map(a => {
            const have = installed.get(a.id);
            const tooOld = !!a.minAppVersion && addons.isNewer(a.minAppVersion, app.getVersion());
            return { ...a, installed: have?.version || (have ? '?' : ''), enabled: !!have?.enabled, update: !!have && addons.isNewer(a.version, have.version), tooOld };
        }),
    };
});
const addonBusy = new Set();
ipcMain.handle('addon-install', async (_e, id) => {
    const entry = (await addons.catalog()).addons.find(a => a.id === id);
    if (!entry) return { error: t('This add-on is not in the list (any more).') };
    if (addonBusy.has(id)) return { error: t('Already installing.') };
    addonBusy.add(id);
    const wasOn = !!settings.desktopExtensions[id];
    try {
        if (wasOn) await ext.deactivate(id);
        await addons.install(entry, app.getVersion());
        return { id, wasOn };
    } catch (e) {
        logLine(`ERROR: could not install the add-on "${entry.name}": ${e.message}`);
        return { error: t('Could not install it: {reason}', { reason: e.message }) };
    } finally {
        if (wasOn) await ext.activate(id);
        addonBusy.delete(id);
    }
});
ipcMain.handle('ext:remove', async (_e, id) => {
    if (!ext.isValidId(id)) return false;
    const e = ext.list().find(x => x.id === id);
    if (!(await confirm(t('Remove "{name}"?', { name: e.name }), t('Its folder is deleted, including the settings and files it saved. You can install it again later.'), t('Remove')))) return false;
    await ext.deactivate(id);
    delete settings.desktopExtensions[id];
    saveSettings(settings);
    try { addons.remove(id); } catch (err) { logLine(`ERROR: could not remove "${e.name}": ${err.message}`); return false; }
    return true;
});
// Chrome extensions (chromeext.js)
ipcMain.handle('spell-engine', () => ({ engine: spellEngineAtStart, chosen: settings.spellcheckEngine || 'windows' }));
ipcMain.handle('set-spell-engine', (_e, engine) => setSpellEngine(String(engine)));
ipcMain.handle('relaunch', async () => {
    if (!(await confirm(t('Restart SillyTavern Desktop now?'), t('The SillyTavern server stops and starts again with the app. Unsaved text in SillyTavern pages is lost.'), t('Restart')))) return false;
    app.relaunch();
    isQuitting = true;
    app.quit();
    return true;
});
ipcMain.handle('chrome-ext-list', () => crx.list());
ipcMain.handle('chrome-ext-set-enabled', (_e, id, on) => crx.setEnabled(String(id), !!on));
ipcMain.handle('chrome-ext-remove', async (_e, id) => {
    const e = (await crx.list()).find(x => x.id === id);
    if (!e || !(await confirm(t('Remove "{name}"?', { name: e.name }), t('The Chrome extension is removed from this app. You can add it again from the Chrome Web Store.'), t('Remove')))) return false;
    return crx.remove(e.id);
});
ipcMain.handle('chrome-ext-store', () => openChromeStore());
// Its options page or its Web Store page, as a tab of the SillyTavern window.
ipcMain.handle('chrome-ext-open', async (_e, id, what) => {
    const e = (await crx.list()).find(x => x.id === id);
    if (!e) return;
    openWebTab(what === 'options' && e.options ? e.options : e.store);
});
ipcMain.handle('chrome-ext-update', async () => {
    try { await crx.checkUpdates(); } catch (err) { logLine(`ERROR: Chrome extension update check failed: ${err.message}`); }
    return crx.list();
});
ipcMain.handle('ext:page-invoke', (e, id, channel, args) => ext.pageInvoke(e.sender, id, channel, Array.isArray(args) ? args : []));
ipcMain.handle('ext:panel', (_e, id) => (ext.isValidId(id) && settings.desktopExtensions[id] ? ext.panelCode(id) : null));
ipcMain.handle('ext:invoke', (_e, id, channel, args) => ext.invoke(id, channel, Array.isArray(args) ? args : []));
ipcMain.handle('ext:add-example', () => ext.addExample(EXAMPLE_EXTENSION));
ipcMain.handle('set-tabs', (_e, on) => setTabs(on));
ipcMain.handle('save-settings', (_e, s) => {
    settings = { ...settings, ...s };
    saveSettings(settings);
    syncTray();
    logLine('Settings saved.');
});

// ---------- setup, requirements, install location ----------
// Every folder the app runs gets a profile, so the list stays complete.
function useInstall(dir) {
    settings.sillytavernPath = dir;
    const p = prof.ensureFor(settings, dir);
    saveSettings(settings);
    logLine(`Using profile "${p.name}": SillyTavern ${instances.describe(dir).version} at ${dir}.`);
    mainInstance(); // tab tips and the bar's info name the new profile
    stWins.forEach(w => w.push());
    refreshInstalls();
    broadcast('refresh');
}

// The task body of every switch. A server already running from the new
// folder ("Open next to it") stops: the main server takes over that folder.
async function switchTo(dir) {
    await instances.stopAll(dir);
    useInstall(dir);
    await checkOutsideChanges(dir);
    return true;
}

// Switch to a profile. A running server stops and starts again on the new
// folder, and open SillyTavern tabs reload.
async function useProfile(id, { ask = true } = {}) {
    const p = settings.profiles.find(x => x.id === id);
    if (!p) return false;
    if (prof.sameDir(p.path, stRoot())) return true;
    if (!setup.isStRoot(p.path)) { logLine(`ERROR: the profile "${p.name}" points to ${p.path}, where there is no SillyTavern anymore. Edit the profile.`); return false; }
    if (busyTask) { logLine(`Busy with "${busyTask}" — switch profiles when it has finished.`); return false; }
    if (ask && serverState.running && !serverState.attached && stWindowState().open
        && !(await confirm(t('Switch to "{name}"?', { name: p.name }), t('The server restarts with the SillyTavern in {path}, and open SillyTavern tabs reload. Text you haven\'t sent yet is lost.', { path: p.path }), t('Switch')))) return false;
    return runTask(t('Switching to profile "{name}"', { name: p.name }), () => switchTo(p.path));
}

async function pickFolder(title, defaultPath) {
    const r = await dialog.showOpenDialog(launcherWin, { title, defaultPath, properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
}

// The cheap part: is there a SillyTavern to run? (asked on every refresh)
ipcMain.handle('setup-ready', () => ({ ready: setup.isStRoot(stRoot()), current: stRoot() }));
// Everything the welcome screen shows (scans the drives, starts node/git/winget).
ipcMain.handle('setup-state', async () => ({
    ready: setup.isStRoot(stRoot()),
    current: stRoot(),
    installs: setup.detectInstalls(exeBases()),
    profiles: prof.list(settings),
    requirements: await setup.checkRequirements(),
    runtime: { ...rt.info(), on: settings.ownRuntime },
}));
// Switching installs restarts the server (if running) on the new one.
ipcMain.handle('use-install', (_e, dir) => {
    if (!setup.isStRoot(dir)) return false;
    return runTask(t('Switching SillyTavern install'), () => switchTo(dir));
});
// Accept the SillyTavern folder itself or a folder that contains it.
ipcMain.handle('browse-install', async () => {
    const dir = await pickFolder('Select your SillyTavern folder', os.homedir());
    if (!dir) return { canceled: true };
    for (const cand of [dir, path.join(dir, 'SillyTavern')]) {
        if (setup.isStRoot(cand)) {
            await runTask(t('Switching SillyTavern install'), () => switchTo(cand));
            return { ok: true, path: cand };
        }
    }
    return { error: t('No SillyTavern found in {dir}. Pick the folder that contains server.js.', { dir }) };
});
ipcMain.handle('install-requirements', () => runTask(t('Installing Node.js and Git'), () => setup.installRequirements(), { needsStopped: false }));
// ---------- the app's own Node.js and Git ----------
ipcMain.handle('runtime-latest', () => rt.latest());
// Download (or update) both and use them. Replacing a copy in use needs the
// servers stopped, so look first: nothing newer means nothing is stopped.
ipcMain.handle('runtime-install', async () => {
    const have = rt.info();
    broadcast('runtime-progress', 'Looking for the latest versions …');
    const want = await rt.latest();
    broadcast('runtime-progress', '');
    const which = ['node', 'git'].filter(w => !have[w] || !want[w] || have[w].version !== want[w]);
    const turnOn = () => {
        if (!(rt.info().node || rt.info().git)) return;
        const was = settings.ownRuntime && rt.info().active;
        settings.ownRuntime = true;
        saveSettings(settings);
        rt.apply(true);
        if (!was) logLine('This app now uses its own Node.js and Git. Your PC\'s own installs (if any) are not touched.');
    };
    if (!which.length) {
        logLine(`This app's Node.js ${have.node.version} and Git ${have.git.version} are the latest.`);
        turnOn();
        broadcast('refresh');
        return true;
    }
    const replacing = have.active && which.some(w => have[w]);
    return runTask(t('Getting Node.js and Git'), async () => {
        // Servers of other profiles ("Open next to it") run on the same node.exe.
        if (replacing) await instances.stopAll();
        const ok = await rt.install(which, text => broadcast('runtime-progress', text));
        broadcast('runtime-progress', '');
        turnOn();
        return ok;
    }, { needsStopped: replacing });
});
ipcMain.handle('runtime-use', (_e, on) => {
    settings.ownRuntime = !!on;
    saveSettings(settings);
    const active = rt.apply(settings.ownRuntime);
    logLine(active ? 'Using this app\'s own Node.js and Git from now on.' : 'Using the Node.js and Git installed on this PC from now on.');
    if (serverState.running && !serverState.attached) logLine('The running server keeps its current Node.js until it restarts.');
    broadcast('settings', publicSettings());
    return true;
});
ipcMain.handle('runtime-remove', async () => {
    if (!(await confirm(t('Remove this app\'s own Node.js and Git?'), t('The app goes back to the Node.js and Git installed on this PC. If they aren\'t installed, SillyTavern can\'t start until you install them or download the app\'s own copy again.'), t('Remove')))) return false;
    return runTask(t('Removing Node.js and Git'), async () => {
        if (rt.info().active) await instances.stopAll(); // other profiles' servers use it too
        rt.apply(false);
        settings.ownRuntime = false;
        saveSettings(settings);
        return rt.remove();
    }, { needsStopped: rt.info().active });
});

// ---------- importing cards, lorebooks and presets ----------
// Files from "Open with" (argv) and from drag & drop on the launcher.
function importArgs(argv) {
    return argv.slice(1).filter(a => !a.startsWith('-') && imp.EXTENSIONS.includes(path.extname(a).toLowerCase()) && fs.existsSync(a));
}
let pendingImport = [];
function offerImport(files) {
    if (launcherWin && !launcherWin.isDestroyed() && !launcherWin.webContents.isLoading()) launcherWin.webContents.send('import-files', files);
    else pendingImport.push(...files);
}
ipcMain.handle('import-pending', () => pendingImport.splice(0));
ipcMain.handle('import-classify', (_e, paths) => ({
    items: (Array.isArray(paths) ? paths : []).slice(0, 200).map(p => imp.classify(String(p))),
    profiles: prof.list(settings).filter(p => p.ok).map(p => ({ id: p.id, name: p.name, active: p.active, version: p.version })),
}));
// Waits for the main server to answer (it may just have been started).
async function serverUp(ms = 120000) {
    const t = Date.now();
    while (Date.now() - t < ms) {
        if (await checkPortOpen()) return true;
        if (!serverState.running) return false;
        await new Promise(r => setTimeout(r, 800));
    }
    return false;
}
ipcMain.handle('import-run', (_e, { paths, profileId } = {}) => {
    const target = prof.list(settings).find(p => p.id === profileId && p.ok);
    if (!target) return { error: t('That profile is not available.') };
    // Sorted again here: the launcher only says which files.
    const items = (Array.isArray(paths) ? paths : []).slice(0, 200).map(p => imp.classify(String(p))).filter(i => i.kind);
    if (!items.length) return { error: t('None of these files can be imported.') };
    let res = null;
    return runTask(t('Importing'), async () => {
        let base, srv = null, auth;
        if (target.active) {
            if (!serverState.running) { logLine('Starting the server to import …'); await startServer(); }
            if (!(await serverUp())) { res = { error: t('SillyTavern did not start (see the Console).') }; return false; }
            base = mainInstance().url;
            auth = serverLogin() || undefined;
        } else {
            // Another profile: its server just for the import, unless one already runs.
            srv = instances.find(target.path);
            if (!srv) {
                srv = instances.startServer(target.path, await instances.freePort(settings.port + 1, [settings.port]), `import into ${target.name}`);
                srv.temporary = true;
            }
            if (!(await srv.ready)) { res = { error: t('SillyTavern in "{name}" did not start (see the Console).', { name: target.name }) }; return false; }
            base = `http://${settings.host}:${srv.port}/`;
        }
        try {
            const results = await imp.importAll(base, target.path, items, { auth });
            results.forEach(r => logLine(r.ok ? `Imported ${r.file} as ${r.as} into "${target.name}".` : `Could not import ${r.file}: ${r.error}`));
            res = { results, profile: target.name, reloadable: target.active && stWins.size > 0 };
        } catch (e) {
            res = { error: e.message };
        } finally {
            if (srv?.temporary) await instances.stopServer(srv);
        }
        return true;
    }, { needsStopped: false }).then(() => res || { error: t('Busy with another task. Try again when it has finished.') });
});
// ---------- profiles ----------
const profilesChanged = () => { saveSettings(settings); broadcast('profiles'); };
// "older": how far behind the newest release a profile's version is (from the remembered version list).
ipcMain.handle('profiles', () => prof.list(settings).map(p => ({ ...p, older: p.ok ? dl.olderStatus(p.version) : null })));
ipcMain.handle('profile-use', (_e, id) => useProfile(id));
// Add (no id) or edit. Changing the folder of the profile in use switches to it.
ipcMain.handle('profile-save', async (_e, data) => {
    const before = settings.profiles.find(p => p.id === data?.id);
    const oldPath = before?.path;
    const wasActive = !!before && prof.sameDir(oldPath, stRoot());
    if (wasActive && busyTask && !prof.sameDir(oldPath, data?.path)) return { error: t('Busy with "{task}" — wait for it to finish.', { task: busyTask }) };
    const r = prof.save(settings, { id: data?.id, name: data?.name, path: String(data?.path || '') });
    if (r.error) return r;
    if (wasActive && !prof.sameDir(oldPath, r.profile.path)) {
        const ok = await runTask(t('Switching to profile "{name}"', { name: r.profile.name }), () => switchTo(r.profile.path));
        if (!ok) { r.profile.path = oldPath; profilesChanged(); return { error: t('The folder could not be changed now (see the Console).') }; }
    }
    profilesChanged();
    mainInstance();
    stWins.forEach(w => w.push());
    logLine(before ? `Saved profile "${r.profile.name}".` : `Added profile "${r.profile.name}" (${r.profile.path}).`);
    return { ok: true, profile: r.profile };
});
ipcMain.handle('profile-delete', async (_e, id) => {
    const p = settings.profiles.find(x => x.id === id);
    if (!p) return false;
    if (prof.sameDir(p.path, stRoot())) return { error: t('This profile is in use. Switch to another profile first.') };
    if (!(await confirm(t('Remove the profile "{name}"?', { name: p.name }), `${t('Only the profile is removed. The SillyTavern folder stays where it is:')}\n${p.path}`, t('Remove')))) return false;
    prof.remove(settings, id);
    profilesChanged();
    logLine(`Removed profile "${p.name}" (the folder ${p.path} was not touched).`);
    return true;
});
// A folder for a profile: the SillyTavern folder itself or one that contains it.
ipcMain.handle('profile-browse', async (_e, from) => {
    const dir = await pickFolder('Select a SillyTavern folder', from && fs.existsSync(from) ? from : os.homedir());
    if (!dir) return { canceled: true };
    const found = [dir, path.join(dir, 'SillyTavern')].find(setup.isStRoot);
    if (!found) return { error: t('No SillyTavern found in {dir}. Pick the folder that contains server.js.', { dir }) };
    return { path: found, name: prof.suggestName(settings, found), version: instances.describe(found).version };
});
ipcMain.handle('profiles-add-found', () => {
    const before = settings.profiles.length;
    for (const i of setup.detectInstalls(exeBases())) prof.ensureFor(settings, i.path);
    const added = settings.profiles.length - before;
    if (added) profilesChanged();
    logLine(added ? `Added ${added} profile${added === 1 ? '' : 's'} for SillyTavern installs found on this PC.` : 'Every SillyTavern found on this PC already has a profile.');
    return added;
});
ipcMain.handle('profile-open-folder', (_e, id) => {
    const p = settings.profiles.find(x => x.id === id);
    if (p && fs.existsSync(p.path)) shell.openPath(p.path);
});
// Run another profile next to the one in use, on its own port, as a tab.
ipcMain.handle('profile-open-alongside', (_e, id) => {
    const p = settings.profiles.find(x => x.id === id);
    if (!p || prof.sameDir(p.path, stRoot()) || !setup.isStRoot(p.path)) return false;
    openExtra(p.path, 'other', null);
    return true;
});

// ---------- SillyTavern on other computers ----------
const remotesChanged = () => { saveSettings(settings); broadcast('profiles'); syncTray(); };
ipcMain.handle('remotes', () => remote.list(settings));
ipcMain.handle('remote-save', (_e, data = {}) => {
    const before = remote.get(settings, data.id);
    const loginBefore = before && JSON.stringify([before.url, before.user, before.password]);
    const r = remote.save(settings, { id: data.id, name: data.name, url: data.url, user: data.user, password: data.password });
    if (r.error) return r;
    remotesChanged();
    // Chromium remembers a login per address: a changed one must be asked for again.
    if (before && loginBefore !== JSON.stringify([r.remote.url, r.remote.user, r.remote.password])) {
        session.fromPartition(`persist:remote-${r.remote.id}`).clearAuthCache().catch(() => { /* nothing cached */ });
        loginTries.delete(`remote-${r.remote.id}`);
    }
    // Tabs already open keep their page; the next one uses the new address.
    if (remoteInsts.has(r.remote.id)) remoteInstance(r.remote);
    logLine(before ? `Saved "${r.remote.name}".` : `Added "${r.remote.name}" (${new URL(r.remote.url).host}).`);
    return { ok: true, id: r.remote.id, insecure: remote.insecure(r.remote.url) };
});
ipcMain.handle('remote-delete', async (_e, id) => {
    const r = remote.get(settings, id);
    if (!r) return false;
    if (!(await confirm(t('Remove "{name}"?', { name: r.name }), `${t('Only this entry and its saved login are removed. Nothing changes on the other computer.')}\n${r.url}`, t('Remove')))) return false;
    remote.remove(settings, id);
    remoteInsts.delete(id);
    remotesChanged();
    // Its own browser session (cookies, stored logins) goes too.
    session.fromPartition(`persist:remote-${id}`).clearStorageData().catch(() => { /* gone already */ });
    logLine(`Removed "${r.name}".`);
    return true;
});
ipcMain.handle('remote-probe', (_e, url) => remote.probe(url));
ipcMain.handle('remote-check-url', (_e, url) => {
    const u = remote.normalizeUrl(url);
    return u.error ? u : { url: u.url, insecure: remote.insecure(u.url) };
});
ipcMain.handle('remote-open', (_e, id) => openRemote(id, null));

// ---------- downloading SillyTavern ----------
ipcMain.handle('st-versions', (_e, fresh) => dl.listVersions({ fresh: !!fresh }).catch(e => ({ error: e.message })));
ipcMain.handle('download-target', (_e, parent, folder) => dl.targetInfo(String(parent || ''), String(folder || '')));
// Where new installs go by default: next to the one in use.
ipcMain.handle('download-defaults', () => ({ parent: setup.isStRoot(stRoot()) ? path.dirname(stRoot()) : os.homedir() }));
ipcMain.handle('pick-parent', (_e, from) => pickFolder('Where should the new SillyTavern go? (its folder is created inside)', from && fs.existsSync(from) ? from : os.homedir()));
ipcMain.handle('st-download', async (_e, o = {}) => {
    if (busyTask) return { error: t('Busy with "{task}" — wait for it to finish.', { task: busyTask }) };
    const req = await setup.checkRequirements();
    if (!req.node.ok || !req.git.ok) return { error: t('Node.js and Git are needed first (Maintenance → Back end, or the welcome screen installs them).') };
    const name = String(o.name || '').trim();
    if (name && settings.profiles.some(p => p.name.toLowerCase() === name.toLowerCase())) return { error: t('There is already a profile called "{name}".', { name }) };
    const target = dl.targetInfo(String(o.parent || ''), String(o.folder || ''));
    if (!target.ok) return { error: target.problem };
    const ref = String(o.ref || '');
    let res = null;
    const progress = p => { if (launcherWin && !launcherWin.isDestroyed()) launcherWin.webContents.send('st-download', p); };
    await runTask(t('Downloading SillyTavern {version}', { version: ref }), async () => {
        res = await dl.download({ ref, parent: o.parent, folder: o.folder }, progress);
        return !!res.path;
    }, { needsStopped: false });
    if (!res) return { error: t('The download could not start (see the Console).') };
    if (!res.path) return res;
    const dir = res.path;
    const r = prof.save(settings, { name: name || prof.suggestName(settings, dir), path: dir });
    const profile = r.profile || prof.ensureFor(settings, dir);
    profilesChanged();
    logLine(`Added profile "${profile.name}" for ${dir}.`);
    await hist.record('download', dir, null, await mx.getInfo(dir));
    broadcast('history');
    const used = o.useNow ? !!(await useProfile(profile.id, { ask: false })) : false;
    return { ok: true, path: dir, profile, used, depsFailed: !!res.depsFailed };
});
ipcMain.handle('st-download-cancel', () => dl.cancel());
// ---------- migrating data between SillyTavern folders ----------
// Folders the launcher may name: a profile's folder or one picked in a dialog.
const migFolders = new Set();
const migOk = dir => typeof dir === 'string' && setup.isStRoot(dir) && (settings.profiles.some(p => prof.sameDir(p.path, dir)) || [...migFolders].some(f => prof.sameDir(f, dir)));
const migUser = u => (/^[\w.-]{1,64}$/.test(String(u || '')) ? String(u) : 'default-user');
ipcMain.handle('mig-folders', () => prof.list(settings).filter(p => p.ok).map(p => ({ id: p.id, name: p.name, path: p.path, version: p.version, active: p.active, users: mig.users(p.path) })));
ipcMain.handle('mig-browse', async () => {
    const dir = await pickFolder('Select a SillyTavern folder to copy data from', os.homedir());
    if (!dir) return { canceled: true };
    const found = [dir, path.join(dir, 'SillyTavern')].find(setup.isStRoot);
    if (!found) return { error: t('No SillyTavern found in {dir}. Pick the folder that contains server.js.', { dir }) };
    migFolders.add(found);
    return { path: found, name: found, version: instances.describe(found).version, users: mig.users(found) };
});
ipcMain.handle('mig-scan', async (_e, o = {}) => {
    if (!migOk(o.src) || !migOk(o.dst)) return { error: t('Pick two SillyTavern folders.') };
    const srcUser = migUser(o.srcUser), dstUser = migUser(o.dstUser);
    if (prof.sameDir(o.src, o.dst) && srcUser === dstUser) return { error: t('The source and the target are the same. Pick another folder or another user.') };
    if (!fs.existsSync(path.join(o.src, 'data', srcUser))) return { error: t('There is no data for the user "{user}" in {dir} (it may never have been started).', { user: srcUser, dir: o.src }) };
    try {
        const r = await mig.scan({ src: o.src, srcUser, dst: o.dst, dstUser });
        return { ...r, srcVersion: instances.describe(o.src).version, dstVersion: instances.describe(o.dst).version };
    } catch (e) { return { error: t('Could not read the folders: {reason}', { reason: e.message }) }; }
});
ipcMain.handle('mig-preview', (_e, id, keys, policy) => mig.preview(String(id), Array.isArray(keys) ? keys.map(String) : [], String(policy)));
ipcMain.handle('mig-run', async (_e, o = {}) => {
    if (busyTask) return { error: t('Busy with "{task}" — wait for it to finish.', { task: busyTask }) };
    if (!migOk(o.dst)) return { error: t('Pick the target folder again.') };
    const keys = Array.isArray(o.keys) ? o.keys.map(String) : [];
    const policy = ['skip', 'newer', 'replace'].includes(o.policy) ? o.policy : 'skip';
    const toActive = prof.sameDir(o.dst, stRoot());
    let res = null;
    const progress = p => { if (launcherWin && !launcherWin.isDestroyed()) launcherWin.webContents.send('mig-progress', p); };
    // The target must not be running: its server would overwrite what's copied.
    await runTask(t('Migrating data'), async () => {
        await instances.stopAll(o.dst);
        if (o.backupFirst) {
            const b = await mx.createBackup(o.dst, 'auto-before-migration', keep());
            if (!b) { res = { error: t('The backup failed, so nothing was copied (see the Console).') }; return false; }
        }
        res = await mig.run(String(o.id), keys, policy, progress);
        return !res.error;
    }, { needsStopped: toActive });
    return res || { error: t('The migration could not start (see the Console).') };
});
ipcMain.handle('mig-cancel', () => mig.cancel());
ipcMain.handle('mig-journals', (_e, dir) => (migOk(dir) ? mig.journals(dir) : []));
ipcMain.handle('mig-undo', async (_e, dir, id) => {
    if (!migOk(dir)) return false;
    const j = mig.journals(dir).find(x => x.id === id);
    if (!j) return false;
    if (!(await confirm(t('Undo this migration?'), `${t('From {from}, {when}.', { from: j.from, when: new Date(j.at).toLocaleString(i18n.current().id) })}\n\n${t('Removes the {added} files it added and puts back the {replaced} files it replaced. Changes you made to those files since then are lost.', { added: j.added, replaced: j.replaced })}`, t('Undo')))) return false;
    return runTask(t('Undoing a migration'), async () => { await instances.stopAll(dir); return mig.undo(dir, String(id)); }, { needsStopped: prof.sameDir(dir, stRoot()) });
});

ipcMain.handle('open-st-release', (_e, v) => {
    if (/^\d+\.\d+\.\d+$/.test(String(v))) shell.openExternal(`https://github.com/SillyTavern/SillyTavern/releases/tag/${v}`);
});
ipcMain.handle('update-backend', async () => {
    if (!(await confirm(t('Update Node.js and Git?'), t('Installs the latest Node.js (LTS) and Git with winget, then reinstalls SillyTavern\'s dependencies to match. Windows may ask for permission. The server restarts afterwards.'), t('Update')))) return false;
    return runTask(t('Updating Node.js and Git'), () => setup.updateBackend(stRoot()));
});
ipcMain.handle('move-st', async () => {
    const from = stRoot();
    if (!setup.isStRoot(from)) return false;
    const parent = await pickFolder(`Move SillyTavern — choose the new parent folder (a "${path.basename(from)}" folder is created inside)`, path.dirname(from));
    if (!parent) return false;
    return runTask(t('Moving SillyTavern'), async () => {
        const r = await setup.moveInstall(from, parent);
        if (!r) return false;
        prof.moved(settings, from, r.to);
        hist.moved(from, r.to);
        useInstall(r.to);
        if (r.copied && await confirm(t('Delete the old copy?'), `${t('SillyTavern now runs from:')}\n${r.to}\n\n${t('The old copy is still at:')}\n${from}`, t('Delete old copy'))) {
            setup.removeOldInstall(from);
        }
        return true;
    });
});

// ---------- themes ----------
function setTheme(id) {
    settings.theme = themes.get(id).id;
    saveSettings(settings);
    broadcast('theme');
    stWins.forEach(w => w.setColors(themes.get(settings.theme).colors));
}
// The app's font and size: the launcher applies them itself, the top bars get the font.
ipcMain.handle('ui-fonts', () => ({ fonts: themes.UI_FONTS.map(([id, label]) => ({ id, label: t(label) })), zooms: themes.ZOOMS }));
ipcMain.handle('set-ui-font', (_e, { font, zoom } = {}) => {
    if (typeof font === 'string' && font.length <= 80) settings.uiFont = font;
    if (themes.ZOOMS.includes(zoom)) settings.uiZoom = zoom;
    saveSettings(settings);
    fitLauncherToZoom();
    stWins.forEach(w => w.push());
    broadcast('settings', publicSettings());
    return publicSettings();
});
ipcMain.handle('list-themes',() => ({ active: themes.get(settings.theme).id, themes: themes.list() }));
ipcMain.handle('set-theme', (_e, id) => setTheme(id));
ipcMain.handle('save-theme', (_e, raw, id) => {
    try {
        const newId = themes.save(raw, id);
        setTheme(newId);
        return { ok: true, id: newId };
    } catch (e) { return { error: e.message }; }
});
ipcMain.handle('delete-theme', async (_e, id) => {
    const theme = themes.get(id);
    if (theme.builtin || !(await confirm(t('Delete the theme "{name}"?', { name: theme.name }), t('This removes it from this app. Export it first if you want to keep a copy.'), t('Delete')))) return false;
    themes.remove(id);
    if (settings.theme === id) setTheme('sillytavern');
    else broadcast('theme');
    return true;
});
ipcMain.handle('import-theme', async () => {
    const r = await dialog.showOpenDialog(launcherWin, { title: t('Import a theme'), filters: [{ name: 'SillyTavern Desktop theme', extensions: ['json'] }], properties: ['openFile'] });
    if (r.canceled) return { canceled: true };
    try {
        const file = r.filePaths[0];
        if (fs.statSync(file).size > 1024 * 1024) throw new Error(t('That file is too large to be a theme.'));
        let raw;
        try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new Error(t('That file is not valid theme JSON.')); }
        const id = themes.save(raw);
        setTheme(id);
        logLine(`Imported theme "${themes.get(id).name}".`);
        return { ok: true, id };
    } catch (e) { return { error: e.message }; }
});
ipcMain.handle('export-theme', async (_e, id) => {
    const theme = themes.get(id);
    const r = await dialog.showSaveDialog(launcherWin, { title: t('Export theme'), defaultPath: `${theme.name.replace(/[^\w -]/g, '')}.json`, filters: [{ name: 'Theme', extensions: ['json'] }] });
    if (r.canceled) return false;
    fs.writeFileSync(r.filePath, themes.exportJson(id));
    logLine(`Exported theme "${theme.name}" to ${r.filePath}.`);
    return true;
});
// SillyTavern's own icon, read from the user's install (not bundled).
ipcMain.handle('st-logo', () => {
    for (const rel of ['public/img/apple-icon-144x144.png', 'public/img/logo.png']) {
        try { return `data:image/png;base64,${fs.readFileSync(path.join(stRoot(), rel)).toString('base64')}`; } catch { /* try next */ }
    }
    return null;
});

// Called once on launch: keep a valid saved folder, adopt a single install
// found on this PC, otherwise leave it to the welcome screen.
function ensureInstall() {
    if (setup.isStRoot(stRoot())) return true;
    if (stRoot()) logLine(`SillyTavern is no longer at ${stRoot()}.`);
    const found = setup.detectInstalls(exeBases());
    if (found.length === 1) {
        logLine(`Found SillyTavern ${found[0].version} at ${found[0].path}.`);
        useInstall(found[0].path);
        return true;
    }
    logLine(found.length ? `Found ${found.length} SillyTavern installs — choose one to use.` : 'No SillyTavern install found yet.');
    return false;
}

// ---------- app lifecycle ----------
// Everything below lives INSIDE the lock: when a second instance starts,
// gotLock is false and this process must do nothing but quit. Previously
// startup raced the quit and spawned a server into a dying app.
if (gotLock) {
    app.whenReady().then(() => {
        // Plain Chrome UA: Electron/app tokens make Cloudflare-gated sites
        // (used by community extensions) challenge harder or refuse outright.
        app.userAgentFallback = app.userAgentFallback
            .replace(/ Electron\/\S+/, '')
            .replace(/ sillytavern-?desktop\/\S+/i, '');
        userscriptsDir = setupUserscripts({ userData: USER_DATA, logLine }).scriptsDir;
        mx.initMaintenance({ logLine });
        // Before anything starts node or git.
        rt.initRuntime({ logLine, userData: USER_DATA });
        tunnel.initTunnel({ userData: USER_DATA, logLine, changed: s => broadcast('tunnel', tunnelView(s)) });
        ai.initAiApps({
            userData: USER_DATA, settings: () => settings, save: () => saveSettings(settings), stRoot,
            changed: (_id, v) => broadcast('ai-app', v), logged: (id, line) => broadcast('ai-log', { id, line }),
            modelProgress: p => broadcast('model-progress', p),
        });
        if (settings.ownRuntime && !rt.apply(true)) logLine('WARNING: "use this app\'s own Node.js and Git" is on, but they are missing. Download them again under Maintenance → Back end.');
        setup.initSetup({ logLine, onPathRefresh: () => rt.reapply() });
        dl.initDownloader({ logLine, userData: USER_DATA });
        hist.initHistory(USER_DATA);
        mig.initMigrate({ logLine });
        sx.initStExtensions({ logLine, userData: USER_DATA });
        instances.initInstances({ logLine, host: settings.host });
        ext.initExtensions({
            userData: USER_DATA,
            appVersion: app.getVersion(),
            logLine,
            isEnabled: id => !!settings.desktopExtensions[id],
            spellEngine: () => ({ engine: spellEngineAtStart, chosen: settings.spellcheckEngine || 'windows' }),
            setSpellEngine,
            relaunch: () => { app.relaunch(); isQuitting = true; app.quit(); },
            sillytavern: {
                folder: () => stRoot(),
                url: () => mainInstance().url,
                info: () => ({ ...instances.describe(stRoot()), port: settings.port, running: serverState.running }),
                // Only paths on the main server: an extension can't point a tab elsewhere.
                openTab: p => openInstance({ ...mainInstance(), url: new URL(p.replace(/^\/*/, '/'), mainInstance().url).href }),
            },
        });
        addons.initAddons({ logLine, userData: USER_DATA, extensionsDir: ext.extensionsDir() });
        // Before any SillyTavern window: tabs register with it as they open.
        initChrome();
        themes.initThemes(USER_DATA);
        appUpdate.initAppUpdate({ userData: USER_DATA, logLine, preview: () => settings.appPreview, send: s => { if (launcherWin && !launcherWin.isDestroyed()) launcherWin.webContents.send('app-update', s); } });
        bs.initBackupSchedule({
            logLine, userData: USER_DATA, getSettings: () => settings, targets: scheduleTargets,
            runTask: (label, fn) => runTask(label, fn, { needsStopped: false }),
            changed: () => broadcast('backup-schedule'),
        });
        // Files the app was opened with ("Open with SillyTavern Desktop"); the launcher asks for them once loaded.
        pendingImport.push(...importArgs(process.argv));
        createLauncherWindow();
        syncTray();
        ext.activateEnabled();
        bs.start();
        // A few seconds in, so it doesn't compete with startup.
        if (settings.checkAppUpdates) setTimeout(() => appUpdate.startChecking(), 4000);
        // SillyTavern's release list (kept an hour): marks profiles that are behind
        // or miss security fixes, and gives "What's new" its release notes.
        if (settings.checkUpdatesOnLaunch) setTimeout(() => dl.listVersions().then(() => broadcast('profiles'), () => { /* offline */ }), 6000);
        if (!ensureInstall()) return; // the welcome screen takes it from here
        refreshInstalls();
        checkOutsideChanges();
        if (settings.updateOnLaunch) {
            // Update first, then start: never under a running server.
            launchUpdate().then(() => { if (settings.autoStart) startAndOpen(); });
            return;
        }
        if (settings.checkUpdatesOnLaunch) {
            mx.checkForUpdates(stRoot()).then(info => {
                if (info.behind > 0) logLine(`A SillyTavern update is available (${info.behind} new commit${info.behind === 1 ? '' : 's'} on ${info.branch}).`);
                broadcast('refresh');
            });
        }
        if (settings.autoStart) startAndOpen();
    });

    // "Update on launch". A failed update leaves the old version, which still starts.
    async function launchUpdate() {
        const info = await mx.checkForUpdates(stRoot());
        broadcast('refresh');
        if (!info.isGit || !(info.behind > 0)) return;
        if (await checkPortOpen()) {
            logLine('A SillyTavern update is available, but a server is already running on this port, so it was not updated now.');
            return;
        }
        logLine(`Updating SillyTavern before starting (${info.behind} new commit${info.behind === 1 ? '' : 's'} on ${info.branch}) ...`);
        await runTask('Updating SillyTavern', () => tracked('update', () => mx.update(stRoot(), { backupFirst: settings.backupBeforeUpdate, keep: keep() })));
    }

    app.on('window-all-closed', () => {
        // User already closed every window — treat that as intent to quit;
        // don't hit them with the confirmation dialog a second time.
        isQuitting = true;
        stopServer();
        instances.stopAll();
        app.quit();
    });
    // No server outlives the app, however it quits (also Windows shutting
    // down, or quitting without the confirmation).
    app.on('will-quit', () => {
        tunnel.stop({ wait: true });
        stopCompanions({ wait: true });
        ai.stopAll({ wait: true });
        if (serverState.child) stopServer();
        instances.stopAll();
        flushLog({ sync: true });
    });

    app.on('before-quit', (e) => {
        if (isQuitting) return;
        if (serverState.running && settings.confirmBeforeQuit) {
            e.preventDefault();
            const choice = dialog.showMessageBoxSync({
                type: 'question',
                buttons: [t('Quit'), t('Cancel')],
                defaultId: 0,
                message: t('The SillyTavern server is still running.'),
                detail: t('Quitting stops the server. Unsaved chats in other tabs will be lost.'),
            });
            if (choice === 0) {
                isQuitting = true;
                stopServer();
                setTimeout(() => app.quit(), 800);
            }
            return;
        }
        isQuitting = true;
    });
}
