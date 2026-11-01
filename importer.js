// Importing files into SillyTavern: character cards (.png, .json, .charx,
// .byaf, .yaml), lorebooks (.json with entries) and presets (.json). Files
// go through SillyTavern's own endpoints — the same ones its Import buttons
// use — so SillyTavern converts and names them itself. The app only sorts
// the files and talks to the running server with a session and CSRF token.
import fs from 'fs';
import http from 'http';
import https from 'https';
import path from 'path';
import crypto from 'crypto';
import { t } from './i18n.js';

const MAX_BYTES = 60 * 1024 * 1024;
const CHAR_EXT = new Set(['.png', '.charx', '.byaf', '.yaml', '.yml']);
export const EXTENSIONS = ['.png', '.json', '.charx', '.byaf', '.yaml', '.yml'];

// Presets: SillyTavern's apiId, a name for people, the folder under data/<user>, and a test.
const PRESETS = [
    ['openai', 'Chat Completion preset', 'OpenAI Settings', j => Array.isArray(j.prompts) || 'chat_completion_source' in j || 'openai_max_context' in j],
    ['instruct', 'Instruct template', 'instruct', j => 'input_sequence' in j && 'output_sequence' in j],
    ['context', 'Context template', 'context', j => 'story_string' in j],
    ['reasoning', 'Reasoning template', 'reasoning', j => 'prefix' in j && 'suffix' in j && 'separator' in j],
    ['sysprompt', 'System prompt', 'sysprompt', j => typeof j.content === 'string' && typeof j.name === 'string' && Object.keys(j).every(k => ['name', 'content', 'post_history'].includes(k))],
    ['textgenerationwebui', 'Text Completion preset', 'TextGen Settings', j => 'temp' in j && ('rep_pen' in j || 'top_p' in j)],
];

// Character data inside a PNG lives in a tEXt chunk called "chara" (V2) or "ccv3".
function pngHasCard(buf) {
    if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) return false;
    let p = 8;
    while (p + 8 <= buf.length) {
        const len = buf.readUInt32BE(p);
        const type = buf.toString('latin1', p + 4, p + 8);
        if (type === 'tEXt' || type === 'iTXt') {
            const key = buf.toString('latin1', p + 8, Math.min(p + 8 + len, p + 8 + 16)).split('\0')[0];
            if (key === 'chara' || key === 'ccv3') return true;
        }
        if (type === 'IEND') break;
        p += 12 + len;
    }
    return false;
}

const isCharacterJson = j => (typeof j.spec === 'string' && /chara_card/.test(j.spec))
    || ('first_mes' in j && 'name' in j) || (j.data && 'first_mes' in j.data) || 'char_name' in j;

// What a file is, without importing it: { path, file, kind, label, ... } or { error }.
export function classify(file) {
    const base = { path: file, file: path.basename(file) };
    const ext = path.extname(file).toLowerCase();
    let st;
    try { st = fs.statSync(file); } catch { return { ...base, error: t('File not found.') }; }
    if (!st.isFile()) return { ...base, error: t('Folders can\'t be imported; drop the files inside it.') };
    if (st.size > MAX_BYTES) return { ...base, error: t('Too large for a card, lorebook or preset.') };
    if (!EXTENSIONS.includes(ext)) return { ...base, error: t('Not a file SillyTavern can import here (cards: .png, .json, .charx, .byaf, .yaml; lorebooks and presets: .json).') };
    if (ext === '.png') {
        let buf;
        try { buf = fs.readFileSync(file); } catch (e) { return { ...base, error: e.message }; }
        return pngHasCard(buf) ? { ...base, kind: 'character', fileType: 'png', label: t('Character card') } : { ...base, error: t('A picture without character data, so not a character card.') };
    }
    if (CHAR_EXT.has(ext)) return { ...base, kind: 'character', fileType: ext.slice(1), label: t('Character card') };
    let j;
    try { j = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch { return { ...base, error: t('Not valid JSON.') }; }
    if (!j || typeof j !== 'object' || Array.isArray(j)) return { ...base, error: t('Not a card, lorebook or preset.') };
    if (isCharacterJson(j)) return { ...base, kind: 'character', fileType: 'json', label: t('Character card') };
    if ('entries' in j) return { ...base, kind: 'lorebook', label: t('Lorebook'), name: path.parse(file).name };
    if (j.instruct && j.context) return { ...base, error: t('A combined template export. Import it in SillyTavern: Advanced Formatting → Master Import.') };
    const p = PRESETS.find(([, , , test]) => test(j));
    if (p) return { ...base, kind: 'preset', apiId: p[0], label: p[1], folder: p[2], name: (typeof j.name === 'string' && j.name.trim()) || path.parse(file).name };
    return { ...base, error: t('Not recognised as a card, lorebook or preset. Try SillyTavern\'s own Import button.') };
}

// "Name", "Name (2)", … — not taken in that folder of the default user.
function freeName(dir, name, ext = '.json') {
    const clean = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim() || 'Imported';
    for (let n = 1; n < 1000; n++) {
        const candidate = n === 1 ? clean : `${clean} (${n})`;
        if (!fs.existsSync(path.join(dir, `${candidate}${ext}`))) return candidate;
    }
    return `${clean} ${Date.now()}`;
}

// ---------- talking to the server ----------
function request(base, method, urlPath, { headers = {}, body, auth, cookie } = {}) {
    return new Promise((resolve, reject) => {
        const u = new URL(urlPath, base);
        const h = { ...headers };
        if (auth) h.Authorization = `Basic ${Buffer.from(`${auth.user}:${auth.password}`).toString('base64')}`;
        if (cookie) h.Cookie = cookie;
        if (body) h['Content-Length'] = body.length;
        // This PC's own SillyTavern: with HTTPS on, its certificate is the app's own.
        const req = (u.protocol === 'https:' ? https : http).request(u, { method, headers: h, timeout: 60000, rejectUnauthorized: false }, res => {
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

function multipart(fields, file) {
    const boundary = `----stdesktop${crypto.randomBytes(12).toString('hex')}`;
    const parts = [];
    for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
    const safeName = file.name.replace(/["\r\n]/g, '_');
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="avatar"; filename="${safeName}"\r\nContent-Type: application/octet-stream\r\n\r\n`));
    parts.push(file.data, Buffer.from(`\r\n--${boundary}--\r\n`));
    return { body: Buffer.concat(parts), type: `multipart/form-data; boundary=${boundary}` };
}

// A session of our own: SillyTavern hands out a CSRF token tied to its cookie.
async function openSession(base, auth) {
    const r = await request(base, 'GET', '/csrf-token', { auth });
    if (r.status === 401) throw new Error(t('SillyTavern asked for a password this app doesn\'t have.'));
    if (r.status !== 200) throw new Error(`SillyTavern answered ${r.status}.`);
    const cookie = (r.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
    return { auth, cookie, token: JSON.parse(r.text).token };
}

const LOGIN_HINT = 'SillyTavern wants a login (user accounts are on). Import this file from SillyTavern itself, or drop it onto the SillyTavern window.';

async function post(base, s, urlPath, { json, form }) {
    const headers = { 'X-CSRF-Token': s.token };
    let body;
    if (json) { body = Buffer.from(JSON.stringify(json)); headers['Content-Type'] = 'application/json'; } else { body = form.body; headers['Content-Type'] = form.type; }
    const r = await request(base, 'POST', urlPath, { headers, body, auth: s.auth, cookie: s.cookie });
    if (r.status === 401 || r.status === 403) throw new Error(/csrf/i.test(r.text) ? 'SillyTavern refused the request (CSRF).' : LOGIN_HINT);
    if (r.status >= 400) throw new Error(r.text.replace(/\x1b\[[0-9;]*m/g, '').slice(0, 200) || `SillyTavern answered ${r.status}.`);
    try { return JSON.parse(r.text); } catch { return {}; }
}

// Imports classified items into the server at `base` (stRoot for name checks).
// Returns [{ file, ok, as?, error? }].
export async function importAll(base, stRoot, items, { auth } = {}) {
    const s = await openSession(base, auth);
    const userDir = path.join(stRoot, 'data', 'default-user');
    const results = [];
    for (const it of items) {
        try {
            const data = fs.readFileSync(it.path);
            if (it.kind === 'character') {
                const r = await post(base, s, '/api/characters/import', { form: multipart({ file_type: it.fileType }, { name: it.file, data }) });
                if (r.error || !r.file_name) throw new Error(t('SillyTavern could not read this card.'));
                results.push({ file: it.file, ok: true, as: `character "${r.file_name}"` });
            } else if (it.kind === 'lorebook') {
                const name = freeName(path.join(userDir, 'worlds'), it.name);
                const r = await post(base, s, '/api/worldinfo/import', { form: multipart({}, { name: `${name}.json`, data }) });
                results.push({ file: it.file, ok: true, as: `lorebook "${r.name || name}"` });
            } else if (it.kind === 'preset') {
                const name = freeName(path.join(userDir, it.folder), it.name);
                const preset = JSON.parse(data.toString('utf8').replace(/^﻿/, ''));
                if (typeof preset.name === 'string') preset.name = name;
                await post(base, s, '/api/presets/save', { json: { apiId: it.apiId, name, preset } });
                results.push({ file: it.file, ok: true, as: `${it.label.toLowerCase()} "${name}"` });
            } else {
                results.push({ file: it.file, ok: false, error: it.error || 'Unknown file.' });
            }
        } catch (e) {
            results.push({ file: it.file, ok: false, error: e.message });
            if (e.message === LOGIN_HINT) break; // the rest would fail the same way
        }
    }
    for (const it of items.slice(results.length)) results.push({ file: it.file, ok: false, error: LOGIN_HINT });
    return results;
}
