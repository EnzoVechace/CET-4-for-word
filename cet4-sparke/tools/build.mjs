// Build CET-4 / 星火《四级词汇周计划》-compatible vocabulary exports.
// Input : raw/CET4_T.json  (Qwerty Learner community CET-4 word list, 2607 words)
// Output: output/*  (Qwerty Learner JSON, weekly splits, CSV, Anki TSV, plain list)
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

const here = path.dirname(url.fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const outDir = path.join(root, 'output')
fs.mkdirSync(outDir, { recursive: true })

const words = JSON.parse(fs.readFileSync(path.join(root, 'raw', 'CET4_T.json'), 'utf8'))

// --- normalise: keep only Qwerty-Leaner fields, guarantee {name, trans[]} ---
const clean = words.map((w) => {
  const o = { name: String(w.name).trim(), trans: (Array.isArray(w.trans) ? w.trans : [w.trans]).filter(Boolean).map(String) }
  if (w.usphone) o.usphone = String(w.usphone)
  if (w.ukphone) o.ukphone = String(w.ukphone)
  return o
})

// de-dup defensively (keeps first occurrence = higher frequency position)
const seen = new Set()
const list = clean.filter((w) => {
  const k = w.name.toLowerCase()
  if (seen.has(k)) return false
  seen.add(k)
  return true
})

const WEEKS = 7
const perWeek = Math.ceil(list.length / WEEKS)

const writeJson = (file, data) => fs.writeFileSync(path.join(outDir, file), JSON.stringify(data, null, 2), 'utf8')

// 1. full dictionary
writeJson('cet4_xinghuo_full.json', list)

// 2. weekly splits (7 weeks, book-style study plan)
const weekMeta = []
for (let w = 0; w < WEEKS; w++) {
  const chunk = list.slice(w * perWeek, (w + 1) * perWeek)
  if (!chunk.length) continue
  writeJson(`cet4_xinghuo_week${w + 1}.json`, chunk)
  weekMeta.push({ week: w + 1, count: chunk.length, from: w * perWeek + 1, to: w * perWeek + chunk.length })
}

// 3. CSV (UTF-8 BOM so Excel / Numbers open it correctly)
const csvCell = (s) => '"' + String(s).replace(/"/g, '""') + '"'
const csv = [
  'word,translation,usphone,ukphone,week',
  ...list.map((w, i) => [w.name, w.trans.join(' | '), w.usphone || '', w.ukphone || '', Math.floor(i / perWeek) + 1].map(csvCell).join(',')),
].join('\r\n')
fs.writeFileSync(path.join(outDir, 'cet4_xinghuo.csv'), '\ufeff' + csv, 'utf8')

// 4. Anki import (TSV: front \t back)
const tsv = list.map((w) => `${w.name}\t${w.trans.join('；')}`).join('\n')
fs.writeFileSync(path.join(outDir, 'cet4_xinghuo_anki.txt'), tsv, 'utf8')

// 5. plain word list, one per line
fs.writeFileSync(path.join(outDir, 'cet4_xinghuo_wordlist.txt'), list.map((w) => w.name).join('\n') + '\n', 'utf8')

console.log(JSON.stringify({ total: list.length, perWeek, weeks: weekMeta }, null, 2))
