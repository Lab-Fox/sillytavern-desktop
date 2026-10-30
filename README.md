# SillyTavern Desktop

**SillyTavern as a real Windows app.** Double-click it and SillyTavern opens in its own window: no command prompt to keep open, no browser tab to find, no scripts to run.

[SillyTavern](https://github.com/SillyTavern/SillyTavern) is a free, open-source app for chatting and roleplaying with AI characters. It works with many AI services and with models running on your own PC. SillyTavern Desktop makes it easy to install, run, update and back up, whether you've used it for years or are just trying it out.

It's a **wrapper, not a fork**: it runs your own SillyTavern exactly as it is and never changes SillyTavern's files.

**[Download the latest version](../../releases/latest)** · Windows 10 or 11

---

- [Why use it](#why-use-it)
- [Features](#features)
- [Get started](#get-started)
- [Using the app](#using-the-app)
- [Help](#help)
- [Windows only (for now)](#windows-only-for-now)
- [For developers](#for-developers)

---

## Why use it

| | The usual way | With SillyTavern Desktop |
|---|---|---|
| **Setting up** | Install Node.js and Git, clone SillyTavern, run `npm install` | The welcome screen installs everything for you |
| **Starting** | Run `Start.bat`, keep its black window open, open a browser at `localhost:8000` | Double-click the app |
| **The window** | One browser tab among many; extension pages pile up as more tabs and popups | Its own window with its own tabs, full screen, and "always on top" |
| **Updating** | `git pull` and `npm install` in a terminal, and hope nothing breaks | One button: back up, update, install what's needed, restart |
| **Backups** | Copy the `data` folder by hand | One click, automatic before updates, restore anytime |
| **Extensions** | Check each one for updates yourself | See which ones have updates and update them all at once |
| **Problems** | Scroll through a terminal | A searchable console, a health check, one-click repair tools |
| **Userscripts** | Need a browser add-on like Tampermonkey | Built in |

## Features

**Easy start**
- Finds an existing SillyTavern install on your PC by itself, or installs Node.js, Git and SillyTavern for you.
- Opens SillyTavern in its own window. The server runs hidden in the background.

**A better SillyTavern window**
- Tabs for pages that SillyTavern or its extensions open, plus full screen (**F11**), **always on top**, or **stay in background**.
- Several SillyTavern at once, including a **read-only copy** to browse chats and presets without changing anything, and other installs on your PC side by side.

**Keeps your SillyTavern healthy**
- Safe one-click updates for SillyTavern and all its extensions, and switching between the **release** and **staging** versions.
- Backups that handle any filename (emoji included). Restoring never deletes anything.
- A health check and repair tools for the most common problems.

**Comfort**
- Keeps running in the tray if you want.
- Updates itself when a new version is out, always after you click.
- Themes for the launcher (make and share your own), and your own font for the console.
- Built-in userscripts, and extensions for the app itself.

## Get started

### 1. Download

From the **[latest release](../../releases/latest)**, pick one:

| | |
|---|---|
| **`SillyTavern-Desktop-Setup.exe`** (recommended) | Installs in a few seconds, no admin rights needed. Adds Start menu and desktop shortcuts, and opens in under a second. |
| **`SillyTavern-Desktop.exe`** (portable) | Nothing to install: run it from anywhere, even a USB stick. It unpacks itself on every launch, so it takes a few seconds to open. |

Both use the same settings, so you can switch any time.

> Windows may show a SmartScreen warning because the app isn't code-signed. Click **More info → Run anyway**.

### 2. Run it

- **Already have SillyTavern?** The app looks for it on your PC and uses it. If it finds more than one, it asks which.
- **New to SillyTavern?** The welcome screen takes two clicks: **Install for me** (Node.js and Git), then **Install SillyTavern**.
- **Not found?** Click **Find it myself…** and pick your SillyTavern folder.

SillyTavern then opens in its own window. The very first start can take a minute.

### What it needs

Only **Windows 10 or 11**. SillyTavern needs [Node.js](https://nodejs.org/) 20 or newer and [Git](https://git-scm.com/); the app installs both with winget, Windows' built-in installer (Windows may ask for permission once). On a PC without winget, it links to their download pages instead.

## Using the app

### The launcher

| Page | What it's for |
|---|---|
| **Home** | Open, show or minimize SillyTavern. See your version and **Update now** when there's an update. Quick links to your characters, chats and data. |
| **Backups** | Back up your data; restore or delete a backup. |
| **Extensions** | SillyTavern's extensions with their versions; **Update all**. Also extensions for this app (**Desktop app**). |
| **Maintenance** | Update Node.js and Git, the health check, repair tools, and the release/staging switch. |
| **Console** | Everything the server prints. Filter to problems, search, or copy it for a bug report. |
| **Settings** | Themes, which SillyTavern to use, the port, the SillyTavern window, the console font, and how the app behaves. |

**Updates are safe:** **Update now** stops the server, can back up your data first, runs `git pull` and `npm install`, and starts SillyTavern again. If something blocks the update, the console says why and which repair tool fixes it.

**Backups** are saved in `backups\desktop\` inside your SillyTavern folder. Automatic ones (before updates) are trimmed to the number you choose; manual ones are kept. Restoring first moves your current `data` folder aside, so nothing is lost.

### The SillyTavern window

| To | Do this |
|---|---|
| Go full screen | **F11**. Move the mouse to the top edge to show the bar. |
| Keep it above or behind other apps | Right-click the top bar → **Always on top** or **Stay in background** (back with **Normal window**) |
| Open a tab | **+** or **Ctrl+T** |
| Switch tabs | **Ctrl+Tab**, or **Ctrl+1**…**Ctrl+9** |
| Close a tab | **×**, middle-click, or **Ctrl+W** (never closes the last tab) |
| Reload | **F5** or **Ctrl+R** |

Links to other websites open in your normal browser. Pages that SillyTavern or an extension opens (Character Library, for example) become tabs; turn that off in Settings if you prefer separate windows.

### Several SillyTavern at once

Click **▾** next to **+**:

| Choice | What you get |
|---|---|
| **Another tab of this SillyTavern** | One more page of the same SillyTavern |
| **Read-only copy** | Everything visible, but **nothing is saved and nothing is sent**: browse or compare presets safely |
| **This SillyTavern on another port** | A second server on the same folder (the app warns you: both share the same data) |
| **Other installs** | Any other SillyTavern found on your PC, each with its own data |

Each tab shows which one it is (`:8000`, `read-only :8000`, `1.13.2 :8002`…). Extra servers stop when their last tab closes.

### Add-ons

| Kind | Where it goes |
|---|---|
| **SillyTavern extensions** | Install from SillyTavern's own Extensions menu, as usual. The launcher shows and updates them. |
| **Server plugins** | SillyTavern's `plugins` folder, as usual (needs `enableServerPlugins: true` in `config.yaml`) |
| **Userscripts** (`.user.js`) | **Extensions → Userscripts → Open folder**, then restart the app. Replaces Tampermonkey. |
| **Desktop extensions** | Extensions for this app: menu items, page tweaks, their own settings panel. **Extensions → Desktop app**. They stay off until you turn them on. |

Don't put `.user.js` files in SillyTavern's `plugins` folder: SillyTavern would try to run them as server code. The app warns you if it finds one.

<details>
<summary>Userscript support in detail</summary>

Supported: `@match`, `@include`, `@exclude`, `@run-at`, `@noframes`, `@connect` (enforced), and the common `GM_*` / `GM.*` APIs: `xmlhttpRequest` (cross-site, with the window's cookies), `openInTab` (background tabs stay hidden), `getValue` / `setValue` / `deleteValue` / `listValues`, `addStyle`, `info`. Menu commands are accepted but not shown. Only install userscripts you trust.

</details>

Want to make a desktop extension? See **[EXTENSIONS.md](EXTENSIONS.md)** and the [example](examples/break-reminder).

### Themes

The launcher has a soft retro pixel look. Pick **SillyTavern** (default) or **Fox** in **Settings → Appearance**, or click **New theme**: choose seven colors and a logo, and every logo turns into pixel art. **Export** and **Import theme…** share themes as small `.json` files. Themes are only colors and an image, never code.

<details>
<summary>Theme file format</summary>

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

The seven `colors` are required; `onAccent`, `good`, `warn` and `bad` are optional. `logo` is `"st"`, `"fox"`, or a `data:image/…;base64,…` image (PNG, JPEG, GIF or WebP, up to 512 KB).

</details>

### Settings

| Setting | Default | What it does |
|---|---|---|
| Start automatically | On | Start the server and open SillyTavern when the app opens |
| Check for updates on launch | On | Shows on Home when SillyTavern has an update. Never updates by itself |
| Check for app updates on launch | On | Shows on Home when this app has a new version. **Download update**, then **Restart and update** |
| Back up before updating | On | Back up your data before every update or channel switch |
| Confirm before quitting | On | Ask before quitting while the server runs |
| Keep running in the tray | Off | Closing the launcher hides it to the tray and the server keeps running. Right-click the tray icon for more, including **Quit** |
| Automatic backups to keep | 10 | Older automatic backups are removed; manual ones never are |
| Port | `8000` | The port SillyTavern runs on |
| Window layer, tabs | Normal, on | The SillyTavern window's defaults (also in its right-click menu) |
| Console font | Pixel | Any font on your PC, and its size |

**Closing:** closing every window stops the server and quits (unless the tray is on). If SillyTavern is already running elsewhere on the same port, the app uses that server instead of starting another.

## Help

| The console says | What to do |
|---|---|
| `SillyTavern not found at …` | The welcome screen opens: pick your install or click **Find it myself…** |
| `failed to launch node` | **Settings → Change…** shows what's missing; **Install for me** installs it |
| `Update blocked by a changed package-lock.json` | **Maintenance → Reset package-lock.json**, then update again |
| `Cannot find module …` after an update | **Maintenance → Install missing dependencies** |
| `plugins/<name>.user.js is a browser userscript…` | Move that file into the userscripts folder and restart |
| `Timed out waiting for the server to respond.` | Read the lines above it, then try **Maintenance → Install missing dependencies** |
| The window never opens and another program uses the port | Change the **Port** in Settings |

Still stuck? Copy the console (**Copy** on the Console page) into a new [issue](../../issues).

<details>
<summary>Where things are stored</summary>

| What | Where |
|---|---|
| Your chats, characters and settings | Untouched, in your SillyTavern folder's `data` folder |
| Backups | `<SillyTavern folder>\backups\desktop\` |
| This app's settings and log | `%APPDATA%\SillyTavern Desktop\` (`settings.json`, `desktop-debug.log`) |
| Themes, userscripts, desktop extensions | `themes\`, `userscripts\`, `extensions\` in the same folder |
| The installed app | `%LOCALAPPDATA%\Programs\sillytavern-desktop\` |

Uninstalling keeps your settings. To reset the app completely, quit it and delete `%APPDATA%\SillyTavern Desktop\`.

</details>

## Windows only (for now)

SillyTavern Desktop runs on **Windows 10 and 11 only**. There are no Linux or macOS builds, because there's no way to test them here, and an untested build would only hand bugs to the people trying it.

**Want it on Linux or macOS? Help is welcome.** These parts are Windows-specific today:

- `winlayer.js`: "always on top" and "stay in background" call Windows directly (`user32` through `koffi`).
- `setup.js`: installs Node.js and Git with winget.
- `main.js` / `instances.js`: stop the server with `taskkill`.
- `appupdate.js` and `installer.nsh`: self-update via the Windows installer, and a batch file that swaps the portable exe.
- `package.json`: builds the Windows installer and portable exe.

Everything else is plain Electron and Node.js. If you can build and test on Linux or macOS, please open an [issue](../../issues) or a pull request.

---

## For developers

### How it works

```
┌────────────────────────────────────────────────┐
│  SillyTavern Desktop (Electron)                │
│                                                │
│  ┌──────────────┐    ┌──────────────────────┐  │
│  │ Launcher     │    │  SillyTavern window  │  │
│  │ start/update │    │  (tabs, locked to    │  │
│  │ backup/logs  │    │   your local server) │  │
│  └──────┬───────┘    └──────────┬───────────┘  │
│         │ starts (hidden)       │ HTTP         │
│         ▼                       ▼              │
│  ┌──────────────────────────────────────────┐  │
│  │  node server.js --port <port>            │  │
│  │  (your SillyTavern install, untouched)   │  │
│  └──────────────────────────────────────────┘  │
└────────────────────────────────────────────────┘
```

SillyTavern runs as a hidden child process on `127.0.0.1`, and the app talks to it only over HTTP, so SillyTavern can change internally without breaking the app. Changes to SillyTavern's pages (userscripts, desktop extensions) happen at runtime; its files are never edited. The app reports a plain Chrome user agent, so Cloudflare-protected sites used by extensions treat it like a normal browser.

**Read-only copies** block every request that would change something (saves, deletes, uploads, generating, server plugins) before it leaves the app. Only the requests SillyTavern uses for reading are allowed (an allow-list, so routes SillyTavern adds later are blocked too). Each extra SillyTavern gets its own browser session, because SillyTavern's session cookie ignores the port.

### Build from source

```bash
git clone https://github.com/Lab-Fox/sillytavern-desktop.git
cd sillytavern-desktop
npm install
npm start
```

Like the exe, `npm start` finds your SillyTavern install by itself or shows the welcome screen.

| Command | Does |
|---|---|
| `npm start` | Run the app from source |
| `npm run dist` | Build the portable exe → `dist/SillyTavern-Desktop.exe` |
| `npm run dist:installer` | Build the installer → `dist/SillyTavern-Desktop-Setup.exe` |
| `npm run dist:all` | Build both |

### Project layout

| File | Role |
|---|---|
| `main.js` | Main process: server start/stop, maintenance tasks, windows, tray, IPC, startup |
| `shell.js` | The SillyTavern window: frameless window, tabs, top bar, full screen, shortcuts |
| `stbar.html`, `bar-preload.js` | The top bar's page and its bridge to `shell.js` |
| `launcher.html`, `preload.js` | The launcher UI (one file, no external dependencies) and its bridge (`window.desktop.*`) |
| `setup.js` | Finding SillyTavern, installing Node.js/Git/SillyTavern, moving an install |
| `maintenance.js` | Version info, safe update, repairs, branch switch, backups, extension updates, health check |
| `instances.js` | Extra SillyTavern servers, the read-only filter, a browser session per instance |
| `winlayer.js` | Always on top / stay in background (Windows' `SetWindowPos` through `koffi`) |
| `userscripts.js`, `st-preload.js` | Built-in userscript manager and the `GM_*` APIs in SillyTavern pages |
| `extensions.js` | Desktop extensions: loading, the `api` object, menu items, panels |
| `appupdate.js` | Self-update from GitHub releases (SHA256-checked) |
| `themes.js` | Built-in and custom themes, import/export |
| `installer.nsh` | Installer step that asks a running app to close itself (`--quit`) first |
| `examples/`, `EXTENSIONS.md` | Example desktop extension and the extension guide |
| `fonts/`, `icon.*`, `splash.bmp` | Pixel fonts (OFL), app icon, portable splash screen |

<details>
<summary>Gotchas (read before changing things)</summary>

- **Portable exes unpack to a temp folder before running**, so `process.execPath` points to the wrong place. Use `PORTABLE_EXECUTABLE_DIR` (see `exeBases()` in `main.js`).
- **Packaged apps run from a read-only archive (asar).** Never write next to `__dirname`; use `app.getPath('userData')`.
- **Single-instance lock:** all startup wiring stays inside `if (gotLock)`. `--quit` (sent by the installer) closes a running copy and never starts one.
- **Self-update depends on release file names:** the installed app downloads `SillyTavern-Desktop-Setup.exe`, the portable one `SillyTavern-Desktop.exe`, from the latest release with a `vX.Y.Z` tag. Keep those names. `ST_DESKTOP_UPDATE_URL` points the check at a local copy of the releases API for testing.
- **The portable swap uses a batch file run by `cmd`:** a detached PowerShell (no console) exits without running anything.
- **The installer would otherwise kill the app** (electron-builder's default), and the server would never be stopped properly. `installer.nsh` overrides `customCheckAppRunning` and must include `getProcessInfo.nsh` and `Var pid` itself.
- **Stopping the server on Windows** needs `taskkill /PID <pid> /T /F` to also stop the processes SillyTavern starts.
- **The SillyTavern window is a `BaseWindow` with views**, not a `BrowserWindow`. Close the views' `webContents` when it closes (see `shell.js`).
- **Tabs take over the page Electron prepared for `window.open`** (`createWindow` in `lockToServer`, then `adoptTab`), so `window.opener` keeps working, and set `outlivesOpener: true` so they survive their opener.
- **Links leaving SillyTavern go through `openExternalSafe`:** only `http`, `https` and `mailto` reach Windows. Other protocols could start programs.
- **Server output is split into lines with `onLines`** (`maintenance.js`): chunks can end mid-line or mid-emoji.
- **Read-only is an allow-list** (`READ_POSTS` in `instances.js`). If a read breaks in read-only tabs after a SillyTavern update, add its route there.
- **Full screen:** `isFullScreen()` lags behind the `enter-full-screen` event, and Electron ignores `setAlwaysOnTop` in full screen, so `shell.js` tracks the events and `winlayer.js` also calls `SetWindowPos`.
- **Chromium stops drawing windows it thinks are covered.** "Stay in background" covers the window on purpose, so `main.js` turns native occlusion off.

</details>

### Roadmap

- [ ] Use SillyTavern from your phone on the same Wi-Fi (asks before changing `config.yaml`, with a backup)
- [ ] "Update on launch" option
- [ ] Linux and macOS ([help wanted](#windows-only-for-now))
- [ ] Code signing (no more SmartScreen warning)

### Contributing

Pull requests are welcome. One rule: **wrap, never fork.** No SillyTavern files in this repo and no edits to the user's SillyTavern files (changing its pages at runtime is fine). Keep changes small and focused, and keep `launcher.html` free of external dependencies.

## Credits

- [SillyTavern](https://github.com/SillyTavern/SillyTavern), the software this app runs. Go give it a star.
- SillyTavern's own `src/electron` launcher showed that this approach works.
- Fonts: [Pixelify Sans](https://fonts.google.com/specimen/Pixelify+Sans) and [VT323](https://fonts.google.com/specimen/VT323) (SIL Open Font License).

## License

[AGPL-3.0](LICENSE), the same as SillyTavern.
