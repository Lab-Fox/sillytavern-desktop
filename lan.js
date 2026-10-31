// lan.js — use SillyTavern from a phone or tablet on the same network.
// Nothing in config.yaml is edited: SillyTavern reads SILLYTAVERN_<KEY>
// environment variables before config.yaml, and the app sets them only on
// the main server it starts, only while the setting is on.
import os from 'os';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const qrcode = createRequire(import.meta.url)('qrcode-generator');

// Home networks only: 10.x, 172.16–31.x, 192.168.x.
function isPrivate(ip) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

// "192.168.1.25" + 24 → "192.168.1.0/24"
function networkOf(ip, prefix) {
    const n = ip.split('.').reduce((acc, part) => ((acc << 8) | Number(part)) >>> 0, 0);
    const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
    const base = (n & mask) >>> 0;
    return `${[24, 16, 8, 0].map(s => (base >>> s) & 255).join('.')}/${prefix}`;
}

// This PC's addresses on private networks. Wi-Fi and Ethernet first: virtual
// adapters (WSL, Hyper-V, VPNs) are rarely what a phone can reach.
export function localNetworks() {
    const out = [];
    for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
        for (const a of addrs || []) {
            if (a.family !== 'IPv4' || a.internal || !isPrivate(a.address)) continue;
            const prefix = Number(String(a.cidr || '').split('/')[1]) || 24;
            out.push({ name, address: a.address, network: networkOf(a.address, prefix), virtual: /vEthernet|WSL|Hyper-V|VirtualBox|VMware|Loopback|Tailscale|ZeroTier|VPN/i.test(name) });
        }
    }
    return out.sort((x, y) => Number(x.virtual) - Number(y.virtual));
}

// Environment for the main server. Only this PC and its own networks may
// connect; a password turns on SillyTavern's login (basic auth).
export function serverEnv({ lanAccess, lanUser, lanPassword }) {
    if (!lanAccess) return {};
    const nets = localNetworks().map(n => n.network);
    const env = {
        SILLYTAVERN_LISTEN: 'true',
        SILLYTAVERN_WHITELISTMODE: 'true',
        SILLYTAVERN_WHITELIST: JSON.stringify(['127.0.0.1', '::1', ...new Set(nets)]),
    };
    if (lanPassword) {
        Object.assign(env, {
            SILLYTAVERN_BASICAUTHMODE: 'true',
            SILLYTAVERN_BASICAUTHUSER_USERNAME: lanUser || 'user',
            SILLYTAVERN_BASICAUTHUSER_PASSWORD: lanPassword,
        });
    }
    return env;
}

// SillyTavern's old whitelist.txt replaces the whitelist completely.
export const hasWhitelistTxt = stRoot => !!stRoot && fs.existsSync(path.join(stRoot, 'whitelist.txt'));

export function phoneAddresses(port) {
    return localNetworks().map(n => ({ name: n.name, url: `http://${n.address}:${port}/`, virtual: n.virtual }));
}

export function qrSvg(text) {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr.createSvgTag({ cellSize: 5, margin: 3, scalable: true });
}
