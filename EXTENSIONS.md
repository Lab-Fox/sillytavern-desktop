# Desktop extensions

Desktop extensions are add-ons for **SillyTavern Desktop itself**, not for SillyTavern. Use them to add your own buttons, tweaks and tools to the app without changing its code.

> Looking for SillyTavern extensions (the ones you install from SillyTavern's Extensions menu)? Those are different and keep working as usual.

## Try one first

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
    └── data.json          ← created by api.storage
```

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
    "panel": "panel.js"
}
```

| Field | Required | Meaning |
|---|---|---|
| `name` | yes | Shown in the launcher and in log lines |
| `version`, `author`, `description` | no | Shown in the launcher |
| `minAppVersion` | no | The extension won't start on older versions of the app |
| `main` | no | Main module, a path inside the extension folder |
| `panel` | no | Launcher panel script, a path inside the extension folder |

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
| `api.menu.add({ label, click })` | An item under **Extensions** in the SillyTavern window's menu. Returns `{ remove() }` |
| `api.handle(channel, fn)` | Lets your launcher panel call `fn` with `ext.invoke(channel, ...args)`. Return a value (or a promise) to answer |

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
