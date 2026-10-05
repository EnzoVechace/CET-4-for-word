import fs from 'node:fs'
const DIR = 'C:/Users/31787/Documents/deepseek-harness/default-workspace/cet4-sparke'
const b = JSON.parse(fs.readFileSync(DIR + '/output/cet4_zhoujihua_basic.json', 'utf8'))
const PUA = /[\u{E000}-\u{F8FF}\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]/u
console.log('count=' + b.length)
console.log('no usphone=' + b.filter((x) => !x.usphone).length)
console.log('no ukphone=' + b.filter((x) => !x.ukphone).length)
console.log('trans with PUA=' + b.filter((x) => PUA.test(x.trans.join(''))).length)
console.log('trailing garbage>3=' + b.filter((x) => /(.)\1{3,}$/.test(x.trans.join(''))).length)
for (const w of ["o'clock", 'zoo', 'colo(u)r', 'theater/-tre', 'fiber/-bre', 'license/-nce', 'practise/-ice', 'OK/okay', 'a/an']) {
  const f = b.find((x) => x.name === w)
  console.log('  ' + w + ' -> ' + (f ? JSON.stringify(f) : 'MISSING'))
}
console.log('\nlast 6 entries:')
for (const x of b.slice(-6)) console.log('  ' + JSON.stringify(x))
