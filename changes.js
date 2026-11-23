// The change journal (api.changes): before an add-on changes SillyTavern's
// files, it records the change here; each file it will touch is copied
// first, so the whole file can always be put back. Item-level Undo (one
// message, one entry) stays the add-on's job: the journal keeps its before /
// after data with the copies.
//
// <add-on>/user/changes/blobs/<sha256>   file copies, stored once per content
// <add-on>/user/changes/<id>/item.json   the add-on's before / after data
// <add-on>/user/changes/<id>/entry.json  the entry, written last
// Everything is flushed to disk before record() returns.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const ID = /^[a-z0-9]+-[a-f0-9]{8}$/;
const SHA = /^[a-f0-9]{64}$/;
const MAX_ITEM_BYTES = 5 * 1024 * 1024;
const ORPHAN_MS = 60 * 60 * 1000;
// Where changes may happen: SillyTavern's data, and third-party extensions
// (never SillyTavern's own code).
const ROOTS = [['data'], ['public', 'scripts', 'extensions', 'third-party']];
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

// Strictly increasing, so changes made in the same millisecond keep their order.
let lastAt = 0;
const stamp = () => (lastAt = Math.max(Date.now(), lastAt + 1));

// Hashes (and optionally copies) a file in pieces, without blocking the
// app (a big chat takes a second or more to copy and flush to disk).
async function hashFile(file, copyTo = null) {
    const h = crypto.createHash('sha256');
    const buf = Buffer.allocUnsafe(1 << 20);
    const fd = await fs.promises.open(file, 'r');
    const out = copyTo ? await fs.promises.open(copyTo, 'w') : null;
    try {
        for (;;) {
            const { bytesRead: n } = await fd.read(buf, 0, buf.length, null);
            if (!n) break;
            h.update(buf.subarray(0, n));
            if (out) await out.write(buf, 0, n);
        }
        if (out) await out.sync();
    } finally {
        await fd.close();
        if (out) await out.close();
    }
    return h.digest('hex');
}
const hashOrNull = async file => (fs.existsSync(file) ? hashFile(file) : null);

async function writeDurable(file, text) {
    const tmp = `${file}.${process.pid}.tmp`;
    const fd = await fs.promises.open(tmp, 'w');
    try { await fd.writeFile(text); await fd.sync(); } finally { await fd.close(); }
    await fs.promises.rename(tmp, file);
}

const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

function isStRoot(dir) {
    try { return fs.existsSync(path.join(dir, 'server.js')) && JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).name === 'sillytavern'; } catch { return false; }
}

// The file, checked: inside <folder>/data or a third-party extension; the
// root itself may be a junction (data moved to another drive), but nothing
// below it may be a link or junction, dangling or not; no names Windows
// treats specially. Returns { abs, rel } (rel with forward slashes).
function checkFile(folder, file) {
    const abs = path.resolve(folder, String(file));
    const relParts = path.relative(path.resolve(folder), abs).split(path.sep);
    const outside = () => new Error(`Only files inside SillyTavern's data folder or a third-party extension can be changed (${String(file).slice(0, 120)} is outside).`);
    if (!relParts[0] || relParts[0] === '..' || path.isAbsolute(relParts.join(path.sep))) throw outside();
    const root = ROOTS.find(r => r.every((p, i) => (relParts[i] || '').toLowerCase() === p));
    const below = root ? relParts.slice(root.length) : [];
    if (!root || !below.length) throw outside();
    const rel = relParts.join('/');
    for (const part of below) {
        if (part.includes(':') || /[. ]$/.test(part) || RESERVED.test(part)) throw new Error(`${rel}: that name can't be used on Windows.`);
    }
    let cur = path.join(path.resolve(folder), ...root);
    try { fs.realpathSync.native(cur); } catch (e) { if (e.code !== 'ENOENT') throw outside(); } // not made yet is fine
    for (const part of below) {
        cur = path.join(cur, part);
        let st;
        try { st = fs.lstatSync(cur); } catch (e) {
            if (e.code === 'ENOENT') break; // the rest doesn't exist yet
            throw new Error(`${rel} can't be checked (${e.code}).`);
        }
        if (st.isSymbolicLink()) throw new Error(`${rel} goes through a link or junction: refused.`);
    }
    return { abs, rel };
}

export function openJournal(addonDir) {
    const root = path.join(addonDir, 'user', 'changes');
    const blobs = path.join(root, 'blobs');
    const dirOf = id => path.join(root, id);
    const blobOf = sha => path.join(blobs, sha);
    const readJson = (file, fallback = null) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
    const read = id => (ID.test(String(id)) ? readJson(path.join(dirOf(id), 'entry.json')) : null);
    const fileOf = (e, file) => {
        const abs = path.resolve(e.folder, String(file));
        const f = e.files.find(x => same(path.resolve(e.folder, x.rel), abs));
        if (!f) throw new Error(`That change didn't touch ${String(file).slice(0, 120)}.`);
        return f;
    };
    const view = e => ({ ...e, files: e.files.map(f => ({ ...f, path: path.resolve(e.folder, f.rel) })) });
    const ids = () => { try { return fs.readdirSync(root).filter(x => ID.test(x)); } catch { return []; } };
    const all = () => ids().map(read).filter(Boolean).sort((a, b) => b.at - a.at || (b.id > a.id ? 1 : -1));
    // A copy of the file into blobs/<sha256> (kept once per content).
    const store = async abs => {
        fs.mkdirSync(blobs, { recursive: true });
        const tmp = path.join(blobs, `.in-${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
        try {
            const sha = await hashFile(abs, tmp);
            if (fs.existsSync(blobOf(sha))) { fs.rmSync(tmp, { force: true }); return { sha, created: false }; }
            fs.renameSync(tmp, blobOf(sha));
            return { sha, created: true };
        } catch (e) { fs.rmSync(tmp, { force: true }); throw e; }
    };

    return Object.freeze({
        // Resolves with the id once the copies and the entry are on disk.
        async record({ folder, kind, target = null, before = null, after = null, files = [] } = {}) {
            if (!folder || !isStRoot(folder)) throw new Error('That is not a SillyTavern folder.');
            if (!Array.isArray(files) || !files.length) throw new Error('Name the files the change will touch.');
            const item = JSON.stringify({ kind: String(kind || ''), target, before, after });
            if (Buffer.byteLength(item) > MAX_ITEM_BYTES) throw new Error('The change\'s data is too big (over 5 MB).');
            const checked = files.map(f => checkFile(folder, f)); // all checked before anything is copied
            const at = stamp();
            const id = `${at.toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
            const dir = dirOf(id);
            fs.mkdirSync(root, { recursive: true });
            fs.mkdirSync(dir); // not recursive: a clash would fail here
            const created = [];
            try {
                const list = [];
                for (const c of checked) list.push(await (async () => {
                    if (!fs.existsSync(c.abs)) return { rel: c.rel, existed: false, size: 0, sha256: null, afterSha256: null };
                    if (!fs.statSync(c.abs).isFile()) throw new Error(`${c.rel} is not a file.`);
                    const { sha, created: isNew } = await store(c.abs);
                    if (isNew) created.push(sha);
                    return { rel: c.rel, existed: true, size: fs.statSync(blobOf(sha)).size, sha256: sha, afterSha256: null };
                })());
                const { kind: k, target: tg, before: b, after: a } = JSON.parse(item);
                await writeDurable(path.join(dir, 'item.json'), JSON.stringify({ before: b, after: a }));
                await writeDurable(path.join(dir, 'entry.json'), JSON.stringify({ id, at, folder: path.resolve(folder), kind: k, target: tg, files: list, finished: false }));
            } catch (e) {
                fs.rmSync(dir, { recursive: true, force: true });
                for (const sha of created) fs.rmSync(blobOf(sha), { force: true });
                throw e;
            }
            return id;
        },
        // After the write: each file's new hash, for the "changed since" check.
        async finish(id) {
            const e = read(id);
            if (!e) throw new Error('No such change.');
            for (const f of e.files) f.afterSha256 = await hashOrNull(path.resolve(e.folder, f.rel));
            e.finished = true;
            await writeDurable(path.join(dirOf(id), 'entry.json'), JSON.stringify(e));
            return true;
        },
        get(id) {
            const e = read(id);
            if (!e) return null;
            const { before = null, after = null } = readJson(path.join(dirOf(id), 'item.json'), {});
            return { ...view(e), before, after };
        },
        list({ folder } = {}) { return all().filter(e => !folder || same(e.folder, folder)).map(view); },
        safetyCopy(id, file) {
            const e = read(id);
            if (!e) throw new Error('No such change.');
            const f = fileOf(e, file);
            return f.sha256 ? blobOf(f.sha256) : null;
        },
        // Puts the whole file back as it was before the change (a file that
        // didn't exist is removed). Refused when the file changed since: after
        // finish(), against its new hash; before finish() (the write failed or
        // the app stopped), against the hash it had when recorded.
        async restoreFile(id, file, { force = false } = {}) {
            const e = read(id);
            if (!e) throw new Error('No such change.');
            const f = fileOf(e, file);
            const abs = path.resolve(e.folder, f.rel);
            checkFile(e.folder, abs);
            const now = await hashOrNull(abs);
            if (!force) {
                if (!e.finished && now === f.sha256) return true; // nothing was written
                if (now !== (e.finished ? f.afterSha256 : f.sha256)) throw new Error(`${f.rel} changed since this change.`);
            }
            if (!f.existed) { fs.rmSync(abs, { force: true }); return true; }
            const tmp = `${abs}.restore.tmp`;
            try {
                fs.mkdirSync(path.dirname(abs), { recursive: true });
                const sha = SHA.test(f.sha256) && fs.existsSync(blobOf(f.sha256)) ? await hashFile(blobOf(f.sha256), tmp) : null;
                if (sha !== f.sha256) throw new Error(`The copy of ${f.rel} is damaged or missing: nothing was changed.`);
                fs.renameSync(tmp, abs);
            } finally { fs.rmSync(tmp, { force: true }); }
            return true;
        },
        // Removes entries that are both older than `days` and not among the
        // newest `keep`, copies no entry uses any more, and leftovers of
        // records that never finished writing. Returns how many entries went.
        prune({ days = 30, keep = 200 } = {}) {
            const d = Number.isFinite(Number(days)) ? Math.max(0, Number(days)) : 30;
            const k = Number.isFinite(Number(keep)) ? Math.max(0, Math.floor(Number(keep))) : 200;
            const cutoff = Date.now() - d * 864e5;
            let n = 0;
            const used = new Set();
            all().forEach((e, i) => {
                if (i < k || e.at >= cutoff) { for (const f of e.files) if (f.sha256) used.add(f.sha256); return; }
                fs.rmSync(dirOf(e.id), { recursive: true, force: true });
                n++;
            });
            for (const id of ids()) {
                if (fs.existsSync(path.join(dirOf(id), 'entry.json'))) continue;
                try { if (Date.now() - fs.statSync(dirOf(id)).mtimeMs > ORPHAN_MS) fs.rmSync(dirOf(id), { recursive: true, force: true }); } catch { /* gone */ }
            }
            let names = [];
            try { names = fs.readdirSync(blobs); } catch { /* none */ }
            for (const name of names) if (!used.has(name)) fs.rmSync(blobOf(name), { force: true });
            return n;
        },
        // Bytes the copies take on disk.
        size() {
            let total = 0;
            try { for (const name of fs.readdirSync(blobs)) total += fs.statSync(blobOf(name)).size; } catch { /* none */ }
            return total;
        },
    });
}
