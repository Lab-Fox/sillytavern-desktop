// The main server: two starts at once give one server, and quitting leaves none.
// Needs ST_CLONE (a throwaway SillyTavern) and ST_RUNS. The test port is 8123:
// only servers started with "--port 8123" are counted or cleaned up.
import { execFileSync } from 'child_process';
import { launch, check, finish, sleep, CLONE } from './lib.mjs';

if (!CLONE) { console.log('Set ST_CLONE to a throwaway SillyTavern.'); process.exit(1); }
const PORT = 8123;
const servers = () => {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command',
        `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*server.js --port ${PORT}*' } | ForEach-Object { $_.ProcessId }`], { encoding: 'utf8' });
    return out.split(/\s+/).filter(Boolean).map(Number);
};
const killAll = () => { for (const pid of servers()) { try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } } };
const until = async (fn, ms = 60000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(500); } return false; };
const answers = () => fetch(`http://127.0.0.1:${PORT}/`).then(r => r.status < 500, () => false);

if (servers().length) { console.log(`A server on port ${PORT} is already running: stop it first.`); process.exit(1); }

// 1. Two starts at the same moment (autoStart + the Open button, say).
let a = await launch({ name: 'server-start' });
await a.launcher.ev(`await Promise.all([D.startServer(), D.startServer()]); 'ok'`);
await until(answers);
await sleep(4000); // a second server would have failed on the port and exited by now
check('two starts at once: one server', servers().length === 1, `servers: ${servers().length}`);
check('the app knows it is running', await a.launcher.ev(`(await D.getState()).running`) === true);
await a.launcher.ev(`await D.stopServer(); 'ok'`);
check('Stop leaves no server', await until(() => servers().length === 0, 15000), `left: ${servers().length}`);
killAll();

// 2. Stop clicked while the start is still checking (port, admin question, Tailscale).
await a.launcher.ev(`await Promise.all([D.startServer(), D.stopServer()]); 'ok'`);
await sleep(6000);
check('Stop during the start: no server', servers().length === 0, `servers: ${servers().length}`);
check('...and the app says stopped', await a.launcher.ev(`(await D.getState()).running`) === false);
killAll();

// 3. Quit with the server running (no Stop first).
await a.launcher.ev(`await D.startServer(); 'ok'`);
await until(answers);
check('server started again', servers().length === 1);
await a.main.ev(`const { app } = require('electron'); setTimeout(() => app.quit(), 300); 'ok'`).catch(() => {});
a.launcher.close(); a.main.close();
await Promise.race([new Promise(r => a.proc.once('exit', r)), sleep(20000)]);
check('quit leaves no server', await until(() => servers().length === 0, 10000), `left: ${servers().length}`);
killAll();
finish();
