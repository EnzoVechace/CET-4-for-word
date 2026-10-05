/* 词计划 · 端到端冒烟测试（通过 CDP 驱动无头 Edge）
   用法：
     1) 先启动本地服务：node server.mjs
     2) 启动带调试端口的 Edge：msedge --headless=new --remote-debugging-port=9222 http://127.0.0.1:5199/
     3) node tools/e2e.mjs
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

/* 只关心我们自己页面的报错：浏览器扩展、WebView/内部页面的噪音一律忽略 */
function isOurs(params) {
  const url = params?.exceptionDetails?.url || params?.exceptionDetails?.scriptId || '';
  const stack = params?.exceptionDetails?.exception?.description || '';
  const text = `${params?.exceptionDetails?.text || ''} ${stack}`;
  const frames = params?.stackTrace?.callFrames || [];
  const where = [url, text, ...frames.map((f) => f.url || '')].join(' ');
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
  if (msg.method === 'Runtime.exceptionThrown') {
    if (!isOurs(msg.params)) return;
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

async function waitFor(expr, timeout = 8000, label = expr) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await evaluate(`!!(${expr})`)) return true;
    await sleep(120);
  }
  throw new Error(`超时等待：${label}`);
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

/* ---------------------------------------------------------------- 准备 */

/* 在同源、但不加载 App 的页面上重置存储。
   App 会在 pagehide 时 flush 内存状态，若在 App 页里直接改 localStorage 再 reload，会被写回去 */
await send('Page.navigate', { url: `${APP}__seed__` });
await sleep(900);
await evaluate(`
  localStorage.clear();
  localStorage.setItem('wordplan.v1', JSON.stringify({
    version: 1,
    deckId: 'week1',
    mode: 'typing',
    scope: 'all',
    order: 'book',
    limit: 50,
    // strict / liveCheck 是历史遗留键，故意留着：判色不该依赖任何持久化设置
    settings: { autoNext: false, strict: false, liveCheck: false, autoSpeak: true, speakMeaning: 'brief', theme: 'light', accent: 'us', rate: 0.9, trimTrans: false },
  }));
  true;
`);

await send('Page.navigate', { url: `${APP}#practice` });
await sleep(2000);

await evaluate(`
  window.__press = (keys) => {
    for (const k of keys) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    }
  };
  window.__state = () => JSON.parse(localStorage.getItem('wordplan.v1') || '{}');
  // 写入是 200ms 防抖的，这里轮询等落盘
  window.__prog = async (w) => {
    for (let i = 0; i < 50; i += 1) {
      const p = JSON.parse(localStorage.getItem('wordplan.v1') || '{}').progress || {};
      if (p[w]) return p[w];
      await new Promise((r) => setTimeout(r, 60));
    }
    return undefined;
  };
  window.__word = () => {
    const t = document.querySelector('#wordLine');
    return t ? [...t.querySelectorAll('.wl')].map((c) => c.textContent).join('') : null;
  };
  window.__glyphs = () => [...document.querySelectorAll('#typeLine .glyph')].map((c) => c.className);
  // 拦住语音合成，记录「读了几段、都读了什么、cancel 了几次」
  window.__speechSpy = () => {
    const ss = window.speechSynthesis;
    if (!ss) return false;
    window.__spoken = [];
    window.__cancels = 0;
    try {
      ss.cancel = () => { window.__cancels += 1; };
      ss.speak = (u) => { window.__spoken.push({ text: u.text, lang: u.lang }); };
    } catch (e) {
      return false;
    }
    return true;
  };
  true;
`);

/* ---------------------------------------------------------------- 用例 */

await check('练习页渲染出整词单词栏 + 独立输入行', async () => {
  await waitFor("document.querySelectorAll('#wordLine .wl').length > 0", 8000, '单词栏');
  const n = await evaluate("document.querySelectorAll('#typeLine').length");
  return n === 1 ? true : `#typeLine 数量 ${n}`;
});

await check('侧栏列出 10 个词库', async () => {
  await waitFor("document.querySelectorAll('.deck-item').length >= 10", 8000, '词库列表');
  return (await evaluate("document.querySelectorAll('.deck-item').length")) === 10;
});

await check('第一个词是 focus', async () => {
  const w = await evaluate('window.__word()');
  return w === 'focus' ? true : `实际 ${w}`;
});

await check('敲对的字母变绿、敲错的字母立刻变红（不打断输入）', async () => {
  await evaluate("window.__press(['f','o','x'])");
  await sleep(220);
  const cls = await evaluate('window.__glyphs()');
  const colors = await evaluate(
    "[...document.querySelectorAll('#typeLine .glyph')].map((c) => getComputedStyle(c).color)"
  );
  const st = await evaluate("(() => { const g = getComputedStyle(document.querySelector('#typeLine .glyph')); return g.transform + '|' + g.textShadow; })()");
  const ok = cls.length === 3
    && cls[0].includes('done') && cls[1].includes('done') && cls[2].includes('bad')
    && colors[0] === colors[1] && colors[0] !== colors[2]
    && st.split('|')[0] !== 'none' && st.split('|')[1] !== 'none';
  return ok ? true : `classes=${JSON.stringify(cls)} colors=${JSON.stringify(colors)} ${st}`;
});

await check('Backspace 能删掉打错的字母', async () => {
  await evaluate("window.__press(['Backspace'])");
  await sleep(220);
  const cls = await evaluate('window.__glyphs()');
  return cls.length === 2 && !cls.some((c) => c.includes('bad')) ? true : `classes=${JSON.stringify(cls)}`;
});

await check('没敲完不判分，按 Enter 提交才判分', async () => {
  await evaluate("window.__press(['c','u','s'])");
  await sleep(180);
  // 仍在作答：输入行末尾有闪烁光标，且反馈里还没有 ✓ / ✗
  const asking = await evaluate("!!document.querySelector('#typeLine .caret') && !/[\\u2713\\u2717]/.test(document.querySelector('#fb').innerHTML)");
  await evaluate("window.__press(['Enter'])");
  await sleep(260);
  const cls = await evaluate('window.__glyphs()');
  const fb = await evaluate("document.querySelector('#fb').className");
  const ok = asking && cls.length === 5 && cls.every((c) => c.includes('done')) && fb.includes('ok');
  return ok ? true : `asking=${asking} classes=${JSON.stringify(cls)} fb=${fb}`;
});

await check('正确后写入进度 lvl=1', async () => {
  const p = await evaluate("window.__prog('focus')");
  return p && p.lvl === 1 && p.ok === 1 ? true : JSON.stringify(p);
});

await check('Enter 进入第二个词 career', async () => {
  await evaluate("window.__press(['Enter'])");
  await sleep(150);
  const w = await evaluate('window.__word()');
  return w === 'career' ? true : `实际 ${w}`;
});

await check('卡片上有「上一词 / 下一词」按钮', async () => {
  const labels = await evaluate(
    "[...document.querySelectorAll('.card-actions .btn.step')].map((b) => b.textContent.trim())"
  );
  const ok = labels.length === 2 && labels[0].includes('上一词') && labels[1].includes('下一词');
  return ok ? true : JSON.stringify(labels);
});

await check('点「下一词」进入 benefit 并朗读「单词 + 释义」', async () => {
  const hooked = await evaluate('window.__speechSpy()');
  if (!hooked) return '无法拦截 speechSynthesis';
  await evaluate("document.querySelector('[data-act=\"next\"]').click()");
  await sleep(320);
  const w = await evaluate('window.__word()');
  const spoken = await evaluate('window.__spoken');
  const cancels = await evaluate('window.__cancels');
  if (w !== 'benefit') return `实际词 = ${w}`;
  if (!Array.isArray(spoken) || spoken.length < 2) return `只读了 ${JSON.stringify(spoken)}`;
  if (!/^benefit$/i.test(spoken[0].text)) return `第一段不是单词：${spoken[0].text}`;
  if (!/^zh/i.test(spoken[1].lang || '')) return `第二段不是中文：${JSON.stringify(spoken[1])}`;
  if (!/[\u4e00-\u9fa5]/.test(spoken[1].text)) return `释义里没有中文：${spoken[1].text}`;
  if (cancels < 1) return '进新词时没有掐掉上一次朗读';
  return true;
});

await check('点「上一词」回到 career 并掐掉旧朗读', async () => {
  await evaluate('window.__speechSpy()'); // 清空记录
  await evaluate("document.querySelector('[data-act=\"prev\"]').click()");
  await sleep(320);
  const w = await evaluate('window.__word()');
  const spoken = await evaluate('window.__spoken');
  const cancels = await evaluate('window.__cancels');
  if (w !== 'career') return `实际词 = ${w}`;
  if (!/^career$/i.test((spoken[0] || {}).text || '')) return `没有重读 career：${JSON.stringify(spoken)}`;
  if (cancels < 1) return '回上一词时没有掐掉正在读的音频';
  return true;
});

await check('按 Esc 记为错误并降级', async () => {
  await evaluate("window.__press(['Escape'])");
  await sleep(150);
  const cls = await evaluate("document.querySelector('#fb').className");
  const p = await evaluate("window.__prog('career')");
  const bad = cls.includes('bad');
  return bad && p && p.bad === 1 && p.lvl === 0 ? true : `cls=${cls} p=${JSON.stringify(p)}`;
});

await check('打错的地方不判分，按 Enter 提交才判错', async () => {
  await evaluate("window.__press(['Enter'])");
  await sleep(150);
  // 第三个词 benefit：故意多敲一个 x
  await evaluate("window.__press(['b','e','n','e','f','i','t','x'])");
  await sleep(140);
  const cls = await evaluate('window.__glyphs()');
  const alive = !cls.some((c) => c.includes('done') && c.includes('bad'));
  await evaluate("window.__press(['Enter'])");
  await sleep(220);
  const fb = await evaluate("document.querySelector('#fb').className");
  const p = await evaluate("window.__prog('benefit')");
  const ok = alive && cls.length === 8 && cls[7].includes('bad') && fb.includes('bad') && p && p.bad === 1;
  return ok ? true : `n=${cls.length} last=${cls[7]} fb=${fb} p=${JSON.stringify(p)}`;
});

await check('错词会在本轮末尾再次出现', async () => {
  // 50 词的队列里答错 2 个 → 队列应变成 52
  const n = await evaluate("Number(/\\/ (\\d+) 词/.exec(document.querySelector('.pmeta').textContent)?.[1])");
  return n > 50 ? true : `队列仍为 ${n} 词`;
});

await check('切换到选择模式出现 4 个选项', async () => {
  await evaluate(`document.querySelector('[data-mode="choice"]').click()`);
  await sleep(900);
  await waitFor("document.querySelectorAll('.choices .choice').length === 4", 6000, '选项');
  const n = await evaluate("document.querySelectorAll('.choices .choice').length");
  return n === 4 ? true : `${n} 个选项`;
});

await check('按 1 键可以作答', async () => {
  await evaluate("window.__press(['1'])");
  await sleep(150);
  const done = await evaluate("document.querySelector('.feedback').className.includes('ok') || document.querySelector('.feedback').className.includes('bad')");
  return done === true ? true : '未结算';
});

await check('统计页可渲染', async () => {
  await evaluate("location.hash = '#stats'");
  await waitFor("!!document.querySelector('.bar-list')", 9000, '统计条');
  const bars = await evaluate("document.querySelectorAll('.bar-item').length");
  return bars >= 9 ? true : `${bars} 个进度条`;
});

await check('学习日历按周分列（7 行）', async () => {
  const rows = await evaluate("getComputedStyle(document.querySelector('.heat')).gridTemplateRows.split(' ').length");
  return rows === 7 ? true : `${rows} 行`;
});

await check('设置页可渲染', async () => {
  await evaluate("location.hash = '#settings'");
  await waitFor("!!document.querySelector('[data-act=\"export\"]')", 6000, '导出按钮');
  const voices = await evaluate("document.querySelectorAll('.switch').length");
  return voices >= 3 ? true : `${voices} 个开关`;
});

await check('设置页有「朗读释义」三档且能切换', async () => {
  const labels = await evaluate(
    "[...document.querySelectorAll('[data-speak-meaning]')].map((b) => b.textContent.trim())"
  );
  if (labels.length !== 3) return `选项数 = ${labels.length}`;
  await evaluate("document.querySelector('[data-speak-meaning=\"off\"]').click()");
  await sleep(420);
  const active = await evaluate("document.querySelector('[data-speak-meaning=\"off\"]').classList.contains('active')");
  const stored = await evaluate("JSON.parse(localStorage.getItem('wordplan.v1')||'{}').settings.speakMeaning");
  await evaluate("document.querySelector('[data-speak-meaning=\"brief\"]').click()");
  await sleep(420);
  const back = await evaluate("document.querySelector('[data-speak-meaning=\"brief\"]').classList.contains('active')");
  return active && stored === 'off' && back ? true : `active=${active} stored=${stored} back=${back}`;
});

await check('深色主题切换生效', async () => {
  await evaluate(`document.querySelector('[data-theme="dark"]').click()`);
  await sleep(200);
  const theme = await evaluate("document.documentElement.dataset.theme");
  const bg = await evaluate("getComputedStyle(document.body).backgroundColor");
  return theme === 'dark' && bg !== 'rgb(244, 245, 250)' ? true : `theme=${theme} bg=${bg}`;
});

await check('宽屏隐藏 ☰、窄屏才显示', async () => {
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(350);
  const wideHidden = await evaluate("getComputedStyle(document.getElementById('menuBtn')).display === 'none'");
  await send('Emulation.setDeviceMetricsOverride', { width: 760, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(350);
  const narrowShown = await evaluate("getComputedStyle(document.getElementById('menuBtn')).display !== 'none'");
  await send('Emulation.clearDeviceMetricsOverride');
  await sleep(200);
  return wideHidden && narrowShown ? true : `宽屏隐藏=${wideHidden} 窄屏显示=${narrowShown}`;
});

await check('窄屏抽屉可开可关', async () => {
  await send('Emulation.setDeviceMetricsOverride', { width: 760, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(350);
  const btnShown = await evaluate("getComputedStyle(document.getElementById('menuBtn')).display !== 'none'");
  await evaluate("document.getElementById('menuBtn').click()");
  await sleep(250);
  const opened = await evaluate("document.getElementById('sidebar').classList.contains('open') && document.getElementById('backdrop').classList.contains('show')");
  await evaluate("document.getElementById('backdrop').click()");
  await sleep(250);
  const closed = await evaluate("!document.getElementById('sidebar').classList.contains('open')");
  await send('Emulation.clearDeviceMetricsOverride');
  await sleep(200);
  return btnShown && opened && closed ? true : `btn=${btnShown} open=${opened} close=${closed}`;
});

await check('练习页右上角不再显示计时', async () => {
  await evaluate("location.hash = '#practice'");
  await sleep(900);
  const clocks = await evaluate("document.querySelectorAll('#clock, .pmeta .sep').length");
  const txt = await evaluate("(document.querySelector('.pmeta') || {}).textContent || ''");
  return clocks === 0 && !/\d\d:\d\d/.test(txt) ? true : `clocks=${clocks} txt=${txt.replace(/\s+/g, ' ').trim()}`;
});

await check('答过的词立刻落到 cursors 里（随背随记）', async () => {
  const cur = await evaluate("(JSON.parse(localStorage.getItem('wordplan.v1')||'{}').cursors||{}).week1");
  return Number(cur) >= 1 ? true : `cursors.week1 = ${JSON.stringify(cur)}`;
});

await check('重开页面会接着上次的词继续', async () => {
  // 必须先在 /__seed__（同源但不加载 App）里写，否则会被 pagehide 的 flush 覆盖
  await send('Page.navigate', { url: `${APP}__seed__` });
  await sleep(800);
  await evaluate(`
    const raw = JSON.parse(localStorage.getItem('wordplan.v1') || '{}');
    raw.deckId = 'week1';
    raw.mode = 'typing';
    raw.scope = 'all';
    raw.order = 'book';
    raw.limit = 50;
    raw.cursors = { week1: 1 };
    raw.progress = {};
    localStorage.setItem('wordplan.v1', JSON.stringify(raw));
    true;
  `);
  await send('Page.navigate', { url: `${APP}#practice` });
  await sleep(2200);
  const word = await evaluate("document.querySelector('#wordLine').textContent.trim()");
  const idx = await evaluate("document.querySelector('.pmeta b').textContent.trim()");
  // 计数器报的是「书里的第几个」：career 是 week1 的第 2 个
  return word === 'career' && idx === '2' ? true : `首词=${word} 序号=${idx}`;
});

await check('高频释义划了虚线（Collins COBUILD 语料库的义项频次序）', async () => {
  const hf = await evaluate("(document.querySelector('.meaning .hf') || {}).textContent || ''");
  const all = await evaluate("document.querySelectorAll('.meaning .hf').length");
  // career 在 Collins 里高频的是 n.，标的就是 n. 下的第一条「职业，事业」
  return hf.includes('职业') && all === 1 ? true : `hf="${hf}" 个数=${all}`;
});

await check('点「美」音标会用美音念一遍', async () => {
  const fired = await evaluate(`
    (() => {
      const el = document.querySelector('.phon [data-accent="us"]');
      if (!el) return 'no-us-span';
      window.__spoken = null;
      const orig = window.speechSynthesis.speak;
      window.speechSynthesis.speak = (u) => { window.__spoken = u.text; };
      el.click();
      window.speechSynthesis.speak = orig;
      return window.__spoken === null ? 'no-speak-call' : window.__spoken;
    })()
  `);
  const word = await evaluate("document.querySelector('#wordLine').textContent.trim()");
  return fired === word ? true : `实际朗读=${JSON.stringify(fired)} 当前词=${word}`;
});

await check('点「英」音标会用英音念一遍', async () => {
  const fired = await evaluate(`
    (() => {
      const el = document.querySelector('.phon [data-accent="uk"]');
      if (!el) return 'no-uk-span';
      window.__spoken = null;
      const orig = window.speechSynthesis.speak;
      window.speechSynthesis.speak = (u) => { window.__spoken = u.text; };
      el.click();
      window.speechSynthesis.speak = orig;
      return window.__spoken === null ? 'no-speak-call' : window.__spoken;
    })()
  `);
  const word = await evaluate("document.querySelector('#wordLine').textContent.trim()");
  return fired === word ? true : `实际朗读=${JSON.stringify(fired)} 当前词=${word}`;
});

await check('点过的音标只闪一下，不会一直停在选中态', async () => {
  await evaluate("document.querySelector('.phon [data-accent=\"us\"]').click()");
  const flashing = await evaluate(
    "document.querySelector('.phon [data-accent=\"us\"]').classList.contains('accent-flash')"
  );
  await sleep(600);
  const after = await evaluate(`
    (() => {
      const el = document.querySelector('.phon [data-accent="us"]');
      return { flash: el.classList.contains('accent-flash'), focused: document.activeElement === el };
    })()
  `);
  return flashing && !after.flash && !after.focused ? true
    : `刚点完 flash=${flashing}，600ms 后 flash=${after.flash} 仍聚焦=${after.focused}`;
});

await check('每轮数量能自由填写，回车生效', async () => {
  const before = await evaluate("(document.getElementById('limitInput') || {}).value");
  const set = await evaluate(`
    (() => {
      const inp = document.getElementById('limitInput');
      if (!inp) return 'no-input';
      inp.value = '7';
      inp.dispatchEvent(new Event('change', { bubbles: true }));
      return document.getElementById('limitInput').value;
    })()
  `);
  await sleep(400);
  const stored = await evaluate("JSON.parse(localStorage.getItem('wordplan.v1') || '{}').limit");
  // 计数器报的是「书里的第几个 / 这个词库一共多少词」，不再报「这一轮里的第几个」
  const meta = await evaluate("(document.querySelector('.pmeta') || {}).textContent || ''");
  const bar = await evaluate("(document.querySelector('.pbar > i') || {}).style ? document.querySelector('.pbar > i').style.width : ''");
  return before === '50' && set === '7' && Number(stored) === 7 && /\/ 250 词/.test(meta) && parseFloat(bar) < 20 ? true
    : `原来是 ${before}，改成 ${set}，存的是 ${stored}，进度文案 ${JSON.stringify(meta.replace(/\\s+/g, ' ').trim())}，进度条 ${bar}`;
});

await check('「不限」按钮把每轮数量清空', async () => {
  await evaluate("document.querySelector('[data-limit=\"0\"]').click()");
  await sleep(400);
  const stored = await evaluate("JSON.parse(localStorage.getItem('wordplan.v1') || '{}').limit");
  const shown = await evaluate("(document.getElementById('limitInput') || {}).value");
  const active = await evaluate("document.querySelector('[data-limit=\"0\"]').classList.contains('active')");
  return Number(stored) === 0 && shown === '' && active ? true : `limit=${stored} 输入框=${JSON.stringify(shown)} active=${active}`;
});

/* 「可选写法」判分：书上 program(me) 意思是「加 me 也对」。
   把游标拨到 program(me) 那一格，分别敲 program 和 programme，两种都该判对。 */
for (const answer of ['program', 'programme']) {
  await check(`可选写法 program(me)：敲 ${answer} 也算对`, async () => {
    await send('Page.navigate', { url: `${APP}__seed__` });
    await sleep(700);
    const idx = await evaluate(`
      (async () => {
        const d = await (await fetch('dict/week1.json', { cache: 'no-store' })).json();
        return d.words.findIndex((r) => r[0] === 'program(me)');
      })()
    `);
    if (!(idx >= 0)) return '词库里没有 program(me)';
    await evaluate(`
      localStorage.setItem('wordplan.v1', JSON.stringify({
        version: 1, deckId: 'week1', mode: 'typing', scope: 'all', order: 'book', limit: 1,
        cursors: { week1: ${idx} },
        settings: { autoNext: false, autoSpeak: false, theme: 'light', accent: 'us', rate: 0.9, trimTrans: false, hfMark: true },
      }));
      true;
    `);
    await send('Page.navigate', { url: `${APP}#practice` });
    await sleep(1800);
    await evaluate(`
      window.__press = (keys) => {
        for (const k of keys) {
          window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
        }
      };
      window.__word = () => {
        const t = document.querySelector('#wordLine');
        return t ? [...t.querySelectorAll('.wl')].map((c) => c.textContent).join('') : null;
      };
      true;
    `);
    const shown = await evaluate('window.__word()');
    if (shown !== 'program(me)') return `当前词是 ${JSON.stringify(shown)}，不是 program(me)`;
    await evaluate(`window.__press(${JSON.stringify([...answer, 'Enter'])})`);
    await sleep(500);
    const fb = await evaluate("(document.getElementById('fb') || {}).textContent || ''");
    const glyphs = await evaluate("[...document.querySelectorAll('#typeLine .glyph')].map((c) => c.className)");
    const allGreen = glyphs.length > 0 && glyphs.every((c) => c.includes('done'));
    const ok = await evaluate("document.querySelector('#typeLine').classList.contains('hit')");
    return allGreen && ok ? true : `反馈=${JSON.stringify(fb.trim().slice(0, 40))} glyphs=${glyphs.join(',')}`;
  });
}

/* 续传：队列头部保留「已经背过的那一段」，所以「上一词」能往回翻 */
await check('续传后按「上一词」能翻回已经背过的词', async () => {
  await send('Page.navigate', { url: `${APP}__seed__` });
  await sleep(700);
  await evaluate(`
    localStorage.setItem('wordplan.v1', JSON.stringify({
      version: 1, deckId: 'week1', mode: 'typing', scope: 'all', order: 'book', limit: 50,
      cursors: { week1: 5 },
      settings: { autoNext: false, autoSpeak: false, theme: 'light', accent: 'us', rate: 0.9, trimTrans: false, hfMark: true },
    }));
    true;
  `);
  await send('Page.navigate', { url: `${APP}#practice` });
  await sleep(1800);
  await evaluate(`
    window.__word = () => {
      const t = document.querySelector('#wordLine');
      return t ? [...t.querySelectorAll('.wl')].map((c) => c.textContent).join('') : null;
    };
    window.__meta = () => (document.querySelector('.pmeta') || {}).textContent || '';
    true;
  `);
  const at = await evaluate('window.__word()');
  if (at !== 'program(me)') return `续传位置不对：当前词是 ${JSON.stringify(at)}，应该是第 6 个 program(me)`;
  const meta0 = await evaluate('window.__meta()');
  if (!/第\s*6\s*\/\s*250\s*词/.test(meta0)) return `进度文案应显示书里第 6 个，实际 ${JSON.stringify(meta0.replace(/\s+/g, ' ').trim())}`;
  await evaluate("document.querySelector('[data-act=\"prev\"]').click()");
  await sleep(700);
  const back = (await evaluate('window.__word()') || '').replace(/\s+/g, '');
  if (back !== 'accordingto') return `按「上一词」没回到 according to，而是 ${JSON.stringify(back)}`;
  // 连按四次应继续往回走，一路回到第一个词
  for (let i = 0; i < 4; i += 1) {
    await evaluate("document.querySelector('[data-act=\"prev\"]').click()");
    await sleep(320);
  }
  await sleep(400);
  const first = await evaluate('window.__word()');
  return first === 'focus' ? true : `一直往回翻应该到 focus，结果是 ${JSON.stringify(first)}`;
});

/* 词库展开：点一下列出里面的词 + 部分释义，高度限在侧栏一半左右、超出滚动 */
await check('点词库能展开词表，且限高可滚动', async () => {
  await send('Page.navigate', { url: `${APP}#practice` });
  await sleep(1600);
  await evaluate("document.querySelector('.deck-item[data-deck=\"week2\"]').click()");
  await sleep(900);
  const n2 = await evaluate("document.querySelectorAll('.deck-words .dw-item').length");
  if (n2 !== 250) return `week2 展开后列表行数 ${n2}，应该是 250`;
  const first = await evaluate("document.querySelector('.deck-words .dw-item .dw-w').textContent");
  const brief = await evaluate("document.querySelector('.deck-words .dw-item .dw-t').textContent");
  if (!brief || brief.length < 2) return `词条释义预览为空：${JSON.stringify(brief)}`;
  const box = await evaluate(`
    (() => {
      const el = document.querySelector('.deck-words');
      const cs = getComputedStyle(el);
      return { h: el.clientHeight, scroll: el.scrollHeight, ov: cs.overflowY, half: Math.round(window.innerHeight / 2) };
    })()
  `);
  if (box.ov !== 'auto') return `overflow-y 是 ${box.ov}`;
  if (box.h > box.half + 8) return `展开高度 ${box.h}px 超过半屏 ${box.half}px`;
  if (box.scroll <= box.h) return `内容 ${box.scroll}px 没超过可视 ${box.h}px，说明没限高`;
  // 手风琴：点另一个词库，前一个收起
  await evaluate("document.querySelector('.deck-item[data-deck=\"week3\"]').click()");
  await sleep(900);
  const deep = await evaluate("document.querySelectorAll('.deck-words').length");
  const n3 = await evaluate("document.querySelectorAll('.deck-words .dw-item').length");
  if (deep !== 1 || n3 !== 250) return `应该只剩一个展开的词库，实际 ${deep} 个、${n3} 行`;
  // 再点一次同一个 → 收起
  await evaluate("document.querySelector('.deck-item[data-deck=\"week3\"]').click()");
  await sleep(700);
  const closed = await evaluate("document.querySelectorAll('.deck-words').length");
  return closed === 0 ? true : `再点一次应该收起，实际还有 ${closed} 个展开`;
});

/* 每个词库右边有一个看得见的「展开 / 收起」按钮，点它只切词表、不改当前选中的词库 */
await check('词库右边有独立的「展开 / 收起」按钮', async () => {
  await send('Page.navigate', { url: `${APP}#practice` });
  await sleep(1600);
  const toggles = await evaluate("document.querySelectorAll('.deck-toggle[data-toggle-deck]').length");
  if (toggles !== 10) return `「展开/收起」按钮有 ${toggles} 个，应该是 10 个`;
  const label = await evaluate("document.querySelector('[data-toggle-deck=\"week1\"]').textContent.trim()");
  if (!/展开/.test(label)) return `未展开时按钮文案是 ${JSON.stringify(label)}，应该含「展开」`;
  const before = await evaluate("(document.querySelector('.deck-item.active') || {dataset:{}}).dataset.deck");
  await evaluate("document.querySelector('[data-toggle-deck=\"week4\"]').click()");
  await sleep(900);
  const n = await evaluate("document.querySelectorAll('.deck-words .dw-item').length");
  if (n !== 250) return `点 week4 的展开按钮后列表 ${n} 行，应该是 250`;
  const after = await evaluate("(document.querySelector('.deck-item.active') || {dataset:{}}).dataset.deck");
  if (after !== before) return `点「展开」不该切换词库：${before} → ${after}`;
  const nowLabel = await evaluate("document.querySelector('[data-toggle-deck=\"week4\"]').textContent.trim()");
  if (!/收起/.test(nowLabel)) return `展开后按钮文案是 ${JSON.stringify(nowLabel)}，应该含「收起」`;
  // 再点一次收起
  await evaluate("document.querySelector('[data-toggle-deck=\"week4\"]').click()");
  await sleep(700);
  const closed = await evaluate("document.querySelectorAll('.deck-words').length");
  return closed === 0 ? true : `再点一次应该收起，实际还有 ${closed} 个展开`;
});

/* 答错的词一定停下来等你看正确答案，绝不自动跳 */
await check('答错不会自动进入下一词（autoNext 开着也一样）', async () => {
  await send('Page.navigate', { url: `${APP}__seed__` });
  await sleep(700);
  await evaluate(`
    localStorage.clear();
    localStorage.setItem('wordplan.v1', JSON.stringify({
      version: 1, deckId: 'week1', mode: 'typing', scope: 'all', order: 'book', limit: 0,
      settings: { autoNext: true, autoSpeak: false, theme: 'light', accent: 'us', rate: 0.9, trimTrans: false, hfMark: true },
    }));
    true;
  `);
  await send('Page.navigate', { url: `${APP}#practice` });
  await sleep(1800);
  await evaluate(`
    window.__press = (keys) => {
      for (const k of keys) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
      }
    };
    window.__word = () => {
      const t = document.querySelector('#wordLine');
      return t ? [...t.querySelectorAll('.wl')].map((c) => c.textContent).join('') : null;
    };
    true;
  `);
  if ((await evaluate('window.__word()')) !== 'focus') return '起始词不是 focus';
  await evaluate("window.__press(['z','z','z','Enter'])");
  await sleep(3200);
  const still = await evaluate('window.__word()');
  if (still !== 'focus') return `答错后自动跳到了 ${still}`;
  const fb = await evaluate("(document.getElementById('fb') || {}).textContent || ''");
  if (!/正确答案/.test(fb)) return `答错后应该显示正确答案，实际 ${JSON.stringify(fb.trim().slice(0, 40))}`;
  // 对照：答对了才会自动跳
  await evaluate("window.__press(['Enter'])");
  await sleep(600);
  await evaluate("window.__press(['f','o','c','u','s','Enter'])");
  await sleep(2600);
  const moved = await evaluate('window.__word()');
  return moved === 'career' ? true : `答对后应该自动到 career，实际 ${moved}`;
});

/* 手机上「提交」判完会原地变成「继续 →」：手指连点两下不能一连跳两个词 */
await check('触摸版「提交 / 继续」按钮判分后短时间内连点不会连跳', async () => {
  await send('Page.navigate', { url: `${APP}__seed__` });
  await sleep(700);
  await evaluate(`
    localStorage.clear();
    localStorage.setItem('wordplan.v1', JSON.stringify({
      version: 1, deckId: 'week1', mode: 'typing', scope: 'all', order: 'book', limit: 0,
      settings: { autoNext: false, autoSpeak: false, theme: 'light', accent: 'us', rate: 0.9, trimTrans: false, hfMark: true },
    }));
    true;
  `);
  await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 740, deviceScaleFactor: 3, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }, { name: 'any-pointer', value: 'coarse' }, { name: 'hover', value: 'none' }] });
  await send('Page.navigate', { url: `${APP}#practice` });
  await sleep(1800);
  await evaluate(`
    window.__word = () => {
      const t = document.querySelector('#wordLine');
      return t ? [...t.querySelectorAll('.wl')].map((c) => c.textContent).join('') : null;
    };
    true;
  `);
  const coarse = await evaluate("matchMedia('(pointer: coarse)').matches");
  const hasSubmit = await evaluate("!!document.querySelector('[data-act=\"submit\"]')");
  if (!hasSubmit) {
    await send('Emulation.setEmulatedMedia', { features: [] });
    await send('Emulation.clearDeviceMetricsOverride');
    await send('Emulation.setTouchEmulationEnabled', { enabled: false });
    return `coarse pointer 下没有出现「提交」按钮（pointer:coarse = ${coarse}）`;
  }
  // 输入正确 → 点「提交」判分 → 紧接着 60ms 内再点一次（此时按钮已变成「继续 →」）
  await evaluate(`
    (() => {
      const inp = document.getElementById('wpTypeInput');
      inp.value = 'focus';
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()
  `);
  await sleep(120);
  await evaluate("document.querySelector('[data-act=\"submit\"]').click()");
  await sleep(60);
  await evaluate("document.querySelector('[data-act=\"submit\"]').click()");
  await sleep(900);
  const mid = await evaluate('window.__word()');
  // 冷却期内第二下被吃掉，所以还停在 focus
  if (mid !== 'focus') {
    await send('Emulation.setEmulatedMedia', { features: [] });
    await send('Emulation.clearDeviceMetricsOverride');
    await send('Emulation.setTouchEmulationEnabled', { enabled: false });
    return `冷却期内第二次点击就把词翻掉了：${mid}`;
  }
  // 冷却过去以后再点一次 → 只前进一个词
  await sleep(400);
  await evaluate("document.querySelector('[data-act=\"submit\"]').click()");
  await sleep(900);
  const after = await evaluate('window.__word()');
  await send('Emulation.setEmulatedMedia', { features: [] });
  await send('Emulation.clearDeviceMetricsOverride');
  await send('Emulation.setTouchEmulationEnabled', { enabled: false });
  return after === 'career' ? true : `冷却结束后点一次应该到 career，实际 ${after}`;
});

/* 「下一词」不能把半截输入白白跳过去 */
await check('输入了一半再点「下一词」会先判分，而不是静默跳过', async () => {
  await send('Page.navigate', { url: `${APP}__seed__` });
  await sleep(700);
  await evaluate(`
    localStorage.clear();
    localStorage.setItem('wordplan.v1', JSON.stringify({
      version: 1, deckId: 'week1', mode: 'typing', scope: 'all', order: 'book', limit: 0,
      settings: { autoNext: false, autoSpeak: false, theme: 'light', accent: 'us', rate: 0.9, trimTrans: false, hfMark: true },
    }));
    true;
  `);
  await send('Page.navigate', { url: `${APP}#practice` });
  await sleep(1800);
  await evaluate(`
    window.__press = (keys) => {
      for (const k of keys) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
      }
    };
    window.__word = () => {
      const t = document.querySelector('#wordLine');
      return t ? [...t.querySelectorAll('.wl')].map((c) => c.textContent).join('') : null;
    };
    // 写入是 200ms 防抖的，这里轮询等落盘
    window.__prog = async (w) => {
      for (let i = 0; i < 50; i += 1) {
        const p = JSON.parse(localStorage.getItem('wordplan.v1') || '{}').progress || {};
        if (p[w]) return p[w];
        await new Promise((r) => setTimeout(r, 60));
      }
      return undefined;
    };
    true;
  `);
  const start = await evaluate('window.__word()');
  if (start !== 'focus') return `起始词是 ${start}`;
  await evaluate("window.__press(['f','o','c'])");
  await sleep(300);
  await evaluate("document.querySelector('[data-act=\"next\"]').click()");
  await sleep(900);
  const still = await evaluate('window.__word()');
  if (still !== 'focus') return `半截输入后点「下一词」直接跳到了 ${still}`;
  const p = await evaluate("window.__prog('focus')");
  if (!p || !p.bad) return `focus 没有被记为答错：${JSON.stringify(p)}`;
  // 判分之后同一个按钮变成「继续 →」，再点一次才真的翻页
  await evaluate("document.querySelector('[data-act=\"next\"]').click()");
  await sleep(900);
  const moved = await evaluate('window.__word()');
  return moved === 'career' ? true : `判完分再点一次应该到 career，实际 ${moved}`;
});

await check('无 JS 报错', async () => {
  return problems.length === 0 ? true : problems.join(' | ');
});

/* ---------------------------------------------------------------- 输出 */
let pass = 0;
for (const r of results) {
  if (r.ok) pass += 1;
  console.log(`${r.ok ? '  ok  ' : ' FAIL '} ${r.name}${r.ok ? '' : `  → ${r.got}`}`);
}
console.log(`\n${pass}/${results.length} 通过`);
ws.close();
process.exit(pass === results.length ? 0 : 1);
