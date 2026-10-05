/**
 * 拉取 Collins COBUILD 义项数据（有道「权威英汉双解」），用于标注「高频释义」。
 *
 * 为什么用这个：星火《四级词汇周计划》书里那份高频释义标注只印在纸上，官方资源包里
 * 只有 MP3 + 对应 .lrc（.lrc 里只有单词，没有释义）+ 一个基础词汇 PDF，拿不到。
 * 退而求其次，用 Collins COBUILD 语料库的义项排序（有道权威词典就是按它排的）作为
 * 「语料级高频义项」的依据——这是真实语料频次，不是「第一个义项」那种瞎猜。
 *
 * 用法：
 *   node tools/fetch_collins.mjs            # 抓全部（增量：已有缓存的跳过）
 *   node tools/fetch_collins.mjs --limit=80 # 只抓前 80 个，用来抽样看效果
 *   node tools/fetch_collins.mjs --redo     # 无视缓存重抓
 */
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DICT_DIR = path.join(ROOT, 'public', 'dict');
const OUT = path.join(ROOT, 'build', 'collins.json');

const DICTS = '{"count":99,"dicts":[["collins"],["ec"]]}';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';

const args = process.argv.slice(2);
const LIMIT = Number((args.find((a) => a.startsWith('--limit=')) || '').split('=')[1] || 0);
const REDO = args.includes('--redo');

/* ------------------------------------------------------------------ 网络 */

function fetchOnce(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': UA } }, (r) => {
      if (r.statusCode !== 200) {
        r.resume();
        reject(new Error('HTTP ' + r.statusCode));
        return;
      }
      let b = '';
      r.setEncoding('utf8');
      r.on('data', (c) => (b += c));
      r.on('end', () => resolve(b));
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

async function fetchJSON(word, tries = 3) {
  const url =
    'https://dict.youdao.com/jsonapi?q=' +
    encodeURIComponent(word) +
    '&dicts=' +
    encodeURIComponent(DICTS);
  let last = null;
  for (let i = 0; i < tries; i += 1) {
    try {
      return JSON.parse(await fetchOnce(url));
    } catch (e) {
      last = e;
      await sleep(300 * (i + 1));
    }
  }
  throw last || new Error('unknown');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* -------------------------------------------------------------- 解析 */

const stripTags = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

/** Collins 的 tran 是「英文定义 + 词尾中文简释」，把尾巴上的中文切出来 */
function splitCollinsTran(tran) {
  const t = stripTags(tran);
  const m = t.match(/[.。;；:：]\s*([^.;。；]*[\u4e00-\u9fff][^.;。；]*)\s*$/);
  if (!m) return { def: t, gloss: '' };
  return { def: t.slice(0, t.length - m[1].length).trim(), gloss: m[1].trim() };
}

/** 抽出按语料频次排序的义项列表 */
export function collinsSenses(json) {
  const out = [];
  const ce = json && json.collins && json.collins.collins_entries;
  if (!Array.isArray(ce)) return out;
  for (const entry of ce) {
    const list = entry.entries && entry.entries.entry;
    if (!Array.isArray(list)) continue;
    for (const s of list) {
      const te = Array.isArray(s.tran_entry) ? s.tran_entry[0] : null;
      if (!te) continue;
      const pos = (te.pos_entry && te.pos_entry.pos) || '';
      const { def, gloss } = splitCollinsTran(te.tran);
      if (!gloss) continue;
      out.push({ pos, gloss, def });
    }
  }
  return out;
}

/** 有道偶尔缺 collins，退回 simple 的释义（没有频次信息，标个 source 好区分） */
function simpleLines(json) {
  const w = json && json.simple && json.simple.word;
  if (!Array.isArray(w) || !w[0]) return [];
  const trs = w[0].trs || [];
  return trs.map((t) => stripTags((t.tr && t.tr[0] && t.tr[0].l && t.tr[0].l.i) || '')).filter(Boolean);
}

/* ------------------------------------------------------------------ 主流程 */

/**
 * 书上很多词条是「可选写法」的记法：program(me)、harbo(u)r、realize,-ise、behavio(u)r。
 * 拿这些原文去 Collins 一条都查不到，所以把它们真正可能的拼法也一并抓下来，
 * 建库时就能按变体取到义项频次。
 */
const deriveForms = (name) => {
  const out = [];
  // angle1 / lean2 / converse1 是书上区分同形异义词的尾号，Collins 里没有这种拼法
  if (/\d$/.test(name)) out.push(name.replace(/\d+$/, ''));
  if (name.includes('(')) {
    out.push(name.replace(/\(([^)]*)\)/g, '$1'), name.replace(/\([^)]*\)/g, ''));
  }
  if (/[\/,]/.test(name)) {
    const parts = name.split(/[\/,]/).map((x) => x.trim());
    out.push(parts[0]);
    if (parts[1] && parts[1].startsWith('-') && parts[0].length >= parts[1].length) {
      out.push(parts[0].slice(0, parts[0].length - parts[1].length) + parts[1].slice(1));
    } else {
      parts.slice(1).forEach((p) => out.push(p));
    }
  }
  return out;
};

const decks = fs.readdirSync(DICT_DIR).filter((f) => f.endsWith('.json') && f !== 'full.json');
const words = [];
const add = (w) => {
  const v = String(w || '').trim();
  if (v && !words.includes(v)) words.push(v);
};
for (const f of decks.sort()) {
  const data = JSON.parse(fs.readFileSync(path.join(DICT_DIR, f), 'utf8'));
  const list = Array.isArray(data) ? data : data.words;
  for (const row of list) {
    add(row[0]);
    deriveForms(row[0]).forEach(add);
  }
}
console.log(`词库共 ${words.length} 个唯一单词，来自 ${decks.length} 个词库文件`);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
const cache = fs.existsSync(OUT) && !REDO ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
console.log(`已有缓存 ${Object.keys(cache).length} 条${REDO ? '（--redo，忽略）' : ''}`);

const target = LIMIT > 0 ? words.slice(0, LIMIT) : words;
let done = 0;
let fetched = 0;
let empty = 0;
const t0 = Date.now();

for (const word of target) {
  if (cache[word]) {
    done += 1;
    continue;
  }
  let json = null;
  try {
    json = await fetchJSON(word);
  } catch (e) {
    cache[word] = { error: String(e.message || e) };
    continue;
  }
  const senses = collinsSenses(json);
  const star =
    json.collins && json.collins.collins_entries && json.collins.collins_entries[0]
      ? json.collins.collins_entries[0].star
      : null;
  cache[word] = {
    star: star == null ? null : String(star),
    senses,
    fallback: senses.length ? null : simpleLines(json),
  };
  fetched += 1;
  if (!senses.length) empty += 1;
  done += 1;

  if (fetched % 25 === 0) {
    fs.writeFileSync(OUT, JSON.stringify(cache));
    const secs = (Date.now() - t0) / 1000;
    const rate = fetched / secs;
    const left = (target.length - done) / (rate || 1);
    console.log(
      `  ${done}/${target.length}  已抓 ${fetched}  没义项 ${empty}  ${rate.toFixed(2)}/s  预计还要 ${Math.round(left / 60)} 分钟`
    );
  }
  await sleep(110);
}

fs.writeFileSync(OUT, JSON.stringify(cache));
const withSenses = Object.values(cache).filter((v) => v.senses && v.senses.length).length;
console.log(`\n完成：缓存 ${Object.keys(cache).length} 条，其中有 Collins 义项的 ${withSenses} 条`);
console.log(`输出 ${OUT}`);
