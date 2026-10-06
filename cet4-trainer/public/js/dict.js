/* 词计划 · 词库加载 ------------------------------------------------------ */

let indexPromise = null;
const deckCache = new Map();

/**
 * 读一份 JSON。正常（服务器 / PWA）走 fetch；
 * 单文件离线版会把全部词库塞进 window.__EMBEDDED_DICTS，此时直接用内存里的，
 * 这样从手机下载目录双击打开、没网也能用。
 */
async function fetchJSON(url) {
  const embedded = typeof window !== 'undefined' && window.__EMBEDDED_DICTS;
  if (embedded) {
    const key = String(url).replace(/^\.?\//, '');
    if (Object.prototype.hasOwnProperty.call(embedded, key)) return embedded[key];
  }
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${url} 加载失败（HTTP ${res.status}）`);
  return res.json();
}

export function loadIndex() {
  if (!indexPromise) indexPromise = fetchJSON('data/dicts.json');
  return indexPromise;
}

export async function deckMeta(id) {
  const idx = await loadIndex();
  return (idx.dicts || []).find((d) => d.id === id) || null;
}

/**
 * 书上很多词条是「可选写法」的记法，判分时这些都算对：
 *   program(me)   → program / programme
 *   harbo(u)r     → harbor / harbour
 *   a/an          → a / an
 *   OK/okay       → ok / okay
 *   fiber/-bre    → fiber / fibre（右侧以 - 开头表示「换掉这一截后缀」）
 *   realize,-ise  → realize / realise
 *   theater/-tre  → theater / theatre
 * 返回值里第一个是「主形」（去掉括号、取分隔符前那半），用来做提示和揭晓答案；
 * 其余是同样算对的别写法。
 */
export function altForms(raw) {
  const s = String(raw || '').trim();
  if (!s) return [''];
  let base = s;
  const extra = [];

  // 斜杠和逗号都是「另有写法」的分隔符：fiber/-bre、realize,-ise、a/an
  if (/[\/,]/.test(s)) {
    const parts = s.split(/[\/,]/).map((x) => x.trim()).filter(Boolean);
    if (parts.length === 2 && parts[1].startsWith('-')) {
      const head = parts[0];
      const suf = parts[1].slice(1);
      base = head;
      if (suf && head.length >= suf.length) extra.push(head.slice(0, head.length - suf.length) + suf);
    } else {
      base = parts[0];
      parts.slice(1).forEach((p) => {
        if (p.startsWith('-')) return;
        extra.push(p);
      });
    }
  }

  const expand = (t) => {
    const out = [];
    if (t.includes('(')) {
      out.push(t.replace(/\(([^)]*)\)/g, '$1')); // 括号内容收进来：program(me) → programme
      out.push(t.replace(/\([^)]*\)/g, '')); // 括号整段丢掉：program(me) → program
    }
    out.push(t.replace(/[()]/g, ''));
    return out;
  };

  const seen = new Set();
  const list = [];
  for (const form of [...expand(base), ...extra.flatMap(expand)]) {
    const v = form.replace(/\s+/g, ' ').trim().toLowerCase();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    list.push(v);
  }
  return list.length ? list : [s.toLowerCase()];
}

function normalize(raw) {
  const words = (raw.words || []).map((row, i) => {
    const alts = altForms(row[0]);
    return {
      w: row[0],
      trans: Array.isArray(row[1]) ? row[1] : [String(row[1] || '')],
      us: row[2] || '',
      uk: row[3] || '',
      group: row[4] || '',
      // 高频释义：[[释义行号, 行内义项序号], ...]，来自 Collins COBUILD 语料库的义项频次序
      hf: Array.isArray(row[5]) ? row[5] : [],
      // 判分用的可接受写法（第一个是主形），例如 program(me) → ['program','programme']
      alts,
      plain: alts[0],
      i,
    };
  });
  return { id: raw.id, name: raw.name, sub: raw.sub, words };
}

/**
 * 载入一个词库（支持 compose 虚拟词库）。
 * @param {string} id
 * @returns {Promise<{id:string,name:string,sub:string,words:Array}>}
 */
export async function loadDeck(id) {
  if (deckCache.has(id)) return deckCache.get(id);
  const p = (async () => {
    const meta = await deckMeta(id);
    if (!meta) throw new Error(`未知词库 ${id}`);
    if (meta.compose && meta.compose.length) {
      const parts = await Promise.all(meta.compose.map((cid) => loadDeck(cid)));
      // 每个分册的 i 都是「册内序号」（0..249），拼起来必须重排成整本的位置，
      // 否则「学到哪儿了」的游标和「第 N / 总数 词」都会错 —— 全书词库会一直从第一个词重来。
      // 不能就地改，week1 那份对象被缓存的单册词库共用着。
      const words = parts.flatMap((part) => part.words).map((w, i) => (w.i === i ? w : Object.assign({}, w, { i })));
      return { id: meta.id, name: meta.name, sub: meta.sub, words };
    }
    const raw = await fetchJSON(`dict/${meta.file || `${id}.json`}`);
    return normalize(raw);
  })();
  deckCache.set(id, p);
  return p;
}

/** 预取但不等待 */
export function prefetchDeck(id) {
  loadDeck(id).catch(() => {});
}

export async function allWords() {
  const deck = await loadDeck('full');
  return deck.words;
}
