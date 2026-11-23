// Side panels: an add-on's page docked on the right of a SillyTavern window
// (manifest "sidepanel"). One panel per window at a time; the panel stays
// while tabs switch or reload. The page is sandboxed with its own session
// and talks to its add-on only through sidepanel-preload.cjs: the add-on
// a call belongs to comes from which view sent it, never from the page.
import { WebContentsView, ipcMain, session } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { guardFileRequests } from './themeroute.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_WIDTH = 380;
export const MIN_WIDTH = 300;

let host = null;
const open = new Map();   // StWindow → { id, view }
const owner = new Map();  // panel webContents id → { id, stWin }
const guarded = new Set(); // partitions already locked down

// host: { panels() → [{ id, name, dir, file }], width() → number, saveWidth(n), log(text),
//         openExternal(url), tabInfo(stWin) → { kind, url, folder },
//         invoke(id, channel, args), opened(id) }
export function initSidePanels(h) { host = h; }

export const available = () => (host ? host.panels().map(({ id, name }) => ({ id, name })) : []);
export const isOpen = stWin => open.get(stWin)?.id || null;
export const viewsOf = id => [...open.values()].filter(p => p.id === id && !p.view.webContents.isDestroyed()).map(p => p.view.webContents);

// Between MIN_WIDTH and half the window (the page keeps at least half).
export function clampWidth(stWin, width) {
    const [w] = stWin.win.getContentSize();
    return Math.round(Math.max(Math.min(MIN_WIDTH, w / 2), Math.min(Number(width) || DEFAULT_WIDTH, w / 2)));
}

// Opens the given add-on's panel, or closes the open one. Without an id:
// the only panel, or a menu to pick one when there are several.
export function toggle(stWin, id, at) {
    const cur = open.get(stWin);
    const list = host.panels();
    if (!id && cur) { close(stWin); return; }
    if (!id && list.length > 1) {
        stWin.popupMenu(list.map(p => ({ label: p.name.replace(/&/g, '&&'), click: () => toggle(stWin, p.id) })), at);
        return;
    }
    const p = id ? list.find(x => x.id === id) : list[0];
    if (!p) return;
    if (cur?.id === p.id) { close(stWin); return; }
    if (cur) close(stWin);
    show(stWin, p);
}

// The panel will show text from cards and chats: its session gets none of a
// browser's extras (Electron allows every permission by default), no files
// outside the add-on's folder (a file: page could reach network shares) and
// no web pages in frames.
function lockDown(partition, dir) {
    if (guarded.has(partition)) return;
    guarded.add(partition);
    const ses = session.fromPartition(partition);
    const CLIPBOARD = new Set(['clipboard-sanitized-write']);
    ses.setPermissionRequestHandler((_wc, perm, done) => done(CLIPBOARD.has(perm)));
    ses.setPermissionCheckHandler((_wc, perm) => CLIPBOARD.has(perm));
    guardFileRequests(ses, dir, url => host.log?.(`Blocked a side panel from loading ${url}`));
}

function show(stWin, p) {
    const partition = `addon-panel-${p.id}`; // not "persist:": nothing kept on disk
    lockDown(partition, p.dir);
    const view = new WebContentsView({
        webPreferences: {
            preload: path.join(__dirname, 'sidepanel-preload.cjs'),
            sandbox: true, contextIsolation: true, nodeIntegration: false,
            partition,
        },
    });
    const wc = view.webContents;
    wc.on('will-frame-navigate', e => { if (!e.isMainFrame && !/^(about|data|file):/i.test(e.url)) e.preventDefault(); });
    owner.set(wc.id, { id: p.id, stWin });
    open.set(stWin, { id: p.id, view });
    wc.on('will-navigate', e => e.preventDefault());
    wc.setWindowOpenHandler(({ url }) => {
        if (/^https?:/i.test(url)) host.openExternal(url);
        return { action: 'deny' };
    });
    // Opened, or the page reloaded (F5 in it): the add-on may send its state again.
    wc.on('did-finish-load', () => host.opened(p.id));
    wc.once('destroyed', () => owner.delete(wc.id));
    stWin.setSidePanel(view, clampWidth(stWin, host.width()), p.id);
    wc.loadFile(p.file);
}

export function close(stWin) {
    const cur = open.get(stWin);
    if (!cur) return;
    open.delete(stWin);
    if (!stWin.isDestroyed()) stWin.setSidePanel(null, 0, null);
    if (!cur.view.webContents.isDestroyed()) cur.view.webContents.close();
}

// The window closed (its views aren't owned by it).
export function windowClosed(stWin) {
    const cur = open.get(stWin);
    open.delete(stWin);
    if (cur && !cur.view.webContents.isDestroyed()) cur.view.webContents.close();
}

// Add-ons turned on or off: close panels whose add-on is gone.
export function refresh(stWins) {
    if (!host) return;
    const ids = new Set(host.panels().map(p => p.id));
    for (const [stWin, cur] of [...open]) if (!ids.has(cur.id)) close(stWin);
    for (const w of stWins) if (!w.isDestroyed()) w.push();
}

export function send(id, message) {
    const data = JSON.parse(JSON.stringify(message ?? null)); // plain data only
    for (const wc of viewsOf(id)) wc.send('sidepanel:message', data);
}

// The window's active tab changed.
export function tabChanged(stWin) {
    const cur = open.get(stWin);
    if (cur && !cur.view.webContents.isDestroyed()) cur.view.webContents.send('sidepanel:tab');
}

const sender = e => owner.get(e.sender.id) || null;
ipcMain.handle('sidepanel:invoke', async (e, channel, args) => {
    const o = sender(e);
    if (!o) throw new Error('not a side panel');
    try {
        return await host.invoke(o.id, String(channel), Array.isArray(args) ? args : []);
    } catch (err) {
        throw new Error(err?.message || String(err)); // only the message crosses
    }
});
ipcMain.handle('sidepanel:tab', e => {
    const o = sender(e);
    return o && !o.stWin.isDestroyed() ? host.tabInfo(o.stWin) : { kind: null, url: null, folder: null };
});
// The grip on the panel's left edge asks for a width (clamped here).
ipcMain.on('sidepanel:resize', (e, wanted, done) => {
    const o = sender(e);
    const cur = o && open.get(o.stWin);
    if (!cur || o.stWin.isDestroyed()) return;
    const width = clampWidth(o.stWin, wanted);
    o.stWin.setSidePanel(cur.view, width, cur.id);
    if (done) host.saveWidth(width);
});
