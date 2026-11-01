# Writing helper

A desktop extension for [SillyTavern Desktop](https://github.com/Lab-Fox/sillytavern-desktop) 1.7.0 or newer. Install it from **Extensions → Desktop app → Get add-ons** in the launcher.

- **A dictionary of its own:** about 165,000 English words, plus an adult pack (explicit and slang words, on by default, can be turned off) and a roleplay pack (fantasy, anime and chat words). Your characters', personas' and groups' names and your lorebook keywords count as words too.
- **Your own words:** right-click a word in SillyTavern → **Add "word" to dictionary** (adds "word" and "Word"), **Add only "Kael"** (a name that always has its capital), **Ignore**, or **Remove from my dictionary**. Manage, import (`.txt`, Hunspell `.dic`) and export them in the add-on's panel.
- **Word suggestions** above the text box while you type: the endings of the word you're typing, the word that usually comes next, or corrections of a misspelled word (✎). **Tab** or **Alt+1** takes the first, **Alt+2** / **Alt+3** the others, **Esc** hides them.
- **Autocorrect** when you finish a word with a space or punctuation, only when it's clear what you meant: "teh" → "the", "dont" → "don't", "i" → "I", "THe" → "The", "alot" → "a lot", "wierd" → "weird". **Backspace right after** puts back what you typed (and leaves that word alone from then on). It never touches `{{macros}}`, links, `code`, words with digits, or capitalized words in the middle of a sentence (probably names), and it doesn't guess when your packs, names or dictionary have an equally close word ("cuming": coming or cumming?).
- **Learns how you write:** words and word pairs from what you send, and if you want, from your own messages in your newest 400 saved chats (never the characters' messages). Saved only in this add-on's folder; **Forget what it learned** deletes it.
- **Red underlines:** your words, the packs and the names count as spelled right in the spellchecker too. Windows' spellchecker only marks mistakes in languages installed in Windows; the panel can switch the app to its built-in English spellchecker (needs a restart).
- **Or Windows' own:** set "Suggestions and autocorrect from" to **Windows** to turn this off and use Windows' text suggestions (the panel opens Windows' typing settings).

## Word lists

Downloaded once when the add-on starts, from these exact files, and checked against their SHA256:

| List | Licence | Used for |
|---|---|---|
| [SCOWL / en-wl wordlist](https://github.com/en-wl/wordlist) `hunspell-en_US-large-2026.02.25.zip` | MIT-like (SCOWL's copyright notice) | Which words exist. Words SCOWL marks as offensive are accepted; plain vulgar ones may be suggested, slurs never are |
| [FrequencyWords](https://github.com/hermitdave/FrequencyWords) by Hermit Dave, `content/2018/en/en_50k.txt` | CC BY-SA 4.0 (from OpenSubtitles) | How common words are, to order suggestions. It doesn't make words "correct" (it has misspellings like "dont") |
| `packs/adult.txt`, `packs/roleplay.txt` | Written for this add-on | Words the dictionary lacks or never suggests. No slurs |

## Files

| File | |
|---|---|
| `main.cjs` | Runs in the app: word lists, your dictionary, names from SillyTavern, learning, right-click entries, panel calls |
| `lexicon.cjs` | The word engine (plain Node, testable without the app): zip reading, Hunspell affix expansion, completions, corrections, autocorrect rules |
| `page.js` | Runs in SillyTavern pages: the suggestion strip, autocorrect, Backspace undo |
| `panel.js` | The panel on the launcher's Extensions → Desktop app page |
| `user/` | Created when used: `words.json` (your words), `learned.json`, `spellchecker.json` (words given to the spellchecker). Kept when the add-on updates |
| `downloads/` | The downloaded word lists |

Build the zip for the add-on list with `node addons/build.cjs writing-helper` (from the app's folder).
