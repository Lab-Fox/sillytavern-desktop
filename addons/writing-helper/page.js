// Writing helper — runs in every SillyTavern page (desktop extension page code).
// Word suggestions next to the text cursor, autocorrect when a word is
// finished (Backspace right after undoes it), and learning from what you send.
// The dictionary itself lives in the app (main.cjs); this asks it.
(() => {
    if (window.__desktopWritingHelper) { window.__desktopWritingHelper.refresh(); return; }
    const ID = 'writing-helper';
    const call = (channel, ...args) => (window.SillyTavernDesktop ? window.SillyTavernDesktop.invoke(ID, channel, ...args) : Promise.resolve(null));
    let cfg = { mode: null }; // null until the app answers: touch nothing before that
    const WORD = /[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*['’]?$/u;
    const BOUNDARY = /^[\s.,!?;:)"”’…]$/u;
    // Text boxes that hold code or settings, not writing: no suggestions there.
    const SKIP = '#customCSS, .CodeMirror *, .monaco-editor *, .cm-editor *, [data-no-writing-helper], #regex_test_input, #regex_test_output, #tabby_json_schema, #grammar, #grammar_string_textgenerationwebui';
    // One-line fields for keys, addresses, searches and numbers.
    const SETTING_INPUT = /key|token|secret|pass|url|link|api|proxy|endpoint|server|host|port|model|regex|search|filter|find|seed|colou?r|css|json|path|mail/i;
    const TEXT_INPUT = new Set(['', 'text']);

    // The element that holds the text being edited, or null: a text area, a
    // one-line text field or an editable element (contenteditable).
    function fieldOf(el) {
        if (!el || el.nodeType !== 1) return null;
        if (el.tagName === 'TEXTAREA') return el;
        if (el.tagName === 'INPUT') return TEXT_INPUT.has((el.getAttribute('type') || '').toLowerCase()) ? el : null;
        if (el.isContentEditable) {
            let host = el;
            while (host.parentElement?.isContentEditable) host = host.parentElement;
            return host;
        }
        return null;
    }
    const isValueField = el => el.tagName === 'TEXTAREA' || el.tagName === 'INPUT';
    // Suggestions and autocorrect only in fields meant for writing.
    function writable(el) {
        if (!el || el.matches(SKIP) || el.closest('[data-no-writing-helper]')) return false;
        if (isValueField(el) && (el.readOnly || el.disabled)) return false;
        if (el.tagName === 'INPUT') {
            const hint = `${el.id} ${el.name} ${el.className} ${el.placeholder} ${el.getAttribute('autocomplete') || ''}`;
            if (SETTING_INPUT.test(hint)) return false;
        }
        return true;
    }

    // ---------- Windows' own suggestions ----------
    // Windows 11 shows its own box of text suggestions for the physical
    // keyboard. Chromium tells Windows what a field is for; for a "search"
    // field Windows shows none. So in "This add-on" and "Off" mode, every
    // text field gets inputmode="search" while it has the focus (the page's
    // own value comes back afterwards). Only the touch keyboard looks
    // different (its search layout).
    const ownInputmode = new WeakMap(); // field → its inputmode before (null = none)
    let marked = null;
    const hideWindowsBox = () => cfg.mode === 'helper' || cfg.mode === 'off';
    function markField(el) {
        if (marked && marked !== el) unmarkField();
        if (!el || !hideWindowsBox() || marked === el) return;
        const mode = el.getAttribute('inputmode');
        if (mode && mode !== 'text') return; // the page asked for a keyboard of its own
        ownInputmode.set(el, mode);
        el.setAttribute('inputmode', 'search');
        marked = el;
    }
    function unmarkField() {
        const el = marked;
        marked = null;
        if (!el || !ownInputmode.has(el)) return;
        const mode = ownInputmode.get(el);
        ownInputmode.delete(el);
        if (el.getAttribute('inputmode') !== 'search') return; // the page changed it since
        if (mode == null) el.removeAttribute('inputmode'); else el.setAttribute('inputmode', mode);
    }

    // ---------- text and cursor, for both kinds of field ----------
    // "Before the cursor": { before, base, node } — `before` is the text up
    // to the cursor; positions are offsets into the value (text fields) or
    // into the text node the cursor is in (editable elements).
    function cursorText(el) {
        if (isValueField(el)) {
            if (el.selectionStart == null || el.selectionStart !== el.selectionEnd) return null;
            return { before: el.value.slice(0, el.selectionStart), caret: el.selectionStart, node: null };
        }
        const sel = document.getSelection();
        if (!sel || sel.rangeCount !== 1 || !sel.isCollapsed) return null;
        const node = sel.anchorNode;
        if (!node || node.nodeType !== 3 || !el.contains(node)) return null;
        return { before: node.data.slice(0, sel.anchorOffset), caret: sel.anchorOffset, node };
    }
    // Something that changes when the text changes (to drop stale answers).
    const snapshot = (el, at) => (isValueField(el) ? el.value : `${at.node?.data}`);
    // Replaces text the way typing does (undo works, input events fire).
    function replace(el, node, start, end, text) {
        if (isValueField(el)) {
            el.focus();
            el.setSelectionRange(start, end);
            if (!document.execCommand('insertText', false, text)) {
                el.setRangeText(text, start, end, 'end');
                el.dispatchEvent(new Event('input', { bubbles: true }));
            }
            return;
        }
        if (!node?.isConnected) return;
        const r = document.createRange();
        r.setStart(node, start);
        r.setEnd(node, end);
        const sel = document.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
        document.execCommand('insertText', false, text);
    }
    function setCaret(el, node, at) {
        if (isValueField(el)) { el.setSelectionRange(at, at); return; }
        if (!node?.isConnected) return;
        const r = document.createRange();
        r.setStart(node, Math.min(at, node.data.length));
        const sel = document.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
    }

    // Where the text cursor is on screen: { left, top, bottom }.
    const MIRROR = ['direction', 'boxSizing', 'width', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderStyle',
        'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize',
        'fontSizeAdjust', 'lineHeight', 'fontFamily', 'fontFeatureSettings', 'textAlign', 'textTransform', 'textIndent', 'letterSpacing', 'wordSpacing', 'tabSize', 'wordBreak', 'overflowWrap'];
    let mirror = null;
    function caretBox(el) {
        const box = el.getBoundingClientRect();
        let pos = null;
        if (isValueField(el)) {
            if (!mirror) mirror = document.createElement('div');
            const cs = getComputedStyle(el);
            const m = mirror.style;
            for (const p of MIRROR) m[p] = cs[p];
            m.position = 'absolute'; m.visibility = 'hidden'; m.top = '0'; m.left = '-9999px'; m.overflow = 'hidden'; m.height = 'auto';
            m.whiteSpace = el.tagName === 'TEXTAREA' ? 'pre-wrap' : 'pre';
            if (el.tagName === 'TEXTAREA') m.overflowWrap = 'break-word';
            mirror.textContent = el.value.slice(0, el.selectionStart);
            const mark = document.createElement('span');
            mark.textContent = '|';
            mirror.append(mark);
            document.body.append(mirror);
            const top = box.top + mark.offsetTop + parseFloat(cs.borderTopWidth) - el.scrollTop;
            const left = box.left + mark.offsetLeft + parseFloat(cs.borderLeftWidth) - el.scrollLeft;
            pos = { left, top, bottom: top + mark.offsetHeight };
            mirror.remove();
        } else {
            const sel = document.getSelection();
            if (sel?.rangeCount) {
                const r = sel.getRangeAt(0).cloneRange();
                r.collapse(true);
                const rect = r.getClientRects()[0];
                if (rect) pos = { left: rect.left, top: rect.top, bottom: rect.bottom };
            }
        }
        if (!pos) return { left: box.left + 4, top: box.top, bottom: box.top + 20 };
        // A cursor scrolled out of the box: keep the words at the box's edge.
        const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));
        const h = pos.bottom - pos.top;
        const top = clamp(pos.top, box.top, box.bottom - h);
        return { left: clamp(pos.left, box.left, box.right), top, bottom: top + h };
    }

    // ---------- the strip ----------
    // A popover, so it sits in the browser's top layer: above SillyTavern's
    // popups and expanded editors (modal <dialog>s), which cover everything else.
    const strip = document.createElement('div');
    strip.id = 'desktop-writing-helper';
    strip.setAttribute('role', 'listbox');
    strip.setAttribute('aria-label', 'Word suggestions');
    const canPopover = typeof strip.showPopover === 'function';
    if (canPopover) strip.popover = 'manual'; else strip.hidden = true;
    const style = document.createElement('style');
    style.textContent = `
#desktop-writing-helper { position: fixed; inset: auto; margin: 0; z-index: 2147483000; display: flex; gap: 4px; padding: 3px; max-width: 90vw; overflow: visible;
  background: var(--SmartThemeBlurTintColor, #222); color: var(--SmartThemeBodyColor, #ddd);
  border: 1px solid var(--SmartThemeBorderColor, #555); border-radius: 8px; box-shadow: 0 4px 14px rgba(0,0,0,.35);
  font-family: var(--mainFontFamily, sans-serif); font-size: calc(var(--mainFontSize, 15px) * 0.95); line-height: 1.4;
  backdrop-filter: blur(var(--SmartThemeBlurStrength, 6px)); }
#desktop-writing-helper:not(:popover-open):not([popover]) { display: flex; }
#desktop-writing-helper[hidden], #desktop-writing-helper[popover]:not(:popover-open) { display: none; }
#desktop-writing-helper button { all: unset; cursor: pointer; padding: 2px 10px; border-radius: 6px; white-space: nowrap; }
#desktop-writing-helper button:hover, #desktop-writing-helper button.first { background: var(--SmartThemeQuoteColor, rgba(255,255,255,.12)); color: var(--SmartThemeBodyColor, #fff); }
#desktop-writing-helper button.first { outline: 1px solid var(--SmartThemeBorderColor, #777); }
#desktop-writing-helper kbd { opacity: .55; font: inherit; font-size: .8em; margin-left: 6px; }
#desktop-writing-helper .fix::before { content: '✎ '; opacity: .6; }`;
    document.head.append(style);
    document.body.append(strip);

    let current = null; // { el, node, start, end, words }
    let seq = 0;
    const isOpen = () => (canPopover && strip.hasAttribute('popover') ? strip.matches(':popover-open') : !strip.hidden);
    function close() {
        if (!isOpen()) return;
        if (canPopover && strip.hasAttribute('popover')) { try { strip.hidePopover(); } catch { /* already closed */ } } else strip.hidden = true;
    }
    function hide() { current = null; close(); }
    function open(el) {
        // Inside a modal dialog the strip must be part of it, or the dialog
        // makes it unclickable.
        const home = el.closest('dialog') || document.body;
        if (strip.parentElement !== home) { close(); home.append(strip); }
        if (isOpen()) return;
        if (canPopover) {
            try { strip.showPopover(); return; } catch { strip.removeAttribute('popover'); }
        }
        strip.hidden = false;
    }
    function place(el) {
        const c = caretBox(el);
        const w = strip.offsetWidth, h = strip.offsetHeight || 30;
        strip.style.left = `${Math.max(4, Math.min(c.left - 10, innerWidth - w - 4))}px`;
        strip.style.top = `${c.top - h - 6 < 4 ? c.bottom + 6 : c.top - h - 6}px`;
    }
    function show(el, at, start, end, words, fixes) {
        if (!words.length) return hide();
        current = { el, node: at.node, start, end, words };
        strip.replaceChildren(...words.map((w, i) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.tabIndex = -1;
            b.setAttribute('role', 'option');
            b.textContent = w;
            if (fixes.includes(w)) b.className = 'fix';
            if (i === 0) b.classList.add('first');
            const k = document.createElement('kbd');
            k.textContent = i === 0 && cfg.tabAccepts ? 'Tab' : `Alt+${i + 1}`;
            b.append(k);
            b.addEventListener('mousedown', e => { e.preventDefault(); accept(i); }); // keep the focus in the text box
            return b;
        }));
        open(el);
        place(el);
    }

    function accept(i) {
        if (!current) return false;
        const { el, node, start, end, words } = current;
        const text = isValueField(el) ? el.value : node?.data || '';
        const next = text[end] || '';
        // Like a phone keyboard: a space after the word, unless one follows.
        replace(el, node, start, end, words[i] + (/[\s.,!?;:)]/.test(next) ? '' : ' '));
        hide();
        suggestSoon(el);
        return true;
    }

    // The word being typed (up to the cursor) and the word before it.
    function context(before) {
        // Not inside {{macros}}, links, or `code`.
        const line = before.slice(before.lastIndexOf('\n') + 1);
        if (before.lastIndexOf('{{') > before.lastIndexOf('}}')) return null;
        if (/\S*:\/\/\S*$/.test(line) || /\bwww\.\S*$/.test(line)) return null;
        if ((before.match(/```/g) || []).length % 2 || ((line.match(/`/g) || []).length % 2)) return null;
        const m = /[\p{L}\p{M}'’]*$/u.exec(before);
        const prefix = m[0].replace(/^['’]+/, '');
        const rest = before.slice(0, before.length - prefix.length);
        if (/\d$/.test(rest)) return null;
        const prevM = /([\p{L}\p{M}'’]+)[^\p{L}\p{M}]*$/u.exec(rest);
        return { prefix, start: before.length - prefix.length, prev: prevM ? prevM[1] : '' };
    }

    let timer = 0;
    function suggestSoon(el) {
        clearTimeout(timer);
        timer = setTimeout(() => suggest(el), 25);
    }
    async function suggest(el) {
        if (cfg.mode !== 'helper' || !cfg.suggestions || !cfg.ready || fieldOf(document.activeElement) !== el || !writable(el)) return hide();
        const at = cursorText(el);
        const c = at && context(at.before);
        if (!c) return hide();
        const my = ++seq;
        const before = snapshot(el, at);
        const r = (await call('suggest', c.prefix, c.prev)) || { words: [], fixes: 0 };
        const now = cursorText(el);
        if (my !== seq || fieldOf(document.activeElement) !== el || !now || now.caret !== at.caret || now.node !== at.node || snapshot(el, now) !== before) return;
        const fixes = r.words.slice(0, r.fixes);
        show(el, at, c.start, at.caret, r.words.filter(w => w !== c.prefix), fixes);
    }

    // ---------- autocorrect ----------
    let last = null; // the latest correction: { el, node, start, from, to, caret }
    const skipped = new Set(); // words undone with Backspace: left alone in this page
    async function autocorrect(el) {
        if (cfg.mode !== 'helper' || !cfg.autocorrect || !cfg.ready || !writable(el)) return;
        const at = cursorText(el);
        if (!at || !at.before) return;
        const boundaryAt = at.caret - 1; // the space or mark just typed
        const before = at.before.slice(0, boundaryAt);
        const m = WORD.exec(before);
        if (!m) return;
        const word = m[0].replace(/['’]$/, '');
        const start = boundaryAt - m[0].length;
        if (skipped.has(word.toLowerCase())) return;
        if (!context(before.slice(0, start))) return; // macro, link or code
        const prevM = /([\p{L}\p{M}'’]+)([^\p{L}\p{M}]*)$/u.exec(before.slice(0, start));
        // At the start of a sentence (or the text), a capital letter isn't a name.
        const prev = !prevM || /[.!?]\s*$/.test(prevM[2]) ? '' : prevM[1];
        const value = snapshot(el, at);
        const to = await call('correct', word, prev);
        const now = cursorText(el);
        if (!to || to === word || !now || now.node !== at.node || snapshot(el, now) !== value || fieldOf(document.activeElement) !== el) return;
        replace(el, at.node, start, start + word.length, to);
        const after = now.caret + (to.length - word.length);
        setCaret(el, at.node, after);
        last = { el, node: at.node, start, from: word, to, caret: after };
    }

    // ---------- learning from what you send ----------
    // Only once SillyTavern has sent it (the box is empty then): Enter may
    // just add a line, and a send can fail.
    let sentText = '', lastLearned = '';
    function sending() {
        const t = document.getElementById('send_textarea');
        if (!cfg.learnTyping || !t || !t.value.trim()) return;
        sentText = t.value;
        setTimeout(() => {
            if (t.value.trim() || !sentText || sentText === lastLearned) return;
            lastLearned = sentText;
            call('learn', sentText);
            sentText = '';
        }, 600);
    }

    // ---------- events ----------
    function onFocusIn(e) {
        const el = fieldOf(e.target);
        if (el) markField(el); else unmarkField();
    }
    function onInput(e) {
        const el = fieldOf(e.target);
        if (!el || e.isComposing) return;
        if (e.inputType === 'insertText' && e.data && BOUNDARY.test(e.data.slice(-1))) autocorrect(el);
        suggestSoon(el);
    }
    const NAV = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);
    function onKeyDown(e) {
        const el = fieldOf(e.target);
        if (!el || e.isComposing) return;
        // Backspace right after a correction: back to what was typed.
        if (e.key === 'Backspace' && last && last.el === el && !e.ctrlKey && !e.altKey) {
            const at = cursorText(el);
            const text = isValueField(el) ? el.value : last.node?.data || '';
            if (at && at.caret === last.caret && at.node === last.node && text.slice(last.start, last.start + last.to.length) === last.to) {
                e.preventDefault();
                const { node, start, from, to } = last;
                replace(el, node, start, start + to.length, from);
                setCaret(el, node, last.caret - (to.length - from.length));
                skipped.add(from.toLowerCase());
                last = null;
                return;
            }
        }
        if (!['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) last = null;
        if (current && isOpen()) {
            if (e.key === 'Tab' && cfg.tabAccepts && !e.shiftKey && !e.ctrlKey && !e.altKey) { if (accept(0)) { e.preventDefault(); e.stopPropagation(); } return; }
            if (e.altKey && !e.ctrlKey && /^[1-3]$/.test(e.key)) { if (current.words[Number(e.key) - 1] && accept(Number(e.key) - 1)) { e.preventDefault(); e.stopPropagation(); } return; }
            if (e.key === 'Escape') { hide(); e.preventDefault(); e.stopPropagation(); return; }
            if (NAV.has(e.key)) hide(); // the cursor moves: new words after the key
        }
        if (e.key === 'Enter' && !e.shiftKey && el.id === 'send_textarea') sending();
    }
    function onKeyUp(e) {
        const el = fieldOf(e.target);
        if (el && NAV.has(e.key)) suggestSoon(el);
    }
    function onClick(e) {
        if (e.target.closest?.('#send_but')) sending();
    }
    function onFocusOut(e) {
        const el = fieldOf(e.target);
        setTimeout(() => {
            const now = fieldOf(document.activeElement);
            if (current && now !== current.el) hide();
            if (el && now !== el && marked === el) unmarkField();
        }, 0);
    }
    const onMouseUp = e => { const el = fieldOf(e.target); if (el) suggestSoon(el); };
    const onScroll = () => { if (current && isOpen()) place(current.el); };
    const onComposition = () => hide();
    const listeners = [
        [document, 'focusin', onFocusIn], [document, 'input', onInput], [document, 'keydown', onKeyDown], [document, 'keyup', onKeyUp],
        [document, 'click', onClick], [document, 'focusout', onFocusOut], [document, 'mouseup', onMouseUp],
        [document, 'scroll', onScroll], [document, 'compositionstart', onComposition], [window, 'resize', onScroll],
    ];
    for (const [t, ev, fn] of listeners) t.addEventListener(ev, fn, true);

    function applyConfig(c) {
        cfg = c || { mode: null };
        if (cfg.mode !== 'helper' || !cfg.suggestions) hide();
        // The field in use right now follows the new mode at once.
        const el = fieldOf(document.activeElement);
        if (hideWindowsBox()) markField(el); else unmarkField();
    }

    window.__desktopWritingHelper = {
        setConfig: applyConfig,
        refresh() { call('config').then(c => { if (c) applyConfig(c); }); },
        // The word at the text cursor (right-click → Add the word at the cursor).
        wordAtCursor() {
            const el = fieldOf(document.activeElement);
            if (!el) return '';
            let left = '', right = '';
            if (isValueField(el)) {
                const i = el.selectionStart;
                left = el.value.slice(0, i); right = el.value.slice(i);
            } else {
                const sel = document.getSelection();
                const node = sel?.anchorNode;
                if (!node || node.nodeType !== 3) return '';
                left = node.data.slice(0, sel.anchorOffset); right = node.data.slice(sel.anchorOffset);
            }
            return (/[\p{L}\p{M}'’]*$/u.exec(left)[0] + /^[\p{L}\p{M}'’]*/u.exec(right)[0]).replace(/^['’]+|['’]+$/g, '');
        },
        destroy() {
            for (const [t, ev, fn] of listeners) t.removeEventListener(ev, fn, true);
            clearTimeout(timer);
            hide();
            unmarkField();
            strip.remove();
            style.remove();
            delete window.__desktopWritingHelper;
        },
    };
    window.__desktopWritingHelper.refresh();
})();
