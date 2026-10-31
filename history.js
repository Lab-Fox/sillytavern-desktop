// history.js — what changed in each SillyTavern folder, for "What's new" and
// a profile's history: updates, downloads, release/staging switches, and
// changes made outside the app (git pull by hand, SillyTavern's own updater).
//
// Kept in <userData>/st-history.json: { entries: [...], known: { folder: { commit, version, branch } } }.
// An entry: { id, at, path, kind: 'update' | 'download' | 'branch' | 'outside',
//   from: { version, branch, commit } | null, to: { version, branch, pinned, commit },
//   commits: [{ h, d, s }] (newest first, up to 300), commitCount, back, seen }.
// Release notes aren't stored: the launcher reads them from the version list.
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { git } from './maintenance.js';

const MAX_ENTRIES = 300;
const MAX_COMMITS = 300;
let file = '';
let data = null;

export function initHistory(userData) { file = path.join(userData, 'st-history.json'); }

const key = dir => path.resolve(dir).toLowerCase();
function load() {
    if (data) return data;
    try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { data = null; }
    if (!data || !Array.isArray(data.entries)) data = { entries: [], known: {} };
    data.known ||= {};
    return data;
}
function save() {
    const d = load();
    if (d.entries.length > MAX_ENTRIES) d.entries.splice(0, d.entries.length - MAX_ENTRIES);
    try {
        fs.writeFileSync(`${file}.tmp`, JSON.stringify(d));
        fs.renameSync(`${file}.tmp`, file);
    } catch { /* next change writes it again */ }
}

const pick = i => (i ? { version: i.version || '', branch: i.branch || '', pinned: i.pinned || '', commit: i.commit || '' } : null);

// `git log --format=%h%x09%cs%x09%s` → [{ h, d, s }]
export function parseLog(out) {
    return String(out).split(/\r?\n/).filter(Boolean).map(l => {
        const [h, d, ...s] = l.split('\t');
        return { h, d, s: s.join('\t').slice(0, 200) };
    });
}

// Commits that came in between two states (and how many went away, after a
// switch back to an older branch). The commits are all local after a pull.
async function commitsBetween(dir, from, to) {
    if (!from || !to || from === to) return { commits: [], commitCount: 0, back: 0 };
    const log = await git(dir, ['log', '--no-merges', `--max-count=${MAX_COMMITS}`, '--format=%h%x09%cs%x09%s', `${from}..${to}`], { quiet: true });
    const commits = log.code !== 0 ? [] : parseLog(log.out);
    const count = await git(dir, ['rev-list', '--no-merges', '--count', `${from}..${to}`], { quiet: true });
    const back = await git(dir, ['rev-list', '--no-merges', '--count', `${to}..${from}`], { quiet: true });
    return {
        commits,
        commitCount: count.code === 0 ? parseInt(count.out, 10) || 0 : commits.length,
        back: back.code === 0 ? parseInt(back.out, 10) || 0 : 0,
    };
}

// Records a change. before: getInfo() from before it (null for a download),
// after: getInfo() now. Returns the entry, or null if nothing changed.
export async function record(kind, dir, before, after) {
    const d = load();
    d.known[key(dir)] = pick(after);
    if (before && before.commit && before.commit === after.commit) { save(); return null; }
    const entry = {
        id: crypto.randomBytes(5).toString('hex'), at: Date.now(), path: dir, kind,
        from: pick(before), to: pick(after),
        ...(await commitsBetween(dir, before?.commit, after.commit)),
        // A download was looked at in the download dialog already.
        seen: kind === 'download',
    };
    d.entries.push(entry);
    save();
    return entry;
}

// On launch and on every switch: did the folder change while the app wasn't
// looking? (The first time a folder is seen only remembers where it is.)
export async function checkOutside(dir, now) {
    const known = load().known[key(dir)];
    if (!now.isGit || !now.commit) return null;
    if (!known) { load().known[key(dir)] = pick(now); save(); return null; }
    if (known.commit === now.commit) return null;
    return record('outside', dir, known, now);
}

export const forPath = dir => load().entries.filter(e => key(e.path) === key(dir)).reverse();
export const unseen = dir => forPath(dir).find(e => !e.seen) || null;
export function markSeen(id) {
    const e = load().entries.find(x => x.id === id);
    if (e && !e.seen) { e.seen = true; save(); }
}
// A folder that moved keeps its history.
export function moved(from, to) {
    const d = load();
    for (const e of d.entries) if (key(e.path) === key(from)) e.path = to;
    if (d.known[key(from)]) { d.known[key(to)] = d.known[key(from)]; delete d.known[key(from)]; }
    save();
}
