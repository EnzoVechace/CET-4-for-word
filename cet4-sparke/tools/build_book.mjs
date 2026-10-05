// Build the final deliverables from the official Sparke word order + Youdao definitions.
// usage: node build_book.mjs
import fs from 'node:fs'
import path from 'node:path'

const DIR = 'C:/Users/31787/Documents/deepseek-harness/default-workspace/cet4-sparke'
const BOOK = path.join(DIR, 'sparke_pack/book_words.json')
const DEFS = path.join(DIR, 'dict/defs.json')
const QMAP = path.join(DIR, 'dict/query_map.json')
const CET4T = path.join(DIR, 'raw/CET4_T.json')
const OUT = path.join(DIR, 'output')
fs.mkdirSync(OUT, { recursive: true })

const book = JSON.parse(fs.readFileSync(BOOK, 'utf8'))
const defs = JSON.parse(fs.readFileSync(DEFS, 'utf8'))
const qmap = JSON.parse(fs.readFileSync(QMAP, 'utf8'))
const fallbackDict = fs.existsSync(CET4T) ? JSON.parse(fs.readFileSync(CET4T, 'utf8')) : []
const fbPhone = new Map()
for (const e of fallbackDict) {
  if (e.name) fbPhone.set(e.name.toLowerCase(), { us: e.usphone || null, uk: e.ukphone || null, trans: e.trans || [] })
}

// ---------------- helpers ----------------
const POS_RE = /^(n|v|vt|vi|adj|adv|prep|conj|pron|num|int|art|aux|abbr|a|ad)\.\s*/i

function briefLines(trans) {
  const out = []
  for (const line of trans) {
    const m = line.match(POS_RE)
    const pos = m ? m[0].trim() : ''
    const body = m ? line.slice(m[0].length) : line
    const senses = body
      .split(/[；;。]/)
      .map((s) => s.trim().replace(/[，,、]$/, ''))
      .filter(Boolean)
    const kept = senses.slice(0, 2).join('；')
    if (kept) out.push((pos ? pos + ' ' : '') + kept)
  }
  return out.length ? out : trans.slice(0, 1)
}

function lookup(word) {
  const vs = qmap[word] || [word]
  for (const v of vs) {
    const d = defs[v]
    if (d && d.trans && d.trans.length) return { hit: v, ...d }
  }
  return null
}

// ---------------- assemble ----------------
const entries = book.map((e) => {
  const d = lookup(e.word)
  const fb = fbPhone.get(e.word.replace(/[①②③④⑤]/g, '').toLowerCase())
  const trans = d ? d.trans : fb ? fb.trans : []
  const brief = d ? briefLines(d.trans) : fb ? fb.trans : []
  return {
    n: e.n,
    word: e.word,
    group: e.group,
    section: e.section,
    week: e.week,
    indexInGroup: e.indexInGroup,
    time: e.time,
    trans,
    brief,
    usphone: (d && d.usphone) || (fb && fb.us) || null,
    ukphone: (d && d.ukphone) || (fb && fb.uk) || null,
    defSource: d ? (d.source || 'youdao') : fb ? 'CET4_T' : null,
    query: d ? d.hit : null,
  }
})

const missing = entries.filter((e) => !e.trans.length)
console.log(`entries=${entries.length} withDefinitions=${entries.length - missing.length} missing=${missing.length}`)
if (missing.length) fs.writeFileSync(path.join(DIR, 'dict/missing_defs.txt'), missing.map((m) => m.word).join('\n'), 'utf8')

// ---------------- writers ----------------
function toQwerty(list, useBrief) {
  return list.map((e) => {
    const o = { name: e.word, trans: useBrief ? e.brief : e.trans }
    if (e.usphone) o.usphone = e.usphone
    if (e.ukphone) o.ukphone = e.ukphone
    return o
  })
}
function writeJson(file, data) {
  fs.writeFileSync(path.join(OUT, file), JSON.stringify(data, null, 1), 'utf8')
  const st = fs.statSync(path.join(OUT, file))
  console.log(`  ${file}  entries=${data.length}  ${(st.size / 1024).toFixed(0)}KB`)
}

console.log('\nJSON (Qwerty Learner):')
writeJson('cet4_zhoujihua_full.json', toQwerty(entries, false))
writeJson('cet4_zhoujihua_full_brief.json', toQwerty(entries, true))
for (let w = 1; w <= 7; w++) {
  const sub = entries.filter((e) => e.week === w)
  writeJson(`cet4_zhoujihua_week${w}.json`, toQwerty(sub, false))
}
writeJson('cet4_zhoujihua_cognitive.json', toQwerty(entries.filter((e) => e.section === 'cognitive'), false))

// CSV (UTF-8 BOM so Excel opens it correctly)
const csvEsc = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'
const csvRows = [['序号', '分组', '组内序号', '单词', '简要释义', '完整释义', '美音', '英音', '音轨时间'].map(csvEsc).join(',')]
for (const e of entries) {
  csvRows.push(
    [e.n, e.group, e.indexInGroup, e.word, e.brief.join('；'), e.trans.join(' | '), e.usphone || '', e.ukphone || '', e.time]
      .map(csvEsc)
      .join(','),
  )
}
fs.writeFileSync(path.join(OUT, 'cet4_zhoujihua.csv'), '\uFEFF' + csvRows.join('\r\n'), 'utf8')
console.log(`  cet4_zhoujihua.csv  rows=${entries.length}  ${(fs.statSync(path.join(OUT, 'cet4_zhoujihua.csv')).size / 1024).toFixed(0)}KB`)

// Anki TSV (note: Anki's default "Comma separated" import accepts tabs)
const anki = ['#separator:tab', '#html:false', '#columns:Word\tTranslation\tWeek']
for (const e of entries) anki.push([e.word, e.brief.join('；'), e.group].join('\t'))
fs.writeFileSync(path.join(OUT, 'cet4_zhoujihua_anki.txt'), anki.join('\n'), 'utf8')
console.log(`  cet4_zhoujihua_anki.txt  lines=${anki.length - 3}`)

// plain word list, grouped
const lines = []
let cur = null
for (const e of entries) {
  if (e.group !== cur) {
    if (cur) lines.push('')
    cur = e.group
    lines.push(`# ${cur}`)
  }
  lines.push(`${String(e.indexInGroup).padStart(3, '0')}. ${e.word}`)
}
fs.writeFileSync(path.join(OUT, 'cet4_zhoujihua_wordlist.txt'), lines.join('\n'), 'utf8')
console.log(`  cet4_zhoujihua_wordlist.txt  lines=${lines.length}`)

// stats
const byGroup = {}
for (const e of entries) byGroup[e.group] = (byGroup[e.group] || 0) + 1
console.log('\nper-group counts: ' + JSON.stringify(byGroup))
console.log('definition sources: ' + JSON.stringify(entries.reduce((a, e) => ((a[e.defSource || 'none'] = (a[e.defSource || 'none'] || 0) + 1), a), {})))

// ---------------- appendix: 基础词汇 (from 基础词汇.pdf) ----------------
const BASIC = path.join(DIR, 'sparke_pack/basic_words.json')
const BDEFS = path.join(DIR, 'dict/defs_basic.json')
const BQMAP = path.join(DIR, 'dict/query_map_basic.json')
if (fs.existsSync(BASIC) && fs.existsSync(BDEFS)) {
  const basic = JSON.parse(fs.readFileSync(BASIC, 'utf8'))
  const bdefs = JSON.parse(fs.readFileSync(BDEFS, 'utf8'))
  const bqmap = fs.existsSync(BQMAP) ? JSON.parse(fs.readFileSync(BQMAP, 'utf8')) : {}
  const seen = new Set()
  const basicOut = []
  for (const r of basic) {
    const key = r.word.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    let phone = null
    for (const v of bqmap[r.word] || [r.word]) {
      const d = bdefs[v]
      if (d && (d.usphone || d.ukphone)) {
        phone = d
        break
      }
    }
    const o = { name: r.word, trans: [r.def] }
    if (phone && phone.usphone) o.usphone = phone.usphone
    if (phone && phone.ukphone) o.ukphone = phone.ukphone
    basicOut.push(o)
  }
  console.log('\nJSON (Qwerty Learner, appendix):')
  writeJson('cet4_zhoujihua_basic.json', basicOut)
  const rows2 = [['序号', '单词', '书上释义', '美音', '英音', '书上音标'].map(csvEsc).join(',')]
  basic.forEach((r, i) => rows2.push([i + 1, r.word, r.def, (basicOut[i] && basicOut[i].usphone) || '', (basicOut[i] && basicOut[i].ukphone) || '', r.phon].map(csvEsc).join(',')))
  fs.writeFileSync(path.join(OUT, 'cet4_zhoujihua_basic.csv'), '\uFEFF' + rows2.join('\r\n'), 'utf8')
  const bAnki = ['#separator:tab', '#html:false', '#columns:Word\tTranslation']
  for (const o of basicOut) bAnki.push([o.name, o.trans.join('；')].join('\t'))
  fs.writeFileSync(path.join(OUT, 'cet4_zhoujihua_basic_anki.txt'), bAnki.join('\n'), 'utf8')
  console.log(`  cet4_zhoujihua_basic.csv / _basic_anki.txt  rows=${basicOut.length}`)
}
