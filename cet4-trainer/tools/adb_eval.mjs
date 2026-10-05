/* 对 Android WebView 执行一段 JS（用 adb forward 出来的 devtools 端口）。
 *
 * 前置：
 *   adb forward tcp:9223 localabstract:webview_devtools_remote_<pid>
 *   （socket 名看 adb shell cat /proc/net/unix | grep webview_devtools）
 *
 * usage: node tools/adb_eval.mjs "JSON.stringify(store.state.settings)"
 *
 * 提示：Windows 的 PowerShell 会把命令行里的双引号吃掉，带引号的表达式走 argv 会被改坏。
 * 复杂表达式请塞进环境变量 EXPR：
 *   $env:EXPR = 'location.hash = "#settings"'; node tools/adb_eval.mjs
 */
const CDP = process.env.CDP || 'http://127.0.0.1:9223';
const expr = process.argv[2] || process.env.EXPR || 'document.title';

async function main() {
  const list = await (await fetch(CDP + '/json/list')).json();
  const pages = list.filter((x) => x.type === 'page');
  // 浏览器可能同时开着 edge://newtab、扩展页等；优先挑我们自己那个页面
  const want = process.env.MATCH || '';
  const t =
    pages.find((x) => want && x.url.includes(want)) ||
    pages.find((x) => x.url.startsWith('http://127.0.0.1')) ||
    pages.find((x) => x.url.startsWith('https://wordplan.local')) ||
    pages[0];
  if (!t) throw new Error('没有 page 目标');
  if (process.env.VERBOSE) console.error('目标：' + t.url);
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
