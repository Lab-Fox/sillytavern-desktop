import { pathToFileURL } from 'url';
const { checkCss } = await import(new URL('../../themecss.js', import.meta.url).href);
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; if (!c) console.log('FAIL', n, x); };
const BAD = {
    'import': '@import "x.css";',
    'import url': '@import url(https://a.b/c.css);',
    'escaped import': '@\\69mport "x.css";',
    'charset': '@charset "utf-8"; a{color:red}',
    'namespace': '@namespace url(http://x);',
    'layer': '@layer guard { a { color: red } }',
    'layer statement': '@layer guard;',
    'remote': 'a{background:url(https://evil.example/x.png)}',
    'remote quoted': 'a{background:url("https://evil.example/x.png")}',
    'protocol relative': 'a{background:url(//evil.example/x.png)}',
    'file': 'a{background:url(file:///C:/x.png)}',
    'unc': 'a{background:url("file://host/share/x.png")}',
    'backslash unc': 'a{background:url("\\\\\\\\host\\\\share\\\\x.png")}',
    'absolute drive': 'a{background:url("C:/x.png")}',
    'absolute path': 'a{background:url("/x.png")}',
    'traversal': 'a{background:url(../other/x.png)}',
    'deep traversal': 'a{background:url(assets/../../x.png)}',
    'encoded traversal': 'a{background:url(%2e%2e/x.png)}',
    'escaped url fn': 'a{background:u\\72l(https://evil.example/x.png)}',
    'escaped url fn quoted': 'a{background:\\75 rl("https://evil.example/x.png")}',
    'escaped scheme': 'a{background:url("\\66ile:///C:/x.png")}',
    'custom prop remote': ':root{--a:url(https://evil.example/x.png)} a{background:var(--a)}',
    'custom prop file': ':root{--a:url("file:///C:/x.png")}',
    'custom prop escaped': ':root{--a:u\\72l("file:///C:/x.png")}',
    'custom prop block': ':root{--a:{background:url(file:///C:/x.png)}}',
    'image-set string': 'a{background:image-set("https://evil.example/x.png" 1x)}',
    'image-set url': 'a{background:image-set(url(https://evil.example/x.png) 1x)}',
    'webkit image-set string': 'a{background:-webkit-image-set("x.png" 1x)}',
    'src fn': 'a{background:src("https://evil.example/x.png")}',
    'element': 'a{background:element(#x)}',
    'paint': 'a{background:paint(x)}',
    'cross-fade': 'a{background:cross-fade(url(a.png),url(b.png))}',
    'font face remote': '@font-face{font-family:x;src:url(https://evil.example/f.woff2)}',
    'cursor': 'a{cursor:url(https://evil.example/c.png),auto}',
    'border-image': 'a{border-image:url(file:///C:/x.png) 1}',
    'mask': 'a{mask:url(https://evil.example/m.svg)}',
    'filter': 'a{filter:url(https://evil.example/f.svg#x)}',
    'list-style': 'a{list-style-image:url(https://evil.example/x.png)}',
    'content': 'a::before{content:url(https://evil.example/x.png)}',
    'data html': 'a{background:url("data:text/html,<script>alert(1)</script>")}',
    'javascript': 'a{background:url(javascript:alert(1))}',
    'st-theme other': 'a{background:url(st-theme://other/x.png)}',
    'st-theme own absolute': 'a{background:url(st-theme://mine/../x.png)}',
    'media nested': '@media screen{a{background:url(https://evil.example/x.png)}}',
    'supports nested': '@supports (display:grid){a{background:url(file:///x)}}',
    'nested rule': 'a{b{background:url(https://evil.example/x.png)}}',
    'keyframes': '@keyframes k{from{background:url(https://evil.example/x.png)}}',
    'app region': 'a{-webkit-app-region:drag}',
    'app region escaped': 'a{-webkit-\\61pp-region:drag}',
    'brace escape': 'a{color:red}} body{background:url(https://evil.example/x.png)}',
    'stray close': '} } :root{--x:1}',
    'unclosed': 'a{color:red',
    'unclosed fn': 'a{width:calc(1px',
    'unclosed comment': 'a{color:red} /* nope',
    'bad url': 'a{background:url(a b.png)}',
    'bad string': 'a{content:"x\n"}',
    'garbage raw': 'a{b:c(url(https://evil.example/x.png)}',
    'uppercase URL': 'a{background:URL(https://evil.example/x.png)}',
    'uppercase IMPORT': '@IMPORT "x";',
    'selector url': 'a[href=url(https://x)]{color:red}',
    'space scheme': 'a{background:url(" https://evil.example/x.png")}',
    'tab in scheme': 'a{background:url("ht\ttps://evil.example/x.png")}',
    'null': 'a{background:url("a\u0000b.png")}',
};
for (const [n, css] of Object.entries(BAD)) {
    const r = await checkCss(css, 'mine');
    // an unparsable rule may be dropped by the rebuild: then nothing bad may survive
    const clean = !r.errors.length && !/evil|file:|url\(/i.test(r.css.replace(/url\("?st-theme:\/\/mine\/[^)]*\)/g, ''));
    ok(n, r.errors.length > 0 || clean, JSON.stringify(r).slice(0, 200));
    if (!r.errors.length) console.log('  passed through:', n, JSON.stringify(r.css).slice(0, 110));
}
const GOOD = `
:root { --btn-radius: 12px; --card-bg: linear-gradient(135deg, #123, #456); --shadow-card: 0 2px 4px rgb(0 0 0 / .4); --hero-bg: url(assets/hero.png) center/cover, var(--panel); }
html[data-server="running"] .brand img { animation: wake 1s steps(4) infinite; }
html[data-time="night"] [data-part="sidebar"] { background: url("assets/night sky.png"); }
.btn:hover:not(:disabled) { transform: translateY(-1px) rotate(.5deg); }
.card:has(.btn.primary) > h2::after { content: "★"; color: color-mix(in srgb, var(--accent) 50%, white); }
.x { width: calc(100% - clamp(10px, 2vw, 40px)); inset: 0 auto auto 0; aspect-ratio: 16 / 9; }
.y { background: image-set(url(a.png) 1x, url(./b.png) 2x); border-image: url(frame.png) 8 fill / 8px stretch; cursor: url(c.png) 2 2, pointer; mask: url(m.svg) no-repeat; }
.z { background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E"); }
@font-face { font-family: "My Font"; src: url(fonts/m.woff2) format("woff2"), local("Arial"); font-display: swap; }
@keyframes wake { from { opacity: .5 } to { opacity: 1; transform: scale(1.1) } }
@media (prefers-reduced-motion: reduce) { * { animation: none !important; } }
@media (max-width: 900px) and (min-height: 300px) { aside { width: 180px; } }
@supports (backdrop-filter: blur(4px)) { .card { backdrop-filter: blur(4px); } }
@container (max-width: 520px) { .set-row { flex-wrap: wrap; } }
@property --spin { syntax: "<angle>"; inherits: false; initial-value: 0deg; }
.nest { color: red; &:hover { color: blue; } .kid & { color: green; } }
a { color: oklch(70% .1 200); margin: -1px; grid-template-areas: "a b" "c d"; font: italic 14px/1.2 "Segoe UI", serif; transition: all .1s cubic-bezier(.2,.8,.2,1); }
`;
const r = await checkCss(GOOD, 'mine');
ok('good css passes', !r.errors.length, JSON.stringify(r.errors));
for (const need of ['st-theme://mine/assets/hero.png', 'st-theme://mine/assets/night%20sky.png', 'st-theme://mine/fonts/m.woff2', 'st-theme://mine/b.png', '@layer theme', '@keyframes wake', '@container', ':has(', 'color-mix', 'oklch(', '★', 'data:image/svg+xml']) ok('kept ' + need, r.css.includes(need), r.css.slice(0, 300));
const e = await checkCss('a { color: red; }\n\nb { background: url(https://x/y.png); }', 'mine');
ok('error says the line', e.errors[0]?.line === 3, JSON.stringify(e.errors));
ok('empty is fine', !(await checkCss('  ', 'mine')).errors.length);
ok('too large', (await checkCss('a{color:red}'.repeat(50000), 'mine')).errors.length > 0);
const t0 = performance.now(); await checkCss(GOOD.repeat(120), 'mine'); console.log('~' + Math.round(GOOD.length * 120 / 1024) + ' KB checked in', Math.round(performance.now() - t0), 'ms');
console.log(`${pass}/${pass + fail} passed`);
