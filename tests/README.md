# Tests

Everything here runs outside the app build (`package.json` lists the shipped files one by one).

## Quick check

    npm test

Checks the theme CSS checker with hostile samples. Needs nothing else.

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
    pwsh -File tests/app/portable-second.ps1 -Exe <portable exe> -Run <empty test folder>

`favicon` covers the tab icon (http, HTTPS, another site, too big, not a picture), `header` the page titles in every language, `underlines` the spellchecker on a new profile, `portable-second` a second launch of the portable.

## Writing helper (`writing-helper/`)

`lexcheck.cjs` and `audit.cjs` test the word engine. Put the public word lists (the Hunspell zip and `en_50k.txt` from the add-on's downloads) in a folder and set `ST_WORD_LISTS` to it. `maintest.cjs` runs `main.cjs` with a stand-in app.

`suite.mjs`, `heavy.mjs`, `stale.mjs` and `marks.mjs` drive a running test copy through its debug port (9444), with the add-on on and a page of a throwaway SillyTavern open. `quit.mjs` closes that copy through its inspector port (9244); set `ST_TEST_DATA` to its data folder so it can confirm it closed the right one.

## Rules

- Always use a separate `--user-data-dir` and a throwaway SillyTavern clone. Keep both off the C: drive where you can.
- Never run the installer on a PC where the app is installed for real: it replaces that copy.
- Never press Enter in SillyTavern's chat box in a test: it calls the AI provider.
