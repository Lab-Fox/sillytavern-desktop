// Folder rules: protected Windows folders, the system drive, the best drive.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { protectedFolder, onSystemDrive, pickDrive } from '../../folders.js';

const ENV = {
    SystemDrive: 'C:', SystemRoot: 'C:\\Windows', ProgramFiles: 'C:\\Program Files',
    'ProgramFiles(x86)': 'C:\\Program Files (x86)', ProgramW6432: 'C:\\Program Files', ProgramData: 'C:\\ProgramData',
};

test('protected folders, any case, slashes or trailing slash', () => {
    for (const p of ['C:\\Windows', 'c:/windows/system32', 'C:\\Program Files\\', 'C:\\PROGRAM FILES (X86)\\Thing', 'C:\\ProgramData\\x']) {
        assert.equal(protectedFolder(p, ENV), true, p);
    }
});

test('normal folders are not protected, even on C:', () => {
    for (const p of ['C:\\Games\\SillyTavern', 'D:\\Program Files', 'C:\\Program Files Extra', 'C:\\Users\\someone\\SillyTavern', 'E:\\']) {
        assert.equal(protectedFolder(p, ENV), false, p);
    }
});

test('system drive', () => {
    assert.equal(onSystemDrive('C:\\Games', ENV), true);
    assert.equal(onSystemDrive('c:/x', ENV), true);
    assert.equal(onSystemDrive('D:\\Games', ENV), false);
    assert.equal(onSystemDrive('\\\\server\\share\\x', ENV), false);
});

const GB = 1024 ** 3;
test('best drive: fixed, not the system drive, most free space', () => {
    const list = [
        { root: 'C:\\', type: 'fixed', free: 500 * GB },
        { root: 'D:\\', type: 'fixed', free: 100 * GB },
        { root: 'E:\\', type: 'fixed', free: 300 * GB },
        { root: 'F:\\', type: 'removable', free: 900 * GB },
        { root: 'Z:\\', type: 'network', free: 900 * GB },
    ];
    assert.equal(pickDrive(list, ENV), 'E:\\');
});

test('best drive: only the system drive, or others nearly full', () => {
    assert.equal(pickDrive([{ root: 'C:\\', type: 'fixed', free: 50 * GB }], ENV), 'C:\\');
    assert.equal(pickDrive([{ root: 'C:\\', type: 'fixed', free: 50 * GB }, { root: 'D:\\', type: 'fixed', free: 1 * GB }], ENV), 'C:\\');
    assert.equal(pickDrive([], ENV), 'C:\\');
});
