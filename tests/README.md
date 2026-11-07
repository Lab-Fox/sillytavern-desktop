# Tests

Everything here runs outside the app build (`package.json` lists the shipped files one by one).

## Quick check

    npm test

Checks the theme CSS checker with hostile samples, and the folder rules and data-folder logic (`unit/`, Node's own test runner). Needs nothing else.

## Theme suites (`theme/`)

These start the real app on throwaway data:

    node tests/theme/t3.mjs <exe> <app folder or -> <test data folder> <SillyTavern clone> <output folder>

For a source run, `<exe>` is `node_modules/electron/dist/electron.exe` and the app folder is `.`. For a built app, pass the exe and `-`.

| File | Checks |
|---|---|
| `t1` | theme file route, file: guard, safe start |
| `t2` | top bar |
| `t3` | token contract |
| `t4` | hostile `.sttheme` files |
| `t5` | layers, pausing, GPU use |
| `t6` | theme options |
| `t7` | Theme Studio and creator tools |
| `t8` | scene attacks, with local HTTP and UDP listeners |
| `t9` | example themes and their cost |
| `t10` | languages and startup |
| `t11` | release smoke test |
| `cap` + `pngdiff` | pixel comparison of every screen |

## App checks (`app/`)

These start the app on throwaway data. Set `ST_RUNS` (a folder for test data) and `ST_CLONE` (a throwaway SillyTavern). Set `ST_EXE` to test a built app instead of the source.

    node tests/app/favicon.mjs
    node tests/app/header.mjs
    node tests/app/underlines.mjs
    node tests/app/datadir.mjs
    pwsh -File tests/app/portable-second.ps1 -Exe <portable exe> -Run <empty test folder>

`datadir` (built app only, see below) covers where the app keeps its data and moving it; `favicon` covers the tab icon (http, HTTPS, another site, too big, not a picture), `header` the page titles in every language, `underlines` the spellchecker on a new profile, `portable-second` a second launch of the portable.

`datadir.mjs` needs a built app (`ST_EXE`; add `ST_PORTABLE=1` for the portable exe): it runs without `--user-data-dir` and with fake "%APPDATA%" folders in `ST_RUNS` (`ST_DESKTOP_APPDATA`), so a real install's data is never read.

## Installer (`installer/`)

    pwsh -File tests/installer/sidebyside.ps1 -New <new Setup.exe> -Old <old one-click Setup.exe> -Root <empty test folder>

Build both with `-c.appId=com.fox.sillytaverndesktop.test "-c.productName=ST Desktop Test"`, and the old one with `-c.nsis.oneClick=true` and an Open-with id of its own. Every install gets an explicit folder: a one-click default would be the real app's folder. It checks the folder page (suggestion, refused Windows folders, no admin prompt), install, update, uninstall, an old one-click install updating, moving to another folder, and that the real install is untouched.

## Writing helper (`writing-helper/`)

`lexcheck.cjs` and `audit.cjs` test the word engine. Put the public word lists (the Hunspell zip and `en_50k.txt` from the add-on's downloads) in a folder and set `ST_WORD_LISTS` to it. `maintest.cjs` runs `main.cjs` with a stand-in app.

`editor.mjs` times the frames around SillyTavern's big editor with the add-on off (the control) and on, in turns. `suite.mjs`, `heavy.mjs`, `stale.mjs` and `marks.mjs` drive a running test copy through its debug port (9444), with the add-on on and a page of a throwaway SillyTavern open. `quit.mjs` closes that copy through its inspector port (9244); set `ST_TEST_DATA` to its data folder so it can confirm it closed the right one.

Run `stale.mjs` before `suite.mjs` in a fresh test copy only if you restart in between: after `stale.mjs`, one `suite.mjs` check fails the same way with every version (state left behind). On a real install, `heavy.mjs` and `editor.mjs` take the test character's name and stop as soon as another character is open: the page can reload and open the last real chat.

## Rules

- Always use a separate `--user-data-dir` and a throwaway SillyTavern clone. Keep both off the C: drive where you can.
- Never run the installer on a PC where the app is installed for real: it replaces that copy.
- Never press Enter in SillyTavern's chat box in a test: it calls the AI provider.
