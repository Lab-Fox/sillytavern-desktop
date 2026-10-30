# 🍺 SillyTavern Desktop

**SillyTavern as real software.** A standalone desktop app with a built-in browser — no cmd window, no external browser, no launcher `.bat` scripts. Double-click an exe, get SillyTavern.

Built as a **wrapper, not a fork**: it wraps your existing SillyTavern git checkout and never modifies a single tracked upstream file, so `git pull` updates keep working forever.

## Features

| Feature | What it does |
|---|---|
| 🖥 Standalone app | One portable exe (or `npm start` in dev). Server runs as a hidden child process. |
| 🌐 Built-in browser | Chromium `BrowserWindow` specialized for SillyTavern: menu bar stripped, navigation locked to your local server, external links open in your real browser, window size remembered. |
| 🚀 Launcher hub | A menu that replaces the cmd startup: Start/Stop server, **Update** (git pull, output streamed in-app), **Backup** (zips `data/`), Open data folder, version check, settings. |
| 📋 Live console | Full server log with color-coded output — you never need to see a terminal again. |
| 🔁 Update-proof by design | Wrapper lives outside the SillyTavern repo, talks to the server over plain HTTP. Upstream can refactor everything and this keeps working. |
| 🛟 Sensible failure handling | Detects an already-running server and attaches instead of double-starting; verifies the SillyTavern install exists before spawning; survives portable-exe temp self-extraction path quirks. |

## How it works

```
┌────────────────────────────────────────────────┐
│  SillyTavern Desktop.exe (Electron, portable)  │
│                                                │
│  ┌──────────────┐    ┌──────────────────────┐  │
│  │ Launcher hub │    │  ST browser window   │  │
│  │ start/update │    │  (Chromium, locked   │  │
│  │ backup/logs  │    │   to localhost)      │  │
│  └──────┬───────┘    └──────────┬───────────┘  │
│         │ spawn (hidden)        │ HTTP         │
│         ▼                       ▼              │
│  ┌──────────────────────────────────────────┐  │
│  │  node server.js   (your SillyTavern      │  │
│  │  checkout, untouched, on 127.0.0.1:8000) │  │
│  └──────────────────────────────────────────┘  │
└────────────────────────────────────────────────┘
```

**Design rule: wrap, never fork.** The wrapper spawns the SillyTavern server as a child process and talks to it over HTTP — no patched upstream files, no merge conflicts on update. Settings and logs live in `%APPDATA%/SillyTavern Desktop`, not next to the exe.

## Requirements

- Windows 10/11 (Linux/macOS should work with minor path tweaks — PRs welcome)
- An existing SillyTavern install via git clone (this app updates it with `git pull`)
- Node.js ≥ 20 on PATH (used to run the server child process)
- git on PATH (only needed for the Update button and version display)

## Usage

1. Grab `SillyTavern-Desktop.exe` from [Releases](../../releases)
2. Put it **next to your SillyTavern folder** (e.g. `SillyTavern-Launcher/ST-Desktop/dist/`)
3. Double-click. The launcher opens, the server boots, the SillyTavern window appears.

Moved the exe somewhere else? Set your SillyTavern path once in **Settings** — it persists in `%APPDATA%/SillyTavern Desktop/settings.json`.

## Development

```bash
git clone https://github.com/Lab-Fox/sillytavern-desktop.git
cd sillytavern-desktop
npm install
npm start        # dev run (expects ../SillyTavern to exist)
npm run dist     # build portable exe into dist/
```

### Project layout

| File | Role |
|---|---|
| `main.js` | Electron main process: server manager (spawn/kill/attach), git ops, backup, windows, IPC |
| `launcher.html` | The launcher hub UI — dark theme, zero external dependencies |
| `preload.js` | contextIsolation-safe IPC bridge |
| `icon.ico` | App icon (generated, see git history for the trick) |
| `package.json` | App + electron-builder config (portable & NSIS targets) |

### Gotchas learned the hard way (read before hacking)

- **Portable exes self-extract to a temp dir** — `process.execPath` lies at runtime. Use `PORTABLE_EXECUTABLE_DIR` + verify `server.js` exists (see `resolveStRoot()`).
- **Packaged apps run from a read-only asar** — never write settings/logs next to `__dirname`.
- **Single-instance lock races** — guard *all* lifecycle wiring behind `gotLock`, or a second instance spawns a server into a dying app.
- **Killing the server on Windows needs the whole tree** — `taskkill /PID <pid> /T /F`, because SillyTavern spawns its own children.

## Roadmap ideas

- [ ] NSIS installer target (config already in `package.json`: `npm run dist:installer`)
- [ ] "Update on launch" option (git pull before server start)
- [ ] System tray mode (close to tray, server keeps running)
- [ ] Linux/macOS path handling + `Start` scripts
- [ ] Restore/minimize ST window from launcher when hidden

## Contributing

PRs welcome — keep the wrapper philosophy: **no upstream SillyTavern files in this repo, no runtime patching of the SillyTavern install.** Small, focused diffs preferred. For UI work, keep `launcher.html` dependency-free.

## Credits

- [SillyTavern](https://github.com/SillyTavern/SillyTavern) — the actual software this wraps. Go star it.
- Upstream's own `src/electron` scaffold was the proof this approach works.

## License

[AGPL-3.0](LICENSE) — matching the SillyTavern ecosystem.
