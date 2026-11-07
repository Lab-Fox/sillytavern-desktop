// Where things may go. SillyTavern's own advice: never install it in a
// folder Windows controls (Program Files, Windows, ProgramData) and never run
// it as administrator. This app also steers people away from the system
// drive (usually C:), which many keep small and only for Windows.
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const GB = 1024 ** 3;
const MIN_FREE = 5 * GB; // a drive with less is not suggested

const norm = p => path.win32.resolve(String(p || '')).replace(/\\+$/, '').toLowerCase();

const protectedRoots = (env = process.env) => [
    env.SystemRoot || env.windir || 'C:\\Windows',
    env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramW6432, env.ProgramData,
].filter(Boolean).map(norm);

// A folder Windows controls (or one inside it): writing there needs admin
// rights or gets redirected, so SillyTavern and this app never go there.
export function protectedFolder(p, env = process.env) {
    const n = norm(p);
    return protectedRoots(env).some(r => n === r || n.startsWith(`${r}\\`));
}

export const systemDrive = (env = process.env) => (env.SystemDrive || 'C:').toUpperCase();

export function onSystemDrive(p, env = process.env) {
    const m = /^([a-z]):/i.exec(path.win32.resolve(String(p || '')));
    return !!m && `${m[1].toUpperCase()}:` === systemDrive(env);
}

// The fixed drive (not USB, not network) with the most free space, leaving
// out the system drive when another one has room.
export function pickDrive(list, env = process.env) {
    const sys = `${systemDrive(env)}\\`;
    const others = list.filter(d => d.type === 'fixed' && d.root.toUpperCase() !== sys && d.free >= MIN_FREE);
    others.sort((a, b) => b.free - a.free);
    return others[0]?.root || sys;
}

let k32 = null;
function kernel32() {
    if (!k32) {
        const koffi = require('koffi');
        const lib = koffi.load('kernel32.dll');
        k32 = { type: lib.func('uint __stdcall GetDriveTypeW(str16 root)') };
    }
    return k32;
}
const TYPES = { 2: 'removable', 3: 'fixed', 4: 'network', 5: 'cdrom', 6: 'ram' };

// Every drive letter in use: { root, type, free, total } (bytes).
export function drives() {
    const out = [];
    for (let c = 67; c <= 90; c++) { // C: … Z:
        const root = `${String.fromCharCode(c)}:\\`;
        if (!fs.existsSync(root)) continue;
        let type = 'unknown', free = 0, total = 0;
        try { type = TYPES[kernel32().type(root)] || 'unknown'; } catch { /* koffi missing */ }
        try { const s = fs.statfsSync(root); free = s.bavail * s.bsize; total = s.blocks * s.bsize; } catch { /* not ready */ }
        out.push({ root, type, free, total });
    }
    return out;
}

export const bestDrive = (env = process.env) => pickDrive(drives(), env);

// Running as administrator (elevated). SillyTavern asks people not to:
// files it makes then belong to the admin account.
export function isElevated() {
    try {
        const koffi = require('koffi');
        return !!koffi.load('shell32.dll').func('bool __stdcall IsUserAnAdmin()')();
    } catch { return false; }
}
