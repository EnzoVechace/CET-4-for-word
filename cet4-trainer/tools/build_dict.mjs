// 把 cet4-sparke/output 的词表编译成前端可直接加载的紧凑词库文件
// usage: node tools/build_dict.mjs
import fs from 'node:fs'
import path from 'node:path'
import { pickHf } from './hf.mjs'

const ROOT = 'C:/Users/31787/Documents/deepseek-harness/default-workspace'
const SRC = ROOT + '/cet4-sparke/output'
const PACK = ROOT + '/cet4-sparke/sparke_pack'
const OUT = ROOT + '/cet4-trainer/public/dict'
const LIB = ROOT + '/cet4-trainer/public/data'
const COLLINS = ROOT + '/cet4-trainer/build/collins.json'

fs.mkdirSync(OUT, { recursive: true })
fs.mkdirSync(LIB, { recursive: true })

const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'))

// Collins 义项缓存（tools/fetch_collins.mjs 抓的）
let collins = {}
if (fs.existsSync(COLLINS)) {
  collins = read(COLLINS)
  console.log(`collins cache: ${Object.keys(collins).length} entries`)
} else {
  console.log('collins cache: 没有（先跑 node tools/fetch_collins.mjs 才能标高频释义）')
}

// [word, trans[], usphone, ukphone, group?, hf?]
// hf = [[行号, 行内义项序号], ...]，用来画「高频释义」的虚线
let hfTotal = 0
let hfMiss = 0

/**
 * 书上很多词条是「可选写法」记法，Collins 里查不到 `program(me)` / `realize,-ise` 这种原文，
 * 得拿去掉括号、取分隔符前那半、以及把 -ise 后缀换回去的形式去查。
 */
const collinsLookup = (name) => {
  const tries = [name]
  // 书上用 angle1 / angle2 / lean1 / converse1 区分同形异义词，查 Collins 要去掉尾号
  if (/\d$/.test(name)) tries.push(name.replace(/\d+$/, ''))
  if (name.includes('(')) {
    tries.push(name.replace(/\(([^)]*)\)/g, '$1'), name.replace(/\([^)]*\)/g, ''))
  }
  if (/[\/,]/.test(name)) {
    const parts = name.split(/[\/,]/).map((x) => x.trim())
    tries.push(parts[0])
    if (parts[1] && parts[1].startsWith('-') && parts[0].length >= parts[1].length) {
      tries.push(parts[0].slice(0, parts[0].length - parts[1].length) + parts[1].slice(1))
    }
  }
  for (const t of tries) {
    if (collins[t] && collins[t].senses && collins[t].senses.length) return collins[t]
  }
  return null
}

/** 词形校正表：只放「确定是源头抽取粘连」的，不要随手改书上的写法 */
const WORD_FIXES = {
  oughtto: 'ought to',
}

const row = (e, group, withHf = true) => {
  const name = WORD_FIXES[e.name] || e.name
  const r = [name, e.trans, e.usphone || '', e.ukphone || '']
  if (group !== undefined) r.push(group)
  const c = withHf ? collinsLookup(name) : null
  const hf = c ? pickHf(c.senses, e.trans) : []
  if (withHf) {
    if (hf.length) hfTotal += 1
    else hfMiss += 1
  }
  r.push(hf)
  return r
}

const index = []
function emit(id, name, sub, words, extra = {}) {
  const data = { id, name, sub, words, ...extra }
  const file = id + '.json'
  fs.writeFileSync(path.join(OUT, file), JSON.stringify(data), 'utf8')
  const kb = (fs.statSync(path.join(OUT, file)).size / 1024).toFixed(0)
  index.push({ id, name, sub, count: words.length, file, ...extra })
  console.log(`  ${file.padEnd(16)} ${String(words.length).padStart(5)} words  ${kb}KB`)
}

// 书本分组信息（用于认知词汇的 A-C / D-H / I-Q / R-Z 子标签）
const book = read(path.join(PACK, 'book_words.json'))
const cognitiveGroups = book.filter((e) => e.section === 'cognitive').map((e) => e.group)

console.log('building dicts:')
for (let w = 1; w <= 7; w++) {
  const raw = read(path.join(SRC, `cet4_zhoujihua_week${w}.json`))
  emit(`week${w}`, `Week ${w}`, '核心词汇', raw.map((e) => row(e, `第 ${w} 周`)), { week: w })
}

const cog = read(path.join(SRC, 'cet4_zhoujihua_cognitive.json'))
if (cog.length !== cognitiveGroups.length) throw new Error('cognitive length mismatch')
emit('cognitive', '认知词汇', '附录一', cog.map((e, i) => row(e, cognitiveGroups[i].replace('认知词汇 ', ''))), { appendix: true })

const basic = read(path.join(SRC, 'cet4_zhoujihua_basic.json'))
// 基础词汇附录用的是书上原释义（「prep.①关于②到处 ad.①大约…」），
// 义项是按 ①② 编号内嵌在一条里的，跟主表的「n. …；…」结构不同，
// 而且这些基础词本身没有「哪个义项更高频」的区分意义，就不标了。
emit('basic', '基础词汇', '附录二', basic.map((e) => row(e, '基础词汇', false)), { appendix: true })

console.log(`\n标了高频释义的词：${hfTotal}，没标上的：${hfMiss}`)

// “全书”通过运行时组合 week1..7 + cognitive 得到，不重复打包
index.unshift({
  id: 'full',
  name: '全书',
  sub: '核心 + 认知',
  count: 2177,
  compose: ['week1', 'week2', 'week3', 'week4', 'week5', 'week6', 'week7', 'cognitive'],
})

fs.writeFileSync(path.join(LIB, 'dicts.json'), JSON.stringify({ generatedAt: new Date().toISOString(), dicts: index }, null, 1), 'utf8')
console.log(`\nindex written: ${index.length} decks, total rows ${index.reduce((a, b) => a + b.count, 0)}`)
