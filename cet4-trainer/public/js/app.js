/* 词计划 · 应用外壳 / 路由 / 侧栏 ---------------------------------------- */

import * as store from './store.js';
import { loadIndex, loadDeck } from './dict.js';
import { initSpeech, speechHint, speechReady } from './speech.js';
import * as practice from './practice.js';
import * as stats from './stats.js';
import * as settings from './settings.js';
import { esc, plainTrans, toast } from './ui.js';

const VIEWS = { practice, stats, settings };

/** 触摸设备（手机 / 平板 / Android 壳）：侧栏别再念快捷键了 */
const TOUCH = typeof window !== 'undefined'
  && (window.matchMedia('(pointer: coarse)').matches
    || !!(window.AndroidTTS && typeof window.AndroidTTS.available === 'function' && window.AndroidTTS.available()));

const stage = document.getElementById('stage');
const sidebar = document.getElementById('sidebar');
const nav = document.getElementById('nav');
const todayChip = document.getElementById('todayChip');
const themeBtn = document.getElementById('themeBtn');
const menuBtn = document.getElementById('menuBtn');
const backdrop = document.getElementById('backdrop');

let currentView = null;
let currentName = '';
let deckIndex = [];
const deckWords = new Map();  // id -> 单词数组（只存词，给统计/筛选用）
const deckFull = new Map();   // id -> 完整词条数组（展开词表时看释义用）
let expandedDeck = null;      // 当前展开的词库 id（手风琴：一次只开一个）

/* ------------------------------------------------------------------ 启动 */

initSpeech();

/* 原生语音引擎发不出声（手机没装英文语音包 / Windows 没有可用嗓子）时提醒一次，
   否则就是「明明设置了自动朗读却一声不响」，用户根本不知道卡在哪儿。 */
window.addEventListener('wordplan:speech-failed', () => {
  import('./ui.js').then((m) => m.toast(speechHint(), 7000)).catch(() => {});
});

/* 深浅色：默认跟随系统。手机（尤其 Android）常常自带「深色模式强制反色」，
   我们主动跟着系统走，页面自己就是深色，系统就不会再乱反一遍。
   用户在设置页明确选过之后，就一直听用户的。 */
const darkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

/** 系统是否偏好深色。Android 壳里要问 Java —— WebView 的 prefers-color-scheme 跟的是 Activity 主题 */
function systemPrefersDark() {
  const bridge = window.AndroidSystem;
  if (bridge && typeof bridge.isNightMode === 'function') {
    try { return !!bridge.isNightMode(); } catch (err) { /* 桥挂了就退回媒体查询 */ }
  }
  return !!(darkQuery && darkQuery.matches);
}

function effectiveTheme() {
  const s = store.state.settings;
  if (s.themeAuto === false) return s.theme === 'dark' ? 'dark' : 'light';
  return systemPrefersDark() ? 'dark' : 'light';
}
applyTheme();

/** Android 壳在系统深浅色变化时会调这个（见 MainActivity.onConfigurationChanged） */
window.__onSystemTheme = () => {
  if (store.state.settings.themeAuto === false) return;
  applyTheme();
  renderThemeBtn();
};

store.subscribe(() => {
  renderToday();
  renderThemeBtn();
  renderSidebar();
});

document.querySelectorAll('.nav button').forEach((b) => {
  b.addEventListener('click', () => { window.location.hash = `#${b.dataset.route}`; });
});

themeBtn.addEventListener('click', () => {
  const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
  store.setSetting('themeAuto', false);
  store.setSetting('theme', next);
  applyTheme();
  renderThemeBtn();
  if (currentName === 'settings') currentView.mount(stage);
});

if (darkQuery) {
  const onSystemTheme = () => {
    if (store.state.settings.themeAuto === false) return;
    applyTheme();
    renderThemeBtn();
  };
  if (darkQuery.addEventListener) darkQuery.addEventListener('change', onSystemTheme);
  else if (darkQuery.addListener) darkQuery.addListener(onSystemTheme);
}
// 设置页选了主题 → 由这里统一裁决并落笔
document.addEventListener('wordplan:theme', () => { applyTheme(); renderThemeBtn(); });

window.addEventListener('hashchange', route);

/* 窄屏抽屉：☰ 打开词库/设置侧栏 */
function closeDrawer() {
  sidebar.classList.remove('open');
  backdrop.classList.remove('show');
}
menuBtn.addEventListener('click', () => {
  const open = sidebar.classList.toggle('open');
  backdrop.classList.toggle('show', open);
});
backdrop.addEventListener('click', closeDrawer);
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

/* 进度写入是 200ms 防抖的，离开页面时必须落盘，否则最后一次作答会丢 */
window.addEventListener('pagehide', store.flush);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') store.flush();
});

/** 注册 Service Worker：装到手机/桌面后可以完全离线使用。
 *  只在 http(s) 且非 file:// 下注册；失败也不影响正常使用。 */
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  if (!/^https?:$/.test(window.location.protocol)) return;
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

(async function boot() {
  registerSW();
  // 打包音频要先探完：它决定了「支不支持发音」，🔊 按钮和自动朗读都看它
  await speechReady().catch(() => {});
  try {
    const idx = await loadIndex();
    deckIndex = idx.dicts || [];
    if (!deckIndex.some((d) => d.id === store.state.deckId)) store.state.deckId = deckIndex[0]?.id || 'week1';
  } catch (err) {
    sidebar.innerHTML = `<div class="side-note">词库索引加载失败：${esc(err.message)}</div>`;
  }
  renderToday();
  renderThemeBtn();
  renderSidebar();
  if (!window.location.hash) history.replaceState(null, '', '#practice');
  await route();
  warmCounts();
})();

/* ------------------------------------------------------------------ 路由 */

async function route() {
  const raw = window.location.hash.replace(/^#/, '') || 'practice';
  const name = VIEWS[raw] ? raw : 'practice';

  closeDrawer();

  if (currentView && currentView.unmount) currentView.unmount();
  currentView = VIEWS[name];
  currentName = name;

  document.querySelectorAll('.nav button').forEach((b) => {
    b.classList.toggle('active', b.dataset.route === name);
  });

  await currentView.mount(stage);
}

/* ------------------------------------------------------------------ 主题 */

function applyTheme() {
  document.documentElement.dataset.theme = effectiveTheme() === 'dark' ? 'dark' : 'light';
}

function renderThemeBtn() {
  const dark = effectiveTheme() === 'dark';
  themeBtn.textContent = dark ? '☀️' : '🌙';
  themeBtn.title = dark ? '切换到浅色模式' : '切换到深色模式';
}

/* ------------------------------------------------------------------ 今日 */

function renderToday() {
  const t = store.today();
  const o = store.overallStats();
  todayChip.innerHTML = `<span>今日 <b>${t.learned}</b> 新 · <b>${t.reviewed}</b> 复习</span><span class="dot-sep"></span><span>待复习 <b>${o.due}</b></span>`;
}

/* ------------------------------------------------------------------ 侧栏 */

function renderSidebar() {
  const st = store.state;
  const totalWords = deckWords.get(st.deckId);
  const startAt = startPosOf(st.deckId);

  sidebar.innerHTML = `
    <div class="side-block">
      <div class="side-title">词库</div>
      <div class="side-hint">点词库选中它，点右边的「展开」看里面的单词和释义</div>
      <div class="deck-list">
        ${deckIndex.map((d) => deckItemHTML(d, st.deckId)).join('') || '<div class="side-note">载入中…</div>'}
      </div>
    </div>

    <div class="side-block">
      <div class="side-title">练习模式</div>
      <div class="chip-list">
        ${practice.MODES.map((m) => `<button class="chip ${st.mode === m.id ? 'active' : ''}" data-mode="${m.id}" title="${esc(m.desc)}">${esc(m.name)}</button>`).join('')}
      </div>
    </div>

    <div class="side-block">
      <div class="side-title">范围</div>
      <div class="chip-list">
        ${practice.SCOPES.map((s) => `<button class="chip ${st.scope === s.id ? 'active' : ''}" data-scope="${s.id}">${esc(s.name)}${scopeCount(s.id, totalWords)}</button>`).join('')}
      </div>
    </div>

    <div class="side-block">
      <div class="side-title">练习顺序</div>
      <div class="chip-list">
        ${practice.ORDERS.map((s) => `<button class="chip ${st.order === s.id ? 'active' : ''}" data-order="${s.id}">${esc(s.name)}</button>`).join('')}
      </div>
    </div>

    <div class="side-block">
      <div class="side-title">每轮数量</div>
      <div class="limit-row">
        <input class="limit-input" id="limitInput" type="number" inputmode="numeric"
               min="1" max="${Math.max(1, totalWords)}" step="1"
               value="${Number(st.limit) > 0 ? Number(st.limit) : ''}"
               placeholder="不限" aria-label="每轮背多少个词">
        <span class="limit-unit">个</span>
        <button class="chip ${Number(st.limit) > 0 ? '' : 'active'}" data-limit="0">不限</button>
      </div>
      <div class="side-hint">填个数，回车生效；留空就是整个词库一次背完</div>
    </div>

    <div class="side-block">
      <div class="side-title">从第几个词开始</div>
      <div class="limit-row">
        <input class="limit-input" id="startInput" type="text" inputmode="text"
               value="${startAt > 0 ? startAt : ''}"
               placeholder="从头" aria-label="从第几个词开始，也可以直接填一个单词">
        <span class="limit-unit">词</span>
        <button class="chip ${startAt > 0 ? '' : 'active'}" data-start="0">从头</button>
      </div>
      <div class="side-hint">${startHint(startAt)}</div>
    </div>

    <div class="side-block">
      <div class="side-note">
        ${TOUCH
          ? '点词卡下方的输入框开始拼写，答完按「提交」或键盘上的回车。'
          : '快捷键：<b>Enter</b> 提交/下一词 · <b>←</b> <b>→</b> 上一词/下一词 · <b>Space</b> 发音 · <b>Tab</b> 提示 · <b>Esc</b> 看答案'}
      </div>
    </div>`;

  bindSidebar();
}

function deckItemHTML(d, activeId) {
  const words = deckWords.get(d.id);
  const active = d.id === activeId;
  let track = '';
  let count = `${d.count}`;
  if (words) {
    const s = store.deckStats(words);
    const p = Math.round((s.mastered / Math.max(1, s.total)) * 100);
    track = `<div class="deck-track"><i style="width:${p}%"></i></div>`;
    count = `${s.mastered}/${s.total}`;
  }
  const open = expandedDeck === d.id;
  return `<div class="deck-block">
    <div class="deck-item ${active ? 'active' : ''}" data-deck="${d.id}" role="button" tabindex="0" aria-expanded="${open}">
      <div class="deck-row">
        <span class="deck-name">${esc(d.name)}</span>
        <span class="deck-sub">${esc(d.sub || '')}</span>
        <span class="deck-count">${count}</span>
        <button class="deck-toggle" data-toggle-deck="${d.id}" aria-expanded="${open}"
                title="${open ? '收起这个词表' : '展开看这个词库的单词'}"
                aria-label="${open ? '收起词表' : '展开词表'}"><span class="dt-caret">${open ? '▾' : '▸'}</span>${open ? '收起' : '展开'}</button>
      </div>
      ${track}
    </div>
    ${open ? deckWordsHTML(d.id) : ''}
  </div>`;
}

/** 取释义里最前的一小截当预览：「n. 重点，中心点；关注…」→「重点，中心点」 */
function briefOf(w) {
  const line = String((w.trans && w.trans[0]) || '')
    .replace(/^((?:n|v|vt|vi|adj|adv|prep|conj|pron|num|int|art|aux|abbr|a|ad)\.)\s*/i, '');
  const first = line.split(/[；;。]/)[0].replace(/[，,、]\s*$/, '');
  return first || line;
}

function deckWordsHTML(id) {
  const full = deckFull.get(id);
  if (!full) return '<div class="deck-words"><div class="dw-empty">正在载入…</div></div>';
  const cursor = store.cursorOf(id); // 0 起：下一个要背的词的数组下标
  const rows = full.map((w, i) => {
    const cls = store.isMastered(w.w) ? ' mastered' : '';
    const isStart = cursor > 0 && cursor === i;
    return `<div class="dw-item${cls}${isStart ? ' start' : ''}" data-word-deck="${esc(id)}" data-word-i="${i + 1}"
      role="button" tabindex="0" title="从「${esc(w.w)}」开始背">
      <span class="dw-i">${i + 1}</span>
      <span class="dw-w">${esc(w.w)}</span>
      <span class="dw-t" title="${esc(plainTrans(w.trans))}">${esc(briefOf(w))}</span>
      ${isStart ? '<span class="dw-badge">起点</span>' : ''}
    </div>`;
  }).join('');
  return `<div class="deck-words">${rows || '<div class="dw-empty">这个词库是空的</div>'}</div>`;
}

function scopeCount(scope, words) {
  if (!words) return '';
  const n = store.filterWords(words, scope).length;
  return `<span class="n">${n}</span>`;
}

/** 起始词只在「按书序 + 顺背型范围」下生效，不生效时得说清楚为什么 */
function startHint(startAt) {
  const st = store.state;
  if (st.order !== 'book') return '现在是「打乱」，要选「书序」起始词才生效';
  if (!(st.scope === 'all' || st.scope === 'todo' || st.scope === 'unmastered')) {
    return '「错词本 / 待复习」每次都要整批过一遍，起始词只在「全部 / 未学 / 未掌握」下生效';
  }
  if (startAt > 0) return `从这个词库的第 ${startAt} 个词开始；展开词表点任一单词也能直接跳过去`;
  return '留空或点「从头」就是从第 1 个词开始；展开词表点任一单词也能直接跳过去';
}

/** 侧栏那一栏显示的是「第几个词」（1 起数，人话）；0 = 从头。

   注意内部游标是 0 起的「下一个要背的词的数组下标」：settle() 里写的是 w.i + 1，
   所以 cursor = N 时接下来要背的是下标 N、也就是第 N+1 个词。对外一律换算掉。 */
function startPosOf(deckId) {
  const c = store.cursorOf(deckId);
  return c > 0 ? c + 1 : 0;
}

/** 把「从第几个词开始」落到这个词库的游标上，然后重开一轮 */
function setStart(deckId, pos, { silent = false } = {}) {
  const p = Math.max(0, Math.floor(Number(pos) || 0));
  if (p > 1) {
    store.setCursor(deckId, p - 1); // 1 起的第 p 个词 = 下标 p-1
    store.markPickedStart();
  } else {
    store.clearCursor(deckId);
  }
  store.flush();
  store.set('deckId', deckId);
  renderSidebar();
  gotoPractice();
  if (!silent) toast(p > 1 ? `从第 ${p} 个词开始` : '从第 1 个词开始', 2200);
}

/**
 * 输入框里可以填序号，也可以直接填单词（「我已经背到 apple 了」这种情况更顺手）。
 * @returns {Promise<boolean>} 是否成功
 */
async function applyStartInput(raw) {
  const deckId = store.state.deckId;
  const s = String(raw || '').trim();
  if (!s) { setStart(deckId, 0, { silent: true }); return true; }
  if (/^\d+$/.test(s)) { setStart(deckId, Number(s)); return true; }

  const needle = s.toLowerCase();
  let deck;
  try {
    deck = await loadDeck(deckId);
  } catch (err) {
    toast(`词库载入失败：${err.message}`, 3000);
    return false;
  }
  const idx = deck.words.findIndex((w) => w.alts.includes(needle) || String(w.w).toLowerCase() === needle);
  if (idx < 0) { toast(`这个词库里没有「${s}」`, 3000); return false; }
  setStart(deckId, idx + 1);
  return true;
}

function bindSidebar() {
  // 窄屏抽屉里点完任一项就收起侧栏（词库除外：还得让人看得见展开的词表）
  sidebar.querySelectorAll('.chip').forEach((b) =>
    b.addEventListener('click', () => {
      if (window.matchMedia('(max-width: 860px)').matches) closeDrawer();
    }));
  // 「展开 / 收起」药丸：只切换词表，不动当前选中的词库
  sidebar.querySelectorAll('[data-toggle-deck]').forEach((b) => {
    const fire = (e) => { e.stopPropagation(); e.preventDefault(); toggleDeckWords(b.dataset.toggleDeck); };
    b.addEventListener('click', fire);
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
  });
  // 词库整行：选中它 + 展开/收起词表
  sidebar.querySelectorAll('.deck-item[data-deck]').forEach((b) => {
    const fire = () => {
      store.set('deckId', b.dataset.deck);
      toggleDeckWords(b.dataset.deck);
      gotoPractice();
    };
    b.addEventListener('click', fire);
    b.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fire(); }
    });
  });
  sidebar.querySelectorAll('[data-mode]').forEach((b) =>
    b.addEventListener('click', () => {
      store.set('mode', b.dataset.mode);
      renderSidebar();
      gotoPractice();
    }));
  sidebar.querySelectorAll('[data-scope]').forEach((b) =>
    b.addEventListener('click', () => {
      store.set('scope', b.dataset.scope);
      renderSidebar();
      gotoPractice();
    }));
  sidebar.querySelectorAll('[data-order]').forEach((b) =>
    b.addEventListener('click', () => {
      store.set('order', b.dataset.order);
      renderSidebar();
      gotoPractice();
    }));
  sidebar.querySelectorAll('[data-limit]').forEach((b) =>
    b.addEventListener('click', () => {
      store.set('limit', Number(b.dataset.limit));
      renderSidebar();
      gotoPractice();
    }));

  // 每轮数量：自由填写，回车或离开输入框即生效
  const limitInput = sidebar.querySelector('#limitInput');
  if (limitInput) {
    const applyLimit = () => {
      const raw = String(limitInput.value || '').trim();
      const n = raw === '' ? 0 : Math.floor(Number(raw));
      const next = Number.isFinite(n) && n > 0 ? Math.min(n, practice.LIMIT_MAX) : 0;
      const changed = Number(store.state.limit) !== next;
      if (raw !== '' && !(Number.isFinite(n) && n > 0)) {
        limitInput.value = Number(store.state.limit) > 0 ? String(store.state.limit) : '';
        return;
      }
      limitInput.value = next > 0 ? String(next) : '';
      if (!changed) return;
      store.set('limit', next);
      renderSidebar();
      gotoPractice();
    };
    limitInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        limitInput.blur();
      }
    });
    limitInput.addEventListener('blur', applyLimit);
    limitInput.addEventListener('change', applyLimit);
  }

  // 从第几个词开始：填序号或直接填单词，回车 / 离开输入框即生效
  sidebar.querySelectorAll('[data-start]').forEach((b) =>
    b.addEventListener('click', () => setStart(store.state.deckId, Number(b.dataset.start), { silent: true })));

  const startInput = sidebar.querySelector('#startInput');
  if (startInput) {
    // 刚渲染出来时的值。用户没改动它就不重新提交：
    // 否则 blur 里无脑重渲染，会把还按着的按钮换掉；而元素被换掉又会再触发一次 blur，
    // 两次提交互相打架（点「从头」清掉的起点会被上一次的值写回去）。
    const rendered = String(startInput.value || '');
    const applyStart = async () => {
      if (!startInput.isConnected) return; // DOM 已经被换掉，这次 blur 是被动失去焦点
      const raw = String(startInput.value || '').trim();
      if (raw === rendered) return;
      const ok = await applyStartInput(raw);
      // 失败（比如词库里没这个词）就把输入框还原成当前真实的起点
      if (!ok && startInput.isConnected) {
        const at = startPosOf(store.state.deckId);
        startInput.value = at > 0 ? String(at) : '';
        startInput.focus();
      }
    };
    startInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); startInput.blur(); }
    });
    startInput.addEventListener('blur', applyStart);
    startInput.addEventListener('change', applyStart);
  }

  // 展开的词表里点任意一个单词 → 直接从它开始背
  sidebar.querySelectorAll('.dw-item[data-word-i]').forEach((el) => {
    const fire = () => setStart(el.dataset.wordDeck, Number(el.dataset.wordI));
    el.addEventListener('click', fire);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fire(); }
    });
  });
}

function gotoPractice() {
  if (window.location.hash === '#practice') route();
  else window.location.hash = '#practice';
}

/* ------------------------------------------------------- 后台预热词库计数 */

async function warmCounts() {
  for (const d of deckIndex) {
    if (deckWords.has(d.id)) continue;
    try {
      const deck = await loadDeck(d.id);
      deckWords.set(d.id, deck.words.map((w) => w.w));
      deckFull.set(d.id, deck.words);
    } catch { /* ignore */ }
    if (deckWords.size % 3 === 0) renderSidebar();
  }
  renderSidebar();
}

/** 点词库：既选中它，也把里面的词展开看看（再点一下收起） */
async function toggleDeckWords(id) {
  expandedDeck = expandedDeck === id ? null : id;
  renderSidebar();
  if (expandedDeck && !deckFull.has(id)) {
    try {
      const deck = await loadDeck(id);
      deckFull.set(id, deck.words);
      if (!deckWords.has(id)) deckWords.set(id, deck.words.map((w) => w.w));
    } catch { /* ignore */ }
    if (expandedDeck === id) renderSidebar();
  }
}
