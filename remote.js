// SillyTavern on another computer ("remote profiles"): a name, an address
// and an optional login, stored in settings.remotes. They are not folders,
// so they never become the SillyTavern the app runs: they open in the
// SillyTavern window as tabs of their own, each with its own browser session
// (logins stay). The password is kept encrypted with Windows' DPAPI
// (Electron safeStorage) and never goes to the launcher.
import { net, safeStorage } from 'electron';
import crypto from 'crypto';
import { t } from './i18n.js';

const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
const newId = () => crypto.randomBytes(4).toString('hex');

// http(s)://host[:port]/path/ — no login in the address, no query.
export function normalizeUrl(raw) {
    let s = clean(raw);
    if (!s) return { error: t('Enter the address, for example http://192.168.1.25:8000') };
    if (!/^[a-z]+:\/\//i.test(s)) s = `http://${s}`;
    let u;
    try { u = new URL(s); } catch { return { error: t('That is not a web address.') }; }
    if (!['http:', 'https:'].includes(u.protocol)) return { error: t('Only http:// and https:// addresses work.') };
    if (u.username || u.password) return { error: t('Put the user name and password in their own fields, not in the address.') };
    if (!u.hostname) return { error: t('The address needs a computer name or IP.') };
    u.search = ''; u.hash = '';
    if (!u.pathname.endsWith('/')) u.pathname += '/';
    return { url: u.href };
}

// Addresses that stay inside the home network (or a private VPN like Tailscale).
export function isPrivateHost(host) {
    const h = host.replace(/^\[|\]$/g, '').toLowerCase();
    if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.lan') || h.endsWith('.home.arpa') || h.endsWith('.ts.net') || !h.includes('.') && !h.includes(':')) return true;
    const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (m) {
        const [a, b] = [Number(m[1]), Number(m[2])];
        return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
    }
    return h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80');
}
// Plain http to somewhere outside: the login and every chat travel unencrypted.
export const insecure = url => { try { const u = new URL(url); return u.protocol === 'http:' && !isPrivateHost(u.hostname); } catch { return false; } };

const encrypt = s => (safeStorage.isEncryptionAvailable() ? { enc: safeStorage.encryptString(s).toString('base64') } : { plain: s });
function decrypt(p) {
    if (!p) return '';
    if (p.plain !== undefined) return p.plain;
    try { return safeStorage.decryptString(Buffer.from(p.enc, 'base64')); } catch { return ''; }
}

const all = settings => (Array.isArray(settings.remotes) ? settings.remotes : (settings.remotes = []));

// For the launcher and menus: never the password.
export function list(settings) {
    return all(settings).map(r => ({ id: r.id, name: r.name, url: r.url, user: r.user || '', hasPassword: !!r.password, insecure: insecure(r.url), httpOk: !!r.httpOk }));
}
export const get = (settings, id) => all(settings).find(r => r.id === id) || null;

// Add (no id) or edit. password: undefined keeps it, '' or null removes it.
export function save(settings, { id, name, url, user, password }) {
    const n = clean(name).slice(0, 40);
    if (!n) return { error: t('Give it a name.') };
    const u = normalizeUrl(url);
    if (u.error) return u;
    const list = all(settings);
    const existing = id ? list.find(r => r.id === id) : null;
    if (id && !existing) return { error: t('That entry no longer exists.') };
    if (list.some(r => r.id !== id && r.name.toLowerCase() === n.toLowerCase())) return { error: t('There is already one called "{name}".', { name: n }) };
    if (settings.profiles?.some(p => p.name.toLowerCase() === n.toLowerCase())) return { error: t('A profile is already called "{name}".', { name: n }) };
    const r = existing || { id: newId() };
    const changedUrl = existing && existing.url !== u.url;
    Object.assign(r, { name: n, url: u.url, user: clean(user).slice(0, 64) });
    if (password === null || password === '') delete r.password;
    else if (typeof password === 'string') r.password = encrypt(password.slice(0, 128));
    if (changedUrl) delete r.httpOk; // a new address asks again
    if (!existing) list.push(r);
    return { remote: r };
}

export function remove(settings, id) {
    settings.remotes = all(settings).filter(r => r.id !== id);
}

// The login for a page asking for one (HTTP basic auth), by address.
export function loginFor(settings, pageUrl) {
    let origin;
    try { origin = new URL(pageUrl).origin; } catch { return null; }
    const r = all(settings).find(x => { try { return new URL(x.url).origin === origin; } catch { return false; } });
    return r && r.user ? { id: r.id, user: r.user, password: decrypt(r.password) } : null;
}

// "Test": can the app reach it, is it SillyTavern, does it want a login?
export async function probe(url) {
    const u = normalizeUrl(url);
    if (u.error) return u;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    try {
        const res = await net.fetch(u.url, { signal: ctl.signal, cache: 'no-store', redirect: 'follow', credentials: 'omit' });
        const text = res.status === 200 ? (await res.text()).slice(0, 20000) : '';
        if (res.status === 401) return { ok: true, status: 401, login: true, text: t('It answers and asks for a user name and password (fill them in below).') };
        if (res.status === 403) return { ok: false, status: 403, text: t('It answers but refuses this PC (403). Its whitelist probably doesn\'t include this PC\'s address.') };
        if (res.status >= 400) return { ok: false, status: res.status, text: t('It answers with an error ({status}).', { status: String(res.status) }) };
        const isSt = /SillyTavern/i.test(text);
        return { ok: true, status: res.status, text: isSt ? 'SillyTavern answers.' : 'Something answers, but it doesn\'t look like SillyTavern.' };
    } catch (e) {
        const msg = ctl.signal.aborted ? 'no answer within 8 seconds' : e.message.replace(/^net::/, '');
        return { ok: false, text: t('Can\'t reach it ({reason}). Is that computer on, SillyTavern running there with "listen" on, and the address right?', { reason: msg }) };
    } finally {
        clearTimeout(timer);
    }
}
