# 🍺 SillyTavern Desktop

**SillyTavern as real software.** A standalone Windows app with a built-in browser — no cmd window, no external browser, no `.bat` scripts. Double-click an exe, get SillyTavern.

It's a **wrapper, not a fork**: it runs your existing SillyTavern install as-is and never modifies its files, so normal `git pull` updates keep working.

---

## Contents

- [Requirements](#requirements)
- [Quick start](#quick-start)
- [Using the launcher](#using-the-launcher)
- [The SillyTavern window](#the-sillytavern-window)
- [Extensions, plugins & userscripts](#extensions-plugins--userscripts)
- [Desktop extensions](#desktop-extensions)
- [Themes](#themes)
- [Settings](#settings)
- [Where things are stored](#where-things-are-stored)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [How it works](#how-it-works)
- [Roadmap](#roadmap)
- [Contributing](#contributing) · [Credits](#credits) · [License](#license)

---

## Requirements

Just **Windows 10 or 11**. The app sets up everything else for you:

| SillyTavern needs | If it's missing |
|---|---|
| [Node.js](https://nodejs.org/) 20 or newer | The welcome screen installs the latest LTS with **Install for me** |
| [Git](https://git-scm.com/) | Installed the same way |
| SillyTavern itself | **Install SillyTavern** downloads it into a folder you choose |

Installing uses **winget**, Windows' built-in package manager. Windows may ask for permission once. On a PC without winget, the welcome screen links to the Node.js and Git download pages instead.

## Quick start

1. From the [latest release](../../releases/latest), download one of:
   - **`SillyTavern-Desktop-Setup.exe`** (recommended): installs in a few seconds, no admin rights needed, adds Start menu and desktop shortcuts, and starts in under a second. Uninstall from Windows Settings → Apps.
   - **`SillyTavern-Desktop.exe`** (portable): nothing to install, put it anywhere (Desktop, a USB stick). It unpacks itself on every launch, so it takes a few seconds to open.
2. Double-click it.
   - **Already have SillyTavern?** The app searches this PC (your user folders, every drive, SillyTavern-Launcher installs) and uses it automatically. If it finds several, it asks which one.
   - **New to SillyTavern?** The welcome screen walks you through it: **Install for me** (Node.js and Git), then **Install SillyTavern**. That's it.
   - **Not found?** Click **Find it myself…** and select your SillyTavern folder, or the folder that contains it.
3. SillyTavern opens in its own window. The first start can take a minute.

The app remembers your choice. If you later move or delete SillyTavern, the welcome screen comes back and helps you find it again.

## Using the launcher

The launcher has six pages in the sidebar. **Start / Stop** in the top-right corner works from any page. The app's own version is shown under its name, top left.

| Page | What you can do there |
|---|---|
| **Home** | Open SillyTavern (or **Show** / **Restore** it when its window is open or minimized, and **Minimize** it), see your version and branch, and get an **Update now** button when an update is out. Quick buttons for backup, characters, chats, data, extensions and `config.yaml`. |
| **Backups** | Back up your data, see every backup with its date and size, and **restore** or delete one. |
| **Extensions** | **SillyTavern:** every third-party extension with its version and whether an update is waiting; **Update all** updates them in one go. **Desktop app:** extensions for this app itself (see below). |
| **Maintenance** | **Update Node.js & Git** in one click, a **health check** (Node.js, git, npm, dependencies, changed files, disk space), one-click **repair tools**, and switching between the **release** and **staging** channels. |
| **Console** | Everything the server prints. Show only problems, search, copy the whole log for a bug report, or open the log file. |
| **Settings** | **Appearance** (themes), which SillyTavern install to use (**Change…**), **Move to another folder…**, the port, and behavior switches. |

**Updating is safe by default.** **Update now** stops the server, backs up your data, runs `git pull` and then `npm install` (the step people most often forget), and starts the server again. If the update is blocked, the console says why and which repair tool fixes it.

**Backups** go to `backups/desktop/` inside your SillyTavern folder. They skip caches SillyTavern can rebuild, and handle any filename, emoji included. Automatic backups made before updates are pruned to the number you choose in Settings; manual backups are never removed. **Restoring never deletes anything:** your current `data` folder is moved to `backups/desktop/data-before-restore-<date>` first.

**Repair tools**

| Tool | Use it when |
|---|---|
| Install missing dependencies | `Cannot find module …` errors, usually right after an update |
| Reset package-lock.json | An update fails because `package-lock.json` changed (the most common cause) |
| Reinstall dependencies | Errors that survive the first fix. Deletes `node_modules` and downloads everything again; your data is not touched |

The SillyTavern window only ever shows your local server. Links to other sites open in your normal browser.

**Closing:** closing all windows stops the server and quits. Quitting another way while the server runs asks for confirmation (can be turned off).

**Already running SillyTavern elsewhere?** If something is already serving on the configured port, the app uses that server instead of starting a second one. Updates and repairs then ask you to stop that server yourself first.

## The SillyTavern window

SillyTavern gets its own window with a slim top bar: your tabs, what the active tab is running (version, branch, port), **Reload**, **Window layer**, **Full screen** and a **menu** button, next to the usual minimize / maximize / close.

| Want to | Do this |
|---|---|
| Go full screen | Press **F11** or click the full-screen button. Move the mouse to the **top edge** and the bar slides in; move away and it hides again. **F11** or **Exit full screen** leaves it. |
| Keep SillyTavern **above** every other app | Right-click the top bar → **Always on top** |
| Keep SillyTavern **behind** your other apps, even while you use it | Right-click the top bar → **Stay in background**. Handy for a full-screen SillyTavern "wallpaper" with your other windows on top. |
| Go back to a normal window | Right-click the top bar → **Normal window (default)** |
| Reload the page | **F5**, **Ctrl+R**, or the reload button |
| Open another SillyTavern tab | **+** in the tab strip or **Ctrl+T** |
| Switch tabs | Click a tab, **Ctrl+Tab** / **Ctrl+Shift+Tab**, or **Ctrl+1**…**Ctrl+9** (9 = last tab) |
| Close a tab | Its **×**, a middle click, or **Ctrl+W**. Ctrl+W never closes the last tab, so it can't close SillyTavern by accident |

### Several SillyTavern at once

Click **▾** next to **+** (or right-click the top bar → **New SillyTavern**):

| Choice | What you get |
|---|---|
| **Another tab of this SillyTavern** | One more page of the server you already run. Same port, same data, like a second browser tab |
| **Read-only copy** | Your SillyTavern with everything visible (chats, characters, presets, settings) but **nothing is saved and nothing is sent**. Browse or compare presets without touching your working tab |
| **This SillyTavern on another port** | A second server on the same folder, e.g. port 8001. Both use the same chats and settings, so whichever saves last wins; the app warns you first |
| **Other installs** | Every other SillyTavern found on this PC (e.g. an older version on another drive), each on its own port with its own data |

With tabs on they open as tabs, otherwise as windows. Every tab shows which SillyTavern it is after its title — `:8000`, `read-only :8000`, `:8001 · 2nd`, `1.13.2 :8002` — and the bar shows the details of the active one. Extra servers stop by themselves when their last tab closes, before updates and repairs, and when the app quits.

**How read-only works:** the app blocks every request from that tab that would change something (saves, deletes, uploads, imports, generating, any server plugin) before it leaves the app, and allows only the requests SillyTavern uses for reading. Inside the page, blocked saves are answered with "OK" so SillyTavern doesn't warn about a lost connection on every click; pressing send shows "this is a read-only copy". Nothing it changes is stored, not even in the browser, so closing the tab forgets it.

**Tabs:** pages that SillyTavern or an extension opens (Character Library, for example) open as tabs in this window, like in a browser, and keep working with the page that opened them. Small popup windows that ask for a size still open as windows. Right-click a tab for **Reload tab**, **Close tab** and **Close other tabs**. Don't want tabs? Turn off **Open new pages as tabs** in the right-click menu or in Settings, and new pages open as separate windows again.

The window layer is also under **Settings → SillyTavern window** in the launcher, and it's remembered, along with the window size and full screen.

## Extensions, plugins & userscripts

The app runs your normal SillyTavern, so community add-ons work as usual:

| Kind | Where it goes | Notes |
|---|---|---|
| **UI extensions** | Install from SillyTavern's Extensions menu | Nothing special — they run in the SillyTavern window |
| **Server plugins** | `<SillyTavern folder>\plugins\` | Needs `enableServerPlugins: true` in `config.yaml`, as usual |
| **Userscripts** (`.user.js`) | **Extensions → Userscripts → Open folder** in the launcher | Built-in replacement for Tampermonkey/Violentmonkey |

**Userscripts.** Some extensions ship a companion userscript you'd normally install in a browser add-on — for example Character Library's `cl-janitor-bridge.user.js`, which lets it reach JanitorAI/JannyAI through Cloudflare. The app's built-in browser has its own userscript manager instead:

1. Go to **Extensions → Userscripts → Open folder** and drop the `.user.js` file in.
2. Restart the app. The console lists what loaded, e.g. `Userscripts loaded: Character Library - JanitorAI Bridge 1.3.1`.

Supported: `@match`, `@include`, `@exclude`, `@run-at`, `@noframes`, `@connect` (enforced), and the common `GM_*` / `GM.*` APIs — `xmlhttpRequest` (cross-site, with the window's cookies), `openInTab` (background tabs stay hidden), `getValue`/`setValue`/`deleteValue`/`listValues`, `addStyle`, `info`. Menu commands are accepted but not shown anywhere.

> ⚠ **Don't put `.user.js` files in SillyTavern's `plugins/` folder.** SillyTavern tries to run them as server code and fails with errors like `location is not defined`. The app warns about this in the console when the server starts.

Only install userscripts you trust — like browser userscripts, they can make requests to any site their `@connect` allows.

## Desktop extensions

Extensions for **this app** (not for SillyTavern): anyone can add their own features without changing the app's code. An extension can:

- add items to the SillyTavern window's menu (under **Extensions**)
- add CSS or scripts to SillyTavern pages (at runtime, like a userscript — SillyTavern's files are never changed)
- show its own settings panel in the launcher
- react when the server starts or stops, and keep its own settings

Manage them in **Extensions → Desktop app**: turn each one on or off, **Open folder**, **Reload** after editing, and **Add example** to try the bundled *Break reminder*. Extensions run with full access to your PC, so they stay **off** until you turn them on, and the app asks first.

**Making one:** see **[EXTENSIONS.md](EXTENSIONS.md)** for the folder layout, `manifest.json`, the full API and the launcher panel, and copy [`examples/break-reminder`](examples/break-reminder) to start.

## Themes

The launcher has a retro pixel look, designed to be easy on the eyes: a readable pixel font (Pixelify Sans), a pixel console font (VT323), soft contrast, and no scanlines or glow. Pick a theme in **Settings → Appearance**:

| Theme | Look |
|---|---|
| **SillyTavern** (default) | Charcoal with a soft crimson accent and SillyTavern's own logo (read from your install) |
| **Fox** | Warm browns, fox orange and a pixel fox |

**Make your own:** click **New theme** (or **Customize** on a built-in one). Pick seven colors, then upload a logo or reuse the ST or Fox logo. Changes preview live, and every logo is shown as pixel art. Click **Save theme** to keep it.

**Share themes:** **Export** saves a theme as a `.json` file; **Import theme…** loads one. A theme file looks like this:

```json
{
  "format": 1,
  "name": "Midnight",
  "author": "you",
  "colors": {
    "bg": "#14161f", "panel": "#1c1f2b", "border": "#30364a", "accent": "#7aa2f7",
    "text": "#c8cde0", "title": "#eef0f8", "muted": "#8a90a8"
  },
  "logo": "st"
}
```

- `colors`: these seven are required. `onAccent`, `good`, `warn` and `bad` are optional; everything else is mixed from these.
- `logo`: `"st"`, `"fox"`, or a `data:image/png;base64,…` image (PNG, JPEG, GIF or WebP, max 512 KB).

Themes are only colors and an image, never CSS or code, so an imported theme can't change anything except how the launcher looks. Custom themes are stored in `%APPDATA%\SillyTavern Desktop\themes\`.

## Settings

| Setting | Default | Notes |
|---|---|---|
| SillyTavern install | Found automatically | **Change…** picks another install on this PC or a folder; **Move to another folder…** relocates it |
| Port | `8000` | Passed to the server with `--port`, overriding `config.yaml` |
| Start server automatically | On | Start the server and open SillyTavern as soon as the app launches |
| Confirm before quitting | On | Ask before quitting while the server runs |
| Keep running in the tray | Off | Closing the launcher hides it to the tray and the server keeps running. Click the tray icon for the launcher; right-click it to open, show or minimize SillyTavern, start or stop the server, or quit |
| Check for updates on launch | On | Shows "update available" on Home. Never updates by itself |
| Back up before updating | On | Zip your data before every update or channel switch |
| Automatic backups to keep | 10 | Older automatic backups are removed; manual backups never are |
| Open new pages as tabs | On | Pages SillyTavern or extensions open become tabs; off = separate windows |
| Window layer | Normal | **On top** or **In background** (see [The SillyTavern window](#the-sillytavern-window)). Applies right away |
| Console font | Pixel (VT323), 18 | Any font installed on your PC, and its size, for the Console page and activity logs. Applies right away |

Path and port changes take effect the next time the server starts — stop it first if it's running.

## Where things are stored

| What | Location |
|---|---|
| App settings | `%APPDATA%\SillyTavern Desktop\settings.json` |
| App log (everything shown in the console) | `%APPDATA%\SillyTavern Desktop\desktop-debug.log` |
| Window size and full screen | Saved in `settings.json` when the SillyTavern window closes |
| Custom themes | `%APPDATA%\SillyTavern Desktop\themes\` |
| Userscripts | `%APPDATA%\SillyTavern Desktop\userscripts\` (saved values: `userscript-values.json` next to it) |
| Desktop extensions | `%APPDATA%\SillyTavern Desktop\extensions\<id>\` (which ones are on: `settings.json`) |
| Backups | `<SillyTavern folder>\backups\desktop\st-backup-<date>.zip` |
| Your chats, characters, etc. | Untouched, in `<SillyTavern folder>\data\` |

The installer puts the app itself in `%LOCALAPPDATA%\Programs\sillytavern-desktop\`. Both versions share the same settings. Uninstalling keeps them.

To reset the app, quit it and delete `%APPDATA%\SillyTavern Desktop\`.

## Troubleshooting

| Console says | Fix |
|---|---|
| `SillyTavern not found at …` | The welcome screen opens — pick your install from the list or click **Find it myself…** |
| `plugins/<name>.user.js is a browser userscript…` or `location is not defined` | Move that file from `plugins/` into the userscripts folder and restart |
| An extension says its userscript/bridge isn't installed | Put the `.user.js` in the userscripts folder and restart the app |
| `failed to launch node` | **Settings → Change…** shows what's missing; **Install for me** installs Node.js |
| `git not found` | Install git (only needed for Update / version) |
| `Update blocked by a changed package-lock.json` | **Maintenance → Reset package-lock.json**, then update again |
| `Cannot find module …` after an update | **Maintenance → Install missing dependencies** |
| `Timed out waiting for the server to respond.` | Read the lines above it. Often a missing `npm install` in SillyTavern after an update — run `npm install` in the SillyTavern folder |
| The window never opens and the port is in use by another program | Change the **Port** in Settings |

Still stuck? Check `desktop-debug.log` and open an [issue](../../issues).

## Development

Clone the repo anywhere — like the exe, `npm start` finds your SillyTavern install on its own (or shows the welcome screen):

```bash
cd SillyTavern-Launcher
git clone https://github.com/Lab-Fox/sillytavern-desktop.git ST-Desktop
cd ST-Desktop
npm install
```

| Command | Does |
|---|---|
| `npm start` | Run the app from source |
| `npm run dist` | Build the portable exe → `dist/SillyTavern-Desktop.exe` |
| `npm run dist:installer` | Build the installer → `dist/SillyTavern-Desktop-Setup.exe` |
| `npm run dist:all` | Build both |

### Project layout

| File | Role |
|---|---|
| `main.js` | Electron main process: server start/stop/attach, git, backups, windows, IPC |
| `preload.js` | The only bridge between the launcher UI and `main.js` (`window.desktop.*`) |
| `setup.js` | Finding SillyTavern anywhere on the PC, installing Node.js/Git with winget, fresh SillyTavern install, moving an install |
| `maintenance.js` | Version info, safe update, repair tools, branch switching, backups (zip/unzip in JS), extensions, health check |
| `userscripts.js` | Built-in userscript manager: parses `.user.js` headers, URL matching, GM_* backend (requests, background tabs, values) |
| `st-preload.js` | Runs in every frame of SillyTavern windows; injects matching userscripts with the GM_* shim |
| `launcher.html` | Launcher UI — one self-contained file, no external dependencies |
| `themes.js` | Built-in themes, custom theme storage, validation, import/export |
| `shell.js` | The SillyTavern window: frameless window, tabs, top bar, full screen with the hover bar, keyboard shortcuts |
| `stbar.html` / `bar-preload.js` | The top bar's page and its bridge to `shell.js` |
| `winlayer.js` | Normal / always on top / stay in background (calls Windows' `SetWindowPos` through `koffi`) |
| `extensions.js` | Desktop extensions: discovery, turning on/off, the `api` object, page styles/scripts, menu items, panel handlers |
| `examples/` | Example desktop extension (bundled; **Add example** copies it) |
| `EXTENSIONS.md` | How to write a desktop extension |
| `instances.js` | Extra SillyTavern servers (free port, start/stop), the read-only filter and in-page shim, a browser session per instance |
| `fonts/` | Bundled pixel fonts (Pixelify Sans, VT323) with their OFL licenses |
| `icon.ico` / `icon.png` | App icon (`.ico` is used by Windows and the build; `.png` is the source image) |
| `splash.bmp` | Shown by the portable exe while it unpacks itself (build resource, not part of the app) |
| `installer.nsh` | Extra installer step: asks a running app to close itself (`--quit`) before installing or uninstalling (build resource) |
| `package.json` | App metadata and electron-builder config |

### Gotchas (read before changing things)

- **Portable exes unpack to a temp folder before running**, so `process.execPath` points to the wrong place. Use `PORTABLE_EXECUTABLE_DIR` — see `exeBases()` in `main.js`.
- **Packaged apps run from a read-only archive (asar).** Never write files next to `__dirname`; use `app.getPath('userData')`.
- **Single-instance lock:** all startup wiring must stay inside `if (gotLock)`, or a second launch starts a server inside an app that is already quitting. `--quit` (sent by the installer) closes a running copy and never starts one.
- **The installer would otherwise kill the app** (electron-builder's default), so the server never gets stopped properly. `installer.nsh` overrides `customCheckAppRunning` and must include `getProcessInfo.nsh` and `Var pid` itself, because electron-builder only adds them when there's no custom check.
- **Stopping the server on Windows** needs `taskkill /PID <pid> /T /F` to also kill the processes SillyTavern starts.
- **The SillyTavern window is a `BaseWindow` with views**, not a `BrowserWindow`. Views aren't owned by the window: close their `webContents` when it closes (see `shell.js`).
- **Tabs take over the page Electron prepared for `window.open`** (`createWindow` in `lockToServer`, then `adoptTab` in `shell.js`). A fresh page would break `window.opener`, and extensions write into the `about:blank` page they open. Tabs also set `outlivesOpener: true`; by default Electron closes opened pages together with their opener.
- **The portable exe unpacks itself on every launch** (that's most of its startup time; the app itself starts in about half a second). Keep the build small: `electronLanguages` drops Chromium's other translations, and `splash.bmp` shows while it unpacks.
- **Links leaving SillyTavern go through `openExternalSafe`** in `main.js`: only `http`, `https` and `mailto` are handed to Windows. Other protocols (`file:`, `ms-…:`, `search-ms:`) could start programs.
- **Server output is split into lines with `onLines`** (`maintenance.js`): chunks can end in the middle of a line or of an emoji.
- **SillyTavern's session cookie is named after the PC, not the port**, and cookies ignore ports. Two servers on `127.0.0.1` in one browser session overwrite each other's login/CSRF session, so every extra instance gets its own session (`partitionFor()` in `instances.js`).
- **Read-only = allow-list.** `READ_POSTS` lists the POST routes SillyTavern uses to read; anything else that isn't a GET is blocked, including routes SillyTavern adds later. If a read breaks in read-only tabs after a SillyTavern update, add its route there.
- **`isFullScreen()` lags behind the `enter-full-screen` event** on Windows; `shell.js` tracks full screen from the events instead.
- **Electron ignores `setAlwaysOnTop` and `moveTop` while a window is full screen**, so `winlayer.js` also sets the z-order with `SetWindowPos`, and the layer is re-applied after every full-screen change.
- **Chromium stops drawing windows it thinks are covered** (native occlusion). "Stay in background" covers the window on purpose, which left the top bar blank, so `main.js` turns that feature off.

## How it works

```
┌────────────────────────────────────────────────┐
│  SillyTavern-Desktop.exe (Electron)            │
│                                                │
│  ┌──────────────┐    ┌──────────────────────┐  │
│  │ Launcher     │    │  SillyTavern window  │  │
│  │ start/update │    │  (Chromium, locked   │  │
│  │ backup/logs  │    │   to localhost)      │  │
│  └──────┬───────┘    └──────────┬───────────┘  │
│         │ starts (hidden)       │ HTTP         │
│         ▼                       ▼              │
│  ┌──────────────────────────────────────────┐  │
│  │  node server.js --port <port>            │  │
│  │  (your SillyTavern install, untouched)   │  │
│  └──────────────────────────────────────────┘  │
└────────────────────────────────────────────────┘
```

Windows the SillyTavern page opens (e.g. Character Library's tab) get the same rules as the main window. The app reports a plain Chrome user agent so Cloudflare-protected sites used by extensions treat it like a normal browser.

The server runs as a hidden child process on `127.0.0.1`. The app talks to it only over HTTP, so SillyTavern can change internally without breaking the wrapper.

## Roadmap

- [x] Test the installer build (`npm run dist:installer`); published with the next release
- [ ] "Update on launch" option (git pull before starting the server)
- [x] System tray mode (close to tray, server keeps running)
- [ ] Linux/macOS support
- [x] Show/restore the SillyTavern window from the launcher when it's hidden

## Contributing

PRs welcome. One rule: **wrap, never fork** — no SillyTavern files in this repo and no patching of the SillyTavern install at runtime. Keep changes small and focused, and keep `launcher.html` dependency-free.

## Credits

- [SillyTavern](https://github.com/SillyTavern/SillyTavern) — the actual software this wraps. Go star it.
- SillyTavern's own `src/electron` scaffold showed this approach works.

## License

[AGPL-3.0](LICENSE), same as SillyTavern.
