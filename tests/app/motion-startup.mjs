// Settings → Theme animations is followed from the first moment, not only
// after the window's focus changes (today renderStatus's data-server change
// re-runs updateMotion once the settings are in). Uses the example theme "Tavern night"
// (a GIF lantern). Set ST_RUNS.
import fs from 'fs';
import path from 'path';
import { launch, check, finish, sleep } from './lib.mjs';

const look = L => L.ev(`await (async () => {
  await new Promise(r => setTimeout(r, 1500));
  const g = document.querySelector('[data-layer="lantern"]');
  return { motion: rootState.motion, lantern: g?.tagName || null };
})()`);

// Install the example themes and pick Tavern night.
let a = await launch({ name: 'motion-startup', settings: { language: 'en' } });
await a.main.ev(`const { dialog } = require('electron'); dialog.showMessageBox = async () => ({ response: 0 }); 1`);
const id = await a.launcher.ev(`await (async () => { await D.themeExamples(); const l = await D.listThemes(); const t = l.themes.find(t => /tavern-night/.test(t.id)); await D.setTheme(t.id); return t.id; })()`);
check('example theme picked', !!id, id);
await a.quit();

const file = path.join(a.data, 'settings.json');
const set = v => fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), ...v }));

for (const [mode, motion, lantern] of [['on', 'on', 'IMG'], ['off', 'off', 'CANVAS']]) {
    set({ themeAnimations: mode });
    a = await launch({ name: 'motion-startup', keep: true });
    // No focus change from here on: the page is left alone.
    const m = await look(a.launcher);
    check(`started with "${mode}": motion ${motion}`, m.motion === motion, JSON.stringify(m));
    check(`started with "${mode}": lantern is ${lantern}`, m.lantern === lantern, JSON.stringify(m));
    await a.quit();
    await sleep(1000);
}
finish();
