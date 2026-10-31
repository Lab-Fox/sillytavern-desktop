// The app's own Node.js and Git ("portable runtime"): official zips from
// nodejs.org and Git for Windows (MinGit), checked against their published
// SHA256 and unpacked into <userData>/runtime. Nothing is installed in
// Windows and no admin prompt appears. When turned on, both folders go in
// front of PATH, so every server, git and npm the app starts uses them.
import { net } from 'electron';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import yauzl from 'yauzl';

const NODE_INDEX = 'https://nodejs.org/dist/index.json';
const GIT_LATEST = 'https://api.github.com/repos/git-for-windows/git/releases/latest';
// MinGit without "busybox": the variant Git for Windows recommends for apps.
const MINGIT_ASSET = /^MinGit-[\d.]+(?:\.windows\.\d+)?-64-bit\.zip$/;

let log = () => {};
let root = '';
let originalPath = null;
export function initRuntime({ logLine, userData }) {
    log = logLine;
    root = path.join(userData, 'runtime');
}

const dirs = () => ({ node: path.join(root, 'node'), git: path.join(root, 'git') });
// What PATH needs for each: node.exe + npm.cmd sit in the zip's root, git.exe in cmd\.
const binDirs = () => ({ node: dirs().node, git: path.join(dirs().git, 'cmd') });

function readVersion(dir) {
    try { return JSON.parse(fs.readFileSync(path.join(dir, 'desktop-runtime.json'), 'utf8')); } catch { return null; }
}

// { node: { version, dir } | null, git: … | null, active }
export function info() {
    const d = dirs();
    const node = fs.existsSync(path.join(d.node, 'node.exe')) ? readVersion(d.node) || { version: '?' } : null;
    const git = fs.existsSync(path.join(d.git, 'cmd', 'git.exe')) ? readVersion(d.git) || { version: '?' } : null;
    return { node: node && { ...node, dir: d.node }, git: git && { ...git, dir: d.git }, active: originalPath !== null, root };
}

// True when this path is inside the app's runtime folder (for "which one is used").
export const owns = p => !!p && !!root && path.resolve(p).toLowerCase().startsWith(root.toLowerCase() + path.sep);

// Put the runtime in front of PATH (on) or restore the PATH from before (off).
// Child processes inherit process.env, so this covers every spawn.
export function apply(on) {
    if (originalPath !== null) { process.env.Path = originalPath; originalPath = null; }
    if (!on) return false;
    const i = info();
    const add = [i.node && binDirs().node, i.git && binDirs().git].filter(Boolean);
    if (!add.length) return false;
    originalPath = process.env.Path || '';
    process.env.Path = [...add, originalPath].join(path.delimiter);
    return true;
}
// setup.refreshPath() replaces PATH with the registry's: keep ours in front.
export function reapply() { if (originalPath !== null) { originalPath = null; apply(true); } }

// ---------- finding the latest versions ----------
async function json(url) {
    const res = await net.fetch(url, { headers: { Accept: 'application/vnd.github+json, application/json' }, cache: 'no-store' });
    if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
    return res.json();
}

async function latestNode() {
    const list = await json(NODE_INDEX);
    const lts = list.find(r => r.lts && r.files?.includes('win-x64-zip'));
    if (!lts) throw new Error('no Node.js LTS for Windows found');
    const name = `node-${lts.version}-win-x64.zip`;
    const sums = await net.fetch(`https://nodejs.org/dist/${lts.version}/SHASUMS256.txt`, { cache: 'no-store' });
    if (!sums.ok) throw new Error(`nodejs.org answered ${sums.status} for the checksums`);
    const line = (await sums.text()).split('\n').find(l => l.trim().endsWith(`  ${name}`));
    if (!line) throw new Error('the checksum for the Node.js zip is missing');
    return { version: lts.version.replace(/^v/, ''), url: `https://nodejs.org/dist/${lts.version}/${name}`, sha256: line.trim().split(/\s+/)[0].toLowerCase(), strip: true };
}

async function latestGit() {
    const rel = await json(GIT_LATEST);
    const asset = (rel.assets || []).find(a => MINGIT_ASSET.test(a.name));
    if (!asset) throw new Error('no MinGit download found in the latest Git for Windows release');
    const sha = /^sha256:([0-9a-f]{64})$/i.exec(asset.digest || '');
    if (!sha) throw new Error('GitHub gave no SHA256 for MinGit');
    const version = (rel.tag_name || '').replace(/^v/, '').replace(/\.windows\.1$/, '');
    return { version, url: asset.browser_download_url, sha256: sha[1].toLowerCase(), size: asset.size, strip: false };
}

// What's installed vs the latest (network; for the "Update" button).
export async function latest() {
    const [node, git] = await Promise.allSettled([latestNode(), latestGit()]);
    return { node: node.value?.version || null, git: git.value?.version || null, error: node.reason?.message || git.reason?.message };
}

// ---------- download + unpack ----------
async function fetchTo(src, file, onProgress) {
    const res = await net.fetch(src.url);
    if (!res.ok) throw new Error(`the download answered ${res.status}`);
    const total = src.size || Number(res.headers.get('content-length')) || 0;
    const hash = crypto.createHash('sha256');
    let got = 0;
    let shown = -1;
    const meter = new Transform({
        transform(chunk, _enc, done) {
            hash.update(chunk);
            got += chunk.length;
            const pct = total ? Math.floor((got * 100) / total) : 0;
            if (pct !== shown) { shown = pct; onProgress(pct); }
            done(null, chunk);
        },
    });
    await pipeline(Readable.fromWeb(res.body), meter, fs.createWriteStream(file));
    if (hash.digest('hex') !== src.sha256) throw new Error('the file does not match its published SHA256');
}

async function unzip(file, dest, strip) {
    const zip = await yauzl.openPromise(file, { lazyEntries: true });
    try {
        for await (const entry of zip.eachEntry()) {
            let name = entry.fileName;
            if (strip) name = name.split('/').slice(1).join('/');
            if (!name) continue;
            const out = path.join(dest, name);
            // yauzl already refuses absolute and ../ names; stay inside dest anyway.
            if (!path.resolve(out).startsWith(path.resolve(dest) + path.sep)) continue;
            if (name.endsWith('/')) { fs.mkdirSync(out, { recursive: true }); continue; }
            fs.mkdirSync(path.dirname(out), { recursive: true });
            await pipeline(await zip.openReadStreamPromise(entry), fs.createWriteStream(out));
        }
    } finally {
        zip.close();
    }
}

// Old copy → .old, new copy in place, then the old one goes. A copy still in
// use (a server running on it) can't be renamed; the caller stops servers first.
function swapIn(tmp, dest) {
    const old = `${dest}.old`;
    fs.rmSync(old, { recursive: true, force: true });
    if (fs.existsSync(dest)) fs.renameSync(dest, old);
    try { fs.renameSync(tmp, dest); } catch (e) {
        if (fs.existsSync(old)) fs.renameSync(old, dest);
        throw e;
    }
    fs.rmSync(old, { recursive: true, force: true });
}

// Downloads Node.js and/or Git (which = ['node', 'git']). onProgress(text).
export async function install(which = ['node', 'git'], onProgress = () => {}) {
    fs.mkdirSync(root, { recursive: true });
    const done = [];
    for (const w of which) {
        const label = w === 'node' ? 'Node.js' : 'Git';
        const tmp = path.join(root, `${w}.partial`);
        const zipFile = path.join(root, `${w}.zip`);
        try {
            onProgress(`Looking up the latest ${label} …`);
            const src = w === 'node' ? await latestNode() : await latestGit();
            const have = readVersion(dirs()[w]);
            if (have?.version === src.version && info()[w]) { log(`${label} ${src.version} (this app's copy) is already the latest.`); done.push(w); continue; }
            log(`Downloading ${label} ${src.version} from ${new URL(src.url).host} …`);
            await fetchTo(src, zipFile, pct => onProgress(`Downloading ${label} ${src.version} … ${pct}%`));
            onProgress(`Unpacking ${label} …`);
            fs.rmSync(tmp, { recursive: true, force: true });
            await unzip(zipFile, tmp, src.strip);
            const exe = w === 'node' ? path.join(tmp, 'node.exe') : path.join(tmp, 'cmd', 'git.exe');
            if (!fs.existsSync(exe)) throw new Error(`the zip has no ${path.basename(exe)}`);
            fs.writeFileSync(path.join(tmp, 'desktop-runtime.json'), JSON.stringify({ version: src.version, sha256: src.sha256, url: src.url, installed: new Date().toISOString() }, null, 2));
            swapIn(tmp, dirs()[w]);
            log(`${label} ${src.version} is ready (SHA256 checked).`);
            done.push(w);
        } catch (e) {
            log(`ERROR: could not get ${label}: ${e.message}`);
            fs.rmSync(tmp, { recursive: true, force: true });
        } finally {
            fs.rmSync(zipFile, { force: true });
        }
    }
    return done.length === which.length;
}

export function remove() {
    try {
        fs.rmSync(root, { recursive: true, force: true });
        log('Removed this app\'s own Node.js and Git.');
        return true;
    } catch (e) {
        log(`ERROR: could not remove ${root}: ${e.message}. Is a server still running?`);
        return false;
    }
}
