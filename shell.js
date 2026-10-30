// The SillyTavern window: a frameless window with our own top bar (with
// Windows' native min/max/close drawn over its right end) and the page in
// a view below it. In full screen the page fills the window and the bar
// slides in over it when the mouse touches the top edge.
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
    //       webPreferences, setupPage(webContents), menu(stWindow) → template,
    //       onClose({ width, height, fullScreen })
    constructor(opts) {
        this.opts = opts;
        this.layer = opts.layer;
        this.revealed = false;
        this.menuOpen = false;
        // Tracked from the events: isFullScreen() still reports the old
        // state while 'enter-full-screen' is being emitted.
        this.fullScreen = false;
        this.state = { title: 'SillyTavern', favicon: '', loading: true };

        const win = this.win = new BaseWindow({
            width: opts.width, height: opts.height, minWidth: 640, minHeight: 420,
            title: 'SillyTavern', icon: opts.icon, show: false,
            backgroundColor: opts.colors.bg,
            titleBarStyle: 'hidden', titleBarOverlay: overlay(opts.colors),
        });

        this.page = new WebContentsView({ webPreferences: opts.webPreferences });
        this.page.setBackgroundColor(opts.colors.bg);
        this.bar = new WebContentsView({
            webPreferences: { preload: path.join(__dirname, 'bar-preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
        });
        this.bar.setBackgroundColor('#00000000');
        win.contentView.addChildView(this.page);
        win.contentView.addChildView(this.bar); // added last = drawn on top
        byBar.set(this.bar.webContents.id, this);

        const wc = this.page.webContents;
        opts.setupPage(wc);
        wc.on('page-title-updated', (_e, title) => { this.state.title = title; win.setTitle(title); this.push(); });
        wc.on('page-favicon-updated', (_e, icons) => { this.state.favicon = icons[0] || ''; this.push(); });
        wc.on('did-start-loading', () => { this.state.loading = true; this.push(); });
        wc.on('did-stop-loading', () => { this.state.loading = false; this.push(); });
        for (const c of [wc, this.bar.webContents]) c.on('before-input-event', (e, input) => this.onKey(e, input));

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
            this.stopHoverPoll();
            byBar.delete(this.bar.webContents.id);
            this.bar.webContents.close();
            wc.close();
        });

        this.bar.webContents.loadFile(path.join(__dirname, 'stbar.html'));
        this.bar.webContents.once('did-finish-load', () => this.push());
        wc.loadURL(opts.url);
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
    reload() { this.page.webContents.reload(); }
    toggleFullScreen() { this.win.setFullScreen(!this.fullScreen); }
    setLayer(mode) {
        this.layer = mode;
        layer.apply(this.win, mode);
        this.push();
    }
    setColors(colors) {
        this.page.setBackgroundColor(colors.bg);
        this.win.setBackgroundColor(colors.bg);
        this.win.setTitleBarOverlay(overlay(colors));
        this.opts.colors = colors;
        this.push();
    }

    // ---------- layout ----------
    layout() {
        const [width, height] = this.win.getContentSize();
        const full = this.fullScreen;
        this.page.setBounds(full ? { x: 0, y: 0, width, height } : { x: 0, y: BAR_H, width, height: height - BAR_H });
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
            ...this.state,
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
    onKey(e, input) {
        if (input.type !== 'keyDown') return;
        if (input.key === 'F11') { e.preventDefault(); this.toggleFullScreen(); }
        else if (input.key === 'F5' || (input.control && input.key.toLowerCase() === 'r' && !input.alt)) { e.preventDefault(); this.reload(); }
    }
}

function overlay(c) {
    return { color: c.panel, symbolColor: c.text, height: BAR_H };
}

ipcMain.on('bar:action', (e, action, at) => {
    const w = byBar.get(e.sender.id);
    if (!w) return;
    if (action === 'menu') w.popupMenu(undefined, at);
    else if (action === 'layer-menu') w.popupMenu(w.opts.menu(w).filter(i => i.layerItem), at);
    else if (action === 'reload') w.reload();
    else if (action === 'fullscreen') w.toggleFullScreen();
});
