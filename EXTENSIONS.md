# Desktop extensions

Desktop extensions are add-ons for **SillyTavern Desktop itself**, not for SillyTavern. Use them to add your own buttons, tweaks and tools to the app without changing its code.

> Looking for SillyTavern extensions (the ones you install from SillyTavern's Extensions menu)? Those are different and keep working as usual.

## Try one first

Ready-made ones are under **Extensions → Desktop add-ons → Get add-ons** in the launcher: click **Install**, then turn it on.

To look at how one is made:

1. In the launcher, open **Extensions → Desktop add-ons**.
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

**Open folder** on the Desktop add-ons tab opens it. After you edit an extension, click **Reload**.

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
    "sidepanel": "sidepanel.html",
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
| `sidepanel` | no | An HTML page docked on the right of the SillyTavern window, a path inside the extension folder (needs app 1.9.0; see below) |
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
| `api.on(event, fn)` | `'server-started'` or `'server-stopped'` (the main SillyTavern server), `'profile-switched'` (`fn({ folder })`: the app now uses another SillyTavern), `'quit'` (the app is quitting; servers still run; `fn` may return a promise, and all quit handlers get 2 seconds together). Returns an unsubscribe function |
| `api.sillytavern.folder()` / `.url()` / `.info()` | The SillyTavern folder, its address, and `{ version, branch, port, running }` |
| `api.sillytavern.openTab(path)` | Opens a page of the running SillyTavern, like `'/'`, in a tab or window |
| `api.sillytavern.request(method, path, body)` | A `GET` or `POST` to SillyTavern's own API (`/api/…` or `/version`) on this PC's server of the active profile, with a session of the app's own (its CSRF token, and the phone-access login when that is on). JSON in; returns a promise of the parsed JSON (or text). Waits up to a minute for a server that is still starting. Refuses with a clear message when SillyTavern's user accounts are on (needs app 1.9.0) |
| `api.sillytavern.page(name, args, { onChunk, signal })` | Runs one of the app's named functions in this PC's open SillyTavern page (see below). Returns a promise of its answer; `onChunk(data)` gets streamed pieces; an `AbortSignal` stops it. Rejects with `SillyTavern reloaded during the request.` if the page reloads first, and `Open SillyTavern first.` when no SillyTavern page is open (needs app 1.9.0) |
| `api.pages.addStyle(css)` | Adds CSS to every SillyTavern page, open now or opened later. Returns `{ remove() }` |
| `api.pages.addScript(code)` | Runs JavaScript in every SillyTavern page when it loads (and once in pages already open). Returns `{ remove() }` |
| `api.pages.run(code)` | Runs JavaScript once in every open SillyTavern page |
| `api.pages.count()` | How many SillyTavern pages are open |
| `api.pages.handle(channel, fn)` | Lets page code call `fn` with `SillyTavernDesktop.invoke('<your id>', channel, ...args)`. `fn(page, ...args)` gets the calling page first (see below). Return a value (or a promise) to answer |
| `api.menu.add({ label, click })` | An item under **Extensions** in the SillyTavern window's menu. Returns `{ remove() }` |
| `api.contextMenu.add({ label, contexts, when, click })` | An entry in the right-click menu of SillyTavern pages. See below. Returns `{ remove() }` |
| `api.changes.record({ folder, kind, target, before, after, files })` | Before changing SillyTavern's files: copies each file you will touch into your `user/changes/` folder (each content once) and writes an entry. Returns a promise of its id, resolved once everything is flushed to disk (a 100 MB chat takes about 1.5 s). `folder` is a SillyTavern folder, `files` are absolute or relative to it and must be inside its `data` folder (which may itself be a junction to another drive) or a third-party extension (`public/scripts/extensions/third-party/…`): never SillyTavern's own code, no links or junctions below those, no names Windows treats specially. A file that doesn't exist yet is recorded as new. `kind`, `target`, `before` and `after` are yours (plain data, up to 5 MB): keep what your own item-level Undo needs (needs app 1.9.0) |
| `api.changes.finish(id)` | After your write (promise): records the files' new hashes, so `restoreFile` can tell whether something changed them since |
| `api.changes.get(id)` / `.list({ folder })` | One entry with its files (`path`, `rel`, `existed`, `sha256`, `afterSha256`) and your `before`/`after`, or all entries, newest first (without `before`/`after`) |
| `api.changes.safetyCopy(id, file)` / `.restoreFile(id, file, { force })` | The path of a file's copy (null for a new file), or put the whole file back as it was (promise; a new file is removed). `restoreFile` refuses when the file changed since: after `finish`, against its new hash; before `finish` (your write failed), against the hash it had when recorded (unchanged: nothing to do). `force` skips that check. A copy that no longer matches its hash is never restored |
| `api.changes.prune({ days, keep })` / `.size()` | Removes entries older than `days` (30) that aren't among the newest `keep` (200), and copies nothing uses any more; `size()` is the bytes the copies take |
| `api.download(url, { file, sha256, maxBytes })` | Downloads an `https` file into your `downloads/` folder (`file` is its name there, folders allowed). Checks `sha256` if given; refuses files over `maxBytes` (default 200 MiB). Returns a promise of `{ path, bytes, sha256 }` |
| `api.spellcheck.add(words)` / `.remove(words)` / `.list()` | Words the spellchecker (the red underline) accepts, in every SillyTavern page. They stay after your extension turns off: remove them yourself if needed |
| `api.spellcheck.engine()` / `.setEngine()` | Deprecated: the app always uses Windows' spellchecker now. `engine()` returns `{ engine: 'windows', chosen: 'windows' }`, and `setEngine()` changes nothing and returns `{ engine: 'windows', restart: false }` |
| `api.app.relaunch()` | Restarts the app (ask the user first) |
| `api.sidepanel.handle(channel, fn)` | Lets your side panel call `fn` with `desktopPanel.invoke(channel, ...args)`. Return a value (or a promise) to answer; a thrown error's message reaches the panel |
| `api.sidepanel.send(message)` | Sends plain data to every open side panel of your extension, in order |
| `api.sidepanel.onOpen(fn)` | `fn()` runs when a side panel of yours has loaded (opened, or its page reloaded): send it what it should show. Returns an unsubscribe function |
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

`label` can also be a function: `label: info => \`Add "${info.misspelledWord}"\`` (an empty string hides the entry). `group: 'spelling'` puts the entry next to the spellchecker's suggestions; the app then leaves out its own "Add to dictionary", so the menu doesn't show two.

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

### Named page functions

`api.sillytavern.page` only runs these, shipped with the app; an add-on passes plain data, never code:

| Name | Arguments | Answer |
|---|---|---|
| `version` | none | `{ version, branch }` of the SillyTavern in the page |
| `profiles` | none | `{ available, profiles: [{ id, name, api, model, preset, maxContext }], selected, currentMaxContext }`: the Connection Manager's profiles SillyTavern can send requests through (`available: false` when Connection Manager is off) |
| `tokenCount` | `{ text }` | `{ count }` with SillyTavern's current tokenizer |
| `tokenCounts` | `{ texts }` | `{ counts }`, in the same order (up to 200 texts) |
| `context` | none | What is open: `{ chatId, characterAvatar, characterName, groupId, messageCount, userName }` |
| `chatMessages` | `{ from, to }` | Messages of the open chat by index (up to 500 per call): `{ chatId, total, messages: [{ index, name, isUser, isSystem, text }] }` |
| `character` | `{ avatar }` | A character's card fields as stored, without macros replaced: `name`, `description`, `personality`, `scenario`, `first_mes`, `mes_example`, `alternate_greetings`, `creator_notes`, `system_prompt`, `post_history_instructions`, `tags` |
| `persona` | `{ avatar }` | `{ avatar, name, description }`; `avatar: null` is the persona in use |
| `preset` | `{ name }` | A chat completion preset (`null`: the selected one): `{ name, preset }` with its settings, `prompts` and `prompt_order` |
| `lorebook` | `{ name }` | `{ name, entries: [{ uid, keys, secondaryKeys, comment, content, constant, disabled, order, position }] }` |
| `lists` | none | `{ characters: [{ avatar, name }], personas: [{ avatar, name }], presets, lorebooks }` |
| `characterFlush` | `{ avatar }` | When SillyTavern's character form shows that card and its text boxes differ from the card: saves the user's typing now (`{ flushed }`). Call it before changing a card through the server |
| `characterRefresh` | `{ avatar, field? }` | After changing a card through the server: the page's copy, and the form when it shows that card (otherwise SillyTavern's next save would bring the old text back). With a `field` that has its own text box (`description`, `scenario`, …) only that box is set, so typing in the rest of the form stays |
| `characterListRefresh` | none | After a card was made or deleted through the server |
| `characterDelete` | `{ avatar, keepChats? }` | Deletes a card, and its chats unless `keepChats` (SillyTavern's own delete, which closes the open chat, only when that card is open) |
| `lorebookFlush` | none | Saves the book open in the World Info editor now (its own save waits a second) |
| `lorebookSave` | `{ name, data }` | Saves a whole book through the page, so its in-memory copy and the file agree, and shows it (the book open in the World Info editor is saved first: SillyTavern's immediate save cancels its pending one) |
| `lorebookReload` | `{ name }` | After a book changed outside the page: forgets the page's copy and shows the file |
| `lorebookEntry` | `{ name, op, uid, values, entry, expect }` | One entry changed inside the page with SillyTavern's own helpers (a book from a card keeps its card copy in step): `op` `set` / `add` (answers the new `uid`) / `delete` / `put` (back under its old uid). With `expect`, nothing is written if the entry changed since |
| `lorebookDelete` | `{ name }` | SillyTavern's own delete (links from characters and settings cleaned up) |
| `generate` | `{ profileId, messages: [{ role, content }], maxTokens, stream }` | `{ text, reasoning, fallback }`. Sends exactly `messages` through the profile's connection, with its preset's sampler settings but **not** the preset's prompts (a text completion profile's instruct template is used: it only marks the roles and gives the stop strings). `onChunk({ text })` gets the text so far while it streams. Without a profile (or with Connection Manager off) it uses SillyTavern's current Chat Completion connection and says `fallback: true` |

The request goes out from the user's SillyTavern, to the provider they set up there: tell your users what you send.

## The launcher panel

If the manifest has `panel`, the launcher shows a card with your extension's name on the Desktop add-ons tab and runs the script with two names in scope:

- `panel`: the card's body element. Fill it with your UI.
- `ext`: `{ id, invoke(channel, ...args) }`. `invoke` calls a handler registered with `api.handle` and returns a promise of its answer.

```js
// panel.js
panel.innerHTML = '<button class="btn sm">Say hello</button>';
panel.querySelector('button').onclick = () => ext.invoke('hello');
```

The launcher's classes make a panel look native: `btn` (`sm`, `primary`, `ghost`), `row`, `stack`, `field` with a `label` and `input`, `muted`, `small`. Colors come from the launcher theme through CSS variables like `var(--accent)` and `var(--text)`.

The panel only appears while the extension is on.

## The side panel

If the manifest has `sidepanel`, the SillyTavern window's top bar gets a panel button while your extension is on (with several extensions, the button shows a menu). The page opens docked on the right of the window, beside every tab: it stays when tabs switch or SillyTavern reloads, and its width (300 px up to half the window, dragged at its left edge) is remembered. One panel shows per window at a time.

The page is your own HTML, loaded from your folder, without Node access and with its own memory-only browser session. It reaches your main module through `window.desktopPanel`:

- `desktopPanel.invoke(channel, ...args)`: calls a handler registered with `api.sidepanel.handle`, returns a promise of its answer. Only your own extension's handlers answer (`No handler for <channel>` otherwise).
- `desktopPanel.onMessage(fn)`: `fn(message)` for every `api.sidepanel.send`. Messages sent before the page listens wait for its first listener.
- `desktopPanel.tab()`: the SillyTavern tab beside the panel, `{ kind, url, folder }`. `kind` is `'main'`, `'readonly'`, `'port'` (a second server, same folder), `'other'` (another install), `'remote'` or `'web'`; `folder` is null for the last two.
- `desktopPanel.onTab(fn)`: `fn()` when the window shows another tab; call `tab()` again.

```html
<!-- sidepanel.html -->
<button id="hi">Ask</button> <span id="out"></span>
<script>
  hi.onclick = async () => { out.textContent = await desktopPanel.invoke('answer', 21); };
  desktopPanel.onMessage(m => console.log('from main:', m));
</script>
```

```js
// main.cjs
module.exports = { activate(api) {
    api.sidepanel.handle('answer', n => n * 2);
    api.sidepanel.onOpen(() => api.sidepanel.send({ hello: 'panel' }));
} };
```

Links to `http`/`https` pages open in the browser; the page itself can't navigate away. Use SillyTavern-like colours of your own: the panel doesn't see SillyTavern's theme.

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

- `node addons/build.cjs <folder>` (in this repository) zips an add-on from `addons/` and prints this entry with its `sha256` and `size`. The same files always give the same zip.
- `id` becomes the folder name (letters, numbers, `.` `_` `-`).
- The zip holds the extension's files, either at its root or in one folder. It must have a `manifest.json` with a `name`.
- `download` must be `https`. The app refuses a file whose SHA256 doesn't match, so publish a new version (new zip, new `sha256`) instead of replacing a file.
- Raising `version` in the catalog shows **Update** to everyone who has an older version installed.
