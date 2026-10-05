/**
 * 「高频释义」标注规则。
 *
 * 背景：星火《四级词汇周计划》书里那份高频释义标注只印在纸上，官方资源包里没有
 * （包里只有 MP3 + 对应 .lrc + 一个基础词汇 PDF，.lrc 里只有单词）。
 * 这里用 Collins COBUILD 语料库的义项频次序（有道「权威英汉双解」就是按它排的）
 * 作为「语料级高频义项」的依据 —— 是真实语料频次，不是「排在第一个的义项」。
 *
 * 规则：按 Collins 频次顺序走，记下每个词性第一次出现的位置；
 * 取前 WINDOW 条里最先出现的至多 CAP 个词性，各标该词性那一条释义的第一个义项。
 */

/** Collins 的词性串（"V-T/V-I" / "N-COUNT" / "ADJ"）→ 我们的词性 */
export function collinsPos(raw) {
  const s = String(raw || '').toUpperCase();
  if (s.startsWith('ADJ')) return 'adj';
  if (s.startsWith('ADV')) return 'adv';
  if (s.startsWith('PREP')) return 'prep';
  if (s.startsWith('CONJ')) return 'conj';
  if (s.startsWith('PRON')) return 'pron';
  if (s.startsWith('NUM')) return 'num';
  if (s.startsWith('DET') || s.startsWith('ART')) return 'art';
  if (s.startsWith('N')) return 'n';
  if (s.startsWith('V')) return 'v';
  // 短语、量词、感叹语：我们释义里没有对应词性，但要留个记号好让 pickHf 知道「这里有义项」
  if (s.startsWith('PHRASE') || s.startsWith('QUANT') || s.startsWith('EXCLAM') || s.startsWith('CONVENTION')) return 'phrase';
  return '';
}

/** 我们释义行的词性（"n. 重点，…" → "n"） */
export function ecPos(line) {
  const m = String(line).match(/^\s*([a-z]+)\./i);
  if (!m) return '';
  const p = m[1].toLowerCase();
  if (p === 'v' || p === 'vt' || p === 'vi') return 'v';
  if (p === 'a' || p === 'adj') return 'adj';
  if (p === 'ad' || p === 'adv') return 'adv';
  return p;
}

export const WINDOW = 5;
export const CAP = 2;
export const MIN_HITS = 2;

/**
 * 取 Collins 前 WINDOW 条义项，按词性统计出现次数：
 *   - 出现 ≥ MIN_HITS 次的词性，各标「那个词性那一行的第一个义项」
 *   - 若一个都不够次数，就退回标 Collins 排第一的那个词性
 *   - 最多标 CAP 条
 * 排序先看次数多的，再看在 Collins 里先出现的。
 *
 * @param {{pos:string,gloss:string}[]} collins  Collins 频次序义项
 * @param {string[]} trans                     我们的释义行（每条一个词性）
 * @returns {[number, number][]}               要标的 [行号, 行内第几个义项]
 */
export function pickHf(collins, trans, { window = WINDOW, cap = CAP, minHits = MIN_HITS } = {}) {
  if (!Array.isArray(collins) || !collins.length || !Array.isArray(trans) || !trans.length) return [];
  const head = collins.slice(0, window);
  const stat = new Map(); // pos -> {count, first}
  head.forEach((s, i) => {
    const p = collinsPos(s.pos);
    if (!p) return;
    const cur = stat.get(p) || { count: 0, first: i };
    cur.count += 1;
    stat.set(p, cur);
  });
  if (!stat.size) return [];

  const ranked = [...stat.entries()].sort((a, b) => b[1].count - a[1].count || a[1].first - b[1].first);
  let chosen = ranked.filter(([, v]) => v.count >= minHits).map(([p]) => p);
  if (!chosen.length) chosen = [ranked[0][0]];

  const marks = [];
  const used = new Set();
  for (const p of chosen.slice(0, cap)) {
    let idx = trans.findIndex((l) => ecPos(l) === p);
    // Collins 给的词性是 NUM / QUANT / PHRASE 这类我们释义行里没有的，
    // 或者两边词性对不上（比如 Collins 认为 dozen 是 NUM、我们写成 n.），
    // 就退回该词的第一条释义 —— 总比整条不标强。
    if (idx < 0) idx = 0;
    if (used.has(idx)) continue;
    used.add(idx);
    marks.push([idx, 0]);
  }
  return marks;
}
