/* 词计划 · 练习页 -------------------------------------------------------- */

import * as store from './store.js';
import { loadDeck } from './dict.js';
import { speak, speakWordAndMeaning, stopSpeaking, speechSupported, speechHint } from './speech.js';
import { esc, meaningHTML, shortMeaning, spokenMeaning, fmtTime, toast } from './ui.js';

export const MODES = [
  { id: 'typing', name: '跟打', desc: '卡片上显示单词，照着敲一遍' },
  { id: 'dictation', name: '默写', desc: '只给释义，凭记忆拼出单词' },
  { id: 'listening', name: '听音', desc: '只听发音，写出对应单词' },
  { id: 'choice', name: '选择', desc: '从四个相近选项里选出正确拼写' },
];

export const SCOPES = [
  { id: 'all', name: '全部' },
  { id: 'todo', name: '未学' },
  { id: 'unmastered', name: '未掌握' },
  { id: 'wrong', name: '错词本' },
  { id: 'due', name: '待复习' },
  { id: 'starred', name: '收藏' },
];

export const ORDERS = [
  { id: 'book', name: '书序' },
  { id: 'random', name: '打乱' },
];

/** 每轮最多背多少个词；0 = 不限。数量由用户在侧栏自由填写，见 app.js */
export const LIMIT_MAX = 100000;

let session = null;
let stageEl = null;
let keyHandler = null;
let inputEl = null;

const S = () => store.state.settings;
const cur = () => (session && session.queue[session.idx]) || null;

/**
 * 触摸设备（手机 / 平板 / Android 壳）：没有物理键盘，
 * 所以要隐藏「按 Enter / Tab / Esc」这类快捷键提示，改成显示一个「提交」按钮。
 */
const TOUCH = typeof window !== 'undefined'
  && (window.matchMedia('(pointer: coarse)').matches
    || !!(window.AndroidTTS && typeof window.AndroidTTS.available === 'function' && window.AndroidTTS.available()));

/** 答案里允许出现的字符（书名里的词条含空格、连字符、撇号、点号） */
// 允许输入的字符：字母、撇号（o'clock）、连字符（e-mail）、点、空格（according to）。
// 不包含 ( ) / ——那是书上的「可选写法」记法，直接敲其中一种就行。
const ANSWER_CHARS = /[A-Za-z'\- .]/;

/* ------------------------------------------------------------------ 生命周期 */

export function unmount() {
  if (keyHandler) window.removeEventListener('keydown', keyHandler);
  keyHandler = null;
  destroyInput();
  if (session) clearTimeout(session.timerNext);
  stopSpeaking();
  session = null;
}

/**
 * 一个常驻的隐形 <input>。
 *
 * 为什么必须有它：`.type-line` 只是用来「显示」的 div，
 * Android WebView 只会给真正的 <input> 弹软键盘 —— 没有这个元素，
 * 手机上点破了屏幕也打不出一个字。
 *
 * 它挂在 <body> 上而不是卡片里，因为 `paint()` 每次换词都会重写整个
 * stage 的 innerHTML；挂在外面焦点就不会丢，软键盘也就不会一开一合地闪。
 */
function createInput() {
  destroyInput();
  inputEl = document.createElement('input');
  inputEl.type = 'text';
  inputEl.id = 'wpTypeInput';
  inputEl.className = 'wp-type-input';
  inputEl.setAttribute('autocomplete', 'off');
  inputEl.setAttribute('autocorrect', 'off');
  inputEl.setAttribute('autocapitalize', 'off');
  inputEl.setAttribute('spellcheck', 'false');
  inputEl.setAttribute('enterkeyhint', 'done');
  inputEl.setAttribute('aria-label', '输入答案');
  inputEl.setAttribute('tabindex', '-1');
  inputEl.addEventListener('keydown', (e) => handleKey(e, true));
  inputEl.addEventListener('input', onInput);
  document.body.appendChild(inputEl);
}

function destroyInput() {
  if (!inputEl) return;
  inputEl.removeEventListener('input', onInput);
  if (inputEl.parentNode) inputEl.parentNode.removeChild(inputEl);
  inputEl = null;
}

/** 把 session.typed 写回输入框（hint / 看答案 / 换词等程序化改动之后要调） */
function syncInput() {
  if (!inputEl) return;
  const want = session ? session.typed : '';
  if (inputEl.value !== want) inputEl.value = want;
}

function focusInput() {
  if (inputEl) inputEl.focus({ preventScroll: true });
}

/**
 * 手机输入法的 keydown 常常只给 keyCode 229（组字中），拿不到真实字符，
 * 所以**字符一律以 input 事件为准**：输入框里是什么，答案就是什么。
 */
function onInput() {
  const s = session;
  if (!inputEl) return;
  if (!s || s.state !== 'asking') { syncInput(); return; }
  const w = cur();
  const allowSpace = !!(w && w.w.includes(' '));
  const cleaned = [...(inputEl.value || '')]
    .filter((c) => (c === ' ' ? allowSpace : ANSWER_CHARS.test(c)))
    .join('')
    .slice(0, 80);
  if (cleaned !== inputEl.value) inputEl.value = cleaned;
  s.typed = cleaned;
  paintCells();
}

function attachKeys() {
  if (keyHandler) window.removeEventListener('keydown', keyHandler);
  // 输入框自己挂了 keydown；事件会冒泡到 window，这里必须放行，否则一个字符会算两遍
  keyHandler = (e) => { if (inputEl && e.target === inputEl) return; handleKey(e, false); };
  window.addEventListener('keydown', keyHandler);
}

export async function mount(stage) {
  unmount();
  stageEl = stage;
  stage.innerHTML = `<div class="view"><div class="empty"><div class="big">⏳</div>正在载入词库…</div></div>`;

  let deck;
  try {
    deck = await loadDeck(store.state.deckId);
  } catch (err) {
    stage.innerHTML = `<div class="view"><div class="empty"><div class="big">⚠️</div>词库载入失败<br><small>${esc(err.message)}</small></div></div>`;
    return;
  }
  if (stageEl !== stage) return; // 已被切走

  session = buildSession(deck);

  if (!session.queue.length) {
    renderEmptyPool();
    return;
  }

  paint();
  paintMeta();
  attachKeys();
  createInput();
  const picked = store.consumePickedStart();
  if (picked && session.resumedFrom > 0) {
    toast(`从第 ${session.resumedFrom + 1} 个词开始（按「上一词」能往回看）`, 2800);
  } else if (session.resumedFrom > 0) {
    toast(`接着上次：从第 ${session.resumedFrom + 1} 个词继续（按「上一词」能往回看）`, 2800);
  }
  // 只有听音模式在进词时自动出声——那个模式的「题目」就是声音。
  // 跟打/默写/选择一律等作答之后再读，免得刚翻到下一词就把答案念出来。
  if (S().autoSpeak && session.mode === 'listening') {
    setTimeout(() => speakCurrent(false), 200);
  }
}

/* ------------------------------------------------------------------ 会话构建 */

function buildSession(deck) {
  const now = Date.now();
  const scope = store.state.scope;
  // 只有「按书序顺着背」的范围才续传：错词本 / 待复习是要把这一批全过一遍的
  const linear = scope === 'all' || scope === 'todo' || scope === 'unmastered';
  const resume = store.state.order === 'book' && linear ? store.cursorOf(deck.id) : 0;
  let words = store.filterWords(deck.words, scope, now);
  if (store.state.order === 'random') {
    words = store.shuffle(words);
  }

  // 续传时先定位到「上次背到哪儿」，但**不把前面的词丢掉**——
  // 它们留在队列头部，这样按「上一词」还能翻回去看已经背过的词。
  let startIdx = 0;
  if (store.state.order === 'book' && linear && resume > 0) {
    const p = words.findIndex((w) => Number(w.i) >= resume);
    if (p < 0) store.clearCursor(deck.id); // 整本都过完了 → 下次从头来
    else startIdx = p;
  }

  const limit = Number(store.state.limit) || 0;
  let roundWords = words.slice(startIdx);
  if (limit > 0) roundWords = roundWords.slice(0, limit);
  const before = startIdx > 0 ? words.slice(0, startIdx) : [];

  return {
    deckId: deck.id,
    deckName: deck.name,
    deckTotal: deck.words.length,
    // 选择模式作答后要给「其它选项」标释义，得能按单词反查词条
    wordMap: new Map(deck.words.map((x) => [String(x.w), x])),
    resumedFrom: resume,
    mode: store.state.mode,
    scope: store.state.scope,
    queue: [...before, ...roundWords],
    offset: before.length,
    idx: before.length,
    typed: '',
    state: 'asking',
    correct: null,
    choices: null,
    chosen: -1,
    hadErr: false,
    requeued: new Set(),
    stats: { answered: 0, correct: 0, wrong: 0 },
    wrongWords: new Set(),
    startedAt: Date.now(),
    lastTick: Date.now(),
    elapsed: 0,
    finished: false,
  };
}

/* ------------------------------------------------------------------ 渲染 */

function renderEmptyPool() {
  const names = Object.fromEntries(SCOPES.map((x) => [x.id, x.name]));
  stageEl.innerHTML = `
    <div class="view">
      <div class="empty">
        <div class="big">🗂️</div>
        <p>「${esc(session.deckName)}」在「${esc(names[session.scope] || session.scope)}」范围内没有可练的单词。</p>
        <p style="margin-top:14px"><button class="btn" data-act="scope-all">改成「全部」重建一轮</button></p>
      </div>
    </div>`;
  stageEl.querySelector('[data-act="scope-all"]').addEventListener('click', () => {
    store.set('scope', 'all');
    mount(stageEl);
  });
}

const modeName = (id) => (MODES.find((m) => m.id === id) || { name: id }).name;
// 进度条只看这一轮：队列头部是「往回翻」的旧词，不该算进进度
const pct = () => {
  if (!session || !session.queue.length) return 0;
  const span = session.queue.length - (session.offset || 0);
  const done = session.idx - (session.offset || 0);
  return Math.max(0, Math.min(100, Math.round((done / Math.max(1, span)) * 100)));
};

function paint() {
  const s = session;
  const w = cur();
  if (!w) return finish();

  const hideMeaning = s.mode === 'listening' && s.state === 'asking';
  const p = store.prog(w.w);
  const starred = store.isStarred(w.w);

  stageEl.innerHTML = `
    <div class="view">
      <div class="pbar"><i style="width:${pct()}%"></i></div>
      <div class="pmeta">
        <span>第 <b>${s.idx + 1}</b> / ${s.queue.length} 词</span>
        <span class="stat-correct">正确 <b>${s.stats.correct}</b></span>
        <span class="stat-wrong">错误 <b>${s.wrongWords.size}</b></span>
      </div>
      <div class="word-card">
        <div class="card-head">
          <span class="badge">${esc(w.group || s.deckName)}</span>
          <span class="badge gray">${esc(modeName(s.mode))}</span>
          ${p ? `<span class="badge ${store.isMastered(w.w) ? '' : 'warn'}">熟练度 ${p.lvl}</span>` : '<span class="badge gray">新词</span>'}
          <span class="spacer"></span>
          <button class="icon-btn star-btn${starred ? ' on' : ''}" data-act="star"
                  title="${starred ? '取消收藏' : '收藏这个词：以后可以在「范围 → 收藏」里只看它们'}"
                  aria-pressed="${starred ? 'true' : 'false'}">${starred ? '★' : '☆'}</button>
          ${speechSupported() ? '<button class="icon-btn" data-act="speak" title="发音（空格）">🔊</button>' : ''}
        </div>
        ${hideMeaning
          ? '<div class="meaning" style="color:var(--text-faint);font-size:17px">🔊 听发音，写出这个单词（空格重听）</div>'
          : `<div class="meaning">${meaningHTML(w.trans, S().shortTrans !== false, S().hfMark !== false ? w.hf : [])}</div>`}
        ${hideMeaning ? '' : `<div class="phon">${w.us ? `<span class="us" data-accent="us" role="button" tabindex="0" title="点一下听美音">美 /${esc(w.us)}/</span>` : ''}${w.uk ? `<span class="uk" data-accent="uk" role="button" tabindex="0" title="点一下听英音">英 /${esc(w.uk)}/</span>` : ''}</div>`}
        ${s.mode === 'choice'
          ? choicesHTML()
          : `<div class="word-line" id="wordLine"></div>
        <div class="type-line" id="typeLine"></div>`}
        <div class="feedback" id="fb"></div>
      </div>
      <div class="card-actions">
        <button class="btn step" data-act="prev" ${s.idx === 0 ? 'disabled' : ''}>← 上一词</button>
        <button class="btn step" data-act="next">下一词 →</button>
        <span class="sep-v"></span>
        ${s.mode === 'choice' ? '' : '<button class="btn ghost" data-act="hint">提示 <span class="k">Tab</span></button>'}
        <button class="btn ghost" data-act="reveal">看答案 <span class="k">Esc</span></button>
        <button class="btn ghost" data-act="skip">跳过</button>
        ${TOUCH && s.mode !== 'choice' ? '<button class="btn primary" data-act="submit">提交</button>' : ''}
        <span style="flex:1"></span>
        <button class="btn ghost" data-act="stop">结束本轮</button>
      </div>
    </div>`;

  bindActions();
  if (s.mode !== 'choice') {
    paintCells();
    const tl = stageEl.querySelector('#typeLine');
    if (tl) tl.addEventListener('click', focusInput);
  }
  paintFeedback();
}

function choicesHTML() {
  const s = session;
  const w = cur();
  if (!w) return '';
  if (!s.choices) s.choices = makeChoices(w);
  const done = s.state === 'done';
  return `<div class="choices${done ? ' revealed' : ''}">${s.choices
    .map((c, i) => {
      let cls = 'choice';
      if (done) {
        if (c === w.w) cls += ' correct';
        else if (i === s.chosen) cls += ' wrong';
      }
      // 作答后把**其它选项**的释义也列出来（每个词性只留一两条），
      // 这样选错的时候顺带把同组近义词都认一遍
      const rec = s.wordMap ? s.wordMap.get(String(c)) : null;
      const hint = done && c !== w.w && rec
        ? `<span class="choice-hint">${esc(shortMeaning(rec.trans, 2, 26))}</span>`
        : '';
      return `<button class="${cls}" data-choice="${i}"><span class="key">${i + 1}</span><span class="choice-w">${esc(c)}</span>${hint}</button>`;
    })
    .join('')}</div>`;
}

/**
 * 单词栏：整个词连着显示，不再一个字母一个格子地拆开。
 * 跟打模式一直看得见；默写/听音作答前用 • 蒙住，作答后揭晓。
 */
function paintWordLine() {
  const el = document.getElementById('wordLine');
  const s = session;
  const w = cur();
  if (!el || !s || !w) return;
  const done = s.state === 'done';
  const hide = (s.mode === 'dictation' || s.mode === 'listening') && !done;
  el.classList.toggle('masked', hide);
  el.classList.toggle('revealed', done);
  el.innerHTML = [...w.w]
    .map((ch) => (ch === ' '
      ? '<span class="wl space"></span>'
      : `<span class="wl">${esc(hide ? '•' : ch)}</span>`))
    .join('');
}

/** 输入行：用户真正敲进去的字符。作答中一律中性色（不判对错），提交后才整词判色 */
function paintTypeLine() {
  const el = document.getElementById('typeLine');
  const s = session;
  const w = cur();
  if (!el || !s || !w) return;
  const variants = variantsOf(w);
  const settled = s.state === 'done';
  const allWrong = settled && s.correct === false;
  let html = '';
  for (let i = 0; i < s.typed.length; i += 1) {
    const ch = s.typed[i];
    const cls = ['glyph'];
    // 打字过程中就逐字母判色：对=绿、错=红。判色不打断输入，按 Enter 提交时才整词定对错。
    // 「对」的判定是：这个位置的字符，和某一种可接受写法（program / programme）同位置的一致。
    const right = charMatches(variants, ch, i);
    cls.push(right ? 'done' : 'bad');
    html += `<span class="${cls.join(' ')}">${ch === ' ' ? '&nbsp;' : esc(ch)}</span>`;
  }
  if (s.state === 'asking') html += '<span class="caret"></span>';
  el.innerHTML = html;
  el.classList.toggle('empty', s.typed.length === 0 && s.state === 'asking');
  el.classList.toggle('hit', settled && s.correct === true);
  el.classList.toggle('miss', allWrong);
  el.dataset.placeholder = s.mode === 'dictation'
    ? '凭上面的释义拼出单词'
    : s.mode === 'listening'
      ? '听发音写出单词'
      : (variants.length > 1 ? '照着上面的单词敲一遍（任一写法都算对）' : '照着上面的单词敲一遍');
  if (!TOUCH) el.dataset.placeholder += '，按 Enter 提交';
  syncInput();
}

function paintCells() {
  paintWordLine();
  paintTypeLine();
}

function paintFeedback() {
  const box = document.getElementById('fb');
  const s = session;
  const w = cur();
  if (!box || !s || !w) return;

  const submitBtn = stageEl && stageEl.querySelector('[data-act="submit"]');
  if (submitBtn) submitBtn.textContent = s.state === 'done' ? '继续 →' : '提交';

  box.className = 'feedback';
  if (s.state === 'asking') {
    box.classList.add('hint');
    if (TOUCH) {
      // 触摸设备没有物理键盘，别念快捷键；告诉用户点哪儿、按什么
      if (s.mode === 'choice') box.innerHTML = '点一下你认为是正确的拼写';
      else box.innerHTML = '点下面的输入框，用键盘拼出这个单词，再点「提交」';
    } else if (s.mode === 'typing') {
      box.innerHTML = '照上面的单词敲一遍 · <kbd>Enter</kbd> 提交判分 · <kbd>Backspace</kbd> 删除 · <kbd>Tab</kbd> 提示 · <kbd>Space</kbd> 发音 · <kbd>Esc</kbd> 看答案';
    } else if (s.mode === 'choice') {
      box.innerHTML = '点击选项，或按 <kbd>1</kbd>–<kbd>4</kbd> · <kbd>Esc</kbd> 看答案';
    } else {
      box.innerHTML = '输入后按 <kbd>Enter</kbd> 提交 · <kbd>Backspace</kbd> 删除 · <kbd>Esc</kbd> 看答案';
    }
    return;
  }
  if (s.correct) {
    box.classList.add('ok');
    box.innerHTML = TOUCH
      ? '✓ 正确'
      : `✓ 正确 · ${S().autoNext ? '即将进入下一词' : '按 <kbd>Enter</kbd> 继续'}`;
  } else {
    box.classList.add('bad');
    // 可选写法的词（program(me)、realize,-ise）把几种写法都列出来
    const forms = variantsOf(w);
    const answer = forms.length > 1 ? forms.join(' / ') : w.w;
    box.innerHTML = TOUCH
      ? `✗ 正确答案 <b style="font-family:var(--mono);letter-spacing:.5px">${esc(answer)}</b>`
      : `✗ 正确答案 <b style="font-family:var(--mono);letter-spacing:.5px">${esc(answer)}</b> · 按 <kbd>Enter</kbd> 继续`;
  }
}

function paintMeta() {
  const s = session;
  if (!s) return;
  const bar = stageEl && stageEl.querySelector('.pbar > i');
  if (bar) bar.style.width = `${pct()}%`;
  const meta = stageEl && stageEl.querySelector('.pmeta');
  if (!meta) return;
  const k = meta.children;
  // 报「这本书里的第几个」而不是「这一轮里的第几个」：续传后往回翻时前一个数照样说得通
  const w = cur();
  const pos = w ? Number(w.i) + 1 : s.idx + 1;
  if (k[0]) k[0].innerHTML = `第 <b>${pos}</b> / ${s.deckTotal} 词`;
  if (k[1]) k[1].innerHTML = `正确 <b>${s.stats.correct}</b>`;
  if (k[2]) k[2].innerHTML = `错误 <b>${s.wrongWords.size}</b>`;
}

/**
 * 手机上「提交」按钮判完会**在原地**变成「继续 →」，手指连点两下就会一带而过地翻到下一词
 * （看着就像「答错也自动跳」）。所以触摸版的这个按钮判分后 360ms 内忽略点击。
 * 只挡这一个按钮：键盘回车、桌面的「下一词」都照旧立刻响应。
 */
const SUBMIT_COOLDOWN = 360;

function submitCoolingDown() {
  return !!session && session.state === 'done' && Date.now() - (session.settledAt || 0) < SUBMIT_COOLDOWN;
}

function bindActions() {
  stageEl.querySelectorAll('[data-act]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const act = btn.dataset.act;
      if (act === 'speak') doSpeak();
      else if (act === 'star') toggleStar();
      else if (act === 'hint') hint();
      else if (act === 'reveal') reveal();
      else if (act === 'skip') skip();
      else if (act === 'prev') prev();
      else if (act === 'next') next();
      else if (act === 'submit') {
        if (session && session.state === 'done') { if (!submitCoolingDown()) next(); }
        else { commitFull(); focusInput(); }
      }
      else if (act === 'stop') stopRound();
    });
  });
  stageEl.querySelectorAll('[data-choice]').forEach((btn) => {
    btn.addEventListener('click', () => choose(Number(btn.dataset.choice)));
  });
  // 点音标就按那个口音念一遍：点「美」发美音，点「英」发英音
  stageEl.querySelectorAll('.phon [data-accent]').forEach((el) => {
    // 记下点之前输入框是不是有焦点：有的话点完还回去，免得软键盘被收掉
    el.addEventListener('pointerdown', () => { el._hadInput = document.activeElement === inputEl; });
    const flash = () => {
      el.classList.add('accent-flash');
      clearTimeout(el._flashTimer);
      el._flashTimer = setTimeout(() => {
        el.classList.remove('accent-flash');
        // 只闪一下：把焦点还回去，免得框一直停在“被选中”的样子
        if (el._hadInput && inputEl) focusInput();
        else el.blur();
      }, 260);
    };
    el.addEventListener('click', () => {
      doSpeakAccent(el.dataset.accent);
      flash();
    });
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      e.stopPropagation();
      doSpeakAccent(el.dataset.accent);
      flash();
    });
  });
}

/* ------------------------------------------------------------------ 选项生成 */

function similarity(a, b) {
  let s = 0;
  if (a[0] === b[0]) s += 3;
  if (Math.abs(a.length - b.length) <= 2) s += 2;
  if (a[a.length - 1] === b[b.length - 1]) s += 1;
  if (a.slice(0, 3) === b.slice(0, 3)) s += 2;
  return s;
}

function makeChoices(w) {
  const s = session;
  const others = s.queue.filter((x) => x.w !== w.w);
  const pool = others.length >= 3 ? others : s.deckWords || others;
  const scored = pool
    .map((x) => ({ w: x.w, v: similarity(w.w, x.w) }))
    .sort((a, b) => b.v - a.v)
    .slice(0, 20);
  const picks = store.shuffle(scored.length ? scored : [{ w: 'a' }, { w: 'b' }, { w: 'c' }])
    .slice(0, 3)
    .map((x) => x.w);
  while (picks.length < 3) picks.push(`option${picks.length + 1}`);
  return store.shuffle([w.w, ...new Set(picks.filter((x) => x !== w.w))]);
}

/* ------------------------------------------------------------------ 交互 */

function doSpeak() {
  const w = cur();
  if (!w) return;
  if (!speak(w.w, { accent: S().accent, rate: S().rate })) toast(speechHint(), 4200);
}

/** 用指定口音念当前词（点「美」/「英」音标时用） */
function doSpeakAccent(accent) {
  const w = cur();
  if (!w) return;
  const ok = speak(w.w, { accent: accent === 'uk' ? 'uk' : 'us', rate: S().rate });
  if (!ok) toast(speechHint(), 4200);
}

/**
 * 收藏 / 取消收藏当前这个词。
 * 只就地换那颗星，不整页重画（重画会把输入框里已经打的字弄没）。
 * store.toggleStar 会 notify → app.js 那边顺手把侧栏「收藏 N」的计数刷新掉。
 */
function toggleStar() {
  const w = cur();
  if (!w) return;
  const on = store.toggleStar(w.w);
  const btn = stageEl && stageEl.querySelector('[data-act="star"]');
  if (btn) {
    btn.classList.toggle('on', on);
    btn.textContent = on ? '★' : '☆';
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.title = on ? '取消收藏' : '收藏这个词：以后可以在「范围 → 收藏」里只看它们';
  }
  toast(on ? '已收藏 · 在侧栏「范围」里选「收藏」就只看这些词' : '已取消收藏', 2400);
}

/**
 * 朗读当前词：单词 + 释义。
 * speech 层每次都会先 cancel，所以进下一词时上一词的声音会自动停。
 * @param {boolean} withMeaning 听音模式在作答前不能报释义
 */
function speakCurrent(withMeaning = true) {
  const w = cur();
  if (!w) return false;
  const mode = withMeaning ? S().speakMeaning : 'off';
  return speakWordAndMeaning(w.w, spokenMeaning(w.trans, mode), {
    accent: S().accent,
    rate: S().rate,
  });
}

/**
 * 判分用的可接受写法。书上很多词条写的是「可选拼法」：
 *   program(me) → program / programme      harbo(u)r → harbor / harbour
 *   a/an → a / an                          fiber/-bre → fiber / fibre
 * 这些只要敲出其中一种就算对。第一项是主形。
 */
function variantsOf(w) {
  const list = Array.isArray(w.alts) && w.alts.length ? w.alts : [String(w.w).toLowerCase()];
  return list;
}

/**
 * 逐字母判色：第 i 个字符只要和「某一种写法的第 i 个字符」对得上就算绿。
 * 用「任意一种写法」而不是「主形」，program(me) 才会敲到第 7 位还是绿的。
 */
function charMatches(variants, ch, i) {
  const c = String(ch).toLowerCase();
  return variants.some((v) => v[i] === c);
}

/** 敲满了、而且正好等于某一个写法 */
function isExact(variants, typed) {
  return variants.includes(String(typed).trim().toLowerCase());
}

/**
 * 跟打模式不再逐键判对错：敲什么就收什么（打错也能看见、能退格），
 * 按下 Enter 提交时才整词判分。
 */
function typeChar(ch) {
  const s = session;
  if (!s || s.state !== 'asking') return;
  s.typed += ch;
  paintCells();
}

function commitFull() {
  const s = session;
  const w = cur();
  if (!s || s.state !== 'asking' || s.mode === 'choice') return;
  if (!s.typed.length) { toast('先输入单词再提交'); return; }
  // 只有「完全敲对（任一种写法都行）、且没用过 Tab 提示」才算对
  settle(isExact(variantsOf(w), s.typed) && !s.hadErr, true);
}

function choose(i) {
  const s = session;
  if (!s || s.state !== 'asking' || s.mode !== 'choice') return;
  const w = cur();
  if (!s.choices) s.choices = makeChoices(w);
  s.chosen = i;
  settle(s.choices[i] === w.w, true);
}

function hint() {
  const s = session;
  if (!s || s.state !== 'asking') return;
  const w = cur();
  // 提示按主形走：program(me) 的主形是 program
  const target = w.plain || w.w;
  if (s.typed.length >= target.length) return;
  s.hadErr = true;
  s.typed += target[s.typed.length];
  paintCells();
}

function reveal() {
  const s = session;
  if (!s || s.state !== 'asking') return;
  settle(false, true);
}

function skip() {
  const s = session;
  if (!s || s.state !== 'asking') return;
  settle(false, true);
}

function stopRound() {
  const s = session;
  if (!s) return;
  if (s.stats.answered === 0) { unmount(); return; }
  finish();
}

function settle(correct, revealAnswer = false) {
  const s = session;
  if (!s || s.state === 'done') return;
  const w = cur();
  if (!w) return;

  s.state = 'done';
  s.correct = correct;
  s.settledAt = Date.now();
  s.stats.answered += 1;
  if (correct) s.stats.correct += 1;
  else {
    s.stats.wrong += 1;
    s.wrongWords.add(w.w);
  }
  store.record(w.w, correct);
  // 随背随记：答一个就存一个，下次进来接着这儿往下背
  store.setCursor(s.deckId, Number(w.i) + 1);
  store.flush();

  if (!correct && !s.requeued.has(w.w)) {
    s.requeued.add(w.w);
    s.queue.push(w);
  }

  // 答对但输入框还是空的（选择模式、或直接点了「下一词」），把主形补上；
  // 已经敲对了（program / programme 都算对）就保留用户自己敲的那一种，别改写他。
  if (revealAnswer && correct && !isExact(variantsOf(w), s.typed)) s.typed = w.plain || w.w;

  if (s.mode === 'choice') {
    const box = stageEl.querySelector('.choices');
    if (box) box.outerHTML = choicesHTML();
    bindActions();
  } else {
    paintCells();
  }
  paintFeedback();
  paintMeta();

  // 对错都把这个词的单词 + 释义读一遍（听音模式此时已作答，释义可以报了）
  const spoken = S().autoSpeak ? speakCurrent(true) : null;

  if (correct && S().autoNext) {
    clearTimeout(s.timerNext);
    // 自动下一词：留出朗读时间；朗读一结束就被 next() 里的 cancel 掐断
    const wait = spoken && spoken.ok
      ? Math.min(Math.max(spoken.ms, 700), 6000)
      : (s.mode === 'choice' ? 620 : 360);
    s.timerNext = setTimeout(next, wait);
  }
}

/** 跳到队列第 i 个词：清空会话状态、重绘、朗读新词（旧朗读立刻停） */
function goTo(i) {
  const s = session;
  clearTimeout(s.timerNext);
  stopSpeaking();
  s.elapsed += Date.now() - s.lastTick;
  s.lastTick = Date.now();
  s.idx = i;
  s.typed = '';
  s.state = 'asking';
  s.correct = null;
  s.choices = null;
  s.chosen = -1;
  s.hadErr = false;
  paint();
  paintMeta();
  // 翻到新词时**不**自动发音（作答后才读）；听音模式例外，声音就是它的题目
  if (S().autoSpeak && s.mode === 'listening') speakCurrent(false);
}

function next() {
  const s = session;
  if (!s || s.finished) return;
  // 输入行里已经敲了东西：「下一词」先按正常流程判分，别让半截输入白白溜过去。
  // （判完再点一次才真的翻到下一词，和「提交 → 继续 →」是同一个节奏）
  if (s.state === 'asking' && s.mode !== 'choice' && s.typed.trim().length) {
    commitFull();
    return;
  }
  if (s.idx >= s.queue.length - 1) return finish();
  goTo(s.idx + 1);
}

function prev() {
  const s = session;
  if (!s || s.finished) return;
  if (s.idx <= 0) return;
  goTo(s.idx - 1);
}

/* ------------------------------------------------------------------ 结束 */

function finish() {
  const s = session;
  if (!s || s.finished) return;
  s.finished = true;
  s.elapsed += Date.now() - s.lastTick;
  store.addTime(s.elapsed);
  clearTimeout(s.timerNext);
  if (keyHandler) window.removeEventListener('keydown', keyHandler);
  stopSpeaking();

  const rate = s.stats.answered ? Math.round((s.stats.correct / s.stats.answered) * 100) : 0;
  const wrongList = [...s.wrongWords];

  stageEl.innerHTML = `
    <div class="view">
      <div class="done-panel">
        <div class="done-icon">${rate >= 90 ? '🎉' : rate >= 60 ? '👍' : '💪'}</div>
        <h2>这一轮完成了</h2>
        <div class="done-grid">
          <div class="done-cell"><div class="v">${s.stats.answered}</div><div class="k">作答</div></div>
          <div class="done-cell"><div class="v" style="color:var(--success)">${s.stats.correct}</div><div class="k">正确</div></div>
          <div class="done-cell"><div class="v" style="color:var(--danger)">${wrongList.length}</div><div class="k">错词</div></div>
          <div class="done-cell"><div class="v">${rate}%</div><div class="k">正确率</div></div>
        </div>
        <p style="color:var(--text-muted);margin:0 0 26px">用时 ${fmtTime(s.elapsed)} · ${esc(s.deckName)} · ${esc(modeName(s.mode))}</p>
        <div class="done-actions">
          <button class="btn primary" data-act="again">继续下一段</button>
          ${wrongList.length ? `<button class="btn" data-act="review-wrong">只练这 ${wrongList.length} 个错词</button>` : ''}
          <button class="btn ghost" data-act="from-start">重头开始</button>
          <a class="btn ghost" href="#stats">看统计</a>
        </div>
      </div>
    </div>`;

  stageEl.querySelector('[data-act="again"]').addEventListener('click', () => mount(stageEl));
  stageEl.querySelector('[data-act="from-start"]').addEventListener('click', () => {
    store.clearCursor(s.deckId);
    mount(stageEl);
  });
  const rw = stageEl.querySelector('[data-act="review-wrong"]');
  if (rw) {
    rw.addEventListener('click', () => {
      const seen = new Set();
      const words = s.queue.filter((x) => {
        if (!wrongList.includes(x.w) || seen.has(x.w)) return false;
        seen.add(x.w);
        return true;
      });
      session = null;
      session = buildSession({ id: s.deckId, name: '本轮错词', words });
      session.queue = words;
      session.deckName = '本轮错词';
      attachKeys();
      paint();
      paintMeta();
    });
  }
}

/* ------------------------------------------------------------------ 键盘 */

/**
 * 键盘总入口。
 * @param {KeyboardEvent} e
 * @param {boolean} fromInput 事件来自那个隐形输入框：此时**字符与退格交给浏览器原生处理**，
 *   我们只在 input 事件里读值 —— 因为手机输入法组字期间 keydown 常常拿不到真实字符。
 */
function handleKey(e, fromInput = false) {
  const s = session;
  if (!s || s.finished) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const w = cur();
  if (!w) return;
  const key = e.key;

  if (key === 'Escape') {
    e.preventDefault();
    if (s.state === 'asking') reveal();
    else next();
    return;
  }
  if (key === 'Tab') {
    e.preventDefault();
    hint();
    return;
  }
  if (key === 'ArrowLeft') { e.preventDefault(); prev(); return; }
  if (key === 'ArrowRight') { e.preventDefault(); next(); return; }

  if (s.mode === 'choice') {
    if (/^[1-4]$/.test(key)) {
      e.preventDefault();
      if (s.state === 'asking') choose(Number(key) - 1);
      else next();
      return;
    }
    if (key === 'Enter') { e.preventDefault(); next(); }
    return;
  }

  if (key === 'Enter') {
    e.preventDefault();
    if (s.state === 'done') next();
    else commitFull();
    return;
  }

  if (key === 'Backspace') {
    // 输入框自己会删，删完发 input 事件；只有全局键盘（输入框没聚焦）才需要我们手动删
    if (fromInput) return;
    e.preventDefault();
    // 跟打模式也允许退格：打错的、打多的都能删掉重来
    if (s.state === 'asking' && s.typed.length) {
      s.typed = s.typed.slice(0, -1);
      paintCells();
    }
    return;
  }

  if (key === ' ') {
    // 多词条目（according to）里空格是有效字符；其余情况空格＝发音
    const spaceIsChar = s.mode !== 'choice' && s.state === 'asking'
      && w.w.includes(' ') && !s.typed.endsWith(' ');
    if (spaceIsChar && fromInput) return; // 让输入框原生插入空格
    e.preventDefault();
    if (spaceIsChar) typeChar(' ');
    else doSpeak();
    return;
  }

  if (key.length !== 1) return;
  if (!ANSWER_CHARS.test(key)) return;
  if (fromInput) return; // 交给 input 事件
  e.preventDefault();
  if (s.state !== 'asking') return;
  typeChar(key);
}
