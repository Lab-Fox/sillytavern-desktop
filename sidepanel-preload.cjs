// The bridge of an add-on's side panel page (sidepanel.js). Sandboxed: only
// ipcRenderer and contextBridge are available here.
const { contextBridge, ipcRenderer } = require('electron');

// Electron wraps a handler's error as "Error invoking remote method …: Error: x".
const clean = e => new Error(String(e?.message || e).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''));

// Messages that arrive before the page listens are kept for its first listener.
const early = [];
const listeners = [];
ipcRenderer.on('sidepanel:message', (_e, m) => {
    if (!listeners.length) { if (early.length < 500) early.push(m); return; }
    for (const fn of listeners) { try { fn(m); } catch (err) { console.error(err); } }
});
const tabListeners = [];
ipcRenderer.on('sidepanel:tab', () => { for (const fn of tabListeners) { try { fn(); } catch (err) { console.error(err); } } });

contextBridge.exposeInMainWorld('desktopPanel', {
    invoke: (channel, ...args) => ipcRenderer.invoke('sidepanel:invoke', String(channel), args).catch(e => { throw clean(e); }),
    onMessage(fn) {
        if (typeof fn !== 'function') return;
        listeners.push(fn);
        if (listeners.length === 1) for (const m of early.splice(0)) { try { fn(m); } catch (err) { console.error(err); } }
    },
    // The SillyTavern tab beside the panel: { kind, url, folder }.
    tab: () => ipcRenderer.invoke('sidepanel:tab'),
    onTab(fn) { if (typeof fn === 'function') tabListeners.push(fn); },
});

// The grip on the left edge: drag to make the panel wider or narrower. In
// a shadow root, so the add-on's own styles and the grip don't touch.
window.addEventListener('DOMContentLoaded', () => {
    const host = document.createElement('div');
    host.setAttribute('data-desktop-grip', '');
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = '<style>:host{all:initial;position:fixed;left:0;top:0;bottom:0;width:6px;z-index:2147483647;cursor:ew-resize}div{width:100%;height:100%}div:hover,div.on{background:rgba(128,128,128,.35)}</style><div></div>';
    const grip = root.querySelector('div');
    // The width follows the pointer's move on the screen: the panel's own
    // left edge moves with it, so page coordinates would chase themselves.
    let dragging = false, startX = 0, startW = 0;
    const width = e => startW + (startX - e.screenX);
    grip.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        dragging = true;
        startX = e.screenX;
        startW = window.innerWidth;
        grip.classList.add('on');
        grip.setPointerCapture(e.pointerId);
        e.preventDefault();
    });
    grip.addEventListener('pointermove', e => { if (dragging) ipcRenderer.send('sidepanel:resize', width(e), false); });
    const end = e => {
        if (!dragging) return;
        dragging = false;
        grip.classList.remove('on');
        ipcRenderer.send('sidepanel:resize', width(e), true);
    };
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
    document.documentElement.append(host);
});
