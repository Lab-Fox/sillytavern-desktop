# Troubleshooting

[README](../README.md) · [User guide](USER-GUIDE.md) · **Troubleshooting** · [Developers](DEVELOPERS.md)

When something doesn't work: what the console says, what to do, and where things are on your PC.

- [When something goes wrong](#when-something-goes-wrong)
  - [If the app stops working](#if-the-app-stops-working)

---

## When something goes wrong

| The console says | What to do |
|---|---|
| `SillyTavern not found at …` | The welcome screen opens: pick your install or click **Find it myself…** |
| `failed to launch node` | **Settings → Server → Folder → Change…** shows what's missing; **Install for me** installs it, **Get them for this app only** downloads a private copy |
| `Update blocked by a changed package-lock.json` | **Tools → Reset package-lock.json**, then update again |
| `Cannot find module …` after an update | **Tools → Install missing dependencies** |
| `plugins/<name>.user.js is a browser userscript…` | Move that file into the userscripts folder and restart |
| `Timed out waiting for the server to respond.` | Read the lines above it, then try **Tools → Install missing dependencies** |
| The window never opens and another program uses the port | Change the **Port** in Settings |

Still stuck? Copy the console (**Copy** in the console) into a new [issue](https://github.com/Lab-Fox/sillytavern-desktop/issues).

### If the app stops working

A new SillyTavern version might not work inside the app right away. You can always use SillyTavern the usual way:

- **Open in browser** (on Home, or **Tools → If this app stops working**) starts the server if needed and opens SillyTavern in your normal web browser.
- **Start with Start.bat** (Tools) runs SillyTavern's own `Start.bat` in a command window, without the app at all. Close that window to stop it.

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
