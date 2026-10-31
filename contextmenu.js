// The right-click menu of SillyTavern pages (and the launcher's text
// fields). Electron shows none by default. A page that draws its own menu
// (preventDefault on contextmenu) keeps it: Chromium doesn't ask us then.
//
// Desktop extensions add their own entries (extensions.js → contextItems),
// shown only for the kind of thing that was clicked.
import { Menu, clipboard } from 'electron';

export const SEARCH_ENGINES = {
    google: ['Google', 'https://www.google.com/search?q='],
    duckduckgo: ['DuckDuckGo', 'https://duckduckgo.com/?q='],
    bing: ['Bing', 'https://www.bing.com/search?q='],
};

// What was clicked, in the words extensions use for `contexts`.
export function contextsOf(p) {
    const c = new Set(['all']);
    if (p.isEditable) c.add('editable');
    if (p.selectionText?.trim()) c.add('selection');
    if (p.linkURL) c.add('link');
    if (p.mediaType === 'image' && p.srcURL) c.add('image');
    if (p.misspelledWord) c.add('misspelled');
    if (c.size === 1) c.add('page');
    return c;
}

const short = (s, n = 28) => {
    const t = String(s).replace(/\s+/g, ' ').trim();
    return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const httpish = url => /^https?:/i.test(url);

// opts (all optional except where noted):
//   inside(url) → bool     link/image stays in this app (a tab) or goes to the browser
//   openTab(url)           opens a page of this SillyTavern in a tab
//   openExternal(url)      the safe system-browser opener (required)
//   search() → engine id   settings.searchEngine
//   inspect() → bool       show "Inspect element"
//   extra(params, wc) → template items from desktop extensions
export function attach(wc, opts) {
    wc.on('context-menu', (_e, p) => {
        const template = build(wc, p, opts);
        if (template.length) Menu.buildFromTemplate(template).popup({ window: opts.window?.() });
    });
}

export function build(wc, p, opts) {
    const f = p.editFlags || {};
    const groups = [];
    const sel = p.selectionText?.trim() || '';

    // Spelling: Chromium's suggestions for the word under the cursor.
    if (p.isEditable && p.misspelledWord) {
        const g = (p.dictionarySuggestions || []).slice(0, 5).map(s => ({ label: s, click: () => wc.replaceMisspelling(s) }));
        if (!g.length) g.push({ label: 'No spelling suggestions', enabled: false });
        g.push({ label: `Add "${short(p.misspelledWord, 20)}" to dictionary`, click: () => wc.session.addWordToSpellCheckerDictionary(p.misspelledWord) });
        groups.push(g);
    }

    if (p.linkURL && !p.linkURL.startsWith('javascript:')) {
        const g = [];
        if (opts.openTab && opts.inside?.(p.linkURL)) g.push({ label: 'Open link in new tab', click: () => opts.openTab(p.linkURL) });
        if (httpish(p.linkURL)) g.push({ label: 'Open link in browser', click: () => opts.openExternal(p.linkURL) });
        g.push({ label: p.linkURL.startsWith('mailto:') ? 'Copy email address' : 'Copy link address', click: () => clipboard.writeText(p.linkURL.replace(/^mailto:/, '')) });
        groups.push(g);
    }

    if (p.mediaType === 'image' && p.srcURL) {
        const g = [];
        if (opts.openTab && opts.inside?.(p.srcURL)) g.push({ label: 'Open image in new tab', click: () => opts.openTab(p.srcURL) });
        g.push({ label: 'Save image as…', click: () => wc.downloadURL(p.srcURL) });
        g.push({ label: 'Copy image', click: () => wc.copyImageAt(p.x, p.y) });
        if (!p.srcURL.startsWith('data:')) g.push({ label: 'Copy image address', click: () => clipboard.writeText(p.srcURL) });
        groups.push(g);
    }

    if (p.isEditable) {
        groups.push([
            { label: 'Undo', role: 'undo', accelerator: 'Ctrl+Z', enabled: f.canUndo },
            { label: 'Redo', role: 'redo', accelerator: 'Ctrl+Y', enabled: f.canRedo },
        ]);
        groups.push([
            { label: 'Cut', role: 'cut', accelerator: 'Ctrl+X', enabled: f.canCut },
            { label: 'Copy', role: 'copy', accelerator: 'Ctrl+C', enabled: f.canCopy },
            { label: 'Paste', role: 'paste', accelerator: 'Ctrl+V', enabled: f.canPaste },
            { label: 'Paste as plain text', role: 'pasteAndMatchStyle', accelerator: 'Ctrl+Shift+V', enabled: f.canPaste },
            { label: 'Delete', role: 'delete', enabled: f.canDelete },
        ]);
        groups.push([{ label: 'Select all', role: 'selectAll', accelerator: 'Ctrl+A', enabled: f.canSelectAll }]);
    } else if (sel) {
        groups.push([{ label: 'Copy', role: 'copy', accelerator: 'Ctrl+C' }]);
    }

    if (sel && opts.search) {
        const [name, base] = SEARCH_ENGINES[opts.search()] || SEARCH_ENGINES.google;
        groups.push([{ label: `Search ${name} for "${short(sel)}"`, click: () => opts.openExternal(base + encodeURIComponent(sel.slice(0, 500))) }]);
    }

    const extra = opts.extra?.(p, wc) || [];
    if (extra.length) groups.push(extra);

    // Empty space on a page: navigation, like a browser.
    if (!p.isEditable && !sel && !p.linkURL && p.mediaType === 'none' && opts.openTab) {
        groups.push([
            { label: 'Back', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() },
            { label: 'Forward', enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() },
            { label: 'Reload', accelerator: 'F5', click: () => wc.reload() },
        ]);
    }

    if (opts.inspect?.()) groups.push([{ label: 'Inspect element', click: () => { wc.inspectElement(p.x, p.y); if (wc.isDevToolsOpened()) wc.devToolsWebContents?.focus(); } }]);

    return groups.filter(g => g.length).flatMap((g, i) => (i ? [{ type: 'separator' }, ...g] : g));
}
