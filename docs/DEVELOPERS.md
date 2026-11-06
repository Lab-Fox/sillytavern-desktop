# For developers

[README](../README.md) · [User guide](USER-GUIDE.md) · [Troubleshooting](TROUBLESHOOTING.md) · **Developers**

How the app works, how to build it, and how to help.

- [How it works](#how-it-works)
- [Build from source](#build-from-source)
- [Project layout](#project-layout)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [Windows only (for now)](#windows-only-for-now)

---

## How it works

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

**Phone access** sets SillyTavern's `listen`, `whitelistMode`, `whitelist` (this PC plus its own private networks, e.g. `192.168.1.0/24`) and, with a password, `basicAuthMode` through `SILLYTAVERN_*` environment variables on the main server only. SillyTavern reads those before `config.yaml`, so the file is never edited. The app answers the login for its own windows (`app.on('login')`). An old `whitelist.txt` overrides the whitelist, so the app warns about it.

**Read-only copies** block every request that would change something (saves, deletes, uploads, generating, server plugins) before it leaves the app. Only the requests SillyTavern uses for reading are allowed (an allow-list, so routes SillyTavern adds later are blocked too). Each extra SillyTavern gets its own browser session, because SillyTavern's session cookie ignores the port.

## Build from source

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

## Project layout

| File | Role |
|---|---|
| `main.js` | Main process: server start/stop, maintenance tasks, windows, tray, IPC, startup |
| `shell.js` | The SillyTavern window: frameless window, tabs, top bar, full screen, shortcuts |
| `stbar.html`, `bar-preload.js` | The top bar's page and its bridge to `shell.js` |
| `launcher.html`, `preload.js` | The launcher UI (one file, no external dependencies) and its bridge (`window.desktop.*`) |
| `i18n.js`, `i18n-dom.js`, `locales/` | Languages: `t()` for the main process, the page translator and `T()` for the launcher and top bar, one JSON file per language (English text is the key; see `locales/README.md`) |
| `serveropts.js` | SillyTavern options passed as `SILLYTAVERN_*` variables (reads `config.yaml` without writing it) and the HTTPS certificate (made with Node's crypto) |
| `tunnel.js` | Remote link (downloads and runs `cloudflared`, reads its address) and Tailscale (status, addresses) |
| `aiapps.js` | AI apps: the text apps (KoboldCpp, llama.cpp, Text generation web UI, TabbyAPI), install/update from GitHub releases (SHA256-checked) or git + uv, start/stop/logs, options, models (Hugging Face search, files, resumable checked downloads), picture models (shared folder, suggestions, Hugging Face and Civitai links) |
| `aiapps-media.js` | The picture and voice apps (ComfyUI, Forge Neo, Forge, AUTOMATIC1111, Fooocus, InvokeAI, SwarmUI, AllTalk v2, XTTS) and the helper tools installed with winget |
| `pccheck.js` | Graphics cards and memory, model-size advice, which program holds a port, VPN adapters, the system report |
| `tools/i18n-check.mjs` | `npm run i18n`: finds every translatable string and checks each language file (missing, broken placeholders or markup, plural forms); `--new` and `--fill` for translators |
| `setup.js` | Finding SillyTavern, installing Node.js and Git, moving an install |
| `runtime.js` | The app's own Node.js and Git: download from nodejs.org / Git for Windows, SHA256 check, unpack, put in front of `PATH` |
| `importer.js` | Import: telling cards, lorebooks and presets apart, and sending them to SillyTavern's own import endpoints |
| `remote.js` | SillyTavern on other computers: the list, address checks, encrypted logins, the Test probe |
| `backupsched.js` | Scheduled backups: when they are due, "did anything change", where they go, failures |
| `profiles.js` | Profiles: named SillyTavern folders (`settings.profiles`) |
| `stextensions.js` | SillyTavern extensions: the Tavernary catalog and ratings, update snapshots and undo, installing, Kits |
| `migrate.js` | Migrating data: scanning both folders into categories and items, copying with a conflict rule, journals and Undo |
| `history.js` | Change history per folder (`st-history.json`): what an update, download, branch switch or outside change brought |
| `downloader.js` | Downloading SillyTavern: the version list (GitHub releases, `git ls-remote` as fallback), partial clone + `npm install`, cancel |
| `maintenance.js` | Version info, safe update, repairs, branch switch, backups, extension updates, health check |
| `instances.js` | Extra SillyTavern servers, the read-only filter, a browser session per instance |
| `winlayer.js` | Always on top / stay in background (Windows' `SetWindowPos` through `koffi`) |
| `userscripts.js`, `st-preload.js` | Built-in userscript manager and the `GM_*` APIs in SillyTavern pages |
| `extensions.js` | Desktop extensions: loading, the `api` object, menu and right-click entries, page calls, downloads, panels |
| `addons.js` | "Get add-ons": the desktop extension catalog, SHA256-checked install and update, remove |
| `contextmenu.js` | The right-click menu of SillyTavern pages and the launcher's text fields |
| `addons/` | Add-ons for the "Get add-ons" list (`writing-helper`) and `build.cjs`, which zips one and prints its list entry |
| `chromeext.js` | Chrome extensions: the Chrome Web Store ([electron-chrome-web-store](https://github.com/samuelmaddock/electron-browser-shell/tree/master/packages/electron-chrome-web-store)), Chrome APIs ([electron-chrome-extensions](https://github.com/samuelmaddock/electron-browser-shell/tree/master/packages/electron-chrome-extensions)), loading them into every SillyTavern session, on/off, remove |
| `appupdate.js` | Self-update from GitHub releases (SHA256-checked) |
| `lan.js` | Phone access: local networks, the server's environment variables, QR codes (`qrcode-generator`) |
| `themes.js` | Built-in and custom themes, import/export, and what themes may rely on (`TOKENS`, `PARTS`, `CLASSES`, `STATES`, `THEME_API`) |
| `themepackage.js` | `.sttheme` files: checks, install, export, remove |
| `themecss.js` | The check all theme CSS goes through on every load (uses `css-tree`; plain Node) |
| `themestudio.js` | Theme Studio: the draft folder, generated CSS, saving a package |
| `themecheck.js` | "Check it" for theme authors |
| `examples/starter-theme/`, `examples/themes/` | The starter theme and the example themes (their pictures come from `tools/art/themes.mjs`) |
| `themeroute.js` | `st-theme://<package>/<path>`, the only way theme files reach a page (pictures, video and fonts only), and the block on `file:` addresses outside the app. `--safe-theme` starts with the default theme |
| `installer.nsh` | Installer steps: ask a running app to close itself (`--quit`) first; the **Open with** entries for cards, lorebooks and presets |
| `examples/`, `EXTENSIONS.md` | Example desktop extension and the extension guide |
| `fonts/`, `icon.*`, `splash.bmp` | Pixel fonts (OFL), app icon, portable splash screen |

<details>
<summary>Gotchas (read before changing things)</summary>

- **Portable exes unpack to a temp folder before running**, so `process.execPath` points to the wrong place. Use `PORTABLE_EXECUTABLE_DIR` (see `exeBases()` in `main.js`).
- **Packaged apps run from a read-only archive (asar).** Never write next to `__dirname`; use `app.getPath('userData')`.
- **Single-instance lock:** all startup wiring stays inside `if (gotLock)`. `--quit` (sent by the installer) closes a running copy and never starts one.
- **Self-update depends on release file names:** the installed app downloads `SillyTavern-Desktop-Setup.exe`, the portable one `SillyTavern-Desktop.exe`, from the latest release with a `vX.Y.Z` tag. Keep those names. `ST_DESKTOP_UPDATE_URL` points the check at a local copy of the releases API for testing, `ST_DESKTOP_RELEASES_URL` the preview check (which reads the release list, because GitHub's "latest" is never a pre-release). Preview versions are `X.Y.Z-preview.N` tags published with `--prerelease`; a regular `X.Y.Z` counts as newer than its previews.
- **Remote SillyTavern** (`remote.js`, `settings.remotes`) are not profiles: they never become `sillytavernPath`, they open as tabs with `persist:remote-<id>` sessions, and `lockToServer` keeps those tabs on their own origin. Basic-auth logins come from `app.on('login')` (two tries per 10 s); changing a login clears that session's auth cache. Passwords are stored with `safeStorage` (DPAPI), and `publicSettings()` leaves `remotes` out entirely.
- **GitHub allows 60 unauthenticated API requests per hour per connection.** The check's answer is kept for 6 hours in `app-update-check.json` (app data folder) and reused on launch; the app re-checks every 6 hours while open; a refused check (403/429 with the rate-limit headers) falls back to the remembered answer and is retried after GitHub's reset time. **Check for app updates** always asks GitHub.
- **The portable swap uses a batch file run by `cmd`:** a detached PowerShell (no console) exits without running anything.
- **The installer would otherwise kill the app** (electron-builder's default), and the server would never be stopped properly. `installer.nsh` overrides `customCheckAppRunning` and must include `getProcessInfo.nsh` and `Var pid` itself.
- **Stopping the server on Windows** needs `taskkill /PID <pid> /T /F` to also stop the processes SillyTavern starts.
- **The SillyTavern window is a `BaseWindow` with views**, not a `BrowserWindow`. Close the views' `webContents` when it closes (see `shell.js`).
- **Tabs take over the page Electron prepared for `window.open`** (`createWindow` in `lockToServer`, then `adoptTab`), so `window.opener` keeps working, and set `outlivesOpener: true` so they survive their opener.
- **Links leaving SillyTavern go through `openExternalSafe`:** only `http`, `https` and `mailto` reach Windows. Other protocols could start programs.
- **Server output is split into lines with `onLines`** (`maintenance.js`): chunks can end mid-line or mid-emoji.
- **Read-only is an allow-list** (`READ_POSTS` in `instances.js`). If a read breaks in read-only tabs after a SillyTavern update, add its route there.
- **Full screen:** `isFullScreen()` lags behind the `enter-full-screen` event, and Electron ignores `setAlwaysOnTop` in full screen, so `shell.js` tracks the events and `winlayer.js` also calls `SetWindowPos`.
- **A SillyTavern window that isn't seen must not draw.** SillyTavern pages use `backgroundThrottling: true` and Chromium's native occlusion stays on, so a minimized, covered or inactive tab stops rendering (an animated background behind other windows used to keep the GPU busy). Only the `GM_openInTab` helper windows keep `backgroundThrottling: false`.
- **Profiles are only a list** (`settings.profiles`); the folder in use is still `settings.sillytavernPath`. Every switch goes through `runTask` + `switchTo()` in `main.js`, which also stops an extra server already running from the new folder.
- **Extension ratings** come from `https://tavernary.org/catalog/tavernary-catalog-v8.json` (ODbL, credited on the Extensions page; keep the credit and the "not affiliated" note). `stextensions.js` keeps a slim copy in `ext-catalog.json` (app data) for 24 hours and revalidates with the ETag. Installed extensions are matched by their `origin` address (read from `.git/config`); "your version was scanned" compares the exact commit with the scan history. SillyTavern installs extensions as shallow clones (`--depth 1`), so ancestry can't be checked: newer/older is told by date. A new catalog schema version needs a code change (the app reports "unexpected catalog format").
- **Extension snapshots** (`backups/desktop/extension-snapshots/*.json` in the SillyTavern folder) record the commit before and after each update; undo uses `git reset --hard` on the extension's branch, only when it is still at the "after" commit and has no local changes.
- **Migration** works on items (a character card + its sprite folder, a chat folder, a group + its chats, an extension folder…), each a list of files with a state (new / same / different). `scan()` keeps the file lists in the main process; the launcher sends item keys. Small files are compared by content, big ones by size and time. Copies keep the source's modification time. Every run writes a journal to `backups/desktop/migrations/<stamp>/` in the target (added files, copies of replaced files) that `undo()` uses; the folder disappears after a complete Undo. Thumbnails, `content.log` and temp files are never copied.
- **Change history** records commits with `git log from..to` (short hashes from `getInfo()`); release notes aren't stored, the launcher reads them from the version list. Every task that changes SillyTavern's files should go through `tracked()` in `main.js`; `checkOutsideChanges()` compares the folder with the last commit the app saw (on launch and on every switch).
- **Security fixes per release** are lines of the release notes matching `SECURITY` in `downloader.js` (security, vulnerability, CVE, XSS, path traversal, SSRF, sanitization, injection), cleaned of Markdown. They drive the older-version warning, the "⚠ missing security fixes" marks and the profile tags (`olderStatus()` reads only the cached list; the app refreshes it in the background on launch).
- **Downloads are partial clones** (`git clone --filter=blob:none --branch <ref>`): ~100 MB instead of ~210 MB, and `git pull` and branch switches still work. A specific version is a tag, so the checkout is on no branch: `getInfo()` reports it as `pinned` and `update()` refuses with a clear message. The version list is cached for an hour in `st-versions.json` (app data folder).
- **The app's own Node.js and Git** live in `runtime\node` and `runtime\git` in the app data folder. `runtime.apply()` puts `runtime\node` and `runtime\git\cmd` in front of `process.env.Path`; every child process inherits it, so nothing else needs to know. `setup.refreshPath()` (after winget) replaces `Path`, so it calls `runtime.reapply()`. Replacing or removing a copy that a server runs on needs the servers stopped (`runTask` with `needsStopped`), so updating looks first and only stops them when something is newer.
- **Import goes through SillyTavern's endpoints** (`/api/characters/import`, `/api/worldinfo/import`, `/api/presets/save`) with a session of its own: `GET /csrf-token` gives the token and cookie. Multipart uploads use the field name `avatar` (SillyTavern's multer setup). Lorebook and preset imports overwrite a file of the same name, so `importer.js` picks a free name first (for the default user). With SillyTavern's user accounts on, these requests need a login, and the app says to import from SillyTavern itself.
- **Scheduled backups** compare a fingerprint of `data` (file count, total size, newest change; stats only) with the last one, kept in `backup-schedule.json` (app data folder). Their zips end in `-auto-scheduled.zip` and are pruned separately from the ones before updates.
- **Git calls run side by side where they can:** extension status runs 8 extensions at a time (6 while fetching), SillyTavern's version info asks its git questions at once, and the launcher only runs the full setup check (drive scan, node/git/winget) while the welcome screen is open (`setup-ready` is the cheap one). Keep new per-extension work inside `eachLimited` in `listExtensions`.
- **SillyTavern opens a browser tab on start** when `browserLaunch.enabled` is on (the default in a fresh `config.yaml`). `instances.serverEnv()` turns that off for every server the app starts (`SILLYTAVERN_BROWSERLAUNCH_ENABLED`, and `SILLYTAVERN_AUTORUN` for older versions).

</details>

## Roadmap

- [x] Use SillyTavern from your phone on the same Wi-Fi
- [x] "Update on launch" option
- [x] Profiles and a SillyTavern downloader (any version, with a warning for older ones)
- [x] Migrate data between SillyTavern folders and users, with Undo
- [x] Extension safety ratings, update review and undo, Kits, finding extensions
- [x] What's new: release notes and changes before and after updates, history per install
- [x] Scheduled backups, import by drag & drop / Open with, the app's own Node.js and Git
- [x] Preview versions of the app, SillyTavern on another computer, a clearer pixel font and font/size settings
- [x] Right-click menu, dragging tabs (also into their own window), installing desktop extensions from a list
- [x] Chrome extensions from the Chrome Web Store
- [x] Writing helper add-on: dictionary, suggestions, autocorrect
- [x] Languages: English, Indonesian, Japanese, Korean, Chinese (Simplified and Traditional); more from contributors
- [x] Launcher.bat's SillyTavern tools: remote link, Tailscale, HTTPS, server options, start with SillyTavern, PC check, troubleshooting
- [x] AI apps for text: KoboldCpp, llama.cpp, Text generation web UI, TabbyAPI, with model downloads
- [x] AI apps for pictures and voices: ComfyUI, Forge Neo, Forge, AUTOMATIC1111, Fooocus, InvokeAI, SwarmUI, AllTalk v2, XTTS, with shared picture models
- [ ] Linux and macOS ([help wanted](#windows-only-for-now))
- [ ] Code signing (no more SmartScreen warning)

## Contributing

Pull requests are welcome, translations too ([how](../locales/README.md)). One rule: **wrap, never fork.** No SillyTavern files in this repo and no edits to the user's SillyTavern files (changing its pages at runtime is fine). Keep changes small and focused, and keep `launcher.html` free of external dependencies.

## Windows only (for now)

SillyTavern Desktop runs on **Windows 10 and 11 only**. There are no Linux or macOS builds, because there's no way to test them here, and an untested build would only hand bugs to the people trying it.

**Want it on Linux or macOS? Help is welcome.** These parts are Windows-specific today:

- `winlayer.js`: "always on top" and "stay in background" call Windows directly (`user32` through `koffi`).
- `setup.js`: installs Node.js and Git with winget.
- `main.js` / `instances.js`: stop the server with `taskkill`.
- `appupdate.js` and `installer.nsh`: self-update via the Windows installer, and a batch file that swaps the portable exe.
- `package.json`: builds the Windows installer and portable exe.

Everything else is plain Electron and Node.js. If you can build and test on Linux or macOS, please open an [issue](https://github.com/Lab-Fox/sillytavern-desktop/issues) or a pull request.
