// Talking to a SillyTavern server from the main process: plain requests, and a
// session of our own (SillyTavern hands out a CSRF token tied to its cookie).
// Used by the importer and by add-ons (api.sillytavern.request).
import http from 'http';
import https from 'https';
import { t } from './i18n.js';

export const ACCOUNTS_MESSAGE = 'SillyTavern wants a login (its user accounts are on), so the app can\'t reach its data. Turn user accounts off to use this.';

export function request(base, method, urlPath, { headers = {}, body, auth, cookie, timeout = 60000 } = {}) {
    return new Promise((resolve, reject) => {
        const u = new URL(urlPath, base);
        const h = { ...headers };
        if (auth) h.Authorization = `Basic ${Buffer.from(`${auth.user}:${auth.password}`).toString('base64')}`;
        if (cookie) h.Cookie = cookie;
        if (body) h['Content-Length'] = body.length;
        // This PC's own SillyTavern: with HTTPS on, its certificate is the app's own.
        const req = (u.protocol === 'https:' ? https : http).request(u, { method, headers: h, timeout, rejectUnauthorized: false }, res => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
        });
        req.on('timeout', () => req.destroy(new Error('the server did not answer')));
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

export async function openSession(base, auth) {
    const r = await request(base, 'GET', '/csrf-token', { auth });
    if (r.status === 401) throw new Error(t('SillyTavern asked for a password this app doesn\'t have.'));
    if (r.status !== 200) throw new Error(`SillyTavern answered ${r.status}.`);
    const cookie = (r.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
    return { auth, cookie, token: JSON.parse(r.text).token };
}

const clean = text => String(text || '').replace(/\x1b\[[0-9;]*m/g, '').slice(0, 300);
const keyOf = (base, auth) => `${base}|${auth ? `${auth.user}:${auth.password}` : ''}`;

// A client for one server. getBase() / getAuth() are asked on every request,
// so a changed port or login is picked up. The session is reused; a 403 gets
// one more try with a fresh session (a restarted server no longer knows the
// old one; SillyTavern's CSRF error page may not say "CSRF"). A 403 after that
// is "user accounts are on" only when SillyTavern's login check says so:
// many routes refuse with 403 for reasons of their own.
export function client(getBase, getAuth = () => null) {
    let session = null, sessionFor = '';
    const ensure = async (fresh = false) => {
        const base = getBase(), auth = getAuth() || undefined;
        const key = keyOf(base, auth);
        if (fresh || !session || sessionFor !== key) { session = await openSession(base, auth); sessionFor = key; }
        return { base, s: session };
    };
    const once = async (method, urlPath, body, fresh) => {
        const { base, s } = await ensure(fresh);
        const headers = { 'X-CSRF-Token': s.token };
        let data;
        if (body !== undefined) { data = Buffer.from(JSON.stringify(body)); headers['Content-Type'] = 'application/json'; }
        return request(base, method, urlPath, { headers, body: data, auth: s.auth, cookie: s.cookie });
    };
    // GET needs no CSRF token and sits behind SillyTavern's login check.
    const loginWanted = async () => {
        const { base, s } = await ensure();
        const r = await request(base, 'GET', '/api/users/me', { auth: s.auth, cookie: s.cookie });
        return r.status === 401 || r.status === 403;
    };
    return {
        async request(method, urlPath, body) {
            let r = await once(method, urlPath, body, false);
            if (r.status === 403) r = await once(method, urlPath, body, true);
            if (r.status === 401) throw new Error(t('SillyTavern asked for a password this app doesn\'t have.'));
            if (r.status === 403 && await loginWanted()) throw new Error(ACCOUNTS_MESSAGE);
            if (r.status >= 400) throw new Error(clean(r.text) || `SillyTavern answered ${r.status}.`);
            try { return JSON.parse(r.text); } catch { return r.text; }
        },
        forget() { session = null; },
    };
}
