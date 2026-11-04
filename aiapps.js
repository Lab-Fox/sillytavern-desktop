// aiapps.js — AI apps next to SillyTavern (Launcher.bat's Toolbox): install,
// start, stop, update and remove local AI programs, and download models.
// Downloads come from each project's own GitHub release (checked against the
// SHA256 GitHub publishes) or from Hugging Face (checked against its SHA256);
// Python apps get their own environment through uv (no Miniconda).
import { net, shell } from 'electron';
import { spawn, execFileSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import ofs from 'original-fs'; // *.asar files inside downloaded apps (see runtime.js)
import http from 'http';
import path from 'path';
import { fetchTo, unzip, swapIn } from './runtime.js';
import { onLines } from './maintenance.js';
import * as pc from './pccheck.js';
import { t, N } from './i18n.js';
import { mediaApps } from './aiapps-media.js';

let ctx = null; // { userData, settings(), save(), stRoot(), changed(id, view), logged(id, line), modelProgress(p) }
const state = new Map(); // id → { status, error, progress, log: [], child }
const LOG_MAX = 400;

export function initAiApps(c) { ctx = c; }
const S = () => ctx.settings();

// Where apps live: the folder chosen in the launcher, else "ai-apps" next to
// the SillyTavern folder (beside SillyTavern-Launcher's text-completion/ etc.).
export function appsDir() {
    const chosen = S().appsDir;
    if (chosen) return chosen;
    const st = ctx.stRoot();
    return st ? path.join(path.dirname(st), 'ai-apps') : path.join(ctx.userData, 'ai-apps');
}
export const modelsDir = () => path.join(appsDir(), 'models');
// Picture models are shared by every image app (ComfyUI's folder names).
export const imageModelsDir = () => path.join(appsDir(), 'image-models');
export const IMAGE_KINDS = ['checkpoints', 'loras', 'vae', 'embeddings', 'upscale_models'];
const launcherBatRoot = () => (ctx.stRoot() ? path.dirname(ctx.stRoot()) : '');

// ---------- downloads ----------
async function latestRelease(repo) {
    const res = await net.fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
    if (!res.ok) throw new Error(t('GitHub answered {status}', { status: String(res.status) }));
    return res.json();
}
// The newest release that has a matching file. llama.cpp publishes every
// build as a pre-release, and its "latest" marker points at an old tag.
async function releaseWith(repo, test) {
    const res = await net.fetch(`https://api.github.com/repos/${repo}/releases?per_page=10`, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
    if (!res.ok) throw new Error(t('GitHub answered {status}', { status: String(res.status) }));
    const rel = (await res.json()).find(r => !r.draft && (r.assets || []).some(a => test.test(a.name)));
    if (!rel) throw new Error(t('no checked download found in {repo}\'s latest release', { repo }));
    return rel;
}
function assetOf(rel, test) {
    const a = (rel.assets || []).find(x => test.test(x.name));
    const sha = /^sha256:([0-9a-f]{64})$/i.exec(a?.digest || '');
    if (!a || !sha) throw new Error(t('no checked download found in {repo}\'s latest release', { repo: rel.html_url?.split('/').slice(3, 5).join('/') || '?' }));
    return { url: a.browser_download_url, sha256: sha[1].toLowerCase(), size: a.size, name: a.name, maxBytes: a.size + 1024 };
}
async function download(id, src, file) {
    const mb = Math.round(src.size / 1e6);
    log(id, `Downloading ${src.name} (${mb} MB) …`);
    await fetchTo(src, file, pct => set(id, { progress: pct, step: t('Downloading {name}', { name: src.name }) }));
}
// A zip with one top folder: its contents move up.
function flatten(dir) {
    const items = ofs.readdirSync(dir);
    if (items.length !== 1) return;
    const inner = path.join(dir, items[0]);
    if (!ofs.statSync(inner).isDirectory()) return;
    for (const f of ofs.readdirSync(inner)) ofs.renameSync(path.join(inner, f), path.join(dir, f));
    ofs.rmdirSync(inner);
}

// The GPU decides the build: CUDA for NVIDIA, Vulkan for AMD and Intel Arc, else CPU.
let gpuKindCache = null;
export async function gpuKind() {
    if (gpuKindCache) return gpuKindCache;
    const cards = await pc.gpus();
    gpuKindCache = cards.some(c => c.vendor === 'nvidia') ? 'cuda' : cards.some(c => !c.integrated || /Arc/i.test(c.name)) ? 'vulkan' : 'cpu';
    return gpuKindCache;
}

// ---------- the apps ----------
// opts: per-app options the launcher shows (model / ctx / layers / port / extra).
const COMMON = [
    { key: 'ctx', kind: 'number', label: N('Context size'), default: 8192, min: 512, max: 131072 },
    { key: 'layers', kind: 'text', label: N('GPU layers'), default: 'all', hint: N('"all" puts the whole model on the graphics card; a number puts that many layers there and the rest on the processor.') },
];
const meta = dir => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'desktop-app.json'), 'utf8')); } catch { return null; } };
const writeMeta = (dir, m) => fs.writeFileSync(path.join(dir, 'desktop-app.json'), JSON.stringify({ ...m, installed: new Date().toISOString() }, null, 2));
const layersArg = v => (String(v || 'all').trim().toLowerCase() === 'all' ? '999' : String(parseInt(v, 10) || 0));

export const APPS = [
    {
        id: 'koboldcpp', name: 'KoboldCpp', group: 'text', site: 'https://github.com/LostRuins/koboldcpp', port: 5001,
        desc: N('One program that runs GGUF models, with its own chat page (KoboldAI Lite). The easiest way to run a model on this PC.'),
        st: { api: 'Text Completion → KoboldCpp', url: port => `http://127.0.0.1:${port}/` },
        needsModel: 'gguf',
        opts: [{ key: 'model', kind: 'model', label: N('Model') }, ...COMMON, { key: 'port', kind: 'number', label: N('Port'), default: 5001 }, { key: 'extra', kind: 'text', label: N('More options'), default: '' }],
        exe: dir => path.join(dir, 'koboldcpp.exe'),
        found: () => [path.join(launcherBatRoot(), 'text-completion', 'dev-koboldcpp')],
        async install(dir, id) {
            const kind = await gpuKind();
            const rel = await latestRelease('LostRuins/koboldcpp');
            const src = assetOf(rel, kind === 'cuda' ? /^koboldcpp\.exe$/ : /^koboldcpp-nocuda\.exe$/);
            fs.mkdirSync(dir, { recursive: true });
            const tmp = path.join(dir, 'koboldcpp.exe.partial');
            await download(id, src, tmp);
            fs.rmSync(path.join(dir, 'koboldcpp.exe'), { force: true });
            fs.renameSync(tmp, path.join(dir, 'koboldcpp.exe'));
            writeMeta(dir, { version: rel.tag_name, asset: src.name });
        },
        latest: async () => (await latestRelease('LostRuins/koboldcpp')).tag_name,
        async command(dir, o, port) {
            const kind = await gpuKind();
            const args = ['--port', String(port), '--host', '127.0.0.1', '--contextsize', String(o.ctx), '--gpulayers', layersArg(o.layers)];
            if (kind === 'cuda') args.push('--usecuda'); else if (kind === 'vulkan') args.push('--usevulkan');
            // Without a model, KoboldCpp's own launcher window opens to pick one.
            if (o.model) args.unshift('--model', o.model, '--skiplauncher');
            return { cmd: path.join(dir, 'koboldcpp.exe'), args: [...args, ...splitArgs(o.extra)], cwd: dir };
        },
    },
    {
        id: 'llamacpp', name: 'llama.cpp', group: 'text', temp: /^(llama-b\d+|cudart-llama)-.*\.zip(\.partial)?$/, site: 'https://github.com/ggml-org/llama.cpp', port: 8080,
        desc: N('The engine behind most local AI apps, as a small server with a chat page. Runs GGUF models, updated almost daily.'),
        st: { api: 'Text Completion → llama.cpp', url: port => `http://127.0.0.1:${port}/` },
        needsModel: 'gguf',
        opts: [{ key: 'model', kind: 'model', label: N('Model') }, ...COMMON, { key: 'port', kind: 'number', label: N('Port'), default: 8080 }, { key: 'extra', kind: 'text', label: N('More options'), default: '' }],
        exe: dir => path.join(dir, 'llama-server.exe'),
        found: () => [path.join(launcherBatRoot(), 'text-completion', 'dev-llamacpp')],
        async install(dir, id) {
            const kind = await gpuKind();
            const backend = kind === 'cuda' ? 'cuda-12\\.4' : kind === 'vulkan' ? 'vulkan' : 'cpu';
            const main = new RegExp(`^llama-b\\d+-bin-win-${backend}-x64\\.zip$`);
            const rel = await releaseWith('ggml-org/llama.cpp', main);
            const parts = [assetOf(rel, main)];
            if (kind === 'cuda') parts.push(assetOf(rel, /^cudart-llama-bin-win-cuda-12\.4-x64\.zip$/));
            const tmp = `${dir}.partial`;
            ofs.rmSync(tmp, { recursive: true, force: true });
            fs.mkdirSync(tmp, { recursive: true });
            for (const src of parts) {
                const zip = path.join(path.dirname(dir), src.name);
                await download(id, src, zip);
                set(id, { step: t('Unpacking {name}', { name: src.name }), progress: null });
                await unzip(zip, tmp, false);
                fs.rmSync(zip, { force: true });
            }
            flatten(tmp);
            if (!fs.existsSync(path.join(tmp, 'llama-server.exe'))) throw new Error(t('the download has no {file}', { file: 'llama-server.exe' }));
            writeMeta(tmp, { version: rel.tag_name, asset: parts[0].name });
            swapIn(tmp, dir);
        },
        latest: async () => (await releaseWith('ggml-org/llama.cpp', /^llama-b\d+-bin-win-/)).tag_name,
        async command(dir, o, port) {
            if (!o.model) throw new Error(t('Pick a model first.'));
            return { cmd: path.join(dir, 'llama-server.exe'), args: ['-m', o.model, '--host', '127.0.0.1', '--port', String(port), '-c', String(o.ctx), '-ngl', layersArg(o.layers), ...splitArgs(o.extra)], cwd: dir };
        },
    },
    {
        id: 'ooba', name: 'Text generation web UI', group: 'text', temp: /^textgen-portable-.*\.zip(\.partial)?$/, site: 'https://github.com/oobabooga/text-generation-webui', port: 7860, apiPort: 5000,
        desc: N('Oobabooga\'s web UI: many settings, chat page, and an API for SillyTavern. This app installs its portable build (no Python setup).'),
        st: { api: 'Text Completion → Text Generation WebUI (ooba)', url: (_p, o) => `http://127.0.0.1:${o.apiPort || 5000}/` },
        opts: [{ key: 'model', kind: 'model', label: N('Model (optional; pick one in its page instead)') }, { key: 'port', kind: 'number', label: N('Port of its page'), default: 7860 }, { key: 'apiPort', kind: 'number', label: N('API port (for SillyTavern)'), default: 5000 }, { key: 'extra', kind: 'text', label: N('More options'), default: '' }],
        // Portable builds since 4.x: textgen.bat + app/ (its own Python); older
        // portable builds and full installs (Launcher.bat's): start_windows.bat.
        exe: dir => (fs.existsSync(path.join(dir, 'textgen.bat')) ? path.join(dir, 'textgen.bat') : path.join(dir, 'start_windows.bat')),
        found: () => [path.join(launcherBatRoot(), 'text-completion', 'text-generation-webui')],
        async install(dir, id) {
            const kind = await gpuKind();
            const rel = await latestRelease('oobabooga/text-generation-webui');
            const flavor = kind === 'cuda' ? 'cuda12\\.4' : kind === 'vulkan' ? 'vulkan' : 'cpu';
            const src = assetOf(rel, new RegExp(`^textgen-portable-[\\d.]+-windows-${flavor}\\.zip$`));
            const zip = path.join(path.dirname(dir), src.name);
            await download(id, src, zip);
            const tmp = `${dir}.partial`;
            ofs.rmSync(tmp, { recursive: true, force: true });
            set(id, { step: t('Unpacking {name}', { name: src.name }), progress: null });
            await unzip(zip, tmp, false);
            fs.rmSync(zip, { force: true });
            flatten(tmp);
            if (!fs.existsSync(path.join(tmp, 'textgen.bat')) && !fs.existsSync(path.join(tmp, 'start_windows.bat'))) throw new Error(t('the download has no {file}', { file: 'textgen.bat' }));
            // An update keeps the user's chats, presets and characters.
            const keep = path.join(dir, 'user_data');
            if (ofs.existsSync(keep)) { ofs.rmSync(path.join(tmp, 'user_data'), { recursive: true, force: true }); ofs.renameSync(keep, path.join(tmp, 'user_data')); }
            writeMeta(tmp, { version: rel.tag_name, asset: src.name });
            swapIn(tmp, dir);
        },
        latest: async () => (await latestRelease('oobabooga/text-generation-webui')).tag_name,
        async command(dir, o, port) {
            const args = ['--listen-port', String(port), '--api', '--api-port', String(o.apiPort || 5000), '--model-dir', modelsDir()];
            if (o.model) args.push('--model', path.basename(o.model));
            // Its server directly (its own Python), without its Electron window: the page opens as a tab here.
            const app = path.join(dir, 'app');
            const py = path.join(app, 'portable_env', 'python.exe');
            if (fs.existsSync(py)) return { cmd: py, args: [path.join(app, 'server.py'), '--portable', ...args, ...splitArgs(o.extra)], cwd: app, env: { PYTHONUTF8: '1' } };
            return { cmd: 'cmd.exe', args: ['/d', '/c', path.join(dir, 'start_windows.bat'), ...args, ...splitArgs(o.extra)], cwd: dir };
        },
    },
    {
        id: 'tabbyapi', name: 'TabbyAPI', group: 'text', site: 'https://github.com/theroyallab/tabbyAPI', port: 5005, nvidiaOnly: true,
        desc: N('A fast API server for EXL3/EXL2 models on NVIDIA cards (no chat page of its own). Installed with uv; the download is large (about 4 GB).'),
        st: { api: 'Text Completion → TabbyAPI', url: port => `http://127.0.0.1:${port}/`, key: dir => tabbyKey(dir) },
        page: (port, dir) => `http://127.0.0.1:${port}/ui/${tabbyKey(dir) ? `#key=${tabbyKey(dir)}` : ''}`,
        opts: [{ key: 'tabbyModel', kind: 'folder', label: N('Model (a folder in its models folder)') }, { key: 'port', kind: 'number', label: N('Port'), default: 5005 }, { key: 'extra', kind: 'text', label: N('More options'), default: '' }],
        exe: dir => path.join(dir, 'main.py'),
        found: () => [path.join(launcherBatRoot(), 'text-completion', 'tabbyAPI')],
        modelFolder: dir => path.join(dir, 'models'),
        async install(dir, id) {
            if ((await gpuKind()) !== 'cuda') throw new Error(t('TabbyAPI needs an NVIDIA graphics card.'));
            const uv = await ensureUv(id);
            if (!fs.existsSync(path.join(dir, '.git'))) {
                fs.mkdirSync(path.dirname(dir), { recursive: true });
                set(id, { step: t('Downloading {name}', { name: 'TabbyAPI' }), progress: null });
                const r = await gitRun(id, ['clone', '--depth', '1', 'https://github.com/theroyallab/tabbyAPI', dir], path.dirname(dir));
                if (r.code !== 0) throw new Error(t('git clone failed'));
            }
            await uvInstall(id, uv, dir);
            writeMeta(dir, { version: await gitHead(dir) });
        },
        async update(dir, id) {
            const r = await gitRun(id, ['pull', '--ff-only'], dir);
            if (r.code !== 0) throw new Error(t('git pull failed'));
            await uvInstall(id, await ensureUv(id), dir);
            writeMeta(dir, { version: await gitHead(dir) });
        },
        latest: null,
        async command(dir, o, port) {
            const py = pyOf(dir, 'tabbyapi');
            const args = [path.join(dir, 'main.py'), '--host', '127.0.0.1', '--port', String(port)];
            if (o.tabbyModel) args.push('--model-name', o.tabbyModel);
            return { cmd: py, args: [...args, ...splitArgs(o.extra)], cwd: dir };
        },
    },
];
const byId = id => APPS.find(a => a.id === id);

// TabbyAPI writes its API keys on first start; SillyTavern needs one.
function tabbyKey(dir) {
    try { return /api_key:\s*['"]?([0-9a-f]+)/i.exec(fs.readFileSync(path.join(dir, 'api_tokens.yml'), 'utf8'))?.[1] || ''; } catch { return ''; }
}

// ---------- uv (Python for Python apps) ----------
const uvExe = () => path.join(ctx.userData, 'tools', 'uv.exe');
async function ensureUv(id) {
    if (fs.existsSync(uvExe())) return uvExe();
    const rel = await latestRelease('astral-sh/uv');
    const src = assetOf(rel, /^uv-x86_64-pc-windows-msvc\.zip$/);
    const dir = path.dirname(uvExe());
    fs.mkdirSync(dir, { recursive: true });
    const zip = path.join(dir, src.name);
    await download(id, src, zip);
    const tmp = path.join(dir, 'uv.partial');
    fs.rmSync(tmp, { recursive: true, force: true });
    await unzip(zip, tmp, false);
    fs.rmSync(zip, { force: true });
    for (const f of ['uv.exe', 'uvx.exe']) {
        const from = [path.join(tmp, f), ...fs.readdirSync(tmp).map(d => path.join(tmp, d, f))].find(p => fs.existsSync(p));
        if (from) fs.renameSync(from, path.join(dir, f));
    }
    fs.rmSync(tmp, { recursive: true, force: true });
    if (!fs.existsSync(uvExe())) throw new Error(t('the download has no {file}', { file: 'uv.exe' }));
    log(id, `uv ${rel.tag_name} is ready.`);
    return uvExe();
}
// Python and the package cache live in the apps folder (gigabytes, not on C: by force).
const pathKey = () => Object.keys(process.env).find(k => k.toUpperCase() === 'PATH') || 'Path';
// process.env with more folders in front of PATH (keeps Windows' own spelling of the key).
const withPath = (dirs, env = process.env) => ({ ...env, [pathKey()]: [...dirs, env[pathKey()] || ''].join(path.delimiter) });
const uvEnv = () => withPath([path.dirname(uvExe())], { ...process.env, UV_PYTHON_INSTALL_DIR: path.join(appsDir(), '.python'), UV_CACHE_DIR: path.join(appsDir(), '.uv-cache'), UV_LINK_MODE: 'copy' });
// A Python environment in <dir>/.venv. "seed" adds pip (for apps that install
// their own packages when they start); "relocatable" keeps its programs
// working if the folder moves.
async function uvVenv(id, dir, python, { seed = false } = {}) {
    set(id, { step: t('Setting up Python (uv)…'), progress: null });
    const r = await runLogged(id, uvExe(), ['venv', '--python', python, '--allow-existing', '--relocatable', ...(seed ? ['--seed'] : []), path.join(dir, '.venv')], dir, uvEnv());
    if (r.code !== 0) throw new Error(t('uv could not set up Python'));
    return path.join(dir, '.venv', 'Scripts', 'python.exe');
}
async function uvPip(id, dir, args, step = t('Installing its packages (several GB)…')) {
    set(id, { step, progress: null });
    const r = await runLogged(id, uvExe(), ['pip', 'install', '--python', path.join(dir, '.venv', 'Scripts', 'python.exe'), ...args], dir, uvEnv());
    if (r.code !== 0) throw new Error(t('installing its packages failed (see its log)'));
}
// The download cache doubles the space (several GB) and isn't needed afterwards.
const uvCacheClean = (id, dir) => runLogged(id, uvExe(), ['cache', 'clean'], dir, uvEnv());
async function uvInstall(id, uv, dir) {
    await uvVenv(id, dir, '3.12');
    await uvPip(id, dir, ['-e', `${dir}[cu12]`]);
    await uvCacheClean(id, dir);
}
// The Python an app runs with: its own environment (ours: .venv; its own
// scripts: venv), else the Miniconda environment SillyTavern-Launcher made.
export function pyOf(dir, condaEnv) {
    const tries = [path.join(dir, '.venv', 'Scripts', 'python.exe'), path.join(dir, 'venv', 'Scripts', 'python.exe')];
    if (condaEnv) tries.push(path.join(process.env.USERPROFILE || '', 'miniconda3', 'envs', condaEnv, 'python.exe'));
    return tries.find(p => fs.existsSync(p)) || tries[0];
}
// Git apps: a clone (kept when an earlier install stopped half way), its branch optional.
async function gitClone(id, url, dir, branch) {
    if (fs.existsSync(path.join(dir, '.git'))) return;
    if (fs.existsSync(dir) && fs.readdirSync(dir).length) throw new Error(t('{dir} is not empty.', { dir }));
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    set(id, { step: t('Downloading {name}', { name: url.split('/').pop().replace(/\.git$/, '') }), progress: null });
    const r = await gitRun(id, ['clone', '--depth', '1', ...(branch ? ['-b', branch] : []), url, dir], path.dirname(dir));
    if (r.code !== 0) throw new Error(t('git clone failed'));
}
async function gitPull(id, dir) {
    const r = await gitRun(id, ['pull', '--ff-only'], dir);
    if (r.code !== 0) throw new Error(t('git pull failed'));
}
function gitHead(dir) {
    return new Promise(resolve => {
        const kid = spawn('git', ['log', '-1', '--format=%cs %h'], { cwd: dir, windowsHide: true });
        let out = '';
        kid.stdout.on('data', d => { out += d; });
        kid.on('error', () => resolve(''));
        kid.on('close', () => resolve(out.trim()));
    });
}
// Runs a step of an app's own setup (e.g. "launch.py --exit") and fails on a non-zero exit.
async function runStep(id, cmd, args, cwd, env, step) {
    set(id, { step, progress: null });
    const r = await runLogged(id, cmd, args, cwd, env);
    if (r.code !== 0) throw new Error(t('installing its packages failed (see its log)'));
}

// For the image and voice apps (aiapps-media.js).
APPS.push(...mediaApps({
    t, N, latestRelease, releaseWith, assetOf, download, flatten, gpuKind, ensureUv, uvEnv, uvVenv, uvPip, uvCacheClean,
    gitClone, gitPull, gitHead, runStep, runLogged, log, set, splitArgs, writeMeta, meta, withPath, pyOf,
    appsDir, imageModelsDir, comfyYaml, launcherBatRoot, fetchTo, unzip, swapIn,
}));

// ---------- processes ----------
function splitArgs(s) { return (String(s || '').match(/"[^"]*"|\S+/g) || []).map(a => a.replace(/^"|"$/g, '')); }
function log(id, line) {
    const st = getState(id);
    // Without terminal colour codes (ComfyUI, uv and others colour their output).
    // eslint-disable-next-line no-control-regex
    const l = `[${new Date().toLocaleTimeString('en-GB')}] ${String(line).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')}`;
    st.log.push(l);
    if (st.log.length > LOG_MAX) st.log.splice(0, st.log.length - LOG_MAX);
    ctx.logged(id, l);
}
function runLogged(id, cmd, args, cwd, env) {
    return new Promise(resolve => {
        let kid;
        try { kid = spawn(cmd, args, { cwd, env, windowsHide: true }); } catch (e) { log(id, `ERROR: ${e.message}`); resolve({ code: -1 }); return; }
        getState(id).child = kid;
        onLines(kid.stdout, l => l.trim() && log(id, l.trim()));
        onLines(kid.stderr, l => l.trim() && log(id, l.trim()));
        kid.on('error', e => { log(id, `ERROR: ${e.message}`); resolve({ code: -1 }); });
        kid.on('close', code => { getState(id).child = null; resolve({ code }); });
    });
}
const gitRun = (id, args, cwd) => runLogged(id, 'git', args, cwd, process.env);
const getState = id => { if (!state.has(id)) state.set(id, { status: '', log: [], error: '', progress: null, step: '' }); return state.get(id); };
function set(id, patch) {
    Object.assign(getState(id), patch);
    ctx.changed(id, view(byId(id)));
}

// Where an app is installed: the apps folder, or where Launcher.bat put it.
export function dirOf(app) {
    const own = path.join(appsDir(), app.id);
    if (fs.existsSync(app.exe(own))) return own;
    for (const d of app.found()) if (d && fs.existsSync(app.exe(d))) return d;
    return own;
}
export function optionsOf(app) {
    const saved = S().appOptions?.[app.id] || {};
    const o = Object.fromEntries(app.opts.map(x => [x.key, x.key in saved ? saved[x.key] : x.default ?? '']));
    if (o.port === '' || o.port == null) o.port = app.port;
    return o;
}
export function view(app) {
    const st = getState(app.id);
    const dir = dirOf(app);
    const fromLauncherBat = !dir.startsWith(appsDir());
    const exists = fs.existsSync(app.exe(dir));
    const m = exists ? meta(dir) : null;
    // Apps set up in several steps count as installed once the last step wrote desktop-app.json.
    const installed = exists && (!app.resumable || fromLauncherBat || !!m);
    const o = optionsOf(app);
    const port = Number(o.port) || app.port;
    return {
        id: app.id, name: app.name, group: app.group, desc: t(app.desc), site: app.site, nvidiaOnly: !!app.nvidiaOnly,
        note: app.note ? t(app.note) : '', size: app.size ? t(app.size) : '', extraFolder: app.extraFolder ? { sub: app.extraFolder.sub, label: t(app.extraFolder.label) } : null, license: app.license ? { name: app.license.name, url: app.license.url } : null,
        dir, installed, incomplete: exists && !installed, fromLauncherBat: installed && fromLauncherBat, version: m?.version || (installed ? '?' : ''),
        status: st.status || (installed ? 'installed' : 'missing'), error: st.error, progress: st.progress, step: st.step,
        running: !!st.server, port,
        url: app.page ? app.page(port, dir) : `http://127.0.0.1:${port}/`,
        connect: app.st ? { api: app.st.api, url: app.st.url(port, o), key: app.st.key ? app.st.key(dir) : '', how: t(app.st.how || N('In SillyTavern: the plug icon (API Connections) → API, then paste the address and click Connect.')) } : null,
        noConnect: app.st ? '' : t(app.noConnect || N('SillyTavern cannot use this app directly. Use its own page.')),
        opts: app.opts.map(x => ({ ...x, label: t(x.label), hint: x.hint ? t(x.hint) : '' })), values: o,
        autostart: !!S().appAutostart?.[app.id],
        // Python apps from SillyTavern-Launcher use its Miniconda: they are updated there, not here.
        canUpdate: installed && !!(app.latest || app.update) && !(app.resumable && fromLauncherBat), modelFolder: app.modelFolder ? app.modelFolder(dir) : null,
        folders: app.modelFolder ? listFolders(app.modelFolder(dir)) : null,
    };
}
export const list = () => APPS.map(view);
export const logOf = id => getState(id).log.slice();
// Apps with something to show in the launcher's console (cheap: no disk checks).
export const logSources = () => APPS.filter(a => getState(a.id).log.length || ['installing', 'starting', 'running', 'stopping'].includes(getState(a.id).status))
    .map(a => ({ id: a.id, name: a.name, status: getState(a.id).status }));

export async function install(id, { update = false } = {}) {
    const app = byId(id);
    const st = getState(id);
    if (!app || st.status === 'installing') return view(app);
    if (st.server) await stop(id);
    const dir = update ? dirOf(app) : path.join(appsDir(), app.id);
    set(id, { status: 'installing', error: '', progress: null, step: t('Starting…') });
    log(id, `${update ? 'Updating' : 'Installing'} ${app.name} in ${dir} …`);
    try {
        if (update && app.update) await app.update(dir, id);
        else await app.install(dir, id);
        log(id, `${app.name} is ${update ? 'up to date' : 'installed'}.`);
        set(id, { status: '', progress: null, step: '' });
    } catch (e) {
        log(id, `ERROR: ${e.message}`);
        // Nothing half-done stays behind (the old install, if any, is untouched).
        try {
            ofs.rmSync(`${dir}.partial`, { recursive: true, force: true });
            if (app.temp) for (const f of fs.readdirSync(path.dirname(dir))) if (app.temp.test(f)) ofs.rmSync(path.join(path.dirname(dir), f), { force: true });
        } catch { /* best effort */ }
        set(id, { status: '', error: e.message, progress: null, step: '' });
    }
    return view(app);
}
export async function latestVersion(id) {
    const app = byId(id);
    try { return app.latest ? await app.latest() : null; } catch { return null; }
}

// Started apps are tracked until they exit; "running" once their page answers.
export async function start(id) {
    const app = byId(id);
    const st = getState(id);
    if (!app || st.server) return view(app);
    const dir = dirOf(app);
    if (!view(app).installed) { set(id, { error: t('{name} is not installed.', { name: app.name }) }); return view(app); }
    // Its license is accepted in the launcher (main.js asks); started any other way, it would wait for an answer nobody sees.
    if (app.license && !S().appOptions?.[id]?.licenseOk) { set(id, { error: t('Start it once from the AI apps page to accept its model\'s license.') }); return view(app); }
    const o = optionsOf(app);
    if (o.model && !fs.existsSync(o.model)) o.model = '';
    const port = Number(o.port) || app.port;
    let c;
    try { c = await app.command(dir, o, port, !!S().appOptions?.[id]?.licenseOk); } catch (e) { set(id, { error: e.message }); return view(app); }
    log(id, `Starting ${app.name}: ${path.basename(c.cmd)} ${c.args.join(' ')}`);
    let kid;
    try { kid = spawn(c.cmd, c.args, { cwd: c.cwd, windowsHide: true, env: { ...process.env, PYTHONUNBUFFERED: '1', ...(c.env || {}) } }); } catch (e) { set(id, { error: e.message }); return view(app); }
    st.server = kid;
    set(id, { status: 'starting', error: '' });
    onLines(kid.stdout, l => l.trim() && log(id, l.trim()));
    onLines(kid.stderr, l => l.trim() && log(id, l.trim()));
    kid.on('error', e => { st.server = null; set(id, { status: '', error: e.message }); });
    kid.on('exit', code => {
        st.server = null;
        log(id, `${app.name} stopped${code ? ` (code ${code})` : ''}.`);
        set(id, { status: '', error: st.status === 'starting' && code ? t('{name} stopped while starting (see its log).', { name: app.name }) : '' });
    });
    waitUp(id, port);
    return view(app);
}
function waitUp(id, port, started = Date.now()) {
    const st = getState(id);
    if (!st.server || st.status !== 'starting') return;
    const req = http.get(`http://127.0.0.1:${port}/`, { timeout: 2000 }, res => {
        res.resume();
        set(id, { status: 'running' });
        log(id, `Ready on http://127.0.0.1:${port}/`);
    });
    const again = () => { if (Date.now() - started < 30 * 60e3) setTimeout(() => waitUp(id, port, started), 1500); };
    req.on('timeout', () => { req.destroy(); again(); });
    req.on('error', again);
}
export function stop(id, { wait = false } = {}) {
    const st = getState(id);
    const kid = st.server || st.child;
    if (!kid) return Promise.resolve(view(byId(id)));
    set(id, { status: 'stopping' });
    const args = ['/PID', String(kid.pid), '/T', '/F'];
    if (wait) { try { execFileSync('taskkill', args, { windowsHide: true, stdio: 'ignore', timeout: 5000 }); } catch { /* gone */ } }
    else spawn('taskkill', args, { windowsHide: true });
    return new Promise(resolve => {
        if (wait || !st.server) { resolve(view(byId(id))); return; }
        kid.once('exit', () => resolve(view(byId(id))));
        setTimeout(() => resolve(view(byId(id))), 10000);
    });
}
export function stopAll(opts) { for (const a of APPS) stop(a.id, opts); }
export const running = () => APPS.filter(a => getState(a.id).server).map(a => a.id);

export function saveOptions(id, values) {
    const app = byId(id);
    if (!app) return null;
    const keep = {};
    for (const x of app.opts) {
        if (!(x.key in values)) continue;
        let v = values[x.key];
        if (x.kind === 'number') { v = Math.round(Number(v)); if (!Number.isFinite(v)) continue; if (x.min) v = Math.max(x.min, v); if (x.max) v = Math.min(x.max, v); }
        else v = String(v ?? '').slice(0, 1000);
        keep[x.key] = v;
    }
    const s = S();
    s.appOptions = { ...(s.appOptions || {}), [id]: { ...(s.appOptions?.[id] || {}), ...keep } };
    ctx.save();
    return view(app);
}
export function acceptLicense(id) {
    const s = S();
    s.appOptions = { ...(s.appOptions || {}), [id]: { ...(s.appOptions?.[id] || {}), licenseOk: true } };
    ctx.save();
}
export function setAutostart(id, on) {
    const s = S();
    s.appAutostart = { ...(s.appAutostart || {}), [id]: !!on };
    ctx.save();
    return view(byId(id));
}
export const autostartIds = () => APPS.filter(a => S().appAutostart?.[a.id] && view(a).installed).map(a => a.id);

// Removing goes to the Recycle Bin; models (in their own folder) stay.
export async function uninstall(id) {
    const app = byId(id);
    await stop(id);
    const dir = dirOf(app);
    if (!fs.existsSync(dir)) return view(app);
    await shell.trashItem(path.resolve(dir));
    log(id, `Moved ${dir} to the Recycle Bin.`);
    set(id, { status: '', error: '' });
    return view(app);
}

// ---------- models ----------
function listFolders(dir) {
    try { return fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name); } catch { return []; }
}
// GGUF files in the models folder (and one level of subfolders); split models count once.
export function models() {
    const dir = modelsDir();
    const out = [];
    const walk = (d, depth) => {
        let items = [];
        try { items = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
        for (const it of items) {
            const p = path.join(d, it.name);
            if (it.isDirectory() && depth < 1) walk(p, depth + 1);
            else if (/\.gguf$/i.test(it.name) && !/-0000[2-9]-of-|-000[1-9]\d-of-/.test(it.name) && !/^mmproj/i.test(it.name)) {
                let size = fs.statSync(p).size;
                const split = /-00001-of-(\d{5})\.gguf$/i.exec(it.name);
                if (split) for (let i = 2; i <= Number(split[1]); i++) { try { size += fs.statSync(p.replace('-00001-of-', `-${String(i).padStart(5, '0')}-of-`)).size; } catch { /* missing part */ } }
                out.push({ path: p, name: it.name, size });
            }
        }
    };
    walk(dir, 0);
    return out.sort((a, b) => a.name.localeCompare(b.name));
}
export async function removeModel(file) {
    const p = path.resolve(file);
    if (!p.toLowerCase().startsWith(path.resolve(modelsDir()).toLowerCase() + path.sep)) return false;
    await shell.trashItem(p);
    return true;
}

// Well-known GGUF models, smallest first (checked to exist on Hugging Face).
export const SUGGESTED = [
    { repo: 'bartowski/Llama-3.2-3B-Instruct-GGUF', size: 3, note: N('Small and quick; fine for testing.') },
    { repo: 'bartowski/L3-8B-Stheno-v3.2-GGUF', size: 8, note: N('Made for roleplay; a favourite for 8 GB cards.') },
    { repo: 'bartowski/Meta-Llama-3.1-8B-Instruct-GGUF', size: 8, note: N('All-round assistant.') },
    { repo: 'bartowski/gemma-2-9b-it-GGUF', size: 9, note: N('Good writing for its size.') },
    { repo: 'TheDrummer/Rocinante-12B-v1.1-GGUF', size: 12, note: N('Made for roleplay and stories.') },
    { repo: 'bartowski/MN-12B-Mag-Mell-R1-GGUF', size: 12, note: N('Made for roleplay; creative.') },
    { repo: 'bartowski/Mistral-Nemo-Instruct-2407-GGUF', size: 12, note: N('All-round, long context.') },
    { repo: 'bartowski/Qwen2.5-14B-Instruct-GGUF', size: 14, note: N('Smart all-rounder.') },
    { repo: 'bartowski/Mistral-Small-24B-Instruct-2501-GGUF', size: 24, note: N('Strong; needs 16 GB or more.') },
];
const HF = 'https://huggingface.co';
async function hfJson(url) {
    const res = await net.fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(t('Hugging Face answered {status}', { status: String(res.status) }));
    return res.json();
}
export async function searchModels(q) {
    const list = await hfJson(`${HF}/api/models?search=${encodeURIComponent(q)}&filter=gguf&sort=downloads&direction=-1&limit=25`);
    return list.map(m => ({ repo: m.id, downloads: m.downloads || 0 }));
}
// The GGUF files of a repository, with sizes and SHA256 (split files grouped).
export async function repoFiles(repo) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error(t('Not a Hugging Face model name (like owner/model).'));
    const tree = await hfJson(`${HF}/api/models/${repo}/tree/main?recursive=true`);
    const files = tree.filter(f => f.type === 'file' && /\.gguf$/i.test(f.path) && !/mmproj/i.test(f.path));
    const groups = new Map();
    for (const f of files) {
        const key = f.path.replace(/-\d{5}-of-\d{5}\.gguf$/i, '.gguf');
        const g = groups.get(key) || { name: path.basename(key), parts: [], size: 0 };
        g.parts.push({ path: f.path, size: f.size, sha256: f.lfs?.oid || null });
        g.size += f.size;
        groups.set(key, g);
    }
    const quant = n => /(I?Q\d_[A-Z0-9_]+|Q\d_\d|F16|BF16|F32)/i.exec(n)?.[1]?.toUpperCase() || '';
    return [...groups.values()].map(g => ({ ...g, quant: quant(g.name), parts: g.parts.sort((a, b) => a.path.localeCompare(b.path)) })).sort((a, b) => a.size - b.size);
}
// For Tabby: every file of a repository (or one of its branches: EXL3/EXL2
// repositories keep each size, like 4.0bpw, on a branch of its own).
const REF = /^[\w.-]{1,60}$/;
export async function repoAll(repo, ref = 'main') {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error(t('Not a Hugging Face model name (like owner/model).'));
    if (!REF.test(ref)) throw new Error('bad branch');
    const tree = await hfJson(`${HF}/api/models/${repo}/tree/${encodeURIComponent(ref)}?recursive=true`);
    return tree.filter(f => f.type === 'file').map(f => ({ path: f.path, size: f.size, sha256: f.lfs?.oid || null }));
}
export async function repoBranches(repo) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error(t('Not a Hugging Face model name (like owner/model).'));
    const refs = await hfJson(`${HF}/api/models/${repo}/refs`);
    return (refs.branches || []).map(b => b.name).filter(b => b !== 'main');
}

// One download at a time; resumes a .partial left by a stopped one.
let dl = null; // { cancelled, ... }
export const downloading = () => (dl ? { repo: dl.repo, name: dl.name, done: dl.done, total: dl.total } : null);
export function cancelDownload() { if (dl) { dl.cancelled = true; dl.abort?.abort(); } }
export async function downloadModel({ repo, parts, folder, ref = 'main' }) {
    if (dl) return { error: t('Another download is running.') };
    const destDir = folder || modelsDir();
    fs.mkdirSync(destDir, { recursive: true });
    const total = parts.reduce((n, p) => n + p.size, 0);
    dl = { repo, name: path.basename(parts[0].path), done: 0, total, cancelled: false };
    const report = () => ctx.modelProgress(downloading());
    try {
        for (const p of parts) {
            const file = path.join(destDir, p.path.replace(/\//g, path.sep));
            if (!path.resolve(file).startsWith(path.resolve(destDir) + path.sep)) throw new Error('bad file name');
            fs.mkdirSync(path.dirname(file), { recursive: true });
            if (fs.existsSync(file) && fs.statSync(file).size === p.size) { dl.done += p.size; report(); continue; }
            await fetchResume(p.url || `${HF}/${repo}/resolve/${encodeURIComponent(ref)}/${p.path.split('/').map(encodeURIComponent).join('/')}`, file, p, report);
        }
        return { ok: true, path: path.join(destDir, parts[0].path) };
    } catch (e) {
        return dl?.cancelled ? { cancelled: true } : { error: e.message };
    } finally {
        dl = null;
        report();
    }
}
async function fetchResume(url, file, p, report) {
    const tmp = `${file}.partial`;
    let have = fs.existsSync(tmp) ? fs.statSync(tmp).size : 0;
    if (p.size && have > p.size) { fs.rmSync(tmp); have = 0; }
    dl.abort = new AbortController();
    const res = await net.fetch(url, { headers: { ...(p.headers || {}), ...(have ? { Range: `bytes=${have}-` } : {}) }, signal: dl.abort.signal });
    if (!res.ok) throw new Error(t('{site} answered {status}', { site: new URL(url).hostname, status: String(res.status) }));
    if (/text\/html/i.test(res.headers.get('content-type') || '')) throw new Error(t('{site} sent a web page instead of the file (it may need a sign-in or an API key).', { site: new URL(url).hostname }));
    if (have && res.status !== 206) have = 0; // no resume: start over
    // Civitai only tells the size roughly: take it from the answer.
    if (!p.size) { p.size = have + Number(res.headers.get('content-length') || 0); dl.total += p.size; }
    const out = fs.createWriteStream(tmp, { flags: have ? 'a' : 'w' });
    const base = dl.done;
    let got = have, last = 0;
    try {
        for await (const chunk of res.body) {
            if (dl.cancelled) throw new Error('cancelled');
            if (!out.write(chunk)) await new Promise(r => out.once('drain', r));
            got += chunk.length;
            if (Date.now() - last > 400) { last = Date.now(); dl.done = base + got; report(); }
        }
    } finally {
        await new Promise(r => out.end(r));
    }
    if (p.size && got !== p.size) throw new Error(t('the download stopped early ({got} of {size} bytes); start it again to continue', { got: String(got), size: String(p.size) }));
    if (p.sha256) {
        const hash = crypto.createHash('sha256');
        await new Promise((resolve, reject) => fs.createReadStream(tmp).on('data', d => hash.update(d)).on('end', resolve).on('error', reject));
        if (hash.digest('hex') !== p.sha256) { fs.rmSync(tmp, { force: true }); throw new Error(t('the file does not match its published SHA256')); }
    }
    fs.renameSync(tmp, file);
    dl.done = base + got;
    report();
}

// ---------- picture models (shared by the image apps) ----------
const IMAGE_FILE = /\.(safetensors|ckpt|pt|pth|bin|gguf)$/i;
export function imageModels() {
    const out = [];
    for (const kind of IMAGE_KINDS) {
        const dir = path.join(imageModelsDir(), kind);
        let items = [];
        try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
        for (const it of items) {
            if (it.isFile() && IMAGE_FILE.test(it.name)) out.push({ kind, name: it.name, path: path.join(dir, it.name), size: fs.statSync(path.join(dir, it.name)).size });
        }
    }
    return out.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
}
export async function removeImageModel(file) {
    const p = path.resolve(file);
    if (!p.toLowerCase().startsWith(path.resolve(imageModelsDir()).toLowerCase() + path.sep)) return false;
    await shell.trashItem(p);
    return true;
}
// ComfyUI (and Forge Neo) read the shared folders from this file; it lives in
// the apps folder, so installs made by SillyTavern-Launcher stay untouched.
export function comfyYaml() {
    const base = imageModelsDir();
    for (const k of IMAGE_KINDS) fs.mkdirSync(path.join(base, k), { recursive: true });
    const file = path.join(base, 'comfyui-paths.yaml');
    const text = `# Written by SillyTavern Desktop: the shared picture-model folders.\nsillytavern_desktop:\n    base_path: ${JSON.stringify(base.replace(/\\/g, '/'))}\n${IMAGE_KINDS.map(k => `    ${k}: ${k}`).join('\n')}\n`;
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) fs.writeFileSync(file, text);
    return file;
}
// Checkpoints that run on most cards (checked on Hugging Face 2026-11-04, none gated).
export const SUGGESTED_IMAGE = [
    { repo: 'stable-diffusion-v1-5/stable-diffusion-v1-5', file: 'v1-5-pruned-emaonly.safetensors', base: 'SD 1.5', vram: 4, note: N('The classic. Small and quick; 512×512 pictures.') },
    { repo: 'stabilityai/stable-diffusion-xl-base-1.0', file: 'sd_xl_base_1.0.safetensors', base: 'SDXL', vram: 8, note: N('Stability AI\'s own SDXL; 1024×1024 pictures.') },
    { repo: 'RunDiffusion/Juggernaut-XL-v9', file: 'Juggernaut-XL_v9_RunDiffusionPhoto_v2.safetensors', base: 'SDXL', vram: 8, note: N('Photos and realistic pictures.') },
    { repo: 'cagliostrolab/animagine-xl-4.0', file: 'animagine-xl-4.0-opt.safetensors', base: 'SDXL', vram: 8, note: N('Anime characters; knows many by name.') },
    { repo: 'OnomaAIResearch/Illustrious-XL-v2.0', file: 'Illustrious-XL-v2.0.safetensors', base: 'SDXL', vram: 8, note: N('Anime and illustration; base of many community models.') },
    { repo: 'Laxhar/noobai-XL-1.1', file: 'NoobAI-XL-v1.1.safetensors', base: 'SDXL', vram: 8, note: N('Anime, based on Illustrious; its own license.') },
];
// A link the user pasted → one checked file. Hugging Face: …/resolve|blob/<branch>/<file>;
// Civitai: a model page (?modelVersionId=…) or an /api/download/models/<version> link.
const CIVITAI_KIND = { Checkpoint: 'checkpoints', LORA: 'loras', LoCon: 'loras', DoRA: 'loras', TextualInversion: 'embeddings', VAE: 'vae', Upscaler: 'upscale_models' };
export async function resolveImageLink(input, civitaiKey = '') {
    let u;
    try { u = new URL(String(input).trim()); } catch { throw new Error(t('That is not a link.')); }
    if (u.protocol !== 'https:') throw new Error(t('Only https links work.'));
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'huggingface.co') {
        const m = /^\/([\w.-]+\/[\w.-]+)\/(?:resolve|blob)\/([\w.-]+)\/(.+)$/.exec(decodeURIComponent(u.pathname));
        if (!m) throw new Error(t('Use the link of one file (it has /resolve/ or /blob/ in it).'));
        const [, repo, ref, file] = m;
        const f = (await repoAll(repo, ref)).find(x => x.path === file);
        if (!f) throw new Error(t('That file is not in {repo}.', { repo }));
        return { name: path.basename(file), size: f.size, sha256: f.sha256, url: `${HF}/${repo}/resolve/${encodeURIComponent(ref)}/${file.split('/').map(encodeURIComponent).join('/')}`, kind: guessKind(file, f.size), source: repo };
    }
    if (host === 'civitai.com') {
        let version = u.searchParams.get('modelVersionId') || /^\/api\/download\/models\/(\d+)/.exec(u.pathname)?.[1];
        const model = /^\/models\/(\d+)/.exec(u.pathname)?.[1];
        const headers = civitaiKey ? { Authorization: `Bearer ${civitaiKey}` } : {};
        const cj = async api => {
            const res = await net.fetch(`https://civitai.com/api/v1/${api}`, { headers, cache: 'no-store' });
            if (!res.ok) throw new Error(t('{site} answered {status}', { site: 'civitai.com', status: String(res.status) }));
            return res.json();
        };
        let v;
        if (version) v = await cj(`model-versions/${encodeURIComponent(version)}`);
        else if (model) { const mj = await cj(`models/${encodeURIComponent(model)}`); v = { ...mj.modelVersions?.[0], model: { type: mj.type, name: mj.name } }; }
        else throw new Error(t('Use the link of a Civitai model page.'));
        const f = (v.files || []).find(x => x.primary) || v.files?.[0];
        const sha = /^[0-9a-f]{64}$/i.exec(f?.hashes?.SHA256 || '')?.[0];
        if (!f || !sha || !/^https:\/\/(www\.)?civitai\.com\//.test(f.downloadUrl || '')) throw new Error(t('Civitai lists no checked file for it.'));
        return { name: f.name, size: 0, approx: Math.round((f.sizeKB || 0) * 1024), sha256: sha.toLowerCase(), url: f.downloadUrl, headers, kind: CIVITAI_KIND[v.model?.type] || guessKind(f.name, (f.sizeKB || 0) * 1024), source: v.model?.name || 'Civitai' };
    }
    throw new Error(t('Only Hugging Face and Civitai links work here.'));
}
function guessKind(name, size) {
    if (/vae/i.test(name)) return 'vae';
    if (/upscal|esrgan|\b\dx[-_]/i.test(name)) return 'upscale_models';
    return size > 1.5e9 ? 'checkpoints' : 'loras';
}
export async function suggestedImageFile(s) {
    const f = (await repoAll(s.repo)).find(x => x.path === s.file);
    if (!f) throw new Error(t('That file is not in {repo}.', { repo: s.repo }));
    return { name: s.file, size: f.size, sha256: f.sha256, url: `${HF}/${s.repo}/resolve/main/${encodeURIComponent(s.file)}`, kind: 'checkpoints', source: s.repo };
}
export function downloadImageModel(f, kind) {
    if (!IMAGE_KINDS.includes(kind)) kind = f.kind;
    const name = path.basename(f.name).replace(/[<>:"|?*\\/]/g, '_');
    return downloadModel({ repo: f.source, parts: [{ path: name, size: f.size, sha256: f.sha256, url: f.url, headers: f.headers }], folder: path.join(imageModelsDir(), kind) });
}

// Free space where the models go (for the launcher's hint).
export function freeSpace() {
    let probe = modelsDir();
    while (!fs.existsSync(probe) && path.dirname(probe) !== probe) probe = path.dirname(probe);
    try { const s = fs.statfsSync(probe); return s.bavail * s.bsize; } catch { return null; }
}
