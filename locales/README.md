# Translating SillyTavern Desktop

The app ships in English, Bahasa Indonesia, 日本語, 한국어, 简体中文 and 繁體中文. Anyone can add another language, or improve these. The translations other than English were made with the help of AI and are waiting for native speakers to polish them.

## How it works

- English text is the key. `ja.json` maps `"Open SillyTavern"` to `"SillyTavern を開く"`.
- Every `locales/<id>.json` file is a language. The app finds it by itself: no code to change. `<id>` is a language tag such as `pt-BR`, `fr`, `vi`.
- A missing or empty string shows the English text, so a half-done file already works.

```json
{
  "language": "Português (Brasil)",
  "english": "Portuguese (Brazil)",
  "sillytavern": "pt-pt",
  "fonts": "\"Segoe UI\"",
  "strings": {
    "Open SillyTavern": "Abrir SillyTavern"
  }
}
```

- `language`: the name in that language, as people pick it in the app.
- `sillytavern`: SillyTavern's own code for the same language (a file name in SillyTavern's `public/locales`, such as `pt-pt`), or `null`. With it, "Also switch SillyTavern's own language" also changes SillyTavern.
- `fonts`: Windows fonts that have your letters, in CSS font-family form. The app's pixel fonts only cover Latin letters. Examples: `"Microsoft YaHei UI"` (Chinese), `"Yu Gothic UI"` (Japanese), `"Malgun Gothic"` (Korean), `"Leelawadee UI"` (Thai).

## Keep these exactly

- `{name}`, `{n}`, `{version}`: values the app fills in. Move them where your grammar needs them, but keep them all, spelled the same.
- `<0>…</0>`, `<1/>`, `<b>…</b>`, `<br>`: markup. Translate the text inside `<0>…</0>` and `<b>…</b>`; keep `<1/>` as it is (it stands for something like a file name or a button).
- `one|many`: keys with `|` have plural forms. Give your language's forms in [CLDR order](https://www.unicode.org/cldr/charts/latest/supplemental/language_plural_rules.html) (one, few, many, other): one form for Chinese or Japanese, two for Spanish (`archivo|archivos`), three for Russian (one|few|many).
- Names stay as they are: SillyTavern, Node.js, Git, config.yaml, Start.bat, Tampermonkey, Tavernary.

## Steps

From the `ST-Desktop` folder (after `npm install`):

1. Start a language with every key, all empty:
   ```
   npx electron tools/i18n-check.mjs --new pt-BR "Português (Brasil)" "Portuguese (Brazil)"
   ```
2. Fill in `strings` in `locales/pt-BR.json`. Keep it UTF-8.
3. Check it: `npm run i18n`. It lists what is missing, and anything broken (a placeholder or tag that went missing, too many plural forms).
4. Try it: `npm start`, click the globe in the top right, pick your language.
5. Open a pull request on [Lab-Fox/sillytavern-desktop](https://github.com/Lab-Fox/sillytavern-desktop).

When the app gets new text, `npx electron tools/i18n-check.mjs --fill pt-BR` adds the new keys (empty) and drops the ones no longer used.

## For developers

- In the main process: `import { t } from './i18n.js'` and `t('Text with {name}', { name })`. For strings defined ahead of time, mark them with `N('…')` and translate them with `t(value)` where they are shown.
- In the launcher: `T('…')` (from `i18n-dom.js`). Static HTML is translated automatically; mark brand names and sample text with `translate="no"`.
- Keys must be plain string literals, so the checker can find them. Values go in `{…}` placeholders, never glued into the key.
- The Console shows log lines in English on purpose: they are for bug reports.
