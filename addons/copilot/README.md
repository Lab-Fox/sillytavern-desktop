# Co-pilot

An assistant in a side panel of the SillyTavern window, for SillyTavern Desktop. It will help with chat completion presets, character cards, personas, lorebooks and chats.

**This is an early version: it reads and proposes, but changes nothing yet.** It can look things up in your SillyTavern by itself (cards, chats, presets, personas, lorebooks; each lookup shows as a line in the conversation), ask you when something is unclear, and propose changes, which it shows as cards. Applying them comes in the next versions, each one with a click and undoable.

## Use it

1. In the launcher: Extensions → Desktop add-ons → turn on **Co-pilot**.
2. Open SillyTavern and click the panel button in the window's top bar.
3. Pick the **Connection Profile** it should use (made in SillyTavern's Connection Manager). The line under it says where your messages go. Without a profile it uses SillyTavern's current Chat Completion connection.
4. Under the conversation, tick what the co-pilot should see: a new session starts with the last 20 messages of the open chat, its character's card and your persona. **+ Add** puts in other messages, cards, personas, chat completion presets or lorebooks. Each line shows its size in tokens, and the total says when it is too much for the profile. **Show request** shows exactly what the next message sends.
5. Write and press Enter (Shift+Enter for a new line). Stop ends a reply early.

## What to know

- Your messages go to the AI provider of the profile you picked, from your own SillyTavern. What is sent: a short instruction for the co-pilot, what you ticked (read fresh each time), and the conversation in the panel. Your preset's prompts are only sent when you add that preset yourself; its sampler settings are always used.
- What you tick goes in marked as material to work on, not as instructions.
- It works on this PC's SillyTavern, the one the launcher uses. On other tabs (a read-only copy, another install, SillyTavern on another computer) the panel says so.
- Sessions are kept per SillyTavern folder, in this add-on's own folder (`user/sessions`), never in SillyTavern's chats.
