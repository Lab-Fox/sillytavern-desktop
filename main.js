// SillyTavern Desktop — main process
// Wraps the SillyTavern server as a hidden child process and
// renders it in a dedicated Chromium window. No cmd, ever.
import { app, BrowserWindow, Menu, Tray, ipcMain, shell, dialog, clipboard } from 'electron';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import http from 'http';
import { fileURLToPath } from 'url';
import { setupUserscripts } from './userscripts.js';
import * as mx from './maintenance.js';
import * as setup from './setup.js';
import * as themes from './themes.js';
import { StWindow } from './shell.js';
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
    autoStart: true,      // start server + open ST window immediately on app launch
    confirmBeforeQuit: true,
    closeToTray: false,         // closing the launcher hides it to the tray; the server keeps running
    backupBeforeUpdate: true,   // zip data/ before every update or branch switch
    checkUpdatesOnLaunch: true, // git fetch on startup so the dashboard can say "update available"
    updateOnLaunch: false,      // update SillyTavern on startup, before the server starts
    checkAppUpdates: true,      // look for a new release of this app on startup (never installs by itself)
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
    theme: 'sillytavern',       // launcher theme id (see themes.js)
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
// What the launcher gets: everything but the phone-access password.
const publicSettings = () => ({ ...settings, lanPassword: settings.lanPassword ? '********' : '' });
let userscriptsDir = path.join(USER_DATA, 'userscripts');

// Chromium's native occlusion stays on: together with backgroundThrottling
// (see stWebPreferences) a SillyTavern window hidden behind other windows
// stops drawing. (It used to be turned off because the top bar came back
// blank after "Stay in background"; that no longer happens, checked 2026-10-31.)

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

function openLog() {
    try { if (fs.statSync(DEBUG_LOG).size > LOG_MAX_BYTES) fs.renameSync(DEBUG_LOG, DEBUG_LOG.replace(/\.log$/, '.old.log')); } catch { /* no log yet */ }
    logStream = fs.createWriteStream(DEBUG_LOG, { flags: 'a' });
    logStream.on('error', () => { /* disk hiccup — don't die over it */ });
}

function flushLog({ sync = false } = {}) {
    if (!pendingLog.length) return;
    const lines = pendingLog;
    pendingLog = [];
    const text = `${lines.join('\n')}\n`;
    if (sync) { try { fs.appendFileSync(DEBUG_LOG, text); } catch { /* quitting anyway */ } } else {
        if (!logStream) openLog();
        logStream.write(text);
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

function checkPortOpen() {
    return new Promise(resolve => {
        const req = http.get(`http://${settings.host}:${settings.port}/`, { timeout: 2500 }, res => {
            res.resume();
            resolve(res.statusCode < 500);
        });
        req.on('timeout', () => { req.destroy(); resolve(false); });
        req.on('error', () => resolve(false));
    });
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
    const lanEnv = lan.serverEnv(settings);
    if (settings.lanAccess) {
        const where = lan.phoneAddresses(settings.port).map(a => a.url).join(' or ');
        logLine(where ? `Phone access is on: open ${where} on a device on the same network.` : 'Phone access is on, but this PC is not on a home network right now.');
        const older = dl.olderStatus(instances.describe(stRoot).version);
        if (older) logLine(`WARNING: phone access is on with SillyTavern ${instances.describe(stRoot).version}, which is ${older.newer} release${older.newer === 1 ? '' : 's'} behind ${older.latest}${older.fixes.length ? ', and newer releases fixed security problems' : ''}. Other devices on your network can reach it; update it or turn phone access off.`);
        if (lan.hasWhitelistTxt(stRoot)) logLine('WARNING: SillyTavern\'s whitelist.txt decides who may connect, not this app. Add your network there, or remove the file.');
    }
    // Pass the port explicitly so the Settings value is what the server binds to.
    const child = spawn('node', ['server.js', '--port', String(settings.port)], {
        cwd: stRoot,
        windowsHide: true,
        env: instances.serverEnv(lanEnv),
        shell: false,
    });
    serverState.child = child;
    serverState.lanEnv = JSON.stringify(lanEnv); // to tell when a settings change needs a restart
    serverState.running = true;
    serverState.startedAt = Date.now();
    broadcast('server-started');

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
        broadcast('server-stopped');
    });
}

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

// Poll the server until it answers, then open the ST window.
let waitingForServer = false;
function waitForServerThenOpen({ reload = false } = {}) {
    // autoStart and the Open button can both land here; only one poller at a time.
    if (waitingForServer) return;
    waitingForServer = true;
    const started = Date.now();
    const timeout = 120000; // transformers.js can take a while on first run
    const tryFetch = () => {
        const req = http.get(`http://${settings.host}:${settings.port}/`, { timeout: 3000 }, res => {
            res.resume();
            if (res.statusCode && res.statusCode < 500) {
                waitingForServer = false;
                if (reload) stWins.forEach(w => w.reloadAll());
                openSillyTavernWindow();
            }
            else retry();
        });
        req.on('timeout', () => { req.destroy(); retry(); });
        req.on('error', retry);
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
        type: 'question', buttons: [okLabel, 'Cancel'], defaultId: 0, cancelId: 1, message, detail,
    });
    return response === 0;
}

const stRoot = () => settings.sillytavernPath;
const keep = () => settings.backupKeep;

// ---------- windows ----------
let launcherWin = null;
const stWins = new Set(); // SillyTavern windows (several when tabs are off)
let isQuitting = false;   // set once quitting is decided; closing the launcher then really closes it

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
    // With the tray on, closing only hides the launcher.
    launcherWin.on('close', e => {
        if (!tray || isQuitting) return;
        e.preventDefault();
        launcherWin.hide();
        if (!trayHintShown) {
            trayHintShown = true;
            tray.displayBalloon({ iconType: 'info', title: 'SillyTavern Desktop is still running', content: serverState.running ? 'The server keeps running. Click the tray icon to open the launcher.' : 'Click the tray icon to open the launcher.' });
        }
    });
    // Windows shutting down or signing out must not be held up by the tray.
    launcherWin.on('query-session-end', () => { isQuitting = true; });
    launcherWin.on('session-end', () => { isQuitting = true; });
    launcherWin.on('closed', () => { launcherWin = null; });
}

// ---------- tray ----------
// Only there while the closeToTray setting is on.
let tray = null;
let trayHintShown = false;

function trayMenu() {
    const w = stWindowState();
    return [
        { label: !w.open ? 'Open SillyTavern' : w.minimized ? 'Restore SillyTavern' : 'Show SillyTavern', click: () => (serverState.running ? openSillyTavernWindow() : startAndOpen()) },
        ...(w.open && !w.minimized ? [{ label: 'Minimize SillyTavern', click: minimizeStWindows }] : []),
        { label: 'Show launcher', click: showLauncher },
        ...(settings.profiles.length > 1 ? [{ label: 'Profile', submenu: profileMenu() }] : []),
        { type: 'separator' },
        serverState.running
            ? { label: 'Stop server', enabled: !busyTask, click: stopServer }
            : { label: 'Start server', enabled: !busyTask, click: () => startServer() },
        { type: 'separator' },
        { label: 'Quit', click: () => app.quit() },
    ];
}

function updateTray() {
    if (tray) tray.setToolTip(`SillyTavern Desktop — server ${serverState.running ? 'running' : 'stopped'}`);
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

// --- ST-specialized browser behavior ---
// Keeps a page on the local server; external links go to the real browser.
// host: the StWindow the page lives in, which takes new pages as tabs.
// instance: the SillyTavern the page belongs to; pages it opens stay in it.
function lockToServer(wc, host, instance) {
    ext.attachPage(wc);
    wc.on('will-navigate', (e, url) => { if (!isLocal(url)) { e.preventDefault(); openExternalSafe(url); } });
    wc.setWindowOpenHandler(({ url, disposition }) => {
        // about:blank is how extensions open a tab and fill it in afterwards.
        if (!isLocal(url) && url !== 'about:blank') {
            openExternalSafe(url);
            return { action: 'deny' };
        }
        const allow = { action: 'allow', overrideBrowserWindowOptions: { icon: path.join(__dirname, 'icon.ico'), autoHideMenuBar: true, webPreferences: instance.webPreferences } };
        // Real popups (window.open with a size) stay windows, as in a browser.
        if (settings.tabs && host && disposition !== 'new-window') {
            allow.createWindow = options => host.adoptTab(options, { background: disposition === 'background-tab', instance });
            // Electron closes opened pages with their opener; tabs shouldn't
            // vanish when the tab that opened them is closed.
            allow.outlivesOpener = true;
        }
        return allow;
    });
    wc.on('did-create-window', child => { child.setMenu(null); lockToServer(child.webContents, null, instance); });
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
    const url = `http://${settings.host}:${settings.port}/`;
    if (!mainInst || mainInst.url !== url) mainInst = { kind: 'main', url, webPreferences: stWebPreferences() };
    const d = instances.describe(stRoot());
    const name = prof.active(settings)?.name;
    return Object.assign(mainInst, {
        chip: `:${settings.port}`,
        tip: `${name ? `${name}: ` : ''}SillyTavern ${versionText(d)} on port ${settings.port}`,
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
        chip: `read-only :${settings.port}`,
        tip: `Read-only SillyTavern ${d.version} on port ${settings.port} (nothing is saved or sent)`,
        info: `READ-ONLY · ${d.version} · :${settings.port}`,
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
        chip: second ? `:${port} · 2nd` : `${d.version} :${port}`,
        tip: second ? `SillyTavern ${versionText(d)} on port ${port} (second server, same folder)` : `${name ? `${name}: ` : ''}SillyTavern ${versionText(d)} on port ${port} (${dir})`,
        info: second ? `${versionText(d)} · :${port} · 2nd server` : `${name ? `${name} · ` : ''}${versionText(d)} · :${port} · ${dir}`,
        onUnused: () => instances.stopServer(srv),
    };
    // Tabs of a server that stopped (or crashed) would only show an error.
    srv.child.once('exit', () => stWins.forEach(w => w.closeTabsOf(inst)));
    return inst;
}

// In the window it was asked from as a tab, or in a window of its own.
function openInstance(inst, from) {
    const w = from && !from.isDestroyed() ? from : [...stWins][0];
    if (settings.tabs && w) { w.newTab(inst); w.focus(); }
    else createStWindow(inst);
}

async function openSecondServer(from) {
    if (settings.warnSecondServer) {
        const { response, checkboxChecked } = await dialog.showMessageBox({
            type: 'warning', buttons: ['Start second server', 'Cancel'], defaultId: 0, cancelId: 1,
            message: 'Run a second server on the same SillyTavern folder?',
            detail: 'Both servers use the same chats, characters, presets and settings. If you change the same thing in both, the one that saves last wins. To only look at presets or chats, a read-only copy is safer.',
            checkboxLabel: "Don't show this again",
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
        { label: `Another ${where} of this SillyTavern`, accelerator: settings.tabs ? 'Ctrl+T' : undefined, registerAccelerator: false, click: () => openInstance(mainInstance(), w) },
        { label: 'Read-only copy (browse without saving or sending)', click: () => openInstance(readOnlyInstance(), w) },
        { label: 'This SillyTavern on another port', click: () => openSecondServer(w) },
        { type: 'separator' },
        ...(others.length
            ? others.map(o => ({ label: menuText(o.label), click: () => openExtra(o.path, 'other', w) }))
            : [{ label: 'No other SillyTavern installs found', enabled: false }]),
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
    const w = wins.find(x => x.tabs.some(t => t.instance.kind === 'main')) || wins[0];
    if (w) {
        // Minimized together from the launcher, so restored together too.
        wins.forEach(x => { if (x !== w && x.win.isMinimized()) x.win.restore(); });
        w.focus();
        return;
    }
    createStWindow(mainInstance());
}

function createStWindow(instance) {
    const w = new StWindow({
        instance,
        width: settings.windowWidth,
        height: settings.windowHeight,
        fullScreen: settings.windowFullScreen,
        layer: settings.windowLayer,
        colors: themes.get(settings.theme).colors,
        icon: path.join(__dirname, 'icon.ico'),
        setupPage: lockToServer,
        tabsEnabled: () => settings.tabs,
        menu: stWindowMenu,
        newMenu: newSillyTavernMenu,
        // Remember size and full screen — saved once on close, not on every resize
        onClose: ({ width, height, fullScreen }) => {
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
        layerItem('normal', 'Normal window (default)'),
        layerItem('top', 'Always on top'),
        layerItem('bottom', 'Stay in background'),
        { type: 'separator' },
        { label: 'Full screen', type: 'checkbox', checked: w.fullScreen, accelerator: 'F11', registerAccelerator: false, click: () => w.toggleFullScreen() },
        { label: 'Reload', accelerator: 'F5', registerAccelerator: false, click: () => w.reload() },
        { type: 'separator' },
        { label: 'New SillyTavern', submenu: newSillyTavernMenu(w) },
        ...(settings.profiles.length > 1 ? [{ label: 'Switch profile', submenu: profileMenu() }] : []),
        ...(ext.menuItems().length ? [{ label: 'Extensions', submenu: ext.menuItems() }] : []),
        { label: 'Open new pages as tabs', type: 'checkbox', checked: settings.tabs, click: () => setTabs(!settings.tabs) },
        { type: 'separator' },
        { label: 'Show launcher', click: showLauncher },
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
    desktopReleases: appUpdate.RELEASES_PAGE,
    extensionDocs: 'https://github.com/Lab-Fox/sillytavern-desktop/blob/main/EXTENSIONS.md',
};

ipcMain.handle('get-state', () => ({
    running: serverState.running,
    attached: serverState.attached,
    startedAt: serverState.startedAt,
    busy: busyTask,
    url: `http://${settings.host}:${settings.port}/`,
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
    if (!(await confirm('Start SillyTavern the classic way?',
        `${bat ? 'SillyTavern\'s own Start.bat' : 'node server.js'} runs in a command window of its own, without this app.${serverState.running ? ' This app\'s server stops first.' : ''}\n\nOpen SillyTavern in your browser once it says it is listening (or use "Open in browser" here). Close the command window to stop it.`,
        'Start'))) return false;
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
ipcMain.handle('update', () => runTask('Updating SillyTavern', () => tracked('update', () => mx.update(stRoot(), { backupFirst: settings.backupBeforeUpdate, keep: keep() }))));
ipcMain.handle('repair', async (_e, kind) => {
    const labels = { deps: 'Installing dependencies', 'clean-deps': 'Reinstalling dependencies', 'reset-lock': 'Resetting package-lock.json' };
    if (!labels[kind]) return false;
    if (kind === 'clean-deps' && !(await confirm('Reinstall all dependencies?', 'Deletes SillyTavern\'s node_modules folder and downloads everything again. Your chats and characters are not touched. Takes a few minutes.', 'Reinstall'))) return false;
    return runTask(labels[kind], () => mx.repair(stRoot(), kind));
});
ipcMain.handle('switch-branch', async (_e, branch) => {
    const about = branch === 'staging'
        ? 'Staging gets new features first but can be unstable.'
        : 'Release is the stable version most people use.';
    const backup = settings.backupBeforeUpdate
        ? 'Your data is backed up before switching.'
        : 'No backup is made first ("Back up before updating" is off in Settings).';
    if (!(await confirm(`Switch SillyTavern to ${branch}?`, `${about} ${backup}`, 'Switch'))) return false;
    return runTask(`Switching to ${branch}`, () => tracked('branch', () => mx.switchBranch(stRoot(), branch, { backupFirst: settings.backupBeforeUpdate, keep: keep() })));
});
ipcMain.handle('backup', () => runTask('Backing up', async () => !!(await mx.createBackup(stRoot(), 'manual', keep())), { needsStopped: false }));
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
    if (!(await confirm('Restore this backup?', `${name}\n\nYour current data folder is moved to backups/desktop first, so nothing is lost. The server restarts afterwards.`, 'Restore'))) return false;
    return runTask('Restoring backup', () => mx.restoreBackup(stRoot(), name, dir));
});
ipcMain.handle('delete-backup', async (_e, name, where = 'local') => {
    const dir = backupDirs()[where];
    if (!dir) return false;
    if (!(await confirm('Delete this backup permanently?', name, 'Delete'))) return false;
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
        return { ...bs.status(), error: 'Pick a folder outside your SillyTavern folders, for example on another drive.' };
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
ipcMain.handle('update-extensions', (_e, paths) => runTask('Updating extensions', async () => {
    let snap = null;
    const n = await mx.updateExtensions(stRoot(), { only: Array.isArray(paths) ? paths.map(String) : null, before: async exts => { snap = await sx.snapshotBefore(stRoot(), exts); } });
    if (snap && await sx.snapshotAfter(snap)) logLine('The versions from before this update were remembered: Extensions → Undo last update puts them back.');
    return n;
}, { needsStopped: false }));
ipcMain.handle('ext-undo', (_e, onlyPath) => runTask('Undoing extension updates', () => sx.undo(stRoot(), onlyPath ? String(onlyPath) : null), { needsStopped: false }));
// After installing, updating or going back: open SillyTavern pages load the new code.
ipcMain.handle('reload-st', () => { stWins.forEach(w => w.reloadAll()); return stWins.size; });
// Project pages and scan reports from the catalog: web links only.
ipcMain.handle('open-url', (_e, url) => { if (/^https:\/\//i.test(String(url))) openExternalSafe(String(url)); });

// The first install from the app says what extensions are (once, unless asked again).
async function installNotice() {
    if (settings.extInstallNoticeSeen) return true;
    const { response, checkboxChecked } = await dialog.showMessageBox(launcherWin, {
        type: 'warning', buttons: ['I understand, continue', 'Cancel'], defaultId: 0, cancelId: 1,
        message: 'Extensions run code inside SillyTavern',
        detail: 'An extension can read your chats, characters and settings, and talk to other websites. A safety rating is information about one version, not a guarantee. Install only extensions you trust, and read their page first.',
        checkboxLabel: "Don't show this again",
    });
    if (response !== 0) return false;
    if (checkboxChecked) { settings.extInstallNoticeSeen = true; saveSettings(settings); }
    return true;
}
const installedSet = () => new Set(mx.installedRemotes(stRoot()).map(i => sx.normUrl(i.remote)).filter(Boolean));
// Several at once (a Kit) or one (from the catalog). items: [{ url, scope, commit, name, branch }]
async function installMany(label, items) {
    if (busyTask) return { error: `Busy with "${busyTask}" — wait for it to finish.` };
    if (!setup.isStRoot(stRoot())) return { error: 'Choose your SillyTavern first.' };
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
    if (!e) return { error: 'That extension is not in the catalog anymore.' };
    if (installedSet().has(sx.normUrl(e.url))) return { error: `${e.name} is already installed.` };
    return installMany(`Installing ${e.name}`, [{ url: e.repo.replace(/\.git$/, ''), branch: e.branch, name: e.name }]);
});

// Kits: saved sets of extensions, usable in every profile.
ipcMain.handle('kits', () => {
    const have = installedSet();
    return sx.kits().map(k => ({ ...k, extensions: k.extensions.map(x => ({ ...x, installed: have.has(sx.normUrl(x.url)), rating: sx.rate({ remote: x.url, head: x.commit }) })) }));
});
ipcMain.handle('kit-save', async (_e, name, description) => {
    const exts = (await mx.listExtensions(stRoot())).filter(x => x.isGit && x.remote);
    if (!exts.length) return { error: 'No extensions installed with Git, so there is nothing to save.' };
    try {
        const kit = sx.saveKit({ name, description, created: Date.now(), extensions: exts.map(x => ({ name: x.name, url: x.remote, scope: x.scope === 'all users' ? 'all users' : 'user', commit: x.head })) });
        logLine(`Saved the Kit "${kit.name}" (${kit.extensions.length} extensions).`);
        return { ok: true, kit };
    } catch (e) { return { error: e.message }; }
});
ipcMain.handle('kit-import', async () => {
    const r = await dialog.showOpenDialog(launcherWin, { title: 'Import a Kit', filters: [{ name: 'Kit', extensions: ['json'] }], properties: ['openFile'] });
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
    const r = await dialog.showSaveDialog(launcherWin, { title: 'Export Kit', defaultPath: `${String(id)}.kit.json`, filters: [{ name: 'Kit', extensions: ['json'] }] });
    if (r.canceled) return false;
    fs.writeFileSync(r.filePath, json);
    logLine(`Exported the Kit to ${r.filePath}.`);
    return true;
});
ipcMain.handle('kit-delete', async (_e, id) => {
    const kit = sx.kits().find(k => k.id === id);
    if (!kit || !(await confirm(`Delete the Kit "${kit.name}"?`, 'Only the saved list is deleted. Installed extensions stay.', 'Delete'))) return false;
    return sx.deleteKit(String(id));
});
// urls: the missing extensions the user kept ticked; exact: the Kit's versions instead of the newest.
ipcMain.handle('kit-install', (_e, id, urls, exact) => {
    const kit = sx.kits().find(k => k.id === id);
    if (!kit) return { error: 'That Kit no longer exists.' };
    const have = installedSet();
    const want = new Set((Array.isArray(urls) ? urls : []).map(u => sx.normUrl(u)));
    const items = kit.extensions.filter(x => !have.has(sx.normUrl(x.url)) && want.has(sx.normUrl(x.url))).map(x => ({ ...x, commit: exact ? x.commit : '' }));
    if (!items.length) return { error: 'Nothing to install: those extensions are already there.' };
    return installMany(`Installing from the Kit "${kit.name}"`, items);
});

ipcMain.handle('health-check', () => mx.healthCheck(stRoot(), { running: serverState.running }));
ipcMain.handle('open-place', (_e, key) => {
    const p = PLACES[key]?.();
    if (!p) return;
    if (key !== 'config') fs.mkdirSync(p, { recursive: true });
    return shell.openPath(p);
});
ipcMain.handle('open-link', (_e, key) => { if (LINKS[key]) shell.openExternal(LINKS[key]); });
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
        // Started with different phone settings than the current ones.
        needsRestart: ours && serverState.lanEnv !== JSON.stringify(lan.serverEnv(settings)),
        whitelistTxt: lan.hasWhitelistTxt(stRoot()),
        older: dl.olderStatus(instances.describe(stRoot()).version),
        addresses: lan.phoneAddresses(settings.port).map(a => ({ ...a, qr: lan.qrSvg(a.url) })),
    };
}
ipcMain.handle('lan-info', () => lanInfo());
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
    if (info.needsRestart) await runTask('Restarting the server for phone access', async () => true);
    return lanInfo();
});

// SillyTavern's login (phone access with a password) shouldn't ask in the app's own window.
// A wrong answer makes Chromium ask again, so two tries per 10 s, then it's left to fail
// (e.g. the server still runs with the old password until it restarts).
const loginTries = new Map();
app.on('login', (e, _wc, details, authInfo, callback) => {
    if (authInfo.isProxy || !settings.lanAccess || !settings.lanPassword || !isLocal(details.url) || Number(authInfo.port) !== settings.port) return;
    const now = Date.now();
    const recent = (loginTries.get(authInfo.port) || []).filter(t => now - t < 10000);
    if (recent.length >= 2) return;
    loginTries.set(authInfo.port, [...recent, now]);
    e.preventDefault();
    callback(settings.lanUser || 'user', settings.lanPassword);
});

// ---------- app updates ----------
ipcMain.handle('app-update-state', () => appUpdate.getState());
ipcMain.handle('app-update-check', () => appUpdate.check({ fresh: true }));
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
        if (!(await confirm(`Turn on "${e.name}"?`, `${e.description ? `${e.description}\n\n` : ''}Desktop extensions run with full access to your PC, like any program you install. Only turn on extensions you trust.`, 'Turn on'))) return false;
    }
    settings.desktopExtensions = { ...settings.desktopExtensions, [id]: !!on };
    if (!on) delete settings.desktopExtensions[id];
    saveSettings(settings);
    await (on ? ext.activate(id) : ext.deactivate(id));
    return true;
});
ipcMain.handle('ext:reload', () => ext.reloadAll());
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
        && !(await confirm(`Switch to "${p.name}"?`, `The server restarts with the SillyTavern in ${p.path}, and open SillyTavern tabs reload. Text you haven't sent yet is lost.`, 'Switch'))) return false;
    return runTask(`Switching to profile "${p.name}"`, () => switchTo(p.path));
}

async function pickFolder(title, defaultPath) {
    const r = await dialog.showOpenDialog(launcherWin, { title, defaultPath, properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
}

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
    return runTask('Switching SillyTavern install', () => switchTo(dir));
});
// Accept the SillyTavern folder itself or a folder that contains it.
ipcMain.handle('browse-install', async () => {
    const dir = await pickFolder('Select your SillyTavern folder', os.homedir());
    if (!dir) return { canceled: true };
    for (const cand of [dir, path.join(dir, 'SillyTavern')]) {
        if (setup.isStRoot(cand)) {
            await runTask('Switching SillyTavern install', () => switchTo(cand));
            return { ok: true, path: cand };
        }
    }
    return { error: `No SillyTavern found in ${dir}. Pick the folder that contains server.js.` };
});
ipcMain.handle('install-requirements', () => runTask('Installing Node.js and Git', () => setup.installRequirements(), { needsStopped: false }));
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
    return runTask('Getting Node.js and Git', async () => {
        const ok = await rt.install(which, text => broadcast('runtime-progress', text));
        broadcast('runtime-progress', '');
        turnOn();
        return ok;
    }, { needsStopped: have.active && which.some(w => have[w]) });
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
    if (!(await confirm('Remove this app\'s own Node.js and Git?', 'The app goes back to the Node.js and Git installed on this PC. If they aren\'t installed, SillyTavern can\'t start until you install them or download the app\'s own copy again.', 'Remove'))) return false;
    return runTask('Removing Node.js and Git', async () => {
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
    if (!target) return { error: 'That profile is not available.' };
    // Sorted again here: the launcher only says which files.
    const items = (Array.isArray(paths) ? paths : []).slice(0, 200).map(p => imp.classify(String(p))).filter(i => i.kind);
    if (!items.length) return { error: 'None of these files can be imported.' };
    let res = null;
    return runTask('Importing', async () => {
        let base, srv = null, auth;
        if (target.active) {
            if (!serverState.running) { logLine('Starting the server to import …'); await startServer(); }
            if (!(await serverUp())) { res = { error: 'SillyTavern did not start (see the Console).' }; return false; }
            base = mainInstance().url;
            if (settings.lanAccess && settings.lanPassword) auth = { user: settings.lanUser, password: settings.lanPassword };
        } else {
            // Another profile: its server just for the import, unless one already runs.
            srv = instances.find(target.path);
            if (!srv) {
                srv = instances.startServer(target.path, await instances.freePort(settings.port + 1, [settings.port]), `import into ${target.name}`);
                srv.temporary = true;
            }
            if (!(await srv.ready)) { res = { error: `SillyTavern in "${target.name}" did not start (see the Console).` }; return false; }
            base = `http://${settings.host}:${srv.port}/`;
        }
        try {
            const results = await imp.importAll(base, target.path, items);
            results.forEach(r => logLine(r.ok ? `Imported ${r.file} as ${r.as} into "${target.name}".` : `Could not import ${r.file}: ${r.error}`));
            res = { results, profile: target.name, reloadable: target.active && stWins.size > 0 };
        } catch (e) {
            res = { error: e.message };
        } finally {
            if (srv?.temporary) await instances.stopServer(srv);
        }
        return true;
    }, { needsStopped: false }).then(() => res || { error: 'Busy with another task. Try again when it has finished.' });
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
    if (wasActive && busyTask && !prof.sameDir(oldPath, data?.path)) return { error: `Busy with "${busyTask}" — try again when it has finished.` };
    const r = prof.save(settings, { id: data?.id, name: data?.name, path: String(data?.path || '') });
    if (r.error) return r;
    if (wasActive && !prof.sameDir(oldPath, r.profile.path)) {
        const ok = await runTask(`Switching to profile "${r.profile.name}"`, () => switchTo(r.profile.path));
        if (!ok) { r.profile.path = oldPath; profilesChanged(); return { error: 'The folder could not be changed now (see the Console).' }; }
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
    if (prof.sameDir(p.path, stRoot())) return { error: 'This profile is in use. Switch to another profile first.' };
    if (!(await confirm(`Remove the profile "${p.name}"?`, `Only the profile is removed. The SillyTavern folder stays where it is:\n${p.path}`, 'Remove'))) return false;
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
    if (!found) return { error: `No SillyTavern found in ${dir}. Pick the folder that contains server.js.` };
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

// ---------- downloading SillyTavern ----------
ipcMain.handle('st-versions', (_e, fresh) => dl.listVersions({ fresh: !!fresh }).catch(e => ({ error: e.message })));
ipcMain.handle('download-target', (_e, parent, folder) => dl.targetInfo(String(parent || ''), String(folder || '')));
// Where new installs go by default: next to the one in use.
ipcMain.handle('download-defaults', () => ({ parent: setup.isStRoot(stRoot()) ? path.dirname(stRoot()) : os.homedir() }));
ipcMain.handle('pick-parent', (_e, from) => pickFolder('Where should the new SillyTavern go? (its folder is created inside)', from && fs.existsSync(from) ? from : os.homedir()));
ipcMain.handle('st-download', async (_e, o = {}) => {
    if (busyTask) return { error: `Busy with "${busyTask}" — wait for it to finish.` };
    const req = await setup.checkRequirements();
    if (!req.node.ok || !req.git.ok) return { error: 'Node.js and Git are needed first (Maintenance → Back end, or the welcome screen installs them).' };
    const name = String(o.name || '').trim();
    if (name && settings.profiles.some(p => p.name.toLowerCase() === name.toLowerCase())) return { error: `There is already a profile called "${name}".` };
    const target = dl.targetInfo(String(o.parent || ''), String(o.folder || ''));
    if (!target.ok) return { error: target.problem };
    const ref = String(o.ref || '');
    let res = null;
    const progress = p => { if (launcherWin && !launcherWin.isDestroyed()) launcherWin.webContents.send('st-download', p); };
    await runTask(`Downloading SillyTavern ${ref}`, async () => {
        res = await dl.download({ ref, parent: o.parent, folder: o.folder }, progress);
        return !!res.path;
    }, { needsStopped: false });
    if (!res) return { error: 'The download could not start (see the Console).' };
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
    if (!found) return { error: `No SillyTavern found in ${dir}. Pick the folder that contains server.js.` };
    migFolders.add(found);
    return { path: found, name: found, version: instances.describe(found).version, users: mig.users(found) };
});
ipcMain.handle('mig-scan', async (_e, o = {}) => {
    if (!migOk(o.src) || !migOk(o.dst)) return { error: 'Pick two SillyTavern folders.' };
    const srcUser = migUser(o.srcUser), dstUser = migUser(o.dstUser);
    if (prof.sameDir(o.src, o.dst) && srcUser === dstUser) return { error: 'The source and the target are the same. Pick another folder or another user.' };
    if (!fs.existsSync(path.join(o.src, 'data', srcUser))) return { error: `There is no data for the user "${srcUser}" in ${o.src} (it may never have been started).` };
    try {
        const r = await mig.scan({ src: o.src, srcUser, dst: o.dst, dstUser });
        return { ...r, srcVersion: instances.describe(o.src).version, dstVersion: instances.describe(o.dst).version };
    } catch (e) { return { error: `Could not read the folders: ${e.message}` }; }
});
ipcMain.handle('mig-preview', (_e, id, keys, policy) => mig.preview(String(id), Array.isArray(keys) ? keys.map(String) : [], String(policy)));
ipcMain.handle('mig-run', async (_e, o = {}) => {
    if (busyTask) return { error: `Busy with "${busyTask}" — wait for it to finish.` };
    if (!migOk(o.dst)) return { error: 'Pick the target folder again.' };
    const keys = Array.isArray(o.keys) ? o.keys.map(String) : [];
    const policy = ['skip', 'newer', 'replace'].includes(o.policy) ? o.policy : 'skip';
    const toActive = prof.sameDir(o.dst, stRoot());
    let res = null;
    const progress = p => { if (launcherWin && !launcherWin.isDestroyed()) launcherWin.webContents.send('mig-progress', p); };
    // The target must not be running: its server would overwrite what's copied.
    await runTask('Migrating data', async () => {
        await instances.stopAll(o.dst);
        if (o.backupFirst) {
            const b = await mx.createBackup(o.dst, 'auto-before-migration', keep());
            if (!b) { res = { error: 'The backup failed, so nothing was copied (see the Console).' }; return false; }
        }
        res = await mig.run(String(o.id), keys, policy, progress);
        return !res.error;
    }, { needsStopped: toActive });
    return res || { error: 'The migration could not start (see the Console).' };
});
ipcMain.handle('mig-cancel', () => mig.cancel());
ipcMain.handle('mig-journals', (_e, dir) => (migOk(dir) ? mig.journals(dir) : []));
ipcMain.handle('mig-undo', async (_e, dir, id) => {
    if (!migOk(dir)) return false;
    const j = mig.journals(dir).find(x => x.id === id);
    if (!j) return false;
    if (!(await confirm('Undo this migration?', `From ${j.from}, ${new Date(j.at).toLocaleString()}.\n\nRemoves the ${j.added} files it added and puts back the ${j.replaced} files it replaced. Changes you made to those files since then are lost.`, 'Undo'))) return false;
    return runTask('Undoing a migration', async () => { await instances.stopAll(dir); return mig.undo(dir, String(id)); }, { needsStopped: prof.sameDir(dir, stRoot()) });
});

ipcMain.handle('open-st-release', (_e, v) => {
    if (/^\d+\.\d+\.\d+$/.test(String(v))) shell.openExternal(`https://github.com/SillyTavern/SillyTavern/releases/tag/${v}`);
});
ipcMain.handle('update-backend', async () => {
    if (!(await confirm('Update Node.js and Git?', 'Installs the latest Node.js (LTS) and Git with winget, then reinstalls SillyTavern\'s dependencies to match. Windows may ask for permission. The server restarts afterwards.', 'Update'))) return false;
    return runTask('Updating Node.js and Git', () => setup.updateBackend(stRoot()));
});
ipcMain.handle('move-st', async () => {
    const from = stRoot();
    if (!setup.isStRoot(from)) return false;
    const parent = await pickFolder(`Move SillyTavern — choose the new parent folder (a "${path.basename(from)}" folder is created inside)`, path.dirname(from));
    if (!parent) return false;
    return runTask('Moving SillyTavern', async () => {
        const r = await setup.moveInstall(from, parent);
        if (!r) return false;
        prof.moved(settings, from, r.to);
        hist.moved(from, r.to);
        useInstall(r.to);
        if (r.copied && await confirm('Delete the old copy?', `SillyTavern now runs from:\n${r.to}\n\nThe old copy is still at:\n${from}`, 'Delete old copy')) {
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
ipcMain.handle('list-themes', () => ({ active: themes.get(settings.theme).id, themes: themes.list() }));
ipcMain.handle('set-theme', (_e, id) => setTheme(id));
ipcMain.handle('save-theme', (_e, raw, id) => {
    try {
        const newId = themes.save(raw, id);
        setTheme(newId);
        return { ok: true, id: newId };
    } catch (e) { return { error: e.message }; }
});
ipcMain.handle('delete-theme', async (_e, id) => {
    const t = themes.get(id);
    if (t.builtin || !(await confirm(`Delete the theme "${t.name}"?`, 'This removes it from this app. Export it first if you want to keep a copy.', 'Delete'))) return false;
    themes.remove(id);
    if (settings.theme === id) setTheme('sillytavern');
    else broadcast('theme');
    return true;
});
ipcMain.handle('import-theme', async () => {
    const r = await dialog.showOpenDialog(launcherWin, { title: 'Import a theme', filters: [{ name: 'SillyTavern Desktop theme', extensions: ['json'] }], properties: ['openFile'] });
    if (r.canceled) return { canceled: true };
    try {
        const file = r.filePaths[0];
        if (fs.statSync(file).size > 1024 * 1024) throw new Error('That file is too large to be a theme.');
        let raw;
        try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new Error('That file is not valid theme JSON.'); }
        const id = themes.save(raw);
        setTheme(id);
        logLine(`Imported theme "${themes.get(id).name}".`);
        return { ok: true, id };
    } catch (e) { return { error: e.message }; }
});
ipcMain.handle('export-theme', async (_e, id) => {
    const t = themes.get(id);
    const r = await dialog.showSaveDialog(launcherWin, { title: 'Export theme', defaultPath: `${t.name.replace(/[^\w -]/g, '')}.json`, filters: [{ name: 'Theme', extensions: ['json'] }] });
    if (r.canceled) return false;
    fs.writeFileSync(r.filePath, themes.exportJson(id));
    logLine(`Exported theme "${t.name}" to ${r.filePath}.`);
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
            sillytavern: {
                folder: () => stRoot(),
                url: () => mainInstance().url,
                info: () => ({ ...instances.describe(stRoot()), port: settings.port, running: serverState.running }),
                // Only paths on the main server: an extension can't point a tab elsewhere.
                openTab: p => openInstance({ ...mainInstance(), url: new URL(p.replace(/^\/*/, '/'), mainInstance().url).href }),
            },
        });
        themes.initThemes(USER_DATA);
        appUpdate.initAppUpdate({ userData: USER_DATA, logLine, send: s => { if (launcherWin && !launcherWin.isDestroyed()) launcherWin.webContents.send('app-update', s); } });
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
                buttons: ['Quit', 'Cancel'],
                defaultId: 0,
                message: 'The SillyTavern server is still running.',
                detail: 'Quitting stops the server. Unsaved chats in other tabs will be lost.',
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
