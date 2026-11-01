// Writing helper — runs in every SillyTavern page (desktop extension page code).
// Word suggestions above the text box you type in, autocorrect when a word is
// finished (Backspace right after undoes it), and learning from what you send.
// The dictionary itself lives in the app (main.cjs); this asks it.
(() => {
    if (window.__desktopWritingHelper) { window.__desktopWritingHelper.refresh(); return; }
    const ID = 'writing-helper';
    const call = (channel, ...args) => (window.SillyTavernDesktop ? window.SillyTavernDesktop.invoke(ID, channel, ...args) : Promise.resolve(null));
    let cfg = { mode: 'off' };
    const WORD = /[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*['’]?$/u;
    const BOUNDARY = /^[\s.,!?;:)"”’…]$/u;
    // Text boxes that hold code or settings, not writing.
    const SKIP = '#customCSS, .CodeMirror *, .monaco-editor *, [data-no-writing-helper], #regex_test_input, #regex_test_output';

    const usable = el => el && el.tagName === 'TEXTAREA' && !el.readOnly && !el.disabled && !el.matches(SKIP);

    // ---------- the strip ----------
    const strip = document.createElement('div');
    strip.id = 'desktop-writing-helper';
    strip.setAttribute('role', 'listbox');
    strip.hidden = true;
    const style = document.createElement('style');
    style.textContent = `
#desktop-writing-helper { position: fixed; z-index: 2147483000; display: flex; gap: 4px; padding: 3px; max-width: 90vw;
  background: var(--SmartThemeBlurTintColor, #222); color: var(--SmartThemeBodyColor, #ddd);
  border: 1px solid var(--SmartThemeBorderColor, #555); border-radius: 8px; box-shadow: 0 4px 14px rgba(0,0,0,.35);
  font-size: calc(var(--mainFontSize, 15px) * 0.95); backdrop-filter: blur(var(--SmartThemeBlurStrength, 6px)); }
#desktop-writing-helper[hidden] { display: none; }
#desktop-writing-helper button { all: unset; cursor: pointer; padding: 2px 10px; border-radius: 6px; white-space: nowrap; }
#desktop-writing-helper button:hover, #desktop-writing-helper button.first { background: var(--SmartThemeQuoteColor, rgba(255,255,255,.12)); color: var(--SmartThemeBodyColor, #fff); }
#desktop-writing-helper button.first { outline: 1px solid var(--SmartThemeBorderColor, #777); }
#desktop-writing-helper kbd { opacity: .55; font: inherit; font-size: .8em; margin-left: 6px; }
#desktop-writing-helper .fix::before { content: '✎ '; opacity: .6; }`;
    document.head.append(style);
    document.body.append(strip);

    let current = null; // { el, start, end, words }
    let seq = 0;
    function hide() { strip.hidden = true; current = null; }
    function place(el) {
        const r = el.getBoundingClientRect();
        strip.style.left = `${Math.max(4, r.left)}px`;
        const h = strip.offsetHeight || 30;
        strip.style.top = `${r.top - h - 4 < 4 ? r.bottom + 4 : r.top - h - 4}px`;
    }
    function show(el, start, end, words, fixes) {
        if (!words.length) return hide();
        current = { el, start, end, words };
        strip.replaceChildren(...words.map((w, i) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = w;
            if (fixes.includes(w)) b.className = 'fix';
            if (i === 0) b.classList.add('first');
            const k = document.createElement('kbd');
            k.textContent = i === 0 && cfg.tabAccepts ? 'Tab' : `Alt+${i + 1}`;
            b.append(k);
            b.addEventListener('mousedown', e => { e.preventDefault(); accept(i); }); // keep the focus in the text box
            return b;
        }));
        strip.hidden = false;
        place(el);
    }

    // Replaces text in a text box the way typing does (undo, input events).
    function replace(el, start, end, text) {
        el.focus();
        el.setSelectionRange(start, end);
        if (!document.execCommand('insertText', false, text)) {
            el.setRangeText(text, start, end, 'end');
            el.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }
    function accept(i) {
        if (!current) return false;
        const { el, start, end, words } = current;
        const next = el.value[end] || '';
        // Like a phone keyboard: a space after the word, unless one follows.
        replace(el, start, end, words[i] + (/[\s.,!?;:)]/.test(next) ? '' : ' '));
        hide();
        suggestSoon(el);
        return true;
    }

    // The word being typed (up to the cursor) and the word before it.
    function context(el) {
        const caret = el.selectionStart;
        if (caret !== el.selectionEnd) return null;
        const before = el.value.slice(0, caret);
        // Not inside {{macros}}, links, or `code`.
        const line = before.slice(before.lastIndexOf('\n') + 1);
        if (before.lastIndexOf('{{') > before.lastIndexOf('}}')) return null;
        if (/\S*:\/\/\S*$/.test(line) || /\bwww\.\S*$/.test(line)) return null;
        if ((before.match(/```/g) || []).length % 2 || ((line.match(/`/g) || []).length % 2)) return null;
        const m = /[\p{L}\p{M}'’]*$/u.exec(before);
        const prefix = m[0].replace(/^['’]+/, '');
        if (/\d$/.test(before.slice(0, caret - prefix.length))) return null;
        const prevM = /([\p{L}\p{M}'’]+)[^\p{L}\p{M}]*$/u.exec(before.slice(0, caret - prefix.length));
        return { prefix, start: caret - prefix.length, end: caret, prev: prevM ? prevM[1] : '' };
    }

    let timer = 0;
    function suggestSoon(el) {
        clearTimeout(timer);
        timer = setTimeout(() => suggest(el), 25);
    }
    async function suggest(el) {
        if (cfg.mode !== 'helper' || !cfg.suggestions || !cfg.ready || document.activeElement !== el) return hide();
        const c = context(el);
        if (!c) return hide();
        const my = ++seq;
        const r = (await call('suggest', c.prefix, c.prev)) || { words: [], fixes: 0 };
        if (my !== seq || document.activeElement !== el || el.selectionStart !== c.end) return;
        const fixes = r.words.slice(0, r.fixes);
        show(el, c.start, c.end, r.words.filter(w => w !== c.prefix), fixes);
    }

    // ---------- autocorrect ----------
    let last = null; // the latest correction: { el, start, from, to, caret }
    const skipped = new Set(); // words undone with Backspace: left alone in this page
    async function autocorrect(el, boundaryAt) {
        if (cfg.mode !== 'helper' || !cfg.autocorrect || !cfg.ready) return;
        const before = el.value.slice(0, boundaryAt);
        const m = WORD.exec(before);
        if (!m) return;
        const word = m[0].replace(/['’]$/, '');
        const start = boundaryAt - m[0].length;
        if (skipped.has(word.toLowerCase())) return;
        const fakeEl = { value: el.value, selectionStart: start, selectionEnd: start };
        if (!context(fakeEl)) return; // macro, link or code
        const prevM = /([\p{L}\p{M}'’]+)([^\p{L}\p{M}]*)$/u.exec(before.slice(0, start));
        // At the start of a sentence (or the text), a capital letter isn't a name.
        const prev = !prevM || /[.!?]\s*$/.test(prevM[2]) ? '' : prevM[1];
        const value = el.value;
        const to = await call('correct', word, prev);
        if (!to || to === word || el.value !== value || document.activeElement !== el) return;
        const caret = el.selectionStart;
        replace(el, start, start + word.length, to);
        const after = caret + (to.length - word.length);
        el.setSelectionRange(after, after);
        last = { el, start, from: word, to, caret: after };
    }

    // ---------- events ----------
    function onInput(e) {
        const el = e.target;
        if (!usable(el) || e.isComposing) return;
        if (e.inputType === 'insertText' && e.data && BOUNDARY.test(e.data.slice(-1))) autocorrect(el, el.selectionStart - 1);
        suggestSoon(el);
    }
    function onKeyDown(e) {
        const el = e.target;
        if (!usable(el) || e.isComposing) return;
        // Backspace right after a correction: back to what was typed.
        if (e.key === 'Backspace' && last && last.el === el && el.selectionStart === last.caret && el.selectionEnd === last.caret
            && el.value.slice(last.start, last.start + last.to.length) === last.to) {
            e.preventDefault();
            const { start, from, to } = last;
            replace(el, start, start + to.length, from);
            const after = last.caret - (to.length - from.length);
            el.setSelectionRange(after, after);
            skipped.add(from.toLowerCase());
            last = null;
            return;
        }
        if (!['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) last = null;
        if (current && !strip.hidden) {
            if (e.key === 'Tab' && cfg.tabAccepts && !e.shiftKey && !e.ctrlKey && !e.altKey) { if (accept(0)) { e.preventDefault(); e.stopPropagation(); } return; }
            if (e.altKey && /^[1-3]$/.test(e.key)) { if (accept(Number(e.key) - 1)) { e.preventDefault(); e.stopPropagation(); } return; }
            if (e.key === 'Escape') { hide(); e.stopPropagation(); return; }
        }
        // Sent: learn from it (SillyTavern clears the box after sending).
        if (e.key === 'Enter' && !e.shiftKey && el.id === 'send_textarea' && cfg.learnTyping && el.value.trim()) call('learn', el.value);
    }
    function onClick(e) {
        if (e.target.closest?.('#send_but') && cfg.learnTyping) {
            const t = document.getElementById('send_textarea');
            if (t && t.value.trim()) call('learn', t.value);
        }
    }
    const onFocusOut = e => { if (current && e.target === current.el) setTimeout(() => { if (document.activeElement !== current?.el) hide(); }, 0); };
    const onMouseUp = e => { if (usable(e.target)) suggestSoon(e.target); };
    const onScroll = () => { if (current) place(current.el); };
    document.addEventListener('input', onInput, true);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('focusout', onFocusOut, true);
    document.addEventListener('mouseup', onMouseUp, true);
    window.addEventListener('resize', onScroll);
    document.addEventListener('scroll', onScroll, true);

    window.__desktopWritingHelper = {
        setConfig(c) { cfg = c; if (cfg.mode !== 'helper') hide(); },
        refresh() { call('config').then(c => { if (c) cfg = c; }); },
        // The word at the text cursor (right-click → Add the word at the cursor).
        wordAtCursor() {
            const el = document.activeElement;
            if (!el || typeof el.value !== 'string') return '';
            const i = el.selectionStart;
            const left = /[\p{L}\p{M}'’]*$/u.exec(el.value.slice(0, i))[0];
            const right = /^[\p{L}\p{M}'’]*/u.exec(el.value.slice(i))[0];
            return (left + right).replace(/^['’]+|['’]+$/g, '');
        },
        destroy() {
            document.removeEventListener('input', onInput, true);
            document.removeEventListener('keydown', onKeyDown, true);
            document.removeEventListener('click', onClick, true);
            document.removeEventListener('focusout', onFocusOut, true);
            document.removeEventListener('mouseup', onMouseUp, true);
            window.removeEventListener('resize', onScroll);
            document.removeEventListener('scroll', onScroll, true);
            strip.remove();
            style.remove();
            delete window.__desktopWritingHelper;
        },
    };
    window.__desktopWritingHelper.refresh();
})();
