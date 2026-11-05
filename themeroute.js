// How theme files reach the app's pages, and what keeps pages away from every
// other file. The launcher is a file:// page, so Chromium's "self" also covers
// any file: address, even one on a network share (asking a share for a file
// makes Windows offer the user's login to it). Theme CSS could name one, so
// pages may only load file: addresses inside the app itself, and theme files
// come through st-theme://<package>/<path> alone.
import { protocol } from 'electron';
import { Readable } from 'stream';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

// Before the app is ready, as Electron requires. corsEnabled is what lets a
// file:// page use a web font from here.
protocol.registerSchemesAsPrivileged([{
    scheme: 'st-theme',
    privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true },
}]);

// Pictures, video and fonts. A theme's CSS is checked first, and pages get the
// checked text. The one place for HTML and scripts is a theme's scene/ folder:
// a scene runs sealed off, see sceneHeaders.
export const TYPES = {
    '.png': 'image/png', '.apng': 'image/apng', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
    '.webm': 'video/webm', '.mp4': 'video/mp4',
    '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf',
};
export const SCENE_TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const typeOf = rel => TYPES[path.extname(rel).toLowerCase()] || (rel.startsWith('scene/') ? SCENE_TYPES[path.extname(rel).toLowerCase()] : undefined);
const APP_ORIGIN = 'file://';
const PACKAGE_ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
const BAD_NAME = /[\\:*?"<>|\x00-\x1f]|[. ]$|^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i;

const inside = (root, file) => {
    const rel = path.relative(root, file);
    return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
};

// A path inside a package, as "folder/name.png": no way out, nothing Windows
// treats specially.
export function safeRel(rel) {
    const parts = String(rel).split('/');
    return parts.every(p => p && p !== '.' && p !== '..' && !BAD_NAME.test(p));
}

// The file a st-theme: address may name, or null. Plain text checks only;
// `locate` then follows links on disk.
export function themePath(packagesDir, url) {
    let u;
    try { u = new URL(url); } catch { return null; }
    if (u.protocol !== 'st-theme:' || !PACKAGE_ID.test(u.hostname) || u.username || u.password || u.port) return null;
    if (/%(2f|5c|00)/i.test(u.pathname)) return null;
    let rel;
    try { rel = decodeURIComponent(u.pathname.slice(1)); } catch { return null; }
    if (!safeRel(rel) || !typeOf(rel)) return null;
    return path.join(packagesDir, u.hostname, ...rel.split('/'));
}

async function locate(packagesDir, url) {
    const file = themePath(packagesDir, url);
    if (!file) return null;
    try {
        const root = await fs.promises.realpath(path.join(packagesDir, new URL(url).hostname));
        const real = await fs.promises.realpath(file);
        if (!inside(root, real)) return null;
        const stat = await fs.promises.stat(real);
        return stat.isFile() ? { file: real, size: stat.size } : null;
    } catch { return null; }
}

// bytes=a-b, a- or -n against a file of `size` bytes. Null = the whole file,
// false = a range outside it.
export function parseRange(header, size) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(header || '');
    if (!m || (!m[1] && !m[2])) return null;
    let start, end;
    if (m[1]) {
        start = Number(m[1]);
        end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    } else {
        start = Math.max(size - Number(m[2]), 0);
        end = size - 1;
    }
    return start > end || start >= size ? false : { start, end };
}

// A scene may draw and animate with its own files and nothing else: no network,
// no other files, nothing of the page around it. The sandbox comes with the
// response, so it holds however the page is opened.
const sceneHeaders = self => [
    'sandbox allow-scripts', "default-src 'none'", `script-src 'unsafe-inline' ${self}`, `style-src 'unsafe-inline' ${self}`,
    `img-src ${self} data: blob:`, `media-src ${self} blob:`, `font-src ${self} data:`, "connect-src 'none'", "frame-src 'none'", "base-uri 'none'", "form-action 'none'", "webrtc 'block'",
].join('; ');

async function serve(packagesDir, request) {
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 });
    // Web pages open in the app's other tabs have no business reading these.
    // A sealed scene has no origin: 'null'.
    const origin = request.headers.get('origin');
    if (origin && origin !== APP_ORIGIN && origin !== 'null') return new Response(null, { status: 403 });
    const found = await locate(packagesDir, request.url);
    if (!found) return new Response(null, { status: 404 });
    const { file, size } = found;
    const url = new URL(request.url);
    const scene = url.pathname.startsWith('/scene/');
    const headers = {
        'content-type': typeOf(scene ? 'scene/x' + path.extname(file) : file),
        'x-content-type-options': 'nosniff',
        // An SVG opened as a page must stay a picture.
        'content-security-policy': scene ? sceneHeaders(`${url.protocol}//${url.host}`) : "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        'access-control-allow-origin': origin || APP_ORIGIN,
        'accept-ranges': 'bytes',
        'cache-control': 'no-cache',
    };
    const range = parseRange(request.headers.get('range'), size);
    if (range === false) return new Response(null, { status: 416, headers: { ...headers, 'content-range': `bytes */${size}` } });
    const { start, end } = range || { start: 0, end: Math.max(size - 1, 0) };
    headers['content-length'] = String(size ? end - start + 1 : 0);
    if (range) headers['content-range'] = `bytes ${start}-${end}/${size}`;
    const status = range ? 206 : 200;
    if (request.method === 'HEAD' || !size) return new Response(null, { status, headers });
    return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })), { status, headers });
}

export function initThemeRoute(packagesDir) {
    protocol.handle('st-theme', request => serve(packagesDir, request).catch(() => new Response(null, { status: 500 })));
}

export function allowedFile(url, appDir) {
    try {
        const u = new URL(url);
        return u.protocol === 'file:' && !u.host && inside(appDir, fileURLToPath(u));
    } catch { return false; }
}

// Only what pages ask for; the main process reads its own files.
export function guardFileRequests(ses, appDir, onBlocked) {
    ses.webRequest.onBeforeRequest({ urls: ['file://*/*'] }, (details, done) => {
        const ok = !details.webContentsId || allowedFile(details.url, appDir);
        if (!ok) onBlocked(details.url);
        done({ cancel: !ok });
    });
}
