// Maintenance tasks for the SillyTavern install: version info, safe
// updates, dependency repair, branch switching, backups and extensions.
//
// git and npm run as child processes against the user's SillyTavern
// checkout; backups are zipped in-process (yazl/yauzl). Nothing edits
// tracked upstream files — the most
// invasive operation is `git restore package-lock.json`, which is the
// documented fix for the most common failed-update case.
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { pipeline } from 'stream/promises';
import yazl from 'yazl';
import yauzl from 'yauzl';

const IS_WIN = process.platform === 'win32';
// Like SillyTavern's own Start.bat. --no-save keeps package-lock.json as
// shipped: a rewritten one blocks the next `git pull`. (Start.bat also uses
// --ignore-scripts; older SillyTavern versions still need their scripts.)
export const NPM_INSTALL = ['install', '--no-save', '--no-audit', '--no-fund', '--loglevel=error', '--no-progress', '--omit=dev'];
// Regenerable caches — no point zipping them into every backup.
const BACKUP_EXCLUDES = new Set(['data/_cache', 'data/_webpack', 'data/_uploads']);
// Already-compressed formats are stored as-is: deflating them wastes time.
const STORE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.mp3', '.ogg', '.wav', '.m4a', '.mp4', '.webm', '.zip', '.gz', '.7z', '.woff2']);

let log = () => {};
export function initMaintenance({ logLine }) { log = logLine; }

// Calls fn with each complete line a child process prints. Output arrives
// in arbitrary chunks: a line (or an emoji in a character's name) can be
// split between two of them, so decode as UTF-8 and keep the unfinished end.
export function onLines(stream, fn) {
    let rest = '';
    stream.setEncoding('utf8');
    stream.on('data', s => {
        const parts = (rest + s).split(/\r?\n/);
        rest = parts.pop();
        parts.forEach(fn);
    });
    stream.on('end', () => { if (rest) fn(rest); rest = ''; });
}

// Run a command, streaming output to the console unless quiet.
// onChild gets the process (to stop it), onRaw every chunk of output as it arrives.
export function run(cmd, args, cwd, { quiet = false, shell = false, onChild, onRaw } = {}) {
    return new Promise(resolve => {
        let out = '';
        let done = false;
        const finish = r => { if (!done) { done = true; resolve(r); } };
        let child;
        try {
            child = spawn(cmd, args, { cwd, windowsHide: true, shell });
        } catch (e) {
            finish({ code: -1, out: e.message });
            return;
        }
        onChild?.(child);
        const onLine = l => {
            out += `${l}\n`;
            if (!quiet && l.trim()) log(l.trim());
        };
        onLines(child.stdout, onLine);
        onLines(child.stderr, onLine);
        if (onRaw) { child.stdout.on('data', onRaw); child.stderr.on('data', onRaw); }
        child.on('error', e => finish({ code: -1, out: e.message }));
        child.on('close', code => finish({ code, out }));
    });
}
export const git = (cwd, args, opts) => run('git', args, cwd, opts);
// npm is a .cmd on Windows, which Node only spawns through a shell. The
// shell gets one command string (args are fixed flags, never user input).
export const npm = (cwd, args, opts) => (IS_WIN
    ? run(['npm', ...args].join(' '), [], cwd, { ...opts, shell: true })
    : run('npm', args, cwd, opts));

// ---------- version info ----------
export async function getInfo(stRoot) {
    const info = { version: '', branch: '', pinned: '', commit: '', commitDate: '', behind: null, dirty: [], isGit: false };
    try { info.version = JSON.parse(fs.readFileSync(path.join(stRoot, 'package.json'), 'utf8')).version; } catch { /* not installed */ }
    const head = await git(stRoot, ['log', '-1', '--format=%h|%cs'], { quiet: true });
    if (head.code !== 0) return info;
    info.isGit = true;
    [info.commit, info.commitDate] = head.out.trim().split('|');
    info.branch = (await git(stRoot, ['branch', '--show-current'], { quiet: true })).out.trim();
    // A specific version (downloaded or checked out by tag) is on no branch, so there is nothing to pull.
    if (!info.branch) info.pinned = (await pinnedVersion(stRoot)) || info.version || 'a fixed version';
    const behind = await git(stRoot, ['rev-list', '--count', 'HEAD..@{u}'], { quiet: true });
    if (behind.code === 0) info.behind = parseInt(behind.out.trim(), 10);
    const status = await git(stRoot, ['status', '--porcelain', '--untracked-files=no'], { quiet: true });
    info.dirty = status.out.split(/\r?\n/).filter(Boolean).map(l => l.slice(3));
    return info;
}

async function pinnedVersion(stRoot) {
    const r = await git(stRoot, ['describe', '--tags', '--exact-match'], { quiet: true });
    return r.code === 0 ? r.out.trim() : '';
}

// `git fetch` so `behind` reflects upstream. Quiet: runs on every launch.
export async function checkForUpdates(stRoot) {
    const r = await git(stRoot, ['fetch', '--quiet'], { quiet: true });
    if (r.code !== 0) log(`Could not check for updates: ${r.out.trim() || 'git fetch failed'}`);
    return getInfo(stRoot);
}

// ---------- update / repair ----------
export async function update(stRoot, { backupFirst, keep }) {
    if (!(await git(stRoot, ['branch', '--show-current'], { quiet: true })).out.trim()) {
        const v = await pinnedVersion(stRoot);
        log(`This SillyTavern is kept at ${v ? `version ${v}` : 'a fixed version'}, so there is nothing to update. To get updates, choose release or staging under Maintenance → Release channel.`);
        return false;
    }
    // No data folder (never started): nothing to back up, nothing to lose.
    if (backupFirst && fs.existsSync(path.join(stRoot, 'data'))) {
        const b = await createBackup(stRoot, 'auto-before-update', keep);
        if (!b) { log('Update cancelled: the backup failed.'); return false; }
    }
    log('Downloading the latest SillyTavern (git pull) ...');
    const pull = await git(stRoot, ['pull', '--ff-only']);
    if (pull.code !== 0) {
        if (/package-lock\.json/.test(pull.out)) {
            log('ERROR: Update blocked by a changed package-lock.json. Use Maintenance → "Reset package-lock.json", then update again.');
        } else if (/overwritten|local changes/i.test(pull.out)) {
            log('ERROR: Update blocked by locally modified SillyTavern files (listed above). Your data/ folder is safe; those files must be restored before updating.');
        } else {
            log('ERROR: git pull failed (see above).');
        }
        return false;
    }
    log('Installing dependencies (npm install) ...');
    const inst = await npm(stRoot, NPM_INSTALL);
    if (inst.code !== 0) { log('ERROR: npm install failed. Try Maintenance → "Reinstall dependencies".'); return false; }
    log('Update finished. You are on the latest version.');
    return true;
}

export async function repair(stRoot, kind) {
    if (kind === 'deps') {
        log('Reinstalling missing dependencies (npm install) ...');
        const r = await npm(stRoot, NPM_INSTALL);
        log(r.code === 0 ? 'Dependencies are OK.' : 'ERROR: npm install failed.');
        return r.code === 0;
    }
    if (kind === 'clean-deps') {
        log('Removing node_modules and reinstalling from scratch — this can take a few minutes ...');
        try {
            fs.rmSync(path.join(stRoot, 'node_modules'), { recursive: true, force: true });
        } catch (e) {
            log(`ERROR: could not remove node_modules: ${e.message}. Is something still using it?`);
            return false;
        }
        const r = await npm(stRoot, NPM_INSTALL);
        log(r.code === 0 ? 'Clean reinstall finished.' : 'ERROR: npm install failed.');
        return r.code === 0;
    }
    if (kind === 'reset-lock') {
        log('Restoring package-lock.json to the official version ...');
        const r = await git(stRoot, ['restore', 'package-lock.json']);
        log(r.code === 0 ? 'package-lock.json restored. You can update now.' : 'ERROR: git restore failed.');
        return r.code === 0;
    }
    return false;
}

export async function switchBranch(stRoot, branch, { backupFirst, keep }) {
    if (!['release', 'staging'].includes(branch)) return false;
    if (backupFirst && fs.existsSync(path.join(stRoot, 'data'))) {
        const b = await createBackup(stRoot, `auto-before-${branch}`, keep);
        if (!b) { log('Switch cancelled: the backup failed.'); return false; }
    }
    log(`Switching SillyTavern to the ${branch} branch ...`);
    const fetched = await git(stRoot, ['fetch', 'origin', branch]);
    if (fetched.code !== 0) { log('ERROR: could not download the branch (see above). Check your internet connection.'); return false; }
    const co = await git(stRoot, ['checkout', branch]);
    if (co.code !== 0) {
        log(/package-lock\.json/.test(co.out)
            ? 'ERROR: Switch blocked by a changed package-lock.json. Use Maintenance → "Reset package-lock.json", then switch again.'
            : 'ERROR: could not switch branch (see above).');
        return false;
    }
    const pull = await git(stRoot, ['pull', '--ff-only']);
    if (pull.code !== 0) log(`WARNING: now on ${branch}, but getting its latest changes failed (see above). Try "Update now".`);
    const inst = await npm(stRoot, NPM_INSTALL);
    log(inst.code === 0 ? `Now on ${branch}.` : 'Switched, but npm install failed. Try Maintenance → "Reinstall dependencies".');
    return inst.code === 0;
}

// ---------- backups ----------
export const backupsDir = stRoot => path.join(stRoot, 'backups', 'desktop');
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

// Walk data/ (minus caches) yielding [absolute path, zip path].
// Zipped in JS rather than with tar: Windows' bsdtar crashes on emoji
// filenames, which are common in character names.
async function* walk(stRoot, rel) {
    const dir = await fs.promises.opendir(path.join(stRoot, rel));
    for await (const d of dir) {
        const childRel = `${rel}/${d.name}`;
        if (BACKUP_EXCLUDES.has(childRel)) continue;
        if (d.isDirectory()) yield* walk(stRoot, childRel);
        else if (d.isFile()) yield [path.join(stRoot, childRel), childRel];
    }
}

async function zipData(stRoot, file) {
    const zip = new yazl.ZipFile();
    const tmp = `${file}.partial`;
    const written = pipeline(zip.outputStream, fs.createWriteStream(tmp));
    let count = 0;
    let lastReport = Date.now();
    for await (const [abs, rel] of walk(stRoot, 'data')) {
        zip.addFile(abs, rel, { compress: !STORE_EXT.has(path.extname(rel).toLowerCase()) });
        count++;
        if (Date.now() - lastReport > 5000) { log(`  …${count} files so far`); lastReport = Date.now(); }
    }
    zip.end();
    await written;
    fs.renameSync(tmp, file);
    return count;
}

async function unzipData(file, stRoot) {
    const zip = await yauzl.openPromise(file, { lazyEntries: true });
    try {
        let count = 0;
        for await (const entry of zip.eachEntry()) {
            // yauzl already rejects absolute and ../ paths; only accept data/.
            if (!entry.fileName.startsWith('data/')) continue;
            const dest = path.join(stRoot, entry.fileName);
            if (entry.fileName.endsWith('/')) { fs.mkdirSync(dest, { recursive: true }); continue; }
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            await pipeline(await zip.openReadStreamPromise(entry), fs.createWriteStream(dest));
            count++;
        }
        return count;
    } finally {
        zip.close();
    }
}

// label 'manual' or 'auto-…'; auto backups beyond `keep` are pruned.
export async function createBackup(stRoot, label, keep) {
    if (!fs.existsSync(path.join(stRoot, 'data'))) { log('No data folder found to back up.'); return null; }
    const dir = backupsDir(stRoot);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `st-backup-${stamp()}-${label}.zip`);
    log(`Backing up your data → ${path.basename(file)} ...`);
    try {
        const n = await zipData(stRoot, file);
        log(`Backup complete: ${n} files, ${formatSize(fs.statSync(file).size)}.`);
    } catch (e) {
        log(`ERROR: backup failed: ${e.message}`);
        try { fs.unlinkSync(`${file}.partial`); } catch { /* nothing written */ }
        return null;
    }
    if (label.startsWith('auto-') && keep > 0) pruneAutoBackups(stRoot, keep);
    return file;
}

function pruneAutoBackups(stRoot, keep) {
    const autos = listBackups(stRoot).filter(b => b.auto);
    for (const b of autos.slice(keep)) {
        try { fs.unlinkSync(path.join(backupsDir(stRoot), b.name)); log(`Removed old automatic backup ${b.name}.`); } catch { /* in use — try next time */ }
    }
}

export function listBackups(stRoot) {
    const dir = backupsDir(stRoot);
    let files = [];
    try { files = fs.readdirSync(dir).filter(f => f.endsWith('.zip')); } catch { return []; }
    return files.map(name => {
        const st = fs.statSync(path.join(dir, name));
        return { name, size: st.size, sizeText: formatSize(st.size), mtime: st.mtimeMs, auto: /-auto-/.test(name) };
    }).sort((a, b) => b.mtime - a.mtime);
}

// Restore never deletes: the current data/ is moved aside first.
export async function restoreBackup(stRoot, name) {
    const file = path.join(backupsDir(stRoot), path.basename(name));
    if (!fs.existsSync(file)) { log('ERROR: backup file not found.'); return false; }
    const dataDir = path.join(stRoot, 'data');
    const aside = path.join(backupsDir(stRoot), `data-before-restore-${stamp()}`);
    if (fs.existsSync(dataDir)) {
        try { fs.renameSync(dataDir, aside); } catch (e) { log(`ERROR: could not move the current data folder aside: ${e.message}`); return false; }
        log(`Current data moved to backups/desktop/${path.basename(aside)} (kept, not deleted).`);
    }
    log(`Restoring ${path.basename(file)} ...`);
    try {
        const n = await unzipData(file, stRoot);
        log(`Restore complete: ${n} files.`);
        return true;
    } catch (e) {
        log(`ERROR: restore failed: ${e.message}`);
        // Put the previous data back so a bad zip never leaves you with nothing.
        if (fs.existsSync(aside)) {
            try {
                fs.rmSync(dataDir, { recursive: true, force: true });
                fs.renameSync(aside, dataDir);
                log('Your previous data was put back.');
            } catch { log(`Your previous data is still safe in backups/desktop/${path.basename(aside)}.`); }
        }
        return false;
    }
}

export function deleteBackup(stRoot, name) {
    try { fs.unlinkSync(path.join(backupsDir(stRoot), path.basename(name))); log(`Deleted backup ${name}.`); return true; } catch (e) { log(`ERROR: ${e.message}`); return false; }
}

// ---------- extensions ----------
// The origin URL from .git/config, without starting git.
export function originUrl(dir) {
    try {
        const m = fs.readFileSync(path.join(dir, '.git', 'config'), 'utf8').match(/\[remote "origin"\][^[]*?\burl\s*=\s*(\S+)/);
        return m ? m[1] : '';
    } catch { return ''; }
}

function extensionRoots(stRoot) {
    const roots = [{ dir: path.join(stRoot, 'public', 'scripts', 'extensions', 'third-party'), scope: 'all users' }];
    let users = [];
    try { users = fs.readdirSync(path.join(stRoot, 'data'), { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('_')); } catch { /* no data yet */ }
    for (const u of users) roots.push({ dir: path.join(stRoot, 'data', u.name, 'extensions'), scope: u.name });
    return roots;
}

// Origin addresses of every installed extension, read from the folders only.
export function installedRemotes(stRoot) {
    const out = [];
    for (const { dir, scope } of extensionRoots(stRoot)) {
        let entries = [];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()); } catch { continue; }
        for (const d of entries) out.push({ folder: d.name, scope, remote: originUrl(path.join(dir, d.name)) });
    }
    return out;
}

export async function listExtensions(stRoot, { fetch = false } = {}) {
    const out = [];
    for (const { dir, scope } of extensionRoots(stRoot)) {
        let entries = [];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()); } catch { continue; }
        for (const d of entries) {
            const extDir = path.join(dir, d.name);
            const ext = { id: d.name, path: extDir, scope, name: d.name, version: '', author: '', isGit: false, behind: null, remote: originUrl(extDir), head: '', headDate: '', incoming: '' };
            try {
                const m = JSON.parse(fs.readFileSync(path.join(extDir, 'manifest.json'), 'utf8'));
                ext.name = m.display_name || d.name;
                ext.version = m.version || '';
                ext.author = m.author || '';
            } catch { /* no manifest */ }
            if (fs.existsSync(path.join(extDir, '.git'))) {
                ext.isGit = true;
                if (fetch) await git(extDir, ['fetch', '--quiet'], { quiet: true });
                const b = await git(extDir, ['rev-list', '--count', 'HEAD..@{u}'], { quiet: true });
                if (b.code === 0) ext.behind = parseInt(b.out.trim(), 10);
                // The exact commits, for safety ratings and undoing updates.
                const h = await git(extDir, ['log', '-1', '--format=%H%x09%cI'], { quiet: true });
                if (h.code === 0) [ext.head, ext.headDate] = h.out.trim().split('\t');
                if (ext.behind > 0) ext.incoming = (await git(extDir, ['rev-parse', '@{u}'], { quiet: true })).out.trim();
            }
            out.push(ext);
        }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
}

// only: the folders to update (the launcher's review); all with updates otherwise.
// before(exts) runs once the list is known, e.g. to remember their versions.
export async function updateExtensions(stRoot, { only = null, before = null } = {}) {
    const want = only && new Set(only.map(p => path.resolve(p).toLowerCase()));
    const exts = (await listExtensions(stRoot, { fetch: !only })).filter(e => e.isGit && e.behind > 0 && (!want || want.has(path.resolve(e.path).toLowerCase())));
    if (before) await before(exts);
    if (!exts.length) { log('All extensions are up to date.'); return 0; }
    let ok = 0;
    for (const e of exts) {
        log(`Updating extension ${e.name} (${e.behind} new commit${e.behind === 1 ? '' : 's'}) ...`);
        const r = await git(e.path, ['pull', '--ff-only'], { quiet: true });
        if (r.code === 0) ok++;
        else if (/fast-forward/i.test(r.out)) { if (await realignRewritten(e)) ok++; }
        else log(`ERROR: ${e.name} could not be updated: ${r.out.trim().split('\n').pop()}`);
    }
    log(`Updated ${ok} of ${exts.length} extension${exts.length === 1 ? '' : 's'}. Reload SillyTavern to use them.`);
    return ok;
}

// The copy and upstream have diverged. Usually the author rewrote history
// (force-push) and the local commits are just the old copies. Realign only
// when that is provably the case: no uncommitted changes, and the files
// exactly match some upstream version. The old commits stay on a branch.
async function realignRewritten(e) {
    const status = await git(e.path, ['status', '--porcelain'], { quiet: true });
    const tree = (await git(e.path, ['rev-parse', 'HEAD^{tree}'], { quiet: true })).out.trim();
    const upstreamTrees = (await git(e.path, ['log', '--format=%T', '@{u}'], { quiet: true })).out.split(/\r?\n/);
    if (status.out.trim() || !tree || !upstreamTrees.includes(tree)) {
        log(`ERROR: ${e.name} has changes of its own that aren't in the official version, so it was left untouched. Update it from SillyTavern's Extensions menu, or reinstall it.`);
        return false;
    }
    const branch = `desktop-backup-${stamp()}`;
    await git(e.path, ['branch', branch], { quiet: true });
    const reset = await git(e.path, ['reset', '--hard', '@{u}'], { quiet: true });
    if (reset.code !== 0) { log(`ERROR: ${e.name} could not be updated: ${reset.out.trim()}`); return false; }
    log(`${e.name}: its author rewrote the project's history. Your copy had no changes of its own, so it was moved to the latest version (old version kept on branch ${branch}).`);
    return true;
}

// ---------- health check ----------
// The usual "why won't it start" causes, each with a plain-language fix.
export async function healthCheck(stRoot) {
    const checks = [];
    const add = (label, status, detail, fix = '') => checks.push({ label, status, detail, fix });

    const hasServer = fs.existsSync(path.join(stRoot, 'server.js'));
    add('SillyTavern folder', hasServer ? 'ok' : 'bad', hasServer ? stRoot : `server.js not found in ${stRoot}`, hasServer ? '' : 'Set the right folder in Settings.');

    const node = await run('node', ['-v'], stRoot, { quiet: true });
    const major = parseInt(node.out.trim().replace(/^v/, ''), 10);
    if (node.code !== 0) add('Node.js', 'bad', 'Not found', 'Install Node.js 20 or newer from nodejs.org, then restart this app.');
    else add('Node.js', major >= 20 ? 'ok' : 'bad', node.out.trim(), major >= 20 ? '' : 'SillyTavern needs Node.js 20 or newer.');

    const gitV = await run('git', ['--version'], stRoot, { quiet: true });
    add('git', gitV.code === 0 ? 'ok' : 'warn', gitV.code === 0 ? gitV.out.trim().replace('git version ', '') : 'Not found', gitV.code === 0 ? '' : 'Install git to use Update and branch switching.');

    const npmV = await npm(stRoot, ['-v'], { quiet: true });
    add('npm', npmV.code === 0 ? 'ok' : 'bad', npmV.code === 0 ? npmV.out.trim() : 'Not found', npmV.code === 0 ? '' : 'npm comes with Node.js — reinstall Node.js.');

    if (hasServer) {
        const deps = fs.existsSync(path.join(stRoot, 'node_modules'));
        add('Dependencies', deps ? 'ok' : 'bad', deps ? 'Installed' : 'node_modules is missing', deps ? '' : 'Run "Install missing dependencies".');

        const config = fs.existsSync(path.join(stRoot, 'config.yaml'));
        add('config.yaml', config ? 'ok' : 'warn', config ? 'Present' : 'Not created yet', config ? '' : 'Created automatically the first time the server starts.');

        const status = await git(stRoot, ['status', '--porcelain', '--untracked-files=no'], { quiet: true });
        if (status.code === 0) {
            const dirty = status.out.split(/\r?\n/).filter(Boolean).map(l => l.slice(3));
            const lockOnly = dirty.length === 1 && dirty[0] === 'package-lock.json';
            if (!dirty.length) add('SillyTavern files', 'ok', 'Unmodified');
            else add('SillyTavern files', 'warn', `${dirty.length} changed: ${dirty.slice(0, 3).join(', ')}${dirty.length > 3 ? ', …' : ''}`,
                lockOnly ? 'Run "Reset package-lock.json" before updating.' : 'Changed program files can block updates. Your data folder is not affected.');
        }

        let misplaced = [];
        try { misplaced = fs.readdirSync(path.join(stRoot, 'plugins')).filter(f => f.endsWith('.user.js')); } catch { /* no plugins dir */ }
        if (misplaced.length) add('Server plugins', 'warn', `Userscript in plugins/: ${misplaced.join(', ')}`, 'Move it to the userscripts folder (Folders → Userscripts).');
    }

    try {
        const st = fs.statfsSync(stRoot);
        const free = st.bavail * st.bsize;
        add('Free disk space', free > 2 * 1024 ** 3 ? 'ok' : 'warn', formatSize(free), free > 2 * 1024 ** 3 ? '' : 'Updates and backups need room — free up some space.');
    } catch { /* statfs unsupported */ }

    return checks;
}

function formatSize(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
    if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
    return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
