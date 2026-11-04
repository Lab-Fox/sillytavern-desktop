// aiapps-media.js — the picture and voice apps of the AI apps page (Launcher.bat's
// image-generation/ and voice-generation/), and the optional helper tools it
// installs with winget. The install/start machinery is in aiapps.js, which hands
// its helpers in as `h` (this file imports nothing from it).
import { net } from 'electron';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { N } from './i18n.js';

export function mediaApps(h) {
    const { t } = h;
    const lb = (...p) => path.join(h.launcherBatRoot(), ...p);
    const isCuda = async () => (await h.gpuKind()) === 'cuda';
    // PyTorch from its own index: the CUDA build for NVIDIA cards, else the processor one.
    const torch = async cudaTag => ['--torch-backend', (await isCuda()) ? cudaTag : 'cpu'];
    const finished = async (dir, version) => h.writeMeta(dir, { version: version || await h.gitHead(dir) });
    // Hugging Face downloads (voices, helper models) stay in the apps folder too, not on C:.
    // So does pip's cache (AUTOMATIC1111 and Forge install with pip: gigabytes otherwise left on C:).
    const pipCache = () => path.join(h.appsDir(), '.pip-cache');
    const pyEnv = (extra = {}) => ({ ...h.uvEnv(), PYTHONUTF8: '1', HF_HOME: path.join(h.appsDir(), '.hf-cache'), HF_HUB_DISABLE_SYMLINKS_WARNING: '1', PIP_CACHE_DIR: pipCache(), ...extra });
    const shared = kind => path.join(h.imageModelsDir(), kind);
    const sharedDirs = () => { h.comfyYaml(); return shared; }; // creates the folders
    const port = def => ({ key: 'port', kind: 'number', label: N('Port'), default: def });
    const extra = { key: 'extra', kind: 'text', label: N('More options'), default: '' };
    const SD_HOW = N('In SillyTavern: Extensions (the stacked boxes) → Image Generation → Source: Stable Diffusion Web UI (AUTOMATIC1111), paste the address and click Connect.');

    // AUTOMATIC1111 and Forge: their launch.py installs everything into the Python
    // it runs with ("--exit" stops after that). Stability AI's old repository is
    // gone; AUTOMATIC1111's own fix points at a copy of it.
    // Old packages they build (OpenAI's CLIP) still import pkg_resources, which
    // setuptools 81 dropped: their build environments get an older setuptools
    // (PIP_BUILD_CONSTRAINT for pip 26 and newer, PIP_CONSTRAINT before).
    const buildConstraints = () => {
        const file = path.join(h.appsDir(), '.pip-build-constraints.txt');
        if (!fs.existsSync(file)) { fs.mkdirSync(h.appsDir(), { recursive: true }); fs.writeFileSync(file, 'setuptools<81\n'); }
        return file;
    };
    const webuiEnv = async () => pyEnv({
        PIP_BUILD_CONSTRAINT: buildConstraints(), PIP_CONSTRAINT: buildConstraints(),
        STABLE_DIFFUSION_REPO: 'https://github.com/w-e-w/stablediffusion.git',
        ...((await isCuda()) ? {} : { TORCH_INDEX_URL: 'https://download.pytorch.org/whl/cpu' }),
    });
    const webuiCpu = async () => ((await isCuda()) ? [] : ['--skip-torch-cuda-test', '--use-cpu', 'all', '--no-half', '--precision', 'full']);
    const webui = ({ id, name, repo, branch, python, port: p, conda, folder, desc, neo }) => ({
        id, name, group: 'image', site: `https://github.com/${repo}`, port: p, resumable: true, nvidiaOnly: !!neo, size: N('about 10 GB'),
        desc,
        note: N('The first start takes a few minutes. It has no model of its own: download one under Picture models.'),
        st: { api: 'Image Generation → Stable Diffusion Web UI (AUTOMATIC1111)', url: q => `http://127.0.0.1:${q}`, how: SD_HOW },
        opts: [port(p), extra],
        exe: dir => path.join(dir, 'launch.py'),
        found: () => [lb('image-generation', folder)],
        async install(dir, aid) {
            await h.ensureUv(aid);
            await h.gitClone(aid, `https://github.com/${repo}.git`, dir, branch);
            await this.deps(dir, aid);
            await finished(dir);
        },
        async deps(dir, aid) {
            const py = await h.uvVenv(aid, dir, python, { seed: true });
            await h.runStep(aid, py, ['launch.py', '--exit', ...(neo ? ['--uv'] : await webuiCpu())], dir, await webuiEnv(), t('Installing its packages (several GB)…'));
            await h.uvCacheClean(aid, dir);
            fs.rmSync(pipCache(), { recursive: true, force: true });
        },
        async update(dir, aid) { await h.ensureUv(aid); await h.gitPull(aid, dir); await this.deps(dir, aid); await finished(dir); },
        latest: null,
        async command(dir, o, q) {
            // Forge Neo calls uv on every start (its --uv flag).
            if (neo) await h.ensureUv(id);
            const m = sharedDirs();
            const dirs = neo
                ? ['--uv', '--ckpt-dirs', m('checkpoints'), '--lora-dirs', m('loras')]
                : ['--ckpt-dir', m('checkpoints'), '--lora-dir', m('loras'), '--vae-dir', m('vae'), '--no-download-sd-model', ...(await webuiCpu())];
            return { cmd: h.pyOf(dir, conda), args: ['launch.py', '--api', '--port', String(q), '--embeddings-dir', m('embeddings'), ...dirs, ...h.splitArgs(o.extra)], cwd: dir, env: await webuiEnv() };
        },
    });

    // SwarmUI is a .NET program: the .NET 8 SDK goes into the apps folder (no installer, no admin).
    const dotnetDir = () => path.join(h.appsDir(), '.dotnet');
    // DOTNET_CLI_HOME keeps .NET's own files (first-use markers, NuGet packages) in the apps folder too.
    const dotnetEnv = () => h.withPath([dotnetDir()], { ...process.env, DOTNET_ROOT: dotnetDir(), DOTNET_CLI_HOME: path.join(h.appsDir(), '.dotnet-home'), NUGET_PACKAGES: path.join(h.appsDir(), '.nuget'), NUGET_HTTP_CACHE_PATH: path.join(h.appsDir(), '.nuget', 'http-cache'), NUGET_PLUGINS_CACHE_PATH: path.join(h.appsDir(), '.nuget', 'plugins-cache'), DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1', DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1' });
    async function ensureDotnet(aid) {
        const sdk = path.join(dotnetDir(), 'sdk');
        if (fs.existsSync(path.join(dotnetDir(), 'dotnet.exe')) && fs.existsSync(sdk) && fs.readdirSync(sdk).some(v => v.startsWith('8.'))) return;
        const res = await net.fetch('https://builds.dotnet.microsoft.com/dotnet/release-metadata/8.0/releases.json', { cache: 'no-store' });
        if (!res.ok) throw new Error(t('{site} answered {status}', { site: 'builds.dotnet.microsoft.com', status: String(res.status) }));
        const j = await res.json();
        const rel = j.releases.find(r => r.sdk?.version === j['latest-sdk']) || j.releases[0];
        const f = rel.sdk.files.find(x => x.rid === 'win-x64' && x.name.endsWith('.zip'));
        if (!f || !/^[0-9a-f]{128}$/i.test(f.hash || '') || !f.url.startsWith('https://')) throw new Error(t('no checked download found in {repo}\'s latest release', { repo: '.NET 8' }));
        const zip = path.join(h.appsDir(), `dotnet-sdk-${rel.sdk.version}-win-x64.zip`);
        fs.mkdirSync(h.appsDir(), { recursive: true });
        await h.download(aid, { url: f.url, sha512: f.hash.toLowerCase(), name: path.basename(f.url), size: 0 }, zip);
        const tmp = `${dotnetDir()}.partial`;
        fs.rmSync(tmp, { recursive: true, force: true });
        h.set(aid, { step: t('Unpacking {name}', { name: '.NET' }), progress: null });
        await h.unzip(zip, tmp, false);
        fs.rmSync(zip, { force: true });
        h.swapIn(tmp, dotnetDir());
        h.log(aid, `.NET SDK ${rel.sdk.version} is ready.`);
    }

    return [
        {
            id: 'comfyui', name: 'ComfyUI', group: 'image', site: 'https://github.com/Comfy-Org/ComfyUI', port: 8188, resumable: true, size: N('about 6 GB'),
            desc: N('The most flexible picture app: you build workflows from connected boxes. Comes with ComfyUI-Manager for adding custom nodes. Fast and light on memory.'),
            note: N('It has no model of its own: download one under Picture models.'),
            st: { api: 'Image Generation → ComfyUI', url: q => `http://127.0.0.1:${q}`, how: N('In SillyTavern: Extensions (the stacked boxes) → Image Generation → Source: ComfyUI, paste the address and click Connect.') },
            opts: [port(8188), extra],
            exe: dir => path.join(dir, 'main.py'),
            found: () => [lb('image-generation', 'ComfyUI')],
            async install(dir, aid) {
                await h.ensureUv(aid);
                await h.gitClone(aid, 'https://github.com/Comfy-Org/ComfyUI.git', dir);
                await this.deps(dir, aid);
                await finished(dir);
            },
            async deps(dir, aid) {
                await h.uvVenv(aid, dir, '3.12');
                const tb = await torch('cu128');
                await h.uvPip(aid, dir, ['torch', 'torchvision', 'torchaudio', ...tb], t('Installing PyTorch (about 3 GB)…'));
                await h.uvPip(aid, dir, ['-r', 'requirements.txt', ...tb]);
                if (fs.existsSync(path.join(dir, 'manager_requirements.txt'))) await h.uvPip(aid, dir, ['-r', 'manager_requirements.txt', ...tb]);
                await h.uvCacheClean(aid, dir);
            },
            async update(dir, aid) { await h.ensureUv(aid); await h.gitPull(aid, dir); await this.deps(dir, aid); await finished(dir); },
            latest: null,
            async command(dir, o, q) {
                const args = ['main.py', '--listen', '127.0.0.1', '--port', String(q), '--extra-model-paths-config', h.comfyYaml()];
                // ComfyUI-Manager ships with ComfyUI now and is switched on by a flag.
                if (fs.existsSync(path.join(dir, 'manager_requirements.txt'))) args.push('--enable-manager');
                if (!(await isCuda())) args.push('--cpu');
                return { cmd: h.pyOf(dir, 'comfyui'), args: [...args, ...h.splitArgs(o.extra)], cwd: dir, env: pyEnv() };
            },
        },
        webui({
            id: 'forgeneo', name: 'Forge Neo', repo: 'Haoming02/sd-webui-forge-classic', branch: 'neo', python: '3.13', port: 7863, folder: 'stable-diffusion-webui-forge-neo', conda: 'sdwebuiforgeneo', neo: true,
            desc: N('The maintained successor of Forge and AUTOMATIC1111: the familiar web UI with newer models (Flux, Qwen-Image, Wan video). NVIDIA cards only here.'),
        }),
        webui({
            id: 'forge', name: 'Forge', repo: 'lllyasviel/stable-diffusion-webui-forge', python: '3.10', port: 7862, folder: 'stable-diffusion-webui-forge', conda: 'sdwebuiforge',
            desc: N('AUTOMATIC1111\'s web UI made faster and lighter on memory (good for 6–8 GB cards). No longer updated; Forge Neo continues it.'),
        }),
        webui({
            id: 'sdwebui', name: 'Stable Diffusion web UI (AUTOMATIC1111)', repo: 'AUTOMATIC1111/stable-diffusion-webui', python: '3.10', port: 7861, folder: 'stable-diffusion-webui', conda: 'sdwebui',
            desc: N('The original Stable Diffusion web UI, with many extensions. No longer updated; Forge Neo is the maintained choice.'),
        }),
        {
            id: 'fooocus', name: 'Fooocus', group: 'image', site: 'https://github.com/lllyasviel/Fooocus', port: 7865, resumable: true, nvidiaOnly: true, size: N('about 15 GB with its models'),
            desc: N('Pictures from a prompt with almost no settings, like Midjourney. Only bug fixes now.'),
            note: N('The first start downloads its own models (about 7 GB) before the page answers.'),
            st: null, noConnect: N('SillyTavern cannot use Fooocus. Make pictures in its own page.'),
            opts: [port(7865), extra],
            exe: dir => path.join(dir, 'launch.py'),
            found: () => [lb('image-generation', 'Fooocus')],
            async install(dir, aid) {
                await h.ensureUv(aid);
                await h.gitClone(aid, 'https://github.com/lllyasviel/Fooocus.git', dir);
                await this.deps(dir, aid);
                // The shared picture folders after its own (it downloads into the first one).
                const cfg = path.join(dir, 'config.txt');
                if (!fs.existsSync(cfg)) {
                    const m = sharedDirs();
                    fs.writeFileSync(cfg, JSON.stringify({
                        path_checkpoints: [path.join(dir, 'models', 'checkpoints'), m('checkpoints')],
                        path_loras: [path.join(dir, 'models', 'loras'), m('loras')],
                    }, null, 4));
                }
                await finished(dir);
            },
            async deps(dir, aid) {
                await h.uvVenv(aid, dir, '3.10', { seed: true });
                const tb = await torch('cu121');
                await h.uvPip(aid, dir, ['torch==2.1.0', 'torchvision==0.16.0', ...tb], t('Installing PyTorch (about 3 GB)…'));
                // Its gradio 3.41 breaks with today's FastAPI/Starlette (TemplateResponse) and that
                // FastAPI with today's Pydantic: the 2023 versions (found by testing, 2026-11-04).
                await h.uvPip(aid, dir, ['-r', 'requirements_versions.txt', 'fastapi==0.104.1', 'pydantic<2.10', ...tb]);
                await h.uvCacheClean(aid, dir);
            },
            async update(dir, aid) { await h.ensureUv(aid); await h.gitPull(aid, dir); await this.deps(dir, aid); await finished(dir); },
            latest: null,
            async command(dir, o, q) {
                return { cmd: h.pyOf(dir, 'fooocus'), args: ['launch.py', '--listen', '127.0.0.1', '--port', String(q), '--disable-in-browser', ...h.splitArgs(o.extra)], cwd: dir, env: pyEnv() };
            },
        },
        {
            id: 'invokeai', name: 'InvokeAI', group: 'image', site: 'https://github.com/invoke-ai/InvokeAI', port: 9090, resumable: true, size: N('about 8 GB'),
            desc: N('A polished studio for pictures: canvas, layers, inpainting, and a model manager that downloads models for you.'),
            note: N('To use the shared picture models, open its Model Manager → Add models → Scan folder, and pick the picture models folder.'),
            st: null, noConnect: N('SillyTavern cannot use InvokeAI. Make pictures in its own page.'),
            opts: [port(9090)],
            exe: dir => {
                const own = path.join(dir, '.venv', 'Scripts', 'invokeai-web.exe');
                const conda = path.join(process.env.USERPROFILE || '', 'miniconda3', 'envs', 'invokeai', 'Scripts', 'invokeai-web.exe');
                return !fs.existsSync(own) && dir === lb('image-generation', 'InvokeAI') && fs.existsSync(conda) ? conda : own;
            },
            found: () => [lb('image-generation', 'InvokeAI')],
            async install(dir, aid) {
                await h.ensureUv(aid);
                const rel = await h.latestRelease('invoke-ai/InvokeAI');
                const version = rel.tag_name.replace(/^v/, '');
                fs.mkdirSync(dir, { recursive: true });
                await h.uvVenv(aid, dir, '3.12');
                // Invoke 7 and newer pin PyTorch's CUDA 13 build through its "cuda" extra.
                const cuda = await isCuda();
                const spec = cuda && parseInt(version, 10) >= 7 ? [`invokeai[cuda]==${version}`, '--torch-backend', 'cu130'] : [`invokeai==${version}`, '--torch-backend', cuda ? 'cu128' : 'cpu'];
                await h.uvPip(aid, dir, [...spec, '--reinstall-package', 'invokeai']);
                await h.uvCacheClean(aid, dir);
                await finished(dir, rel.tag_name);
            },
            async update(dir, aid) { await this.install(dir, aid); },
            latest: async () => (await h.latestRelease('invoke-ai/InvokeAI')).tag_name,
            async command(dir, o, q) {
                return { cmd: this.exe(dir), args: ['--root', dir], cwd: dir, env: pyEnv({ INVOKEAI_HOST: '127.0.0.1', INVOKEAI_PORT: String(q) }) };
            },
        },
        {
            id: 'swarmui', name: 'SwarmUI', group: 'image', site: 'https://github.com/mcmonkeyprojects/SwarmUI', port: 7801, resumable: true, size: N('about 1 GB, plus its back end'),
            desc: N('A friendly page for making pictures with ComfyUI working underneath; strong at comparing models and settings.'),
            note: N('On its first start its page walks you through installing its back end (ComfyUI) and a model.'),
            st: null, noConnect: N('SillyTavern cannot use SwarmUI. Make pictures in its own page.'),
            opts: [port(7801), extra],
            exe: dir => path.join(dir, 'src', 'bin', 'live_release', 'SwarmUI.exe'),
            found: () => [lb('image-generation', 'SwarmUI')],
            async install(dir, aid) {
                await ensureDotnet(aid);
                await h.gitClone(aid, 'https://github.com/mcmonkeyprojects/SwarmUI.git', dir);
                await this.build(dir, aid);
                await finished(dir);
            },
            async build(dir, aid) {
                await h.runStep(aid, path.join(dotnetDir(), 'dotnet.exe'), ['build', 'src/SwarmUI.csproj', '--configuration', 'Release', '-o', 'src/bin/live_release'], dir, dotnetEnv(), t('Building SwarmUI…'));
            },
            async update(dir, aid) { await ensureDotnet(aid); await h.gitPull(aid, dir); await this.build(dir, aid); await finished(dir); },
            latest: null,
            async command(dir, o, q) {
                return { cmd: this.exe(dir), args: ['--launch_mode', 'none', '--host', '127.0.0.1', '--port', String(q), ...h.splitArgs(o.extra)], cwd: dir, env: dotnetEnv() };
            },
        },
        {
            id: 'alltalk', name: 'AllTalk TTS v2', group: 'voice', site: 'https://github.com/erew123/alltalk_tts/tree/alltalkbeta', port: 7851, resumable: true, size: N('about 8 GB'),
            desc: N('Voices for SillyTavern\'s replies: several voice engines (Piper, XTTS, VITS, F5-TTS), voice cloning from a short sample, and RVC voices.'),
            note: N('Its port is set in its own settings page (7851 unless you change it there). Pick or download voice engines in its page.'),
            st: { api: 'TTS → AllTalk', url: q => `http://127.0.0.1:${q}`, how: N('In SillyTavern: Extensions (the stacked boxes) → TTS → Select TTS Provider: AllTalk, check the address, and click Connect.') },
            opts: [extra],
            // 7851 is its API (what SillyTavern uses); its own page is the next port.
            page: q => `http://127.0.0.1:${q + 1}/`,
            exe: dir => path.join(dir, 'script.py'),
            found: () => [lb('voice-generation', 'alltalk_tts')],
            async install(dir, aid) {
                await h.ensureUv(aid);
                await h.gitClone(aid, 'https://github.com/erew123/alltalk_tts.git', dir, 'alltalkbeta');
                await this.deps(dir, aid);
                await finished(dir);
            },
            async deps(dir, aid) {
                await h.uvVenv(aid, dir, '3.11');
                const tb = await torch('cu121');
                // What its own setup (atsetup.bat) installs, without DeepSpeed and Parler.
                await h.uvPip(aid, dir, ['torch==2.2.1', 'torchvision==0.17.1', 'torchaudio==2.2.1', ...tb], t('Installing PyTorch (about 3 GB)…'));
                // Its list has file paths relative to its folder: a copy at the top keeps them right.
                const req = path.join(dir, 'desktop-requirements.txt');
                fs.writeFileSync(req, fs.readFileSync(path.join(dir, 'system', 'requirements', 'requirements_standalone.txt'), 'utf8'));
                // Pins its list misses: newer huggingface_hub drops what gradio 4.44 imports, newer
                // transformers needs the newer hub (found by testing, 2026-11-04).
                await h.uvPip(aid, dir, ['-r', req, 'faiss-cpu', 'numpy<2', 'huggingface_hub<1.0', 'transformers>=4.43,<=4.46.2', 'torch==2.2.1', 'torchaudio==2.2.1', ...tb]);
                await h.uvCacheClean(aid, dir);
            },
            async update(dir, aid) { await h.ensureUv(aid); await h.gitPull(aid, dir); await this.deps(dir, aid); await finished(dir); },
            latest: null,
            async command(dir, o) {
                return { cmd: h.pyOf(dir, 'alltalkv2'), args: ['script.py', ...h.splitArgs(o.extra)], cwd: dir, env: pyEnv() };
            },
        },
        {
            id: 'xtts', name: 'XTTSv2 API server', group: 'voice', site: 'https://github.com/daswer123/xtts-api-server', port: 8020, resumable: true, size: N('about 6 GB'),
            desc: N('A small server for Coqui\'s XTTS v2 voice model: clones a voice from a few seconds of speech, 17 languages.'),
            note: N('Put voice samples (.wav, 6–10 seconds of clear speech, one per voice) in its speakers folder. The first start downloads the XTTS v2 model (about 2 GB).'),
            license: { name: 'Coqui Public Model License (CPML)', url: 'https://coqui.ai/cpml', text: N('The XTTS v2 voice model it downloads may only be used for non-commercial purposes (Coqui Public Model License).') },
            st: { api: 'TTS → XTTSv2', url: q => `http://127.0.0.1:${q}`, how: N('In SillyTavern: Extensions (the stacked boxes) → TTS → Select TTS Provider: XTTSv2, paste the address as Provider Endpoint.') },
            opts: [port(8020), extra],
            extraFolder: { sub: 'speakers', label: N('Voices (speakers) folder') },
            // Ours: its own Python environment; SillyTavern-Launcher's: its Miniconda environment.
            exe: dir => (dir === lb('voice-generation', 'xtts') ? h.pyOf(dir, 'xtts') : path.join(dir, '.venv', 'Scripts', 'python.exe')),
            found: () => [lb('voice-generation', 'xtts')],
            async install(dir, aid) {
                await h.ensureUv(aid);
                fs.mkdirSync(path.join(dir, 'speakers'), { recursive: true });
                await h.uvVenv(aid, dir, '3.10');
                const tb = await torch('cu118');
                await h.uvPip(aid, dir, ['torch==2.1.1', 'torchaudio==2.1.1', ...tb], t('Installing PyTorch (about 3 GB)…'));
                await h.uvPip(aid, dir, await this.packages(dir));
                await h.uvCacheClean(aid, dir);
                await finished(dir, 'pip');
            },
            // xtts-api-server 0.9.0 pins coqui-tts 0.24.1, which has no Windows build (it
            // needs a C++ compiler); 0.24.2 is the same with Windows builds, and wants
            // transformers 4.42. numpy 2 and huggingface_hub 1.x break these old versions.
            async packages(dir) {
                const over = path.join(dir, 'desktop-overrides.txt');
                fs.writeFileSync(over, 'coqui-tts[languages]==0.24.2\ntransformers==4.42.4\n');
                return ['xtts-api-server', 'torch==2.1.1', 'torchaudio==2.1.1', 'numpy<2', 'huggingface_hub<1.0', '--override', over, ...(await torch('cu118'))];
            },
            async update(dir, aid) { await h.ensureUv(aid); await h.uvPip(aid, dir, ['--upgrade-package', 'xtts-api-server', ...(await this.packages(dir))]); await finished(dir, 'pip'); },
            latest: null,
            async command(dir, o, q, accepted) {
                fs.mkdirSync(path.join(dir, 'speakers'), { recursive: true });
                return {
                    cmd: h.pyOf(dir, 'xtts'), args: ['-m', 'xtts_api_server', '-hs', '127.0.0.1', '-p', String(q), '-sf', 'speakers', '-o', 'output', '-mf', 'xtts_models', ...h.splitArgs(o.extra)], cwd: dir,
                    // Only after the user agreed to the model's license in this app.
                    env: pyEnv(accepted ? { COQUI_TOS_AGREED: '1' } : {}),
                };
            },
        },
    ];
}

// ---------- helper tools (winget) ----------
const onPath = exe => (process.env.PATH || process.env.Path || '').split(path.delimiter).some(d => d && fs.existsSync(path.join(d, exe)));
const pf = (v, ...p) => path.join(process.env[v] || '', ...p);
export const TOOLS = [
    {
        id: 'ffmpeg', name: 'FFmpeg', winget: 'Gyan.FFmpeg',
        why: N('Converts sound and video files. AllTalk uses it for some audio formats, Forge Neo to save videos.'),
        found: () => onPath('ffmpeg.exe') || fs.existsSync(pf('LOCALAPPDATA', 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe')),
    },
    {
        id: '7zip', name: '7-Zip', winget: '7zip.7zip',
        why: N('Opens .7z archives, the format some of these projects use for their own Windows downloads.'),
        found: () => fs.existsSync(pf('ProgramFiles', '7-Zip', '7z.exe')) || onPath('7z.exe'),
    },
    {
        id: 'cuda', name: 'NVIDIA CUDA Toolkit', winget: 'Nvidia.CUDA', nvidia: true,
        why: N('Only for building extras such as DeepSpeed or some custom nodes; the apps here bring the CUDA parts they need. About 3 GB.'),
        found: () => (!!process.env.CUDA_PATH && fs.existsSync(process.env.CUDA_PATH)) || fs.existsSync(pf('ProgramFiles', 'NVIDIA GPU Computing Toolkit', 'CUDA')),
    },
    {
        id: 'vsbuild', name: 'Visual Studio Build Tools (C++)', winget: 'Microsoft.VisualStudio.2022.BuildTools',
        override: '--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended',
        why: N('A C++ compiler, only needed when an extension or custom node has to compile code. Several GB.'),
        found: () => {
            const vswhere = pf('ProgramFiles(x86)', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
            if (!fs.existsSync(vswhere)) return false;
            try { return !!execFileSync(vswhere, ['-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'], { windowsHide: true, encoding: 'utf8', timeout: 10000 }).trim(); } catch { return false; }
        },
    },
];
