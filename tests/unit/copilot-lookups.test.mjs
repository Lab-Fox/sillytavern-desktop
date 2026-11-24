// The co-pilot's lookups (addons/copilot/lookups.cjs) against a stand-in api.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const lookups = require('../../addons/copilot/lookups.cjs');

const apiWith = chats => ({ sillytavern: { page: async () => ({}), request: async () => chats } });

test('list_chats copes with old date formats and no chats folder', async () => {
    const r = await lookups.run(apiWith([
        { file_name: 'a.jsonl', chat_items: 4, file_size: '1 KB', last_mes: 'November 23, 2026 3:45pm' },
        { file_name: 'b.jsonl', chat_items: 9, file_size: '2 KB', last_mes: '2023-5-13 @14h 22m 31s 123ms' },
        { file_name: 'c.jsonl', chat_items: 1, file_size: '1 KB', last_mes: 1795431012781 },
    ]), [{ tool: 'list_chats', args: { avatar: 'kit.png' } }]);
    assert.ok(!/ERROR/.test(r.content), r.content);
    assert.match(r.content, /"count": 3/);
    const none = await lookups.run(apiWith({ error: true }), [{ tool: 'list_chats', args: { avatar: 'kit.png' } }]);
    assert.match(none.content, /"count": 0/);
});
