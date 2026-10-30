// bar-preload.js — bridge for the SillyTavern window's top bar
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bar', {
    action: (name, data) => ipcRenderer.send('bar:action', name, data),
    onState: cb => ipcRenderer.on('bar:state', (_e, s) => cb(s)),
});
