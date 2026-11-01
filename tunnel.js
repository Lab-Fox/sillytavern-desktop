// tunnel.js — reaching SillyTavern from outside the home network.
// Remote link: Cloudflare's free "quick tunnel" (cloudflared, downloaded from
// its GitHub release and checked against the SHA256 GitHub publishes). It
// gives a random https://….trycloudflare.com address while it runs; anyone with
// the address reaches the login, so the app only starts it with a password.
// Tailscale: a private network between your own devices; the app only finds
// it and shows its addresses (installing it is Tailscale's own installer).
import { net } from 'electron';
import { spawn, execFile, execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fetchTo } from './runtime.js';
import { onLines } from './maintenance.js';
import { t } from './i18n.js';

const RELEASE = 'https://api.github.com/repos/cloudflare/cloudflared/releases/latest';
const ASSET = 'cloudflared-windows-amd64.exe';

let dir = '';
let log = () => {};
let child = null;
const state = { status: 'off', url: '', error: '', version: '' }; // status: off | downloading | starting | on
let onChange = () => {};

export function initTunnel({ userData, logLine, changed }) {
    dir = path.join(userData, 'tools');
    log = logLine;
    onChange = changed;
}
const exe = () => path.join(dir, 'cloudflared.exe');
const set = patch => { Object.assign(state, patch); onChange({ ...state }); };
export const status = () => ({ ...state, installed: fs.existsSync(exe()) });
export const running = () => !!child;

// The latest cloudflared, when it isn't there yet (or `fresh` asks for the newest).
async function ensure(onProgress, { fresh = false } = {}) {
    const meta = path.join(dir, 'cloudflared.json');
    if (!fresh && fs.existsSync(exe())) return;
    const res = await net.fetch(RELEASE, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
    if (!res.ok) throw new Error(t('GitHub answered {status}', { status: String(res.status) }));
    const rel = await res.json();
    const asset = (rel.assets || []).find(a => a.name === ASSET);
    const sha = /^sha256:([0-9a-f]{64})$/i.exec(asset?.digest || '');
    if (!asset || !sha) throw new Error(t('no checked download of cloudflared found'));
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${exe()}.partial`;
    log(`Downloading cloudflared ${rel.tag_name} (${Math.round(asset.size / 1e6)} MB) from GitHub …`);
    await fetchTo({ url: asset.browser_download_url, sha256: sha[1].toLowerCase(), size: asset.size, maxBytes: asset.size + 1024 }, tmp, onProgress);
    fs.rmSync(exe(), { force: true });
    fs.renameSync(tmp, exe());
    fs.writeFileSync(meta, JSON.stringify({ version: rel.tag_name, sha256: sha[1].toLowerCase() }));
}

// target: the local SillyTavern address (http or https).
export async function start(target) {
    if (child) return status();
    set({ status: 'downloading', url: '', error: '' });
    try {
        await ensure(pct => set({ status: 'downloading', progress: pct }));
    } catch (e) {
        set({ status: 'off', error: t('cloudflared could not be downloaded: {reason}', { reason: e.message }) });
        return status();
    }
    set({ status: 'starting', progress: null });
    const args = ['tunnel', '--no-autoupdate', '--url', target];
    if (target.startsWith('https:')) args.push('--no-tls-verify'); // our own certificate
    log(`Starting the remote link (cloudflared ${args.join(' ')}) …`);
    child = spawn(exe(), args, { windowsHide: true, cwd: dir });
    const seen = line => {
        // cloudflared prints the address in a box on stderr.
        const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i.exec(line);
        if (m && state.status !== 'on') { set({ status: 'on', url: m[0] }); log(`Remote link is on: ${m[0]}`); }
        if (/ERR|error/i.test(line) && !/Thank you|DEBUG/i.test(line)) log(`[cloudflared] ${line.trim()}`);
    };
    onLines(child.stderr, seen);
    onLines(child.stdout, seen);
    child.on('error', e => { child = null; set({ status: 'off', url: '', error: e.message }); });
    child.on('exit', code => {
        const was = state.status;
        child = null;
        set({ status: 'off', url: '', error: was === 'starting' ? t('cloudflared stopped before the link was ready (code {code}). Is the internet reachable?', { code: String(code) }) : state.error });
        log(`Remote link stopped${code ? ` (code ${code})` : ''}.`);
    });
    // No address after a while: say so (it keeps trying).
    setTimeout(() => { if (child && state.status === 'starting') set({ error: t('Still waiting for Cloudflare… (a firewall or VPN can block it)') }); }, 30000);
    return status();
}

export function stop({ wait = false } = {}) {
    if (!child) return status();
    const args = ['/PID', String(child.pid), '/T', '/F'];
    try {
        if (wait) execFileSync('taskkill', args, { windowsHide: true, stdio: 'ignore', timeout: 5000 }); // the app is quitting
        else spawn('taskkill', args, { windowsHide: true });
    } catch { child?.kill(); }
    return status();
}

export async function update(onProgress) { await ensure(onProgress, { fresh: true }); }

// ---------- Tailscale ----------
const TAILSCALE = ['tailscale', path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Tailscale', 'tailscale.exe')];
const run = (file, args) => new Promise(resolve => {
    execFile(file, args, { windowsHide: true, timeout: 5000 }, (err, stdout) => resolve(err ? null : String(stdout)));
});

// { installed, running, name, dns, ips } from `tailscale status --json`.
export async function tailscale() {
    for (const file of TAILSCALE) {
        const out = await run(file, ['status', '--json']);
        if (out === null) {
            if (file !== 'tailscale' && fs.existsSync(file)) return { installed: true, running: false };
            continue;
        }
        return parseTailscale(out);
    }
    return { installed: false, running: false };
}
export function parseTailscale(out) {
    try {
        const j = JSON.parse(out);
        const self = j.Self || {};
        const ips = (self.TailscaleIPs || j.TailscaleIPs || []).filter(ip => /^\d+\.\d+\.\d+\.\d+$/.test(ip));
        return {
            installed: true,
            running: j.BackendState === 'Running' && ips.length > 0,
            state: j.BackendState || '',
            name: self.HostName || '',
            dns: String(self.DNSName || '').replace(/\.$/, ''),
            ips,
        };
    } catch {
        return { installed: true, running: false };
    }
}
// Tailscale's addresses (100.64.0.0/10): allowed by SillyTavern's whitelist with phone access on.
export const TAILSCALE_RANGE = '100.64.0.0/10';
