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
| **Moving your data** | Copy folders between installs by hand and hope nothing gets overwritten | Pick what to copy (or every single item), see what's new or different first, undo with one click |
| **What changed** | Look up release notes on GitHub, read the git log | See what an update brings before installing it, a "What's new" card afterwards, and a history per install |
| **Backups** | Copy the `data` folder by hand | One click, automatic before updates, restore anytime |
| **Extensions** | Check each one for updates yourself, and hope an update is safe | Safety ratings for each one, a review before updating, one-click undo, and Kits to set up the same extensions elsewhere |
| **Problems** | Scroll through a terminal | A searchable console, a health check, one-click repair tools |
| **Userscripts** | Need a browser add-on like Tampermonkey | Built in |
| **On your phone** | Edit `config.yaml` (listen, whitelist) and find your PC's address | One switch, then scan a QR code |
| **Several installs** | Clone each version by hand, remember which folder is which, edit paths in scripts | Named profiles; download any version with a click and switch from the top bar |

## Features

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
- A **right-click menu** like a browser's: cut, copy, paste, paste as plain text, spelling suggestions, open links and images in a new tab, save or copy images, search the web for selected text.
- Several SillyTavern at once, including a **read-only copy** to browse chats and presets without changing anything, and other installs on your PC side by side.
- **SillyTavern on another computer** (another PC, a home server, a VPS) as a tab, with its login saved encrypted and a warning for unencrypted addresses.

**Keeps your SillyTavern healthy**
- Safe one-click updates for SillyTavern and all its extensions, and switching between the **release** and **staging** versions.
- **Extension safety:** each extension's security rating, a review before updating, **Undo** for extension updates, **Kits** (saved sets of extensions), and finding new extensions, all in the launcher.
- Backups that handle any filename (emoji included), **scheduled backups** (on start, daily or weekly, only when something changed, to a folder of your choice such as a second drive or OneDrive). Restoring never deletes anything.
- A health check and repair tools for the most common problems.

**Comfort**
- Use SillyTavern from your **phone or tablet** on the same Wi-Fi: scan a QR code, with an optional password.
- Keeps running in the tray if you want, and can update SillyTavern by itself when it starts.
- Updates itself when a new version is out, always after you click.
- Themes for the launcher (make and share your own), a clear pixel font (**Departure Mono**) or any font you like for the app, a size from 80 to 150 %, and your own font for the console.
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
- **New to SillyTavern?** The welcome screen takes two clicks: **Install for me** (Node.js and Git) or **Get them for this app only** (a private copy, no installing), then **Install SillyTavern** (choose a version and a folder; the latest release is preselected).
- **Not found?** Click **Find it myself…** and pick your SillyTavern folder.

SillyTavern then opens in its own window. The very first start can take a minute.

### What it needs

Only **Windows 10 or 11**. SillyTavern needs [Node.js](https://nodejs.org/) 20 or newer and [Git](https://git-scm.com/). The app gets them for you in one of two ways:

- **Install for me** installs both in Windows with winget, Windows' built-in installer (Windows may ask for permission once).
- **Get them for this app only** downloads the official Node.js (LTS, from nodejs.org) and Git (MinGit, from Git for Windows) into the app's own folder, checks them against their published SHA256 checksums, and uses them for everything it runs. Nothing is installed in Windows and no admin permission is needed; about 70 MB to download, 210 MB on disk. Also under **Maintenance → Back end**, where you can switch between them and your PC's own, check for newer versions, or remove them.

## Using the app

### The launcher

| Page | What it's for |
|---|---|
| **Home** | Open, show or minimize SillyTavern. See your version and **Update now** when there's an update. Quick links to your characters, chats and data. |
| **Profiles** | Your SillyTavern folders by name: switch, add, rename, re-point, remove, run one next to another, or **Download SillyTavern**. |
| **Migrate data** | Copy characters, chats, presets, extensions and more from one SillyTavern (or user) to another, and undo earlier migrations. |
| **Backups** | Back up your data, scheduled or now; restore or delete a backup. |
| **Extensions** | SillyTavern's extensions with their safety ratings; review and **Update all**, undo updates, find new extensions, Kits. Also extensions for this app (**Desktop app**). |
| **Maintenance** | Node.js and Git (your PC's or the app's own), the health check, repair tools, ways to run SillyTavern without the app, and the release/staging switch. |
| **Console** | Everything the server prints. Filter to problems, search, or copy it for a bug report. |
| **Settings** | Themes, which SillyTavern to use, the port, the SillyTavern window, the console font, and how the app behaves. |

**Updates are safe:** **Update now** stops the server, can back up your data first, runs `git pull` and `npm install`, and starts SillyTavern again. If something blocks the update, the console says why and which repair tool fixes it.

**Backups** are saved in `backups\desktop\` inside your SillyTavern folder. Automatic ones (before updates) are trimmed to the number you choose; manual ones are kept. Restoring first moves your current `data` folder aside, so nothing is lost.

**Scheduled backups** (Backups page): **On app start**, **Daily** or **Weekly**, for **this profile** or **all profiles**. A backup is only made when something in `data` changed since the last scheduled one. They can go to another folder, for example a second drive or a OneDrive/Dropbox folder (a folder per profile is made inside it), and the newest 7 per profile are kept (your choice; backups before updates and your own are counted apart). Before each one the app checks the free space. If one fails (say, the backup drive isn't connected), Home shows it with **Try again**. Backups in that other folder are listed and restored like the others.

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
| **A specific version** (1.12.0 and newer, newest first, with release dates and notes) | Exactly that version, kept as it is: Home shows **Fixed version** and Update does nothing. Switch it to release or staging under **Maintenance → Release channel** to get updates again. |

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

1. Turn on **Settings → Phone & tablet → Use SillyTavern from your phone**. Setting a password is optional but recommended; this app signs in by itself.
2. **Home** shows the address (like `http://192.168.1.25:8000/`) and a QR code. Scan it, or type the address, on a phone or tablet on the same Wi-Fi.
3. The first time, Windows may ask whether Node.js may use the network. Choose **Allow**.

Only devices on your own home network can connect. Your `config.yaml` is never changed: the app passes these settings to SillyTavern only while the switch is on, and turning it off closes the door again.

### Add-ons

| Kind | Where it goes |
|---|---|
| **SillyTavern extensions** | **Extensions → Find extensions** in the launcher, or SillyTavern's own Extensions menu, as usual. The launcher rates, updates and undoes them (see below). |
| **Server plugins** | SillyTavern's `plugins` folder, as usual (needs `enableServerPlugins: true` in `config.yaml`) |
| **Userscripts** (`.user.js`) | **Extensions → Userscripts → Open folder**, then restart the app. Replaces Tampermonkey. |
| **Desktop extensions** | Extensions for this app: right-click and menu entries, features in SillyTavern pages, their own settings panel. Install them from **Extensions → Desktop app → Get add-ons** (each download is checked against its published SHA256; updates keep their settings), or add your own. They stay off until you turn them on. |

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

Want to make a desktop extension? See **[EXTENSIONS.md](EXTENSIONS.md)** and the [example](examples/break-reminder).

### Themes

The launcher has a soft retro pixel look in **Departure Mono**, a pixel font where B and 8, I, l and 1, and O and 0 are easy to tell apart. **Settings → Appearance → App font** switches to DotGothic16, Pixelify Sans (the font before 1.6), VT323, Segoe UI or any font on your PC, and **Size** makes the launcher 80 to 150 % as large. The font also applies to the SillyTavern window's top bar; SillyTavern's own pages keep the font chosen in SillyTavern. Pick a theme, **SillyTavern** (default) or **Fox**, in **Settings → Appearance**, or click **New theme**: choose seven colors and a logo, and every logo turns into pixel art. **Export** and **Import theme…** share themes as small `.json` files. Themes are only colors and an image, never code.

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
| Check for updates on launch | On | Shows on Home when SillyTavern has an update |
| Update SillyTavern on launch | Off | When an update is out, installs it before the server starts |
| Check for app updates on launch | On | Shows on Home when this app has a new version. **Download update**, then **Restart and update** |
| Get preview versions of this app | Off | Also offers test versions (pre-releases, marked **preview**) before they become a regular release. Off again: you get the next regular release |
| Back up before updating | On | Back up your data before every update or channel switch |
| Scheduled backups | Off | On the **Backups** page: when, which profiles, where to, how many to keep |
| Use this app's own Node.js and Git | Off | Under **Maintenance → Back end** |
| Confirm before quitting | On | Ask before quitting while the server runs |
| Keep running in the tray | Off | Closing the launcher hides it to the tray and the server keeps running. Right-click the tray icon for more, including **Quit** |
| Automatic backups to keep | 10 | Older automatic backups are removed; manual ones never are |
| Port | `8000` | The port SillyTavern runs on |
| Phone & tablet | Off | Let devices on your Wi-Fi open SillyTavern, with an optional password ([how](#on-your-phone-or-tablet)) |
| Window layer, tabs | Normal, on | The SillyTavern window's defaults (also in its right-click menu) |
| Right-click search, Inspect element | Google, off | Which site **Search for "…"** uses, and an **Inspect element** entry (developer tools) for making themes and extensions |
| App font, Size | Departure Mono, 100 % | The font of the launcher and the SillyTavern window's top bar, and the launcher's size |
| Console font | Pixel | Any font on your PC, and its size |

**Closing:** closing every window stops the server and quits (unless the tray is on). If SillyTavern is already running elsewhere on the same port, the app uses that server instead of starting another.

## Help

| The console says | What to do |
|---|---|
| `SillyTavern not found at …` | The welcome screen opens: pick your install or click **Find it myself…** |
| `failed to launch node` | **Settings → Change…** shows what's missing; **Install for me** installs it, **Get them for this app only** downloads a private copy |
| `Update blocked by a changed package-lock.json` | **Maintenance → Reset package-lock.json**, then update again |
| `Cannot find module …` after an update | **Maintenance → Install missing dependencies** |
| `plugins/<name>.user.js is a browser userscript…` | Move that file into the userscripts folder and restart |
| `Timed out waiting for the server to respond.` | Read the lines above it, then try **Maintenance → Install missing dependencies** |
| The window never opens and another program uses the port | Change the **Port** in Settings |

Still stuck? Copy the console (**Copy** on the Console page) into a new [issue](../../issues).

### If the app stops working

A new SillyTavern version might not work inside the app right away. You can always use SillyTavern the usual way:

- **Open in browser** (on Home, or **Maintenance → If this app stops working**) starts the server if needed and opens SillyTavern in your normal web browser.
- **Start with Start.bat** (Maintenance) runs SillyTavern's own `Start.bat` in a command window, without the app at all. Close that window to stop it.

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

**Phone access** sets SillyTavern's `listen`, `whitelistMode`, `whitelist` (this PC plus its own private networks, e.g. `192.168.1.0/24`) and, with a password, `basicAuthMode` through `SILLYTAVERN_*` environment variables on the main server only. SillyTavern reads those before `config.yaml`, so the file is never edited. The app answers the login for its own windows (`app.on('login')`). An old `whitelist.txt` overrides the whitelist, so the app warns about it.

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
| `appupdate.js` | Self-update from GitHub releases (SHA256-checked) |
| `lan.js` | Phone access: local networks, the server's environment variables, QR codes (`qrcode-generator`) |
| `themes.js` | Built-in and custom themes, import/export |
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

### Roadmap

- [x] Use SillyTavern from your phone on the same Wi-Fi
- [x] "Update on launch" option
- [x] Profiles and a SillyTavern downloader (any version, with a warning for older ones)
- [x] Migrate data between SillyTavern folders and users, with Undo
- [x] Extension safety ratings, update review and undo, Kits, finding extensions
- [x] What's new: release notes and changes before and after updates, history per install
- [x] Scheduled backups, import by drag & drop / Open with, the app's own Node.js and Git
- [x] Preview versions of the app, SillyTavern on another computer, a clearer pixel font and font/size settings
- [x] Right-click menu, dragging tabs (also into their own window), installing desktop extensions from a list
- [ ] Linux and macOS ([help wanted](#windows-only-for-now))
- [ ] Code signing (no more SmartScreen warning)

### Contributing

Pull requests are welcome. One rule: **wrap, never fork.** No SillyTavern files in this repo and no edits to the user's SillyTavern files (changing its pages at runtime is fine). Keep changes small and focused, and keep `launcher.html` free of external dependencies.

## Credits

- [SillyTavern](https://github.com/SillyTavern/SillyTavern), the software this app runs. Go give it a star.
- SillyTavern's own `src/electron` launcher showed that this approach works.
- [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (MIT) draws the phone QR code.
- Fonts: [Departure Mono](https://departuremono.com/) by Helena Zhang, [DotGothic16](https://fonts.google.com/specimen/DotGothic16), [Pixelify Sans](https://fonts.google.com/specimen/Pixelify+Sans) and [VT323](https://fonts.google.com/specimen/VT323) (all SIL Open Font License; the licences are in `fonts/`).

## License

[AGPL-3.0](LICENSE), the same as SillyTavern.
