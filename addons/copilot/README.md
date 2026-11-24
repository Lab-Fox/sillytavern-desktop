# Co-pilot

An assistant in a side panel of the SillyTavern window, for SillyTavern Desktop. It will help with chat completion presets, character cards, personas, lorebooks and chats.

**This is an early version.** It can look things up in your SillyTavern by itself (cards, chats, presets, personas, lorebooks; each lookup shows as a line in the conversation), ask you when something is unclear, and propose changes, shown as cards. Changes to **character cards and lorebooks** can be applied with a click, and each one has Undo; changes to chats, personas and presets are shown only, for now.

## Use it

1. In the launcher: Extensions → Desktop add-ons → turn on **Co-pilot**.
2. Open SillyTavern and click the panel button in the window's top bar.
3. Pick the **Connection Profile** it should use (made in SillyTavern's Connection Manager). The line under it says where your messages go. Without a profile it uses SillyTavern's current Chat Completion connection.
4. Under the conversation, tick what the co-pilot should see: a new session starts with the last 20 messages of the open chat, its character's card and your persona. **+ Add** puts in other messages, cards, personas, chat completion presets or lorebooks. Each line shows its size in tokens, and the total says when it is too much for the profile. **Show request** shows exactly what the next message sends.
5. Write and press Enter (Shift+Enter for a new line). Stop ends a reply early.

## What to know

- Nothing changes until you click Apply (or Delete). Before each change the co-pilot keeps a copy of the file it touches. Undo puts the file back exactly as it was when nothing else changed it since; otherwise it puts back just that item, and if you changed that item too it shows both versions and lets you choose. Undoing a card the co-pilot made deletes the card but keeps any chats you had with it. Apply also refuses when the item changed after the co-pilot's card showed it.
- A change it can't apply cleanly (the text it wanted to replace is gone, the entry isn't there) is refused, and nothing is written.

- Your messages go to the AI provider of the profile you picked, from your own SillyTavern. What is sent: a short instruction for the co-pilot, what you ticked (read fresh each time), and the conversation in the panel. Your preset's prompts are only sent when you add that preset yourself; its sampler settings are always used.
- What you tick goes in marked as material to work on, not as instructions.
- It works on this PC's SillyTavern, the one the launcher uses. On other tabs (a read-only copy, another install, SillyTavern on another computer) the panel says so.
- Sessions are kept per SillyTavern folder, in this add-on's own folder (`user/sessions`), never in SillyTavern's chats.
