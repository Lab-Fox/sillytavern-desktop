// Where a built app keeps its data, and moving old data beside it.
// Needs a built app: ST_EXE=<win-unpacked exe>. Fake "%APPDATA%" folders live in ST_RUNS.
import fs from 'fs';
import path from 'path';
import { launch, check, finish, sleep, RUNS, TEST_SETTINGS } from './lib.mjs';

const EXE = process.env.ST_EXE;
if (!EXE) { console.log('Set ST_EXE to a built app (win-unpacked).'); process.exit(2); }
// Installed (win-unpacked): beside the app's folder. Portable (ST_PORTABLE=1): beside the exe.
const BESIDE = path.join(process.env.ST_PORTABLE ? path.dirname(EXE) : path.dirname(path.dirname(EXE)), 'SillyTavern Desktop Data');
const fresh = d => { fs.rmSync(d, { recursive: true, force: true }); return d; };
const yes = `const { dialog, shell } = require('electron'); dialog.showMessageBox = async () => ({ response: 0 });
    const fsm = require('fs'); shell.trashItem = async p => fsm.rmSync(p, { recursive: true, force: true }); 'ok'`;

// A: a new user with the app off C: → data beside the app; the old place stays empty.
{
    fresh(BESIDE);
    const old = fresh(path.join(RUNS, 'appdata-a'));
    const a = await launch({ name: 'dd-a', appData: old });
    const d = await a.launcher.ev(`await D.dataDir()`);
    check('new user: data beside the app', d.kind === 'beside' && d.dir === BESIDE, d.dir);
    check('new user: no move offered', !d.canMove && !d.movedFrom);
    check('npm cache goes with the data', await a.main.ev(`process.env.npm_config_cache`) === path.join(BESIDE, 'npm-cache'));
    await a.quit();
    const files = fs.existsSync(BESIDE) ? fs.readdirSync(BESIDE) : [];
    check('new user: the app wrote its files there', files.includes('Local State') && files.includes('Preferences'), files.join(', '));
    check('new user: nothing in the old place', !fs.existsSync(old));
}

// B: old data in %APPDATA% → stays there; Move copies it beside, without caches; the old copy can go.
{
    fresh(BESIDE);
    const old = fresh(path.join(RUNS, 'appdata-b'));
    fs.mkdirSync(path.join(old, 'Cache', 'Cache_Data'), { recursive: true });
    fs.writeFileSync(path.join(old, 'Cache', 'Cache_Data', 'big'), Buffer.alloc(2_000_000));
    fs.mkdirSync(path.join(old, 'userscripts'), { recursive: true });
    fs.writeFileSync(path.join(old, 'userscripts', 'mine.user.js'), '// ==UserScript==\n// @name mine\n// ==/UserScript==\n');
    fs.writeFileSync(path.join(old, 'settings.json'), JSON.stringify({ ...TEST_SETTINGS, theme: 'fox', consoleFontSize: 21 }));
    const a = await launch({ name: 'dd-b', appData: old });
    let d = await a.launcher.ev(`await D.dataDir()`);
    check('old data: used where it is', d.kind === 'appdata' && d.dir === old, d.dir);
    check('old data: move offered', d.canMove === true && d.beside === BESIDE);
    check('old data: nothing beside yet', !fs.existsSync(BESIDE));
    await a.main.ev(yes);
    a.launcher.ev(`D.dataMove()`).catch(() => {}); // never answers: the app restarts
    a.launcher.close(); a.main.close();
    await sleep(4000);
    await a.reconnect();
    d = await a.launcher.ev(`await D.dataDir()`);
    check('after the move: data beside the app', d.kind === 'beside' && d.dir === BESIDE, d.dir);
    const s = JSON.parse(fs.readFileSync(path.join(BESIDE, 'settings.json'), 'utf8'));
    check('after the move: settings came along', s.theme === 'fox' && s.consoleFontSize === 21);
    check('after the move: userscript came along', fs.existsSync(path.join(BESIDE, 'userscripts', 'mine.user.js')));
    check('after the move: caches left behind', !fs.existsSync(path.join(BESIDE, 'Cache', 'Cache_Data', 'big')));
    check('after the move: old copy untouched', fs.existsSync(path.join(old, 'Cache', 'Cache_Data', 'big')) && fs.existsSync(path.join(old, 'settings.json')));
    check('after the move: old copy offered for removal', d.movedFrom === old && d.oldBytes > 2_000_000, `${d.movedFrom} ${d.oldBytes}`);
    check('after the move: Settings shows the row', await a.launcher.ev(`go('settings'); showSetPane('about'); await new Promise(r => setTimeout(r, 400)); !$('dataOldRow').hidden && $('dataDirPath').textContent`) === BESIDE);
    await a.main.ev(yes);
    const r = await a.launcher.ev(`await D.dataOldRemove()`);
    d = await a.launcher.ev(`await D.dataDir()`);
    check('old copy removed on request', r?.ok && !fs.existsSync(old) && !d.movedFrom, JSON.stringify(r));
    await a.quit();
}

// C: a later start finds the folder beside the app at once, even with old data back.
{
    const old = fresh(path.join(RUNS, 'appdata-c'));
    fs.mkdirSync(old, { recursive: true });
    fs.writeFileSync(path.join(old, 'settings.json'), JSON.stringify({ ...TEST_SETTINGS, theme: 'sillytavern' }));
    const a = await launch({ name: 'dd-c', appData: old });
    const d = await a.launcher.ev(`await D.dataDir()`);
    check('the folder beside wins', d.kind === 'beside' && d.dir === BESIDE);
    await a.quit();
}
finish();
