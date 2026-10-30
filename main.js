// ENI's SillyTavern Desktop — main process
// Wraps the SillyTavern server as a hidden child process and
// renders it in a dedicated Chromium window. No cmd, ever.
import { app, BrowserWindow, Menu, ipcMain, shell, dialog, clipboard } from 'electron';
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
    backupBeforeUpdate: true,   // zip data/ before every update or branch switch
    checkUpdatesOnLaunch: true, // git fetch on startup so the dashboard can say "update available"
    backupKeep: 10,             // automatic backups kept; manual ones are never pruned
    theme: 'sillytavern',       // launcher theme id (see themes.js)
};
function loadSettings() {
    try {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) };
    } catch {
        return { ...DEFAULT_SETTINGS };
    }
}
function saveSettings(s) {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 4));
}
let settings = loadSettings();
let userscriptsDir = path.join(USER_DATA, 'userscripts');

// Chromium stops drawing windows it thinks are fully covered. "Stay in
// background" keeps the SillyTavern window covered on purpose, and coming
// back from that left the top bar blank.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

// ---------- single instance lock ----------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        const w = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('launcher'));
        if (w) {
            if (w.isMinimized()) w.restore();
            w.focus();
        }
    });
}

// ---------- server manager ----------
// attached: we found a server we didn't spawn, so we can't stop it.
const serverState = { child: null, running: false, attached: false, startedAt: 0, logs: [] };

function broadcast(channel, ...args) {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, ...args);
    if (channel === 'server-started' || channel === 'server-stopped') ext.emit(channel);
}

function logLine(line) {
    // Strip ANSI color codes — the server colors its output for terminals.
    const entry = `[${new Date().toLocaleTimeString()}] ${line.replace(/\x1b\[[0-9;]*m/g, '')}`;
    serverState.logs.push(entry);
    if (serverState.logs.length > 500) serverState.logs.shift();
    try { fs.appendFileSync(DEBUG_LOG, entry + '\n'); } catch { /* disk hiccup — don't die over it */ }
    for (const w of BrowserWindow.getAllWindows()) {
        if (!w.webContents.getURL().includes('127.0.0.1') && !w.webContents.getURL().includes('localhost')) {
            w.webContents.send('server-log', entry);
        }
    }
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
    // Pass the port explicitly so the Settings value is what the server binds to.
    const child = spawn('node', ['server.js', '--port', String(settings.port)], {
        cwd: stRoot,
        windowsHide: true,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
        shell: false,
    });
    serverState.child = child;
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
    child.stdout.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => logLine(l.trim())));
    child.stderr.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => logLine(`[stderr] ${l.trim()}`)));
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
    if (!serverState.child) return;
    logLine('Stopping server...');
    // taskkill /T kills the whole process tree (node spawns children e.g. transformers)
    if (process.platform === 'win32') {
        spawn('taskkill', ['/PID', String(serverState.child.pid), '/T', '/F'], { windowsHide: true });
    } else {
        serverState.child.kill('SIGTERM');
    }
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

function stopServerAndWait() {
    return new Promise(resolve => {
        if (!serverState.running) return resolve(true);
        if (serverState.attached) {
            logLine('The server was started outside this app — stop it there first.');
            return resolve(false);
        }
        serverState.child.once('exit', () => setTimeout(() => resolve(true), 500));
        stopServer();
    });
}

async function runTask(label, fn, { needsStopped = true } = {}) {
    if (busyTask) { logLine(`Busy with "${busyTask}" — wait for it to finish.`); return false; }
    busyTask = label;
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
        broadcast('busy', '');
        broadcast('refresh');
        if (restart) startServer().then(() => waitForServerThenOpen({ reload: true }));
    }
}

async function confirm(message, detail, okLabel) {
    const { response } = await dialog.showMessageBox(launcherWin, {
        type: 'question', buttons: [okLabel, 'Cancel'], defaultId: 0, cancelId: 1, message, detail,
    });
    return response === 0;
}

const stRoot = () => settings.sillytavernPath;
const keep = () => settings.backupKeep;

// ---------- windows ----------
let launcherWin = null;
const stWins = new Set(); // SillyTavern windows (several when tabs are off)

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
    launcherWin.on('closed', () => { launcherWin = null; });
}

// Shared by the main ST window and any tab it opens (e.g. Character Library).
// The preload runs in sub-frames too so userscripts reach embedded iframes.
function stWebPreferences() {
    return {
        preload: path.join(__dirname, 'st-preload.js'),
        nodeIntegrationInSubFrames: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
    };
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
    wc.on('will-navigate', (e, url) => { if (!isLocal(url)) { e.preventDefault(); shell.openExternal(url); } });
    wc.setWindowOpenHandler(({ url, disposition }) => {
        // about:blank is how extensions open a tab and fill it in afterwards.
        if (!isLocal(url) && url !== 'about:blank') {
            shell.openExternal(url);
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
    return Object.assign(mainInst, {
        chip: `:${settings.port}`,
        tip: `SillyTavern ${versionText(d)} on port ${settings.port}`,
        info: `${versionText(d)} · :${settings.port}`,
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
    const srv = instances.startServer(dir, port, second ? 'second server' : `SillyTavern ${d.version}`);
    const inst = {
        kind, server: srv,
        url: `http://${settings.host}:${port}/`,
        webPreferences: { ...stWebPreferences(), partition: instances.partitionFor(dir) },
        chip: second ? `:${port} · 2nd` : `${d.version} :${port}`,
        tip: second ? `SillyTavern ${versionText(d)} on port ${port} (second server, same folder)` : `SillyTavern ${versionText(d)} on port ${port} (${dir})`,
        info: second ? `${versionText(d)} · :${port} · 2nd server` : `${versionText(d)} · :${port} · ${dir}`,
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
    openInstance(await extraInstance(stRoot(), 'port'), from);
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
    return [
        { label: `Another ${where} of this SillyTavern`, accelerator: settings.tabs ? 'Ctrl+T' : undefined, registerAccelerator: false, click: () => openInstance(mainInstance(), w) },
        { label: 'Read-only copy (browse without saving or sending)', click: () => openInstance(readOnlyInstance(), w) },
        { label: 'This SillyTavern on another port', click: () => openSecondServer(w) },
        { type: 'separator' },
        ...(otherInstalls.length
            ? otherInstalls.map(i => ({ label: `SillyTavern ${i.version} — ${i.path}`, click: () => extraInstance(i.path, 'other').then(inst => openInstance(inst, w)) }))
            : [{ label: 'No other SillyTavern installs found', enabled: false }]),
    ];
}

function openSillyTavernWindow() {
    const first = [...stWins][0];
    if (first) { first.focus(); return; }
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
    w.win.on('closed', () => stWins.delete(w));
    return w;
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
    broadcast('settings', settings);
}

function setLayer(mode) {
    if (!LAYERS.includes(mode)) return;
    settings.windowLayer = mode;
    saveSettings(settings);
    stWins.forEach(w => w.setLayer(mode));
    broadcast('settings', settings);
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
    extensionDocs: 'https://github.com/Lab-Fox/sillytavern-desktop/blob/main/EXTENSIONS.md',
};

ipcMain.handle('get-state', () => ({
    running: serverState.running,
    attached: serverState.attached,
    startedAt: serverState.startedAt,
    busy: busyTask,
    url: `http://${settings.host}:${settings.port}/`,
    settings,
    logs: serverState.logs,
}));
ipcMain.handle('start-server', () => startServer().then(() => waitForServerThenOpen()));
ipcMain.handle('stop-server', () => stopServer());
ipcMain.handle('open-st', () => {
    if (serverState.running) { openSillyTavernWindow(); return; }
    return startServer().then(() => waitForServerThenOpen());
});
ipcMain.handle('st-info', () => mx.getInfo(stRoot()));
ipcMain.handle('check-updates', () => mx.checkForUpdates(stRoot()));
ipcMain.handle('update', () => runTask('Updating SillyTavern', () => mx.update(stRoot(), { backupFirst: settings.backupBeforeUpdate, keep: keep() })));
ipcMain.handle('repair', async (_e, kind) => {
    const labels = { deps: 'Installing dependencies', 'clean-deps': 'Reinstalling dependencies', 'reset-lock': 'Resetting package-lock.json' };
    if (!labels[kind]) return false;
    if (kind === 'clean-deps' && !(await confirm('Reinstall all dependencies?', 'Deletes SillyTavern\'s node_modules folder and downloads everything again. Your chats and characters are not touched. Takes a few minutes.', 'Reinstall'))) return false;
    return runTask(labels[kind], () => mx.repair(stRoot(), kind));
});
ipcMain.handle('switch-branch', async (_e, branch) => {
    const detail = branch === 'staging'
        ? 'Staging gets new features first but can be unstable. Your data is backed up before switching.'
        : 'Release is the stable version most people use. Your data is backed up before switching.';
    if (!(await confirm(`Switch SillyTavern to ${branch}?`, detail, 'Switch'))) return false;
    return runTask(`Switching to ${branch}`, () => mx.switchBranch(stRoot(), branch, { keep: keep() }));
});
ipcMain.handle('backup', () => runTask('Backing up', async () => !!(await mx.createBackup(stRoot(), 'manual', keep())), { needsStopped: false }));
ipcMain.handle('list-backups', () => mx.listBackups(stRoot()));
ipcMain.handle('restore-backup', async (_e, name) => {
    if (!(await confirm('Restore this backup?', `${name}\n\nYour current data folder is moved to backups/desktop first, so nothing is lost. The server restarts afterwards.`, 'Restore'))) return false;
    return runTask('Restoring backup', () => mx.restoreBackup(stRoot(), name));
});
ipcMain.handle('delete-backup', async (_e, name) => {
    if (!(await confirm('Delete this backup permanently?', name, 'Delete'))) return false;
    const ok = mx.deleteBackup(stRoot(), name);
    broadcast('refresh');
    return ok;
});
ipcMain.handle('list-extensions', (_e, fetch) => mx.listExtensions(stRoot(), { fetch: !!fetch }));
ipcMain.handle('update-extensions', () => runTask('Updating extensions', () => mx.updateExtensions(stRoot()), { needsStopped: false }));
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
    logLine('Settings saved.');
});

// ---------- setup, requirements, install location ----------
function useInstall(dir) {
    settings.sillytavernPath = dir;
    saveSettings(settings);
    logLine(`Using SillyTavern at ${dir}.`);
    broadcast('refresh');
}

async function pickFolder(title, defaultPath) {
    const r = await dialog.showOpenDialog(launcherWin, { title, defaultPath, properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
}

ipcMain.handle('setup-state', async () => ({
    ready: setup.isStRoot(stRoot()),
    current: stRoot(),
    installs: setup.detectInstalls(exeBases()),
    requirements: await setup.checkRequirements(),
}));
// Switching installs restarts the server (if running) on the new one.
ipcMain.handle('use-install', (_e, dir) => {
    if (!setup.isStRoot(dir)) return false;
    return runTask('Switching SillyTavern install', async () => { useInstall(dir); return true; });
});
// Accept the SillyTavern folder itself or a folder that contains it.
ipcMain.handle('browse-install', async () => {
    const dir = await pickFolder('Select your SillyTavern folder', os.homedir());
    if (!dir) return { canceled: true };
    for (const cand of [dir, path.join(dir, 'SillyTavern')]) {
        if (setup.isStRoot(cand)) {
            await runTask('Switching SillyTavern install', async () => { useInstall(cand); return true; });
            return { ok: true, path: cand };
        }
    }
    return { error: `No SillyTavern found in ${dir}. Pick the folder that contains server.js.` };
});
ipcMain.handle('install-requirements', () => runTask('Installing Node.js and Git', () => setup.installRequirements(), { needsStopped: false }));
ipcMain.handle('install-st', async () => {
    const parent = await pickFolder('Where should SillyTavern be installed? (a "SillyTavern" folder is created inside)', os.homedir());
    if (!parent) return false;
    return runTask('Installing SillyTavern', async () => {
        const dir = await setup.installSillyTavern(parent);
        if (dir) useInstall(dir);
        return !!dir;
    }, { needsStopped: false });
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
    let isQuitting = false;

    app.whenReady().then(() => {
        // Plain Chrome UA: Electron/app tokens make Cloudflare-gated sites
        // (used by community extensions) challenge harder or refuse outright.
        app.userAgentFallback = app.userAgentFallback
            .replace(/ Electron\/\S+/, '')
            .replace(/ sillytavern-?desktop\/\S+/i, '');
        userscriptsDir = setupUserscripts({ userData: USER_DATA, logLine }).scriptsDir;
        mx.initMaintenance({ logLine });
        setup.initSetup({ logLine });
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
        createLauncherWindow();
        ext.activateEnabled();
        if (!ensureInstall()) return; // the welcome screen takes it from here
        refreshInstalls();
        if (settings.checkUpdatesOnLaunch) {
            mx.checkForUpdates(stRoot()).then(info => {
                if (info.behind > 0) logLine(`A SillyTavern update is available (${info.behind} new commit${info.behind === 1 ? '' : 's'} on ${info.branch}).`);
                broadcast('refresh');
            });
        }
        if (settings.autoStart) startServer().then(() => waitForServerThenOpen());
    });

    app.on('window-all-closed', () => {
        // User already closed every window — treat that as intent to quit;
        // don't hit them with the confirmation dialog a second time.
        isQuitting = true;
        stopServer();
        instances.stopAll();
        app.quit();
    });
    // Extra servers (second port, other installs) never outlive the app.
    app.on('will-quit', () => { instances.stopAll(); });

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
        }
    });
}
