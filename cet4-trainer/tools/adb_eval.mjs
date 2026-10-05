/* 对 Android WebView 执行一段 JS（用 adb forward 出来的 devtools 端口）。
 *
 * 前置：
 *   adb forward tcp:9223 localabstract:webview_devtools_remote_<pid>
 *   （socket 名看 adb shell cat /proc/net/unix | grep webview_devtools）
 *
 * usage: node tools/adb_eval.mjs "JSON.stringify(store.state.settings)"
 */
const CDP = process.env.CDP || 'http://127.0.0.1:9223';
const expr = process.argv[2] || 'document.title';

async function main() {
  const list = await (await fetch(CDP + '/json/list')).json();
  const t = list.find((x) => x.type === 'page');
  if (!t) throw new Error('没有 page 目标');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  const out = await new Promise((resolve, reject) => {
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id === 1) {
        if (m.result && m.result.exceptionDetails) reject(new Error(JSON.stringify(m.result.exceptionDetails)));
        else resolve(m.result);
      }
    });
    ws.send(JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: { expression: expr, returnByValue: true, awaitPromise: true },
    }));
    setTimeout(() => reject(new Error('超时')), 15000);
  });
  const v = out && out.result ? out.result.value : out;
  console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 1));
  ws.close();
}

main().catch((e) => {
  console.error('失败：' + e.message);
  process.exit(1);
});
