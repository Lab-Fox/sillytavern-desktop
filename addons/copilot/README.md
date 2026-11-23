# Co-pilot

An assistant in a side panel of the SillyTavern window, for SillyTavern Desktop. It will help with chat completion presets, character cards, personas, lorebooks and chats.

**This is an early version: it only talks.** It can't read or change anything in SillyTavern yet; that comes in the next versions, with every change shown first, applied only when you click, and undoable.

## Use it

1. In the launcher: Extensions → Desktop add-ons → turn on **Co-pilot**.
2. Open SillyTavern and click the panel button in the window's top bar.
3. Pick the **Connection Profile** it should use (made in SillyTavern's Connection Manager). The line under it says where your messages go. Without a profile it uses SillyTavern's current Chat Completion connection.
4. Write and press Enter (Shift+Enter for a new line). Stop ends a reply early.

## What to know

- Your messages go to the AI provider of the profile you picked, from your own SillyTavern. Only the conversation in the panel is sent, with a short instruction for the co-pilot. Your preset's prompts are not sent; its sampler settings are.
- It works on this PC's SillyTavern, the one the launcher uses. On other tabs (a read-only copy, another install, SillyTavern on another computer) the panel says so.
- Sessions are kept per SillyTavern folder, in this add-on's own folder (`user/sessions`), never in SillyTavern's chats.
