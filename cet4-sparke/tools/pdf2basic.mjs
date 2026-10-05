// Parse sparke_pack/jichu.txt (the appendix "基础词汇" table extracted from 基础词汇.pdf)
// into a structured word list: { word, phon, def }
// usage: node pdf2basic.mjs
import fs from 'node:fs'
import path from 'node:path'

const DIR = 'C:/Users/31787/Documents/deepseek-harness/default-workspace/cet4-sparke'
const lines = fs.readFileSync(path.join(DIR, 'sparke_pack/jichu.txt'), 'utf8').split(/\r?\n/)

const pages = []
let cur = null
for (const l of lines) {
  const m = l.match(/^===PAGE (\d+)===/)
  if (m) {
    if (cur) pages.push(cur)
    cur = { p: +m[1], s: '' }
    continue
  }
  if (!cur) continue
  cur.s += l.replace(/^\[/, '').replace(/\]TJ$/, '')
}
if (cur) pages.push(cur)

// drop the running page-number header "-123 -"
let text = pages.map((p) => p.s).join('')
text = text.replace(/-\d+\s*-/g, '').replace(/\s+/g, ' ')

const chunks = text.split('\u25a1').map((s) => s.trim()).filter(Boolean)
// the PDF uses unmapped glyphs from the Supplementary Private Use Areas; in headwords such a
// glyph stands for the apostrophe (o?clock -> o'clock), inside definitions it is pure noise.
const PUA = /[\u{E000}-\u{F8FF}\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]/u

const rows = []
const unparsed = []
for (const c of chunks) {
  if (c === '基础词汇') continue
  const wi = c.indexOf('[')
  let word, phon = '', def
  if (wi > 0) {
    word = c.slice(0, wi)
    const close = c.indexOf(']', wi)
    phon = c.slice(wi + 1, close)
    def = c.slice(close + 1)
  } else {
    const m = c.match(/^([A-Za-z][A-Za-z().,\-'/ ]*?)\s*(?=[navdiprcj]\.)/)
    if (!m) {
      unparsed.push(c)
      continue
    }
    word = m[1]
    def = c.slice(m[1].length)
  }
  word = word.replace(new RegExp(PUA.source, 'gu'), "'").replace(/^'+|'+$/g, '').trim()
  def = def.replace(new RegExp(PUA.source, 'gu'), '').trim()
  phon = phon.replace(new RegExp(PUA.source, 'gu'), '?').trim()
  if (!word) continue
  rows.push({ word, phon, def: def.trim() })
}

const withPuaDef = rows.filter((r) => PUA.test(r.def)).length
const withPuaPhon = rows.filter((r) => r.phon.includes('?')).length
const withPuaWord = rows.filter((r) => PUA.test(r.word)).length
console.log(`chunks=${chunks.length} rows=${rows.length} unparsed=${unparsed.length}`)
console.log(`PUA remaining -> word=${withPuaWord} phon=${withPuaPhon} def=${withPuaDef}`)
if (unparsed.length) console.log('unparsed: ' + unparsed.join(' | '))

const book = JSON.parse(fs.readFileSync(path.join(DIR, 'sparke_pack/book_words.json'), 'utf8'))
const core = new Set(book.map((x) => x.word.toLowerCase().replace(/[\u2460-\u2473]/g, '')))
const uniq = [...new Set(rows.map((r) => r.word.toLowerCase()))]
console.log(`unique=${uniq.length} overlapWithCoreList=${uniq.filter((w) => core.has(w)).length}`)

fs.writeFileSync(path.join(DIR, 'sparke_pack/basic_words.json'), JSON.stringify(rows, null, 1), 'utf8')
console.log('\nsample:')
for (const i of [0, 1, 2, 50, 400, 900, 1520]) console.log('  ' + JSON.stringify(rows[i]))
