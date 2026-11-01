// Scheduled backups: on app start, daily or weekly, for the profile in use or
// for every profile. A backup is only made when data/ changed since the last
// one (file count, size and newest change; see maintenance.dataFingerprint),
// and goes to backups/desktop or to a folder of the user's choice (a second
// drive, a OneDrive/Dropbox folder), one subfolder per profile there.
import fs from 'fs';
import path from 'path';
import * as mx from './maintenance.js';
import { t } from './i18n.js';

const HOUR = 3600 * 1000;
// A little under a day / week, so a PC started at the same time each day isn't skipped.
const PERIOD = { daily: 23 * HOUR, weekly: 7 * 24 * HOUR - 2 * HOUR };
const CHECK_EVERY = 30 * 60 * 1000;
export const MODES = ['off', 'start', 'daily', 'weekly'];

let log = () => {};
let stateFile = '';
let state = {};          // folder key → { last, checked, fingerprint, file, error, errorAt }
let ranThisStart = new Set();
let timer = null;
let hooks = {};

export function initBackupSchedule(opts) {
    ({ logLine: log } = opts);
    hooks = opts;        // getSettings, targets() → [{ name, path }], runTask(label, fn), changed()
    stateFile = path.join(opts.userData, 'backup-schedule.json');
    try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { state = {}; }
}
const save = () => { try { fs.writeFileSync(stateFile, JSON.stringify(state, null, 2)); } catch { /* next time */ } };
const key = dir => path.resolve(dir).toLowerCase();

// Where a profile's scheduled backups go.
export function destFor(profile) {
    const dest = hooks.getSettings().backupScheduleDir;
    if (!dest) return mx.backupsDir(profile.path);
    const sub = profile.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/[. ]+$/, '').trim() || 'SillyTavern';
    return path.join(dest, sub);
}

function due(profile, now) {
    const s = hooks.getSettings();
    const st = state[key(profile.path)];
    if (s.backupSchedule === 'start') return !ranThisStart.has(key(profile.path));
    if (!PERIOD[s.backupSchedule]) return false;
    // `checked` also counts a check that found nothing new: no re-walk every half hour.
    const since = Math.max(st?.last || 0, st?.checked || 0);
    return now - since >= PERIOD[s.backupSchedule];
}

// Back up one profile if its data changed. Returns 'done' | 'same' | 'error'.
async function backupOne(profile, { force = false } = {}) {
    const s = hooks.getSettings();
    const k = key(profile.path);
    const st = state[k] || (state[k] = {});
    ranThisStart.add(k);
    try {
        if (!fs.existsSync(path.join(profile.path, 'data'))) { st.checked = Date.now(); return 'same'; }
        const fp = await mx.dataFingerprint(profile.path);
        if (!force && st.fingerprint === fp.key && st.file && fs.existsSync(st.file)) {
            st.checked = Date.now();
            delete st.error;
            log(`Scheduled backup of "${profile.name}": nothing changed since the last one.`);
            return 'same';
        }
        if (s.backupScheduleDir && !fs.existsSync(s.backupScheduleDir)) throw new Error(t('the backup folder {dir} is not there (a drive that isn\'t connected?)', { dir: s.backupScheduleDir }));
        const dir = destFor(profile);
        fs.mkdirSync(dir, { recursive: true });
        // Media is stored uncompressed, so the zip is about as large as data/.
        const free = fs.statfsSync(dir);
        const freeBytes = free.bavail * free.bsize;
        if (freeBytes < fp.bytes * 1.05 + 50 * 1024 * 1024) throw new Error(t('not enough free space in {dir} (needs about {size} GB)', { dir, size: String(Math.ceil(fp.bytes / 1e9 * 10) / 10) }));
        log(`Scheduled backup of "${profile.name}" …`);
        const file = await mx.createBackup(profile.path, 'auto-scheduled', s.backupScheduleKeep, { dir });
        if (!file) throw new Error(t('the backup failed (see the Console)'));
        Object.assign(st, { last: Date.now(), checked: Date.now(), fingerprint: fp.key, file });
        delete st.error;
        delete st.errorAt;
        return 'done';
    } catch (e) {
        st.checked = Date.now();
        st.error = e.message;
        st.errorAt = Date.now();
        log(`ERROR: scheduled backup of "${profile.name}": ${e.message}`);
        return 'error';
    } finally {
        save();
    }
}

// Runs every due backup as one task. `now` skips the schedule (Back up now).
let running = false;
export async function runDue({ now = false, only = null } = {}) {
    const s = hooks.getSettings();
    if (running || (!now && s.backupSchedule === 'off')) return false;
    const t = Date.now();
    const list = hooks.targets().filter(p => (only ? key(p.path) === key(only) : now || due(p, t)));
    if (!list.length) return false;
    running = true;
    try {
        return await hooks.runTask('Scheduled backup', async () => {
            for (const p of list) await backupOne(p, { force: now });
            return true;
        });
    } finally {
        running = false;
        hooks.changed();
    }
}

// Start of the app: a first look a minute in (after the server is up), then every half hour.
export function start() {
    clearInterval(timer);
    setTimeout(() => runDue(), 60 * 1000);
    timer = setInterval(() => runDue(), CHECK_EVERY);
}

// For Home and the Backups page.
export function status() {
    const s = hooks.getSettings();
    const profiles = hooks.targets().map(p => {
        const st = state[key(p.path)] || {};
        return { name: p.name, path: p.path, last: st.last || 0, error: st.error || '', errorAt: st.errorAt || 0, dest: destFor(p) };
    });
    return { mode: s.backupSchedule, scope: s.backupScheduleScope, dir: s.backupScheduleDir, keep: s.backupScheduleKeep, running, profiles };
}

// Forget a profile's error once seen (Home's Dismiss).
export function dismiss(dir) {
    const st = state[key(dir)];
    if (st) { delete st.error; delete st.errorAt; save(); }
}
