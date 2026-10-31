# Desktop extensions

Desktop extensions are add-ons for **SillyTavern Desktop itself**, not for SillyTavern. Use them to add your own buttons, tweaks and tools to the app without changing its code.

> Looking for SillyTavern extensions (the ones you install from SillyTavern's Extensions menu)? Those are different and keep working as usual.

## Try one first

Ready-made ones are under **Extensions → Desktop app → Get add-ons** in the launcher: click **Install**, then turn it on.

To look at how one is made:

1. In the launcher, open **Extensions → Desktop app**.
2. Click **Add example**. The *Break reminder* extension appears in the list.
3. Turn it on. Its settings panel shows up below the list, and the SillyTavern window's menu gets **Extensions → Break reminder: remind me now**.

Its source is in [`examples/break-reminder`](examples/break-reminder) and uses every part of the API below. Copy it to start your own.

## Safety

An extension's main module runs inside the app with **full access to your PC**, like any program you install. That's why every extension stays **off** until you turn it on, and the app asks first. Only turn on extensions you trust, and read the code if you can.

## Where extensions live

```
%APPDATA%\SillyTavern Desktop\extensions\
└── my-extension\          ← folder name = extension id (letters, numbers, . _ -)
    ├── manifest.json
    ├── main.cjs           ← optional: runs in the app (main process)
    ├── panel.js           ← optional: a panel on the launcher's Extensions page
    ├── data.json          ← created by api.storage
    ├── downloads/         ← files from api.download
    └── user/              ← anything else you save for the user
```

`data.json`, `downloads/` and `user/` are kept when the extension is updated from **Get add-ons**. Everything else is replaced by the new version.

**Open folder** on the Desktop app page opens it. After you edit an extension, click **Reload**.

## manifest.json

```json
{
    "name": "My extension",
    "version": "1.0.0",
    "author": "You",
    "description": "One or two sentences shown in the launcher.",
    "minAppVersion": "1.1.0",
    "main": "main.cjs",
    "panel": "panel.js",
    "uses": ["contextMenu", "pages"]
}
```

| Field | Required | Meaning |
|---|---|---|
| `name` | yes | Shown in the launcher and in log lines |
| `version`, `author`, `description` | no | Shown in the launcher |
| `minAppVersion` | no | The extension won't start on older versions of the app |
| `main` | no | Main module, a path inside the extension folder |
| `panel` | no | Launcher panel script, a path inside the extension folder |
| `uses` | no | What it does, shown to users before they install it: `pages`, `contextMenu`, `menu`, `panel`, `download`, `spellcheck`, `files` (reads SillyTavern's files). Only a description: the main module can do anything either way |

## The main module

Use `.cjs` (CommonJS) or `.mjs` (ES module) so Node always knows which it is.

```js
// main.cjs
exports.activate = function (api) {
    api.log('Hello!');
};
exports.deactivate = function () {
    // stop your own timers here
};
```

```js
// main.mjs
export function activate(api) { api.log('Hello!'); }
export function deactivate() {}
```

`activate(api)` runs when the extension is turned on (and when the app starts, if it is on). `deactivate()` runs when it is turned off or reloaded. **Everything you add through `api` is removed for you** when the extension turns off. Only clean up what you created yourself, such as timers or files.

### api

| | |
|---|---|
| `api.id`, `api.dir`, `api.appVersion` | The extension's id, its folder, and the app's version |
| `api.log(text)` | A line in the launcher's Console, prefixed with your extension's name |
| `api.storage.get(key, fallback)` / `.set(key, value)` / `.all()` | Your own settings, saved as JSON in `data.json` |
| `api.on(event, fn)` | `'server-started'` or `'server-stopped'` (the main SillyTavern server). Returns an unsubscribe function |
| `api.sillytavern.folder()` / `.url()` / `.info()` | The SillyTavern folder, its address, and `{ version, branch, port, running }` |
| `api.sillytavern.openTab(path)` | Opens a page of the running SillyTavern, like `'/'`, in a tab or window |
| `api.pages.addStyle(css)` | Adds CSS to every SillyTavern page, open now or opened later. Returns `{ remove() }` |
| `api.pages.addScript(code)` | Runs JavaScript in every SillyTavern page when it loads (and once in pages already open). Returns `{ remove() }` |
| `api.pages.run(code)` | Runs JavaScript once in every open SillyTavern page |
| `api.pages.count()` | How many SillyTavern pages are open |
| `api.pages.handle(channel, fn)` | Lets page code call `fn` with `SillyTavernDesktop.invoke('<your id>', channel, ...args)`. `fn(page, ...args)` gets the calling page first (see below). Return a value (or a promise) to answer |
| `api.menu.add({ label, click })` | An item under **Extensions** in the SillyTavern window's menu. Returns `{ remove() }` |
| `api.contextMenu.add({ label, contexts, when, click })` | An entry in the right-click menu of SillyTavern pages. See below. Returns `{ remove() }` |
| `api.download(url, { file, sha256, maxBytes })` | Downloads an `https` file into your `downloads/` folder (`file` is its name there, folders allowed). Checks `sha256` if given; refuses files over `maxBytes` (default 200 MiB). Returns a promise of `{ path, bytes, sha256 }` |
| `api.spellcheck.add(words)` / `.remove(words)` / `.list()` | Words the built-in spellchecker (the red underline) accepts, in every SillyTavern page. They stay after your extension turns off: remove them yourself if needed |
| `api.handle(channel, fn)` | Lets your launcher panel call `fn` with `ext.invoke(channel, ...args)`. Return a value (or a promise) to answer |

### Right-click menu entries

```js
api.contextMenu.add({
    label: 'Look up "%s"',           // %s = the selected text (shortened)
    contexts: ['selection'],          // when to show it (default: ['all'])
    when: info => info.selectionText.length < 40,   // optional extra check
    click: info => api.log(`Looking up ${info.selectionText}`),
});
```

`contexts` can be `all`, `page` (empty space), `selection`, `editable` (a text box), `link`, `image` and `misspelled` (a word the spellchecker underlined). The entry shows when any of them matches.

`info` has `contexts`, `selectionText`, `linkURL`, `srcURL` (images), `pageURL`, `frameURL`, `isEditable`, `misspelledWord`, `suggestions` (the spellchecker's), and `page`:

- `page.url`: the page's address
- `page.run(code)`: runs JavaScript in that page
- `page.insertText(text)`: types text at the cursor of the focused text box (replacing what is selected)

Entries from all extensions appear together near the end of the menu. An extension with more than two matching entries gets a submenu with its name.

### Page code calling your extension

Page code (from `api.pages.addScript`) can ask your main module for things it can't do itself, such as reading a file:

```js
// main.cjs
api.pages.handle('word-count', (page, text) => text.split(/\s+/).filter(Boolean).length);

// page code
const n = await SillyTavernDesktop.invoke('my-extension', 'word-count', 'some text here');
```

Only channels you registered with `api.pages.handle` answer, and only SillyTavern pages shown by this app can call them. Arguments and answers are copied (plain data, no functions). Treat what a page sends like any input from the web: SillyTavern's own extensions run in the same page.

"SillyTavern pages" means every SillyTavern tab and window the app shows: the main one, read-only copies, second servers and other installs. Page code runs in the page itself, like a userscript, so it can use SillyTavern's globals such as `SillyTavern.getContext()`. **It never changes SillyTavern's files.** Use SillyTavern's own CSS variables, for example `var(--SmartThemeBodyColor)`, so your additions follow the user's SillyTavern theme.

## The launcher panel

If the manifest has `panel`, the launcher shows a card with your extension's name on the Desktop app page and runs the script with two names in scope:

- `panel`: the card's body element. Fill it with your UI.
- `ext`: `{ id, invoke(channel, ...args) }`. `invoke` calls a handler registered with `api.handle` and returns a promise of its answer.

```js
// panel.js
panel.innerHTML = '<button class="btn sm">Say hello</button>';
panel.querySelector('button').onclick = () => ext.invoke('hello');
```

The launcher's classes make a panel look native: `btn` (`sm`, `primary`, `ghost`), `row`, `stack`, `field` with a `label` and `input`, `muted`, `small`. Colors come from the launcher theme through CSS variables like `var(--accent)` and `var(--text)`.

The panel only appears while the extension is on.

## Tips

- Something went wrong? The launcher's Console shows `[extension <name>]` lines, including errors from `activate`, menu items and event handlers. A broken `manifest.json` shows its error in the extension list.
- Keep page code small and defensive: SillyTavern changes between versions. Prefer `?.` and checks over assumptions.
- Share an extension by zipping its folder. Others unzip it into their extensions folder and turn it on.
- Turn on **Settings → SillyTavern window → Show "Inspect element" in the right-click menu** to open Chromium's developer tools on a SillyTavern page while you work on page code.

## Sharing it in "Get add-ons"

The launcher's **Get add-ons** list comes from [`catalog.json`](https://github.com/Lab-Fox/sillytavern-desktop-extensions) in the sillytavern-desktop-extensions repository. To add yours, open a pull request there with an entry like this:

```json
{
    "id": "my-extension",
    "name": "My extension",
    "version": "1.0.0",
    "author": "You",
    "description": "One or two sentences.",
    "homepage": "https://github.com/you/my-extension",
    "minAppVersion": "1.7.0",
    "uses": ["contextMenu", "pages"],
    "download": "https://github.com/you/my-extension/releases/download/v1.0.0/my-extension-1.0.0.zip",
    "sha256": "<the zip's SHA256, 64 hex characters>",
    "size": 12345
}
```

- `id` becomes the folder name (letters, numbers, `.` `_` `-`).
- The zip holds the extension's files, either at its root or in one folder. It must have a `manifest.json` with a `name`.
- `download` must be `https`. The app refuses a file whose SHA256 doesn't match, so publish a new version (new zip, new `sha256`) instead of replacing a file.
- Raising `version` in the catalog shows **Update** to everyone who has an older version installed.
