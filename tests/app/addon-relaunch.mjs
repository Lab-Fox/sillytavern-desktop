// An add-on's api.app.relaunch() restarts the app with the same data and switches.
// A built portable (ST_EXE + ST_PORTABLE=1) checks the restart goes through the
// portable exe. Set ST_RUNS.
import fs from 'fs';
import path from 'path';
import { launch, check, finish, sleep } from './lib.mjs';

const ID = 'relaunch-test';
let a = await launch({ name: 'addon-relaunch', settings: { desktopExtensions: { [ID]: true } }, args: ['--safe-theme'] });
// The add-on goes into this run's data folder; a reload of the extension list finds it.
const dir = path.join(a.data, 'extensions', ID);
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ name: 'Relaunch test', version: '1.0.0', main: 'main.cjs' }));
fs.writeFileSync(path.join(dir, 'main.cjs'), `module.exports = { activate(api) { api.handle('go', () => { setTimeout(() => api.app.relaunch(), 200); return 'ok'; }); } };`);
await a.quit();
await sleep(1000);

// From source, a switch in front of the app folder (`electron --x . …`) must not lose the app.
a = await launch({ name: 'addon-relaunch', keep: true, ...(process.env.ST_EXE ? { args: ['--safe-theme'] } : { before: ['--safe-theme'] }) });
const before = await a.main.ev(`process.pid`);
const exe = await a.main.ev(`process.execPath`);
check('add-on is on', await a.launcher.ev(`(await D.extInvoke('${ID}', 'go'))`) === 'ok');
a.launcher.close(); a.main.close();
await sleep(6000);
await a.reconnect();
const after = await a.main.ev(`({ pid: process.pid, data: require('electron').app.getPath('userData'), argv: process.argv, exe: process.execPath, portable: process.env.PORTABLE_EXECUTABLE_FILE || '' })`);
check('the app restarted', after.pid !== before, `${before} -> ${after.pid}`);
check('same data folder', path.resolve(after.data).toLowerCase() === path.resolve(a.data).toLowerCase(), after.data);
check('switches kept', after.argv.includes('--safe-theme'), after.argv.slice(1).join(' '));
if (process.env.ST_PORTABLE) check('restarted through the portable exe', !!after.portable && after.exe !== exe, after.exe);
await a.quit();
finish();
