// The co-pilot's reply format (addons/copilot/protocol.cjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const p = require('../../addons/copilot/protocol.cjs');

test('plain reply', () => {
    const r = p.parse('{"say":"Hello there."}');
    assert.equal(r.ok, true);
    assert.equal(r.reply.say, 'Hello there.');
    assert.deepEqual(r.reply.lookups, []);
    assert.deepEqual(r.reply.proposals, []);
    assert.equal(r.reply.ask, null);
});

test('fenced and with prose around', () => {
    const r = p.parse('Sure! Here it is:\n```json\n{"say":"A {brace} inside \\"quotes\\".", "lookups": []}\n```\nHope that helps.');
    assert.equal(r.ok, true, r.error);
    assert.equal(r.reply.say, 'A {brace} inside "quotes".');
});

test('lookups validated', () => {
    const r = p.parse(JSON.stringify({ say: 'Let me look.', lookups: [{ tool: 'read_card', args: { avatar: 'kit.png' } }, { tool: 'list_lorebooks' }, { tool: 'read_messages', args: { from: 0, to: 10 } }] }));
    assert.equal(r.ok, true, r.error);
    assert.equal(r.reply.lookups.length, 3);
    assert.deepEqual(r.reply.lookups[1], { tool: 'list_lorebooks', args: {} });
    const bad = p.parse(JSON.stringify({ say: '', lookups: [{ tool: 'read_card', args: {} }] }));
    assert.equal(bad.ok, false);
    assert.match(bad.error, /avatar/);
});

test('unknown tool refused', () => {
    const r = p.parse(JSON.stringify({ say: '', lookups: [{ tool: 'delete_everything', args: {} }] }));
    assert.equal(r.ok, false);
    assert.match(r.error, /unknown tool/i);
});

test('proposal shapes', () => {
    const good = p.parse(JSON.stringify({ say: 'Here is a fix.', proposals: [
        { op: 'edit_card', avatar: 'kit.png', field: 'description', find: 'old text', replace: 'new text', why: 'Typo.' },
        { op: 'edit_lorebook_entry', book: 'Lore', uid: 3, field: 'content', set: 'New content.', why: 'Clearer.' },
        { op: 'delete_messages', indexes: [4, 5], why: 'Duplicates.' },
        { op: 'edit_preset_setting', name: 'Default', key: 'temperature', value: 0.8, why: 'Less random.' },
    ] }));
    assert.equal(good.ok, true, good.error);
    assert.equal(good.reply.proposals.length, 4);
    const both = p.parse(JSON.stringify({ say: '', proposals: [{ op: 'edit_card', avatar: 'kit.png', field: 'description', find: 'a', replace: 'b', set: 'c', why: 'x' }] }));
    assert.equal(both.ok, false, 'find/replace and set at once');
    const field = p.parse(JSON.stringify({ say: '', proposals: [{ op: 'edit_card', avatar: 'kit.png', field: 'avatar_image', set: 'x', why: 'x' }] }));
    assert.equal(field.ok, false);
    assert.match(field.error, /field/);
    const op = p.parse(JSON.stringify({ say: '', proposals: [{ op: 'run_shell', why: 'x' }] }));
    assert.equal(op.ok, false);
    assert.match(op.error, /unknown op/i);
});

test('lookups with proposals refused', () => {
    const r = p.parse(JSON.stringify({ say: '', lookups: [{ tool: 'list_lorebooks' }], proposals: [{ op: 'create_lorebook', name: 'X', why: 'x' }] }));
    assert.equal(r.ok, false);
    assert.match(r.error, /lookups/i);
});

test('ask with choices', () => {
    const r = p.parse(JSON.stringify({ say: 'Which one?', ask: { question: 'Which card?', choices: ['Kit', 'Ash'] } }));
    assert.equal(r.ok, true, r.error);
    assert.deepEqual(r.reply.ask, { question: 'Which card?', choices: ['Kit', 'Ash'] });
    // without a question it is no ask at all
    assert.equal(p.parse(JSON.stringify({ say: '', ask: { choices: ['a'] } })).reply.ask, null);
    assert.equal(p.parse(JSON.stringify({ say: '', ask: { question: 'Q', choices: 'a' } })).ok, false);
});

test('not JSON at all', () => {
    const r = p.parse('I think the card is fine, no changes needed.');
    assert.equal(r.ok, false);
    assert.match(r.error, /JSON/);
    assert.match(p.retryMessage(r.error), /JSON/);
    assert.equal(p.parse('{"say": 5}').ok, false);
});

test('partial say while streaming', () => {
    assert.equal(p.partialSay(''), '');
    assert.equal(p.partialSay('{"sa'), '');
    assert.equal(p.partialSay('{"say": "Hel'), 'Hel');
    assert.equal(p.partialSay('{"say": "Line one\\nand \\"two\\" \\u00e9'), 'Line one\nand "two" é');
    assert.equal(p.partialSay('```json\n{"lookups": [], "say": "Done."}'), 'Done.');
    assert.equal(p.partialSay('{"say": "ends with a backslash \\'), 'ends with a backslash ');
});

test('limits', () => {
    const many = Array.from({ length: 9 }, () => ({ tool: 'list_lorebooks' }));
    assert.equal(p.parse(JSON.stringify({ say: '', lookups: many })).ok, false);
    const props = Array.from({ length: 21 }, (_, i) => ({ op: 'create_lorebook', name: `B${i}`, why: 'x' }));
    assert.equal(p.parse(JSON.stringify({ say: '', proposals: props })).ok, false);
});

test('the system prompt lists every tool and op', () => {
    const s = p.systemPrompt();
    for (const t of Object.keys(p.TOOLS)) assert.ok(s.includes(t), t);
    for (const o of Object.keys(p.OPS)) assert.ok(s.includes(o), o);
    assert.match(s, /<data>/);
});

test('forgiving where nothing can go wrong', () => {
    // arguments written next to the tool instead of in "args"
    const r = p.parse(JSON.stringify({ say: 'Looking.', lookups: [{ tool: 'read_lorebook', name: 'Saltmarsh' }] }));
    assert.equal(r.ok, true, r.error);
    assert.deepEqual(r.reply.lookups[0], { tool: 'read_lorebook', args: { name: 'Saltmarsh' } });
    // an empty ask is no ask
    const a = p.parse(JSON.stringify({ say: 'Done reading.', proposals: [], ask: { question: null } }));
    assert.equal(a.ok, true, a.error);
    assert.equal(a.reply.ask, null);
});

test('the prompt says proposals are not done', () => {
    assert.match(p.systemPrompt(), /never say .*done|not done/i);
});

test('a question, lookups or proposals without "say" are still a reply', () => {
    const r = p.parse(JSON.stringify({ ask: { question: 'Which one?', choices: ['a.png', 'b.png'] } }));
    assert.equal(r.ok, true, r.error);
    assert.equal(r.reply.say, '');
    assert.equal(p.parse('{"other": 1}').ok, false);
});

test('the prompt asks to read before changing and to ask about same names', () => {
    const s = p.systemPrompt();
    assert.match(s, /look it up first|read it first/i);
    assert.match(s, /same name/i);
});

test('names that exist on every JavaScript object are refused, not crashed on', () => {
    for (const bad of [
        { say: '', lookups: [{ tool: 'constructor' }] },
        { say: '', proposals: [{ op: 'toString', why: 'x' }] },
        { say: '', proposals: [{ op: 'edit_card', avatar: 'a.png', field: 'constructor', set: 'x', why: 'x' }] },
        { say: '', proposals: [{ op: 'edit_lorebook_entry', book: 'B', uid: 1, field: 'hasOwnProperty', set: 'x', why: 'x' }] },
    ]) {
        let r;
        assert.doesNotThrow(() => { r = p.parse(JSON.stringify(bad)); });
        assert.equal(r.ok, false, JSON.stringify(bad));
    }
});

test('a broken outer object never lets an inner one through', () => {
    const inner = '{"say":"hi","proposals":[{"op":"create_card","name":"X","fields":{"say":"inner","lookups":[{"tool":"list_presets"}]},"why":"x"}],}';
    assert.equal(p.parse(inner).ok, false);
    // two replies in one answer: unclear which one counts
    assert.equal(p.parse('Like this: {"say":"example"} and my answer: {"say":"real"}').ok, false);
});

test('a huge or brace-filled reply is handled quickly', () => {
    let t = Date.now();
    assert.equal(p.parse('{'.repeat(40000)).ok, false);
    assert.equal(p.parse('{"a":'.repeat(40000)).ok, false);
    assert.ok(Date.now() - t < 500, `${Date.now() - t} ms`);
    t = Date.now();
    const big = JSON.stringify({ say: 'x'.repeat(100000) });
    const r = p.parse(big);
    assert.equal(r.ok, false);
    assert.match(r.error, /too long/i);
});

test('choices are short answers, sent framed as answers', () => {
    const r = p.parse(JSON.stringify({ say: '', ask: { question: 'Which?', choices: ['Kit', 'x'.repeat(200), 'Ash'] } }));
    assert.deepEqual(r.reply.ask.choices, ['Kit', 'Ash']);
    assert.equal(p.answerText('Which card?', 'Kit'), '(My answer to "Which card?": Kit)');
});

test('older lookup results go back only as their summary', () => {
    const msgs = [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'Looking.', raw: '{"say":"Looking.","lookups":[{"tool":"list_presets"}]}', lookups: [{ tool: 'list_presets' }] },
        { role: 'lookup', content: '<lookup_results>\nBIG RESULT\n</lookup_results>', summary: ['Listed presets'] },
        { role: 'assistant', content: 'Two presets.', raw: '{"say":"Two presets."}' },
        { role: 'user', content: 'second' },
        { role: 'assistant', content: 'Again.', raw: '{"say":"Again.","lookups":[{"tool":"list_lorebooks"}]}', lookups: [{ tool: 'list_lorebooks' }] },
        { role: 'lookup', content: '<lookup_results>\nNEW RESULT\n</lookup_results>', summary: ['Listed lorebooks'] },
        { role: 'assistant', content: 'Partial', stopped: true },
        { role: 'assistant', content: '', invalid: true, raw: 'prose' },
    ];
    const h = p.history(msgs);
    const text = h.map(m => m.content).join('\n');
    assert.ok(!text.includes('BIG RESULT'), 'old result left out');
    assert.ok(text.includes('Listed presets'), 'its summary kept');
    assert.ok(text.includes('NEW RESULT'), 'this turn keeps its results');
    assert.ok(!text.includes('prose'));
    // a stopped reply without raw goes back in the format, not as prose
    assert.ok(h.some(m => m.role === 'assistant' && m.content === JSON.stringify({ say: 'Partial' })));
});
