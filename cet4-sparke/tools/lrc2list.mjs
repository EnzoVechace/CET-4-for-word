// Build the canonical word list from Sparke's official .lrc companion files.
// usage: node lrc2list.mjs <lrcDir> <outJson>
import fs from 'node:fs'
import path from 'node:path'

const lrcDir = process.argv[2]
const outJson = process.argv[3]

const FILES = [
  { file: 'Week 1.lrc', group: 'Week 1', section: 'core', week: 1 },
  { file: 'Week 2.lrc', group: 'Week 2', section: 'core', week: 2 },
  { file: 'Week 3.lrc', group: 'Week 3', section: 'core', week: 3 },
  { file: 'Week 4.lrc', group: 'Week 4', section: 'core', week: 4 },
  { file: 'Week 5.lrc', group: 'Week 5', section: 'core', week: 5 },
  { file: 'Week 6.lrc', group: 'Week 6', section: 'core', week: 6 },
  { file: 'Week 7.lrc', group: 'Week 7', section: 'core', week: 7 },
  { file: '认知词汇A-C.lrc', group: '认知词汇 A-C', section: 'cognitive', week: null },
  { file: '认知词汇D-H.lrc', group: '认知词汇 D-H', section: 'cognitive', week: null },
  { file: '认知词汇I-Q.lrc', group: '认知词汇 I-Q', section: 'cognitive', week: null },
  { file: '认知词汇R-Z.lrc', group: '认知词汇 R-Z', section: 'cognitive', week: null },
]

// Normalized lookup form: strip homograph markers (①/1), variant slashes, parentheticals
function lookupForm(raw) {
  let w = raw.trim()
  w = w.replace(/[①②③④⑤⑥⑦⑧⑨⑩]/g, '')
  w = w.replace(/(?<=[a-zA-Z])\d+$/, '')          // converse1 -> converse
  w = w.replace(/\(([^)]*)\)/g, '$1')              // program(me) -> programme
  w = w.replace(/,-\w+/g, '')                      // realize,-ise -> realize
  w = w.replace(/,.*$/, '')                        // any comma tail
  w = w.replace(/\s+/g, ' ').trim().toLowerCase()
  return w
}
// all plausible surface keys for dictionary matching
function keyVariants(raw) {
  const set = new Set()
  const base = lookupForm(raw)
  set.add(base)
  set.add(base.replace(/[^a-z'\- ]/g, '').trim())
  // program(me) also -> program
  const alt = raw.replace(/\(([^)]*)\)/g, '').replace(/[①②③④⑤⑥⑦⑧⑨⑩]/g, '').replace(/(?<=[a-zA-Z])\d+$/, '').replace(/,-\w+/g, '').replace(/,.*$/, '').trim().toLowerCase()
  set.add(alt)
  return [...set].filter(Boolean)
}

const entries = []
for (const spec of FILES) {
  const p = path.join(lrcDir, spec.file)
  const txt = fs.readFileSync(p, 'utf8')
  const lines = txt.split(/\r?\n/).filter((l) => /^\[\d\d:\d\d\.\d\d\]/.test(l))
  let idx = 0
  for (const line of lines) {
    const time = line.match(/^\[(\d\d:\d\d\.\d\d)\]/)[1]
    const text = line.replace(/^\[\d\d:\d\d\.\d\d\]/, '').trim()
    if (!text) continue
    // the first line of each Week file is just the group title
    if (/^Week\s*\d+$/i.test(text) && idx === 0) continue
    idx++
    entries.push({
      n: entries.length + 1,
      group: spec.group,
      section: spec.section,
      week: spec.week,
      indexInGroup: idx,
      time,
      word: text,
      lookup: lookupForm(text),
      keys: keyVariants(text),
    })
  }
}

fs.writeFileSync(outJson, JSON.stringify(entries, null, 1), 'utf8')
const byGroup = {}
for (const e of entries) byGroup[e.group] = (byGroup[e.group] || 0) + 1
console.log('total=' + entries.length)
console.log(JSON.stringify(byGroup, null, 1))
const dup = {}
for (const e of entries) dup[e.lookup] = (dup[e.lookup] || 0) + 1
const dups = Object.entries(dup).filter(([, c]) => c > 1)
console.log('duplicate lookup forms: ' + dups.length)
console.log(dups.slice(0, 40).map(([k, c]) => k + 'x' + c).join(', '))
