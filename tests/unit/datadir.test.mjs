// Where the app keeps its data, and moving it beside the app.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { resolveDataDir, besideDir, copyData, DATA_NAME, MOVE_FILE } from '../../datadir.js';

const ENV = { SystemDrive: 'C:' };
const tmp = () => fs.mkdtempSync(path.join(process.env.ST_TEST_DATA || os.tmpdir(), 'dd-'));

test('beside: installed = next to the install folder, portable = next to the exe', () => {
    assert.equal(besideDir({ exePath: 'D:\\Apps\\sillytavern-desktop\\SillyTavern Desktop.exe' }), `D:\\Apps\\${DATA_NAME}`);
    assert.equal(besideDir({ exePath: 'C:\\Temp\\x\\SillyTavern Desktop.exe', portableDir: 'E:\\Tools' }), `E:\\Tools\\${DATA_NAME}`);
});

test('rules', () => {
    const base = { exePath: 'D:\\Apps\\sillytavern-desktop\\SillyTavern Desktop.exe', appData: 'C:\\Users\\u\\AppData\\Roaming\\SillyTavern Desktop', env: ENV, packaged: true };
    const beside = `D:\\Apps\\${DATA_NAME}`;
    const has = set => p => set.includes(p);
    // --user-data-dir: Electron's own choice stays.
    assert.equal(resolveDataDir({ ...base, argv: ['x', '--user-data-dir=D:\\t'], exists: has([]) }).kind, 'flag');
    // From source: unchanged.
    assert.equal(resolveDataDir({ ...base, packaged: false, argv: [], exists: has([]) }).kind, 'appdata');
    // The folder beside exists: it wins, even over old data.
    assert.deepEqual(resolveDataDir({ ...base, argv: [], exists: has([beside, path.join(base.appData, 'settings.json')]) }), { kind: 'beside', dir: beside, beside });
    // Old data and nothing beside: stays where it is.
    assert.equal(resolveDataDir({ ...base, argv: [], exists: has([path.join(base.appData, 'settings.json')]) }).kind, 'appdata');
    // New user, app off C: → beside.
    assert.equal(resolveDataDir({ ...base, argv: [], exists: has([]) }).kind, 'beside');
    // New user, app on C: → the usual place.
    const onC = resolveDataDir({ ...base, exePath: 'C:\\Users\\u\\AppData\\Local\\Programs\\sillytavern-desktop\\SillyTavern Desktop.exe', argv: [], exists: has([]) });
    assert.equal(onC.kind, 'appdata');
    // A move asked for last time.
    assert.equal(resolveDataDir({ ...base, argv: [], exists: has([path.join(base.appData, MOVE_FILE), path.join(base.appData, 'settings.json')]) }).kind, 'move');
});

test('copy skips caches and checks every file arrived', () => {
    const from = tmp(), to = path.join(tmp(), 'out');
    fs.mkdirSync(path.join(from, 'Cache', 'Cache_Data'), { recursive: true });
    fs.writeFileSync(path.join(from, 'Cache', 'Cache_Data', 'big'), Buffer.alloc(1000));
    fs.mkdirSync(path.join(from, 'Partitions', 'st-x', 'Code Cache'), { recursive: true });
    fs.writeFileSync(path.join(from, 'Partitions', 'st-x', 'Code Cache', 'js'), 'x');
    fs.writeFileSync(path.join(from, 'Partitions', 'st-x', 'Cookies'), 'c');
    fs.writeFileSync(path.join(from, 'settings.json'), '{"a":1}');
    fs.writeFileSync(path.join(from, MOVE_FILE), '{}');
    fs.writeFileSync(path.join(from, 'lockfile'), '');
    const r = copyData(from, to);
    assert.equal(r.ok, true, r.error);
    assert.equal(r.files, 2);
    assert.equal(fs.readFileSync(path.join(to, 'settings.json'), 'utf8'), '{"a":1}');
    assert.equal(fs.existsSync(path.join(to, 'Partitions', 'st-x', 'Cookies')), true);
    assert.equal(fs.existsSync(path.join(to, 'Cache')), false);
    assert.equal(fs.existsSync(path.join(to, 'Partitions', 'st-x', 'Code Cache')), false);
    assert.equal(fs.existsSync(path.join(to, MOVE_FILE)), false);
    assert.equal(fs.readFileSync(path.join(from, 'settings.json'), 'utf8'), '{"a":1}'); // source untouched
});

test('copy refuses a target that already has files, and cleans up after a failure', () => {
    const from = tmp(), to = tmp();
    fs.writeFileSync(path.join(from, 'settings.json'), '{}');
    fs.writeFileSync(path.join(to, 'other'), 'x');
    assert.equal(copyData(from, to).ok, false);
    assert.equal(fs.existsSync(path.join(to, 'other')), true); // not touched
    const to2 = path.join(tmp(), 'out');
    const r = copyData(from, to2, { failAfter: 0 });
    assert.equal(r.ok, false);
    assert.equal(fs.existsSync(to2), false);
});
