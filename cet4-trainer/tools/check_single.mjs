/* 验证「单文件离线 HTML」在 file:// 下真的能跑（安卓/离线场景）。
 * 需要一个带 --remote-debugging-port=9222 的 Edge。
 *
 * usage: node tools/check_single.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FILE = path.join(ROOT, 'dist', '词计划.html');
const url = pathToFileURL(FILE).href;
const CDP = process.env.CDP || 'http://127.0.0.1:9222';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openTarget(target) {
  const res = await fetch(`${CDP}/json/new?${encodeURIComponent(target)}`, { method: 'PUT' });
  if (!res.ok) throw new Error(`无法新建标签页：HTTP ${res.status}`);
  return res.json();
}

const target = await openTarget('about:blank');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});

let id = 0;
const pending = new Map();
const problems = [];
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message));
    else resolve(msg.result);
    return;
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    problems.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    problems.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  }
});

function send(method, params = {}) {
  const mid = ++id;
  return new Promise((resolve, reject) => {
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}

async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || '求值异常');
  return r.result.value;
}

await send('Runtime.enable');
await send('Page.enable');

const results = [];
const check = async (name, fn) => {
  try {
    const got = await fn();
    results.push({ name, ok: got === true || got === undefined, got });
  } catch (err) {
    results.push({ name, ok: false, got: err.message });
  }
};

/* 先把这个文件之前留下的进度清干净。
   注意：不能「先进页面再 localStorage.clear() 再 reload」——
   App 会在 pagehide 时 flush 内存状态，把刚清掉的进度又写回去。
   所以用 CDP 从浏览器层面清，再导航进去。 */
await send('Storage.clearDataForOrigin', { origin: 'file://', storageTypes: 'all' });
await send('Page.navigate', { url });
await sleep(3000);

await check('文件确实是从 file:// 打开的（不是 http）', async () => {
  const p = await evaluate('location.protocol');
  return p === 'file:' ? true : `protocol=${p}`;
});

await check('词库全部内嵌进 HTML（没有发网络请求）', async () => {
  const n = await evaluate('Object.keys(window.__EMBEDDED_DICTS || {}).length');
  return n === 10 ? true : `__EMBEDDED_DICTS 有 ${n} 份`;
});

await check('侧栏 10 个词库渲染出来', async () => {
  const n = await evaluate("document.querySelectorAll('#sidebar .deck-item').length");
  return n === 10 ? true : `deck-item = ${n}`;
});

await check('第一个词是 focus', async () => {
  await evaluate("location.hash = '#practice'");
  await sleep(800);
  const w = await evaluate("(document.querySelector('#wordLine')||{}).textContent");
  return String(w).trim() === 'focus' ? true : `wordLine = ${w}`;
});

await check('离线也能作答并立刻把进度写进 localStorage', async () => {
  await evaluate(`
    for (const k of ['f','o','c','u','s','Enter']) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    }
    true;
  `);
  await sleep(500);
  const raw = await evaluate("JSON.parse(localStorage.getItem('wordplan.v1')||'{}')");
  const ok = raw.progress && raw.progress.focus && raw.progress.focus.ok >= 1 && (raw.cursors || {}).week1 >= 1;
  return ok ? true : `progress=${JSON.stringify(raw.progress)} cursors=${JSON.stringify(raw.cursors)}`;
});

await check('没有 JS 报错', async () => {
  return problems.length === 0 ? true : problems.join(' | ');
});

let pass = 0;
for (const r of results) {
  if (r.ok) pass += 1;
  console.log(`${r.ok ? '  ok  ' : ' FAIL '} ${r.name}${r.ok ? '' : `  → ${r.got}`}`);
}
console.log(`\n${pass}/${results.length} 通过`);

ws.close();
await fetch(`${CDP}/json/close/${target.id}`).catch(() => {});
process.exit(pass === results.length ? 0 : 1);
