// serveropts.js — SillyTavern server options the app sets without touching
// config.yaml: each chosen value goes to the server as a SILLYTAVERN_* variable
// (SillyTavern reads those before config.yaml). Also the HTTPS certificate
// (self-signed, made here with Node's crypto, kept in the app's data folder).
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { N } from './i18n.js';

// kind: 'bool' or 'text'. Only options worth changing for most people.
export const OPTIONS = [
    { key: 'performance.lazyLoadCharacters', kind: 'bool', label: N('Load characters lazily'), desc: N('Faster start with many characters: their details load when you open them.') },
    { key: 'enableUserAccounts', kind: 'bool', label: N('User accounts'), desc: N('Several people with their own characters and chats, each with a login.') },
    { key: 'enableDiscreetLogin', kind: 'bool', label: N('Discreet login page'), desc: N('With user accounts: the login page doesn\'t list the users.') },
    { key: 'enableServerPlugins', kind: 'bool', label: N('Server plugins'), desc: N('Lets plugins in SillyTavern\'s plugins folder run on the server. Some extensions need one.') },
    { key: 'extensions.autoUpdate', kind: 'bool', label: N('Update extensions when SillyTavern starts'), desc: N('SillyTavern\'s own automatic update of its extensions.') },
    { key: 'thumbnails.enabled', kind: 'bool', label: N('Thumbnails'), desc: N('Small copies of avatars and backgrounds. Off shows the full images (slower with many).') },
    { key: 'requestProxy.enabled', kind: 'bool', label: N('Use a proxy for AI services'), desc: N('Sends SillyTavern\'s outgoing requests through the proxy below, for example where a service is blocked.') },
    { key: 'requestProxy.url', kind: 'text', label: N('Proxy address'), desc: N('For example socks5://127.0.0.1:1080 or http://127.0.0.1:8080.'), placeholder: 'socks5://127.0.0.1:1080' },
];
const BY_KEY = new Map(OPTIONS.map(o => [o.key, o]));
export const envName = key => `SILLYTAVERN_${key.toUpperCase().replace(/\./g, '_')}`;

// Reads plain values (true/false/numbers/strings) at a dotted path from
// config.yaml, enough for the options above. Lists and anchors are skipped.
export function readYamlValues(file, keys) {
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch { return {}; }
    const want = new Set(keys);
    const out = {};
    const stack = []; // [{ indent, name }]
    for (const raw of text.split(/\r?\n/)) {
        if (!raw.trim() || /^\s*#/.test(raw) || /^\s*-/.test(raw)) continue;
        const m = /^(\s*)([A-Za-z0-9_]+):\s*(.*?)\s*$/.exec(raw);
        if (!m) continue;
        const indent = m[1].length;
        while (stack.length && stack.at(-1).indent >= indent) stack.pop();
        const full = [...stack.map(s => s.name), m[2]].join('.');
        let value = m[3].replace(/\s+#.*$/, '');
        if (value === '') { stack.push({ indent, name: m[2] }); continue; }
        if (!want.has(full)) continue;
        value = value.replace(/^(['"])(.*)\1$/, '$2');
        out[full] = value === 'true' ? true : value === 'false' ? false : value;
    }
    return out;
}

// What the launcher shows: each option with config.yaml's value and the app's choice.
export function describe(stRoot, overrides = {}) {
    const fromYaml = readYamlValues(path.join(stRoot || '', 'config.yaml'), OPTIONS.map(o => o.key));
    const defaults = readYamlValues(path.join(stRoot || '', 'default', 'config.yaml'), OPTIONS.map(o => o.key));
    return OPTIONS.map(o => ({
        ...o, config: o.key in fromYaml ? fromYaml[o.key] : defaults[o.key] ?? null, value: o.key in overrides ? overrides[o.key] : null,
    }));
}

// Only known keys, booleans for bool options, short strings for text.
export function clean(overrides) {
    const out = {};
    for (const [k, v] of Object.entries(overrides || {})) {
        const o = BY_KEY.get(k);
        if (!o || v === null || v === undefined) continue;
        if (o.kind === 'bool' && typeof v === 'boolean') out[k] = v;
        if (o.kind === 'text' && typeof v === 'string' && v.trim() && v.length <= 300) out[k] = v.trim();
    }
    return out;
}

export function env(overrides) {
    const out = {};
    for (const [k, v] of Object.entries(clean(overrides))) out[envName(k)] = String(v);
    return out;
}

// ---------- HTTPS certificate ----------
// A minimal DER encoder: enough for one self-signed ECDSA P-256 certificate.
const der = (tag, ...parts) => {
    const body = Buffer.concat(parts);
    const len = body.length < 128 ? Buffer.from([body.length])
        : body.length < 256 ? Buffer.from([0x81, body.length]) : Buffer.from([0x82, body.length >> 8, body.length & 255]);
    return Buffer.concat([Buffer.from([tag]), len, body]);
};
const seq = (...p) => der(0x30, ...p);
const set = (...p) => der(0x31, ...p);
const oid = s => {
    const n = s.split('.').map(Number);
    const bytes = [40 * n[0] + n[1]];
    for (const v of n.slice(2)) {
        const chunk = [];
        let x = v;
        do { chunk.unshift(x & 127); x = Math.floor(x / 128); } while (x);
        bytes.push(...chunk.map((c, i) => (i < chunk.length - 1 ? c | 128 : c)));
    }
    return der(0x06, Buffer.from(bytes));
};
const utf8 = s => der(0x0c, Buffer.from(s, 'utf8'));
const time = d => der(0x17, Buffer.from(d.toISOString().replace(/[-:T]/g, '').slice(2, 14) + 'Z'));
const ip4 = s => Buffer.from(s.split('.').map(Number));

// SANs: localhost, 127.0.0.1 and this PC's addresses (phones open those).
export function makeCertificate(names = []) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const name = seq(set(seq(oid('2.5.4.3'), utf8('SillyTavern Desktop (this PC)'))));
    const now = new Date(Date.now() - 60e3);
    const until = new Date(Date.now() + 397 * 864e5); // phones refuse longer-lived certificates
    const alg = seq(oid('1.2.840.10045.4.3.2')); // ecdsa-with-SHA256
    const sans = [der(0x82, Buffer.from('localhost'))];
    for (const n of new Set(['127.0.0.1', ...names])) {
        if (/^\d+\.\d+\.\d+\.\d+$/.test(n)) sans.push(der(0x87, ip4(n)));
        else if (/^[a-z0-9.-]+$/i.test(n)) sans.push(der(0x82, Buffer.from(n)));
    }
    const ext = (id, value, critical) => seq(oid(id), ...(critical ? [der(0x01, Buffer.from([0xff]))] : []), der(0x04, value));
    const extensions = der(0xa3, seq(
        ext('2.5.29.17', seq(...sans)),
        ext('2.5.29.19', seq(), true),                                       // not a CA
        ext('2.5.29.15', der(0x03, Buffer.from([0x07, 0x80])), true),        // digitalSignature
        ext('2.5.29.37', seq(oid('1.3.6.1.5.5.7.3.1'))),                     // serverAuth
    ));
    const serial = crypto.randomBytes(12);
    serial[0] &= 0x7f;
    const tbs = seq(
        der(0xa0, der(0x02, Buffer.from([2]))), der(0x02, serial), alg, name,
        seq(time(now), time(until)), name, publicKey.export({ type: 'spki', format: 'der' }), extensions,
    );
    const sig = crypto.sign('sha256', tbs, privateKey);
    const cert = seq(tbs, alg, der(0x03, Buffer.concat([Buffer.from([0]), sig])));
    const pem = `-----BEGIN CERTIFICATE-----\n${cert.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`;
    return { cert: pem, key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
}

// The certificate in dir, made (again) when missing, expiring within 30 days,
// or not covering every address wanted.
export function certificate(dir, names = []) {
    const certPath = path.join(dir, 'cert.pem');
    const keyPath = path.join(dir, 'privkey.pem');
    try {
        const x = new crypto.X509Certificate(fs.readFileSync(certPath));
        const fresh = new Date(x.validTo) - Date.now() > 30 * 864e5;
        const covered = names.every(n => (x.subjectAltName || '').includes(n));
        if (fresh && covered && fs.existsSync(keyPath)) return info(x, certPath, keyPath);
    } catch { /* make one */ }
    fs.mkdirSync(dir, { recursive: true });
    const { cert, key } = makeCertificate(names);
    fs.writeFileSync(keyPath, key, { mode: 0o600 });
    fs.writeFileSync(certPath, cert);
    return info(new crypto.X509Certificate(cert), certPath, keyPath);
}
function info(x, certPath, keyPath) {
    // Chromium's form of the fingerprint (certificate-error event).
    const fingerprint = `sha256/${Buffer.from(x.fingerprint256.replace(/:/g, ''), 'hex').toString('base64')}`;
    return { certPath, keyPath, fingerprint, validTo: x.validTo, names: x.subjectAltName };
}

export function httpsEnv(cert) {
    return { SILLYTAVERN_SSL_ENABLED: 'true', SILLYTAVERN_SSL_CERTPATH: cert.certPath, SILLYTAVERN_SSL_KEYPATH: cert.keyPath };
}

// For the system report: a path without the user's own folder.
export const privatePath = p => String(p || '').split(os.homedir()).join('%USERPROFILE%');
