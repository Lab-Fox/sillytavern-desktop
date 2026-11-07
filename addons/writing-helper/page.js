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
    const BOUNDARY = /^[\s.,!?;:)"”’…*_~]$/u;
    // Longer than this isn't a word (Japanese or Chinese text without spaces,
    // a pasted code): nothing is looked up for it.
    const MAX_WORD = 40;
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

    // Where the text cursor is. A text area can't tell, so a hidden copy of the
    // text is laid out and measured: that is slow in a long text, so it happens
    // once per change of the text (measureCaret), never while scrolling. The
    // result is the cursor's place inside the field's text; on screen that is
    // the field's position minus how far it is scrolled (caretOnScreen).
    const MIRROR = ['direction', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize',
        'fontSizeAdjust', 'lineHeight', 'fontFamily', 'fontFeatureSettings', 'textAlign', 'textTransform', 'textIndent', 'letterSpacing', 'wordSpacing', 'tabSize', 'wordBreak', 'overflowWrap'];
    const CHUNK = 2048; // only this much of a long paragraph is laid out per key
    let mirror = null, mirrorHost = null, headCache = null;
    function measureCaret(el) {
        if (!mirror) {
            // In a shadow root, like the strip (see there): added to the page once.
            mirrorHost = document.createElement('div');
            mirrorHost.id = 'desktop-writing-helper-measure';
            mirror = document.createElement('div');
            mirrorHost.attachShadow({ mode: 'open' }).append(mirror);
            document.body.append(mirrorHost);
        }
        const cs = getComputedStyle(el);
        const m = mirror.style;
        for (const p of MIRROR) m[p] = cs[p];
        const padTop = parseFloat(cs.paddingTop), padLeft = parseFloat(cs.paddingLeft);
        const borderTop = parseFloat(cs.borderTopWidth), borderLeft = parseFloat(cs.borderLeftWidth);
        const borders = borderLeft + parseFloat(cs.borderRightWidth);
        // The lines are as wide as the text's room: a scroll bar takes some of
        // it, and one line more or less adds up over a long text.
        const bar = el.offsetWidth - el.clientWidth - borders;
        const width = el.getBoundingClientRect().width - borders - bar - padLeft - parseFloat(cs.paddingRight);
        m.boxSizing = 'content-box'; m.width = `${width}px`; m.border = '0';
        m.position = 'absolute'; m.visibility = 'hidden'; m.top = '0'; m.left = '-9999px'; m.overflow = 'hidden'; m.height = 'auto';
        const area = el.tagName === 'TEXTAREA';
        m.whiteSpace = area ? 'pre-wrap' : 'pre';
        if (area) m.overflowWrap = 'break-word';
        const indent = m.textIndent;
        const measure = (text, from) => {
            m.textIndent = from == null ? indent : `${from}px`;
            mirror.textContent = text;
            const mark = document.createElement('span');
            mark.textContent = '\u200b'; // no width: it can't push a word to the next line
            mirror.append(mark);
            return { top: mark.offsetTop - padTop, left: mark.offsetLeft - padLeft, height: mark.offsetHeight };
        };
        // The text before the cursor's paragraph, or before the part of a long
        // paragraph the cursor is in, is measured once and kept while it stays
        // the same. The rest goes on from where that part ended.
        const value = el.value, caret = el.selectionStart;
        const lineStart = area && caret > 0 ? value.lastIndexOf('\n', caret - 1) + 1 : 0;
        const into = caret - lineStart;
        const space = area && into > CHUNK ? value.lastIndexOf(' ', caret - (into % CHUNK) - 1) : -1;
        const cut = space >= lineStart ? space + 1 : lineStart;
        const head = value.slice(0, cut);
        const sig = `${width}|${cs.font}|${cs.letterSpacing}|${cs.wordSpacing}|${padTop}`;
        if (!headCache || headCache.el !== el || headCache.sig !== sig || headCache.head !== head) {
            const h = head ? measure(head) : { top: 0, left: 0 };
            headCache = { el, sig, head, top: h.top, from: cut > lineStart ? h.left : null };
        }
        const at = measure(value.slice(cut, caret), headCache.from);
        mirror.textContent = ''; // it holds a copy of the text
        return { x: borderLeft + padLeft + at.left, y: borderTop + padTop + headCache.top + at.top, h: at.height };
    }
    // On screen: { left, top, bottom }, or null when the field is gone or hidden.
    function caretOnScreen(el, spot) {
        const box = el.getBoundingClientRect();
        if (!el.isConnected || !box.width || !box.height) return null;
        let pos = null;
        if (spot) {
            const top = box.top + spot.y - el.scrollTop;
            pos = { left: box.left + spot.x - el.scrollLeft, top, bottom: top + spot.h };
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
    // The words live in a shadow root. SillyTavern and its themes have hundreds
    // of :has() rules, and with those any change in the page itself (an element
    // added, a style set) makes the browser recheck the whole page: about 100 ms
    // each on a big install, measured. Inside a shadow root it's under 0.1 ms.
    // So the page sees one empty element that never changes, and everything
    // that happens per key or per scroll happens in here.
    const strip = document.createElement('div');
    strip.id = 'desktop-writing-helper';
    const canPopover = typeof strip.showPopover === 'function';
    if (canPopover) strip.popover = 'manual'; else strip.hidden = true;
    const shadow = strip.attachShadow({ mode: 'open' });
    const box = document.createElement('div');
    box.className = 'box';
    box.setAttribute('role', 'listbox');
    box.setAttribute('aria-label', 'Word suggestions');
    const style = document.createElement('style');
    style.textContent = `
#desktop-writing-helper { position: fixed; inset: 0 auto auto 0; width: 0; height: 0; margin: 0; padding: 0; border: 0; background: none; overflow: visible; z-index: 2147483000; }
#desktop-writing-helper[hidden], #desktop-writing-helper[popover]:not(:popover-open) { display: none; }
#desktop-writing-helper-measure { position: absolute; left: -9999px; top: 0; width: 0; height: 0; overflow: hidden; visibility: hidden; contain: strict; }`;
    const inner = document.createElement('style');
    inner.textContent = `
.box { position: absolute; left: 0; top: 0; width: max-content; display: flex; flex-direction: column; gap: 2px; padding: 3px; max-width: 90vw; box-sizing: border-box;
  background: var(--SmartThemeBlurTintColor, #222); color: var(--SmartThemeBodyColor, #ddd);
  border: 1px solid var(--SmartThemeBorderColor, #555); border-radius: 8px; box-shadow: 0 4px 14px rgba(0,0,0,.35);
  font-family: var(--mainFontFamily, sans-serif); font-size: calc(var(--mainFontSize, 15px) * 0.95); line-height: 1.4;
  backdrop-filter: blur(var(--SmartThemeBlurStrength, 6px)); }
button { all: unset; cursor: pointer; padding: 2px 10px; border-radius: 6px; white-space: nowrap; }
button:hover { background: color-mix(in srgb, var(--SmartThemeBodyColor, #fff) 10%, transparent); }
button.first { outline: 1px solid color-mix(in srgb, var(--SmartThemeBodyColor, #fff) 35%, transparent); outline-offset: -1px; }
button.sel { background: var(--SmartThemeQuoteColor, #e18a24); color: var(--SmartThemeBlurTintColor, #111); outline: none; }
kbd, .hint { all: unset; opacity: .55; font-size: .78em; margin-left: 6px; }
.hint { margin: 0 2px 0 4px; align-self: center; }
.fix::before { content: '✎ '; opacity: .6; }
.wh-row { display: flex; gap: 4px; align-items: center; }
.wh-row.adult { border-bottom: 1px dashed color-mix(in srgb, var(--SmartThemeBodyColor, #fff) 22%, transparent); padding-bottom: 2px; }
.wh-tag { all: unset; font-size: .7em; padding: 0 4px; border-radius: 4px; opacity: .75; align-self: center;
  border: 1px solid color-mix(in srgb, var(--SmartThemeQuoteColor, #e18a24) 70%, transparent); color: var(--SmartThemeQuoteColor, #e18a24); }`;
    shadow.append(inner, box);
    document.head.append(style);
    document.body.append(strip);

    let current = null; // { el, node, start, end, rows: [normal words, adult words] }
    let seq = 0;
    const isOpen = () => (canPopover && strip.hasAttribute('popover') ? strip.matches(':popover-open') : !strip.hidden);
    function close() {
        if (!isOpen()) return;
        if (canPopover && strip.hasAttribute('popover')) { try { strip.hidePopover(); } catch { /* already closed */ } } else strip.hidden = true;
    }
    function hide() { current = null; sel = null; forget(); close(); }
    // Words still on their way aren't wanted any more.
    function forget() { seq++; clearTimeout(timer); }
    // SillyTavern's popups and big editors are modal <dialog>s. From the page
    // the strip still shows above them (top layer), but can't be clicked: for
    // that it has to be inside the dialog. Moving it there makes the browser
    // restyle the whole page, 17-35 ms on a big install whatever is moved
    // (measured), so it moves only when the mouse comes close, before a click
    // is possible. Typing and the keys never need it.
    const NEAR = 24;
    function goHome() {
        const p = strip.parentElement;
        if (!strip.isConnected || (p !== document.body && !(p.nodeName === 'DIALOG' && p.open))) { close(); document.body.append(strip); }
    }
    // The dialog the strip was last shown for: shown again when that changes,
    // so it goes on top of a dialog that opened after it.
    let shownIn;
    function open(el) {
        goHome();
        const ctx = el.closest('dialog');
        if (isOpen() && shownIn !== ctx) close();
        shownIn = ctx;
        if (isOpen()) return;
        if (canPopover) {
            try { strip.showPopover(); return; } catch { strip.removeAttribute('popover'); }
        }
        strip.hidden = false;
    }
    // → true when the strip had to move into the field's dialog for this point.
    function comeCloser(x, y) {
        if (!current || !isOpen()) return false;
        const dlg = current.el.closest('dialog');
        if (!dlg || strip.parentElement === dlg) return false;
        const r = box.getBoundingClientRect();
        if (x < r.left - NEAR || x > r.right + NEAR || y < r.top - NEAR || y > r.bottom + NEAR) return false;
        close();
        dlg.append(strip);
        open(current.el);
        return true;
    }
    const onPointerMove = e => { if (e.pointerType === 'mouse') comeCloser(e.clientX, e.clientY); };
    // A pen or a finger arrives without hovering: move, then press the word.
    let swallow = false;
    const onPointerDown = e => {
        if (e.pointerType === 'mouse' || !comeCloser(e.clientX, e.clientY)) return;
        swallow = true;
        e.preventDefault();
        shadow.elementFromPoint(e.clientX, e.clientY)?.closest('button')?.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true, composed: true }));
    };
    // Only the device's own press that follows: the one sent to the word above isn't trusted.
    const onMouseDownSwallow = e => { if (swallow && e.isTrusted) { swallow = false; e.preventDefault(); e.stopPropagation(); } };
    // Out of a dialog that closes, so it isn't lost with it.
    const onDialogClose = e => { if (e.target?.nodeName === 'DIALOG' && e.target.contains(strip)) { close(); document.body.append(strip); } };

    // measure: the text or the strip changed. Without it (scrolling) this only
    // reads positions and moves the strip, which needs no layout of the page.
    function place(el, measure) {
        if (measure) {
            current.spot = isValueField(el) ? measureCaret(el) : null;
            current.w = box.offsetWidth;
            current.h = box.offsetHeight || 30;
        }
        const c = caretOnScreen(el, current.spot);
        if (!c) return hide();
        const { w, h } = current;
        const left = Math.max(4, Math.min(c.left - 10, innerWidth - w - 4));
        const top = Math.max(4, Math.min(c.top - h - 6 < 4 ? c.bottom + 6 : c.top - h - 6, innerHeight - h - 4));
        box.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    }
    // At most once per frame, however many scroll events come.
    let frame = 0, frameMeasures = false;
    function placeSoon(measure) {
        frameMeasures ||= measure;
        if (frame) return;
        frame = requestAnimationFrame(() => {
            const again = frameMeasures;
            frame = 0;
            frameMeasures = false;
            if (current && isOpen()) place(current.el, again);
        });
    }
    // ---------- keys ----------
    // "Ctrl+Alt+Shift+Meta+<key>" — the same form main.cjs stores.
    function comboOf(e) {
        let k = e.key === ' ' ? 'Space' : e.key;
        if (k.length === 1) k = k.toUpperCase();
        // Shift changes digits and marks ("!" for 1): use the key's place then.
        if (e.shiftKey && /^Digit\d$/.test(e.code)) k = e.code.slice(5);
        return `${e.ctrlKey ? 'Ctrl+' : ''}${e.altKey ? 'Alt+' : ''}${e.shiftKey ? 'Shift+' : ''}${e.metaKey ? 'Meta+' : ''}${k}`;
    }
    const keysFor = action => cfg.keys?.[action] || [];
    const bound = (action, combo) => keysFor(action).includes(combo);
    const PRETTY = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Escape: 'Esc', Space: 'Space' };
    const pretty = combo => combo.split('+').map(p => PRETTY[p] || p).join('+');

    // The highlighted word { r: row (0 normal, 1 adult), i }, or null:
    // typing goes on. ↑ moves into the normal row, ↑ again into the adult row.
    let sel = null;
    function select(s) {
        sel = s;
        if (s) forget(); // an answer arriving now would drop the highlight
        box.querySelectorAll('button').forEach(b => {
            const on = !!s && Number(b.dataset.r) === s.r && Number(b.dataset.i) === s.i;
            b.classList.toggle('sel', on);
            b.setAttribute('aria-selected', String(on));
        });
        const hint = box.querySelector('.hint');
        if (hint) {
            const k = s ? keysFor('pick')[0] : keysFor('enter')[0];
            hint.textContent = k ? pretty(k) : '';
        }
    }

    function button(w, r, i, fixes) {
        const b = document.createElement('button');
        b.type = 'button';
        b.tabIndex = -1;
        b.setAttribute('role', 'option');
        b.dataset.r = r;
        b.dataset.i = i;
        b.textContent = w;
        if (r === 0 && fixes.includes(w)) b.className = 'fix';
        // The word a single key takes without moving into the strip.
        if (r === 0 && i === 0 && keysFor('pickFirst').length) b.classList.add('first');
        const direct = (r === 0 && i === 0 && keysFor('pickFirst')[0]) || keysFor(`pick${r * 3 + i + 1}`)[0];
        if (cfg.keyHints && direct) {
            const k = document.createElement('kbd');
            k.textContent = pretty(direct);
            b.append(k);
        }
        b.addEventListener('mousedown', e => { if (e.button === 0) accept(r, i); });
        return b;
    }
    function tag(text, title) {
        const t = document.createElement('span');
        t.className = 'wh-tag';
        t.textContent = text;
        t.title = title;
        return t;
    }
    function show(el, at, start, end, typed, words, fixes, adult = [], explicit = false) {
        if (!words.length && !adult.length) return hide();
        current = { el, node: at.node, start, end, typed, rows: [words, adult] };
        const normal = document.createElement('div');
        normal.className = 'wh-row';
        if (cfg.keyHints) {
            const hint = document.createElement('span');
            hint.className = 'hint';
            hint.setAttribute('aria-hidden', 'true');
            normal.append(hint);
        }
        normal.append(...words.map((w, i) => button(w, 0, i, fixes)));
        if (explicit) normal.append(tag('18+', 'This scene reads as explicit, so explicit words come first. Turn it off in the Writing helper\'s panel ("Notice explicit scenes").'));
        const rows = [];
        if (adult.length) {
            const top = document.createElement('div');
            top.className = 'wh-row adult';
            top.append(tag('18+', 'Explicit words. Turn this row off in the Writing helper\'s panel ("Second row of explicit words").'), ...adult.map((w, i) => button(w, 1, i, fixes)));
            rows.push(top);
        }
        if (words.length) rows.push(normal);
        box.replaceChildren(...rows);
        select(null);
        open(el);
        place(el, true);
    }

    function accept(r, i) {
        if (!current) return false;
        const { el, node, start, end, typed, rows } = current;
        const word = rows[r]?.[i];
        if (!word) return false;
        const text = isValueField(el) ? el.value : node?.data || '';
        // The text moved on since these words came (typed fast, or the page
        // changed it): they would land in the wrong place.
        if (text.slice(start, end) !== typed || cursorText(el)?.caret !== end) {
            hide();
            suggestSoon(el);
            return false;
        }
        const next = text[end] || '';
        // Like a phone keyboard: a space after the word, unless one follows
        // (or a mark that closes it: *smile*, "hello").
        replace(el, node, start, end, word + (/[\s.,!?;:)\]}*_~"”’'…]/.test(next) ? '' : ' '));
        hide();
        suggestSoon(el);
        return true;
    }

    // The word being typed (up to the cursor) and the word before it.
    function context(before) {
        // Not inside {{macros}}, links, or `code`.
        // Only the end of the text goes through the patterns: on a long run
        // without spaces they take seconds.
        const line = before.slice(before.lastIndexOf('\n') + 1);
        const end = line.slice(-300);
        if (before.lastIndexOf('{{') > before.lastIndexOf('}}')) return null;
        if (/\S*:\/\/\S*$/.test(end) || /\bwww\.\S*$/.test(end)) return null;
        if ((before.match(/```/g) || []).length % 2 || ((line.match(/`/g) || []).length % 2)) return null;
        const m = /[\p{L}\p{M}'’]*$/u.exec(before.slice(-(MAX_WORD + 1)));
        if (m[0].length > MAX_WORD) return null;
        const prefix = m[0].replace(/^['’]+/, '');
        const rest = before.slice(Math.max(0, before.length - prefix.length - 200), before.length - prefix.length);
        if (/\d$/.test(rest)) return null;
        const prevM = /([\p{L}\p{M}'’]+)[^\p{L}\p{M}]*$/u.exec(rest);
        // A new sentence or line: the next word starts with a capital.
        const capital = !prefix && !!prevM && /(?:[.!?…]["”’'*_)\]]*\s+|\n\s*)$/.test(rest);
        return { prefix, start: before.length - prefix.length, prev: prevM ? prevM[1] : '', capital };
    }

    // The last messages of the open chat (for noticing an explicit scene),
    // read at most every 2 s.
    let tail = { at: 0, text: '' };
    function chatTail() {
        if (Date.now() - tail.at < 2000) return tail.text;
        const msgs = [...document.querySelectorAll('#chat .mes .mes_text')].slice(-3);
        tail = { at: Date.now(), text: msgs.map(m => m.textContent || '').join('\n').slice(-6000) };
        return tail.text;
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
        // The text before the cursor and the last chat messages: the story's
        // own words get suggested, and an explicit scene is noticed.
        const near = isValueField(el) ? el.value.slice(Math.max(0, at.caret - 1500), at.caret) : at.before.slice(-1500);
        let r = null;
        try { r = await call('suggest', c.prefix, c.prev, near, chatTail()); } catch { /* the add-on was turned off meanwhile */ }
        r ||= { words: [], fixes: 0, adult: [] };
        const now = cursorText(el);
        if (my !== seq || fieldOf(document.activeElement) !== el || !now || now.caret !== at.caret || now.node !== at.node || snapshot(el, now) !== before) return;
        const fixes = r.words.slice(0, r.fixes);
        const form = c.capital ? w => w[0].toUpperCase() + w.slice(1) : w => w;
        show(el, at, c.start, at.caret, c.prefix, r.words.filter(w => w !== c.prefix).map(form), fixes.map(form), (r.adult || []).filter(w => w !== c.prefix).map(form), !!r.explicit);
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
        const m = WORD.exec(before.slice(-(MAX_WORD + 1)));
        if (!m || m[0].length > MAX_WORD) return;
        const word = m[0].replace(/['’]$/, '');
        const start = boundaryAt - m[0].length;
        if (skipped.has(word.toLowerCase())) return;
        if (!context(before.slice(0, start))) return; // macro, link or code
        const prevM = /([\p{L}\p{M}'’]+)([^\p{L}\p{M}]*)$/u.exec(before.slice(Math.max(0, start - 200), start));
        // At the start of a sentence (or the text), a capital letter isn't a name.
        const prev = !prevM || /[.!?]\s*$/.test(prevM[2]) ? '' : prevM[1];
        const value = snapshot(el, at);
        let to = null;
        try { to = await call('correct', word, prev); } catch { return; }
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
    // Checked twice (SillyTavern may clear the box a moment later). The same
    // text is learned again when sent again, just not twice for one send.
    let learnedAt = { text: '', at: 0 };
    function sending() {
        const t = document.getElementById('send_textarea');
        if (!cfg.learnTyping || !t || !t.value.trim()) return;
        const text = t.value;
        const check = () => {
            if (t.value.trim()) return false;
            if (learnedAt.text === text && Date.now() - learnedAt.at < 3000) return true;
            learnedAt = { text, at: Date.now() };
            call('learn', text);
            return true;
        };
        setTimeout(() => { if (!check()) setTimeout(check, 1900); }, 600);
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
        // Closed before the words arrived: they stay away.
        if (!current && bound('close', comboOf(e))) forget();
        // Shift, Ctrl or Alt on their own change nothing (a highlighted word
        // stays highlighted, or Enter would send instead of taking it).
        if (current && isOpen() && !['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock'].includes(e.key)) {
            const combo = comboOf(e);
            const [normal, adult] = current.rows;
            const take = () => { e.preventDefault(); e.stopPropagation(); taken = e.key; };
            if (sel) {
                // A word is highlighted: these keys move or take it.
                const n = current.rows[sel.r].length;
                if (bound('next', combo)) { select({ r: sel.r, i: (sel.i + 1) % n }); return take(); }
                if (bound('prev', combo)) { select({ r: sel.r, i: (sel.i + n - 1) % n }); return take(); }
                if (bound('pick', combo)) { accept(sel.r, sel.i); return take(); }
                // ↑ again: up into the adult row; ↓: down again, then back to the text.
                if (bound('enter', combo) && sel.r === 0 && adult.length) { select({ r: 1, i: Math.min(sel.i, adult.length - 1) }); return take(); }
                if (bound('enter', combo) && sel.r === 1) return take();
                if (bound('leave', combo)) { select(sel.r === 1 && normal.length ? { r: 0, i: Math.min(sel.i, normal.length - 1) } : null); return take(); }
                if (bound('close', combo)) { hide(); return take(); }
                select(null); // any other key: back to typing (the key does its usual thing)
            } else {
                if (bound('enter', combo)) { select(normal.length ? { r: 0, i: 0 } : { r: 1, i: 0 }); return take(); }
                if (bound('pickFirst', combo) && normal.length) { accept(0, 0); return take(); }
                for (let k = 1; k <= 6; k++) {
                    const r = k > 3 ? 1 : 0, i = (k - 1) % 3;
                    if (bound(`pick${k}`, combo) && current.rows[r][i]) { accept(r, i); return take(); }
                }
                if (bound('close', combo)) { hide(); return take(); }
            }
            if (NAV.has(e.key)) hide(); // the cursor moves: new words after the key
        }
        if (e.key === 'Enter' && !e.shiftKey && el.id === 'send_textarea') sending();
    }
    let taken = ''; // a key this add-on used: its keyup must not refresh the words
    function onKeyUp(e) {
        if (taken && e.key === taken) { taken = ''; return; }
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
            if (!now) headCache = null; // it holds a copy of the text
        }, 0);
    }
    const onMouseUp = e => { const el = fieldOf(e.target); if (el) suggestSoon(el); };
    // Only what moves the field matters (not the chat scrolling by behind it).
    const onScroll = e => {
        const moved = e.target;
        if (current && isOpen() && (moved.nodeType !== 1 || moved.contains(current.el))) placeSoon(false);
    };
    // The window's size can change how the text wraps.
    const onResize = () => { if (current && isOpen()) placeSoon(true); };
    const onComposition = () => hide();
    const listeners = [
        [document, 'focusin', onFocusIn], [document, 'input', onInput], [document, 'keydown', onKeyDown], [document, 'keyup', onKeyUp],
        [document, 'click', onClick], [document, 'focusout', onFocusOut], [document, 'mouseup', onMouseUp],
        [document, 'scroll', onScroll], [document, 'compositionstart', onComposition], [window, 'resize', onResize],
        [document, 'pointermove', onPointerMove], [document, 'pointerdown', onPointerDown], [document, 'mousedown', onMouseDownSwallow],
        // 'close' doesn't bubble: caught on its way down.
        [document, 'close', onDialogClose],
    ];
    for (const [t, ev, fn] of listeners) t.addEventListener(ev, fn, true);
    // Pressing anywhere on the strip keeps the focus in the text box; a right
    // click there has nothing to offer.
    strip.addEventListener('mousedown', e => e.preventDefault());
    strip.addEventListener('contextmenu', e => e.preventDefault());

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
            return (/[\p{L}\p{M}'’]*$/u.exec(left.slice(-(MAX_WORD + 1)))[0] + /^[\p{L}\p{M}'’]*/u.exec(right.slice(0, MAX_WORD + 1))[0]).replace(/^['’]+|['’]+$/g, '');
        },
        destroy() {
            for (const [t, ev, fn] of listeners) t.removeEventListener(ev, fn, true);
            cancelAnimationFrame(frame);
            hide();
            unmarkField();
            headCache = null;
            strip.remove();
            mirrorHost?.remove();
            style.remove();
            delete window.__desktopWritingHelper;
        },
    };
    window.__desktopWritingHelper.refresh();
})();
