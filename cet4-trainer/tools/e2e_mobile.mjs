/* 词计划 · 移动端（触摸设备）端到端测试
   目的：桌面 e2e 测不到手机上的两个致命点 ——
     ① 没有物理键盘时，能不能弹出软键盘并把字打进去（靠那个隐形 <input>）；
     ② 窄屏下顶栏按钮会不会被压成一个字一行。
   做法：用 CDP 模拟 coarse pointer + 手机视口，然后「假装自己是输入法」，
        直接把值写进 #wpTypeInput 并派发 input 事件 —— 这正是 Android 输入法的真实行为。

   用法（同 e2e.mjs）：先起 server.mjs，再起带 --remote-debugging-port=9222 的 Edge，
        然后 node tools/e2e_mobile.mjs
*/
const CDP = process.env.CDP || 'http://127.0.0.1:9222';
const APP = process.env.APP || 'http://127.0.0.1:5199/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const targets = await (await fetch(`${CDP}/json/list`)).json();
const target = targets.find((t) => t.type === 'page');
if (!target) { console.error('未找到 page target'); process.exit(1); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let seq = 0;
const pending = new Map();
const problems = [];

function isOurs(params) {
  const url = params?.exceptionDetails?.url || '';
  const stack = params?.exceptionDetails?.exception?.description || '';
  const frames = params?.stackTrace?.callFrames || [];
  const where = [url, stack, ...frames.map((f) => f.url || '')].join(' ');
  return !where.includes('chrome-extension://') && !where.includes('extension://');
}

ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(JSON.stringify(msg.error)));
    else resolve(msg.result);
    return;
  }
  if (msg.method === 'Runtime.exceptionThrown' && isOurs(msg.params)) {
    problems.push(`JS 异常: ${msg.params.exceptionDetails.text} ${msg.params.exceptionDetails.exception?.description || ''}`);
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    const stack = msg.params.stackTrace?.callFrames?.map((f) => f.url || '').join(' ') || '';
    if (stack.includes('chrome-extension://')) return;
    problems.push(`console.error: ${msg.params.args.map((a) => a.value ?? a.description).join(' ')}`);
  }
});

function send(method, params = {}) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) {
    throw new Error(`页面求值异常：${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
  }
  return r.result.value;
}

const results = [];
async function check(name, fn) {
  try {
    const got = await fn();
    results.push({ name, ok: got === true || got === undefined, got });
  } catch (err) {
    results.push({ name, ok: false, got: err.message });
  }
}

await send('Runtime.enable');
await send('Page.enable');

/* ------------------------------------------------- 先把这台「浏览器」变成手机 */

await send('Emulation.setDeviceMetricsOverride', {
  width: 360, height: 740, deviceScaleFactor: 3, mobile: true,
});
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
// 这一条才是 matchMedia('(pointer: coarse)') 的真正开关
await send('Emulation.setEmulatedMedia', {
  features: [
    { name: 'pointer', value: 'coarse' },
    { name: 'any-pointer', value: 'coarse' },
    { name: 'hover', value: 'none' },
  ],
});

/* 同源但不加载 App 的页面里重置存储（App 的 pagehide flush 会覆盖内存态） */
await send('Page.navigate', { url: `${APP}__seed__` });
await sleep(900);
await evaluate(`
  localStorage.clear();
  localStorage.setItem('wordplan.v1', JSON.stringify({
    version: 1, deckId: 'week1', mode: 'typing', scope: 'all', order: 'book', limit: 50,
    settings: { autoNext: false, autoSpeak: false, speakMeaning: 'brief', theme: 'light', accent: 'us', rate: 0.9, trimTrans: false },
  }));
  true;
`);

await send('Page.navigate', { url: `${APP}#practice` });
await sleep(2200);

/* 假装自己是手机输入法：改值 + 派发 input（Android IME 就是这样把字送进来的） */
await evaluate(`
  window.__ime = (text) => {
    const inp = document.getElementById('wpTypeInput');
    if (!inp) return 'no-input';
    inp.value = text;
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    return 'ok';
  };
  window.__glyphs = () => [...document.querySelectorAll('#typeLine .glyph')].map((g) => (g.classList.contains('done') ? 'ok' : 'bad'));
  window.__box = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; };
  true;
`);

/* ------------------------------------------------------------------ 断言 */

await check('模拟出 coarse pointer（触摸设备）', async () =>
  (await evaluate(`matchMedia('(pointer: coarse)').matches`)) === true);

await check('页面里存在那个隐形 <input>（软键盘的把手）', async () =>
  (await evaluate(`!!document.getElementById('wpTypeInput')`)) === true);

await check('隐形输入框不可见但可聚焦', async () => {
  const r = await evaluate(`(() => {
    const i = document.getElementById('wpTypeInput');
    const cs = getComputedStyle(i);
    return { opacity: cs.opacity, display: cs.display, fontSize: cs.fontSize };
  })()`);
  if (r.opacity !== '0' || r.display === 'none') throw new Error(JSON.stringify(r));
  // <16px 会被 iOS 强制放大页面
  if (parseFloat(r.fontSize) < 16) throw new Error(`font-size ${r.fontSize} < 16px`);
  return true;
});

await check('出现「提交」按钮（触摸设备没有 Enter 键）', async () =>
  (await evaluate(`(document.querySelector('[data-act="submit"]')||{}).textContent?.trim()`)) === '提交');

await check('点输入行会把焦点交给隐形输入框（＝唤起软键盘）', async () => {
  await evaluate(`document.getElementById('typeLine').click(); true`);
  await sleep(150);
  const id = await evaluate(`document.activeElement && document.activeElement.id`);
  if (id !== 'wpTypeInput') throw new Error(`activeElement = ${id}`);
  return true;
});

await check('输入法敲 focus → 5 个字母、全部判绿', async () => {
  await evaluate(`window.__ime('focus'); true`);
  await sleep(150);
  const g = await evaluate(`window.__glyphs()`);
  if (g.length !== 5) throw new Error(`glyph 数 ${g.length}：${JSON.stringify(g)}`);
  if (g.some((x) => x !== 'ok')) throw new Error(JSON.stringify(g));
  return true;
});

await check('输入法敲 foxus → 第 3 个字母判红', async () => {
  await evaluate(`window.__ime('foxus'); true`);
  await sleep(150);
  const g = await evaluate(`window.__glyphs()`);
  if (JSON.stringify(g) !== JSON.stringify(['ok', 'ok', 'bad', 'ok', 'ok'])) throw new Error(JSON.stringify(g));
  return true;
});

await check('输入法改回 focus 后点「提交」→ 判定正确', async () => {
  await evaluate(`window.__ime('focus'); true`);
  await sleep(150);
  await evaluate(`document.querySelector('[data-act="submit"]').click(); true`);
  await sleep(300);
  const txt = await evaluate(`document.getElementById('fb').textContent`);
  if (!txt.includes('正确')) throw new Error(txt);
  return true;
});

await check('提交后按钮变成「继续 →」', async () =>
  (await evaluate(`document.querySelector('[data-act="submit"]').textContent.trim()`)) === '继续 →');

await check('顶栏按钮没有被压成一个字一行', async () => {
  const boxes = await evaluate(`[...document.querySelectorAll('.nav button')].map((b) => { const r = b.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), t: b.textContent.trim() }; })`);
  for (const b of boxes) {
    if (b.h > 44) throw new Error(`「${b.t}」高 ${b.h}px，说明换行了`);
    if (b.w < 34) throw new Error(`「${b.t}」宽 ${b.w}px，太窄`);
  }
  return true;
});

await check('窄屏隐藏「今日」胶囊给顶栏让位', async () =>
  (await evaluate(`getComputedStyle(document.getElementById('todayChip')).display`)) === 'none');

await check('提示语不再念快捷键（<kbd> 已消失）', async () => {
  // 先进入下一个词，回到「作答中」状态再看提示语
  // （判分后 360ms 内「继续 →」会被防连点冷却吃掉，所以先等一下）
  await sleep(450);
  await evaluate(`document.querySelector('[data-act="submit"]').click(); true`);
  await sleep(500);
  const r = await evaluate(`(() => { const fb = document.getElementById('fb'); return { kbd: fb.querySelectorAll('kbd').length, text: fb.textContent }; })()`);
  if (r.kbd !== 0) throw new Error(`还有 ${r.kbd} 个 <kbd>`);
  if (!r.text.includes('提交')) throw new Error(r.text);
  return true;
});

await check('侧栏提示语也换成了触摸版', async () =>
  (await evaluate(`document.querySelector('.side-note').textContent.includes('输入框')`)) === true);

await check('隐形输入框没有把页面撑出横向滚动条', async () =>
  (await evaluate(`document.documentElement.scrollWidth <= window.innerWidth + 1`)) === true);

await check('触摸版卡片上的 ☆ 够大好点，也没被挤出卡片头', async () => {
  const r = await evaluate(`(() => {
    const b = document.querySelector('[data-act="star"]');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    const head = b.closest('.card-head').getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right), headRight: Math.round(head.right) };
  })()`);
  if (!r) throw new Error('卡片上没有收藏按钮');
  if (r.h < 28 || r.w < 28) throw new Error(`只有 ${r.w}×${r.h}px，手指点不准`);
  if (r.right > r.headRight + 1) throw new Error(`右边缘 ${r.right} 超出卡片头 ${r.headRight}`);
  return true;
});

await check('触摸版点 ☆ 能收藏，再点一次能取消', async () => {
  const word = await evaluate(`[...document.querySelectorAll('#wordLine .wl')].map((c) => c.textContent).join('')`);
  await evaluate(`document.querySelector('[data-act="star"]').click(); true`);
  await sleep(700);
  const on = await evaluate(`document.querySelector('[data-act="star"]').classList.contains('on')`);
  const glyph = await evaluate(`document.querySelector('[data-act="star"]').textContent`);
  const saved = await evaluate(`Object.keys((JSON.parse(localStorage.getItem('wordplan.v1') || '{}').starred) || {})`);
  if (!on || glyph !== '★' || !saved.includes(word)) throw new Error(`点完 on=${on} 星=${glyph} 已存=${JSON.stringify(saved)}（词「${word}」）`);
  await evaluate(`document.querySelector('[data-act="star"]').click(); true`);
  await sleep(700);
  const off = await evaluate(`document.querySelector('[data-act="star"]').classList.contains('on')`);
  const after = await evaluate(`Object.keys((JSON.parse(localStorage.getItem('wordplan.v1') || '{}').starred) || {})`);
  if (off || after.includes(word)) throw new Error(`取消后 on=${off} 已存=${JSON.stringify(after)}`);
  return true;
});

await check('无 JS 报错', async () => {
  if (problems.length) throw new Error(problems.slice(0, 3).join(' | '));
  return true;
});

/* ------------------------------------------------------------------ 报告 */

await send('Emulation.clearDeviceMetricsOverride');
await send('Emulation.setTouchEmulationEnabled', { enabled: false });
await send('Emulation.setEmulatedMedia', { features: [] });

let pass = 0;
for (const r of results) {
  if (r.ok) { pass += 1; console.log(`  ok   ${r.name}`); }
  else console.log(`  FAIL ${r.name}\n       -> ${JSON.stringify(r.got)}`);
}
console.log(`\n${pass}/${results.length} 通过`);
ws.close();
process.exit(pass === results.length ? 0 : 1);
