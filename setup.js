// First-run setup and install management: find SillyTavern wherever it
// lives, install or update its requirements (Node.js, Git) with winget,
// and move an install to another folder. (Downloading one: downloader.js.)
import path from 'path';
import fs from 'fs';
import os from 'os';
import { run, npm, NPM_INSTALL } from './maintenance.js';

const IS_WIN = process.platform === 'win32';
const MIN_NODE = 20;

let log = () => {};
let onPathRefresh = () => {};
export function initSetup(opts) { log = opts.logLine; onPathRefresh = opts.onPathRefresh || onPathRefresh; }

// ---------- finding SillyTavern ----------
// A folder counts only if it really is SillyTavern: server.js plus a
// package.json whose name is "sillytavern".
export function isStRoot(dir) {
    if (!dir) return false;
    try {
        if (!fs.existsSync(path.join(dir, 'server.js'))) return false;
        return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).name === 'sillytavern';
    } catch { return false; }
}

function describe(dir) {
    let version = '';
    try { version = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version; } catch { /* checked by isStRoot */ }
    return { path: dir, version, isGit: fs.existsSync(path.join(dir, '.git')) };
}

const subdirs = dir => {
    try { return fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => path.join(dir, d.name)); } catch { return []; }
};
const SKIP = /^(windows|program files( \(x86\))?|programdata|\$recycle\.bin|system volume information|recovery|perflogs|node_modules|appdata)$/i;

// Places worth looking: next to the exe, the usual user folders, and the
// top two levels of every drive. Cheap enough to run on every launch.
export function detectInstalls(extraBases = []) {
    const home = os.homedir();
    const roots = [...extraBases, home, ...['Documents', 'Desktop', 'Downloads', 'OneDrive', 'OneDrive/Documents'].map(d => path.join(home, d))];
    if (IS_WIN) {
        for (let c = 67; c <= 90; c++) { // C: … Z:
            const drive = `${String.fromCharCode(c)}:\\`;
            if (fs.existsSync(drive)) roots.push(drive);
        }
    }
    const candidates = new Set();
    for (const root of roots) {
        for (const rel of ['.', '..', '../..', 'SillyTavern', 'SillyTavern-Launcher/SillyTavern']) candidates.add(path.resolve(root, rel));
        // One level of folders under each root, and SillyTavern inside them.
        for (const d of subdirs(root)) {
            if (SKIP.test(path.basename(d))) continue;
            candidates.add(d);
            candidates.add(path.join(d, 'SillyTavern'));
        }
    }
    const found = [];
    const seen = new Set();
    for (const c of candidates) {
        if (!isStRoot(c)) continue;
        const key = fs.realpathSync.native(c).toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        found.push(describe(c));
    }
    return found;
}

// ---------- requirements ----------
export async function checkRequirements() {
    const node = await run('node', ['-v'], os.homedir(), { quiet: true });
    const nodeVer = node.code === 0 ? node.out.trim().replace(/^v/, '') : '';
    const gitR = await run('git', ['--version'], os.homedir(), { quiet: true });
    const gitVer = gitR.code === 0 ? (gitR.out.match(/\d+\.\d+\.\d+/) || [''])[0] : '';
    const winget = IS_WIN ? (await run('winget', ['--version'], os.homedir(), { quiet: true })).code === 0 : false;
    return {
        node: { installed: !!nodeVer, version: nodeVer, ok: parseInt(nodeVer, 10) >= MIN_NODE },
        git: { installed: !!gitVer, version: gitVer, ok: !!gitVer },
        winget,
        canAutoInstall: winget,
    };
}

// Windows only updates PATH for processes started after an install. Pull
// the fresh value from the registry so node/git work without a restart.
export async function refreshPath() {
    if (!IS_WIN) return;
    const r = await run('powershell', ['-NoProfile', '-Command',
        "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')"],
    os.homedir(), { quiet: true });
    if (r.code === 0 && r.out.trim()) process.env.Path = r.out.trim();
    onPathRefresh();
}

const WINGET_IDS = { node: 'OpenJS.NodeJS.LTS', git: 'Git.Git' };
const WINGET_FLAGS = ['-e', '--silent', '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity'];
// winget draws progress bars; keep its console output to real messages.
const wingetNoise = l => /^[\s\-\\|/█▒░]*$/.test(l) || /^\s*[\d.]+\s*[KMG]?B\s*\/\s*[\d.]+/.test(l) || /^\s*\d+%\s*$/.test(l);

async function winget(verb, which) {
    const name = which === 'node' ? 'Node.js' : 'Git';
    log(`${verb === 'install' ? 'Installing' : 'Updating'} ${name} with winget — Windows may ask for permission ...`);
    const r = await run('winget', [verb, '--id', WINGET_IDS[which], ...WINGET_FLAGS], os.homedir(), { quiet: true });
    r.out.split(/[\r\n]+/).map(l => l.trim()).filter(l => l && !wingetNoise(l)).forEach(l => log(`  ${l}`));
    // winget exits non-zero when there is simply nothing newer to install.
    if (/No (available )?upgrade found|No newer package versions|already installed/i.test(r.out)) {
        log(`${name} is already the latest version.`);
        return true;
    }
    if (r.code !== 0) {
        const busy = programsBlockingInstall(r.out);
        log(busy.length
            ? `ERROR: ${name} couldn't be updated because it's in use by: ${busy.join(', ')}. Close those programs (e.g. Git Bash or terminal windows) and try again.`
            : `ERROR: winget could not ${verb} ${name}.`);
        return false;
    }
    log(`${name} ${verb === 'install' ? 'installed' : 'updated'}.`);
    return true;
}

// Installers refuse to replace files in use (Git's lists the processes in
// its log, which winget points to). Pull out the program names.
function programsBlockingInstall(wingetOut) {
    const logPath = (wingetOut.match(/Installer log is available at:\s*(.+\.log)/i) || [])[1];
    if (!logPath) return [];
    let text = '';
    try { text = fs.readFileSync(logPath.trim(), 'utf8'); } catch { return []; }
    const block = (text.match(/process\(es\) use [^:]*:([\s\S]*?)Please terminate/i) || [])[1] || '';
    return [...new Set([...block.matchAll(/([\w.-]+\.exe)/gi)].map(m => m[1]))];
}

// Install whatever is missing (or too old).
export async function installRequirements() {
    const req = await checkRequirements();
    if (!req.winget) {
        log('ERROR: winget is not available on this PC. Install Node.js (nodejs.org) and Git (git-scm.com) manually, then restart this app.');
        return false;
    }
    let ok = true;
    if (!req.node.ok) ok = (await winget(req.node.installed ? 'upgrade' : 'install', 'node')) && ok;
    if (!req.git.ok) ok = (await winget('install', 'git')) && ok;
    await refreshPath();
    if (req.node.ok && req.git.ok) log('Node.js and Git are already installed.');
    return ok;
}

// Bring Node.js and Git to their latest versions, then rebuild
// SillyTavern's dependencies against the new Node.
export async function updateBackend(stRoot) {
    const req = await checkRequirements();
    if (!req.winget) {
        log('ERROR: winget is not available on this PC, so Node.js and Git must be updated manually.');
        return false;
    }
    let ok = true;
    ok = (await winget(req.node.installed ? 'upgrade' : 'install', 'node')) && ok;
    ok = (await winget(req.git.installed ? 'upgrade' : 'install', 'git')) && ok;
    await refreshPath();
    const after = await checkRequirements();
    log(`Now using Node.js ${after.node.version || '—'} and Git ${after.git.version || '—'}.`);
    if (stRoot && isStRoot(stRoot)) {
        log('Reinstalling SillyTavern dependencies for this Node.js version (npm install) ...');
        const r = await npm(stRoot, NPM_INSTALL);
        if (r.code !== 0) { log('ERROR: npm install failed. Try Maintenance → "Reinstall dependencies".'); ok = false; }
    }
    if (ok) log('Back end is up to date.');
    return ok;
}

// ---------- moving an install ----------
// Same drive: an instant rename. Another drive: copy, verify, and only
// then remove the old folder (the caller asks first).
export async function moveInstall(from, newParent) {
    const to = path.join(newParent, path.basename(from));
    if (path.resolve(to).toLowerCase() === path.resolve(from).toLowerCase()) { log('That is already where SillyTavern is.'); return null; }
    if (path.resolve(to).toLowerCase().startsWith(path.resolve(from).toLowerCase() + path.sep)) { log('ERROR: cannot move SillyTavern into its own folder.'); return null; }
    if (fs.existsSync(to)) { log(`ERROR: ${to} already exists. Pick another location.`); return null; }
    fs.mkdirSync(newParent, { recursive: true });
    log(`Moving SillyTavern to ${to} ...`);
    try {
        fs.renameSync(from, to);
        log('Move complete.');
        return { to, copied: false };
    } catch (e) {
        if (e.code !== 'EXDEV' && e.code !== 'EPERM') { log(`ERROR: move failed: ${e.message}`); return null; }
    }
    log('Different drive — copying files (this can take a while for large installs) ...');
    try {
        await fs.promises.cp(from, to, { recursive: true, preserveTimestamps: true, errorOnExist: true, force: false });
    } catch (e) {
        log(`ERROR: copy failed: ${e.message}. Your original folder is untouched.`);
        try { fs.rmSync(to, { recursive: true, force: true }); } catch { /* partial copy */ }
        return null;
    }
    if (!isStRoot(to)) { log('ERROR: the copy looks incomplete. Your original folder is untouched.'); return null; }
    log('Copy complete.');
    return { to, copied: true };
}

export function removeOldInstall(dir) {
    try {
        fs.rmSync(dir, { recursive: true, force: true });
        log(`Removed the old copy at ${dir}.`);
    } catch (e) {
        log(`Could not remove the old copy at ${dir}: ${e.message}. You can delete it yourself.`);
    }
}
