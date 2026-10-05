/** 试算「高频释义」标注规则：拿已抓的 Collins 缓存 + 词库里的 ec 释义，打印各种规则的结果对比 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cache = JSON.parse(fs.readFileSync(path.join(ROOT, 'build', 'collins.json'), 'utf8'));
const decks = fs.readdirSync(path.join(ROOT, 'public', 'dict')).filter((f) => f.endsWith('.json') && f !== 'full.json');
const byWord = new Map();
for (const f of decks) {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'dict', f), 'utf8'));
  for (const row of (Array.isArray(data) ? data : data.words)) if (!byWord.has(row[0])) byWord.set(row[0], row);
}

/** Collins 的词性 → 我们的词性 */
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

/**
 * 规则：按 Collins 语料频次顺序走，每遇到一个新词性，
 * 就在我们的释义里找**那个词性那一行**，把它排在最前的义项标为高频。
 * window 限制只看 Collins 前 N 条；cap 限制最多标几条。
 */
export function pickHf(collins, ecLines, { window: win = 6, cap = 2 } = {}) {
  const marks = [];
  const seen = new Set();
  for (let i = 0; i < collins.length && i < win; i += 1) {
    const p = collinsPos(collins[i].pos);
    if (!p || seen.has(p)) continue;
    seen.add(p);
    const idx = ecLines.findIndex((l) => ecPos(l) === p);
    if (idx >= 0) marks.push([idx, 0]);
    if (marks.length >= cap) break;
  }
  return marks;
}

/** 把释义行按「；」拆成义项，标出第 n 条 */
function render(line, senseIdx) {
  const parts = String(line).replace(/^[a-z]+\.\s*/i, '').split(/([；;])/);
  const senses = [];
  for (let i = 0; i < parts.length; i += 2) senses.push(parts[i]);
  return senses.map((s, i) => (i === senseIdx ? `【${s.trim()}】` : s.trim())).join('；');
}

const words = process.argv.slice(2);
const list = words.length ? words : Object.keys(cache);
let shown = 0;
for (const w of list) {
  const c = cache[w];
  const row = byWord.get(w);
  if (!c || !c.senses || !row) continue;
  const ec = row[1] || [];
  const a = pickHf(c.senses, ec, { window: 3, cap: 2 });
  const b = pickHf(c.senses, ec, { window: 6, cap: 2 });
  const dump = (m) => (m.length ? m.map(([i]) => render(ec[i], 0)).join('  |  ') : '（不标）');
  console.log(`\n=== ${w} === star=${c.star || '-'}`);
  console.log(`  Collins 前 4: ${c.senses.slice(0, 4).map((s) => collinsPos(s.pos) + '.' + s.gloss).join(' / ')}`);
  console.log(`  win3: ${dump(a)}`);
  console.log(`  win6: ${dump(b)}`);
  shown += 1;
  if (shown >= 28) break;
}
