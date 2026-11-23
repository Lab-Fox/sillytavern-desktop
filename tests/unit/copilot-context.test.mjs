// The co-pilot's context items (addons/copilot/context.cjs) against a stand-in
// SillyTavern page: no app, no SillyTavern.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const ctx = require('../../addons/copilot/context.cjs');

// A pretend page: a chat that can change between calls.
function fakePage({ messages = 30, chatId = 'chat-a' } = {}) {
    const state = { chatId, messages, calls: [] };
    const page = async (name, args = {}) => {
        state.calls.push([name, args]);
        if (name === 'context') return { chatId: state.chatId, characterName: 'Kit', characterAvatar: 'kit.png', groupId: null, messageCount: state.messages, userName: 'You' };
        if (name === 'chatMessages') {
            const out = [];
            for (let i = args.from; i <= Math.min(args.to, state.messages - 1); i++) out.push({ index: i, name: i % 2 ? 'You' : 'Kit', isUser: i % 2 === 1, isSystem: false, text: `message ${i}` });
            state.onRead?.();
            return { chatId: state.chatId, total: state.messages, messages: out };
        }
        if (name === 'tokenCounts') {
            const texts = args.texts.slice(0, 200); // the real page answers at most 200
            state.counted = (state.counted || 0) + texts.length;
            return { counts: texts.map(t => t.split(/\s+/).filter(Boolean).length) };
        }
        throw new Error(`unexpected ${name}`);
    };
    return { page, state };
}

test('another chat opened while reading is not sent under the old label', async () => {
    const { page, state } = fakePage({ messages: 1200 });
    const item = { id: 'x', kind: 'messages', ref: { chatId: 'chat-a', last: 1200 }, label: 'x', on: true };
    state.onRead = () => { state.chatId = 'chat-b'; }; // the user opens another chat after the first page
    await assert.rejects(() => ctx.resolve(page, item), /not the open chat/i);
});

test('token counts: more than 200 texts are all counted, none cached as 0', async () => {
    const { page } = fakePage();
    const count = ctx.counter(page);
    const texts = Array.from({ length: 450 }, (_, i) => `word ${i} and more`);
    const counts = await count(texts);
    assert.equal(counts.length, 450);
    assert.ok(counts.every(n => n === 4), JSON.stringify(counts.slice(195, 205)));
});

test('a growing chat only counts its new messages', async () => {
    const { page, state } = fakePage({ messages: 40 });
    const count = ctx.counter(page);
    const item = { id: 'x', kind: 'messages', ref: { chatId: 'chat-a', last: 20 }, label: 'x', on: true };
    const first = await ctx.measure(page, item, count);
    assert.ok(first.tokens > 0);
    const before = state.counted;
    state.messages = 41; // one new message
    const second = await ctx.measure(page, item, count);
    assert.ok(state.counted - before <= 2, `counted ${state.counted - before} more`); // the new line (and the label)
    assert.ok(second.tokens > 0);
});

test('the persona in use is labelled as such', async () => {
    const { page } = fakePage();
    const items = await ctx.defaults(page);
    assert.equal(items.find(i => i.kind === 'persona').label, 'Persona in use');
});
