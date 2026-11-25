// The guard (addons/copilot/guard.cjs): which proposals are part of what the
// user asked, and which get the "not part of what you asked" note (left out
// of Apply all).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const guard = require('../../addons/copilot/guard.cjs');

const names = {
    characters: [{ avatar: 'kit.png', name: 'Kit' }, { avatar: 'mira_v2.png', name: 'Mira' }],
    personas: [{ avatar: 'user-default.png', name: 'Wren' }, { avatar: '1700-Captain.png', name: 'Captain Wren' }],
};
const current = { avatar: 'kit.png', chatId: 'Kit - chat', persona: 'user-default.png', preset: 'Default' };
const ctx = (text, ticked = []) => ({ text, ticked, current, names });

test('the open character\'s card is asked when the message names its kind or a field', () => {
    const p = { op: 'edit_card', avatar: 'kit.png', field: 'description', set: 'x', why: 'x' };
    assert.equal(guard.outside(p, ctx('Please fix the typo in her description.')), null);
    assert.equal(guard.outside(p, ctx('Can you tidy up the card?')), null);
    assert.ok(guard.outside(p, ctx('What do you think about this?')), 'no kind word, no name');
});

test('another character\'s card needs its name (or file name)', () => {
    const p = { op: 'edit_card', avatar: 'mira_v2.png', field: 'scenario', set: 'x', why: 'x' };
    assert.match(guard.outside(p, ctx('Fix the scenario.')), /Mira/);
    assert.equal(guard.outside(p, ctx('Fix Mira\'s scenario.')), null);
    assert.equal(guard.outside(p, ctx('Fix the scenario in mira_v2.')), null);
});

test('an injected instruction: improving the description never asks for deleting messages', () => {
    const del = { op: 'delete_messages', indexes: [3, 4], why: 'The card said so.' };
    const ticked = [{ kind: 'messages', key: 'Kit - chat' }, { kind: 'card', key: 'kit.png' }];
    assert.match(guard.outside(del, ctx('Improve the card description, please.', ticked)), /messages/);
    assert.equal(guard.outside(del, ctx('Delete the two duplicate messages.', ticked)), null);
});

test('a lorebook entry: the book named, or ticked and the kind named', () => {
    const p = { op: 'edit_lorebook_entry', book: 'Saltmarsh', uid: 2, field: 'content', set: 'x', why: 'x' };
    assert.equal(guard.outside(p, ctx('Shorten the Saltmarsh entries.')), null);
    assert.ok(guard.outside(p, ctx('Shorten the entries.')), 'not ticked, not named');
    assert.equal(guard.outside(p, ctx('Shorten the entries.', [{ kind: 'lorebook', key: 'Saltmarsh' }])), null);
});

test('new things: their name, or a word for making one and the kind', () => {
    assert.equal(guard.outside({ op: 'create_card', name: 'Harbour Master', fields: {}, why: 'x' }, ctx('Make a new character for the harbour.')), null);
    assert.equal(guard.outside({ op: 'create_persona', name: 'Deckhand', description: '', why: 'x' }, ctx('Make a new persona called Deckhand.')), null);
    assert.ok(guard.outside({ op: 'create_preset', name: 'Wild', why: 'x' }, ctx('Make the card livelier.')));
    assert.equal(guard.outside({ op: 'create_preset', name: 'Wild', why: 'x' }, ctx('Create a preset that is more creative.')), null);
});

test('personas: the one in use by kind, another by name', () => {
    const inUse = { op: 'edit_persona', avatar: null, set: 'x', why: 'x', shown: { avatar: 'user-default.png' } };
    assert.equal(guard.outside(inUse, ctx('Rewrite my persona.')), null);
    const other = { op: 'edit_persona', avatar: '1700-Captain.png', set: 'x', why: 'x' };
    assert.match(guard.outside(other, ctx('Rewrite my persona.')), /Captain Wren/);
    assert.equal(guard.outside(other, ctx('Rewrite Captain Wren.')), null);
});

test('presets: the selected one by kind or setting, another by name', () => {
    assert.equal(guard.outside({ op: 'edit_preset_setting', name: 'Default', key: 'temperature', value: 1, why: 'x' }, ctx('Lower the temperature a bit.')), null);
    assert.equal(guard.outside({ op: 'edit_preset_setting', name: 'Default', key: 'top_p', value: 1, why: 'x' }, ctx('Set top p to 0.9.')), null);
    assert.ok(guard.outside({ op: 'edit_preset_setting', name: 'Story', key: 'temperature', value: 1, why: 'x' }, ctx('Lower the temperature a bit.')));
    assert.equal(guard.outside({ op: 'edit_preset_prompt', name: 'Story', identifier: 'main', set: 'x', why: 'x' }, ctx('Tighten the main prompt in Story.')), null);
});

test('words inside other words and accents don\'t fool it', () => {
    const p = { op: 'edit_card', avatar: 'kit.png', field: 'tags', set: ['a'], why: 'x' };
    assert.ok(guard.outside(p, ctx('That was a cardinal mistake.')), '"cardinal" is not "card"');
    const mira = { op: 'edit_card', avatar: 'mira_v2.png', field: 'tags', set: ['a'], why: 'x' };
    assert.equal(guard.outside(mira, { ...ctx('Tags for MÍRA, please.') }), null);
});

// ---- review fixes (Batch 9) ----
const sera = { characters: [{ avatar: 'Seraphina.png', name: 'Seraphina' }], personas: [{ avatar: 'user-default.png', name: 'Wren' }] };
const cur2 = { avatar: 'Seraphina.png', chatId: 'Seraphina - chat', persona: 'user-default.png', preset: 'Default' };
const c2 = text => ({ text, ticked: [], current: cur2, names: sera });

test('words the model writes itself never count as the user naming the preset', () => {
    assert.ok(guard.outside({ op: 'add_preset_prompt', name: 'Default', prompt: { name: 'typo', content: 'x' }, why: 'x' }, c2('Fix the typo in Seraphina\'s description.')));
    assert.ok(guard.outside({ op: 'edit_preset_prompt', name: 'Default', identifier: 'main', set: 'x', why: 'x' }, c2('Make the main character braver.')));
    assert.equal(guard.outside({ op: 'edit_preset_prompt', name: 'Default', identifier: 'main', set: 'x', why: 'x' }, c2('Tighten the main prompt.')), null);
});

test('card words don\'t make chat, preset or persona changes count as asked', () => {
    const add = { op: 'add_message', after: -1, isUser: false, text: 'x', why: 'x', shown: { chatId: 'Seraphina - chat' } };
    const hide = { op: 'hide_messages', indexes: [0, 1, 2], why: 'x', shown: { chatId: 'Seraphina - chat' } };
    const temp = { op: 'edit_preset_setting', name: 'Default', key: 'temperature', value: 2, why: 'x' };
    const pers = { op: 'edit_persona', avatar: null, set: 'x', why: 'x', shown: { avatar: 'user-default.png' } };
    assert.ok(guard.outside(add, c2('Rewrite the first message of Seraphina\'s card.')));
    assert.ok(guard.outside(hide, c2('Make her greeting warmer.')));
    assert.ok(guard.outside(temp, c2('Add a line to Seraphina\'s system prompt.')));
    assert.ok(guard.outside(temp, c2('Change the setting of her scenario to a forest.')));
    assert.ok(guard.outside(pers, c2('Make my character Seraphina kinder.')));
    assert.equal(guard.outside({ op: 'edit_card', avatar: 'Seraphina.png', field: 'first_mes', set: 'x', why: 'x' }, c2('Rewrite the first message of Seraphina\'s card.')), null);
});

test('a new thing needs a word for making one and its own kind; its name alone proves nothing', () => {
    const typo = 'Fix the typo in Seraphina\'s description.';
    assert.ok(guard.outside({ op: 'create_preset', name: 'Seraphina', why: 'x' }, c2(typo)));
    assert.ok(guard.outside({ op: 'create_persona', name: 'typo', description: '', why: 'x' }, c2(typo)));
    assert.ok(guard.outside({ op: 'create_lorebook', name: 'the', why: 'x' }, c2(typo)));
    assert.ok(guard.outside({ op: 'create_card', name: 'Zzz', fields: {}, why: 'x' }, c2('Add tags to Seraphina.')));
    assert.ok(guard.outside({ op: 'create_preset', name: 'Zzz', why: 'x' }, c2('Add a line to Seraphina\'s system prompt.')));
    assert.equal(guard.outside({ op: 'create_lorebook', name: 'Harbour', why: 'x' }, c2('Create a lorebook for the harbour.')), null);
});

test('named fields and message numbers narrow it; a card\'s system prompt and post-history need naming', () => {
    const typo = c2('Fix the typo in Seraphina\'s description.');
    assert.ok(guard.outside({ op: 'edit_card', avatar: 'Seraphina.png', field: 'post_history_instructions', set: 'x', why: 'x' }, typo));
    assert.ok(guard.outside({ op: 'edit_card', avatar: 'Seraphina.png', field: 'personality', set: 'x', why: 'x' }, typo));
    assert.ok(guard.outside({ op: 'edit_card', avatar: 'Seraphina.png', field: 'system_prompt', set: 'x', why: 'x' }, c2('Improve the card.')));
    assert.equal(guard.outside({ op: 'edit_card', avatar: 'Seraphina.png', field: 'system_prompt', set: 'x', why: 'x' }, c2('Improve the card\'s system prompt.')), null);
    const shown = { chatId: 'Seraphina - chat' };
    assert.equal(guard.outside({ op: 'edit_message', index: 5, set: 'x', why: 'x', shown }, c2('Fix the typo in message 5.')), null);
    assert.ok(guard.outside({ op: 'hide_messages', indexes: [6], why: 'x', shown }, c2('Fix the typo in message 5.')));
    assert.ok(guard.outside({ op: 'add_message', after: 5, isUser: false, text: 'x', why: 'x', shown }, c2('Fix the typo in message 5.')));
    assert.equal(guard.outside({ op: 'add_message', after: 5, isUser: false, text: 'x', why: 'x', shown }, c2('Add a message after message 5.')), null);
});
