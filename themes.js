// Launcher themes: two built-ins plus user themes stored as JSON in
// <userData>/themes. A theme is only colors + a logo — never raw CSS — so
// an imported file can't inject styles or scripts into the launcher.
import path from 'path';
import fs from 'fs';

// Required keys; the launcher derives the in-between shades from these.
export const COLOR_KEYS = ['bg', 'panel', 'border', 'accent', 'text', 'title', 'muted'];
const OPTIONAL_KEYS = ['onAccent', 'good', 'warn', 'bad'];
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const LOGO_DATA = /^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=]+$/i;
const MAX_LOGO_BYTES = 512 * 1024;

export const BUILTIN = [
    {
        id: 'sillytavern',
        name: 'SillyTavern',
        builtin: true,
        logo: 'st',
        colors: {
            bg: '#1c1d21', panel: '#26272d', border: '#3d3e47', accent: '#d65a52',
            text: '#d9d7d0', title: '#efede6', muted: '#9c9ba4',
            onAccent: '#1d0f0e', good: '#8fcf8f', warn: '#e6c36a', bad: '#f28a6c',
        },
    },
    {
        id: 'fox',
        name: 'Fox',
        builtin: true,
        logo: 'fox',
        colors: {
            bg: '#1a1310', panel: '#251b16', border: '#45342b', accent: '#f28c38',
            text: '#e9ddd0', title: '#f5ebe0', muted: '#ab9a8d',
            onAccent: '#1b1009', good: '#8fd49a', warn: '#f2c75c', bad: '#ff7f6e',
        },
    },
];

let dir = '';
export function initThemes(userData) {
    dir = path.join(userData, 'themes');
    fs.mkdirSync(dir, { recursive: true });
}

// Returns a clean theme or throws a message fit to show the user.
export function validate(raw) {
    if (!raw || typeof raw !== 'object') throw new Error('Not a theme file.');
    const name = String(raw.name || '').trim().slice(0, 40);
    if (!name) throw new Error('The theme needs a name.');
    const colors = {};
    for (const k of [...COLOR_KEYS, ...OPTIONAL_KEYS]) {
        const v = raw.colors?.[k];
        if (v == null || v === '') {
            if (COLOR_KEYS.includes(k)) throw new Error(`Missing color "${k}".`);
            continue;
        }
        if (!HEX.test(v)) throw new Error(`Color "${k}" must be a hex color like #1a2b3c.`);
        colors[k] = v.toLowerCase();
    }
    let logo = raw.logo || 'st';
    if (logo !== 'st' && logo !== 'fox') {
        if (typeof logo !== 'string' || !LOGO_DATA.test(logo)) throw new Error('The logo must be a PNG, JPEG, GIF or WebP image.');
        if (logo.length * 0.75 > MAX_LOGO_BYTES) throw new Error('The logo image is too large (max 512 KB).');
    }
    return { name, author: String(raw.author || '').trim().slice(0, 40), colors, logo };
}

const slug = name => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'theme';

export function list() {
    const custom = [];
    let files = [];
    try { files = fs.readdirSync(dir).filter(f => f.endsWith('.json')); } catch { /* none yet */ }
    for (const f of files) {
        try {
            const t = validate(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
            custom.push({ ...t, id: `custom:${f.slice(0, -5)}`, builtin: false });
        } catch { /* skip broken files */ }
    }
    return [...BUILTIN, ...custom.sort((a, b) => a.name.localeCompare(b.name))];
}

export function get(id) {
    return list().find(t => t.id === id) || BUILTIN[0];
}

// Saves a custom theme; `id` given = overwrite that one, else a new file.
export function save(raw, id) {
    const t = validate(raw);
    let base = id?.startsWith('custom:') ? id.slice(7) : slug(t.name);
    if (!id) {
        let n = 2;
        const stem = base;
        while (fs.existsSync(path.join(dir, `${base}.json`))) base = `${stem}-${n++}`;
    }
    fs.writeFileSync(path.join(dir, `${base}.json`), JSON.stringify({ ...t, format: 1 }, null, 2));
    return `custom:${base}`;
}

export function remove(id) {
    if (!id?.startsWith('custom:')) return false;
    try { fs.unlinkSync(path.join(dir, `${path.basename(id.slice(7))}.json`)); return true; } catch { return false; }
}

// For sharing: the same shape the importer accepts.
export function exportJson(id) {
    const t = get(id);
    return JSON.stringify({ format: 1, name: t.name, author: t.author || '', colors: t.colors, logo: t.logo }, null, 2);
}
