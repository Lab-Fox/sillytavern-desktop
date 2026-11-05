# User guide

[README](../README.md) · **User guide** · [Troubleshooting](TROUBLESHOOTING.md) · [Developers](DEVELOPERS.md)

Everything SillyTavern Desktop can do, and how to use it.

- [Get started](#get-started)
  - [1. Download](#1-download)
  - [2. Run it](#2-run-it)
  - [What it needs](#what-it-needs)
- [Everything it does](#everything-it-does)
- [Using the app](#using-the-app)
  - [The launcher](#the-launcher)
  - [Profiles](#profiles)
  - [Migrate data](#migrate-data)
  - [What changed](#what-changed)
  - [The SillyTavern window](#the-sillytavern-window)
  - [Several SillyTavern at once](#several-sillytavern-at-once)
  - [On your phone or tablet](#on-your-phone-or-tablet)
  - [Away from home](#away-from-home)
  - [SillyTavern server options](#sillytavern-server-options)
  - [Start with SillyTavern](#start-with-sillytavern)
  - [AI apps](#ai-apps)
  - [What can my PC run? and troubleshooting](#what-can-my-pc-run-and-troubleshooting)
  - [Add-ons](#add-ons)
  - [SillyTavern extensions: safety, updates, Kits](#sillytavern-extensions-safety-updates-kits)
  - [Language](#language)
  - [Themes](#themes)
  - [Settings](#settings)

---

## Get started

### 1. Download

From the **[latest release](https://github.com/Lab-Fox/sillytavern-desktop/releases/latest)**, pick one:

| | |
|---|---|
| **`SillyTavern-Desktop-Setup.exe`** (recommended) | Installs in a few seconds, no admin rights needed. Adds Start menu and desktop shortcuts, and opens in under a second. |
| **`SillyTavern-Desktop.exe`** (portable) | Nothing to install: run it from anywhere, even a USB stick. It unpacks itself on every launch, so it takes a few seconds to open. |

Both use the same settings, so you can switch any time.

> Windows may show a SmartScreen warning because the app isn't code-signed. Click **More info → Run anyway**.

### 2. Run it

- **Already have SillyTavern?** The app looks for it on your PC and uses it. If it finds more than one, it asks which.
- **New to SillyTavern?** The welcome screen takes two clicks: **Install for me** (Node.js and Git) or **Get them for this app only** (a private copy, no installing), then **Install SillyTavern** (choose a version and a folder; the latest release is preselected).
- **Not found?** Click **Find it myself…** and pick your SillyTavern folder.

SillyTavern then opens in its own window. The very first start can take a minute.

### What it needs

Only **Windows 10 or 11**. SillyTavern needs [Node.js](https://nodejs.org/) 20 or newer and [Git](https://git-scm.com/). The app gets them for you in one of two ways:

- **Install for me** installs both in Windows with winget, Windows' built-in installer (Windows may ask for permission once).
- **Get them for this app only** downloads the official Node.js (LTS, from nodejs.org) and Git (MinGit, from Git for Windows) into the app's own folder, checks them against their published SHA256 checksums, and uses them for everything it runs. Nothing is installed in Windows and no admin permission is needed; about 70 MB to download, 210 MB on disk. Also under **Tools → Node.js and Git**, where you can switch between them and your PC's own, check for newer versions, or remove them.

## Everything it does

**Easy start**
- Finds an existing SillyTavern install on your PC by itself, or installs Node.js, Git and SillyTavern for you, or keeps **its own private copy of Node.js and Git** (nothing installed in Windows, no admin prompt).
- **Profiles:** give each SillyTavern folder a name and switch between them from the top bar, the tray or the SillyTavern window.
- **Download any SillyTavern version** into a folder you choose: the latest release (recommended), staging, or an older version (with a clear warning about the security fixes it misses).
- **Migrate data** between SillyTavern folders or users: characters, chats, presets, extensions and more, simple or item by item, never touching the source, always undoable.
- **What's new:** release notes and the list of changes before you update, after every update or download, and a history for each install, even for changes made outside the app.
- **Import by drag & drop:** drop character cards (`.png`, `.json`, `.charx`, `.byaf`, `.yaml`), lorebooks and presets onto the launcher, or right-click a file → **Open with → SillyTavern Desktop**.
- Opens SillyTavern in its own window. The server runs hidden in the background.

**A better SillyTavern window**
- Tabs for pages that SillyTavern or its extensions open: drag them into any order, or out into a window of their own. Plus full screen (**F11**), **always on top**, or **stay in background**.
- **Writing helper** (an add-on from **Get add-ons**): a dictionary with adult and roleplay words, your own words and your characters' names; word suggestions above the text box; autocorrect that Backspace undoes. Stays on your PC.
- **Chrome extensions** from the Chrome Web Store, such as LanguageTool for spelling and grammar, with their buttons in the top bar.
- A **right-click menu** like a browser's: cut, copy, paste, paste as plain text, spelling suggestions, open links and images in a new tab, save or copy images, search the web for selected text.
- Several SillyTavern at once, including a **read-only copy** to browse chats and presets without changing anything, and other installs on your PC side by side.
- **SillyTavern on another computer** (another PC, a home server, a VPS) as a tab, with its login saved encrypted and a warning for unencrypted addresses.

**Keeps your SillyTavern healthy**
- Safe one-click updates for SillyTavern and all its extensions, and switching between the **release** and **staging** versions.
- **Extension safety:** each extension's security rating, a review before updating, **Undo** for extension updates, **Kits** (saved sets of extensions), and finding new extensions, all in the launcher.
- Backups that handle any filename (emoji included), **scheduled backups** (on start, daily or weekly, only when something changed, to a folder of your choice such as a second drive or OneDrive). Restoring never deletes anything.
- A health check and repair tools for the most common problems, plus **troubleshooting**: which program holds SillyTavern's port (and a free one to use instead), repairing an update that stopped halfway (your changes kept on a backup branch), clearing npm's cache, SillyTavern's welcome tour again, and a privacy-safe **system report** for bug reports.
- **What can my PC run?** Finds your graphics card and its memory and tells you which local model sizes fit (or that an online service is the better choice).

**Everything the classic Launcher.bat does, without a command window**
- **Remote link:** a temporary `https://….trycloudflare.com` address (Cloudflare's free tunnel) to reach your SillyTavern from anywhere, with a QR code; only with a password, and it stops with the server.
- **Tailscale:** shows your Tailscale addresses on Home and lets them in, or installs Tailscale for you.
- **HTTPS** with the app's own certificate, and **SillyTavern server options** (lazy-loading characters, user accounts, server plugins, a proxy for AI services…) set without editing `config.yaml`.
- **Start with SillyTavern:** start programs or scripts (KoboldCpp, a voice app…) with the server, and stop them with it.
- **Remove a SillyTavern** you no longer need (to the Recycle Bin, with a backup of its data first if you want).
- **AI apps:** install, start and update **KoboldCpp**, **llama.cpp**, Oobabooga's **Text generation web UI** and **TabbyAPI** in one click (the right build for your graphics card), download models picked for your PC from Hugging Face, and see exactly what to paste into SillyTavern.

**Comfort**
- **In your language:** English, Bahasa Indonesia, 日本語, 한국어, 简体中文 and 繁體中文. Click the globe in the top right to switch at once; SillyTavern's own language can follow along. [Add your language](../locales/README.md): it's one file.
- Use SillyTavern from your **phone or tablet** on the same Wi-Fi: scan a QR code, with an optional password.
- Keeps running in the tray if you want, and can update SillyTavern by itself when it starts.
- Updates itself when a new version is out, always after you click.
- Themes for the launcher (make and share your own), a clear pixel font (**Departure Mono**) or any font you like for the app, a size from 80 to 150 %, and your own font for the console.
- Built-in userscripts, and extensions for the app itself.

## Using the app

### The launcher

| Page | What it's for |
|---|---|
| **Home** | Open, show or minimize SillyTavern. See your version and **Update now** when there's an update. Quick links to your characters, chats and data. |
| **Profiles** | Your SillyTavern folders by name: switch, add, rename, re-point, remove, run one next to another, or **Download SillyTavern**. |
| **Migrate data** | Copy characters, chats, presets, extensions and more from one SillyTavern (or user) to another, and undo earlier migrations. |
| **Backups** | Back up your data, scheduled or now; restore or delete a backup. |
| **Extensions** | SillyTavern's extensions with their safety ratings; review and **Update all**, undo updates, find new extensions, Kits. Also extensions for this app (**Desktop add-ons**). |
| **Tools** | Node.js and Git (your PC's or the app's own), the health check, repair tools, "What can my PC run?", troubleshooting, ways to run SillyTavern without the app, and the release/staging switch. |
| **Settings** | Themes, which SillyTavern to use, the port, the SillyTavern window, the console font, and how the app behaves. |

**The console** sits under every page: everything the server prints, or the output of an AI app (pick it next to "Console"). Search it, show only problems, copy it for a bug report, drag its top edge to resize it, or make it bigger. **Ctrl+`** hides and shows it; when it's hidden, its last line stays visible and a red count shows new problems.

**Updates are safe:** **Update now** stops the server, can back up your data first, runs `git pull` and `npm install`, and starts SillyTavern again. If something blocks the update, the console says why and which repair tool fixes it.

**Backups** are saved in `backups\desktop\` inside your SillyTavern folder. Automatic ones (before updates) are trimmed to the number you choose; manual ones are kept. Restoring first moves your current `data` folder aside, so nothing is lost.

**Automatic backups** (Backups page): **On app start**, **Daily** or **Weekly**, for **this profile** or **all profiles**. A backup is only made when something in `data` changed since the last scheduled one. They can go to another folder, for example a second drive or a OneDrive/Dropbox folder (a folder per profile is made inside it), and the newest 7 per profile are kept (your choice; backups before updates and your own are counted apart). Before each one the app checks the free space. If one fails (say, the backup drive isn't connected), Home shows it with **Try again**. Backups in that other folder are listed and restored like the others.

**Import cards, lorebooks and presets:** drop the files anywhere on the launcher, or right-click them in Explorer → **Open with → SillyTavern Desktop** (added by the installer; it never becomes the default app for `.png` or `.json`). A list shows what each file is: a character card (`.png` with card data, `.json`, `.charx`, `.byaf`, `.yaml`), a lorebook, or a preset (Chat Completion, Text Completion, instruct, context, system prompt, reasoning). Pick the profile and click **Import**: SillyTavern imports them itself, the same way as its own Import buttons, and names that are already taken get a number instead of being overwritten. The server starts if needed; for a profile that isn't in use, a server runs just for the import. Dropping a card onto the SillyTavern window works too: that's SillyTavern's own import.

### Profiles

A profile is a name for a SillyTavern folder ("Main", "Testing staging", "SillyTavern 1.18.0"…). Each folder has its own chats, characters and settings. The app runs one profile at a time; pick it from the **profile list at the top of the launcher**, the **Profiles** page, the tray icon's menu or the SillyTavern window's menu (**Switch profile**).

- **Switching** while the server runs stops it, starts it on the new folder and reloads open SillyTavern tabs (the app asks first when a SillyTavern window is open).
- **Add profile** picks a folder (the SillyTavern folder or one that contains it). **Find on this PC** adds a profile for every SillyTavern the app finds. Editing a profile changes its name or folder.
- **Open next to it** runs another profile at the same time on its own port, as a tab.
- **SillyTavern on another computer** (card below the profiles): **Add** a name and its address (like `http://192.168.1.25:8000`), and its user name and password if it asks for one (SillyTavern's basic auth). **Test** says whether it answers, is SillyTavern, or wants a login. **Open** shows it as a tab in the SillyTavern window (also in the window's **▾** menu and the tray menu). Each one has its own browser session, so a login on SillyTavern's own login page stays too. The password is saved encrypted with Windows' own protection. A plain `http://` address outside your home network (not a home, `.local` or Tailscale address) is marked **not encrypted**, and the app warns before opening it. These aren't folders, so the SillyTavern on this PC keeps running as it is; updates, backups and migrating happen on that computer.
- **Removing** a profile never deletes its folder. The profile in use can't be removed.
- Your existing setup becomes your first profile automatically, and every folder the app uses gets one.

**Download SillyTavern** (Profiles page, or **Install SillyTavern** on the welcome screen) gets another SillyTavern into a new folder and makes a profile for it:

| Version | What you get |
|---|---|
| **Latest release** (recommended, on top) | The stable version. Gets updates like any install. |
| **Staging** | The newest changes, updated almost daily. Can break. |
| **A specific version** (1.12.0 and newer, newest first, with release dates and notes) | Exactly that version, kept as it is: Home shows **Fixed version** and Update does nothing. Switch it to release or staging under **Settings → Start & updates → SillyTavern channel** to get updates again. |

You choose the parent folder, the folder name and the profile name; the dialog shows where it goes and the free space there (about 600 MB is needed). Tick **Use it right away** to switch to it when it's done. Downloads take well under a minute on a fast connection (they skip old file versions), and **Cancel** removes the unfinished folder. Versions older than 1.13.2 ignore some of this app's settings: phone access doesn't work and a browser tab may open when the server starts.

**Older versions come with a warning.** In the version list, every version that newer releases fixed security problems after is marked **⚠ missing security fixes**. Picking an older version shows how many releases came since, lists the security fixes it doesn't have (taken from SillyTavern's release notes, e.g. "Fixed path traversal vulnerability in several server endpoints"), and gives advice: use it only when you need it, keep phone access off, only install extensions you trust, and don't open data from a newer SillyTavern with it. **Download** only unlocks after ticking **I understand**. Profiles that are behind show the same warning tag, and phone access warns (on Home and in the console) when it would expose an older SillyTavern to your network.

### Migrate data

Copy your things from one SillyTavern into another: from an old install into a fresh download, between a test copy and your main one, or between SillyTavern users. Open **Migrate data** in the sidebar (or the ⇄ button of a profile, or **Copy my data into it…** after a download).

1. **From and to.** Pick the source (any profile, or another SillyTavern folder) and the target (the profile in use by default). When SillyTavern has several users, pick the user on each side. **⇄** swaps them. The app warns when the source is a newer SillyTavern than the target.
2. **Look at what's there.** Both folders are compared file by file (about two seconds for 11,000 files). Nothing is changed yet.
3. **What to copy.**
   - **Simple:** tick categories: Characters (with their sprites), Chats, Groups and group chats, Lorebooks, Presets (all kinds), Persona avatars, Quick Replies, UI themes and layouts, Backgrounds, Extensions (per user and for all users), Images and files, Extension data. Off by default: Vector storage, SillyTavern's own backups, Settings, API keys, Usage stats. Each category shows how many items, their size, and how many are new, different or already there.
   - **Advanced:** every single item (each character, chat folder, preset, extension…) with its own checkbox. Search, filter by **New / Different / Already there**, and tick or untick whole categories. Anything not ticked is left out. Picking a character also picks its chats (can be turned off).
   - Quick picks: **Recommended**, **Everything**, **Only what's new**, **Nothing**. The app remembers which categories you picked last time.
   - **Warnings** where something wouldn't work: chats whose character won't be in the target, groups that need characters you aren't copying, and what Settings and API keys replace.
4. **Copy now.** The bar at the bottom always says what will happen ("Copies 1,234 files (2.3 GB), replacing 3…") and checks the free space. For files that exist in both places with different contents, choose **Keep the newer one** (default), **Keep the target's** or **Always take the source's**. Identical files are skipped. Progress is shown, and **Stop** stops cleanly; copying again continues where it stopped.

**Safe by design:** the source is only read. The target's server is stopped while copying (and started again afterwards). Every file that gets replaced is kept first, so **Undo** (right after copying, or later under **Earlier migrations into this folder**) removes what was added and puts back what was replaced, with its original date. A backup zip of the whole target is optional.

### What changed

The app keeps track of what changes in each SillyTavern folder:

- **Before updating:** when Home says an update is available, **What's in it?** shows the release notes of every new version and the list of changes (commits) waiting, with **Update now** right there.
- **After an update**, a **release/staging switch** or a **download**, Home shows a **What's new** card: open it for the release notes of every version in between (with a **security fixes** badge where they apply) and every change, or dismiss it.
- **Changes made outside the app** (a `git pull` by hand, SillyTavern's own updater, going back to an older version) are noticed on the next launch or profile switch and shown the same way.
- **History:** Home's **History** link, or the clock button on the Profiles page, lists every update, download and switch of that folder with its details.

The history lives in `st-history.json` in the app's data folder; release notes come from SillyTavern's GitHub releases (remembered for an hour).

### The SillyTavern window

| To | Do this |
|---|---|
| Go full screen | **F11**. Move the mouse to the top edge to show the bar. |
| Keep it above or behind other apps | Right-click the top bar → **Always on top** or **Stay in background** (back with **Normal window**) |
| Open a tab | **+** or **Ctrl+T** |
| Switch tabs | **Ctrl+Tab**, **Ctrl+PgUp** / **Ctrl+PgDn**, or **Ctrl+1**…**Ctrl+9** |
| Reorder tabs | Drag a tab along the bar, or **Ctrl+Shift+PgUp** / **Ctrl+Shift+PgDn** |
| Give a tab its own window | Drag it down out of the bar, or right-click it → **Move to new window**. Drag it onto another SillyTavern window's tabs to move it there. The page moves as it is, nothing reloads |
| Close a tab | **×**, middle-click, or **Ctrl+W** (never closes the last tab) |
| Reload | **F5** or **Ctrl+R** |

**Right-click** on a SillyTavern page for a menu like a browser's: on text boxes cut, copy, paste, **paste as plain text** and select all, with spelling suggestions and **Add to dictionary** on an underlined word; on selected text copy and **search the web** (Google, DuckDuckGo or Bing, in Settings); on links **open in a new tab**, open in your browser or copy; on images **open in a new tab**, **save**, **copy** the image or its address. Desktop extensions can add their own entries. (Pages that draw their own right-click menu keep it.)

Links to other websites open in your normal browser. Pages that SillyTavern or an extension opens (Character Library, for example) become tabs; turn that off in Settings if you prefer separate windows.

### Several SillyTavern at once

Click **▾** next to **+**:

| Choice | What you get |
|---|---|
| **Another tab of this SillyTavern** | One more page of the same SillyTavern |
| **Read-only copy** | Everything visible, but **nothing is saved and nothing is sent**: browse or compare presets safely |
| **This SillyTavern on another port** | A second server on the same folder (the app warns you: both share the same data) |
| **Other installs** | Your other profiles (by name), then any other SillyTavern found on your PC, each with its own data |

Each tab shows which one it is (`:8000`, `read-only :8000`, `1.13.2 :8002`…). Extra servers stop when their last tab closes.

### On your phone or tablet

1. Turn on **Settings → Phone & remote → Use SillyTavern from your phone**. Setting a password is optional but recommended; this app signs in by itself.
2. **Home** shows the address (like `http://192.168.1.25:8000/`) and a QR code. Scan it, or type the address, on a phone or tablet on the same Wi-Fi.
3. The first time, Windows may ask whether Node.js may use the network. Choose **Allow**.

Only devices on your own home network can connect. Your `config.yaml` is never changed: the app passes these settings to SillyTavern only while the switch is on, and turning it off closes the door again.

### Away from home

**Settings → Phone & remote → Away from home** has two ways to reach SillyTavern from outside your home network:

- **Remote link:** click **Start remote link** and Home shows a temporary `https://….trycloudflare.com` address with a QR code, made by Cloudflare's free "quick tunnel" (the app downloads `cloudflared` from Cloudflare's GitHub release and checks it against the published SHA256). It works over mobile data or from another house. It only starts with the phone-access password set, since anyone who gets the address reaches the login; the address changes every time, and the link stops with the server or with **Stop**.
- **Tailscale:** a private network between your own devices. With Tailscale on this PC and your phone (same account) and phone access on, Home also lists the Tailscale addresses and the app lets them through SillyTavern's whitelist. **Install Tailscale** installs it with winget.

### SillyTavern server options

**Settings → Server → Advanced: config.yaml options** sets a few things SillyTavern normally reads from `config.yaml`: loading characters lazily (faster with many characters), user accounts, the discreet login page, server plugins, SillyTavern's own extension auto-update, thumbnails, and a proxy for AI services. Each stays **As in config.yaml** (the current value is shown) until you pick **On** or **Off**; the app passes the choice to the server as an environment variable when it starts and never edits `config.yaml`. The **config.yaml** button opens the file for anything else.

**HTTPS** serves SillyTavern with a certificate the app makes for this PC's addresses (in the app's data folder, renewed before it runs out). This app's window trusts it; phones and other browsers warn once that they don't know it, which is normal for a self-made certificate.

### Start with SillyTavern

**Settings → Start & updates → Start with SillyTavern → Add program…** picks an `.exe`, `.bat`, `.cmd`, `.ps1` or shortcut to start whenever the server starts, with optional arguments. Ticked **Stop it with SillyTavern**, it is closed (with everything it started) when the server stops or the app quits.

### AI apps

The **AI apps** page runs a model on this PC instead of an online service. Its tabs are **Text**, **Pictures**, **Voices** and **Helper tools**.

**Text:**

| App | What it is | In SillyTavern |
|---|---|---|
| **KoboldCpp** | One program for GGUF models, with its own chat page. The easiest start. | Text Completion → KoboldCpp, `http://127.0.0.1:5001/` |
| **llama.cpp** | The engine behind most local AI apps, as a small server with a chat page. | Text Completion → llama.cpp, `http://127.0.0.1:8080/` |
| **Text generation web UI** | Oobabooga's UI with many settings; the app installs its portable build. | Text Completion → Text Generation WebUI (ooba), `http://127.0.0.1:5000/` |
| **TabbyAPI** | A fast server for EXL3/EXL2 models, NVIDIA only (about 4 GB to install). | Text Completion → TabbyAPI, `http://127.0.0.1:5005/` + the API key it shows |

**Install** downloads the build for your graphics card (CUDA for NVIDIA, Vulkan for AMD and Intel, else the processor) from the project's GitHub release and checks it against the SHA256 GitHub publishes. TabbyAPI gets its own Python through [uv](https://github.com/astral-sh/uv) (no Miniconda). Then **Start**, **Open its page** (as a tab in the SillyTavern window), **Stop**, **Update** (keeps the web UI's `user_data`), the folder, and **Remove** (to the Recycle Bin; models stay). **Settings** per app: the model, context size, GPU layers, ports and extra command-line options. **Start with SillyTavern** starts an app with the server; every app stops when this app quits. Each app's output is in its **Log**, and the card shows what to choose and paste in SillyTavern's API Connections.

**Pictures and voices:**

| App | What it is | In SillyTavern |
|---|---|---|
| **ComfyUI** | The most flexible picture app (workflows of connected boxes), with ComfyUI-Manager. | Image Generation → ComfyUI, `http://127.0.0.1:8188` |
| **Forge Neo** | The maintained successor of Forge and AUTOMATIC1111, with newer models (Flux, Qwen-Image, Wan). NVIDIA only. | Image Generation → Stable Diffusion Web UI (AUTOMATIC1111), `http://127.0.0.1:7863` |
| **Forge** | AUTOMATIC1111 made faster and lighter on memory (no longer updated). | Image Generation → Stable Diffusion Web UI (AUTOMATIC1111), `http://127.0.0.1:7862` |
| **Stable Diffusion web UI (AUTOMATIC1111)** | The original web UI (no longer updated). | Image Generation → Stable Diffusion Web UI (AUTOMATIC1111), `http://127.0.0.1:7861` |
| **Fooocus** | Pictures from a prompt with almost no settings. NVIDIA only. | — (its own page) |
| **InvokeAI** | A polished studio with canvas, layers and a model manager. | — (its own page) |
| **SwarmUI** | A friendly page with ComfyUI underneath; installs its back end on first start. | — (its own page) |
| **AllTalk TTS v2** | Voices for replies: Piper, XTTS, VITS, F5-TTS, voice cloning, RVC voices. | TTS → AllTalk, `http://127.0.0.1:7851` |
| **XTTSv2 API server** | Coqui's XTTS v2 voice model (voice cloning, 17 languages). Asks you to accept the model's non-commercial license before its first start. | TTS → XTTSv2, `http://127.0.0.1:8020` |

The Python apps are set up the way their own instructions do it, with [uv](https://github.com/astral-sh/uv) instead of Miniconda: a git clone (or, for InvokeAI, its package from PyPI), its own Python environment in the app's folder, and PyTorch for your graphics card. AUTOMATIC1111 and Forge install their packages with their own `launch.py`; AUTOMATIC1111 gets the copy of Stability AI's removed repository that its own developers point to. SwarmUI is built with the .NET 8 SDK, which goes into the apps folder (checked against Microsoft's SHA512; no installer, no admin rights). An install that stops half way (closed app, lost connection) shows **Finish installing** and continues where it stopped.

**Picture models:** one folder (`image-models` in the apps folder, with `checkpoints`, `loras`, `vae`, `embeddings` and `upscale_models`) that ComfyUI, Forge Neo, Forge, AUTOMATIC1111 and Fooocus all read; InvokeAI can scan it from its Model Manager. **Suggested for this PC** lists SD 1.5 and SDXL checkpoints (general, photo and anime) marked for your graphics memory; **From a link** takes a Hugging Face file link or a Civitai model page, finds the file and its kind, and downloads it checked against the SHA256 that Hugging Face or Civitai publishes. A **Civitai API key** (for models that need a sign-in) is stored encrypted with Windows' data protection and never shown again.

**Helper tools** shows whether FFmpeg, 7-Zip, the NVIDIA CUDA Toolkit and Visual Studio's C++ Build Tools are installed and installs them with winget. None of them is needed for the apps on the page; some add-ons and custom nodes use them.

Apps go to an `ai-apps` folder next to your SillyTavern folder (**Change…** picks another one, for example a big second drive). Apps that SillyTavern-Launcher's `Launcher.bat` installed (in `text-completion\`, `image-generation\` and `voice-generation\`) are found and started where they are, with Launcher.bat's Miniconda environments; update those Python apps in Launcher.bat.

**Models:** one folder of GGUF models for KoboldCpp, llama.cpp and the web UI. **Suggested for this PC** lists well-known models (small to 24B, several made for roleplay) marked *fits*, *slow* or *too large* for your graphics memory; **Download** picks the best size of it for your card, **Choose file…** lists every file with its size. **Find on Hugging Face** searches all GGUF models. Downloads are checked against Hugging Face's SHA256, can be stopped, and continue where they stopped. TabbyAPI's card downloads EXL3/EXL2 models by name and lets you pick the size (bits per weight).

### What can my PC run? and troubleshooting

**Tools → What can my PC run?** lists your graphics cards and their own memory, and for model sizes from 3B to 70B (GGUF, about 8K of context) whether they fit on the card, run slowly partly on the processor, or are too large. Below 4 GB it suggests an online service instead.

**Tools → Troubleshooting:**
- **Port:** which program uses SillyTavern's port, and **Use port … instead** with a free one. The health check also warns about a taken port, a VPN that may block connections, and an update that stopped halfway.
- **Repair SillyTavern's files:** for "local changes" or a merge that stopped halfway. Changed files and own commits are kept on a `desktop-backup-…` branch, then the files are reset to the official version of the branch. The data folder is never touched.
- **Clear npm's cache**, **SillyTavern's welcome tour** (show it again, per user, with the server stopped and a copy of the old settings kept), **Copy system report** (versions, settings and this PC's details; no passwords, your user folder as `%USERPROFILE%`), and links to report a problem.

To remove a SillyTavern you no longer need, open its profile's edit form (Profiles → pencil) and click **Remove this SillyTavern from the PC…**: the folder goes to the Recycle Bin, optionally after a backup zip of its data to a folder you choose. The SillyTavern in use can't be removed.

### Add-ons

| Kind | Where it goes |
|---|---|
| **SillyTavern extensions** | **Extensions → Find extensions** in the launcher, or SillyTavern's own Extensions menu, as usual. The launcher rates, updates and undoes them (see below). |
| **Server plugins** | SillyTavern's `plugins` folder, as usual (needs `enableServerPlugins: true` in `config.yaml`) |
| **Userscripts** (`.user.js`) | **Extensions → Userscripts → Open folder**, then restart the app. Replaces Tampermonkey. |
| **Chrome extensions** | From the Chrome Web Store, such as spelling and grammar checkers: **Extensions → Chrome → Open Chrome Web Store** (or the window's **▾** menu), then **Add to Chrome**. They work in your SillyTavern pages, their buttons sit in the top bar ([details](#chrome-extensions)). |
| **Desktop extensions** | Extensions for this app: right-click and menu entries, features in SillyTavern pages, their own settings panel. Install them from **Extensions → Desktop add-ons → Get add-ons** (each download is checked against its published SHA256; updates keep their settings), or add your own. They stay off until you turn them on. |

#### Writing helper

An add-on made with this app's extension system: install it from **Extensions → Desktop add-ons → Get add-ons**, then turn it on. It downloads its English word lists once (about 1 MB, checked against their SHA256) and builds its dictionary in about two seconds.

- **Suggestions** above SillyTavern's text box while you type: endings of the word, the word that usually comes next, or corrections (✎). **Tab** / **Alt+1** takes the first, **Alt+2** / **Alt+3** the others, **Esc** hides them.
- **Autocorrect** when you finish a word, only when it's clear: "teh" → "the", "dont" → "don't", "i" → "I", "alot" → "a lot". **Backspace right after** undoes it. Macros, links, code and names are left alone.
- **Dictionary:** about 165,000 English words plus an adult pack (can be turned off) and a roleplay pack; your characters', personas' and groups' names and lorebook keywords count as words. Right-click a word → **Add to dictionary** (adds "word" and "Word"), **Add only "Name"**, **Ignore**. Search, import and export your words in its panel.
- **Learns** from what you send, and if you ask, from your own messages in saved chats. Only on this PC.
- Prefer Windows' own suggestions? Switch it to **Windows** in its panel.

Details: [addons/writing-helper](../addons/writing-helper/README.md).

#### Chrome extensions

Open the Chrome Web Store from **Extensions → Chrome**, or from the SillyTavern window's **▾** menu. It opens as a tab; click **Add to SillyTavern Desktop** on an extension, and the app asks first, telling you what the extension can read and what it can't use here.

- They run in your SillyTavern pages, on this PC and on other computers, but not in the read-only copy. Each SillyTavern keeps its own extension settings.
- Their buttons and popups are in the top bar, their entries in the right-click menu. Pages they open (sign-in, options, welcome) open as tabs marked **web**.
- They update themselves from the Chrome Web Store (about every 5 hours, or **Check for updates**). Turn one off or remove it in **Extensions → Chrome**.
- **Not everything works:** this app gives Chrome extensions most of what they use (buttons and popups, right-click entries, tabs, storage, notifications, alarms), but not a side panel, Google sign-in, text to speech, history, bookmarks or request blocking. The list in the launcher says what each extension can't use here.

| Tested | Result |
|---|---|
| LanguageTool | **Works:** checks spelling and grammar in SillyTavern's text boxes; button, popup, options and right-click entry work |
| Grammarly | **Partly:** loads, but checks text only after you sign in to a Grammarly account (not tested with an account); no side panel |

The app adds one small script to each Chrome extension it installs, so the extension's settings storage also works inside web pages (Electron, which this app is built on, supports only part of it there).

Don't put `.user.js` files in SillyTavern's `plugins` folder: SillyTavern would try to run them as server code. The app warns you if it finds one.

<details>
<summary>Userscript support in detail</summary>

Supported: `@match`, `@include`, `@exclude`, `@run-at`, `@noframes`, `@connect` (enforced), and the common `GM_*` / `GM.*` APIs: `xmlhttpRequest` (cross-site, with the window's cookies), `openInTab` (background tabs stay hidden), `getValue` / `setValue` / `deleteValue` / `listValues`, `addStyle`, `info`. Menu commands are accepted but not shown. Only install userscripts you trust.

</details>

### SillyTavern extensions: safety, updates, Kits

**Safety ratings.** Every installed extension shows what the public [Tavernary](https://tavernary.org) catalog says about it: the result of its TavernKeeper security scan (**Low concern**, **Some concern**, **High concern**, **Not scanned yet**), a link to the full report, and whether *your* version is the one that was scanned (otherwise "older scan"). Extensions that aren't in the catalog say so; that alone means nothing good or bad. A rating is information about one version, not a guarantee. The catalog is downloaded at most once a day (about 13 MB the first time, then only when it changed).

**Update all…** first shows a review: each extension with an update, its rating, and whether the exact version the update brings was scanned ("update not scanned yet" is common and usually fine). Untick anything you'd rather not update; extensions rated high concern start unticked. Single extensions have their own **Update** button.

**Undo.** Before every update the app remembers the version of each extension. **Undo last update** puts them all back, and **Roll back** does it for one extension. An extension you changed yourself since is never touched. **Reload SillyTavern** (shown when a window is open) loads the changed code.

**Find extensions** searches the catalog by what you want ("memory", "image generation", "tracker"…) with ratings, stars, activity and the license, and installs with one click the same way SillyTavern does. The first time, the app explains that extensions run code inside SillyTavern.

**Kits** are saved lists of extensions (addresses and versions, not files): **Save my extensions as a Kit**, **Export** it as a file to share, **Import** someone's Kit, and **Install missing…** in any profile, with the newest versions or exactly the saved ones. You review the list (with ratings) before anything is installed; Kits only accept https addresses.

The ratings and catalog come from Tavernary's catalog database, available under the [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). This app is not affiliated with or endorsed by Tavernary.

Want to make a desktop extension? See **[EXTENSIONS.md](../EXTENSIONS.md)** and the [example](../examples/break-reminder).

### Language

The app follows Windows' language the first time it starts (English when Windows uses a language the app doesn't have yet). To change it, click the **globe** in the top right of the launcher (also on the welcome screen), the **Language** entry in the SillyTavern window's ☰ menu or the tray menu, or **Settings → Appearance → Language**. The launcher and the SillyTavern window's top bar switch at once; menus and dialogs use the new language from then on.

**Also switch SillyTavern's own language** (on by default) sets SillyTavern's language too, where SillyTavern has it (Chinese, Japanese and Korean do; Indonesian doesn't yet). It is set once for each SillyTavern after a change, so you can still pick another language inside SillyTavern afterwards. Open SillyTavern pages switch when they reload: the launcher offers **Reload SillyTavern now**.

The translations were made with the help of AI and are waiting for native speakers to polish them. The Console keeps its log lines in English (they're meant for bug reports), and add-ons such as the Writing helper have their own text. To translate the app into another language or fix a translation, see [locales/README.md](../locales/README.md).

### Themes

**If a theme makes the app hard to use:** press **Ctrl+Alt+Shift+T** in the launcher to go back to the default theme, or hold **Shift** while the app starts to use the default theme for that run only.

The launcher has a soft retro pixel look in **Departure Mono**, a pixel font where B and 8, I, l and 1, and O and 0 are easy to tell apart. **Settings → Appearance → App font** switches to DotGothic16, Pixelify Sans (the font before 1.6), VT323, Segoe UI or any font on your PC, and **Size** makes the launcher 80 to 150 % as large. The font also applies to the SillyTavern window's top bar; SillyTavern's own pages keep the font chosen in SillyTavern. Pick a theme, **SillyTavern** (default) or **Fox**, in **Settings → Appearance**, or click **New theme** to open Theme Studio: colors, a logo, the shape of buttons and cards, fonts, a wallpaper and pictures placed where you want them, with a live preview and no code. **Export** makes a `.sttheme` file anyone can install.

Install a theme with **Import theme…**, by dropping it on the launcher, or with **Open with**. The app shows what it is first, checks its CSS every time it loads, and after you apply one for the first time asks **Keep this theme?**: if you do nothing, it goes back after 15 seconds. A theme's CSS can't reach your files or the internet, and it never runs scripts, but it can change what you see, so install themes from people you trust.

A theme can offer its own choices under **Theme options**. **Settings → Appearance → Theme animations** is **On**, **Only while this window is in use**, or **Off**; moving parts always stop while the window is hidden or the screen is off, and when Windows has animation effects turned off.

Want to go further, with your own CSS, animation and options? See [Making themes](THEMES.md).

### Settings

Settings has six tabs: **Appearance**, **Start & updates**, **Window**, **Server**, **Phone & remote** and **About**, plus a search box that finds any setting. Every change applies at once (there is no Save button). Changes the running server needs a restart for (phone access, HTTPS, config.yaml options) show a **Restart server** bar, so the server restarts when you choose. The port can be changed while the server is stopped. **About → Reset settings** puts look, start-up, updates and window options back to their defaults; your folders, profiles, phone access, server options and programs stay.

| Setting | Default | What it does |
|---|---|---|
| Start automatically | On | Start the server and open SillyTavern when the app opens |
| Check for updates on launch | On | Shows on Home when SillyTavern has an update |
| Update SillyTavern on launch | Off | When an update is out, installs it before the server starts |
| Check for app updates on launch | On | Shows on Home when this app has a new version. **Download update**, then **Restart and update** |
| Get preview versions of this app | Off | Also offers test versions (pre-releases, marked **preview**) before they become a regular release. Off again: you get the next regular release |
| Back up before updating | On | Back up your data before every update or channel switch |
| Scheduled backups | Off | On the **Backups** page: when, which profiles, where to, how many to keep |
| SillyTavern channel | as installed | **Release** (stable) or **Staging** (daily, can break) |
| Use this app's own Node.js and Git | Off | Under **Tools → Node.js and Git** |
| Confirm before quitting | On | Ask before quitting while the server runs |
| Keep running in the tray | Off | Closing the launcher hides it to the tray and the server keeps running. Right-click the tray icon for more, including **Quit** |
| Automatic backups to keep | 10 | Older automatic backups are removed; manual ones never are |
| Port | `8000` | The port SillyTavern runs on |
| Phone & tablet | Off | Let devices on your Wi-Fi open SillyTavern, with an optional password ([how](#on-your-phone-or-tablet)) |
| Window layer, tabs | Normal, on | The SillyTavern window's defaults (also in its right-click menu) |
| Spellchecker | Windows' own | **Built-in English** marks mistakes on every PC (Windows' own only does for languages installed in Windows). Needs a restart |
| Right-click search, Inspect element | Google, off | Which site **Search for "…"** uses, and an **Inspect element** entry (developer tools) for making themes and extensions |
| App font, Size | Departure Mono, 100 % | The font of the launcher and the SillyTavern window's top bar, and the launcher's size |
| Console font | Pixel | Any font on your PC, and its size |

**Closing:** closing every window stops the server and quits (unless the tray is on). If SillyTavern is already running elsewhere on the same port, the app uses that server instead of starting another.
