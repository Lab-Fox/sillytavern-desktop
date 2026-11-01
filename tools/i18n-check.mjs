// Checks the translations in locales/ against the app's English text.
//   npx electron tools/i18n-check.mjs              report per language
//   npx electron tools/i18n-check.mjs --keys F     also write every key to F (JSON)
//   npx electron tools/i18n-check.mjs --strict     exit 1 when something is missing or broken
//   npx electron tools/i18n-check.mjs --new pt-BR "Português (Brasil)" "Portuguese (Brazil)"
//                                                  start a language: every key, all empty
//   npx electron tools/i18n-check.mjs --fill ja    add keys that are new since (empty), drop unused ones
// Keys come from t('…') / T('…') / N('…') calls in the code and from the
// static text of launcher.html and stbar.html (found the way i18n-dom.js finds it).
import { app, BrowserWindow } from 'electron';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] || true : null; };

// ----- keys in code -----
const CODE = fs.readdirSync(ROOT).filter(f => /\.(js|cjs|html)$/.test(f) && !['i18n-dom.js', 'i18n.js'].includes(f));
const CALL = /(?<![\w.$])[tTN]\(\s*('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\$]|\\.)*`)\s*[,)]/g;
function codeKeys() {
    const keys = new Map();
    for (const f of CODE) {
        const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
        for (const m of src.matchAll(CALL)) {
            const key = Function(`return ${m[1]}`)();
            if (!keys.has(key)) keys.set(key, f);
        }
    }
    return keys;
}

// ----- keys in static page text -----
async function pageKeys(file) {
    const html = fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/<script\b[\s\S]*?<\/script>/g, '');
    const tmp = path.join(ROOT, `.i18n-check-${process.pid}-${file}`); // next to fonts/
    fs.writeFileSync(tmp, html);
    const win = new BrowserWindow({ show: false, webPreferences: { javascript: true } });
    try {
        await win.loadFile(tmp);
        const dom = fs.readFileSync(path.join(ROOT, 'i18n-dom.js'), 'utf8');
        return await win.webContents.executeJavaScript(`${dom};I18N.collect(document.body)`);
    } finally {
        win.destroy();
        fs.rmSync(tmp, { force: true });
    }
}

// ----- checking one translation -----
const vars = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');
const tags = s => [...s.matchAll(/<\/?\d+\/?>|<\/?[a-z]+\b[^>]*>/g)].map(m => m[0]).sort().join('');
function problems(key, value, lang) {
    const out = [];
    const forms = value.split('|');
    const cats = new Intl.PluralRules(lang).resolvedOptions().pluralCategories.length;
    if (key.includes('|') && forms.length > cats) out.push(`${forms.length} plural forms, ${lang} has ${cats}`);
    if (!key.includes('|') && forms.length > 1) out.push('has "|" but the key has no plural forms');
    const kv = vars(key.split('|').pop()), kt = tags(key.split('|').pop());
    for (const f of forms) {
        if (vars(f) !== kv) out.push(`placeholders {${vars(f)}} ≠ {${kv}}`);
        if (tags(f) !== kt) out.push(`markup "${tags(f)}" ≠ "${kt}"`);
    }
    return [...new Set(out)];
}

// Windows come and go one per page: that must not end the app.
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
    let failed = false;
    try {
        const keys = codeKeys();
        for (const f of ['launcher.html', 'stbar.html']) for (const k of await pageKeys(f)) if (!keys.has(k)) keys.set(k, f);
        const all = [...keys.keys()];
        console.log(`${all.length} keys (${CODE.length} files)`);
        if (opt('--keys')) fs.writeFileSync(opt('--keys'), JSON.stringify(all, null, 1));
        const dir = path.join(ROOT, 'locales');
        // Empty strings fall back to English until someone translates them.
        const write = (id, file) => {
            const strings = Object.fromEntries(all.map(k => [k, file.strings?.[k] || '']));
            fs.writeFileSync(path.join(dir, `${id}.json`), `${JSON.stringify({ ...file, strings }, null, 2)}\n`);
            console.log(`wrote locales/${id}.json`);
        };
        if (opt('--new')) {
            const i = args.indexOf('--new');
            const [id, language, english] = args.slice(i + 1, i + 4);
            if (!/^[a-z]{2,3}(-[A-Za-z0-9]{2,4})?$/.test(id || '') || !language) throw new Error('usage: --new <id like pt-BR> "<name in that language>" "<name in English>"');
            if (fs.existsSync(path.join(dir, `${id}.json`))) throw new Error(`locales/${id}.json already exists (use --fill ${id})`);
            write(id, { language, english: english || language, sillytavern: null, fonts: '"Segoe UI"', note: 'English text is the key. See locales/README.md.', strings: {} });
        }
        if (opt('--fill')) {
            const id = opt('--fill');
            write(id, JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), 'utf8')));
        }
        for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.json')).sort()) {
            const lang = f.replace(/\.json$/, '');
            const strings = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).strings || {};
            const missing = all.filter(k => !strings[k]);
            const unused = Object.keys(strings).filter(k => !keys.has(k));
            const bad = Object.entries(strings).filter(([k, v]) => v && keys.has(k)).map(([k, v]) => [k, problems(k, v, lang)]).filter(([, p]) => p.length);
            console.log(`${lang.padEnd(6)} ${all.length - missing.length}/${all.length} translated, ${missing.length} missing, ${unused.length} unused, ${bad.length} broken`);
            for (const k of missing.slice(0, opt('--all') ? Infinity : 5)) console.log(`   missing: ${k.slice(0, 100)}`);
            for (const [k, p] of bad) console.log(`   broken: ${k.slice(0, 80)} → ${p.join('; ')}`);
            if (missing.length || bad.length) failed = true;
        }
    } catch (e) {
        console.error(e);
        failed = true;
    }
    app.exit(opt('--strict') && failed ? 1 : 0);
});
