// pccheck.js — facts about this PC for "What can my PC run?" and the
// troubleshooting tools: graphics cards and their memory, which program holds
// a port, VPN adapters, and a system report safe to share.
import { execFile } from 'child_process';
import os from 'os';
import { t } from './i18n.js';

const run = (file, args, timeout = 8000) => new Promise(resolve => {
    execFile(file, args, { windowsHide: true, timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => resolve(err ? '' : String(stdout)));
});
const ps = (script, timeout = 20000) => run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], timeout);

// Cards Windows has now, with their own memory: nvidia-smi for NVIDIA (exact),
// else the driver's registry value (AdapterRAM stops at 4 GB). Cards without
// their own memory (Intel and AMD graphics in the processor) are "integrated".
let gpuCache = null;
export async function gpus({ fresh = false } = {}) {
    if (gpuCache && !fresh) return gpuCache;
    const [present, reg, smi] = await Promise.all([
        ps("Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name + '|' + $_.AdapterRAM }"),
        ps("Get-ItemProperty 'HKLM:\\SYSTEM\\ControlSet001\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0*' -ErrorAction SilentlyContinue | Where-Object { $_.'HardwareInformation.qwMemorySize' } | ForEach-Object { $_.DriverDesc + '|' + $_.'HardwareInformation.qwMemorySize' }"),
        run('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits']),
    ]);
    const regBytes = new Map(reg.split(/\r?\n/).filter(Boolean).map(l => { const [n, b] = l.split('|'); return [n.trim(), Number(b)]; }));
    const smiMiB = new Map(smi.split(/\r?\n/).filter(Boolean).map(l => { const [n, m] = l.split(','); return [n.trim(), Number(m)]; }));
    gpuCache = present.split(/\r?\n/).filter(l => l.includes('|')).map(l => {
        const [name, adapterRam] = l.split('|').map(s => s.trim());
        const bytes = smiMiB.has(name) ? smiMiB.get(name) * 1024 ** 2 : regBytes.get(name) || Number(adapterRam) || 0;
        const integrated = /Intel|Radeon\(TM\) Graphics|Radeon Graphics|Microsoft Basic/i.test(name) && !/Arc/i.test(name);
        return { name, vramGB: Math.round((bytes / 1024 ** 3) * 10) / 10, integrated, vendor: /NVIDIA/i.test(name) ? 'nvidia' : /AMD|Radeon/i.test(name) ? 'amd' : /Intel/i.test(name) ? 'intel' : 'other' };
    });
    return gpuCache;
}

// Rough sizes of GGUF models (the usual format for KoboldCpp and llama.cpp):
// weights ≈ billions × bits ÷ 8, plus about 1.5 GB for 8K of context.
const MODELS = [3, 8, 12, 14, 24, 32, 70];
const QUANTS = [['Q8_0', 8.5], ['Q6_K', 6.6], ['Q5_K_M', 5.7], ['Q4_K_M', 4.8], ['IQ3_M', 3.7]];
export function advice(vramGB, ramGB) {
    const usable = Math.max(0, vramGB - 0.8); // Windows and the screen keep some
    const fits = MODELS.map(b => {
        const q = QUANTS.find(([, bits]) => (b * bits) / 8 + 1.5 <= usable);
        const ram = QUANTS.find(([, bits]) => (b * bits) / 8 + 1.5 <= usable + ramGB * 0.6);
        return { size: b, quant: q ? q[0] : null, gb: q ? Math.round(((b * q[1]) / 8 + 1.5) * 10) / 10 : null, slowQuant: !q && ram ? ram[0] : null };
    });
    const best = [...fits].reverse().find(f => f.quant && f.quant !== 'IQ3_M') || fits.find(f => f.quant);
    let summary;
    if (vramGB < 4) summary = t('Local models would be very slow here. Use an online service (OpenRouter, Claude, OpenAI, Gemini, DeepSeek…) or a free AI Horde in SillyTavern.');
    else if (!best || best.size < 8) summary = t('Small models (about 3B) run well. For good roleplay, an online service is better.');
    else summary = t('Comfortable: {size}B models at {quant}. Bigger ones work if part of them runs on the processor, but much slower.', { size: best.size, quant: best.quant });
    return { usableGB: Math.round(usable * 10) / 10, fits, summary };
}

// The program listening on a TCP port: { pid, name } or null.
// Get-NetTCPConnection first: netstat missed listeners on some PCs.
export async function portUser(port) {
    port = Number(port);
    let pid = Number((await ps(`(Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | Where-Object { $_.State -eq 'Listen' -or $_.RemotePort -eq 0 } | Select-Object -First 1).OwningProcess`)).trim()) || null;
    if (pid === null) {
        const out = await run('netstat', ['-ano', '-p', 'TCP']);
        const line = out.split(/\r?\n/).find(l => /LISTENING/.test(l) && new RegExp(`[:.]${port}$`).test(l.trim().split(/\s+/)[1] || ''));
        if (!line) return null;
        pid = Number(line.trim().split(/\s+/).pop());
    }
    if (!pid) return { pid: 0, name: 'System' };
    const task = await run('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH']);
    const name = /^"([^"]+)"/.exec(task.trim())?.[1] || '';
    return { pid, name };
}

// Network adapters that look like a VPN (they can block phone access, a remote
// link or AI services). Tailscale is left out: it is meant to be on.
const VPN = /vpn|wireguard|wintun|openvpn|tap-windows|nordlynx|proton|mullvad|windscribe|expressvpn|surfshark|cloudflarewarp|warp|fortinet|anyconnect|globalprotect|zerotier|hamachi|radmin/i;
export function vpns() {
    return Object.entries(os.networkInterfaces())
        .filter(([name, addrs]) => VPN.test(name) && !/tailscale/i.test(name) && addrs.some(a => !a.internal && a.family === 'IPv4'))
        .map(([name]) => name);
}

// A report to paste into a bug report: versions and settings, nothing private
// (the user's own folder becomes %USERPROFILE%, passwords and logins are left out).
export function report(parts) {
    const home = os.homedir();
    const clean = v => String(v ?? '').split(home).join('%USERPROFILE%');
    const lines = [];
    for (const [title, rows] of parts) {
        lines.push(`## ${title}`);
        for (const [k, v] of rows) lines.push(`${k}: ${clean(v)}`);
        lines.push('');
    }
    return lines.join('\n');
}
