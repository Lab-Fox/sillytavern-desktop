// Page titles are never cut off and nothing leaves the header.
import { launch, check, finish, sleep } from './lib.mjs';

const PAGES = ['home', 'profiles', 'extensions', 'aiapps', 'backups', 'migrate', 'maintenance', 'settings'];
const WIDTHS = [1024, 820];
const LONG = 'A very long profile name that goes on and on';

async function run(language, zoom = 100) {
    const a = await launch({ name: `header-${language}-${zoom}`, settings: { language, uiZoom: zoom } });
    const L = a.launcher;
    await L.ev(`document.querySelector('#hdrProfile').innerHTML = '<option>${LONG}</option>'; 'ok'`);
    for (const width of WIDTHS) {
        // Zoom scales the app's minimum window size too (fitLauncherToZoom).
        await L.send('Emulation.setDeviceMetricsOverride', { width: Math.round(width * zoom / 100), height: 700, deviceScaleFactor: 1, mobile: false });
        for (const page of PAGES) {
            await L.ev(`go('${page}'); 'ok'`);
            await sleep(60);
            const r = await L.ev(`(() => {
                const h = document.querySelector('#pageTitle'), box = document.querySelector('header');
                const pick = document.querySelector('.hdr-profile').getBoundingClientRect();
                return { title: h.textContent, cut: h.scrollWidth > h.clientWidth, spill: box.scrollWidth > box.clientWidth, pick: Math.round(pick.width) };
            })()`);
            check(`${language} ${zoom}% ${width} ${page}`, !r.cut && !r.spill && r.pick >= 60, r.cut || r.spill || r.pick < 60 ? JSON.stringify(r) : '');
        }
    }
    await a.quit();
}
for (const language of ['en', 'ja', 'ko', 'id', 'zh-CN', 'zh-TW']) await run(language);
await run('en', 150);
finish();
