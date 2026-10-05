/* 词计划 · 语音合成 ------------------------------------------------------ */

/* Android 壳（android/java/.../TtsBridge.java）会注入这个桥。
   它比 WebView 自带的 Web Speech 靠谱得多，所以有它就优先用它。 */
const ANDROID = (typeof window !== 'undefined'
  && window.AndroidTTS
  && typeof window.AndroidTTS.speak === 'function'
  && typeof window.AndroidTTS.available === 'function'
  && window.AndroidTTS.available())
  ? window.AndroidTTS
  : null;

let voices = [];
const webSpeech = typeof window !== 'undefined' && 'speechSynthesis' in window;
const supported = webSpeech || !!ANDROID;

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

const norm = (s) => String(s || '').replace('_', '-');

function voicesByLang(prefix) {
  if (!voices.length) refresh();
  const re = new RegExp(`^${prefix}`, 'i');
  return voices.filter((v) => re.test(norm(v.lang)));
}

export function voiceList() {
  if (ANDROID) {
    return [
      { name: '系统语音 · 美音', lang: 'en-US' },
      { name: '系统语音 · 英音', lang: 'en-GB' },
    ];
  }
  return voicesByLang('en');
}

export function chineseVoiceList() {
  if (ANDROID) return [{ name: '系统语音 · 中文', lang: 'zh-CN' }];
  return voicesByLang('zh');
}

/** 当前用的是不是 Android 壳里的系统语音（设置页拿它换文案） */
export function isAndroidTts() {
  return !!ANDROID;
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

/* Android 侧每次 speak 都会 QUEUE_FLUSH 掉上一句，所以「单词+释义」这种
   连续朗读得在 JS 里排期：读完单词的估算时长之后再喊释义。 */
let androidTimer = null;

function androidCancel() {
  if (androidTimer) {
    clearTimeout(androidTimer);
    androidTimer = null;
  }
  try { ANDROID.stop(); } catch { /* ignore */ }
}

function androidQueue(items) {
  androidCancel();
  let delay = 0;
  for (const it of items) {
    if (delay === 0) {
      try { ANDROID.speak(it.text, it.kind, it.rate); } catch { /* ignore */ }
    } else {
      androidTimer = setTimeout(() => {
        androidTimer = null;
        try { ANDROID.speak(it.text, it.kind, it.rate); } catch { /* ignore */ }
      }, delay);
    }
    delay += Math.max(400, it.ms || 1200);
  }
  return true;
}

function queue(items) {
  if (ANDROID) return androidQueue(items);
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
  if (!supported) return false;
  const clean = cleanForSpeech(text);
  if (!clean) return false;
  return queue([{
    text: clean,
    kind: opts.accent === 'uk' ? 'uk' : 'us',
    rate: typeof opts.rate === 'number' ? opts.rate : 0.9,
  }]);
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
  if (!supported) return { ok: false, ms: 0 };
  const items = [];
  const en = cleanForSpeech(word);
  const rate = typeof opts.rate === 'number' ? opts.rate : 0.9;
  if (en) {
    items.push({
      text: en, kind: opts.accent === 'uk' ? 'uk' : 'us', rate,
      ms: Math.max(600, (en.length * 115) / rate),
    });
  }
  const zh = cleanMeaningForSpeech(meaning);
  if (zh) items.push({ text: zh, kind: 'zh', rate: 1, ms: zh.length * 190 });
  if (!items.length) return { ok: false, ms: 0 };
  const ok = queue(items);
  return { ok, ms: items.reduce((a, b) => a + b.ms, 0) };
}

export function stopSpeaking() {
  if (ANDROID) {
    androidCancel();
    return;
  }
  if (!supported) return;
  try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
}

export function speechSupported() {
  return supported;
}
