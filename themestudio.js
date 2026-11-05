// Theme Studio: the no-code editor. It works on a draft folder inside the
// packages folder, so pictures preview through the same st-theme: route as any
// theme, and saves an ordinary package: what it makes can be shared like any
// other .sttheme, and goes through the same checks when it loads.
import path from 'path';
import fs from 'fs';
import { t } from './i18n.js';
import { packagesDir, THEME_API } from './themes.js';
import { TYPES, safeRel } from './themeroute.js';
import { checkCss } from './themecss.js';
import * as pkg from './themepackage.js';

const DRAFT = pkg.DRAFT;
const draft = () => path.join(packagesDir(), DRAFT);
const FONTS = { dotgothic: '"DotGothic16"', pixelify: '"Pixelify Sans"', vt323: '"VT323"', segoe: '"Segoe UI"' };

// The CSS for a Studio theme. Nothing for the defaults, so a theme of colors alone has no CSS.
export function studioCss(raw) {
    const s = pkg.cleanStudio(raw);
    const vars = [], rules = [];
    if (s.radius) vars.push(`--radius: ${s.radius}px;`);
    if (s.pill) vars.push('--btn-radius: 999px;', '--tag-radius: 999px;', '--switch-radius: 999px;');
    if (s.border !== 2) vars.push(`--border-w: ${s.border}px;`, `--divider: ${Math.max(s.border, 1)}px dashed var(--border);`);
    if (s.shadow === 'soft') vars.push('--shadow-card: 0 6px 18px color-mix(in srgb, #000 35%, transparent);', '--shadow-btn: 0 2px 6px color-mix(in srgb, #000 30%, transparent);', '--btn-press: scale(.97);');
    if (s.shadow === 'none') vars.push('--shadow-card: none;', '--shadow-btn: none;');
    if (s.fontFile) {
        rules.push(`@font-face { font-family: "Theme Font"; src: url("${s.fontFile}"); }`);
        vars.push('--body-font: "Theme Font", var(--lang-fonts, "Segoe UI"), sans-serif;');
    } else if (FONTS[s.font]) vars.push(`--body-font: ${FONTS[s.font]}, var(--lang-fonts, "Segoe UI"), sans-serif;`);
    if (s.smooth) {
        vars.push('--logo-render: auto;');
        rules.push('body { -webkit-font-smoothing: auto; }', 'svg.i { shape-rendering: auto; stroke-linecap: round; stroke-linejoin: round; }');
    }
    if (s.glass) {
        const see = name => `color-mix(in srgb, var(--${name}) ${100 - s.glass}%, transparent)`;
        vars.push('--app-bg: transparent;', `--sidebar-bg: ${see('surface')};`, `--header-bg: ${see('surface')};`, `--dock-bg: ${see('surface')};`,
            `--console-bg: ${see('well')};`, `--card-bg: ${see('panel')};`, `--hero-bg: ${see('panel')};`, `--input-bg: ${see('well')};`);
    }
    if (vars.length) rules.unshift(`:root {\n  ${vars.join('\n  ')}\n}`);
    return rules.join('\n');
}

function manifest(theme) {
    let base = {};
    try { base = JSON.parse(fs.readFileSync(path.join(draft(), 'theme.json'), 'utf8')); } catch { /* a new one */ }
    const studio = pkg.cleanStudio(theme.studio);
    const { wallpaper, wallpaperPixelated, layers, ...rest } = studio;
    return {
        ...base, format: 2, apiVersion: THEME_API, name: theme.name, author: theme.author || base.author || '', colors: theme.colors,
        logo: ['st', 'fox'].includes(theme.logo) ? theme.logo : base.logo || 'st', studio: { ...rest, wallpaper, wallpaperPixelated, layers },
        ...(wallpaper ? { wallpaper, wallpaperPixelated } : { wallpaper: undefined, wallpaperPixelated: undefined }), layers,
    };
}

// A fresh draft, with a copy of the theme's files when editing one.
export function open(id) {
    close();
    fs.mkdirSync(path.join(draft(), 'assets'), { recursive: true });
    if (id?.startsWith(pkg.PREFIX)) pkg.copyInto(id, draft());
}
export function close() { fs.rmSync(draft(), { recursive: true, force: true }); }

// Copies a file the user picked into the draft. → { rel, url, name, video }
export function addFile(file) {
    if (fs.statSync(file).size > 50 * 1024 * 1024) throw new Error(t('That file is too large for a theme.'));
    const ext = path.extname(file).toLowerCase();
    if (!TYPES[ext]) throw new Error(t('Themes can\'t use that kind of file.'));
    pkg.checkSign(ext, fs.readFileSync(file).subarray(0, 4096), path.basename(file));
    const stem = path.basename(file, path.extname(file)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'file';
    let rel = `assets/${stem}${ext}`;
    for (let n = 2; fs.existsSync(path.join(draft(), rel)); n++) rel = `assets/${stem}-${n}${ext}`;
    if (!safeRel(rel)) throw new Error(t('Themes can\'t use that kind of file.'));
    fs.copyFileSync(file, path.join(draft(), rel));
    return { rel, url: pkg.fileUrl(DRAFT, rel), name: path.basename(file), video: ['.webm', '.mp4'].includes(ext) };
}

// What the launcher shows while editing: nothing is saved.
export async function preview(theme) {
    const raw = manifest(theme);
    const css = await checkCss(studioCss(theme.studio), DRAFT);
    if (css.errors.length) throw new Error(css.errors[0].message);
    return { css: css.css, layers: pkg.layersFor(raw, DRAFT) };
}

// → the saved theme's id.
export async function save(theme, id) {
    const raw = manifest(theme);
    const dir = draft();
    if (typeof theme.logo === 'string' && theme.logo.startsWith('data:image/')) {
        const m = /^data:image\/(png|jpeg|gif|webp);base64,(.+)$/.exec(theme.logo);
        if (!m) throw new Error(t('The logo must be a PNG, JPEG, GIF or WebP image.'));
        const data = Buffer.from(m[2], 'base64');
        if (data.length > 512 * 1024) throw new Error(t('The logo image is too large (max 512 KB).'));
        raw.logo = `assets/logo.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
        pkg.checkSign(path.extname(raw.logo), data.subarray(0, 4096), 'logo');
        fs.writeFileSync(path.join(dir, raw.logo), data);
    }
    const css = studioCss(theme.studio);
    const checked = await checkCss(css, DRAFT);
    if (checked.errors.length) throw new Error(checked.errors[0].message);
    pkg.validateManifest(raw);
    fs.writeFileSync(path.join(dir, 'theme.json'), JSON.stringify(raw, null, 2));
    if (css) fs.writeFileSync(path.join(dir, 'theme.css'), css);
    else fs.rmSync(path.join(dir, 'theme.css'), { force: true });
    // Pictures tried and dropped while editing don't ship.
    const used = new Set([raw.logo, raw.wallpaper, raw.studio.fontFile, ...raw.layers.map(l => l.src)]);
    for (const f of fs.readdirSync(path.join(dir, 'assets'))) if (!used.has(`assets/${f}`)) fs.rmSync(path.join(dir, 'assets', f), { force: true });
    return pkg.adoptDraft(raw.name, id);
}
