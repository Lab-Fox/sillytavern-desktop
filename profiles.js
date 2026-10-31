// profiles.js — named SillyTavern folders to switch between ("Main",
// "Testing 1.18", …). Stored in settings.profiles as [{ id, name, path }];
// the profile in use is the one whose folder is settings.sillytavernPath.
// Only the list lives here: switching (which restarts the server) is main.js.
import crypto from 'crypto';
import path from 'path';
import { isStRoot } from './setup.js';
import { describe } from './instances.js';

export const sameDir = (a, b) => !!a && !!b && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const clean = name => String(name || '').replace(/\s+/g, ' ').trim().slice(0, 40);
const newId = () => crypto.randomBytes(4).toString('hex');

// Settings from before profiles existed (or edited by hand): drop broken
// entries and give the folder in use a profile.
export function normalize(settings) {
    const before = JSON.stringify(settings.profiles);
    const seen = new Set();
    settings.profiles = (Array.isArray(settings.profiles) ? settings.profiles : [])
        .filter(p => p && typeof p.path === 'string' && p.path && clean(p.name))
        .map(p => ({ id: /^[\w-]{1,32}$/.test(p.id) ? p.id : newId(), name: clean(p.name), path: p.path }))
        .filter(p => !seen.has(p.id) && seen.add(p.id));
    if (isStRoot(settings.sillytavernPath)) ensureFor(settings, settings.sillytavernPath);
    return JSON.stringify(settings.profiles) !== before;
}

// A name for a folder that has no profile yet: "SillyTavern 1.19.0", made unique.
export function suggestName(settings, dir) {
    const v = describe(dir).version;
    return unique(settings, v ? `SillyTavern ${v}` : path.basename(dir));
}

function unique(settings, base, exceptId) {
    const taken = n => settings.profiles.some(p => p.id !== exceptId && p.name.toLowerCase() === n.toLowerCase());
    let name = clean(base);
    for (let i = 2; taken(name); i++) name = `${clean(base).slice(0, 35)} (${i})`;
    return name;
}

// The profile of a folder, created if there is none.
export function ensureFor(settings, dir) {
    let p = settings.profiles.find(x => sameDir(x.path, dir));
    if (!p) {
        p = { id: newId(), name: suggestName(settings, dir), path: dir };
        settings.profiles.push(p);
    }
    return p;
}

export const active = settings => settings.profiles.find(p => sameDir(p.path, settings.sillytavernPath)) || null;

// For the launcher, the tray and menus.
export function list(settings) {
    return settings.profiles.map(p => {
        const ok = isStRoot(p.path);
        const d = ok ? describe(p.path) : { version: '', branch: '' };
        return { ...p, active: sameDir(p.path, settings.sillytavernPath), ok, version: d.version, branch: d.branch };
    });
}

// Add (no id) or edit a profile. Returns { profile } or { error } for the user.
export function save(settings, { id, name, path: dir }) {
    const n = clean(name);
    if (!n) return { error: 'Give the profile a name.' };
    const existing = id ? settings.profiles.find(p => p.id === id) : null;
    if (id && !existing) return { error: 'That profile no longer exists.' };
    if (settings.profiles.some(p => p.id !== id && p.name.toLowerCase() === n.toLowerCase())) return { error: `There is already a profile called "${n}".` };
    if (!isStRoot(dir)) return { error: 'There is no SillyTavern in that folder. Pick the folder that contains server.js.' };
    const twin = settings.profiles.find(p => p.id !== id && sameDir(p.path, dir));
    if (twin) return { error: `The profile "${twin.name}" already uses that folder.` };
    if (existing) {
        Object.assign(existing, { name: n, path: dir });
        return { profile: existing };
    }
    const profile = { id: newId(), name: n, path: dir };
    settings.profiles.push(profile);
    return { profile };
}

export function remove(settings, id) {
    settings.profiles = settings.profiles.filter(p => p.id !== id);
}

// After "Move to another folder": the profile follows its folder.
export function moved(settings, from, to) {
    for (const p of settings.profiles) if (sameDir(p.path, from)) p.path = to;
}
