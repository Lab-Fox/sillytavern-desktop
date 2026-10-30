# 🍺 SillyTavern Desktop

**SillyTavern as real software.** A standalone Windows app with a built-in browser — no cmd window, no external browser, no `.bat` scripts. Double-click an exe, get SillyTavern.

It's a **wrapper, not a fork**: it runs your existing SillyTavern install as-is and never modifies its files, so normal `git pull` updates keep working.

---

## Contents

- [Requirements](#requirements)
- [Quick start](#quick-start)
- [Using the launcher](#using-the-launcher)
- [Settings](#settings)
- [Where things are stored](#where-things-are-stored)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [How it works](#how-it-works)
- [Roadmap](#roadmap)
- [Contributing](#contributing) · [Credits](#credits) · [License](#license)

---

## Requirements

| Need | Why |
|---|---|
| Windows 10 or 11 | Only Windows is built and tested right now |
| A SillyTavern install made with `git clone` | The app runs it and updates it with `git pull` |
| [Node.js](https://nodejs.org/) 20 or newer, on `PATH` | Runs the SillyTavern server (same requirement as SillyTavern itself) |
| [git](https://git-scm.com/), on `PATH` | Only for **Update** and **Show current version** |

Installed SillyTavern with [SillyTavern-Launcher](https://github.com/SillyTavern/SillyTavern-Launcher)? You already have all of this.

## Quick start

1. Download `SillyTavern-Desktop.exe` from the [latest release](../../releases/latest).
2. Put it where the app can find SillyTavern automatically. Any of these work:

   ```
   SillyTavern-Launcher\
   ├── SillyTavern\                ← your install (must contain server.js)
   └── ST-Desktop\
       └── dist\
           └── SillyTavern-Desktop.exe   ← recommended spot
   ```

   The exe looks for a `SillyTavern` folder next to itself, one level up, or two levels up.
3. Double-click the exe. The launcher opens, the server starts in the background, and the SillyTavern window appears once the server is ready (the first start can take a minute).

Exe somewhere else? Open **⚙ Settings**, paste the full path of your SillyTavern folder, and click **Save settings**. It's remembered from then on.

## Using the launcher

| Button | What it does |
|---|---|
| ▶ **Open SillyTavern** | Starts the server if needed, then opens (or focuses) the SillyTavern window |
| ⏹ **Stop server** | Stops the server and everything it started. If the server was started outside this app, the app just disconnects from it |
| ⟳ **Update SillyTavern** | Runs `git pull` in your install. Stop the server first |
| 💾 **Back up data** | Zips your `data/` folder into `backups/desktop/` inside your install |
| 🗄 **Open backups folder** | Opens `backups/desktop/` in Explorer |
| 📂 **Open data folder** | Opens `data/` — chats, characters, settings |
| 🏷 **Show current version** | Prints the latest local SillyTavern commit to the console |
| ⚙ **Settings** | Shows the settings panel (click again to return to the console) |

The **server console** on the right shows everything the server prints — errors in red, success messages in green.

The SillyTavern window only ever shows your local server. Links to other sites open in your normal browser.

**Closing:** closing all windows stops the server and quits. Quitting another way while the server runs asks for confirmation (can be turned off).

**Already running SillyTavern elsewhere?** If something is already serving on the configured port, the app uses that server instead of starting a second one.

## Settings

| Setting | Default | Notes |
|---|---|---|
| SillyTavern folder | Auto-detected | The folder that contains `server.js` |
| Port | `8000` | Passed to the server with `--port`, overriding `config.yaml` |
| Start server automatically | On | Start the server and open SillyTavern as soon as the app launches |
| Confirm before quitting | On | Ask before quitting while the server runs |

Path and port changes take effect the next time the server starts — stop it first if it's running.

## Where things are stored

| What | Location |
|---|---|
| App settings | `%APPDATA%\SillyTavern Desktop\settings.json` |
| App log (everything shown in the console) | `%APPDATA%\SillyTavern Desktop\desktop-debug.log` |
| Window size | Saved in `settings.json` when the SillyTavern window closes |
| Backups | `<SillyTavern folder>\backups\desktop\st-backup-<date>.zip` |
| Your chats, characters, etc. | Untouched, in `<SillyTavern folder>\data\` |

To reset the app, quit it and delete `%APPDATA%\SillyTavern Desktop\`.

## Troubleshooting

| Console says | Fix |
|---|---|
| `server.js not found at …` | Set the right folder in **Settings** — the one containing `server.js` |
| `failed to launch node` | Install Node.js 20+ and make sure `node -v` works in a new terminal |
| `git not found` | Install git (only needed for Update / version) |
| `Stop the server before updating.` | Click **Stop server**, then **Update** |
| `Timed out waiting for the server to respond.` | Read the lines above it. Often a missing `npm install` in SillyTavern after an update — run `npm install` in the SillyTavern folder |
| The window never opens and the port is in use by another program | Change the **Port** in Settings |

Still stuck? Check `desktop-debug.log` and open an [issue](../../issues).

## Development

Clone the repo **next to** your SillyTavern folder — in dev mode the app expects `../SillyTavern`:

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
| `npm run dist:installer` | Build an installer → `dist/SillyTavern-Desktop-Setup.exe` (untested) |

### Project layout

| File | Role |
|---|---|
| `main.js` | Electron main process: server start/stop/attach, git, backups, windows, IPC |
| `preload.js` | The only bridge between the launcher UI and `main.js` (`window.desktop.*`) |
| `launcher.html` | Launcher UI — one self-contained file, no external dependencies |
| `icon.ico` / `icon.png` | App icon (`.ico` is used by Windows and the build; `.png` is the source image) |
| `package.json` | App metadata and electron-builder config |

### Gotchas (read before changing things)

- **Portable exes unpack to a temp folder before running**, so `process.execPath` points to the wrong place. Use `PORTABLE_EXECUTABLE_DIR` and check that `server.js` exists — see `resolveStRoot()`.
- **Packaged apps run from a read-only archive (asar).** Never write files next to `__dirname`; use `app.getPath('userData')`.
- **Single-instance lock:** all startup wiring must stay inside `if (gotLock)`, or a second launch starts a server inside an app that is already quitting.
- **Stopping the server on Windows** needs `taskkill /PID <pid> /T /F` to also kill the processes SillyTavern starts.

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

The server runs as a hidden child process on `127.0.0.1`. The app talks to it only over HTTP, so SillyTavern can change internally without breaking the wrapper.

## Roadmap

- [ ] Test and publish the installer build (`npm run dist:installer`)
- [ ] "Update on launch" option (git pull before starting the server)
- [ ] System tray mode (close to tray, server keeps running)
- [ ] Linux/macOS support
- [ ] Show/restore the SillyTavern window from the launcher when it's hidden

## Contributing

PRs welcome. One rule: **wrap, never fork** — no SillyTavern files in this repo and no patching of the SillyTavern install at runtime. Keep changes small and focused, and keep `launcher.html` dependency-free.

## Credits

- [SillyTavern](https://github.com/SillyTavern/SillyTavern) — the actual software this wraps. Go star it.
- SillyTavern's own `src/electron` scaffold showed this approach works.

## License

[AGPL-3.0](LICENSE), same as SillyTavern.
