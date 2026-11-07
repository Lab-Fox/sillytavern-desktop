// Starts the app on throwaway data and talks to it over CDP.
// Set ST_RUNS (a folder for test data) and ST_CLONE (a throwaway SillyTavern).
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const RUNS = process.env.ST_RUNS || path.join(ROOT, '.test-runs');
export const CLONE = process.env.ST_CLONE;

let pass = 0, fail = 0;
export const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  -> ${info}` : ''}`); };
export const finish = () => { console.log(`\n${pass}/${pass + fail} passed`); process.exitCode = fail ? 1 : 0; };

async function socket(url) {
    const s = new WebSocket(url);
    await new Promise(r => { s.onopen = r; });
    let id = 0; const wait = new Map();
    s.onmessage = m => { const d = JSON.parse(m.data); if (d.id) { wait.get(d.id)?.(d); wait.delete(d.id); } };
    const send = (method, params = {}) => new Promise((r, j) => {
        const i = ++id; wait.set(i, r); s.send(JSON.stringify({ id: i, method, params }));
        setTimeout(() => j(new Error(`timeout ${method}`)), 30000);
    });
    const ev = async e => {
        const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true, userGesture: true, replMode: true, includeCommandLineAPI: true });
        if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'page error');
        return r.result?.result?.value;
    };
    return { send, ev, close: () => s.close() };
}

// { name, settings, exe, app, args } -> { launcher, main, page(endsWith), quit }
// ST_EXE tests a built app instead of the source.
export async function launch({ name, settings = {}, exe = process.env.ST_EXE, app = exe ? '-' : ROOT, args = [], keep = false }) {
    const data = path.join(RUNS, name);
    if (!keep) fs.rmSync(data, { recursive: true, force: true });
    fs.mkdirSync(data, { recursive: true });
    if (!keep) fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify({
        port: 8123, host: 'localhost', autoStart: false, checkUpdatesOnLaunch: false, checkAppUpdates: false,
        confirmBeforeQuit: false, ...(CLONE ? { sillytavernPath: CLONE } : {}), ...settings,
    }));
    const cdp = 9800 + Math.floor(Math.random() * 90), ins = cdp + 100;
    const bin = exe || path.join(ROOT, 'node_modules/electron/dist/electron.exe');
    const proc = spawn(bin, [...(app === '-' ? [] : [app]), `--user-data-dir=${data}`, `--remote-debugging-port=${cdp}`, `--inspect=${ins}`, ...args], { stdio: 'ignore' });
    const list = async () => (await fetch(`http://127.0.0.1:${cdp}/json/list`)).json();
    const page = async (end, tries = 80) => {
        for (let i = 0; i < tries; i++) {
            try { const p = (await list()).find(x => x.url.endsWith(end)); if (p) return socket(p.webSocketDebuggerUrl); } catch { /* starting */ }
            await sleep(500);
        }
        throw new Error(`no page ${end}`);
    };
    const launcher = await page('launcher.html');
    await sleep(3000);
    const t = await (await fetch(`http://127.0.0.1:${ins}/json/list`)).json();
    const main = await socket(t[0].webSocketDebuggerUrl);
    const quit = async () => {
        try { await launcher.ev(`await D.stopServer(); 'ok'`); } catch { /* not running */ }
        await sleep(1500);
        // Send the quit on a timer and close every socket: an open debug
        // connection keeps the main process alive.
        await main.ev(`const { app } = require('electron'); setTimeout(() => app.quit(), 300); 'ok'`).catch(() => {});
        launcher.close(); main.close();
        const gone = new Promise(r => proc.once('exit', r));
        await Promise.race([gone, sleep(15000)]);
        if (proc.exitCode === null) proc.kill();
    };
    return { launcher, main, page, list, quit, data };
}
