// downloader.js — download another SillyTavern into a folder the user picks:
// the latest release (recommended), staging, or any version since 1.12.0.
//
// The version list comes from GitHub's releases (dates and notes), kept for an
// hour; without the API (offline, rate limit) `git ls-remote` still lists the
// version tags. Downloads are partial clones (--filter=blob:none): the full
// history without old file contents, so ~100 MB instead of ~210 MB, and
// updating and switching branches still work as in a normal clone.
import { net } from 'electron';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { git, npm, NPM_INSTALL } from './maintenance.js';
import { isStRoot } from './setup.js';

const REPO = 'SillyTavern/SillyTavern';
const GIT_URL = `https://github.com/${REPO}.git`;
const RELEASES_API = `https://api.github.com/repos/${REPO}/releases?per_page=60`;
const CACHE_MS = 3600e3;
// Older versions are left out: they predate the Node.js versions in use now.
const OLDEST = [1, 12, 0];
// SillyTavern reads SILLYTAVERN_* settings from the environment since 1.13.2;
// before that, phone access and "don't open a browser tab" have no effect.
const ENV_SETTINGS = [1, 13, 2];
// Room for the download and its dependencies (~600 MB), with some to spare.
export const NEEDED_BYTES = 1.5 * 1024 ** 3;

let log = () => {};
let cacheFile = '';
export function initDownloader({ logLine, userData }) {
    log = logLine;
    cacheFile = path.join(userData, 'st-versions.json');
}

const parse = v => (/^\d+\.\d+\.\d+$/.test(v) ? v.split('.').map(Number) : null);
const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

// ---------- versions ----------
// [{ version, date, notes, recommended, limited }], newest first.
export async function listVersions({ fresh = false } = {}) {
    let cached = null;
    try { cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch { /* none yet */ }
    if (!fresh && cached && Date.now() - cached.checkedAt < CACHE_MS) return shape(cached.list, cached.source);
    try {
        const res = await net.fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
        if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
        const list = (await res.json())
            .filter(r => !r.draft && !r.prerelease)
            .map(r => ({ version: String(r.tag_name).replace(/^v/, ''), date: r.published_at || '', notes: String(r.body || '').slice(0, 20000), fixes: securityLines(r.body) }));
        try { fs.writeFileSync(cacheFile, JSON.stringify({ checkedAt: Date.now(), source: 'github', list })); } catch { /* next time */ }
        return shape(list, 'github');
    } catch (e) {
        if (cached) return shape(cached.list, cached.source);
        // Tags only: no dates or notes, but every version is there.
        const r = await git(os.homedir(), ['ls-remote', '--tags', '--refs', GIT_URL], { quiet: true });
        if (r.code !== 0) throw new Error(`could not reach GitHub (${e.message})`);
        const list = [...r.out.matchAll(/refs\/tags\/(\S+)/g)].map(m => ({ version: m[1].replace(/^v/, ''), date: '', notes: '' }));
        return shape(list, 'git');
    }
}

function shape(list, source) {
    const versions = list
        .map(v => ({ ...v, n: parse(v.version) }))
        .filter(v => v.n && cmp(v.n, OLDEST) >= 0)
        .sort((a, b) => cmp(b.n, a.n))
        .map(({ n, ...v }, i) => ({ ...v, fixes: v.fixes || [], recommended: i === 0, limited: cmp(n, ENV_SETTINGS) < 0 }));
    return { versions, source };
}

// ---------- older versions ----------
// Lines of release notes about security fixes, e.g. "Fixed path traversal
// vulnerability in several server endpoints." (headings and links dropped).
const SECURITY = /security|vulnerab|CVE-\d|XSS|path traversal|SSRF|sanitiz|injection/i;
function securityLines(body) {
    return String(body || '').split(/\r?\n/)
        .map(l => l.trim())
        .filter(l => l && !l.startsWith('#') && SECURITY.test(l))
        .map(l => l.replace(/^[-*+]\s*/, '').replace(/\s+by @[\w-]+ in https?:\/\/\S+$/, '')
            .replace(/\[([^\]]*)\]\([^)]*\)?/g, '$1').replace(/\*\*|`/g, '').replace(/https?:\/\/\S+/g, '')
            .replace(/^(fix|feat|chore|security)(\([^)]*\))?:\s*/i, '').replace(/[:\s]+$/, '').trim())
        .map(l => l.charAt(0).toUpperCase() + l.slice(1))
        .filter(l => l.length > 12)
        .slice(0, 6);
}

// How far behind the newest release a version is, from the remembered list
// only (no network): { latest, newer, fixes: [{ version, text }] }, or null
// when it's current or unknown.
export function olderStatus(version) {
    const n = parse(String(version || ''));
    if (!n) return null;
    let cached = null;
    try { cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch { return null; }
    const newer = shape(cached.list, cached.source).versions.filter(v => cmp(parse(v.version), n) > 0);
    if (!newer.length) return null;
    return { latest: newer[0].version, newer: newer.length, fixes: newer.flatMap(v => v.fixes.map(text => ({ version: v.version, text }))) };
}

// ---------- where it goes ----------
// Folder names Windows accepts, without path separators.
export function cleanFolderName(name) {
    return String(name || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/[. ]+$/, '').trim().slice(0, 80);
}

// What the downloader shows under the folder fields.
export function targetInfo(parent, folder) {
    const name = cleanFolderName(folder);
    const info = { path: '', ok: false, problem: '', free: null };
    if (!parent || !path.isAbsolute(parent)) { info.problem = 'Choose where to put it.'; return info; }
    if (!name) { info.problem = 'Give the folder a name.'; return info; }
    info.path = path.join(parent, name);
    // The nearest folder that exists decides the drive and free space.
    let probe = parent;
    while (!fs.existsSync(probe) && path.dirname(probe) !== probe) probe = path.dirname(probe);
    try { const s = fs.statfsSync(probe); info.free = s.bavail * s.bsize; } catch { /* unknown */ }
    if (fs.existsSync(info.path)) {
        let entries = [];
        try { entries = fs.readdirSync(info.path); } catch { /* a file, or no access */ }
        if (isStRoot(info.path)) info.problem = 'SillyTavern is already in this folder. Add it as a profile instead, or pick another name.';
        else if (!fs.statSync(info.path).isDirectory() || entries.length) info.problem = 'This folder already exists and is not empty. Pick another name.';
    }
    if (!info.problem && info.free != null && info.free < NEEDED_BYTES) info.problem = `Not enough free space there (${formatGB(info.free)} free, about 1.5 GB needed).`;
    info.ok = !info.problem;
    return info;
}
const formatGB = n => `${(n / 1024 ** 3).toFixed(1)} GB`;

// ---------- downloading ----------
// One download at a time (it runs as a launcher task).
let current = null; // { child, cancelled }

// ref: 'release', 'staging' or a version from listVersions(). onProgress gets
// { step: 'download' | 'deps', text, percent } (percent null = unknown).
// Returns { path } ({ path, depsFailed } when npm install failed), { cancelled }
// or { error }. A failed or cancelled download leaves no folder behind.
export async function download({ ref, parent, folder }, onProgress = () => {}) {
    const info = targetInfo(parent, folder);
    if (!info.ok) return { error: info.problem };
    if (!/^(release|staging|\d+\.\d+\.\d+)$/.test(ref)) return { error: `Unknown SillyTavern version "${ref}".` };
    const target = info.path;
    const what = ref === 'release' ? 'the latest release' : ref === 'staging' ? 'staging' : `version ${ref}`;
    current = { child: null, cancelled: false, killed: Promise.resolve() };
    const job = current;
    // git's helpers and npm's children let go of their files a moment after
    // the kill, so wait for it and keep trying for a while.
    const cleanUp = async () => {
        await job.killed;
        try { await fs.promises.rm(target, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 }); return true; } catch (e) {
            log(`Could not remove the unfinished download at ${target} (${e.code || e.message}). You can delete that folder yourself.`);
            return false;
        }
    };
    const cancelled = async () => {
        if (await cleanUp()) log('Download cancelled. Its folder was removed.');
        return { cancelled: true };
    };
    try {
        fs.mkdirSync(parent, { recursive: true });
        log(`Downloading SillyTavern (${what}) into ${target} ...`);
        onProgress({ step: 'download', text: 'Connecting to GitHub…', percent: null });
        // git shows progress with \r on one line; turn the latest of it into a phase and a percent.
        let lastSent = 0;
        const clone = await git(parent, ['clone', '--progress', '--filter=blob:none', '--branch', ref, GIT_URL, path.basename(target)], {
            quiet: true,
            onChild: c => { job.child = c; },
            onRaw: chunk => {
                const m = [...String(chunk).matchAll(/(Receiving objects|Resolving deltas|Updating files):\s+(\d+)%/g)].pop();
                if (!m || Date.now() - lastSent < 150) return;
                lastSent = Date.now();
                const phase = { 'Receiving objects': 'Downloading', 'Resolving deltas': 'Unpacking', 'Updating files': 'Writing files' }[m[1]];
                onProgress({ step: 'download', text: `${phase}… ${m[2]}%`, percent: Number(m[2]) });
            },
        });
        if (job.cancelled) return cancelled();
        if (clone.code !== 0) {
            const why = clone.out.split(/[\r\n]+/).map(l => l.trim()).filter(l => /fatal|error/i.test(l)).pop() || 'git clone failed';
            log(`ERROR: download failed: ${why}`);
            await cleanUp();
            return { error: `The download failed: ${why.replace(/^(fatal|error):\s*/i, '')}` };
        }
        log('Download complete. Installing dependencies (npm install) — this takes a minute or two ...');
        onProgress({ step: 'deps', text: 'Installing dependencies (npm install)…', percent: null });
        const inst = await npm(target, NPM_INSTALL, { onChild: c => { job.child = c; } });
        if (job.cancelled) return cancelled();
        if (inst.code !== 0) {
            // The files are there; SillyTavern's Start.bat or Maintenance can finish it.
            log(`WARNING: npm install failed. SillyTavern is at ${target}, but needs Maintenance → "Install missing dependencies" before it starts.`);
            return { path: target, depsFailed: true };
        }
        log(`SillyTavern ${ref === 'release' || ref === 'staging' ? `(${ref})` : ref} is ready at ${target}.`);
        return { path: target };
    } finally {
        if (current === job) current = null;
    }
}

export function cancel() {
    if (!current) return false;
    current.cancelled = true;
    const pid = current.child?.pid;
    // npm runs through a shell: end the whole tree.
    if (pid && process.platform === 'win32') {
        const kill = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
        current.killed = new Promise(r => { kill.once('exit', r); kill.once('error', r); }).then(() => new Promise(r => setTimeout(r, 500)));
    } else current.child?.kill();
    log('Cancelling the download ...');
    return true;
}
