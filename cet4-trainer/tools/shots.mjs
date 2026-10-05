/* 词计划 · 截图脚本（通过 CDP 驱动无头 Edge）
   先造一份有代表性的学习进度，再逐页截图到 shots/
   注意：必须在「同源但不是 App」的页面上写 localStorage，
        否则 App 的 pagehide flush 会把内存里的旧状态写回去、覆盖种子数据。
   用法：node tools/shots.mjs
*/
const CDP = process.env.CDP || 'http://127.0.0.1:9222';
const APP = process.env.APP || 'http://127.0.0.1:5199/';
const fs = await import('node:fs/promises');
const path = await import('node:path');
const { fileURLToPath } = await import('node:url');
const OUT = process.env.OUT || fileURLToPath(new URL('../shots/', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const targets = await (await fetch(`${CDP}/json/list`)).json();
const target = targets.find((t) => t.type === 'page');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let seq = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
  }
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}

let navSeq = 0;
async function goto(hash, wait = 1600) {
  // 带上递增的查询串：同 URL 只改 hash 不会真正重新加载页面，
  // 会拿到上一次页面里的旧模块（改了 JS 后截图不变就是这个坑）
  await send('Page.navigate', { url: `${APP}?s=${++navSeq}${hash}` });
  await sleep(wait);
}
async function viewport(width, height) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
}
async function shot(name) {
  await sleep(450);
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const file = path.join(OUT, name);
  await fs.writeFile(file, Buffer.from(r.data, 'base64'));
  console.log(`  ${name}  ${(await fs.stat(file)).size} B`);
}

/* 同源、但不加载 App 的落点，用来安全地写 localStorage */
const SEED_PAGE = `${APP}__seed__`;

const SEED = `(async () => {
  const mulberry32 = (a) => () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rnd = mulberry32(20261005);
  const idx = await (await fetch('/data/dicts.json', { cache: 'no-store' })).json();
  const words = [];
  for (const meta of idx.dicts) {
    if (!meta.file || meta.id === 'basic') continue;   // 附录二留白，展示「未开始」
    const d = await (await fetch('/dict/' + meta.file, { cache: 'no-store' })).json();
    for (const row of d.words) words.push(row[0]);
  }
  const now = Date.now();
  const progress = {};
  words.forEach((w, i) => {
    if (i >= 1180) return;                              // 其余约 1000 词留白
    let lvl;
    if (i < 620) lvl = 5 + Math.floor(rnd() * 3);       // 已掌握
    else if (i < 1000) lvl = 1 + Math.floor(rnd() * 4); // 学习中
    else lvl = rnd() < 0.5 ? 0 : 1;
    const n = lvl + 1 + Math.floor(rnd() * 3);
    const bad = lvl >= 5 ? (rnd() < 0.25 ? 1 : 0) : Math.floor(rnd() * 3);
    const gap = [0, 1, 2, 4, 7, 15, 30, 60][lvl] || 0;
    const last = now - Math.floor(rnd() * 26) * 86400000;
    progress[w] = { n, ok: n - bad, bad, streak: lvl >= 5 ? lvl : 0, lvl, last, due: last + gap * 86400000 };
  });
  const daily = {};
  for (let d = 118; d >= 0; d -= 1) {
    const day = new Date(now - d * 86400000);
    const key = day.getFullYear() + '-' + String(day.getMonth() + 1).padStart(2, '0') + '-' + String(day.getDate()).padStart(2, '0');
    const dow = day.getDay();
    const base = dow === 0 || dow === 6 ? 18 : 46;
    const r = rnd();
    if (r < 0.14) { daily[key] = { learned: 0, reviewed: 0, correct: 0, wrong: 0, ms: 0 }; continue; }
    const learned = Math.round(base * (0.5 + r * 0.9));
    const reviewed = Math.round(learned * 0.8);
    const wrong = Math.round(learned * 0.09) + (rnd() < 0.3 ? 1 : 0);
    daily[key] = { learned, reviewed, correct: learned + reviewed - wrong, wrong, ms: (learned + reviewed) * 4200 };
  }
  const prev = JSON.parse(localStorage.getItem('wordplan.v1') || '{}');
  const settings = Object.assign(
    // liveCheck 是历史遗留键，故意留 false：判色不该依赖任何持久化设置
    { theme: 'light', accent: 'us', rate: 0.9, showKeyboard: true, liveCheck: false, trimTrans: false },
    prev.settings || {},
    // 这几项强制覆盖，避免上一轮遗留的旧值（比如 autoSpeak=false）粘住
    { theme: window.__theme || 'light', autoSpeak: true, speakMeaning: 'brief', autoNext: false }
  );
  localStorage.setItem('wordplan.v1', JSON.stringify({
    version: 1, deckId: 'week1', mode: window.__mode || 'typing',
    scope: 'all', order: 'book', limit: 50,
    settings, progress, daily, totals: { ms: 0 },
  }));
  return Object.keys(progress).length + ' 词 / ' + Object.keys(daily).length + ' 天';
})()`;

async function seed({ theme = 'light', mode = 'typing' } = {}) {
  await send('Page.navigate', { url: SEED_PAGE });
  await sleep(700);
  await evaluate(`window.__theme = ${JSON.stringify(theme)}; window.__mode = ${JSON.stringify(mode)}; true`);
  const r = await evaluate(SEED);
  console.log(`已造进度：${r}`);
}

/* ---------------------------------------------------------------- 截图 */

await viewport(1500, 1000);
console.log('截图输出到 cet4-trainer/shots/\n');

// 1. 练习页：跟打，浅色（正在输入 → 前两个字母绿、错的字母红）
await seed();
await goto('#practice', 2200);
await evaluate("for (const k of ['f','o','x']) window.dispatchEvent(new KeyboardEvent('keydown',{key:k,bubbles:true,cancelable:true})); true");
await shot('practice.png');

// 1b. 单词栏 + 输入行特写（裁剪卡片区域放大 2 倍）
await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 1000, deviceScaleFactor: 2, mobile: false });
await sleep(450);
const cardBox = await evaluate("(() => { const r = document.querySelector('.word-card').getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; })()");
const zoom = await send('Page.captureScreenshot', { format: 'png', clip: { ...cardBox, scale: 1 } });
await fs.writeFile(path.join(OUT, 'letters-zoom.png'), Buffer.from(zoom.data, 'base64'));
console.log(`  letters-zoom.png  ${(await fs.stat(path.join(OUT, 'letters-zoom.png'))).size} B`);
await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false });
await sleep(300);

// 1c. 退格删掉打错的字母，补完再按 Enter 提交 → 整词变绿
await evaluate("for (const k of ['Backspace','c','u','s','Enter']) window.dispatchEvent(new KeyboardEvent('keydown',{key:k,bubbles:true,cancelable:true})); true");
await sleep(500);
await shot('practice-correct.png');

// 2. 练习页：选择模式
await evaluate("document.querySelector('[data-mode=\"choice\"]').click()");
await sleep(1100);
await shot('practice-choice.png');

// 3. 练习页：听音模式
await evaluate("document.querySelector('[data-mode=\"listening\"]').click()");
await sleep(1100);
await shot('practice-listening.png');

// 4. 统计页（浅色）
await goto('#stats', 2000);
await shot('stats.png');

// 5. 统计页（深色）
await seed({ theme: 'dark' });
await goto('#stats', 2000);
await shot('stats-dark.png');

// 6. 设置页（浅色 + 深色）
await seed({ theme: 'light' });
await goto('#settings', 1600);
await shot('settings.png');
await evaluate("document.querySelector('[data-theme=\"dark\"]').click(); true");
await sleep(300);
await shot('settings-dark.png');

// 7. 窄屏 760px（跟打）
await viewport(760, 1000);
await seed();
await goto('#practice', 2200);
await evaluate("for (const k of ['f','o','c','x']) window.dispatchEvent(new KeyboardEvent('keydown',{key:k,bubbles:true,cancelable:true})); true");
await shot('practice-narrow.png');

// 8. 窄屏抽屉打开
await evaluate("document.getElementById('menuBtn').click(); true");
await sleep(500);
await shot('practice-narrow-drawer.png');

// 9. 宽屏：点 Word 1 展开词表（列出词 + 部分释义，高度限在侧栏一半、超出滚轮滚）
await viewport(1500, 1000);
await seed();
await goto('#practice', 2200);
await evaluate("document.querySelector('.deck-item[data-deck=\"week1\"]').click(); true");
await sleep(1400);
await shot('sidebar-deck-open.png');

// 10. 续传：游标停在 program(me)（week1 第 6 个），连续按「上一词」翻回已经背过的 career
await seed();
await send('Page.navigate', { url: SEED_PAGE });
await sleep(600);
await evaluate(`
  const raw = JSON.parse(localStorage.getItem('wordplan.v1') || '{}');
  raw.deckId = 'week1'; raw.order = 'book'; raw.limit = 50; raw.cursors = { week1: 5 };
  raw.settings = Object.assign({}, raw.settings, { autoSpeak: false, autoNext: false });
  localStorage.setItem('wordplan.v1', JSON.stringify(raw));
  true;
`);
await goto('#practice', 2000);
for (let i = 0; i < 4; i += 1) {
  await evaluate("document.querySelector('[data-act=\"prev\"]').click(); true");
  await sleep(320);
}
await sleep(400);
await shot('resume-prev.png');

ws.close();
console.log('\n完成');
process.exit(0);
