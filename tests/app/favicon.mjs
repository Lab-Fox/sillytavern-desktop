// The tab's icon shows in the top bar: over plain http, over the app's HTTPS,
// from another site, and never when it is too big or isn't a picture.
import http from 'http';
import { launch, check, finish, sleep } from './lib.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const OTHER = 20124;

async function run(name, settings, otherSites = false) {
    const a = await launch({ name: `favicon-${name}`, settings });
    await a.launcher.ev(`await D.startServer(); 'ok'`);
    const bar = await a.page('stbar.html');
    const look = () => bar.ev(`(() => { const i = document.querySelector('#tabs img, .tab img'); return i ? { hidden: i.hidden, w: i.naturalWidth, src: i.getAttribute('src') || '' } : null; })()`);
    const until = async test => { let v; for (let i = 0; i < 90; i++) { v = await look(); if (v && test(v)) break; await sleep(1000); } return v; };
    const first = await until(v => !v.hidden && v.w > 0);
    check(`${name}: icon drawn`, first && !first.hidden && first.w > 0, first?.src.slice(0, 22));

    if (otherSites) {
        const server = http.createServer((q, r) => {
            if (q.url === '/ok.png') { r.writeHead(200, { 'content-type': 'image/png', 'content-length': PNG.length }); r.end(PNG); }
            else if (q.url === '/big.png') { r.writeHead(200, { 'content-type': 'image/png', 'content-length': 200000 }); r.end(Buffer.alloc(200000)); }
            else { r.writeHead(200, { 'content-type': 'text/html' }); r.end('<p>not a picture</p>'); }
        }).listen(OTHER, '127.0.0.1');
        const P = await a.page('localhost:8123/');
        const setIcon = file => P.ev(`document.querySelectorAll('link[rel~=icon]').forEach(l => l.remove());
            const l = document.createElement('link'); l.rel = 'icon'; l.href = 'http://127.0.0.1:${OTHER}/${file}'; document.head.append(l); 'ok'`);
        await setIcon('ok.png');
        const ok = await until(v => v.w === 1);
        check('another site: icon drawn', ok.w === 1 && ok.src.startsWith('data:image/png'), ok.src.slice(0, 22));
        await setIcon('big.png');
        const big = await until(v => v.hidden);
        check('too big: no icon', big.hidden);
        await setIcon('ok.png');
        await until(v => v.w === 1);
        await setIcon('page.html');
        const page = await until(v => v.hidden);
        check('not a picture: no icon', page.hidden);
        P.close();
        server.close();
    }
    bar.close();
    await a.quit();
}
await run('http', {}, !process.env.ST_HTTP_ONLY);
// ST_HTTP_ONLY: for a run on a real install, which should change as little as possible.
if (!process.env.ST_HTTP_ONLY) await run('https', { https: true });
finish();
