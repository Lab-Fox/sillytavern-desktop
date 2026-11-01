// i18n.js — the app's own languages (not SillyTavern's).
// English text is the key: t('Open SillyTavern') looks it up in
// locales/<id>.json and falls back to English. {name} fills in values;
// "one|many" keys pick a plural form by the number in {n}.
// N('…') only marks a string for tools/i18n-check.mjs (translated later with t(value)).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'locales');

// Every locales/<id>.json is a language (English is built in), so adding a
// language is adding a file: { language, english, sillytavern, fonts, strings }.
// sillytavern: SillyTavern's own code for that language (null: it has none).
// fonts: system fonts with the letters the pixel fonts don't have.
const ENGLISH = { id: 'en', name: 'English', english: 'English', st: 'en', fonts: '"Segoe UI"' };
const files = new Map(); // id → parsed file
function discover() {
    const found = [];
    let names = [];
    try { names = fs.readdirSync(DIR).filter(f => /^[a-z]{2,3}(-[A-Za-z0-9]{2,4})?\.json$/.test(f)); } catch { /* none */ }
    for (const f of names) {
        try {
            const raw = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
            if (!raw.strings || !raw.language) continue;
            const id = f.slice(0, -5);
            files.set(id, raw);
            found.push({ id, name: String(raw.language), english: String(raw.english || raw.language), st: raw.sillytavern || null, fonts: raw.fonts || '"Segoe UI"' });
        } catch { /* a broken file is skipped */ }
    }
    return [ENGLISH, ...found.sort((a, b) => a.english.localeCompare(b.english))];
}
export const LANGUAGES = discover();

let lang = LANGUAGES[0];
let dict = {};
let plural = new Intl.PluralRules('en');

export const N = s => s;
export const current = () => lang;
export const byId = id => LANGUAGES.find(l => l.id === id) || null;

// The best match for Windows' preferred languages (app.getPreferredSystemLanguages()).
export function detect(prefs = []) {
    for (const p of prefs) {
        const tag = String(p).toLowerCase();
        const want = /^zh-(hant|tw|hk|mo)/.test(tag) ? 'zh-tw' : tag.startsWith('zh') ? 'zh-cn' : tag;
        // The exact tag first (pt-br), then the language alone (ja-JP → ja).
        const hit = LANGUAGES.find(l => l.id.toLowerCase() === want) || LANGUAGES.find(l => l.id.toLowerCase() === want.split('-')[0])
            || LANGUAGES.find(l => l.id.toLowerCase().split('-')[0] === want.split('-')[0]);
        if (hit) return hit.id;
    }
    return 'en';
}

export const readDict = id => files.get(id)?.strings || {};

export function setLanguage(id) {
    lang = byId(id) || LANGUAGES[0];
    dict = readDict(lang.id);
    plural = new Intl.PluralRules(lang.id);
}

// Plural forms in a translation follow CLDR's order (one|few|many|other for
// Russian, a single form for Chinese); missing forms fall back to the last.
const ORDER = ['zero', 'one', 'two', 'few', 'many', 'other'];
export function pickForm(text, n, rules) {
    if (!text.includes('|') || typeof n !== 'number') return text;
    const forms = text.split('|');
    const cats = ORDER.filter(c => rules.resolvedOptions().pluralCategories.includes(c));
    return forms[cats.indexOf(rules.select(n))] ?? forms[forms.length - 1];
}

export function fill(text, vars, locale) {
    if (!vars) return text;
    return text.replace(/\{(\w+)\}/g, (m, k) => {
        const v = vars[k];
        if (v === undefined || v === null) return m;
        return typeof v === 'number' ? v.toLocaleString(locale) : String(v);
    });
}

export function t(key, vars) {
    const own = dict[key];
    const text = own || key;
    const rules = own ? plural : new Intl.PluralRules('en');
    return fill(pickForm(text, vars?.n, rules), vars, lang.id);
}

// What a page needs to translate itself (launcher, top bar).
export function forPage() {
    return { lang: lang.id, fonts: lang.fonts, dict, languages: LANGUAGES.map(({ id, name, english }) => ({ id, name, english })) };
}
