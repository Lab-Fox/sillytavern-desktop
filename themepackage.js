// .sttheme files: a zip with theme.json, optional theme.css (the launcher) and
// bar.css (the SillyTavern window's top bar), and pictures, video and fonts.
// Installed into <userData>/themes/packages/<id>. A zip is someone else's file:
// everything about it is checked before anything is written where it counts.
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import yazl from 'yazl';
import yauzl from 'yauzl';
import { t } from './i18n.js';
import { validate, packagesDir, THEME_API } from './themes.js';
import { TYPES, safeRel } from './themeroute.js';
import { checkCss } from './themecss.js';

export const EXTENSION = '.sttheme';
export const PREFIX = 'pkg:';
const MAX_FILE = 50 * 1024 * 1024;
const MAX_UNPACKED = 150 * 1024 * 1024;
const MAX_ENTRIES = 2000;
const MAX_MANIFEST = 256 * 1024;
const MAX_LOGO = 512 * 1024;
const TEXT_FILES = new Set(['theme.json', 'theme.css', 'bar.css', 'readme.md', 'readme.txt', 'license', 'license.txt', 'license.md']);

const slug = name => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'theme';
const dirOf = id => path.join(packagesDir(), id.startsWith(PREFIX) ? id.slice(PREFIX.length) : id);

// The first bytes of each kind of file, so a renamed file isn't taken for a picture.
const SIGNS = {
    '.png': b => b.toString('latin1', 1, 4) === 'PNG', '.apng': b => b.toString('latin1', 1, 4) === 'PNG',
    '.jpg': b => b[0] === 0xff && b[1] === 0xd8, '.jpeg': b => b[0] === 0xff && b[1] === 0xd8,
    '.gif': b => b.toString('latin1', 0, 4) === 'GIF8',
    '.webp': b => b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP',
    '.webm': b => b.readUInt32BE(0) === 0x1a45dfa3,
    '.mp4': b => b.toString('latin1', 4, 8) === 'ftyp',
    '.woff2': b => b.toString('latin1', 0, 4) === 'wOF2', '.woff': b => b.toString('latin1', 0, 4) === 'wOFF',
    '.ttf': b => b.readUInt32BE(0) === 0x00010000 || b.toString('latin1', 0, 4) === 'true',
    '.otf': b => b.toString('latin1', 0, 4) === 'OTTO',
    '.svg': b => /<svg[\s>]/i.test(b.toString('utf8')),
};

async function readEntry(zip, entry, max) {
    const stream = await zip.openReadStreamPromise(entry);
    const parts = [];
    let size = 0;
    for await (const chunk of stream) {
        size += chunk.length;
        if (size > max) { stream.destroy(); throw new Error(t('A file in this theme is too large.')); }
        parts.push(chunk);
    }
    return Buffer.concat(parts);
}

// The start of a file, for SIGNS. The first chunk is plenty.
async function headOf(zip, entry) {
    const stream = await zip.openReadStreamPromise(entry);
    for await (const chunk of stream) { stream.destroy(); return chunk; }
    return Buffer.alloc(0);
}

// Names and sizes only; nothing is unpacked yet.
function listEntries(zip) {
    return new Promise((resolve, reject) => {
        const entries = [];
        let total = 0;
        zip.on('error', reject);
        zip.on('end', () => resolve(entries));
        zip.on('entry', entry => {
            if (entries.length >= MAX_ENTRIES) return reject(new Error(t('This theme has too many files.')));
            const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
            if (mode === 0o120000) return reject(new Error(t('This theme contains a link to somewhere else, which isn\'t allowed.')));
            total += entry.uncompressedSize;
            if (total > MAX_UNPACKED) return reject(new Error(t('This theme is too large.')));
            if (!entry.fileName.endsWith('/')) entries.push(entry);
            zip.readEntry();
        });
        zip.readEntry();
    });
}

function openZip(file) {
    return new Promise((resolve, reject) => {
        yauzl.open(file, { lazyEntries: true, autoClose: false, validateEntrySizes: true }, (err, zip) => {
            if (err) return reject(new Error(t('This file is not a theme.')));
            zip.openReadStreamPromise = entry => new Promise((res, rej) => zip.openReadStream(entry, (e, s) => (e ? rej(e) : res(s))));
            resolve(zip);
        });
    });
}

function manifestOf(raw) {
    const base = validate({ ...raw, logo: ['st', 'fox'].includes(raw?.logo) ? raw.logo : 'st' });
    const apiVersion = Number(raw.apiVersion ?? 1);
    if (!Number.isInteger(apiVersion) || apiVersion < 1) throw new Error(t('This theme doesn\'t say which version it was made for.'));
    if (apiVersion > THEME_API) throw new Error(t('This theme needs a newer version of the app.'));
    return {
        ...base, apiVersion,
        version: String(raw.version || '').trim().slice(0, 20),
        description: String(raw.description || '').trim().slice(0, 300),
        logoFile: typeof raw.logo === 'string' && !['st', 'fox'].includes(raw.logo) ? raw.logo : '',
        layers: layersOf(raw),
    };
}

// Pictures and video a theme places in the window. All of it ends up as style
// values in the launcher, so each value has to look like what it is.
const SLOTS = ['window', 'sidebar', 'header', 'page', 'console', 'hero'];
const ANCHORS = ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'];
const FITS = ['contain', 'cover', 'fill', 'none'];
const WHEN = ['page', 'server', 'busy', 'update', 'time'];
const SIZE = /^\d{1,4}(\.\d{1,2})?(%|px)$/;
const OFFSET = /^-?\d{1,4}(\.\d{1,2})?(%|px)$/;
const MAX_LAYERS = 24, MAX_VIDEOS = 4;
const VIDEO = new Set(['.webm', '.mp4']);
const isMedia = rel => safeRel(rel) && /^(image|video)\//.test(TYPES[path.extname(rel).toLowerCase()] || '');

function layerOf(raw, i) {
    const bad = what => new Error(t('Layer {n} of this theme has a wrong {what}.', { n: i + 1, what }));
    if (!raw || typeof raw !== 'object') throw bad('entry');
    if (typeof raw.src !== 'string' || !isMedia(raw.src)) throw bad('src');
    const pick = (key, list, fallback) => {
        const v = raw[key] ?? fallback;
        if (!list.includes(v)) throw bad(key);
        return v;
    };
    const size = (key, re = SIZE) => {
        if (raw[key] == null) return '';
        if (typeof raw[key] !== 'string' || !re.test(raw[key])) throw bad(key);
        return raw[key];
    };
    const opacity = Number(raw.opacity ?? 1);
    if (!(opacity >= 0 && opacity <= 1)) throw bad('opacity');
    const hideBelow = Number(raw.hideBelow ?? 0);
    if (!Number.isInteger(hideBelow) || hideBelow < 0 || hideBelow > 10000) throw bad('hideBelow');
    const when = {};
    for (const [k, v] of Object.entries(raw.when ?? {})) {
        const list = [v].flat();
        if (!WHEN.includes(k) || !list.length || !list.every(x => typeof x === 'string' && /^[a-z-]{1,20}$/.test(x))) throw bad('when');
        when[k] = list;
    }
    const id = raw.id == null ? `layer-${i + 1}` : String(raw.id);
    if (!/^[a-zA-Z][\w-]{0,39}$/.test(id)) throw bad('id');
    return {
        id, src: raw.src, slot: pick('slot', SLOTS, 'window'), anchor: pick('anchor', ANCHORS, 'center'), fit: pick('fit', FITS, 'contain'), z: pick('z', ['behind', 'above'], 'behind'),
        width: size('width'), height: size('height'), minWidth: size('minWidth'), maxWidth: size('maxWidth'), x: size('x', OFFSET), y: size('y', OFFSET),
        opacity, hideBelow, when, pixelated: raw.pixelated === true, video: VIDEO.has(path.extname(raw.src).toLowerCase()),
    };
}

function layersOf(raw) {
    const list = Array.isArray(raw.layers) ? [...raw.layers] : [];
    if (raw.layers != null && !Array.isArray(raw.layers)) throw new Error(t('This theme\'s layers must be a list.'));
    // The whole window, under everything: the usual reason to want a layer.
    if (raw.wallpaper != null) list.unshift({ id: 'wallpaper', src: raw.wallpaper, slot: 'window', fit: 'cover', width: '100%', height: '100%', pixelated: raw.wallpaperPixelated });
    if (list.length > MAX_LAYERS) throw new Error(t('This theme has too many layers.'));
    const layers = list.map(layerOf);
    if (layers.filter(l => l.video).length > MAX_VIDEOS) throw new Error(t('This theme has too many videos.'));
    if (new Set(layers.map(l => l.id)).size !== layers.length) throw new Error(t('Two layers of this theme have the same id.'));
    return layers;
}

const sameName = rel => rel.toLowerCase();
const cssError = (file, e) => `${file}, line ${e.line}: ${e.message}`;

// Reads and checks a file without installing it. → { manifest, id, replaces, files, bytes, hasCss, entries, zip, root }
async function open(file) {
    if (fs.statSync(file).size > MAX_FILE) throw new Error(t('This theme is too large.'));
    const zip = await openZip(file);
    try {
        const entries = await listEntries(zip);
        const top = entries.find(e => e.fileName === 'theme.json') ? '' : (() => {
            const hit = entries.filter(e => /^[^/]+\/theme\.json$/.test(e.fileName));
            return hit.length === 1 ? hit[0].fileName.slice(0, -'theme.json'.length) : null;
        })();
        if (top === null) throw new Error(t('This file is not a theme: it has no theme.json.'));
        const files = new Map();
        const seen = new Set();
        for (const entry of entries) {
            if (!entry.fileName.startsWith(top)) throw new Error(t('This theme has files outside its folder.'));
            const rel = entry.fileName.slice(top.length);
            if (!safeRel(rel)) throw new Error(t('This theme has a file with a name that isn\'t allowed: {name}', { name: rel.slice(0, 80) }));
            if (seen.has(sameName(rel))) throw new Error(t('This theme has two files with the same name: {name}', { name: rel.slice(0, 80) }));
            seen.add(sameName(rel));
            const ext = path.extname(rel).toLowerCase();
            if (!TYPES[ext] && !TEXT_FILES.has(sameName(rel))) throw new Error(t('This theme has a kind of file themes can\'t contain: {name}', { name: rel.slice(0, 80) }));
            files.set(rel, entry);
        }
        for (const [rel, entry] of files) {
            const sign = SIGNS[path.extname(rel).toLowerCase()];
            if (!sign) continue;
            const head = await headOf(zip, entry);
            if (head.length < 12 || !sign(head)) throw new Error(t('This file in the theme isn\'t what its name says: {name}', { name: rel.slice(0, 80) }));
        }
        let raw;
        const text = (await readEntry(zip, files.get('theme.json'), MAX_MANIFEST)).toString('utf8');
        try { raw = JSON.parse(text); } catch { throw new Error(t('That file is not valid theme JSON.')); }
        const manifest = manifestOf(raw);
        if (manifest.logoFile && !files.has(manifest.logoFile)) throw new Error(t('The theme\'s logo file is missing.'));
        for (const l of manifest.layers) if (!files.has(l.src)) throw new Error(t('A picture of this theme is missing: {name}', { name: l.src.slice(0, 80) }));
        const id = slug(manifest.name);
        for (const css of ['theme.css', 'bar.css']) {
            if (!files.has(css)) continue;
            const { errors } = await checkCss((await readEntry(zip, files.get(css), 1024 * 1024)).toString('utf8'), id);
            if (errors.length) throw new Error(t('This theme\'s CSS isn\'t allowed.') + `\n${errors.slice(0, 5).map(e => cssError(css, e)).join('\n')}`);
        }
        return { zip, files, manifest, id, hasCss: files.has('theme.css') || files.has('bar.css'), bytes: entries.reduce((n, e) => n + e.uncompressedSize, 0) };
    } catch (e) {
        zip.close();
        throw e;
    }
}

// What the install dialog shows.
export async function inspect(file) {
    const p = await open(file);
    p.zip.close();
    const existing = read(p.id);
    return {
        id: p.id, name: p.manifest.name, author: p.manifest.author, version: p.manifest.version, description: p.manifest.description,
        hasCss: p.hasCss, files: p.files.size, bytes: p.bytes,
        replaces: !!existing && existing.author === p.manifest.author, taken: !!existing,
    };
}

function freeId(id) {
    let n = 2, free = id;
    while (fs.existsSync(dirOf(free))) free = `${id}-${n++}`;
    return free;
}

// → the theme's id. `replace` overwrites the installed theme of the same name.
export async function install(file, { replace = false } = {}) {
    const p = await open(file);
    const id = replace ? p.id : freeId(p.id);
    const temp = path.join(packagesDir(), `.partial-${crypto.randomBytes(6).toString('hex')}`);
    try {
        for (const [rel, entry] of p.files) {
            const data = await readEntry(p.zip, entry, MAX_FILE);
            const target = path.join(temp, ...rel.split('/'));
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, data);
        }
        p.zip.close();
        // The old version goes only once the new one is in place.
        const old = replace && fs.existsSync(dirOf(id)) ? `${temp}-old` : null;
        if (old) fs.renameSync(dirOf(id), old);
        try {
            fs.renameSync(temp, dirOf(id));
        } catch (e) {
            if (old) fs.renameSync(old, dirOf(id));
            throw e;
        }
        if (old) fs.rmSync(old, { recursive: true, force: true });
        return PREFIX + id;
    } catch (e) {
        p.zip.close();
        fs.rmSync(temp, { recursive: true, force: true });
        throw e;
    }
}

function read(id) {
    try {
        const dir = dirOf(id);
        const stat = fs.statSync(path.join(dir, 'theme.json'));
        if (stat.size > MAX_MANIFEST) return null;
        const m = manifestOf(JSON.parse(fs.readFileSync(path.join(dir, 'theme.json'), 'utf8')));
        let logo = m.logo;
        if (m.logoFile && safeRel(m.logoFile) && TYPES[path.extname(m.logoFile).toLowerCase()]?.startsWith('image/')) {
            const file = path.join(dir, ...m.logoFile.split('/'));
            if (fs.statSync(file).size <= MAX_LOGO) logo = `data:${TYPES[path.extname(file).toLowerCase()]};base64,${fs.readFileSync(file).toString('base64')}`;
        }
        const has = name => fs.existsSync(path.join(dir, name));
        const { logoFile, ...theme } = m;
        const name = path.basename(dir);
        const layers = m.layers.filter(l => has(l.src)).map(l => ({ ...l, url: `st-theme://${name}/${l.src.split('/').map(encodeURIComponent).join('/')}` }));
        return { ...theme, layers, logo, id: PREFIX + name, builtin: false, package: true, hasCss: has('theme.css') || has('bar.css') || layers.some(l => l.z === 'above') };
    } catch { return null; }
}

export function list() {
    let names = [];
    try { names = fs.readdirSync(packagesDir(), { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('.')).map(d => d.name); } catch { /* none yet */ }
    return names.map(read).filter(Boolean);
}

export function remove(id) {
    if (!id?.startsWith(PREFIX)) return false;
    const name = path.basename(id.slice(PREFIX.length));
    if (!name || name.startsWith('.')) return false;
    fs.rmSync(path.join(packagesDir(), name), { recursive: true, force: true });
    return true;
}

// The checked CSS for the launcher ('theme.css') or the top bar ('bar.css').
// Checked here every time, not only at install: the files can change on disk.
export async function css(id, which) {
    if (!id?.startsWith(PREFIX)) return { css: '', errors: [] };
    const name = path.basename(id.slice(PREFIX.length));
    let text;
    try { text = fs.readFileSync(path.join(packagesDir(), name, which), 'utf8'); } catch { return { css: '', errors: [] }; }
    const r = await checkCss(text, name);
    return { css: r.css, errors: r.errors.map(e => cssError(which, e)) };
}

// Same CSS = the user has already said it's fine.
export function fingerprint(id) {
    const h = crypto.createHash('sha256');
    for (const f of ['theme.css', 'bar.css']) {
        try { h.update(fs.readFileSync(path.join(dirOf(id), f))); } catch { /* not in this theme */ }
    }
    return `${id}:${h.digest('hex').slice(0, 16)}`;
}

export function exportTo(id, target) {
    const dir = dirOf(id);
    return new Promise((resolve, reject) => {
        const zip = new yazl.ZipFile();
        const add = sub => {
            for (const e of fs.readdirSync(path.join(dir, sub), { withFileTypes: true })) {
                const rel = sub ? `${sub}/${e.name}` : e.name;
                if (e.isDirectory()) add(rel);
                else if (e.isFile()) zip.addFile(path.join(dir, rel), rel);
            }
        };
        add('');
        zip.end();
        zip.outputStream.pipe(fs.createWriteStream(target)).on('close', resolve).on('error', reject);
    });
}
