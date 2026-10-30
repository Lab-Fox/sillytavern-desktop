// The SillyTavern window: a frameless window with our own top bar (with
// Windows' native min/max/close drawn over its right end) and the pages in
// views below it, one per tab. In full screen the page fills the window and
// the bar slides in over it when the mouse touches the top edge.
import { BaseWindow, WebContentsView, Menu, ipcMain, screen } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import * as layer from './winlayer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BAR_H = 34;
const CONTROLS_W = 138; // the three native caption buttons
const HOVER_POLL_MS = 80;

const byBar = new Map(); // bar webContents id → StWindow

export class StWindow {
    // opts: url, width, height, fullScreen, layer, colors, icon,
    //       webPreferences, setupPage(webContents, stWindow), tabsEnabled() → bool,
    //       menu(stWindow) → template, onClose({ width, height, fullScreen })
    constructor(opts) {
        this.opts = opts;
        this.layer = opts.layer;
        this.revealed = false;
        this.menuOpen = false;
        // Tracked from the events: isFullScreen() still reports the old
        // state while 'enter-full-screen' is being emitted.
        this.fullScreen = false;
        this.tabs = [];     // { view, id, title, favicon, loading }
        this.active = null; // the shown tab

        const win = this.win = new BaseWindow({
            width: opts.width, height: opts.height, minWidth: 640, minHeight: 420,
            title: 'SillyTavern', icon: opts.icon, show: false,
            backgroundColor: opts.colors.bg,
            titleBarStyle: 'hidden', titleBarOverlay: overlay(opts.colors),
        });

        this.bar = new WebContentsView({
            webPreferences: { preload: path.join(__dirname, 'bar-preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
        });
        this.bar.setBackgroundColor('#00000000');
        win.contentView.addChildView(this.bar);
        byBar.set(this.bar.webContents.id, this);
        this.bar.webContents.on('before-input-event', (e, input) => this.onKey(e, input));

        win.on('resize', () => this.layout());
        win.on('enter-full-screen', () => this.fullScreenChanged(true));
        win.on('leave-full-screen', () => this.fullScreenChanged(false));
        // Right-click on the bar's drag area arrives as the system menu.
        win.on('system-context-menu', e => { e.preventDefault(); this.popupMenu(); });
        win.on('close', () => {
            const b = win.getNormalBounds();
            opts.onClose({ width: b.width, height: b.height, fullScreen: this.fullScreen });
        });
        // Views aren't owned by the window: close their pages explicitly.
        win.on('closed', () => {
            this.closing = true;
            this.stopHoverPoll();
            byBar.delete(this.bar.webContents.id);
            this.bar.webContents.close();
            for (const t of this.tabs) if (!t.view.webContents.isDestroyed()) t.view.webContents.close();
        });

        this.bar.webContents.loadFile(path.join(__dirname, 'stbar.html'));
        this.bar.webContents.once('did-finish-load', () => this.push());
        this.newTab();
        layer.apply(win, this.layer);
        if (opts.fullScreen) win.setFullScreen(true);
        this.layout();
        win.show();
    }

    isDestroyed() { return this.win.isDestroyed(); }
    focus() {
        if (this.win.isMinimized()) this.win.restore();
        this.win.show();
        this.win.focus();
    }
    reload() { this.active?.view.webContents.reload(); }
    // After a server restart every SillyTavern tab is a dead page.
    reloadAll() { for (const t of this.tabs) t.view.webContents.reload(); }
    toggleFullScreen() { this.win.setFullScreen(!this.fullScreen); }
    setLayer(mode) {
        this.layer = mode;
        layer.apply(this.win, mode);
        this.push();
    }
    setColors(colors) {
        for (const t of this.tabs) t.view.setBackgroundColor(colors.bg);
        this.win.setBackgroundColor(colors.bg);
        this.win.setTitleBarOverlay(overlay(colors));
        this.opts.colors = colors;
        this.push();
    }

    // ---------- tabs ----------
    // A fresh SillyTavern page (first tab, the + button, Ctrl+T).
    newTab() {
        const view = new WebContentsView({ webPreferences: this.opts.webPreferences });
        this.addTab(view, true);
        view.webContents.loadURL(this.opts.url);
    }
    // A page SillyTavern or an extension opened with window.open. Taking
    // over Electron's prepared webContents keeps window.opener working, so
    // an extension can still write into the about:blank page it opened.
    adoptTab(options, { background = false } = {}) {
        const view = new WebContentsView({ webContents: options.webContents, webPreferences: options.webPreferences });
        this.addTab(view, !background);
        return view.webContents;
    }
    addTab(view, activate) {
        const wc = view.webContents;
        const tab = { view, id: wc.id, title: 'Loading…', favicon: '', loading: true };
        view.setBackgroundColor(this.opts.colors.bg);
        view.setVisible(false);
        this.tabs.splice(this.active ? this.tabs.indexOf(this.active) + 1 : this.tabs.length, 0, tab);
        this.win.contentView.addChildView(view);
        this.win.contentView.addChildView(this.bar); // keep the bar on top
        this.opts.setupPage(wc, this);
        wc.on('page-title-updated', (_e, title) => {
            tab.title = title;
            if (tab === this.active) this.win.setTitle(title);
            this.push();
        });
        wc.on('page-favicon-updated', (_e, icons) => { tab.favicon = icons[0] || ''; this.push(); });
        wc.on('did-start-loading', () => { tab.loading = true; this.push(); });
        wc.on('did-stop-loading', () => { tab.loading = false; if (!tab.title || tab.title === 'Loading…') tab.title = wc.getTitle() || wc.getURL(); this.push(); });
        wc.on('before-input-event', (e, input) => this.onKey(e, input));
        // Closed by us, by the page (window.close()) or by its opener.
        wc.once('destroyed', () => this.removeTab(tab));
        if (activate || !this.active) this.activate(tab);
        this.layout();
        this.push();
        return tab;
    }
    activate(tab) {
        if (!tab) return;
        this.active?.view.setVisible(false);
        this.active = tab;
        tab.view.setVisible(true);
        this.win.setTitle(tab.title);
        tab.view.webContents.focus();
        this.layout();
        this.push();
    }
    closeTab(tab) {
        if (tab && !tab.view.webContents.isDestroyed()) tab.view.webContents.close();
    }
    removeTab(tab) {
        const i = this.tabs.indexOf(tab);
        if (i < 0) return;
        this.tabs.splice(i, 1);
        if (this.closing) return;
        this.win.contentView.removeChildView(tab.view);
        if (!this.tabs.length) { this.win.close(); return; }
        if (tab === this.active) { this.active = null; this.activate(this.tabs[Math.min(i, this.tabs.length - 1)]); }
        this.push();
    }
    tabById(id) { return this.tabs.find(t => t.id === id); }
    cycleTabs(step) {
        const i = this.tabs.indexOf(this.active);
        this.activate(this.tabs[(i + step + this.tabs.length) % this.tabs.length]);
    }

    // ---------- layout ----------
    layout() {
        const [width, height] = this.win.getContentSize();
        const full = this.fullScreen;
        this.active?.view.setBounds(full ? { x: 0, y: 0, width, height } : { x: 0, y: BAR_H, width, height: height - BAR_H });
        // Hidden by moving it above the window, so it keeps painting.
        const shown = !full || this.revealed;
        this.bar.setBounds({ x: 0, y: shown ? 0 : -BAR_H, width, height: BAR_H });
    }
    fullScreenChanged(on) {
        this.fullScreen = on;
        this.revealed = false;
        layer.apply(this.win, this.layer); // the switch resets the window's z-order style
        if (on) this.startHoverPoll(); else this.stopHoverPoll();
        this.layout();
        this.push();
    }

    // Full screen: show the bar while the mouse is at the top edge or on
    // the bar, hide it shortly after the mouse leaves.
    startHoverPoll() {
        this.stopHoverPoll();
        let leftAt = 0;
        this.poll = setInterval(() => {
            if (this.win.isDestroyed() || !this.win.isFocused()) return;
            const p = screen.getCursorScreenPoint();
            const b = this.win.getBounds();
            const inX = p.x >= b.x && p.x < b.x + b.width;
            if (!this.revealed) {
                if (inX && p.y >= b.y && p.y <= b.y + 1) this.reveal(true);
                return;
            }
            const onBar = inX && p.y >= b.y && p.y < b.y + BAR_H + 8;
            if (onBar || this.menuOpen) { leftAt = 0; return; }
            if (!leftAt) leftAt = Date.now();
            else if (Date.now() - leftAt > 350) { leftAt = 0; this.reveal(false); }
        }, HOVER_POLL_MS);
    }
    stopHoverPoll() { clearInterval(this.poll); this.poll = null; }
    reveal(on) {
        this.revealed = on;
        this.layout();
        this.push();
    }

    // ---------- bar ----------
    push() {
        if (this.bar.webContents.isDestroyed()) return;
        this.bar.webContents.send('bar:state', {
            tabs: this.tabs.map(t => ({ id: t.id, title: t.title, favicon: t.favicon, loading: t.loading })),
            active: this.active?.id,
            tabsEnabled: this.opts.tabsEnabled(),
            fullScreen: this.fullScreen,
            layer: this.layer,
            colors: this.opts.colors,
            controlsWidth: this.fullScreen ? 0 : CONTROLS_W,
        });
    }
    // at: { x, y } in window coordinates; default is the mouse position.
    popupMenu(template = this.opts.menu(this), at = {}) {
        this.menuOpen = true;
        Menu.buildFromTemplate(template).popup({ window: this.win, ...at, callback: () => { this.menuOpen = false; } });
    }
    tabMenu(tab, at) {
        const others = this.tabs.filter(t => t !== tab);
        this.popupMenu([
            { label: 'Reload tab', click: () => tab.view.webContents.reload() },
            { label: 'Close tab', accelerator: 'Ctrl+W', registerAccelerator: false, enabled: this.tabs.length > 1, click: () => this.closeTab(tab) },
            { label: 'Close other tabs', enabled: others.length > 0, click: () => others.forEach(t => this.closeTab(t)) },
            { type: 'separator' },
            ...this.opts.menu(this),
        ], at);
    }
    onKey(e, input) {
        if (input.type !== 'keyDown') return;
        const key = input.key.toLowerCase();
        const handled = () => { e.preventDefault(); return true; };
        if (input.key === 'F11') return handled() && this.toggleFullScreen();
        if (input.key === 'F5' || (input.control && key === 'r' && !input.alt)) return handled() && this.reload();
        if (!input.control || input.alt) return;
        if (input.key === 'Tab' && this.tabs.length > 1) return handled() && this.cycleTabs(input.shift ? -1 : 1);
        if (!this.opts.tabsEnabled()) return;
        if (key === 't' && !input.shift) return handled() && this.newTab();
        // Ctrl+W never closes the last tab: that would close SillyTavern by accident.
        if (key === 'w' && this.tabs.length > 1) return handled() && this.closeTab(this.active);
        if (/^[1-9]$/.test(input.key) && this.tabs.length > 1) {
            const n = Number(input.key);
            return handled() && this.activate(n === 9 ? this.tabs.at(-1) : this.tabs[n - 1]);
        }
    }
}

function overlay(c) {
    return { color: c.panel, symbolColor: c.text, height: BAR_H };
}

ipcMain.on('bar:action', (e, action, data = {}) => {
    const w = byBar.get(e.sender.id);
    if (!w) return;
    const tab = w.tabById(data.id);
    if (action === 'menu') w.popupMenu(undefined, data.at);
    else if (action === 'layer-menu') w.popupMenu(w.opts.menu(w).filter(i => i.layerItem), data.at);
    else if (action === 'reload') w.reload();
    else if (action === 'fullscreen') w.toggleFullScreen();
    else if (action === 'tab-new') w.newTab();
    else if (action === 'tab-select') w.activate(tab);
    else if (action === 'tab-close') w.closeTab(tab);
    else if (action === 'tab-menu' && tab) w.tabMenu(tab, data.at);
});
