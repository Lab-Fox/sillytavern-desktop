// Every launcher page and Settings tab in Japanese and Simplified Chinese at
// the smallest window width (820 px) and at 1024 px: nothing leaves its card,
// no sideways scrolling, no script errors, and a few strings added since the
// last release show translated. LANGS=ja,zh-CN by default.
import { launch, check, finish, sleep } from './lib.mjs';

const PAGES = ['home', 'profiles', 'extensions', 'aiapps', 'backups', 'migrate', 'maintenance', 'settings'];
const PANES = ['look', 'start', 'window', 'server', 'phone', 'about'];
const WIDTHS = [820, 1024];
const LANGS = (process.env.LANGS || 'ja,zh-CN').split(',');
// Strings added since 1.8.1, and how each language must show them.
const NEW = { ja: ['アプリのデータ'], 'zh-CN': ['应用数据'], ko: ['앱 데이터'], 'zh-TW': ['應用程式資料'], id: ['Data aplikasi'] };

const probe = `(() => {
    const out = { spill: [], sideways: false, errors: (window.__errs || []).splice(0) };
    const root = document.scrollingElement;
    out.sideways = root.scrollWidth > root.clientWidth + 1;
    const visible = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
    for (const box of document.querySelectorAll('.page.show .card, .page.show .set-group')) {
        if (!visible(box)) continue;
        const right = box.getBoundingClientRect().right;
        for (const e of box.querySelectorAll('*')) {
            if (!visible(e) || e.closest('[hidden]')) continue;
            // Inside something that scrolls or clips on its own: not a spill.
            let p = e.parentElement, clipped = false;
            while (p && p !== box) { const ox = getComputedStyle(p).overflowX; if (ox !== 'visible') { clipped = true; break; } p = p.parentElement; }
            if (clipped) continue;
            const r = e.getBoundingClientRect();
            if (r.right > right + 2) { out.spill.push((e.id ? '#' + e.id : e.tagName.toLowerCase() + '.' + [...e.classList].join('.')) + ' ' + (e.textContent || '').trim().slice(0, 30)); if (out.spill.length > 4) break; }
        }
    }
    return out;
})()`;

for (const language of LANGS) {
    const a = await launch({ name: `pages-${language}`, settings: { language } });
    const L = a.launcher;
    await L.ev(`window.addEventListener('error', e => (window.__errs ||= []).push(String(e.message))); window.addEventListener('unhandledrejection', e => (window.__errs ||= []).push(String(e.reason?.message || e.reason))); 'ok'`);
    // Control: an element too wide for its card must be caught.
    await L.send('Emulation.setDeviceMetricsOverride', { width: 820, height: 560, deviceScaleFactor: 1, mobile: false });
    await L.ev(`(go('home'), (() => { const c = [...document.querySelectorAll('.page.show .card')].find(x => x.getBoundingClientRect().width > 0); const d = document.createElement('div'); d.id = 'pagesLangControl'; d.style.cssText = 'width:1400px;min-width:1400px;max-width:none;flex:none;height:4px'; d.textContent = 'control'; c.append(d); })(), 'ok')`);
    const ctl = await L.ev(probe);
    await L.ev(`(document.querySelector('#pagesLangControl')?.remove(), 'ok')`);
    check(`${language} control: a too-wide element is caught`, ctl.spill.some(x => x.includes('pagesLangControl')), JSON.stringify(ctl));
    for (const width of WIDTHS) {
        await L.send('Emulation.setDeviceMetricsOverride', { width, height: 560, deviceScaleFactor: 1, mobile: false });
        for (const page of PAGES) {
            const views = page === 'settings' ? PANES.map(p => `settings:${p}`) : [page];
            for (const view of views) {
                await L.ev(`(${view.startsWith('settings:') ? `go('settings'), showSetPane('${view.split(':')[1]}')` : `go('${view}')`}, 'ok')`);
                await sleep(250);
                const r = await L.ev(probe);
                check(`${language} ${width} ${view}`, !r.spill.length && !r.sideways && !r.errors.length, r.spill.length || r.sideways || r.errors.length ? JSON.stringify(r) : '');
            }
        }
    }
    await L.ev(`(go('settings'), showSetPane('about'), 'ok')`);
    await sleep(250);
    const text = await L.ev(`document.querySelector('.page.show').innerText`);
    const want = NEW[language] || [];
    check(`${language}: strings added since 1.8.1 show translated`, want.length > 0 && want.every(w => text.includes(w)) && !text.includes('App data'), want.filter(w => !text.includes(w)).join(', ') + (text.includes('App data') ? ' (English "App data" shown)' : ''));
    await a.quit();
}
finish();
