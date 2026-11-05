# Making themes

[Back to the README](../README.md) · [User guide](USER-GUIDE.md)

There are three ways to make a theme, from no code to all of it:

1. **Theme Studio** (no code): **Settings → Appearance → New theme**. Colors, shapes, fonts, a wallpaper and placed pictures, with a live preview.
2. **By hand**: a folder with `theme.json` and CSS. Start with **Settings → Appearance → For theme creators → Make a starter theme**.
3. **Share it**: **Export** makes a `.sttheme` file, which anyone can install.

A theme can change how the launcher and the SillyTavern window's top bar look. SillyTavern's own pages have their own themes, in SillyTavern.

## Contents

- [Working on a theme](#working-on-a-theme)
- [The files](#the-files)
- [theme.json](#themejson)
- [CSS](#css)
- [Settings you can change](#settings-you-can-change)
- [Parts and classes](#parts-and-classes)
- [Reacting to the app](#reacting-to-the-app)
- [Wallpaper and layers](#wallpaper-and-layers)
- [Options](#options)
- [Animation](#animation)
- [Scenes](#scenes)
- [What isn't allowed](#what-isnt-allowed)
- [Before you share it](#before-you-share-it)

## Working on a theme

Under **Settings → Appearance → For theme creators**:

| Tool | What it does |
|---|---|
| **Make a starter theme** | Installs a commented theme, makes it active and opens its folder |
| **Apply changes as I save** | Watches the active theme's folder: save a file and the app updates |
| **Open its folder** | Opens the active theme's files |
| **Show parts** | Point at anything to see the name a theme can use for it; click to copy it, Esc to stop |
| **Check it** | Hard-to-read colors, names that may break in an update, large or unused files |

If a theme makes the app hard to use, press **Ctrl+Alt+Shift+T** in the launcher, or hold **Shift** while the app starts.

## The files

A `.sttheme` file is a zip. Everything sits at the top of the zip, or in one folder:

| File | |
|---|---|
| `theme.json` | Required: name, colors and everything below |
| `theme.css` | CSS for the launcher |
| `bar.css` | CSS for the SillyTavern window's top bar |
| Pictures | `.png` `.jpg` `.gif` `.webp` `.apng` `.svg` |
| Video | `.webm` `.mp4` (never any sound) |
| Fonts | `.woff2` `.woff` `.ttf` `.otf` |
| Text | `README.md`, `README.txt`, `LICENSE` |
| `scene/` | Optional: `.html`, `.js` and `.css` of a [scene](#scenes) |

Limits: 50 MB for the file, 150 MB unpacked, 2000 files, 512 KB of CSS per file. Every file must really be what its name says.

## theme.json

```json
{
  "format": 2,
  "apiVersion": 1,
  "name": "Midnight",
  "author": "you",
  "version": "1.0",
  "description": "Shown when someone installs it.",
  "colors": {
    "bg": "#14161f", "panel": "#1c1f2b", "border": "#30364a", "accent": "#7aa2f7",
    "text": "#c8cde0", "title": "#eef0f8", "muted": "#8a90a8"
  },
  "logo": "assets/logo.png"
}
```

The seven `colors` are required; `onAccent`, `good`, `warn` and `bad` are optional. Every other shade is mixed from them. `logo` is `"st"`, `"fox"` or a picture in the theme, up to 512 KB. `apiVersion` is the version of this guide your theme was made for: 1.

## CSS

Write normal CSS, including `:has()`, nesting, `@media`, `@container`, `@keyframes`, `@font-face`, `@supports` and `@property`. Your rules beat the app's without `!important`.

`url()` holds a path inside the theme, like `url(assets/night.png)`, or a small `data:image/…`. Use `url()` around each picture in `image-set()` too.

A font should end with `var(--lang-fonts)`, so Chinese, Japanese and Korean letters still show:

```css
@font-face { font-family: "Fancy"; src: url(assets/fancy.woff2); }
:root { --body-font: "Fancy", var(--lang-fonts), sans-serif; }
```

The seven colors and **Settings → App font** are set by the app: change colors in `theme.json`, and fonts with `--body-font` and `--heading-font`.

## Settings you can change

The easy way in: change one and it applies everywhere. These names won't change without a new `apiVersion`.

| Setting | Default | |
|---|---|---|
| `--radius` | `0px` | All corners |
| `--btn-radius` `--card-radius` `--input-radius` `--tag-radius` `--nav-radius` `--switch-radius` | `--radius` | Corners of one kind of thing |
| `--tab-radius` | `--radius` | Tabs, in `bar.css` |
| `--border-w` | `2px` | Border width |
| `--divider` | dashed | The lines between rows |
| `--shadow-card` `--shadow-btn` | hard pixel shadows | Shadows |
| `--btn-press` | moves 2 px | The transform of a pressed button |
| `--nav-active-mark` | accent bar | The mark on the open page in the sidebar |
| `--transition` | `none` | Button transitions |
| `--app-bg` `--sidebar-bg` `--header-bg` `--page-bg` | | Backgrounds |
| `--card-bg` `--hero-bg` `--btn-bg` `--btn-primary-bg` `--input-bg` | | More backgrounds |
| `--dock-bg` `--console-bg` | | The console |
| `--bar-bg` `--tab-active-bg` | | The top bar, in `bar.css` |
| `--scrollbar-track` `--scrollbar-thumb` `--scrollbar-w` | | Scrollbars |
| `--body-font` `--heading-font` | the app font | Fonts |
| `--sidebar-w` `--card-pad` | `228px` `18px` | Sizes |
| `--icon-stroke` | `2` | Line width of the icons |
| `--logo-render` | `pixelated` | `auto` for a smooth logo |

You can also read the mixed shades: `--surface`, `--panel2`, `--shadow`, `--accent2`, `--faint`, `--tint`, `--well`, `--on-accent`, `--good`, `--warn`, `--bad`, and the unit `--px`.

## Parts and classes

Single parts of the window have a `data-part`:

`sidebar`, `brand`, `nav`, `nav-item`, `sidebar-footer`, `main`, `header`, `page-title`, `server-status`, `power-button`, `busy-bar`, `page`, `console-dock`, `console`, `dialog`, and in the top bar `topbar`, `tab-strip`, `tab-info`.

```css
[data-part="sidebar"] { background: url(assets/wood.png); }
```

Things that repeat keep their class names, and these won't change either: `.btn` (with `.primary`, `.ghost`, `.danger`, `.sm`), `.card`, `.hero`, `.tag`, `.pill`, `.tip`, `.seg`, `.tgl`, `.set-group`, `.set-row`, `.item`, `.i` (icons), `.layer`, `.layer-slot`, and `.tab`, `.chip` in the top bar.

Any other class name or the order of elements can change in any update. **Check it** warns you if you lean on one. Pages have the ids `page-home`, `page-profiles` and so on, on a `[data-part="page"]`.

## Reacting to the app

The launcher's `<html>` carries the app's state:

| Attribute | Values |
|---|---|
| `data-page` | `home`, `profiles`, `extensions`, `aiapps`, `backups`, `migrate`, `maintenance`, `settings` |
| `data-server` | `running`, `stopped` |
| `data-busy` | `yes`, `no` |
| `data-update` | `available`, `none` |
| `data-time` | `morning`, `day`, `evening`, `night` |
| `data-motion` | `on`, `off` |

```css
html[data-server="running"] [data-part="brand"] { filter: drop-shadow(0 0 6px var(--good)); }
```

## Wallpaper and layers

`"wallpaper": "assets/bg.webm"` fills the window behind everything. For it to show through, make things see-through, for example `--sidebar-bg: color-mix(in srgb, var(--surface) 70%, transparent)`, or use **See-through panels** in Theme Studio.

`"layers"` places pictures and video, up to 24, of which 4 can be videos:

```json
"layers": [{
  "id": "sleepy", "src": "assets/fox.gif", "slot": "sidebar", "anchor": "bottom-right",
  "width": "40%", "minWidth": "48px", "maxWidth": "120px", "x": "5%", "y": "2%",
  "z": "behind", "hideBelow": 900, "when": { "server": "stopped", "page": ["home", "profiles"] }
}]
```

| Key | Values |
|---|---|
| `id` | A name for your CSS: `[data-layer="sleepy"]` |
| `src` | A picture or video in the theme |
| `slot` | The part of the window it lives in: `window`, `sidebar`, `header`, `page`, `console`, `hero` |
| `anchor` | `top-left`, `top`, `top-right`, `left`, `center`, `right`, `bottom-left`, `bottom`, `bottom-right` |
| `width` `height` `minWidth` `maxWidth` `x` `y` | Percent of the slot, or pixels. Percent follows the window when it's resized |
| `fit` | `contain`, `cover`, `fill`, `none` |
| `z` | `behind` the content or `above` it. Clicks always pass through |
| `opacity` | 0 to 1 |
| `pixelated` | `true` for sharp pixel art |
| `hideBelow` | Hide when the window is narrower than this many pixels |
| `when` | Show only for these `page`, `server`, `busy`, `update`, `time` or `opt-…` values |

## Options

`"options"` adds choices to **Settings → Appearance → Theme options**, so people can adjust your theme without editing it. Up to 30; each theme remembers its own values.

```json
"options": [
  { "id": "glow", "type": "toggle", "label": "Glowing buttons", "description": "Optional line under the name.", "default": true },
  { "id": "season", "type": "select", "label": "Season", "default": "winter",
    "choices": [{ "value": "spring", "label": "Spring" }, { "value": "winter", "label": "Winter" }] },
  { "id": "round", "type": "slider", "label": "Corners", "min": 0, "max": 24, "step": 2, "unit": "px", "default": 8 },
  { "id": "tint", "type": "color", "label": "Tint", "default": "#3388ff" }
]
```

```css
html[data-opt-glow="on"] .btn { box-shadow: 0 0 8px var(--accent); }
html[data-opt-season="winter"] [data-part="sidebar"] { background: url(assets/snow.png); }
:root { --radius: var(--opt-round); --card-bg: var(--opt-tint); }
```

Toggles give `on` or `off`; lists give their `value`; sliders and colors give a `--opt-…` value. Layers can follow toggles and lists: `"when": { "opt-season": "winter" }`.

## Animation

GIFs, WebP, APNG, video and CSS animation all work. People can turn them off with **Settings → Appearance → Theme animations**, and everything stops by itself while the window is hidden, while the screen is off, or when Windows has animation effects turned off. You don't need any code for this. If you want a different look when nothing moves, use `html[data-motion="off"]`.

Moving things use power. Keep video small, and prefer one looping video to many GIFs.

## Scenes

For what pictures and CSS can't do, like falling snow or a shader, a theme can have one **scene**: an HTML page with JavaScript, drawn as a layer.

```json
"layers": [{ "id": "snow", "src": "scene/index.html", "slot": "window", "z": "behind" }]
```

Everything it needs lives in the `scene/` folder (`.html`, `.js`, `.css`, plus pictures, video and fonts). It's sized and placed like any layer, and fills its slot unless you set a size.

It runs sealed off. It has no access to the app, the page around it, your files, storage or the internet, and it can't catch clicks. People are asked before a scene runs, and can turn it off under **Theme options**.

The app tells it what's going on. It can't answer:

```js
addEventListener('message', e => {
  const { page, server, busy, update, time, motion, accent, bg, options } = e.data;
});
```

A scene is stopped and removed, not paused, when animations are off, when its `when` doesn't match, and while the window is hidden; it starts again from the top when it comes back. Keep it light: it runs for as long as the window is in use.

## What isn't allowed

Themes are shared files that run inside the app, so the app refuses:

- Scripts and HTML, anywhere but in a sealed [scene](#scenes).
- `@import`, `@layer` and `@charset`, and addresses outside the theme: `http:`, `file:`, absolute paths, `..`.
- `src()`, `element()`, `paint()`, `image()`, `cross-fade()` and `-webkit-app-region`.
- Files that aren't what their name says, links to other places, and names Windows treats specially.

All CSS is checked each time it loads, so a change on disk is checked too. CSS that doesn't pass is left out and the reason shows under **For theme creators**.

A few things always stay visible whatever your CSS says: warnings, open dialogs, and the Start/Stop, Menu and Reload buttons. Decoration can't catch clicks.

## Before you share it

1. Press **Check it**.
2. Try the window at its smallest, 820 × 560, and at **Settings → Appearance → Size** 150 %.
3. Try another language: Japanese or Chinese shows if your font has a fallback.
4. Turn **Theme animations** off and see that it still looks right.
5. Only use pictures and fonts you have the right to share. Add a `LICENSE` if you need to.
