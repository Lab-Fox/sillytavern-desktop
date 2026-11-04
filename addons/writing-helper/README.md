# Writing helper

A desktop extension for [SillyTavern Desktop](https://github.com/Lab-Fox/sillytavern-desktop) 1.7.0 or newer. Install it from **Extensions → Desktop add-ons → Get add-ons** in the launcher.

- **A dictionary of its own:** about 165,000 English words, plus an adult pack (explicit and slang words, on by default, can be turned off) and a roleplay pack (fantasy, anime and chat words). Your characters', personas' and groups' names and your lorebook keywords count as words too.
- **Your own words:** right-click a word in SillyTavern → **Add "word" to dictionary** (adds "word" and "Word"), **Add only "Kael"** (a name that always has its capital), **Ignore**, or **Remove from my dictionary**. Manage, import (`.txt`, Hunspell `.dic`) and export them in the add-on's panel.
- **A word you don't want suggested** (picked by mistake, learned wrong, or autocorrected to wrongly): select it, right-click → **Never suggest "word"**. It stays spelled right, but it's never suggested, completed or autocorrected to again, and what the add-on learned about it is forgotten. **Suggest "word" again** (same menu) or the × in the panel's list undoes it.
- **Word suggestions** next to the text cursor while you type, in every SillyTavern text box, one-line field and popup (also the expanded editors). Fields for code, keys and addresses get none. They are the endings of the word you're typing, the word that usually comes next, or corrections of a misspelled word (✎).
- **Picking a word, like Windows' own suggestions:** **↑** moves into the suggestions, **←** / **→** choose, **Enter** takes the word, **↓** goes back to typing (or just keep typing), **Esc** hides them; **Alt+1** / **Alt+2** / **Alt+3** take a word right away, or click it. Enter only takes a word after ↑, so it still sends your message. The panel has a "Tab takes the first" preset and lets you set your own keys for each step (up to three each), and warns about keys SillyTavern or the app already use (Enter sends, Ctrl+↑ edits your last message, Ctrl+PgUp switches tabs…) or that would be taken twice.
- **Explicit words, in their own row or first in an explicit scene** (with the adult words on):
  - **Second row of explicit words** (off by default): up to three explicit words above the normal three, marked 18+. **↑** twice reaches them (**↓** comes back), or **Alt+4** / **Alt+5** / **Alt+6**.
  - **Notice explicit scenes** (on): when the message you're writing and the last three chat messages on screen are clearly explicit, explicit words move up into the normal row (it shows an 18+ mark). It only looks at the latest text, so it fades as soon as the scene moves on. Ordinary words that are common in such scenes ("lips", "thighs") count only a little.
- **Autocorrect** when you finish a word with a space or punctuation, only when it's clear what you meant: "teh" → "the", "dont" → "don't", "i" → "I", "THe" → "The", "alot" → "a lot", "wierd" → "weird". **Backspace right after** puts back what you typed (and leaves that word alone from then on). It never touches `{{macros}}`, links, `code`, words with digits, or capitalized words in the middle of a sentence (probably names), and it doesn't guess when your packs, names or dictionary have an equally close word ("cuming": coming or cumming?).
- **Predicts like a phone keyboard:**
  - **The next word** right after a space, from which words usually follow which: in books (a table of word pairs counted in public-domain books), in what you write, and in the story on screen.
  - **The story on screen:** words and names from the last three chat messages and the message you're writing come first, including ones no dictionary has (a capitalized name counts at once, other words once they appear twice).
  - **Typos at the start of a word:** "chco" still suggests "chocolate", "tje" → "the"; neighbouring keys and swapped letters count as the likely mistakes.
- **Learns how you write:** words and word pairs from what you send, also new words of your own (names, made-up words) once you've written them twice; written three times, autocorrect leaves them alone. If you want, it also learns from your own messages in your newest 400 saved chats, and with **Also learn from the characters' messages** from theirs too (the words and phrasing of your stories). Saved only in this add-on's folder; **Forget what it learned** deletes it.
- **Red underlines:** your words, the packs and the names count as spelled right in the spellchecker too. Windows' spellchecker only marks mistakes in languages installed in Windows; the panel can switch the app to its built-in English spellchecker (needs a restart).
- **One box at a time:** Windows 11 can show its own text suggestions too. With "Suggestions and autocorrect from" set to **This add-on**, Windows' box stays hidden in SillyTavern (the field in use tells Windows it's a search field, `inputmode="search"`, which only changes the touch keyboard's layout). **Windows** turns this add-on's suggestions and autocorrect off and leaves Windows' box alone (the panel says whether it's on in Windows and opens Windows' typing settings). **Off** hides both.

## Word lists

Downloaded once when the add-on starts, from these exact files, and checked against their SHA256:

| List | Licence | Used for |
|---|---|---|
| [SCOWL / en-wl wordlist](https://github.com/en-wl/wordlist) `hunspell-en_US-large-2026.02.25.zip` | MIT-like (SCOWL's copyright notice) | Which words exist. Words SCOWL marks as offensive are accepted; plain vulgar ones may be suggested, slurs never are |
| [FrequencyWords](https://github.com/hermitdave/FrequencyWords) by Hermit Dave, `content/2018/en/en_50k.txt` | CC BY-SA 4.0 (from OpenSubtitles) | How common words are, to order suggestions. It doesn't make words "correct" (it has misspellings like "dont") |
| `data/pairs.txt.gz` (in the add-on, 315 KB) | Counted from public-domain books ([Project Gutenberg](https://www.gutenberg.org/)): Frankenstein, Dracula, Jane Eyre, Wuthering Heights, A Tale of Two Cities, Great Expectations, The Picture of Dorian Gray, The Adventures of Sherlock Holmes, Alice's Adventures in Wonderland, The Wonderful Wizard of Oz, A Princess of Mars, Treasure Island, Little Women, Anne of Green Gables, The War of the Worlds, The Time Machine, Huckleberry Finn, The Call of the Wild, Emma, Sense and Sensibility, Persuasion, Peter Pan, Gulliver's Travels, Grimms' Fairy Tales, The Count of Monte Cristo, The Sign of the Four, A Study in Scarlet, The Valley of Fear, The Three Musketeers, The Hound of the Baskervilles | Which word usually follows which (the 40 most common next words of the 25,000 most common words). Made with `node addons/tools/build-pairs.cjs <out> <books…>` |
| `packs/adult.txt`, `packs/roleplay.txt` | Written for this add-on | Words the dictionary lacks or never suggests. No slurs |
| `packs/adult-context.txt` | Written for this add-on | Ordinary words common in explicit scenes: "strong" ones count fully and join the explicit row, "mild" ones only count a little |

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
