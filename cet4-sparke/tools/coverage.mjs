// Coverage check: how many book words are found in one or more dictionary JSON sources.
// usage: node coverage.mjs <book_words.json> <dict1.json> [dict2.json ...]
import fs from 'node:fs'

const [bookFile, ...dictFiles] = process.argv.slice(2)
const book = JSON.parse(fs.readFileSync(bookFile, 'utf8'))

function norm(w) {
  return String(w).trim().toLowerCase().replace(/[()（）]/g, '').replace(/\s+/g, ' ')
}

const dicts = []
for (const f of dictFiles) {
  const raw = JSON.parse(fs.readFileSync(f, 'utf8'))
  const map = new Map()
  if (Array.isArray(raw)) {
    for (const e of raw) {
      const k = e.name || e.word || e.headWord
      if (!k) continue
      const trans = e.trans || e.translation || e.translations || e.definition
      const val = Array.isArray(trans) ? trans.join('；') : String(trans == null ? '' : trans)
      map.set(norm(k), val)
    }
  } else {
    for (const [k, v] of Object.entries(raw)) map.set(norm(k), Array.isArray(v) ? v.join('；') : String(v))
  }
  dicts.push({ file: f, map })
  console.log(f + ' entries=' + map.size)
}

const missing = []
let hit = 0
for (const e of book) {
  let found = false
  for (const d of dicts) {
    for (const k of e.keys) if (d.map.has(norm(k))) { found = true; break }
    if (found) break
  }
  if (found) hit++
  else missing.push(e.word)
}
console.log(`\nbook=${book.length} covered=${hit} missing=${missing.length} (${((hit / book.length) * 100).toFixed(1)}%)`)
fs.writeFileSync(bookFile.replace(/\.json$/, '') + '_missing.txt', missing.join('\n'), 'utf8')
console.log('missing -> ' + bookFile.replace(/\.json$/, '') + '_missing.txt')
console.log(missing.slice(0, 120).join(', '))
