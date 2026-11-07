// Theme Studio and the creator tools. node t7.mjs <exe> <app|-> <userData> <clone> <workDir>
import { spawn } from 'child_process';
import { createRequire } from 'module';
import zlib from 'zlib';
import fs from 'fs';
import path from 'path';
const require = createRequire(new URL('../../package.json', import.meta.url));
const [exe, app, ud, clone, work] = process.argv.slice(2);
const sleep = ms => new Promise(r => setTimeout(r, ms));
let port = 24000 + Math.floor(Math.random() * 500);
const res = []; const check = (n, ok, x = '') => { res.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x !== '' ? '  -> ' + String(x).slice(0, 180) : ''}`); };
fs.rmSync(ud, { recursive: true, force: true }); fs.mkdirSync(ud, { recursive: true });
fs.rmSync(work, { recursive: true, force: true }); fs.mkdirSync(work, { recursive: true });
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ sillytavernPath: clone, port: 8123, host: 'localhost', autoStart: false, checkUpdatesOnLaunch: false, checkAppUpdates: false, theme: 'fox', confirmBeforeQuit: false, language: 'en' }));
fs.mkdirSync(path.join(ud, 'themes'), { recursive: true });
fs.writeFileSync(path.join(ud, 'themes', 'old-style.json'), JSON.stringify({ format: 1, name: 'Old Style', author: 'A', colors: { bg: '#101010', panel: '#202020', border: '#404040', accent: '#ff8800', text: '#dddddd', title: '#ffffff', muted: '#999999' }, logo: 'fox' }));
const png = fs.readFileSync(new URL('../../docs/images/banner.png', import.meta.url));
const P = n => path.join(work, n);
fs.writeFileSync(P('wall.png'), png); fs.writeFileSync(P('pic one.png'), png); fs.writeFileSync(P('pic2.png'), png); fs.writeFileSync(P('fake.png'), 'not a picture, really not one'); fs.writeFileSync(P('evil.html'), '<script>1</script>');
fs.copyFileSync(new URL('../../fonts/departure-mono-400.woff2', import.meta.url), P('font.woff2'));
async function ws(url) {
    const s = new WebSocket(url); await new Promise(r => { s.onopen = r; });
    let id = 0; const w = new Map(), events = [];
    s.onmessage = m => { const d = JSON.parse(m.data); if (d.id) w.get(d.id)?.(d); else events.push(d); };
    const send = (method, params = {}) => new Promise((r, j) => { const i = ++id; w.set(i, r); s.send(JSON.stringify({ id: i, method, params })); setTimeout(() => j(new Error('timeout ' + method + ' ' + String(params.expression).slice(0, 70))), 30000); });
    const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true, userGesture: true, replMode: true, includeCommandLineAPI: true }); if (r.result.exceptionDetails) throw new Error(e.slice(0, 80) + ' => ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300)); return r.result.result.value; };
    return { send, ev, events };
}
async function launch(args = []) {
    port += 2; const Q = port;
    spawn(exe, [...(app === '-' ? [] : [app]), `--user-data-dir=${ud}`, `--remote-debugging-port=${Q}`, `--inspect=${Q + 1}`, ...args], { stdio: 'ignore' });
    let page; for (let i = 0; i < 60 && !page; i++) { await sleep(500); try { page = (await (await fetch(`http://127.0.0.1:${Q}/json/list`)).json()).find(x => x.url.endsWith('launcher.html')); } catch { /* starting */ } }
    await sleep(3500);
    const L = await ws(page.webSocketDebuggerUrl);
    await L.send('Runtime.enable'); await L.send('Log.enable');
    const M = await ws((await (await fetch(`http://127.0.0.1:${Q + 1}/json/list`)).json())[0].webSocketDebuggerUrl);
    await M.ev(`const { BrowserWindow, dialog, app: a0, shell, clipboard } = require('electron'); globalThis.W = BrowserWindow.getAllWindows()[0]; globalThis.A = a0; globalThis.CB = clipboard; globalThis.__opened = []; shell.openPath = async p => { __opened.push(p); return ''; }; dialog.showMessageBox = async () => ({ response: 0 }); globalThis.__pick = ''; dialog.showOpenDialog = async () => (__pick ? { canceled: false, filePaths: [__pick] } : { canceled: true, filePaths: [] }); globalThis.__save = ''; dialog.showSaveDialog = async () => ({ filePath: __save }); W.show(); W.moveTop(); 1`);
    return { L, M };
}
const quit = async a => { a.M.ev(`setTimeout(() => A.exit(0), 100); 1`).catch(() => {}); await sleep(2500); };
const settings = () => JSON.parse(fs.readFileSync(path.join(ud, 'settings.json'), 'utf8'));
const pkgDir = n => path.join(ud, 'themes', 'packages', n);
let a = await launch();
const ev = e => a.L.ev(e);
const pick = f => a.M.ev(`__pick = ${JSON.stringify(f)}; 1`);
await ev(`go('settings'); showSetPane('look'); 1`); await sleep(400);

// a new theme
await ev(`$('btnNewTheme').click(); 1`); await sleep(500);
check('editor open, draft made', await ev(`!$('themeEditor').hidden`) && fs.existsSync(pkgDir('studio-draft')));
check('starts as pixel', await ev(`document.querySelector('#stPreset button.on')?.dataset.preset`) === 'pixel');
await ev(`document.querySelector('[data-preset="rounded"]').click(); 1`); await sleep(300);
check('preset previews', await ev(`getComputedStyle(document.querySelector('.card, .set-group')).borderTopLeftRadius`) === '8px');
check('preset marked', await ev(`document.querySelector('#stPreset button.on')?.dataset.preset`) === 'rounded');
await ev(`(() => { const e = $('stRadius'); e.value = 16; e.oninput(); })(); 1`); await sleep(300);
check('slider previews', await ev(`getComputedStyle(document.querySelector('.set-group')).borderTopLeftRadius`) === '16px');
check('nothing saved yet', settings().theme === 'fox');
await ev(`(() => { const e = $('stShadow'); e.value = 'none'; e.oninput(); })(); 1`); await sleep(250);
check('shadow previews', await ev(`getComputedStyle(document.querySelector('.set-group')).boxShadow`) === 'none');
await ev(`(() => { const e = $('stFont'); e.value = 'segoe'; e.oninput(); })(); 1`); await sleep(250);
check('font previews', (await ev(`getComputedStyle(document.body).fontFamily`)).includes('Segoe UI'));
await ev(`(() => { const e = document.querySelector('[data-color="accent"]'); e.value = '#00ff88'; e.oninput(); })(); 1`); await sleep(250);
check('color previews', await ev(`getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()`) === '#00ff88');
// files
await pick(P('wall.png')); await ev(`$('btnStWall').click(); 1`); await sleep(500);
const wall = await ev(`(() => { const e = document.querySelector('[data-layer="wallpaper"]'); return e ? { src: e.src, w: e.naturalWidth } : null; })()`);
check('wallpaper previews', wall?.src.startsWith('st-theme://studio-draft/assets/wall.png') && wall.w === 1280, JSON.stringify(wall));
await ev(`(() => { const e = $('stGlass'); e.value = 40; e.oninput(); })(); 1`); await sleep(300);
check('see-through previews', (await ev(`getComputedStyle(document.querySelector('.set-group')).backgroundColor`)).includes('/ 0.6') || (await ev(`getComputedStyle(document.querySelector('.set-group')).backgroundColor`)).includes('0.6'), await ev(`getComputedStyle(document.querySelector('.set-group')).backgroundColor`));
await pick(P('pic one.png')); await ev(`$('btnStAdd').click(); 1`); await sleep(400);
await pick(P('pic2.png')); await ev(`$('btnStAdd').click(); 1`); await sleep(400);
check('two pictures', await ev(`document.querySelectorAll('.layer').length`) === 3 && await ev(`document.querySelectorAll('.st-layer').length`) === 2);
await ev(`(() => { const r = document.querySelectorAll('.st-layer')[0]; const s = r.querySelector('[data-k=slot]'); s.value = 'sidebar'; s.oninput(); const k = r.querySelector('[data-k=anchor]'); k.value = 'top-right'; k.oninput(); const w = r.querySelector('[data-k=width]'); w.value = 50; w.oninput(); })(); 1`); await sleep(350);
const lay = await ev(`(() => { const e = document.querySelector('[data-layer="picture-1"]'), a = document.querySelector('aside').getBoundingClientRect(), r = e.getBoundingClientRect(); return { inside: e.closest('aside') !== null, ratio: r.width / a.width, right: Math.round(a.right - r.right) }; })()`);
check('picture moves and resizes', lay.inside && Math.abs(lay.ratio - 0.5) < 0.03, JSON.stringify(lay));
await ev(`document.querySelectorAll('.st-layer')[1].querySelector('[data-remove]').click(); 1`); await sleep(350);
check('picture removed', await ev(`document.querySelectorAll('.st-layer').length`) === 1 && !(await ev(`!!document.querySelector('[data-layer="picture-2"]')`)));
await pick(P('fake.png')); await ev(`$('btnStAdd').click(); 1`); await sleep(350);
check('fake picture refused', (await ev(`$('themeError').textContent`)).includes("isn't what its name says"), await ev(`$('themeError').textContent`));
await pick(P('evil.html')); await ev(`$('btnStAdd').click(); 1`); await sleep(350);
check('HTML refused', (await ev(`$('themeError').textContent`)).length > 0, await ev(`$('themeError').textContent`));
await pick(P('font.woff2')); await ev(`$('btnStFont').click(); 1`); await sleep(600);
check('font file applied', await ev(`await (async () => { await document.fonts.load('16px "Theme Font"'); return document.fonts.check('16px "Theme Font"') && getComputedStyle(document.body).fontFamily.includes('Theme Font'); })()`));
// layout
await a.L.send('Emulation.setDeviceMetricsOverride', { width: 820, height: 560, deviceScaleFactor: 1, mobile: false }); await sleep(300);
check('fits at 820', await ev(`(() => { const p = document.querySelector('.page.show'); return p.scrollWidth <= p.clientWidth && $('themeEditor').scrollWidth <= $('themeEditor').clientWidth + 1; })()`));
await a.L.send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 720, deviceScaleFactor: 1, mobile: false });
await ev(`$('console').innerHTML = ''; $('btnSaveTheme').scrollIntoView({ block: 'end' }); 1`); await sleep(400);
fs.writeFileSync(P('studio.png'), Buffer.from((await a.L.send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
await a.L.send('Emulation.clearDeviceMetricsOverride');
// cancel
await ev(`$('btnCancelTheme').click(); 1`); await sleep(500);
check('cancel restores everything', await ev(`getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()`) === '#f28c38' && !(await ev(`document.querySelector('.layer') || $('themeCss').textContent`)), await ev(`getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()`));
check('draft gone', !fs.existsSync(pkgDir('studio-draft')));
// again, and save
await ev(`$('btnNewTheme').click(); 1`); await sleep(500);
await ev(`$('themeName').value = 'Studio One'; document.querySelector('[data-preset="pill"]').click(); 1`); await sleep(250);
await pick(P('wall.png')); await ev(`$('btnStWall').click(); 1`); await sleep(400);
await pick(P('pic one.png')); await ev(`$('btnStAdd').click(); 1`); await sleep(400);
await pick(P('pic2.png')); await ev(`$('btnStAdd').click(); 1`); await sleep(400);
await ev(`document.querySelectorAll('.st-layer')[1].querySelector('[data-remove]').click(); 1`); await sleep(300);
await ev(`$('btnSaveTheme').click(); 1`); await sleep(900);
check('saved as a package', settings().theme === 'pkg:studio-one' && fs.existsSync(pkgDir('studio-one') + '/theme.json'), settings().theme);
check('no keep question for your own theme', settings().themesKept.some(k => k.startsWith('pkg:studio-one:')));
check('dropped picture not shipped', fs.readdirSync(pkgDir('studio-one') + '/assets').sort().join() === 'pic-one.png,wall.png', fs.readdirSync(pkgDir('studio-one') + '/assets').join());
check('editor closed, draft used up', await ev(`$('themeEditor').hidden`) && !fs.existsSync(pkgDir('studio-draft')));
check('applied', await ev(`getComputedStyle(document.querySelector('.btn')).borderTopLeftRadius`) === '999px' && (await ev(`document.querySelector('[data-layer="wallpaper"]').src`)).startsWith('st-theme://studio-one/'));
// edit it again
await ev(`document.querySelector('[data-edit="pkg:studio-one"]').click(); 1`); await sleep(600);
check('edit: values back', await ev(`$('stPill').checked && $('stRadius').value === '12' && $('stWallName').textContent === 'wall.png' && document.querySelectorAll('.st-layer').length === 1`));
await ev(`$('btnStWallOff').click(); 1`); await sleep(300);
await ev(`(() => { const e = $('stRadius'); e.value = 4; e.oninput(); })(); 1`); await sleep(300);
await ev(`$('themeName').value = 'Studio One Renamed'; $('btnSaveTheme').click(); 1`); await sleep(900);
const edited = JSON.parse(fs.readFileSync(pkgDir('studio-one') + '/theme.json', 'utf8'));
check('edit saves over itself', edited.name === 'Studio One Renamed' && !edited.wallpaper && edited.studio.radius === 4 && !fs.existsSync(pkgDir('studio-one') + '/assets/wall.png'), JSON.stringify(edited.studio).slice(0, 100));
check('still active', settings().theme === 'pkg:studio-one');
// old JSON theme
await ev(`document.querySelector('[data-edit="custom:old-style"]').click(); 1`); await sleep(500);
await ev(`document.querySelector('[data-preset="soft"]').click(); $('btnSaveTheme').click(); 1`); await sleep(900);
check('old theme becomes a package', settings().theme === 'pkg:old-style' && !fs.existsSync(path.join(ud, 'themes', 'old-style.json')), settings().theme);
// customizing a built-in
await ev(`document.querySelector('[data-copy="sillytavern"]').click(); 1`); await sleep(500);
await ev(`$('themeName').value = 'Colors Only'; $('btnSaveTheme').click(); 1`); await sleep(900);
check('only colors: no CSS file', settings().theme === 'pkg:colors-only' && !fs.existsSync(pkgDir('colors-only') + '/theme.css'));
// uploaded logo
await ev(`document.querySelector('[data-edit="pkg:colors-only"]').click(); 1`); await sleep(500);
await ev(`editing.theme.logo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='; $('btnSaveTheme').click(); 1`); await sleep(900);
check('uploaded logo kept in the theme', fs.existsSync(pkgDir('colors-only') + '/assets/logo.png'));
// shares like any theme
await a.M.ev(`__save = ${JSON.stringify(P('shared.sttheme'))}; 1`);
await ev(`await D.setTheme('pkg:studio-one'); await D.exportTheme('pkg:studio-one'); 1`); await sleep(500);
await ev(`await D.deleteTheme('pkg:studio-one'); 1`); await sleep(400);
const ri = await ev(`await D.installTheme(${JSON.stringify(P('shared.sttheme'))})`); await sleep(700);
check('export and install again', ri?.ok, JSON.stringify(ri));
check('still has its picture', await ev(`(document.querySelector('[data-layer="picture-1"]')?.src || '').includes('pic-one')`));
// crash leftover
fs.mkdirSync(pkgDir('studio-draft'), { recursive: true }); fs.writeFileSync(pkgDir('studio-draft') + '/theme.json', '{}');
await quit(a);
a = await launch();
check('leftover draft cleared at start', !fs.existsSync(pkgDir('studio-draft')));
check('draft never listed', !(await ev(`(await D.listThemes()).themes.some(t => t.id.includes('draft'))`)));

// starter
await ev(`go('settings'); showSetPane('look'); 1`); await sleep(300);
await ev(`await D.themeStarter(); 1`); await sleep(800);
check('starter active', settings().theme === 'pkg:my-theme', settings().theme);
check('starter folder opened', (await a.M.ev(`__opened.at(-1) || ''`)).endsWith('my-theme'));
check('starter CSS loads', await ev(`$('themeCss').textContent.includes('badge-float')`));
const star = await ev(`await D.themeCheck('pkg:my-theme')`);
check('starter passes its own check', star.every(r => r.level === 'ok') , JSON.stringify(star));
check('starter options', await ev(`document.documentElement.style.getPropertyValue('--opt-corners')`) === '6px' && await ev(`!document.querySelector('[data-layer="badge"]').hidden`));
// live reload
await ev(`$('setThemeWatch').checked = true; $('setThemeWatch').onchange(); 1`); await sleep(400);
const css = pkgDir('my-theme') + '/theme.css', orig = fs.readFileSync(css, 'utf8');
fs.writeFileSync(css, orig + '\n[data-part="sidebar"] { outline: 3px solid rgb(9, 9, 9); }'); await sleep(900);
check('save shows at once', await ev(`getComputedStyle(document.querySelector('[data-part=sidebar]')).outlineColor`) === 'rgb(9, 9, 9)');
fs.writeFileSync(css, orig + '\n.x { background: url(https://evil.example/x.png); }'); await sleep(900);
check('bad CSS: left out, reason shown', !(await ev(`$('themeCss').textContent`)) && (await ev(`$('themeCssErrors').textContent`)).includes('line'), await ev(`$('themeCssErrors').textContent`));
fs.writeFileSync(css, orig); await sleep(900);
check('fixed: back, error gone', (await ev(`$('themeCss').textContent`)).includes('badge-float') && await ev(`$('themeCssErrors').hidden`));
const tj = pkgDir('my-theme') + '/theme.json', mj = JSON.parse(fs.readFileSync(tj, 'utf8')); mj.colors.accent = '#ff0000'; mj.layers[0].width = '40%';
fs.writeFileSync(tj, JSON.stringify(mj)); await sleep(900);
check('theme.json changes show too', await ev(`getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()`) === '#ff0000' && await ev(`document.querySelector('[data-layer="badge"]').style.width`) === '40%');
await ev(`$('setThemeWatch').checked = false; $('setThemeWatch').onchange(); 1`); await sleep(300);
fs.writeFileSync(css, orig + '\n[data-part="sidebar"] { outline: 3px solid rgb(8, 8, 8); }'); await sleep(900);
check('watch off: no reload', await ev(`getComputedStyle(document.querySelector('[data-part=sidebar]')).outlineColor`) !== 'rgb(8, 8, 8)');
// deleting the watched theme must not take the app down
await ev(`$('setThemeWatch').checked = true; $('setThemeWatch').onchange(); 1`); await sleep(300);
await ev(`await D.installTheme(${JSON.stringify(P('shared.sttheme'))}); await D.deleteTheme('pkg:studio-one'); 1`); await sleep(700);
check('watched theme deleted: app alive', (await ev(`1 + 1`)) === 2 && !fs.existsSync(pkgDir('studio-one')));
await ev(`await D.setTheme('pkg:my-theme'); 1`); await sleep(400);
fs.writeFileSync(css, orig + '\n[data-part="sidebar"] { outline: 3px solid rgb(7, 7, 7); }'); await sleep(900);
check('watching again after that', await ev(`getComputedStyle(document.querySelector('[data-part=sidebar]')).outlineColor`) === 'rgb(7, 7, 7)');
await ev(`$('setThemeWatch').checked = false; $('setThemeWatch').onchange(); 1`); await sleep(300);
// ids from the page
for (const bad of ['pkg:..', 'pkg:../..', 'pkg:..\\\\..', 'pkg:C:/Windows', 'pkg:.old-x']) {
  const before = fs.readdirSync(path.join(ud, 'themes', 'packages')).length;
  await ev(`await D.studioOpen(${JSON.stringify(bad)}); 1`);
  check('bad id opens nothing: ' + bad, fs.readdirSync(pkgDir('studio-draft')).join() === 'assets');
  const r2 = await ev(`await D.studioSave({ name: 'X', colors: (await D.listThemes()).themes[0].colors, logo: 'st', studio: {} }, ${JSON.stringify(bad)})`);
  check('bad id saves nothing: ' + bad, r2?.error, JSON.stringify(r2));
  await ev(`await D.studioClose(); await D.themeFolder(${JSON.stringify(bad)}); 1`);
}
await ev(`await D.studioOpen(null); 1`);
{ const r3 = await ev(`await D.studioSave({ name: 'Bad Logo', colors: (await D.listThemes()).themes[0].colors, logo: 'data:image/png;base64,' + btoa('this is not a png at all'), studio: {} }, null)`); check('fake logo refused', r3?.error, JSON.stringify(r3)); }
await ev(`await D.studioClose(); 1`);
// leftovers of an interrupted save
fs.mkdirSync(pkgDir('.old-abc'), { recursive: true }); fs.mkdirSync(pkgDir('.partial-abc'), { recursive: true });
// check
fs.writeFileSync(css, `.secret-class { color: var(--no-such-thing); } :root { --body-font: "X"; }`);
fs.writeFileSync(pkgDir('my-theme') + '/assets/unused.png', png);
mj.colors.muted = '#2a2f3a'; mj.colors.text = '#343a45'; fs.writeFileSync(tj, JSON.stringify(mj));
const issues = await ev(`await D.themeCheck('pkg:my-theme')`);
const has = s => issues.some(i => i.text.includes(s));
check('check: hard to read', issues.some(i => i.level === 'bad' && i.text.includes('very hard to read')), JSON.stringify(issues).slice(0, 170));
check('check: unknown setting', has('--no-such-thing')); check('check: risky class', has('.secret-class')); check('check: font fallback', has('lang-fonts')); check('check: unused file', has('unused.png'));
await ev(`$('btnThemeCheck').click(); 1`); await sleep(400);
check('check shows in the page', await ev(`$('themeCheckList').children.length`) >= 4);
fs.writeFileSync(css, orig);
// inspector
await ev(`$('btnThemeParts').click(); 1`); await sleep(300);
const insp = await ev(`await (async () => { const b = document.querySelector('header h1').getBoundingClientRect(); document.dispatchEvent(new MouseEvent('mousemove', { clientX: b.x + 5, clientY: b.y + 5, bubbles: true })); await new Promise(r => setTimeout(r, 80)); const one = $('partTip').textContent; const c = document.querySelector('nav button').getBoundingClientRect(); document.dispatchEvent(new MouseEvent('mousemove', { clientX: c.x + 5, clientY: c.y + 5, bubbles: true })); await new Promise(r => setTimeout(r, 80)); return { one, two: $('partTip').textContent, box: $('partBox').offsetWidth }; })()`);
check('inspector names parts', insp.one.includes('page-title') && insp.two.includes('nav-item') && insp.box > 50, JSON.stringify(insp));
await ev(`document.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); 1`); await sleep(250);
check('click copies, then stops', (await a.M.ev(`CB.readText()`)) === '[data-part="nav-item"]' && !(await ev(`!!$('partBox')`)), await a.M.ev(`CB.readText()`));
await ev(`$('btnThemeParts').click(); 1`); await sleep(200);
await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); 1`); await sleep(200);
check('Esc stops', !(await ev(`!!$('partBox')`)));
// guide
const guide = fs.readFileSync(new URL('../../docs/THEMES.md', import.meta.url), 'utf8');
const T = fs.readFileSync(new URL('../../themes.js', import.meta.url), 'utf8');
const listOf = n => [...new RegExp(`export const ${n} = \\[([\\s\\S]*?)\\];`).exec(T)[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
const miss = [...listOf('TOKENS').map(k => `--${k}`), ...listOf('PARTS').map(k => `\`${k}\``), ...listOf('CLASSES').filter(c => !['primary', 'ghost', 'danger', 'sm'].includes(c)).map(k => `.${k}`)].filter(k => !guide.includes(k));
check('guide covers the whole contract', !miss.length, miss.join(' '));
const errs = a.L.events.filter(e => e.method === 'Runtime.exceptionThrown' || (e.method === 'Log.entryAdded' && e.params.entry.level === 'error'));
check('no page errors', !errs.length, JSON.stringify(errs.map(e => (e.params.entry?.text || e.params.exceptionDetails?.exception?.description || '').slice(0, 140))));
await quit(a);
a = await launch();
check('interrupted leftovers cleared', !fs.existsSync(pkgDir('.old-abc')) && !fs.existsSync(pkgDir('.partial-abc')));
console.log(`\n${res.filter(Boolean).length}/${res.length} passed`);
await quit(a);
process.exit(0);
