// st-preload.js — runs in every frame of the SillyTavern window and injects
// matching userscripts (see userscripts.js). Kept tiny on purpose: the page
// only ever sees window.__stDesktopGM, never ipcRenderer.
const { contextBridge, ipcRenderer, webFrame } = require('electron');

const scripts = ipcRenderer.sendSync('us:for-url', location.href, process.isMainFrame);

if (scripts.length) {
    contextBridge.exposeInMainWorld('__stDesktopGM', {
        request: (id, req) => ipcRenderer.invoke('us:request', id, req),
        openInTab: (id, url, active) => ipcRenderer.invoke('us:open-tab', id, url, active),
        closeTab: tabId => ipcRenderer.invoke('us:close-tab', tabId),
        getValue: (id, key) => ipcRenderer.sendSync('us:get-value', id, key),
        setValue: (id, key, value) => ipcRenderer.sendSync('us:set-value', id, key, value),
        deleteValue: (id, key) => ipcRenderer.sendSync('us:delete-value', id, key),
        listValues: id => ipcRenderer.sendSync('us:list-values', id),
    });

    const run = s => webFrame.executeJavaScript(s.code).catch(e => console.error(`[SillyTavern Desktop] ${s.id}:`, e));
    for (const s of scripts) {
        if (s.runAt === 'document-start') run(s);
        else if (s.runAt === 'document-end') window.addEventListener('DOMContentLoaded', () => run(s), { once: true });
        // document-idle (the default): right after DOMContentLoaded settles
        else window.addEventListener('DOMContentLoaded', () => setTimeout(() => run(s), 0), { once: true });
    }
}
