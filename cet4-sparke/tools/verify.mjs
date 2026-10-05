// Final QA: make sure the exported word order matches the LRC-derived book order exactly.
import fs from 'node:fs'
const DIR = 'C:/Users/31787/Documents/deepseek-harness/default-workspace/cet4-sparke'
const R = (p) => JSON.parse(fs.readFileSync(DIR + '/output/' + p, 'utf8'))
const rd = (p) => fs.readFileSync(DIR + '/output/' + p, 'utf8')

const book = JSON.parse(fs.readFileSync(DIR + '/sparke_pack/book_words.json', 'utf8'))
const full = R('cet4_zhoujihua_full.json')
const brief = R('cet4_zhoujihua_full_brief.json')

let ok = true
const say = (label, cond, extra = '') => {
  if (!cond) ok = false
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`)
}

say('full count = 2177', full.length === 2177, `got ${full.length}`)
say('brief count = 2177', brief.length === 2177)
const mismatch = []
book.forEach((e, i) => {
  if (!full[i] || full[i].name !== e.word) mismatch.push(`${i}: book=${e.word} file=${full[i] && full[i].name}`)
})
say('order & spelling identical to book LRC order', mismatch.length === 0, mismatch.slice(0, 5).join('; '))
say('no duplicate headwords', new Set(full.map((x) => x.name)).size === full.length)
say('every entry has trans', full.every((x) => Array.isArray(x.trans) && x.trans.length && x.trans.join('').length))
say('phonetic coverage >= 99%', full.filter((x) => x.usphone).length / full.length > 0.99, `${full.filter((x) => x.usphone).length}/2177`)

let sum = 0
for (let w = 1; w <= 7; w++) {
  const f = R(`cet4_zhoujihua_week${w}.json`)
  sum += f.length
  const expect = book.filter((e) => e.week === w).map((e) => e.word)
  const same = expect.length === f.length && expect.every((x, i) => x === f[i].name)
  say(`week${w} = 250 and in order`, f.length === 250 && same, `got ${f.length}`)
}
const cog = R('cet4_zhoujihua_cognitive.json')
const cogExpect = book.filter((e) => e.section === 'cognitive').map((e) => e.word)
say('cognitive = 427 and in order', cog.length === 427 && cogExpect.every((x, i) => x === cog[i].name), `got ${cog.length}`)
say('weeks + cognitive = full', sum + cog.length === full.length, `${sum}+${cog.length}`)

const csv = rd('cet4_zhoujihua.csv')
const csvRows = csv.replace(/^\uFEFF/, '').trim().split('\r\n')
say('csv has BOM', csv.charCodeAt(0) === 0xfeff)
say('csv = 1 header + 2177 data rows', csvRows.length === 2178, `got ${csvRows.length}`)
say('csv every field quoted', csvRows.every((l) => /^".*"$/.test(l)))
const anki = rd('cet4_zhoujihua_anki.txt').split('\n')
say('anki rows = 2177', anki.length - 3 === 2177)
say('anki has tab in every row', anki.slice(3).every((l) => l.includes('\t')))
const wl = rd('cet4_zhoujihua_wordlist.txt').trim().split('\n')
say('wordlist last line is zoology (认知词汇 R-Z)', wl[wl.length - 1].includes('zoology'), wl[wl.length - 1])
say('wordlist line count = 2177 words + 11 group headers + 10 blanks', wl.length === 2177 + 11 + 10, `got ${wl.length}`)

const basic = R('cet4_zhoujihua_basic.json')
say('appendix basic = 1523', basic.length === 1523, `got ${basic.length}`)
say('appendix no overlap with main list', basic.every((b) => !full.some((f) => f.name === b.name)))

console.log('\n' + (ok ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'))
