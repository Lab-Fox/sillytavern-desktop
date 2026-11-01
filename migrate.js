// migrate.js — copy SillyTavern data (characters, chats, presets, extensions…)
// from one SillyTavern folder to another, or between users of one folder.
//
// Nothing is ever moved or deleted in the source. In the target, a file is
// only replaced when the user's conflict rule says so, and the old one is kept
// first: every migration writes a journal (backups/desktop/migrations/<stamp>/)
// with the files it added and copies of the files it replaced, so Undo puts the
// target back exactly as it was.
//
// scan() reads both folders and returns categories → items (a character, a
// lorebook, an extension…) with how many of their files are new, identical or
// different in the target. The file lists stay here; run() gets item keys.
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { t, N } from './i18n.js';

let log = () => {};
export function initMigrate({ logLine }) { log = logLine; }

// ---------- what SillyTavern keeps where (data/<user>/…) ----------
const PRESET_DIRS = [
    ['OpenAI Settings', 'Chat Completion'], ['TextGen Settings', 'Text Completion'], ['KoboldAI Settings', 'KoboldAI'],
    ['NovelAI Settings', 'NovelAI'], ['instruct', 'Instruct'], ['context', 'Context'], ['sysprompt', 'System prompt'], ['reasoning', 'Reasoning'],
];
const MEDIA_DIRS = [['user/images', 'Gallery images'], ['user/files', 'Files'], ['user/workflows', 'ComfyUI workflows'], ['assets', 'Assets']];
// Everything SillyTavern itself puts in a user folder. Anything else there was
// made by an extension ("Other data"). Thumbnails and logs are rebuilt by SillyTavern.
const KNOWN = new Set(['characters', 'chats', 'groups', 'group chats', 'worlds', 'User Avatars', 'QuickReplies', 'themes', 'movingUI',
    'backgrounds', 'extensions', 'user', 'assets', 'vectors', 'backups', 'settings.json', 'secrets.json', 'stats.json', ...PRESET_DIRS.map(d => d[0])]);
const SKIP = new Set(['thumbnails', 'content.log']);
const THIRD_PARTY = 'public/scripts/extensions/third-party';

// id, label, description, on by default, warning shown when picked
export const CATEGORIES = [
    { id: 'characters', label: N('Characters'), desc: N('Character cards, with their expression sprites.'), on: true },
    { id: 'chats', label: N('Chats'), desc: N('Chats with each character.'), on: true },
    { id: 'groups', label: N('Groups and group chats'), desc: N('Group settings and their chats. The characters in them are separate.'), on: true },
    { id: 'worlds', label: N('Lorebooks (World Info)'), desc: N('Lorebooks not built into a character card.'), on: true },
    { id: 'presets', label: N('Presets'), desc: N('Chat and Text Completion, KoboldAI, NovelAI, instruct, context, system prompt and reasoning presets.'), on: true },
    { id: 'personas', label: N('Persona avatars'), desc: N('The pictures of your personas. Their names and descriptions are part of Settings.'), on: true },
    { id: 'quickreplies', label: N('Quick Replies'), desc: N('Quick Reply sets.'), on: true },
    { id: 'themes', label: N('UI themes and layouts'), desc: N('SillyTavern themes and MovingUI layouts.'), on: true },
    { id: 'backgrounds', label: N('Backgrounds'), desc: N('Chat backgrounds you added.'), on: true },
    { id: 'extensions', label: N('Extensions'), desc: N('Third-party extensions (their settings are part of Settings).'), on: true },
    { id: 'media', label: N('Images and files'), desc: N('Gallery images, data bank files, ComfyUI workflows and assets.'), on: true },
    { id: 'other', label: N('Extension data'), desc: N('Folders that extensions created in your data folder.'), on: true },
    { id: 'vectors', label: N('Vector storage'), desc: N('The search index of Vector Storage. SillyTavern can rebuild it.'), on: false },
    { id: 'backups', label: N('SillyTavern\'s own backups'), desc: N('Automatic chat and settings backups SillyTavern made.'), on: false },
    { id: 'settings', label: N('Settings'), desc: N('Everything in SillyTavern\'s settings: UI, API connections, persona names and descriptions, extension settings.'), on: false,
        warn: N('Replaces all settings of the target as a whole (API connections, personas, extension settings, UI). Pick this for a full copy, not to add a few things.') },
    { id: 'secrets', label: N('API keys'), desc: N('Your saved API keys and passwords (secrets.json).'), on: false,
        warn: N('Copies your API keys. Only do this between your own SillyTavern folders.') },
    { id: 'stats', label: N('Usage stats'), desc: N('Message and time statistics.'), on: false },
];

// ---------- file helpers ----------
const abs = (root, rel) => path.join(root, ...rel.split('/'));
async function statOrNull(p) { try { return await fs.promises.stat(p); } catch { return null; } }
async function entries(dir) { try { return await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return []; } }

// Every file under rel (a file or a folder), as rel paths with size and time.
async function filesUnder(root, rel) {
    const st = await statOrNull(abs(root, rel));
    if (!st) return [];
    if (st.isFile()) return [{ rel, size: st.size, mtime: st.mtimeMs }];
    const out = [];
    for (const e of await entries(abs(root, rel))) out.push(...await filesUnder(root, `${rel}/${e.name}`));
    return out;
}

// Users in a SillyTavern folder: data/<handle>/ (SillyTavern's own folders start with "_").
export function users(stRoot) {
    try {
        return fs.readdirSync(path.join(stRoot, 'data'), { withFileTypes: true })
            .filter(d => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('.'))
            .map(d => d.name)
            .sort((a, b) => (a === 'default-user' ? -1 : b === 'default-user' ? 1 : a.localeCompare(b)));
    } catch { return []; }
}

// ---------- scanning ----------
// An item's paths are "u:<rel>" (inside the user folder) or "s:<rel>" (inside
// the SillyTavern folder: extensions for all users).
function item(cat, key, label, paths, extra = {}) { return { cat, key, label, paths, ...extra }; }

async function listItems(src, srcUser) {
    const u = `data/${srcUser}`;
    const root = rel => abs(src, `${u}/${rel}`);
    const names = async (rel, { files = true, dirs = true } = {}) => (await entries(root(rel)))
        .filter(e => (files && e.isFile()) || (dirs && e.isDirectory())).map(e => e.name).sort((a, b) => a.localeCompare(b));
    const items = [];
    const base = n => n.replace(/\.[^.]+$/, '');

    // Characters: the card, plus a folder of the same name (expression sprites).
    const charDirs = new Set(await names('characters', { files: false }));
    for (const f of await names('characters', { dirs: false })) {
        if (!/\.png$/i.test(f)) continue;
        const name = base(f);
        items.push(item('characters', `u:characters/${f}`, name, [`u:characters/${f}`, ...(charDirs.has(name) ? [`u:characters/${name}`] : [])], { chats: `u:chats/${name}` }));
    }
    for (const d of await names('chats', { files: false })) items.push(item('chats', `u:chats/${d}`, d, [`u:chats/${d}`], { character: `${d}.png` }));
    for (const f of await names('groups', { dirs: false })) {
        if (!f.endsWith('.json')) continue;
        let g = {};
        try { g = JSON.parse(await fs.promises.readFile(root(`groups/${f}`), 'utf8')); } catch { /* unreadable: copy it anyway */ }
        const chats = Array.isArray(g.chats) ? g.chats.map(c => `u:group chats/${c}.jsonl`) : [];
        items.push(item('groups', `u:groups/${f}`, String(g.name || base(f)), [`u:groups/${f}`, ...chats], { members: Array.isArray(g.members) ? g.members.map(String) : [] }));
    }
    for (const f of await names('worlds', { dirs: false })) items.push(item('worlds', `u:worlds/${f}`, base(f), [`u:worlds/${f}`]));
    for (const [dir, kind] of PRESET_DIRS) for (const f of await names(dir, { dirs: false })) items.push(item('presets', `u:${dir}/${f}`, base(f), [`u:${dir}/${f}`], { sub: kind }));
    for (const f of await names('User Avatars', { dirs: false })) items.push(item('personas', `u:User Avatars/${f}`, base(f), [`u:User Avatars/${f}`]));
    for (const f of await names('QuickReplies', { dirs: false })) items.push(item('quickreplies', `u:QuickReplies/${f}`, base(f), [`u:QuickReplies/${f}`]));
    for (const f of await names('themes', { dirs: false })) items.push(item('themes', `u:themes/${f}`, base(f), [`u:themes/${f}`], { sub: 'Theme' }));
    for (const f of await names('movingUI', { dirs: false })) items.push(item('themes', `u:movingUI/${f}`, base(f), [`u:movingUI/${f}`], { sub: 'Layout' }));
    for (const f of await names('backgrounds')) items.push(item('backgrounds', `u:backgrounds/${f}`, f, [`u:backgrounds/${f}`]));
    for (const d of await names('extensions', { files: false })) items.push(item('extensions', `u:extensions/${d}`, d, [`u:extensions/${d}`], { sub: 'this user' }));
    for (const e of await entries(abs(src, THIRD_PARTY))) if (e.isDirectory()) items.push(item('extensions', `s:${THIRD_PARTY}/${e.name}`, e.name, [`s:${THIRD_PARTY}/${e.name}`], { sub: 'all users' }));
    for (const [dir, kind] of MEDIA_DIRS) for (const f of await names(dir)) items.push(item('media', `u:${dir}/${f}`, f, [`u:${dir}/${f}`], { sub: kind }));
    for (const f of await names('vectors')) items.push(item('vectors', `u:vectors/${f}`, f, [`u:vectors/${f}`]));
    if ((await names('backups')).length) items.push(item('backups', 'u:backups', 'All of SillyTavern\'s backups', ['u:backups']));
    for (const [cat, f] of [['settings', 'settings.json'], ['secrets', 'secrets.json'], ['stats', 'stats.json']]) {
        if (await statOrNull(root(f))) items.push(item(cat, `u:${f}`, f, [`u:${f}`]));
    }
    // Whatever else is in the user folder (made by extensions); half-written temp files are left out.
    for (const e of await entries(abs(src, u))) {
        if (KNOWN.has(e.name) || SKIP.has(e.name) || /\.(tmp|\d+)$/i.test(e.name)) continue;
        items.push(item('other', `u:${e.name}`, e.name, [`u:${e.name}`]));
    }
    return items;
}

// Are two files the same? Small files (chats, settings, presets): same bytes.
// Big ones (images, models): same size and modification time.
async function sameFile(a, b, aStat, bStat) {
    if (aStat.size !== bStat.size) return false;
    if (aStat.size > 4 * 1024 * 1024) return Math.abs(aStat.mtimeMs - bStat.mtimeMs) < 2000;
    try { return (await fs.promises.readFile(a)).equals(await fs.promises.readFile(b)); } catch { return false; }
}

const scans = new Map(); // id → { src, srcUser, dst, dstUser, items }
const resolveRel = (p, user) => (p.startsWith('u:') ? `data/${user}/${p.slice(2)}` : p.slice(2));

// Returns what the launcher shows: categories with items and their state in the target.
export async function scan({ src, srcUser, dst, dstUser }) {
    const t0 = Date.now();
    const items = await listItems(src, srcUser);
    for (const it of items) {
        it.files = [];
        for (const p of it.paths) {
            for (const f of await filesUnder(src, resolveRel(p, srcUser))) {
                // The same file in the target: a user folder maps to the target user.
                const dstRel = p.startsWith('u:') ? `data/${dstUser}/${f.rel.slice(`data/${srcUser}/`.length)}` : f.rel;
                const dStat = await statOrNull(abs(dst, dstRel));
                let state = 'new';
                if (dStat) state = dStat.isFile() && await sameFile(abs(src, f.rel), abs(dst, dstRel), { size: f.size, mtimeMs: f.mtime }, dStat) ? 'same' : 'different';
                it.files.push({ ...f, dstRel, state, dstMtime: dStat?.mtimeMs || 0 });
            }
        }
    }
    // Which characters the target has already (for "is this group/chat complete?").
    const targetChars = (await entries(abs(dst, `data/${dstUser}/characters`))).filter(e => e.isFile()).map(e => e.name);
    const id = crypto.randomBytes(6).toString('hex');
    scans.clear(); // one scan at a time is plenty
    scans.set(id, { src, srcUser, dst, dstUser, items });
    log(`Migration: looked at ${items.reduce((n, i) => n + i.files.length, 0)} files in ${src} (${((Date.now() - t0) / 1000).toFixed(1)} s).`);
    const count = (it, s) => it.files.filter(f => f.state === s).length;
    return {
        id, targetChars,
        categories: CATEGORIES.map(c => ({
            ...c, label: t(c.label), desc: t(c.desc), warn: c.warn ? t(c.warn) : undefined,
            items: items.filter(i => i.cat === c.id).map(i => ({
                key: i.key, label: i.label, sub: i.sub || '', chats: i.chats, character: i.character, members: i.members,
                files: i.files.length, size: i.files.reduce((n, f) => n + f.size, 0),
                newFiles: count(i, 'new'), sameFiles: count(i, 'same'), diffFiles: count(i, 'different'),
                newerInSource: i.files.filter(f => f.state === 'different' && f.mtime > f.dstMtime + 2000).length,
            })),
        })).filter(c => c.items.length),
    };
}

// ---------- copying ----------
// policy for files that exist in the target with other contents:
// 'skip' (keep the target's), 'newer' (take whichever was changed last), 'replace'.
function plan(s, keys, policy) {
    const want = new Set(keys);
    const todo = [];
    let skipped = 0;
    for (const it of s.items) {
        if (!want.has(it.key)) continue;
        for (const f of it.files) {
            if (f.state === 'same') continue;
            if (f.state === 'different' && !(policy === 'replace' || (policy === 'newer' && f.mtime > f.dstMtime + 2000))) { skipped++; continue; }
            todo.push(f);
        }
    }
    return { todo, skipped, bytes: todo.reduce((n, f) => n + f.size, 0) };
}

// What a run would do, for the confirmation: { files, bytes, replaces, skipped, free }.
export function preview(scanId, keys, policy) {
    const s = scans.get(scanId);
    if (!s) return null;
    const p = plan(s, keys, policy);
    let free = null;
    try { const st = fs.statfsSync(s.dst); free = st.bavail * st.bsize; } catch { /* unknown */ }
    return { files: p.todo.length, bytes: p.bytes, replaces: p.todo.filter(f => f.state === 'different').length, skipped: p.skipped, free };
}

let current = null; // { cancelled }
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
export const journalsDir = stRoot => path.join(stRoot, 'backups', 'desktop', 'migrations');

export async function run(scanId, keys, policy, onProgress = () => {}) {
    const s = scans.get(scanId);
    if (!s) return { error: t('Look at the folders again first (the scan is out of date).') };
    const { todo, skipped, bytes } = plan(s, keys, policy);
    if (!todo.length) return { error: t('Nothing to copy: everything you picked is already there.') };
    const id = stamp();
    const dir = path.join(journalsDir(s.dst), id);
    const journal = { id, at: Date.now(), from: s.src, fromUser: s.srcUser, to: s.dst, toUser: s.dstUser, policy, added: [], replaced: [], items: keys.length, done: false };
    const writeJournal = () => fs.writeFileSync(path.join(dir, 'journal.json'), JSON.stringify(journal, null, 1));
    fs.mkdirSync(dir, { recursive: true });
    writeJournal();
    current = { cancelled: false };
    const job = current;
    let done = 0;
    let copied = 0;
    let lastSent = 0;
    log(`Migrating ${todo.length} files (${(bytes / 1024 ** 2).toFixed(0)} MB) from ${s.src}${s.srcUser !== 'default-user' ? ` (user ${s.srcUser})` : ''} to ${s.dst}${s.dstUser !== 'default-user' ? ` (user ${s.dstUser})` : ''} ...`);
    try {
        for (const f of todo) {
            if (job.cancelled) break;
            const to = abs(s.dst, f.dstRel);
            await fs.promises.mkdir(path.dirname(to), { recursive: true });
            const old = await statOrNull(to);
            if (old) {
                // Kept for Undo before it is overwritten, with its own time.
                const keep = abs(dir, `replaced/${f.dstRel}`);
                await fs.promises.mkdir(path.dirname(keep), { recursive: true });
                await fs.promises.copyFile(to, keep);
                await fs.promises.utimes(keep, old.atime, old.mtime).catch(() => {});
                journal.replaced.push(f.dstRel);
            } else journal.added.push(f.dstRel);
            await fs.promises.copyFile(abs(s.src, f.rel), to);
            // Same time as the source, so the next look sees it as identical.
            await fs.promises.utimes(to, new Date(), new Date(f.mtime)).catch(() => {});
            done++;
            copied += f.size;
            if (Date.now() - lastSent > 120) {
                lastSent = Date.now();
                onProgress({ done, total: todo.length, bytes: copied, totalBytes: bytes, file: f.dstRel.split('/').slice(2).join('/') });
                if (done % 200 === 0) writeJournal();
            }
        }
    } catch (e) {
        journal.error = e.message;
        log(`ERROR: migration stopped: ${e.message}. Everything copied so far can be undone.`);
    }
    journal.done = !job.cancelled && !journal.error;
    journal.cancelled = job.cancelled;
    writeJournal();
    current = null;
    onProgress({ done, total: todo.length, bytes: copied, totalBytes: bytes, file: '' });
    log(`${job.cancelled ? 'Migration cancelled' : journal.error ? 'Migration stopped' : 'Migration finished'}: ${journal.added.length} files added, ${journal.replaced.length} replaced (the old ones are kept for Undo), ${skipped} kept as they were.`);
    return { id, added: journal.added.length, replaced: journal.replaced.length, skipped, cancelled: job.cancelled, error: journal.error };
}

export function cancel() { if (current) { current.cancelled = true; return true; } return false; }

// ---------- undo ----------
export function journals(stRoot) {
    const out = [];
    for (const e of fs.existsSync(journalsDir(stRoot)) ? fs.readdirSync(journalsDir(stRoot)) : []) {
        try {
            const j = JSON.parse(fs.readFileSync(path.join(journalsDir(stRoot), e, 'journal.json'), 'utf8'));
            out.push({ id: j.id, at: j.at, from: j.from, fromUser: j.fromUser, toUser: j.toUser, added: j.added.length, replaced: j.replaced.length, cancelled: !!j.cancelled, error: j.error || '' });
        } catch { /* not a journal */ }
    }
    return out.sort((a, b) => b.at - a.at);
}

// Removes what a migration added and puts back what it replaced. Folders it
// created and left empty go too. The journal folder is deleted at the end.
export async function undo(stRoot, id) {
    if (!/^[\w-]+$/.test(id)) return false;
    stRoot = path.resolve(stRoot);
    const dir = path.join(journalsDir(stRoot), id);
    let j;
    try { j = JSON.parse(fs.readFileSync(path.join(dir, 'journal.json'), 'utf8')); } catch { log('ERROR: that migration can no longer be undone (its journal is missing).'); return false; }
    let removed = 0, restored = 0;
    const dirs = new Set();
    for (const rel of j.added) {
        try { await fs.promises.rm(abs(stRoot, rel), { force: true }); removed++; dirs.add(path.dirname(abs(stRoot, rel))); } catch { /* in use */ }
    }
    for (const rel of j.replaced) {
        try {
            const keep = abs(dir, `replaced/${rel}`);
            await fs.promises.copyFile(keep, abs(stRoot, rel));
            const t = await fs.promises.stat(keep);
            await fs.promises.utimes(abs(stRoot, rel), t.atime, t.mtime).catch(() => {});
            restored++;
        } catch (e) { log(`Could not put back ${rel}: ${e.message}`); }
    }
    // Empty folders left by removed files, deepest first, never above data/ or third-party/.
    const stop = new Set([path.join(stRoot, 'data'), abs(stRoot, THIRD_PARTY)].map(p => p.toLowerCase()));
    for (const d of [...dirs].sort((a, b) => b.length - a.length)) {
        let cur = d;
        while (cur.toLowerCase().startsWith(stRoot.toLowerCase()) && !stop.has(cur.toLowerCase())) {
            try { await fs.promises.rmdir(cur); } catch { break; } // not empty
            cur = path.dirname(cur);
        }
    }
    const ok = restored === j.replaced.length;
    if (ok) {
        await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
        // Folders the journal needed, only if nothing else is in them.
        for (const d of [journalsDir(stRoot), path.dirname(journalsDir(stRoot)), path.join(stRoot, 'backups')]) await fs.promises.rmdir(d).catch(() => {});
    }
    log(`Undid the migration from ${new Date(j.at).toLocaleString()}: removed ${removed} added files, put back ${restored} replaced files.${ok ? '' : ' Some files could not be put back; the copies are still in backups/desktop/migrations.'}`);
    return ok;
}
