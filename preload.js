// preload.js — safe IPC bridge for the launcher UI
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
const on = channel => cb => ipcRenderer.on(channel, (_e, ...args) => cb(...args));

contextBridge.exposeInMainWorld('desktop', {
    // server
    getState: () => invoke('get-state'),
    startServer: () => invoke('start-server'),
    stopServer: () => invoke('stop-server'),
    openST: () => invoke('open-st'),
    // version & maintenance
    stInfo: () => invoke('st-info'),
    checkUpdates: () => invoke('check-updates'),
    update: () => invoke('update'),
    repair: kind => invoke('repair', kind),
    switchBranch: branch => invoke('switch-branch', branch),
    healthCheck: () => invoke('health-check'),
    // backups
    backup: () => invoke('backup'),
    listBackups: () => invoke('list-backups'),
    restoreBackup: name => invoke('restore-backup', name),
    deleteBackup: name => invoke('delete-backup', name),
    // extensions
    listExtensions: fetch => invoke('list-extensions', fetch),
    updateExtensions: () => invoke('update-extensions'),
    // setup & install location
    setupState: () => invoke('setup-state'),
    useInstall: dir => invoke('use-install', dir),
    browseInstall: () => invoke('browse-install'),
    installRequirements: () => invoke('install-requirements'),
    installST: () => invoke('install-st'),
    updateBackend: () => invoke('update-backend'),
    moveST: () => invoke('move-st'),
    // themes
    listThemes: () => invoke('list-themes'),
    setTheme: id => invoke('set-theme', id),
    saveTheme: (theme, id) => invoke('save-theme', theme, id),
    deleteTheme: id => invoke('delete-theme', id),
    importTheme: () => invoke('import-theme'),
    exportTheme: id => invoke('export-theme', id),
    stLogo: () => invoke('st-logo'),
    // places, links, misc
    openPlace: key => invoke('open-place', key),
    openLink: key => invoke('open-link', key),
    copyLogs: () => invoke('copy-logs'),
    saveSettings: s => invoke('save-settings', s),
    setLayer: mode => invoke('set-layer', mode),
    setTabs: on => invoke('set-tabs', on),
    // desktop extensions
    extList: () => invoke('ext:list'),
    extSetEnabled: (id, on) => invoke('ext:set-enabled', id, on),
    extReload: () => invoke('ext:reload'),
    extPanel: id => invoke('ext:panel', id),
    extInvoke: (id, channel, ...args) => invoke('ext:invoke', id, channel, args),
    extAddExample: () => invoke('ext:add-example'),
    // events
    onLog: on('server-log'),
    onStarted: on('server-started'),
    onStopped: on('server-stopped'),
    onBusy: on('busy'),
    onRefresh: on('refresh'),
    onTheme: on('theme'),
    onSettings: on('settings'),
});
