// Quits the test copy cleanly through its own inspector port (9244). Nothing else is touched.
const list = await (await fetch('http://127.0.0.1:9244/json/list')).json();
const ws = new WebSocket(list[0].webSocketDebuggerUrl);
await new Promise(r => { ws.onopen = r; });
ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { includeCommandLineAPI: true, expression: `(() => { const { app, BrowserWindow } = require('electron'); setTimeout(() => app.quit(), 300); return app.getPath('userData'); })()`, returnByValue: true } }));
const r = await new Promise(res => { ws.onmessage = m => res(JSON.parse(m.data)); });
const dir = r.result?.result?.value || '';
if (!process.env.ST_TEST_DATA || !dir.includes(process.env.ST_TEST_DATA)) console.log('WARNING: not the test profile');
ws.close();
await new Promise(r => setTimeout(r, 6000));
const still = await fetch('http://127.0.0.1:9244/json/list').then(() => true, () => false);
console.log(still ? 'still running' : 'test copy quit');
