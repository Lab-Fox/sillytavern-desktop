// preload.js — safe IPC bridge for the launcher UI
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
    getState: () => ipcRenderer.invoke('get-state'),
    startServer: () => ipcRenderer.invoke('start-server'),
    stopServer: () => ipcRenderer.invoke('stop-server'),
    openST: () => ipcRenderer.invoke('open-st'),
    update: () => ipcRenderer.invoke('update'),
    backup: () => ipcRenderer.invoke('backup'),
    gitVersion: () => ipcRenderer.invoke('git-version'),
    openDataFolder: () => ipcRenderer.invoke('open-data-folder'),
    openBackupsFolder: () => ipcRenderer.invoke('open-backups-folder'),
    saveSettings: (s) => ipcRenderer.invoke('save-settings', s),
    onLog: (cb) => ipcRenderer.on('server-log', (_e, line) => cb(line)),
    onStopped: (cb) => ipcRenderer.on('server-stopped', () => cb()),
});
