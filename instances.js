// Extra SillyTavern instances next to the main server: the same install on
// another port, another install, or a read-only view of the main server.
//
// Each kind gets its own browser session. SillyTavern names its session
// cookie after the PC, not the port, so two servers on 127.0.0.1 sharing a
// cookie jar would overwrite each other's sessions.
import { session, ipcMain } from 'electron';
import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import net from 'net';
import path from 'path';

let log = () => {};
let host = '127.0.0.1';
export function initInstances(opts) {
    log = opts.logLine;
    host = opts.host;
    // st-preload.js asks each page; read-only pages get the shim below.
    ipcMain.on('st:read-only', e => {
        e.returnValue = readOnlyReady && e.sender.session === session.fromPartition(READ_ONLY_PARTITION) ? readOnlyShim() : null;
    });
}

// Version and branch, read straight from the files (cheap enough for menus).
export function describe(stRoot) {
    let version = '', branch = '';
    try { version = JSON.parse(fs.readFileSync(path.join(stRoot, 'package.json'), 'utf8')).version; } catch { /* not installed */ }
    try { branch = (fs.readFileSync(path.join(stRoot, '.git', 'HEAD'), 'utf8').match(/ref: refs\/heads\/(.+)/) || [])[1]?.trim() || ''; } catch { /* not a git checkout */ }
    return { version, branch };
}

// ---------- read-only ----------
// Reads that SillyTavern sends as POST. Everything else that isn't a GET
// (saves, deletes, uploads, generating, and any route added later) is blocked.
const READ_POSTS = [
    /^\/api\/settings\/(get|get-snapshots)$/,
    /^\/api\/characters\/(all|get|chats|export)$/,
    /^\/api\/chats\/(get|search|recent|export|group\/get|group\/info)$/,
    /^\/api\/groups\/all$/,
    /^\/api\/worldinfo\/(list|get)$/,
    /^\/api\/(avatars|assets)\/get$/,
    /^\/api\/backgrounds\/(all|folders)$/,
    /^\/api\/images\/(list(\/.*)?|folders)$/,
    /^\/api\/image-metadata\/(all|folders\/get)$/,
    /^\/api\/backups\/chat\/get$/,
    /^\/api\/stats\/get$/,
    /^\/api\/secrets\/read$/,
    /^\/api\/extensions\/(branches|version)$/,
    /^\/api\/tokenizers\//,
    /^\/api\/backends\/(chat-completions|text-completions|kobold)\/status$/,
    /^\/api\/backends\/text-completions\/(props|llamacpp\/props)$/,
    /^\/api\/backends\/chat-completions\/multimodal-models\//,
    /^\/api\/sd\/([\w-]+\/)?(ping|models|samplers|schedulers|vaes|upscalers|workflows|workflow|get-model|sd-next\/upscalers)$/,
    /^\/api\/speech\/[\w-]+\/voices$/,
    /^\/api\/(openrouter|nanogpt)\/(credits|models\/[\w-]+)$/,
    /^\/api\/openai\/[\w-]+\/models\/[\w-]+$/,
    /^\/api\/users\/list$/,
];
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
export const READ_ONLY_PARTITION = 'st-readonly'; // in memory: nothing it stores lasts either

export function readOnlyAllows(method, url) {
    if (SAFE_METHODS.has(method)) return true;
    let p;
    try { p = new URL(url).pathname; } catch { return false; }
    return READ_POSTS.some(r => r.test(p));
}

// Runs in read-only pages before SillyTavern: blocked saves get a fake "OK"
// so SillyTavern doesn't warn about a lost connection on every change, and
// generating gets a clear error. The network filter below is what actually
// stops the requests; this only keeps the page calm.
const READ_ONLY_MESSAGE = 'This is a read-only copy of SillyTavern: sending is turned off here. Use your normal SillyTavern tab to chat.';
function readOnlyShim() {
    const shim = (sources, message) => {
        const reads = sources.map(s => new RegExp(s));
        const blocked = (method, url) => url.origin === location.origin && !['GET', 'HEAD', 'OPTIONS'].includes(method) && !reads.some(r => r.test(url.pathname));
        const json = (body, status) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
        const realFetch = window.fetch;
        window.fetch = function (input, init) {
            const url = new URL(input instanceof Request ? input.url : String(input), location.href);
            const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
            if (blocked(method, url)) return Promise.resolve(/\/generate/.test(url.pathname) ? json({ error: { message } }, 403) : json({}, 200));
            return realFetch.apply(this, arguments);
        };
        const realBeacon = navigator.sendBeacon?.bind(navigator);
        if (realBeacon) navigator.sendBeacon = (url, data) => (blocked('POST', new URL(url, location.href)) ? true : realBeacon(url, data));
    };
    return `(${shim})(${JSON.stringify(READ_POSTS.map(r => r.source))}, ${JSON.stringify(READ_ONLY_MESSAGE)});`;
}

let readOnlyReady = false;
export function readOnlySession() {
    const ses = session.fromPartition(READ_ONLY_PARTITION);
    if (!readOnlyReady) {
        readOnlyReady = true;
        let lastLog = 0;
        ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (d, cb) => {
            const ok = readOnlyAllows(d.method, d.url);
            if (!ok && Date.now() - lastLog > 2000) {
                lastLog = Date.now();
                log(`Read-only SillyTavern: blocked ${d.method} ${new URL(d.url).pathname} (nothing is saved or sent from this tab).`);
            }
            cb({ cancel: !ok });
        });
    }
    return ses;
}

// Every extra server gets a cookie jar of its own, per install folder.
export function partitionFor(stRoot) {
    return `persist:st-${crypto.createHash('sha1').update(path.resolve(stRoot).toLowerCase()).digest('hex').slice(0, 10)}`;
}

// ---------- extra servers ----------
const servers = new Set(); // { child, port, stRoot, label }

function portFree(port) {
    return new Promise(resolve => {
        const s = net.createServer();
        s.once('error', () => resolve(false));
        s.once('listening', () => s.close(() => resolve(true)));
        s.listen(port, host);
    });
}
export async function freePort(from, taken = []) {
    for (let p = from; p < from + 200; p++) {
        if (taken.includes(p) || [...servers].some(s => s.port === p)) continue;
        if (await portFree(p)) return p;
    }
    throw new Error('No free port found.');
}

function answers(port) {
    return new Promise(resolve => {
        const req = http.get(`http://${host}:${port}/`, { timeout: 3000 }, res => { res.resume(); resolve(res.statusCode < 500); });
        req.on('timeout', () => { req.destroy(); resolve(false); });
        req.on('error', () => resolve(false));
    });
}

// Starts `node server.js --port <port>` in stRoot. `ready` resolves to true
// once the server answers, or false if it exits or takes over two minutes.
export function startServer(stRoot, port, label) {
    const tag = `[${label} :${port}]`;
    log(`${tag} Starting SillyTavern from ${stRoot} ...`);
    const child = spawn('node', ['server.js', '--port', String(port)], {
        cwd: stRoot, windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' }, shell: false,
    });
    const srv = { child, port, stRoot, label, exited: false };
    servers.add(srv);
    const out = d => d.toString().split('\n').map(l => l.trim()).filter(Boolean).forEach(l => log(`${tag} ${l}`));
    child.stdout.on('data', out);
    child.stderr.on('data', out);
    child.on('error', e => log(`${tag} ERROR: failed to launch node: ${e.message}`));
    child.on('exit', code => { srv.exited = true; servers.delete(srv); log(`${tag} Server exited with code ${code}.`); });
    srv.ready = (async () => {
        const started = Date.now();
        while (!srv.exited && Date.now() - started < 120000) {
            if (await answers(port)) return true;
            await new Promise(r => setTimeout(r, 800));
        }
        return false;
    })();
    return srv;
}

export function stopServer(srv) {
    if (!srv || srv.exited) return Promise.resolve();
    log(`[${srv.label} :${srv.port}] Stopping server...`);
    return new Promise(resolve => {
        srv.child.once('exit', () => setTimeout(resolve, 300));
        if (process.platform === 'win32') spawn('taskkill', ['/PID', String(srv.child.pid), '/T', '/F'], { windowsHide: true });
        else srv.child.kill('SIGTERM');
    });
}

// Before an update or repair: servers running from that folder hold its files.
export function stopAll(stRoot) {
    const list = [...servers].filter(s => !stRoot || path.resolve(s.stRoot).toLowerCase() === path.resolve(stRoot).toLowerCase());
    return Promise.all(list.map(stopServer));
}
