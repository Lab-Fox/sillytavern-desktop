// i18n-dom.js — translates the launcher and the top bar (see i18n.js).
// Static text is translated once when the page loads (a language change
// reloads the page); text built in scripts goes through I18N.t().
//
// A sentence with inline markup is one key, its inline elements numbered:
//   <p>Backups zip your <span class="mono">data</span> folder: <b>all</b> of it.</p>
//   → "Backups zip your <0/> folder: <1>all</1> of it."
// <k>…</k> is an inline element whose text is translated; <k/> keeps an
// element as it is (it has an id, is .mono, or has translate="no").
(() => {
  const data = (() => {
    try { return (window.desktop?.i18n || window.bar?.i18n)?.() || null; } catch { return null; }
  })() || { lang: 'en', fonts: '"Segoe UI"', dict: {}, languages: [] };
  const dict = data.dict || {};
  const ORDER = ['zero', 'one', 'two', 'few', 'many', 'other'];
  const rulesOf = lang => new Intl.PluralRules(lang);
  const own = rulesOf(data.lang), en = rulesOf('en');

  function pickForm(text, n, rules) {
    if (!text.includes('|') || typeof n !== 'number') return text;
    const forms = text.split('|');
    const cats = ORDER.filter(c => rules.resolvedOptions().pluralCategories.includes(c));
    return forms[cats.indexOf(rules.select(n))] ?? forms[forms.length - 1];
  }
  // Values are inserted as they are: escape anything that goes into innerHTML.
  function t(key, vars) {
    const mine = dict[key];
    const text = pickForm(mine || key, vars?.n, mine ? own : en);
    if (!vars) return text;
    return text.replace(/\{(\w+)\}/g, (m, k) => {
      const v = vars[k];
      if (v === undefined || v === null) return m;
      return typeof v === 'number' ? v.toLocaleString(data.lang) : String(v);
    });
  }

  // ----- static text -----
  const SKIP = new Set(['SCRIPT', 'STYLE', 'svg', 'SVG', 'TEXTAREA', 'INPUT', 'SELECT', 'PRE']);
  const INLINE = new Set(['B', 'STRONG', 'I', 'EM', 'SPAN', 'A', 'CODE', 'KBD', 'BUTTON', 'SMALL', 'BR']);
  const ATTRS = ['title', 'placeholder', 'aria-label', 'label'];
  const letters = s => /\p{L}{2}/u.test(s);
  const kept = el => el.id || el.classList.contains('mono') || el.getAttribute('translate') === 'no';
  const inlineOk = el => INLINE.has(el.tagName) && (el.tagName === 'BR' || kept(el) || [...el.childNodes].every(n => n.nodeType === 3));
  const squash = s => s.replace(/\s+/g, ' ');

  // The key of a sentence unit, or null when the element isn't one.
  function unitKey(el) {
    const kids = [...el.childNodes];
    if (!kids.some(n => n.nodeType === 3 && n.nodeValue.trim())) return null;
    if (!kids.every(n => n.nodeType === 3 || n.nodeType === 8 || (n.nodeType === 1 && inlineOk(n)))) return null;
    let i = 0;
    const key = kids.map(n => {
      if (n.nodeType === 3) return squash(n.nodeValue);
      if (n.nodeType !== 1) return '';
      const k = i++;
      if (n.tagName === 'BR') return '<br>';
      return kept(n) ? `<${k}/>` : `<${k}>${squash(n.textContent).trim()}</${k}>`;
    }).join('').trim();
    return letters(key.replace(/<[^>]+>/g, '')) ? key : null;
  }

  // Rebuilds a unit from its translation, reusing the original elements.
  function applyUnit(el, text) {
    const parts = [...el.childNodes].filter(n => n.nodeType === 1);
    const used = new Set();
    const out = [];
    const re = /<(\d+)>(.*?)<\/\1>|<(\d+)\/>|<br>/g;
    let last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) out.push(document.createTextNode(text.slice(last, m.index)));
      if (m[0] === '<br>') out.push(document.createElement('br'));
      else {
        const node = parts[Number(m[1] ?? m[3])];
        if (node && !used.has(node)) {
          if (m[1] !== undefined && !kept(node)) node.textContent = m[2];
          used.add(node);
          out.push(node);
        }
      }
      last = re.lastIndex;
    }
    if (last < text.length) out.push(document.createTextNode(text.slice(last)));
    // Never lose an element that scripts fill in later.
    for (const p of parts) if (p.tagName !== 'BR' && !used.has(p)) out.push(p);
    el.replaceChildren(...out);
  }

  function walk(root, visit) {
    const go = el => {
      if (el.getAttribute?.('translate') === 'no') return;
      if (SKIP.has(el.tagName)) { visit.attrs(el); return; }
      visit.attrs(el);
      const key = unitKey(el);
      if (key) {
        visit.unit(el, key);
        // An inline element with an id keeps its place but has text of its own.
        for (const c of el.children) if (c.id && kept(c) && !c.classList.contains('mono')) go(c);
        return;
      }
      for (const n of [...el.childNodes]) {
        if (n.nodeType === 3 && letters(n.nodeValue)) visit.text(n, squash(n.nodeValue).trim());
        else if (n.nodeType === 1) go(n);
      }
    };
    go(root);
  }

  function apply(root = document.body) {
    document.documentElement.lang = data.lang;
    document.documentElement.style.setProperty('--lang-fonts', data.fonts);
    if (data.lang === 'en') return;
    walk(root, {
      attrs: el => { for (const a of ATTRS) { const v = el.getAttribute?.(a); if (v && dict[v.trim()]) el.setAttribute(a, dict[v.trim()]); } },
      unit: (el, key) => { if (dict[key]) applyUnit(el, dict[key]); },
      text: (n, key) => { if (dict[key]) n.nodeValue = n.nodeValue.replace(/\S[\s\S]*\S|\S/, dict[key]); },
    });
  }

  // Every key on the page (tools/i18n-check.mjs).
  function collect(root = document.body) {
    const keys = new Set();
    walk(root, {
      attrs: el => { for (const a of ATTRS) { const v = el.getAttribute?.(a); if (v && letters(v)) keys.add(v.trim()); } },
      unit: (_el, key) => keys.add(key),
      text: (_n, key) => keys.add(key),
    });
    return [...keys];
  }

  window.I18N = { t, apply, collect, lang: data.lang, languages: data.languages, data };
})();
