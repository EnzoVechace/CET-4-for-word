/* 词计划 · 状态与持久化 -------------------------------------------------- */

const KEY = 'wordplan.v1';

export const DAY = 86400000;
export const INTERVALS = [0, 1, 2, 4, 7, 15, 30, 60]; // 天
export const MAX_LVL = INTERVALS.length - 1;
export const MASTERED_LVL = 5;
const WRONG_RETRY_MS = 10 * 60 * 1000;

export function todayKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function dayOffsetKey(offset) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return todayKey(d);
}

const DEFAULTS = {
  version: 1,
  deckId: 'week1',
  mode: 'typing',
  scope: 'all',
  order: 'book',
  limit: 50,
  settings: {
    theme: 'light',
    themeAuto: true,
    accent: 'us',
    rate: 0.9,
    autoSpeak: true,
    speakMeaning: 'brief',   // off | brief | full —— 朗读单词之后要不要连释义一起读
    autoNext: true,
    showKeyboard: true,
    shortTrans: true,        // 精简释义：每个词性剪掉末尾多出来的义项（词性保留）
    hfMark: true,            // 给高频释义划虚线（像书上那样）
  },
  progress: {},
  daily: {},
  cursors: {},            // { [deckId]: 下一个要背的词在词库里的序号 }
  starred: {},            // { [单词]: 收藏时间戳 } —— 自己挑出来要反复背的词
  totals: { ms: 0 },
};

function merge(base, patch) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  if (!patch || typeof patch !== 'object') return out;
  for (const k of Object.keys(patch)) {
    const b = base[k];
    const p = patch[k];
    if (b && p && typeof b === 'object' && typeof p === 'object' && !Array.isArray(b)) out[k] = merge(b, p);
    else if (p !== undefined && p !== null) out[k] = p;
  }
  return out;
}

/* ------------------------------------------------------- 原生兜底存储（安卓）
 * 网页这边靠 localStorage，但它是 Chromium 的 LevelDB，什么时候落盘由浏览器
 * 自己决定。安卓在后台把进程收掉（清后台、内存紧张）时不一定来得及刷盘，
 * 用户就会遇到「背了半天又回到第一个词」。
 *
 * 安卓壳因此额外注入一个写 SharedPreferences 的桥（window.AndroidStore），
 * 这里两边都写、启动时取「新一点」的那份。桥不在（网页 / Windows 壳）就
 * 完全不影响，一切照旧走 localStorage。
 * -------------------------------------------------------------------------- */
const NATIVE = (typeof window !== 'undefined' && window.AndroidStore) || null;

function nativeLoad() {
  if (!NATIVE) return null;
  try {
    const raw = NATIVE.load();
    return raw && raw.length > 2 ? JSON.parse(raw) : null;
  } catch { return null; }
}

function nativeSave(text) {
  if (!NATIVE) return;
  try { NATIVE.save(text); } catch { /* 忽略 */ }
}

function readLocal() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function load() {
  const local = readLocal();
  const native = nativeLoad();
  // 两边都有就比 savedAt（每次落盘都写一遍），取新的那份
  let pick = local;
  if (native && (!local || (native.savedAt || 0) > (local.savedAt || 0))) pick = native;
  return merge(DEFAULTS, pick || {});
}

export const state = load();

const subs = new Set();
let timer = null;

export function subscribe(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function notify() {
  for (const fn of subs) {
    try { fn(state); } catch (e) { console.error(e); }
  }
}

/** 真正落盘：localStorage 与原生存储各写一份 */
function write() {
  state.savedAt = Date.now();
  const text = JSON.stringify(state);
  try { localStorage.setItem(KEY, text); } catch { /* 隐私模式 */ }
  nativeSave(text);
}

export function save() {
  clearTimeout(timer);
  timer = setTimeout(write, 200);
}

export function flush() {
  clearTimeout(timer);
  write();
}

/* ---------------------------------------------------------------- progress */

export function prog(word) {
  return state.progress[word] || null;
}

export function isMastered(word) {
  const p = state.progress[word];
  return !!p && p.lvl >= MASTERED_LVL;
}

export function isWrong(word) {
  const p = state.progress[word];
  return !!p && p.bad > 0;
}

export function isDue(word, now = Date.now()) {
  const p = state.progress[word];
  return !!p && p.n > 0 && p.due <= now;
}

export function isFresh(word) {
  const p = state.progress[word];
  return !p || p.n === 0;
}

/**
 * 记录一次作答。correct 为 true 时升级，否则降级。
 * @returns {{lvl:number, streak:number, bad:number}}
 */
export function record(word, correct) {
  const now = Date.now();
  let p = state.progress[word];
  if (!p) p = state.progress[word] = { n: 0, ok: 0, bad: 0, streak: 0, lvl: 0, last: 0, due: 0 };

  p.n += 1;
  if (correct) {
    p.ok += 1;
    p.streak += 1;
    p.lvl = Math.min(p.lvl + 1, MAX_LVL);
  } else {
    p.bad += 1;
    p.streak = 0;
    p.lvl = Math.max(0, p.lvl - 2);
  }
  p.last = now;
  p.due = correct ? now + INTERVALS[p.lvl] * DAY : now + WRONG_RETRY_MS;

  const k = todayKey();
  const d = state.daily[k] || (state.daily[k] = { learned: 0, reviewed: 0, correct: 0, wrong: 0, ms: 0 });
  if (p.n === 1) d.learned += 1; else d.reviewed += 1;
  if (correct) d.correct += 1; else d.wrong += 1;

  save();
  notify();
  return p;
}

export function addTime(ms) {
  const k = todayKey();
  const d = state.daily[k] || (state.daily[k] = { learned: 0, reviewed: 0, correct: 0, wrong: 0, ms: 0 });
  d.ms += ms;
  state.totals.ms += ms;
  save();
}

export function today() {
  const k = todayKey();
  return state.daily[k] || { learned: 0, reviewed: 0, correct: 0, wrong: 0, ms: 0 };
}

/* ------------------------------------------------------------------- 统计 */

export function deckStats(words) {
  const now = Date.now();
  let mastered = 0, learning = 0, fresh = 0, wrong = 0, due = 0;
  for (const w of words) {
    const p = state.progress[w];
    if (!p || p.n === 0) { fresh += 1; continue; }
    if (p.lvl >= MASTERED_LVL) mastered += 1; else learning += 1;
    if (p.bad > 0) wrong += 1;
    if (p.due <= now) due += 1;
  }
  return { mastered, learning, fresh, wrong, due, total: words.length, seen: mastered + learning };
}

export function overallStats() {
  let mastered = 0, learning = 0, seenWords = 0, wrongWords = 0, answers = 0, oks = 0;
  const now = Date.now();
  let due = 0;
  for (const [w, p] of Object.entries(state.progress)) {
    if (!p.n) continue;
    seenWords += 1;
    answers += p.n;
    oks += p.ok;
    if (p.lvl >= MASTERED_LVL) mastered += 1; else learning += 1;
    if (p.bad > 0) wrongWords += 1;
    if (p.due <= now) due += 1;
  }
  let dayCount = 0;
  for (const d of Object.values(state.daily)) if (d.learned + d.reviewed > 0) dayCount += 1;
  return {
    mastered, learning, seenWords, wrongWords, answers, oks, due, dayCount,
    accuracy: answers ? oks / answers : 0,
    minutes: Math.round((state.totals.ms || 0) / 60000),
  };
}

export function heatmap(days = 119) {
  const out = [];
  const firstKey = dayOffsetKey(-(days - 1));
  const dow = (new Date(`${firstKey}T12:00:00`).getDay() + 6) % 7; // 周一 = 0
  for (let i = 0; i < dow; i += 1) out.push({ key: '', n: 0, lvl: -1 });
  for (let i = days - 1; i >= 0; i -= 1) {
    const k = dayOffsetKey(-i);
    const d = state.daily[k];
    const n = d ? d.learned + d.reviewed : 0;
    let lvl = 0;
    if (n > 0) lvl = 1;
    if (n >= 20) lvl = 2;
    if (n >= 50) lvl = 3;
    if (n >= 100) lvl = 4;
    out.push({ key: k, n, lvl });
  }
  while (out.length % 7 !== 0) out.push({ key: '', n: 0, lvl: -1 });
  return out;
}

export function streak() {
  let s = 0;
  for (let i = 0; i < 400; i += 1) {
    const d = state.daily[dayOffsetKey(-i)];
    if (d && d.learned + d.reviewed > 0) s += 1;
    else if (i > 0) break;
  }
  return s;
}

export function topWrongWords(limit = 40) {
  return Object.entries(state.progress)
    .filter(([, p]) => p.bad > 0)
    .sort((a, b) => b[1].bad - a[1].bad || b[1].n - a[1].n)
    .slice(0, limit)
    .map(([word, p]) => ({ word, ...p }));
}

/* ------------------------------------------------------------------- 操作 */

export function set(key, value) {
  state[key] = value;
  save();
  notify();
}

export function setSetting(key, value) {
  state.settings[key] = value;
  save();
  notify();
}

export function resetDeck(words) {
  for (const w of words) delete state.progress[w];
  save();
  notify();
}

export function resetAll() {
  state.progress = {};
  state.daily = {};
  state.cursors = {};
  state.starred = {};
  state.totals = { ms: 0 };
  save();
  notify();
}

export function exportJSON() {
  return JSON.stringify({
    exportedAt: new Date().toISOString(),
    app: '词计划 · 四级词汇周计划训练台',
    progress: state.progress,
    daily: state.daily,
    cursors: state.cursors,
    starred: state.starred,
    totals: state.totals,
    settings: state.settings,
  }, null, 2);
}

export function importJSON(text) {
  const data = JSON.parse(text);
  if (!data || typeof data !== 'object' || !data.progress) throw new Error('文件格式不正确，缺少 progress 字段');
  merge(state, {
    progress: data.progress,
    daily: data.daily || {},
    cursors: data.cursors || {},
    starred: data.starred || {},
    totals: data.totals || { ms: 0 },
    settings: data.settings || {},
  });
  save();
  notify();
}

/* --------------------------------------------------------------- 选择/范围 */

/** 每个词库各自记住「学到哪儿了」：下次进来从这里的下一个词接着背 */
export function cursorOf(deckId) {
  const n = Number(state.cursors && state.cursors[deckId]);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function setCursor(deckId, i) {
  if (!state.cursors) state.cursors = {};
  const v = Math.max(0, Number(i) || 0);
  if (state.cursors[deckId] === v) return;
  state.cursors[deckId] = v;
  save();
}

export function clearCursor(deckId) {
  if (!state.cursors) state.cursors = {};
  if (!state.cursors[deckId]) return;
  delete state.cursors[deckId];
  save();
}

/* 「从第几个词开始」是用户自己挑的，还是自动接着上次的？
   两者落盘的东西一样（就是 cursor），但挂载时那句提示得说对，所以单独记一个不落盘的标记。 */
let pickedStart = false;
export function markPickedStart() { pickedStart = true; }
export function consumePickedStart() { const v = pickedStart; pickedStart = false; return v; }

/* --------------------------------------------------------------- 收藏
 * 「这个词我得反复背」——自己挑出来的一小撮词。按**单词文本**记，所以同一个词
 * 不管出现在哪个词库（全书 / Week 3 / 基础词汇）都认得出是收藏过的。
 * -------------------------------------------------------------------------- */

export function isStarred(word) {
  return !!state.starred[word];
}

/** 收藏 / 取消收藏，返回操作后是否处于收藏状态 */
export function toggleStar(word) {
  const key = String(word || '');
  if (!key) return false;
  if (state.starred[key]) delete state.starred[key];
  else state.starred[key] = Date.now();
  save();
  notify();
  return !!state.starred[key];
}

export function starCount() {
  return Object.keys(state.starred).length;
}

/** 收藏的单词，最近收藏的排前面 */
export function starredWords() {
  return Object.keys(state.starred).sort((a, b) => (state.starred[b] || 0) - (state.starred[a] || 0));
}

export function clearStars() {
  state.starred = {};
  save();
  notify();
}

/* 筛选范围时，数组里装的可能是**词条对象**（练习页传 deck.words），
   也可能是**单词字符串**（侧栏统计传 deck.words.map(w => w.w)），
   所以先统一取出单词文本再去查进度，否则对象会被当成 "[object Object]" 查。 */
function wordOf(x) {
  return x && typeof x === 'object' ? String(x.w) : String(x);
}

export function filterWords(words, scope, now = Date.now()) {
  switch (scope) {
    case 'todo': return words.filter((w) => isFresh(wordOf(w)));
    case 'unmastered': return words.filter((w) => !isMastered(wordOf(w)));
    case 'wrong': return words.filter((w) => isWrong(wordOf(w)));
    case 'due': return words.filter((w) => isDue(wordOf(w), now));
    case 'starred': return words.filter((w) => isStarred(wordOf(w)));
    default: return words.slice();
  }
}

export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
