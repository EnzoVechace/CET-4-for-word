/* 词计划 · 语音合成 ------------------------------------------------------ */

import { altForms } from './dict.js';

/* ------------------------------------------------------------------
   发音一共四条路，按优先级：
     0. 软件里**打包好的发音文件**（public/audio/<accent>/<slug>.ogg）—— 离线、零依赖，首选
     1. Windows 壳：Program.cs 用 AddHostObjectToScript 挂的 WordPlanTts（走 SAPI5）
     2. Android 壳：TtsBridge.java 注入的 AndroidTTS（走系统 TextToSpeech）
     3. 网页里浏览器自带的 Web Speech

   为什么要有第 0 条：用户和其手机都装不上 TTS 引擎，而 WebView2 / Android WebView 里的
   window.speechSynthesis **都存在但都发不出声**——
     · WebView2：枚举得到语音，但 speak() 一律回 error=synthesis-failed
     · Android WebView：压根没有 TTS 后端
   所以干脆把有道那批单词音频打包进 exe / apk，谁都不用装东西就能出声。

   桥只在**方法存在**时就选用，不再用 available() 一票否决：
   桥内部可能还在异步初始化，那时候 speak() 会返回 true（已排队），
   真正起不来时 speak() 返回 false，我们再退回 Web Speech 并提示用户。
   ------------------------------------------------------------------ */

function detectBridge() {
  if (typeof window === 'undefined') return null;
  try {
    if (window.AndroidTTS && typeof window.AndroidTTS.speak === 'function') {
      return { api: window.AndroidTTS, kind: 'android' };
    }
  } catch { /* ignore */ }
  try {
    const ho = window.chrome && window.chrome.webview && window.chrome.webview.hostObjects;
    const sync = ho && ho.sync;
    const tts = sync && sync.WordPlanTts;
    if (tts && typeof tts.Speak === 'function') return { api: tts, kind: 'windows' };
  } catch { /* ignore */ }
  return null;
}

const BRIDGE = detectBridge();

let voices = [];
const webSpeech = typeof window !== 'undefined' && 'speechSynthesis' in window;

/** 把桥的调用差异抹平：Android 是小写 speak，Windows 宿主对象是 PascalCase */
function bridgeSpeak(bridge, text, kind, rate) {
  try {
    if (bridge.kind === 'android') return bridge.api.speak(text, kind, rate) !== false;
    return bridge.api.Speak(text, kind, rate) !== false;
  } catch {
    return false;
  }
}

function bridgeStop(bridge) {
  try {
    if (bridge.kind === 'android') bridge.api.stop();
    else bridge.api.Stop();
  } catch { /* ignore */ }
}

function bridgeAvailable() {
  if (!BRIDGE) return false;
  try {
    if (BRIDGE.kind === 'android') return BRIDGE.api.available() !== false;
    return BRIDGE.api.Available() !== false;
  } catch {
    return false;
  }
}

/** 三条路都不通时的提示文案（设置页和 toast 共用） */
export function speechHint() {
  if (BRIDGE && BRIDGE.kind === 'android') {
    // 先问问手机到底装了什么语言，别让人去装一个他其实已经有的引擎
    let list = '';
    try {
      if (BRIDGE.api.voices) list = String(BRIDGE.api.voices() || '');
    } catch { /* ignore */ }
    if (/count=/.test(list) && !/en-/i.test(list)) {
      return '手机的文字转语音里没有英文语音包（现在只有中文）。去「设置 → 语音与输入 → 文字转语音 → 安装语音数据」，装一个「English (United States)」，再回来就有声了';
    }
    return '这台手机没有可用的语音引擎。去「设置 → 语音与输入 → 文字转语音」里装一个（小米用「小爱语音引擎」，其它机型装「Google 文字转语音」），再回来就有声了';
  }
  if (BRIDGE && BRIDGE.kind === 'windows') {
    return '系统里没有找到英文语音。打开「设置 → 时间和语言 → 语音 → 添加语音」，装上「英语(美国)」，再回来就有声了';
  }
  return '当前浏览器不支持语音朗读';
}

/* 有没有任意一条路能出声。打包音频是异步探测出来的（manifest），
   所以这里是函数、不是常量——练习页挂载时才知道能不能给 🔊 按钮。 */
function isSupported() {
  return !!audioManifest || !!BRIDGE || webSpeech;
}

const PREFERRED = {
  us: [
    'Google US English',
    'Microsoft Aria Online (Natural) - English (United States)',
    'Microsoft Jenny Online (Natural) - English (United States)',
    'Microsoft Guy Online (Natural) - English (United States)',
    'Samantha', 'Alex', 'Microsoft Zira - English (United States)', 'Microsoft Mark - English (United States)',
  ],
  uk: [
    'Google UK English Female',
    'Google UK English Male',
    'Microsoft Libby Online (Natural) - English (United Kingdom)',
    'Microsoft Sonia Online (Natural) - English (United Kingdom)',
    'Daniel', 'Serena', 'Kate', 'Microsoft Hazel - English (United Kingdom)',
  ],
  zh: [
    'Microsoft Xiaoxiao Online (Natural) - Chinese (Mainland)',
    'Microsoft Yunxi Online (Natural) - Chinese (Mainland)',
    'Microsoft Huihui - Chinese (Simplified, PRC)',
    'Google 普通话（中国大陆）',
    'Ting-Ting', 'Mei-Jia', 'Sinji',
  ],
};

let voicesReadyCb = null;

/** 语音列表是异步加载的，拿到后回调一次，好让设置页把「检测到 N 个语音」刷新出来 */
export function onVoicesReady(cb) {
  voicesReadyCb = cb;
}

function refresh() {
  if (!webSpeech) return;
  const before = voices.length;
  try { voices = window.speechSynthesis.getVoices() || []; } catch { voices = []; }
  if (voices.length !== before && voicesReadyCb) {
    try { voicesReadyCb(); } catch { /* ignore */ }
  }
}

export function initSpeech() {
  // 先探打包音频：它才是首选，且决定了「支持不支持」的判定。
  // 单文件 HTML / 开发服务器上没有 audio/manifest.json，这里会安静地回 null。
  loadBundledAudio();

  if (!webSpeech) {
    if (voicesReadyCb) { try { voicesReadyCb(); } catch { /* ignore */ } }
    return;
  }
  refresh();
  try {
    window.speechSynthesis.onvoiceschanged = refresh;
    // 某些浏览器需先调用一次才会加载语音列表
    window.speechSynthesis.getVoices();
  } catch { /* ignore */ }
}

/** 等打包音频探测完（`app.js` 的 boot 在渲染侧栏前 await 一下🔊 按钮才不会漏） */
export function speechReady() {
  return audioPromise || Promise.resolve(null);
}

const norm = (s) => String(s || '').replace('_', '-');

function voicesByLang(prefix) {
  if (!voices.length) refresh();
  const re = new RegExp(`^${prefix}`, 'i');
  return voices.filter((v) => re.test(norm(v.lang)));
}

export function voiceList() {
  if (BRIDGE) {
    return [
      { name: '系统语音 · 美音', lang: 'en-US' },
      { name: '系统语音 · 英音', lang: 'en-GB' },
    ];
  }
  return voicesByLang('en');
}

export function chineseVoiceList() {
  if (BRIDGE) return [{ name: '系统语音 · 中文', lang: 'zh-CN' }];
  return voicesByLang('zh');
}

/** 当前用的是不是 Android 壳里的系统语音（设置页拿它换文案） */
export function isAndroidTts() {
  return !!BRIDGE && BRIDGE.kind === 'android';
}

/** 是不是走了宿主原生 TTS（Windows 壳或 Android 壳） */
export function isNativeTts() {
  return !!BRIDGE;
}

/** kind: 'us' | 'uk' | 'zh' */
function pickVoice(kind) {
  const isZh = kind === 'zh';
  const list = voicesByLang(isZh ? 'zh' : 'en');
  if (!list.length) return null;
  const want = isZh ? 'zh-CN' : kind === 'uk' ? 'en-GB' : 'en-US';
  const names = PREFERRED[kind] || [];

  for (const n of names) {
    const v = list.find((x) => x.name === n);
    if (v) return v;
  }
  for (const n of names) {
    const v = list.find((x) => x.name.toLowerCase().includes(n.toLowerCase().split(' ')[0]));
    if (v) return v;
  }
  return list.find((v) => norm(v.lang) === want)
    || list.find((v) => norm(v.lang).toLowerCase().startsWith(want.slice(0, 2).toLowerCase()))
    || list[0];
}

/** 英文单词 → 可朗读文本 */
export function cleanForSpeech(text) {
  return String(text)
    .replace(/\([^)]*\)/g, '')
    .replace(/[/].*$/, '')
    .replace(/[^A-Za-z'\- ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 中文释义 → 可朗读文本（去掉词性标记、①②、全角括号补注与不发音符号） */
export function cleanMeaningForSpeech(text) {
  return String(text || '')
    .replace(/（[^）]*）/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/(?:^|[；;。\s])(?:vt|vi|adj|adv|prep|conj|pron|num|int|art|aux|abbr|n|v|a|ad)\.\s*/gi, '$1')
    .replace(/[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮]/g, '，')
    .replace(/[^\u4e00-\u9fa5A-Za-z0-9，。、；：！？,.;:!?'\- ]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[，。、；：,.;:\s]+/, '')
    .replace(/[，,、]+$/, '')
    .trim();
}

/* ------------------------------------------------ 打包进来的发音文件（首选） */
/* 打包发音时 public/audio/ 下会有一份 manifest.json；单文件 HTML 版没有音频，
   这里 fetch 失败就当作没有，一路退回原生桥 / Web Speech。
   这样用户不用装任何 TTS 引擎，双击就能出声。 */
let audioManifest = null;
let audioPromise = null;
let currentAudio = null;

/** 词条 → 文件 slug：跟 tools/fetch_audio.mjs 用同一套 altForms()，取主形 */
function audioSlug(word) {
  const en = cleanForSpeech(word);
  if (!en) return '';
  const forms = altForms(en);
  const plain = (forms && forms[0]) || en.toLowerCase();
  return plain.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export function loadBundledAudio() {
  if (audioPromise) return audioPromise;
  audioPromise = (async () => {
    try {
      const res = await fetch('audio/manifest.json', { cache: 'force-cache' });
      if (!res.ok) return null;
      const m = await res.json();
      if (!m || !m.ext || !Array.isArray(m.accents) || !m.accents.length) return null;
      audioManifest = m;
      return m;
    } catch {
      return null;
    }
  })();
  return audioPromise;
}

/** 有打包音频时返回它的 URL，否则 null */
function bundledUrl(word, accent) {
  if (!audioManifest) return null;
  const slug = audioSlug(word);
  if (!slug) return null;
  const a = audioManifest.accents.includes(accent) ? accent : audioManifest.accents[0];
  return `audio/${a}/${slug}${audioManifest.ext}`;
}

function stopAudio() {
  if (!currentAudio) return;
  const a = currentAudio;
  currentAudio = null;
  try { a.pause(); } catch { /* ignore */ }
  try { a.removeAttribute('src'); a.load(); } catch { /* ignore */ }
}

/**
 * 播打包音频。
 * @returns {Promise<boolean>} true = 真播起来了
 */
function playAudio(url) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok) => { if (settled) return; settled = true; resolve(ok); };
    try {
      const a = new Audio(url);
      a.preload = 'auto';
      currentAudio = a;
      a.addEventListener('playing', () => done(true), { once: true });
      a.addEventListener('canplaythrough', () => done(true), { once: true });
      a.addEventListener('error', () => done(false), { once: true });
      setTimeout(() => done(false), 1800);
      const p = a.play();
      if (p && p.catch) p.catch(() => done(false));
    } catch {
      done(false);
    }
  });
}

/** 播音频，放完（或过了 fallbackMs）再 callback —— 用来接「读完单词读释义」 */
function playAudioThen(url, fallbackMs, cb) {
  let fired = false;
  const fire = () => { if (fired) return; fired = true; cb(); };
  playAudio(url).then((ok) => {
    if (!ok) return;                       // 没播起来就让调用方走别的路
    const a = currentAudio;
    if (a) a.addEventListener('ended', fire, { once: true });
    else setTimeout(fire, fallbackMs);
  });
  setTimeout(fire, fallbackMs + 2500);     // ended 万一不来，兜个底
}

/* ------------------------------------------------------- 原生桥 / Web Speech */
/* 原生桥每次 speak 都会 QUEUE_FLUSH 掉上一句，所以「单词+释义」这种
   连续朗读得在 JS 里排期：读完单词的估算时长之后再喊释义。 */
let nativeTimer = null;

/* 一条路都发不出声时只提醒一次，别每读一个词就弹一遍 */
let warnedFail = false;
function warnNativeFail() {
  if (warnedFail) return;
  warnedFail = true;
  try {
    window.dispatchEvent(new CustomEvent('wordplan:speech-failed'));
  } catch { /* ignore */ }
}

function nativeCancel() {
  if (nativeTimer) {
    clearTimeout(nativeTimer);
    nativeTimer = null;
  }
  bridgeStop(BRIDGE);
}

/** 返回 false 表示这个桥根本发不出声（引擎没装 / 初始化失败），调用方该退回 Web Speech */
function nativeQueue(items) {
  nativeCancel();
  let delay = 0;
  let first = true;
  for (const it of items) {
    if (first) {
      first = false;
      if (!bridgeSpeak(BRIDGE, it.text, it.kind, it.rate)) {
        warnNativeFail();
        return false;
      }
    } else {
      nativeTimer = setTimeout(() => {
        nativeTimer = null;
        if (!bridgeSpeak(BRIDGE, it.text, it.kind, it.rate)) warnNativeFail();
      }, delay);
    }
    delay += Math.max(400, it.ms || 1200);
  }
  return true;
}

function queue(items) {
  // 先试宿主原生 TTS；发不出声（引擎没装/没初始化成功）就退回 Web Speech，
  // 不能像以前那样「桥在就算成功」——那正是 exe 和 apk 一声不响的原因。
  if (BRIDGE && nativeQueue(items)) return true;
  if (!webSpeech) { warnNativeFail(); return false; }
  try {
    window.speechSynthesis.cancel();       // 先掐掉上一次（含正在读的），避免排队堆积
    for (const it of items) {
      const u = new SpeechSynthesisUtterance(it.text);
      const v = pickVoice(it.kind);
      if (v) { u.voice = v; u.lang = v.lang; }
      else u.lang = it.kind === 'zh' ? 'zh-CN' : it.kind === 'uk' ? 'en-GB' : 'en-US';
      u.rate = it.rate;
      u.pitch = 1;
      window.speechSynthesis.speak(u);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * 只读一个英文词（会先掐掉上一次朗读）
 * @param {string} text
 * @param {{accent?:'us'|'uk', rate?:number}} opts
 */
export function speak(text, opts = {}) {
  const accent = opts.accent === 'uk' ? 'uk' : 'us';
  const rate = typeof opts.rate === 'number' ? opts.rate : 0.9;
  const clean = cleanForSpeech(text);
  if (!clean) return false;

  // 首选：打包进来的发音文件
  const url = bundledUrl(clean, accent);
  if (url) {
    stopSpeaking();
    playAudio(url).then((ok) => { if (!ok) queue([{ text: clean, kind: accent, rate }]); });
    return true;
  }

  if (!isSupported()) return false;
  return queue([{ text: clean, kind: accent, rate }]);
}

/**
 * 先读单词，再读释义。
 * 调用即 cancel，所以进入下一词时上一词的声音会立刻停下。
 * 返回 { ok, ms }：ms 是估算的总朗读时长，供自动下一词定延时用
 * @param {string} word
 * @param {string} meaning 已清洗好的中文释义文本，可为空
 * @param {{accent?:'us'|'uk', rate?:number}} opts
 */
export function speakWordAndMeaning(word, meaning, opts = {}) {
  const accent = opts.accent === 'uk' ? 'uk' : 'us';
  const rate = typeof opts.rate === 'number' ? opts.rate : 0.9;
  const en = cleanForSpeech(word);
  const zh = cleanMeaningForSpeech(meaning);
  const enMs = en ? Math.max(600, (en.length * 115) / rate) : 0;
  const zhMs = zh ? zh.length * 190 : 0;

  // 首选：打包音频念单词，放完之后再用 TTS 念释义
  const url = en ? bundledUrl(en, accent) : null;
  if (url) {
    stopSpeaking();
    playAudioThen(url, enMs, () => {
      if (zh) queue([{ text: zh, kind: 'zh', rate: 1, ms: zhMs }]);
    });
    return { ok: true, ms: enMs + zhMs };
  }

  if (!isSupported()) return { ok: false, ms: 0 };
  const items = [];
  if (en) items.push({ text: en, kind: accent, rate, ms: enMs });
  if (zh) items.push({ text: zh, kind: 'zh', rate: 1, ms: zhMs });
  if (!items.length) return { ok: false, ms: 0 };
  const ok = queue(items);
  return { ok, ms: items.reduce((a, b) => a + b.ms, 0) };
}

export function stopSpeaking() {
  stopAudio();
  if (BRIDGE) nativeCancel();
  if (!webSpeech) return;
  try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
}

export function speechSupported() {
  return isSupported();
}

/* ------------------------------------------------------------------ 自检 */

/** 真念一句，等事件回来说结果；超时也算一种结果 */
function probeUtterance(text, kind) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (s) => { if (!done) { done = true; resolve(s); } };
    const timer = setTimeout(() => finish('超时（1.5 秒内既没 start 也没 end）'), 1500);
    try {
      const u = new SpeechSynthesisUtterance(text);
      const v = pickVoice(kind);
      if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = kind === 'zh' ? 'zh-CN' : 'en-US'; }
      u.rate = 1;
      u.onstart = () => clearTimeout(timer);
      u.onend = () => { clearTimeout(timer); finish('念完了（start → end 都收到了）'); };
      u.onerror = (e) => { clearTimeout(timer); finish('失败：' + (e && e.error ? e.error : '未知错误')); };
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch (e) {
      clearTimeout(timer);
      finish('抛异常：' + (e && e.message ? e.message : e));
    }
  });
}

/**
 * 发音自检：把「走的是哪条路、系统里有哪些嗓子、真念一句成不成」一次性问清楚。
 * 排查无声问题时，这个比猜有用得多。
 * @returns {Promise<string>} 多行纯文本报告
 */
export async function diagnose() {
  const L = [];
  L.push('时间：' + new Date().toLocaleString());
  L.push('外壳：' + (BRIDGE ? (BRIDGE.kind === 'windows' ? 'Windows 壳（宿主对象 WordPlanTts）' : 'Android 壳（AndroidTTS）') : '纯浏览器'));
  L.push('Web Speech 接口：' + (webSpeech ? '存在' : '不存在'));

  if (BRIDGE) {
    try {
      const a = BRIDGE.kind === 'android' ? BRIDGE.api.available() : BRIDGE.api.Available();
      L.push('原生语音引擎可用：' + a);
    } catch (e) { L.push('问「可用吗」时出错：' + (e && e.message ? e.message : e)); }
    try {
      const v = BRIDGE.kind === 'android' ? BRIDGE.api.voices() : BRIDGE.api.Voices();
      L.push('系统嗓子列表：' + v);
    } catch (e) { L.push('取嗓子列表出错：' + (e && e.message ? e.message : e)); }
    try {
      const ok = BRIDGE.kind === 'android'
        ? BRIDGE.api.speak('test', 'us', 1)
        : BRIDGE.api.Speak('test', 'us', 1);
      L.push('原生桥实念一句（test / 美音）：' + ok);
    } catch (e) { L.push('原生桥实念出错：' + (e && e.message ? e.message : e)); }
  }

  if (webSpeech) {
    refresh();
    L.push('浏览器语音数：' + voices.length);
    voices.slice(0, 10).forEach((v) => L.push('   · ' + v.name + ' / ' + v.lang));
    L.push('Web Speech 实念一句：' + (await probeUtterance('test', 'us')));
  }

  if (!BRIDGE && !webSpeech) L.push('两条路都没有，肯定没声。');
  return L.join('\n');
}
