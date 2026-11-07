// CDP helper for the page tests.
export async function connect(match = process.env.ST || 'localhost:8123', port = 9444) {
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const t = list.find(x => x.type === 'page' && x.url.includes(match));
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const wait = new Map();
  ws.onmessage = m => { const d = JSON.parse(m.data); if (wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); } };
  await new Promise(r => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true, userGesture: true, replMode: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || JSON.stringify(r.result.exceptionDetails)); return r.result.result.value; };
  const key = async (key, code = key, vk = 0, mods = 0) => { for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: vk, modifiers: mods }); };
  return { send, ev, key, close: () => ws.close(), sleep: ms => new Promise(r => setTimeout(r, ms)) };
}
