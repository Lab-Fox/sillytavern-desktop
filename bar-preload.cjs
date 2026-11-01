// bar-preload.js — bridge for the SillyTavern window's top bar
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bar', {
    action: (name, data) => ipcRenderer.send('bar:action', name, data),
    onState: cb => ipcRenderer.on('bar:state', (_e, s) => cb(s)),
    i18n: () => ipcRenderer.sendSync('i18n-dict'),
});

// <browser-action-list>: the buttons of Chrome extensions (chromeext.js).
try { require('electron-chrome-extensions/browser-action').injectBrowserAction(); } catch (e) { console.error('Chrome extension buttons unavailable:', e); }
