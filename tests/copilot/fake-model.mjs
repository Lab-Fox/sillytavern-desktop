// A stand-in for an AI provider: an OpenAI-compatible server on localhost that
// answers with scripted replies and records what it was sent. Tests use it so
// nothing ever reaches a real provider.
//   const m = await start({ port: 20130 });
//   m.reply({ text: 'Hello there', chunks: 3, delayMs: 50 });  // next request
//   m.reply({ status: 500, error: 'boom' });
//   m.requests  → [{ body, closedEarly }]
import http from 'http';

export async function start({ port = 20130 } = {}) {
    const script = [];
    const requests = [];
    const server = http.createServer(async (req, res) => {
        if (req.method === 'GET' && /\/models$/.test(req.url)) {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ object: 'list', data: [{ id: 'fake-model', object: 'model' }] }));
            return;
        }
        if (req.method !== 'POST' || !/\/chat\/completions$/.test(req.url)) { res.writeHead(404); res.end(); return; }
        let raw = '';
        for await (const c of req) raw += c;
        let body = {};
        try { body = JSON.parse(raw); } catch { /* recorded as is */ }
        const entry = { body, closedEarly: false };
        requests.push(entry);
        const next = script.shift() || { text: 'OK' };
        if (next.status) {
            res.writeHead(next.status, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: { message: next.error || 'error' } }));
            return;
        }
        const text = String(next.text ?? '');
        if (!body.stream) {
            await new Promise(r => setTimeout(r, next.delayMs || 0));
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ id: 'fake', object: 'chat.completion', model: 'fake-model', choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }] }));
            return;
        }
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
        let gone = false;
        res.on('close', () => { if (!res.writableFinished) { gone = true; entry.closedEarly = true; } });
        const n = Math.max(1, next.chunks || 1);
        const size = Math.ceil(text.length / n);
        for (let i = 0; i < n && !gone; i++) {
            const part = text.slice(i * size, (i + 1) * size);
            res.write(`data: ${JSON.stringify({ id: 'fake', object: 'chat.completion.chunk', model: 'fake-model', choices: [{ index: 0, delta: { content: part }, finish_reason: null }] })}\n\n`);
            await new Promise(r => setTimeout(r, next.delayMs || 0));
        }
        if (gone) return;
        res.write(`data: ${JSON.stringify({ id: 'fake', object: 'chat.completion.chunk', model: 'fake-model', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
        res.end('data: [DONE]\n\n');
    });
    await new Promise(r => server.listen(port, '127.0.0.1', r));
    return {
        url: `http://127.0.0.1:${port}/v1`,
        requests,
        reply: item => { script.push(item); },
        close: () => new Promise(r => { server.closeAllConnections?.(); server.close(r); }),
    };
}
