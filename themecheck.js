// "Check this theme" for theme authors: what would go wrong for the people who
// install it. Advice only; what's actually unsafe is refused elsewhere.
import fs from 'fs';
import path from 'path';
import { packagesDir, TOKENS, CLASSES, COLOR_KEYS } from './themes.js';
import { PREFIX } from './themepackage.js';
import { checkCss, usedNames } from './themecss.js';

function luminance(hex) {
    const h = hex.length === 4 ? [...hex.slice(1)].map(x => x + x).join('') : hex.slice(1);
    const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a, b) {
    const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
}
const PAIRS = [['text', 'bg', 'Text on the background'], ['text', 'panel', 'Text on panels'], ['title', 'panel', 'Titles on panels'], ['muted', 'panel', 'Quiet text on panels']];
const BIG_FILE = 8 * 1024 * 1024, BIG_THEME = 30 * 1024 * 1024;
const OTHER_VARS = new Set([...COLOR_KEYS, 'on-accent', 'good', 'warn', 'bad', 'surface', 'panel2', 'shadow', 'accent2', 'faint', 'tint', 'well', 'px', 'lang-fonts', 'mono', 'pixel-font']);

function files(dir, sub = '') {
    return fs.readdirSync(path.join(dir, sub), { withFileTypes: true }).flatMap(e => {
        const rel = sub ? `${sub}/${e.name}` : e.name;
        return e.isDirectory() ? files(dir, rel) : [rel];
    });
}

// → [{ level: 'bad' | 'warn' | 'ok', text }]
export async function check(theme) {
    const out = [];
    const add = (level, text) => out.push({ level, text });
    for (const [a, b, label] of PAIRS) {
        const c = contrast(theme.colors[a], theme.colors[b]);
        if (c < 3) add('bad', `${label} is very hard to read (contrast ${c.toFixed(1)}, aim for 4.5).`);
        else if (c < 4.5) add('warn', `${label} is a bit hard to read (contrast ${c.toFixed(1)}, aim for 4.5).`);
    }
    if (!theme.id?.startsWith(PREFIX)) return out.length ? out : [{ level: 'ok', text: 'Nothing to report.' }];
    const name = theme.id.slice(PREFIX.length);
    const dir = path.join(packagesDir(), path.basename(name));
    const css = {};
    for (const f of ['theme.css', 'bar.css']) {
        let text;
        try { text = fs.readFileSync(path.join(dir, f), 'utf8'); } catch { continue; }
        css[f] = text;
        const r = await checkCss(text, name);
        for (const e of r.errors) add('bad', `${f}, line ${e.line}: ${e.message}`);
        if (r.errors.length) continue;
        const { classes, vars, setsFont } = await usedNames(text);
        const strange = vars.filter(v => !TOKENS.includes(v) && !OTHER_VARS.has(v) && !v.startsWith('opt-') && !new RegExp(`--${v}\\s*:`).test(text));
        if (strange.length) add('warn', `${f} uses settings that don't exist: ${strange.slice(0, 8).map(v => `--${v}`).join(', ')}.`);
        const risky = classes.filter(c => !CLASSES.includes(c));
        if (risky.length) add('warn', `${f} relies on class names that can change in any update: ${risky.slice(0, 8).map(c => `.${c}`).join(', ')}. Prefer [data-part] and the documented classes.`);
        if (setsFont && !text.includes('--lang-fonts')) add('warn', `${f} sets a font without var(--lang-fonts) after it: Chinese, Japanese and Korean letters may look wrong.`);
    }
    const all = files(dir);
    const manifest = fs.readFileSync(path.join(dir, 'theme.json'), 'utf8');
    const text = Object.values(css).join('\n') + manifest;
    let total = 0;
    for (const rel of all) {
        const size = fs.statSync(path.join(dir, rel)).size;
        total += size;
        if (size > BIG_FILE) add('warn', `${rel} is ${(size / 1048576).toFixed(0)} MiB: large files use more memory and start slower.`);
        if (rel.startsWith('assets/') && !text.includes(rel) && !text.includes(rel.slice(7))) add('warn', `${rel} isn't used by anything.`);
    }
    if (total > BIG_THEME) add('warn', `The theme is ${(total / 1048576).toFixed(0)} MiB in all: keep it under 30 MiB if you can.`);
    for (const l of theme.layers || []) {
        if (l.scene) add('warn', 'The theme has a scene: keep it light, it runs for as long as the window is in use, and test it with Task Manager open.');
        if (l.z === 'above' && l.opacity > 0.8 && parseFloat(l.width) >= 50 && l.width.endsWith('%')) add('warn', `Layer "${l.id}" covers a lot of the window in front of the content.`);
        if (l.video && !l.width && !l.height) add('warn', `Layer "${l.id}" is a video without a size: it shows at its own size, whatever the window.`);
    }
    return out.length ? out : [{ level: 'ok', text: 'Nothing to report.' }];
}
