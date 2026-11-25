# Co-pilot

An assistant in a side panel of the SillyTavern window, for SillyTavern Desktop. It helps with chat completion presets, character cards, personas, lorebooks and chats.

It can look things up in your SillyTavern by itself (cards, chats, presets, personas, lorebooks; each lookup shows as a line in the conversation, and **Show what it read** shows what went back to the AI), ask you when something is unclear, and propose changes, shown as cards. Changes to **character cards, lorebooks, the open chat, personas and chat completion presets** can be applied with a click, and each one has Undo.

## Use it

1. In the launcher: Extensions → Desktop add-ons → turn on **Co-pilot**.
2. Open SillyTavern and click the panel button in the window's top bar.
3. Pick the **Connection Profile** it should use (made in SillyTavern's Connection Manager). The line under it says where your messages go. Without a profile it uses SillyTavern's current Chat Completion connection.
4. Under the conversation, tick what the co-pilot should see: a new session starts with the last 20 messages of the open chat, its character's card and your persona. **+ Add** puts in other messages, cards, personas, chat completion presets or lorebooks. Each line shows its size in tokens, and the total says when it is too much for the profile. **Show request** shows exactly what the next message sends.
5. Write and press Enter (Shift+Enter for a new line). Stop ends a reply early.

## What to know

- Nothing changes until you click Apply (or Delete). Before each change the co-pilot keeps a copy of the file it touches. Undo puts the file back exactly as it was when nothing else changed it since; otherwise it puts back just that item, and if you changed that item too it shows both versions and lets you choose. Undoing a card the co-pilot made deletes the card but keeps any chats you had with it. Apply also refuses when the item changed after the co-pilot's card showed it.
- **Chats:** changes go to the chat open in SillyTavern. They wait while SillyTavern writes a reply, while you edit a message, or when another chat is open, and Undo puts back just those messages, so you can keep chatting in between.
- **Personas and presets:** SillyTavern keeps these in its settings and saves them often, so Undo puts back just that persona or preset change, never the whole settings file. A new persona gets SillyTavern's default picture and isn't switched to. For the selected preset, a change is refused when SillyTavern has unsaved edits in that setting or prompt, and SillyTavern's controls show the change at once. The co-pilot can only change settings that shape the reply: never the connection, model, address, proxy, tools or the preset's regex scripts.
- A change it can't apply cleanly (the text it wanted to replace is gone, the entry isn't there) is refused, and nothing is written.
- **Apply all** takes a reply's changes at once: it lists them first and asks once. Deletes always need their own click, and so does a change your message didn't ask for: such a card says "not part of what you asked" (text the co-pilot reads, like a card or a chat, can carry instructions, and a model may follow them).
- **↺ Changes** lists what the co-pilot changed in this session, newest first, with Undo for each and **Undo everything from this session** (it stops at a change you also edited and lets you choose there). The copies Undo needs are kept 30 days or for the last 200 changes, whichever keeps more; you can change both there.

- Your messages go to the AI provider of the profile you picked, from your own SillyTavern. What is sent: a short instruction for the co-pilot, what you ticked (read fresh each time), and the conversation in the panel. Your preset's prompts are only sent when you add that preset yourself; its sampler settings are always used.
- What you tick goes in marked as material to work on, not as instructions.
- It works on this PC's SillyTavern, the one the launcher uses. On other tabs (a read-only copy, another install, SillyTavern on another computer) the panel says so.
- Sessions are kept per SillyTavern folder, in this add-on's own folder (`user/sessions`), never in SillyTavern's chats.
