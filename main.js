// ENI's SillyTavern Desktop — main process
// Wraps the SillyTavern server as a hidden child process and
// renders it in a dedicated Chromium window. No cmd, ever.
import { app, BrowserWindow, Menu, ipcMain, shell, dialog } from 'electron';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import http from 'http';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Packaged builds run from inside a read-only asar — settings and logs must
// live in userData, and the default SillyTavern path must be computed from
// the real exe location (portable exe sits in <root>/ST-Desktop/dist).
const USER_DATA = app.getPath('userData');
fs.mkdirSync(USER_DATA, { recursive: true });
const SETTINGS_FILE = path.join(USER_DATA, 'settings.json');
const DEBUG_LOG = path.join(USER_DATA, 'desktop-debug.log');

// Resolve the SillyTavern install. Portable builds self-extract to a temp
// dir before running, so process.execPath is useless there — but
// electron-builder hands us PORTABLE_EXECUTABLE_DIR. We then *verify*
// server.js exists instead of trusting any single guess.
function resolveStRoot() {
    if (!app.isPackaged) return path.resolve(__dirname, '..', 'SillyTavern');
    const bases = [];
    if (process.env.PORTABLE_EXECUTABLE_DIR) bases.push(process.env.PORTABLE_EXECUTABLE_DIR);
    if (process.env.PORTABLE_EXECUTABLE_FILE) bases.push(path.dirname(process.env.PORTABLE_EXECUTABLE_FILE));
    bases.push(path.dirname(process.execPath));
    const rels = ['../..', '..', '.', '../../..'];
    for (const b of bases) {
        for (const r of rels) {
            const cand = path.resolve(b, r, 'SillyTavern');
            if (fs.existsSync(path.join(cand, 'server.js'))) return cand;
        }
    }
    return path.resolve(bases[0] || process.cwd(), '..', '..', 'SillyTavern');
}
const DEFAULT_ST_ROOT = resolveStRoot();

// ---------- settings ----------
const DEFAULT_SETTINGS = {
    sillytavernPath: DEFAULT_ST_ROOT,
    port: 8000,
    host: '127.0.0.1',
    windowWidth: 1280,
    windowHeight: 800,
    autoStart: true,      // start server + open ST window immediately on app launch
    confirmBeforeQuit: true,
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
const serverState = { child: null, running: false, logs: [] };

function logLine(line) {
    const entry = `[${new Date().toLocaleTimeString()}] ${line}`;
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
        return;
    }
    const stRoot = settings.sillytavernPath;
    if (!fs.existsSync(path.join(stRoot, 'server.js'))) {
        logLine(`ERROR: server.js not found at ${stRoot}. Fix the path in Settings.`);
        return;
    }
    logLine(`Starting SillyTavern server from ${stRoot} ...`);
    const child = spawn('node', ['server.js'], {
        cwd: stRoot,
        windowsHide: true,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
        shell: false,
    });
    serverState.child = child;
    serverState.running = true;

    // If node can't even be spawned (ENOENT etc.) we get 'error', not 'exit'.
    child.on('error', err => {
        serverState.running = false;
        serverState.child = null;
        logLine(`ERROR: failed to launch node: ${err.message}`);
    });
    child.stdout.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => logLine(l.trim())));
    child.stderr.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => logLine(`[stderr] ${l.trim()}`)));
    child.on('exit', (code) => {
        serverState.running = false;
        serverState.child = null;
        logLine(`Server exited with code ${code}.`);
        for (const w of BrowserWindow.getAllWindows()) w.webContents.send('server-stopped');
    });
}

function stopServer() {
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
function waitForServerThenOpen() {
    const started = Date.now();
    const timeout = 120000; // transformers.js can take a while on first run
    const tryFetch = () => {
        const req = http.get(`http://${settings.host}:${settings.port}/`, { timeout: 3000 }, res => {
            res.resume();
            if (res.statusCode && res.statusCode < 500) openSillyTavernWindow();
            else retry();
        });
        req.on('timeout', () => { req.destroy(); retry(); });
        req.on('error', retry);
    };
    const retry = () => {
        if (!serverState.running) { logLine('Server process died during startup — giving up on opening the window.'); return; }
        if (Date.now() - started > timeout) { logLine('Timed out waiting for the server to respond.'); return; }
        setTimeout(tryFetch, 1000);
    };
    tryFetch();
}

// ---------- git operations (update / version info) ----------
function gitPull() {
    if (serverState.running) { logLine('Stop the server before updating.'); return; }
    logLine('Running git pull ...');
    const child = spawn('git', ['pull'], { cwd: settings.sillytavernPath, windowsHide: true, shell: false });
    child.stdout.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => logLine(l.trim())));
    child.stderr.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => logLine(l.trim())));
    child.on('exit', code => logLine(code === 0 ? 'Update finished. You are on the latest version.' : `git pull exited with code ${code}.`));
}

function gitVersion() {
    const child = spawn('git', ['log', '--oneline', '-1'], { cwd: settings.sillytavernPath, windowsHide: true, shell: false });
    child.stdout.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => logLine(l.trim())));
    child.on('error', () => logLine('git not found — cannot read version.'));
}

// ---------- backup ----------
function backupData() {
    const stRoot = settings.sillytavernPath;
    const dataDir = path.join(stRoot, 'data');
    if (!fs.existsSync(dataDir)) { logLine('No data folder found to back up.'); return; }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupDir = path.join(stRoot, 'backups', 'desktop');
    fs.mkdirSync(backupDir, { recursive: true });
    const outFile = path.join(backupDir, `st-backup-${stamp}.zip`);
    logLine(`Backing up ${dataDir} -> ${outFile}`);
    // Windows 11 ships bsdtar: zip via -a flag by extension
    const child = process.platform === 'win32'
        ? spawn('tar', ['-a', '-c', '-f', outFile, '-C', stRoot, 'data'], { windowsHide: true, shell: false })
        : spawn('zip', ['-r', outFile, dataDir], { windowsHide: true, shell: false });
    child.on('exit', code => logLine(code === 0 ? `Backup complete: ${outFile}` : 'Backup failed.'));
    child.on('error', () => logLine('Backup tool not available.'));
}

// ---------- windows ----------
let launcherWin = null;
let stWin = null;

function createLauncherWindow() {
    launcherWin = new BrowserWindow({
        width: 720,
        height: 760,
        resizable: true,
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

function openSillyTavernWindow() {
    if (stWin && !stWin.isDestroyed()) {
        stWin.show();
        stWin.focus();
        return;
    }
    stWin = new BrowserWindow({
        width: settings.windowWidth,
        height: settings.windowHeight,
        title: 'SillyTavern',
        show: false,
        icon: path.join(__dirname, 'icon.ico'),
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            backgroundThrottling: false,
        },
    });
    Menu.setApplicationMenu(null);
    stWin.loadURL(`http://${settings.host}:${settings.port}/`);
    stWin.once('ready-to-show', () => stWin.show());

    // --- ST-specialized browser behavior ---
    const isLocal = url => {
        try {
            const u = new URL(url);
            return u.hostname === settings.host || u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '::1';
        } catch { return false; }
    };
    // Never navigate the ST window away from the server
    stWin.webContents.on('will-navigate', (e, url) => { if (!isLocal(url)) { e.preventDefault(); shell.openExternal(url); } });
    // External links / popups go to the real default browser
    stWin.webContents.setWindowOpenHandler(({ url }) => {
        if (isLocal(url)) return { action: 'allow' };
        shell.openExternal(url);
        return { action: 'deny' };
    });
    // Remember window size
    stWin.on('resize', () => {
        const [w, h] = stWin.getSize();
        settings.windowWidth = w; settings.windowHeight = h; saveSettings(settings);
    });
    stWin.on('closed', () => { stWin = null; });
}

// ---------- IPC ----------
ipcMain.handle('get-state', () => ({ running: serverState.running, settings, logs: serverState.logs }));
ipcMain.handle('start-server', () => startServer().then(() => waitForServerThenOpen()));
ipcMain.handle('stop-server', () => stopServer());
ipcMain.handle('open-st', () => {
    if (serverState.running) { openSillyTavernWindow(); return; }
    return startServer().then(() => waitForServerThenOpen());
});
ipcMain.handle('update', () => gitPull());
ipcMain.handle('backup', () => backupData());
ipcMain.handle('git-version', () => gitVersion());
ipcMain.handle('open-data-folder', () => shell.openPath(path.join(settings.sillytavernPath, 'data')));
ipcMain.handle('open-backups-folder', () => shell.openPath(path.join(settings.sillytavernPath, 'backups', 'desktop')));
ipcMain.handle('save-settings', (_e, s) => { settings = { ...settings, ...s }; saveSettings(settings); logLine('Settings saved.'); });

// ---------- app lifecycle ----------
// Everything below lives INSIDE the lock: when a second instance starts,
// gotLock is false and this process must do nothing but quit. Previously
// startup raced the quit and spawned a server into a dying app.
if (gotLock) {
    let isQuitting = false;

    app.whenReady().then(() => {
        createLauncherWindow();
        if (settings.autoStart) startServer().then(() => waitForServerThenOpen());
    });

    app.on('window-all-closed', () => {
        // User already closed every window — treat that as intent to quit;
        // don't hit them with the confirmation dialog a second time.
        isQuitting = true;
        stopServer();
        app.quit();
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
        }
    });
}
