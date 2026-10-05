/**
 * 把每个单词的发音抓下来，打包进软件里——这样用户不用装任何 TTS 引擎。
 *
 * 音源：有道 `https://dict.youdao.com/dictvoice?audio=<词>&type=2`（美音）/ `type=1`（英音），
 *       返回 64 kbps / 12 kHz 单声道 MP3。
 * 如果 build/ffmpeg/ 下有 ffmpeg（跑 `node tools/get_ffmpeg.mjs`），就顺手转成
 *       ~16 kbps 单声道 Ogg Opus，体积能小到 1/7；没有就原样存 MP3。
 *
 * 输出：public/audio/<us|uk>/<slug>.ogg（或 .mp3）
 *   slug = 词条的「主形」小写，非字母数字一律换成下划线。
 *   主形用的是 public/js/dict.js 里那个 altForms()，跟判分逻辑同一套，
 *   所以 program(me) 查的是 programme、a/an 查的是 a。
 *
 * usage:
 *   node tools/fetch_audio.mjs                 # 两种口音全抓（增量，已有文件跳过）
 *   node tools/fetch_audio.mjs --accent=us     # 只抓美音
 *   node tools/fetch_audio.mjs --limit=50      # 只抓前 50 个词，先看看效果
 *   node tools/fetch_audio.mjs --redo          # 忽略已有文件重抓
 */
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { altForms } from '../public/js/dict.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DICT_DIR = path.join(ROOT, 'public', 'dict');
const AUDIO_DIR = path.join(ROOT, 'public', 'audio');
const FFMPEG_DIR = path.join(ROOT, 'build', 'ffmpeg');

const args = process.argv.slice(2);
const argOf = (k, d) => {
  const hit = args.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.split('=')[1] : d;
};
const LIMIT = Number(argOf('limit', 0));
const REDO = args.includes('--redo');
const ACCENT_ARG = argOf('accent', 'both');
const ACCENTS = ACCENT_ARG === 'both' ? ['us', 'uk'] : [ACCENT_ARG];
const CONC = Number(argOf('conc', 6));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';

/* --------------------------------------------------------------- ffmpeg */

function findFfmpeg() {
  if (!fs.existsSync(FFMPEG_DIR)) return null;
  const found = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/^ffmpeg\.exe$/i.test(e.name)) found.push(p);
    }
  })(FFMPEG_DIR);
  return found[0] || null;
}
const FFMPEG = findFfmpeg();
const EXT = FFMPEG ? '.ogg' : '.mp3';
console.log(FFMPEG
  ? `用 ffmpeg 转 Ogg Opus：${FFMPEG}`
  : '没找到 ffmpeg —— 原样存 MP3（体积会大 6～7 倍；想瘦身就跑 node tools/get_ffmpeg.mjs）');

/* ---------------------------------------------------------------- 工具 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

/**
 * 文件名的 slug：词条的「主形」小写，非字母数字换下划线。
 * 必须和网页端 speech.js 的 audioSlug() 算出来一模一样，否则查不到文件。
 */
function slugOf(word) {
  const plain = altForms(word)[0] || String(word).toLowerCase();
  return slugify(plain) || 'x';
}

/**
 * 查有道的候选词形，按优先级排。
 * 书里有些词条是「angle1 / angle2」「lean1」这种加尾号区分同形异义的写法，
 * 直接拿 angle1 去查必然查不到；还有 behavio(u)r 这类，主形查不到时可以试另一种拼法。
 */
function queryCandidates(word) {
  const raw = String(word || '').trim();
  const out = [];
  const push = (s) => {
    const v = String(s || '').replace(/\s+/g, ' ').trim();
    if (v && !out.includes(v)) out.push(v);
  };
  // 书里用尾号或圆圈数字标同形异义：angle1 / calf① / hack②，查词时都要去掉
  const bare = raw.replace(/[\d①-⑩]+$/g, '').trim();
  push(altForms(raw)[0]);                       // 主形
  if (bare && bare !== raw) {
    push(altForms(bare)[0]);
    push(bare);
  }
  for (const f of altForms(raw)) push(f);       // 其它拼法
  push(raw);                                    // 原样兜底
  return out;
}

function fetchOnce(url, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': UA } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        const err = new Error('HTTP ' + res.statusCode);
        err.status = res.statusCode;
        reject(err);
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

/** 有道失败时会回 JSON/HTML；认一下 MP3 或 WAV 的文件头 */
function sniffAudio(buf) {
  if (buf.length < 512) return null;
  if (buf.subarray(0, 3).toString('ascii') === 'ID3') return 'mp3';
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return 'mp3';
  // 有时候回的是未压缩 WAV（RIFF....WAVE），ffmpeg 一样能转
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WAVE') return 'wav';
  return null;
}

/**
 * 抓一个词的发音。逐个候选词形试，每个词形最多 tries 次。
 * HTTP 500 是有道在限流，退避给足一点。
 * @returns {{buf: Buffer, kind: string, query: string}}
 */
async function grabAudio(word, accent, tries = 4) {
  const type = accent === 'uk' ? 1 : 2;
  const cands = queryCandidates(word);
  let last = null;
  for (const query of cands) {
    const url = `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(query)}&type=${type}`;
    for (let i = 0; i < tries; i += 1) {
      try {
        const buf = await fetchOnce(url);
        const kind = sniffAudio(buf);
        if (!kind) {
          throw new Error(`不是音频（${buf.length} B，开头 ${JSON.stringify(buf.subarray(0, 24).toString('utf8'))}）`);
        }
        return { buf, kind, query };
      } catch (e) {
        last = e;
        // 限流就多睡一会儿
        await sleep((e.status === 500 ? 900 : 400) * (i + 1));
      }
    }
  }
  throw last || new Error('unknown');
}

/* ------------------------------------------------------------------ 主流程 */

const decks = fs.readdirSync(DICT_DIR).filter((f) => f.endsWith('.json') && f !== 'full.json');
const words = [];
for (const f of decks.sort()) {
  const data = JSON.parse(fs.readFileSync(path.join(DICT_DIR, f), 'utf8'));
  for (const row of (Array.isArray(data) ? data : data.words)) {
    if (!words.includes(row[0])) words.push(row[0]);
  }
}
const target = LIMIT > 0 ? words.slice(0, LIMIT) : words;
console.log(`词库 ${words.length} 个唯一单词；本次处理 ${target.length} 个 × ${ACCENTS.length} 种口音`);

for (const a of ACCENTS) fs.mkdirSync(path.join(AUDIO_DIR, a), { recursive: true });

// 扩展名变了（装了 ffmpeg 之后 .mp3 → .ogg）就把旧格式清掉，
// 否则两种格式会一起被打进 APK/exe，白胖一倍
const STALE_EXT = EXT === '.ogg' ? '.mp3' : '.ogg';
for (const a of ACCENTS) {
  const dir = path.join(AUDIO_DIR, a);
  let n = 0;
  for (const f of fs.readdirSync(dir)) {
    if (f.toLowerCase().endsWith(STALE_EXT)) {
      try { fs.rmSync(path.join(dir, f), { force: true }); n += 1; } catch { /* ignore */ }
    }
  }
  if (n) console.log(`  清掉 ${n} 个旧格式 ${STALE_EXT}（${a}）`);
}

let done = 0;
let ok = 0;
let skip = 0;
const fails = [];
const t0 = Date.now();

async function one(word, accent) {
  const out = path.join(AUDIO_DIR, accent, slugOf(word) + EXT);
  if (!REDO && fs.existsSync(out) && fs.statSync(out).size > 256) {
    skip += 1;
    done += 1;
    return;
  }
  let got;
  try {
    got = await grabAudio(word, accent);
  } catch (e) {
    fails.push(`${word}/${accent}: ${e.message}`);
    done += 1;
    return;
  }
  try {
    if (FFMPEG) {
      const tmp = out.replace(/\.ogg$/, `.src.${got.kind}`);
      fs.writeFileSync(tmp, got.buf);
      const r = spawnSync(FFMPEG, [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-i', tmp,
        '-c:a', 'libopus', '-b:a', '16k', '-ac', '1', '-ar', '24000', '-application', 'voip',
        out,
      ], { stdio: 'ignore' });
      try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
      if (r.status !== 0) throw new Error('ffmpeg 退出码 ' + r.status);
    } else {
      fs.writeFileSync(out, got.buf);
    }
    ok += 1;
  } catch (e) {
    fails.push(`${word}/${accent}: 写文件失败 ${e.message}`);
  }
  done += 1;
  if (done % 40 === 0) {
    const secs = (Date.now() - t0) / 1000;
    const rate = done / Math.max(1, secs);
    console.log(`  ${done}/${target.length * ACCENTS.length}  新抓 ${ok}  跳过 ${skip}  失败 ${fails.length}  ${rate.toFixed(1)}/s  还要约 ${Math.round((target.length * ACCENTS.length - done) / Math.max(0.1, rate) / 60)} 分钟`);
  }
}

const queue = [];
for (const w of target) for (const a of ACCENTS) queue.push([w, a]);
let cursor = 0;
async function worker() {
  while (cursor < queue.length) {
    const i = cursor;
    cursor += 1;
    await one(queue[i][0], queue[i][1]);
    await sleep(60);
  }
}
await Promise.all(Array.from({ length: CONC }, () => worker()));

let bytes = 0;
let files = 0;
for (const a of ACCENTS) {
  const dir = path.join(AUDIO_DIR, a);
  for (const f of fs.readdirSync(dir)) {
    bytes += fs.statSync(path.join(dir, f)).size;
    files += 1;
  }
}
console.log(`\n完成：新抓 ${ok}，跳过 ${skip}，失败 ${fails.length}`);
console.log(`音频总量 ${(bytes / 1048576).toFixed(2)} MB（${EXT}），共 ${files} 个文件`);

/* 网页端要靠这份清单知道「扩展名是什么」「有哪几种口音」，
   免得在 .ogg / .mp3 之间瞎猜、或者去请求一个不存在的目录 */
const manifest = {
  generatedAt: new Date().toISOString(),
  ext: EXT,
  codec: FFMPEG ? 'opus' : 'mp3',
  accents: ACCENTS.filter((a) => fs.existsSync(path.join(AUDIO_DIR, a))),
  count: files,
};
fs.writeFileSync(path.join(AUDIO_DIR, 'manifest.json'), JSON.stringify(manifest, null, 1), 'utf8');
console.log(`清单：public/audio/manifest.json  ${JSON.stringify(manifest)}`);

if (fails.length) {
  console.log('失败清单（前 20 条）：');
  fails.slice(0, 20).forEach((f) => console.log('  ' + f));
  fs.writeFileSync(path.join(ROOT, 'build', 'audio-fails.txt'), fails.join('\n'), 'utf8');
  console.log(`完整清单已写到 build/audio-fails.txt（共 ${fails.length} 条）`);
}
