// Minimal PDF probe + text extractor (Node, no deps).
// usage: node pdftext.mjs <file.pdf> [maxChars]
import fs from 'node:fs'
import zlib from 'node:zlib'

const file = process.argv[2]
const maxChars = Number(process.argv[3] || 4000)
const buf = fs.readFileSync(file)
const bin = buf.toString('latin1')

console.log('bytes=' + buf.length)
console.log('pages=' + (bin.match(/\/Type\s*\/Page[^s]/g) || []).length)
console.log('fonts=' + (bin.match(/\/Type\s*\/Font/g) || []).length)
console.log('tounicode=' + (bin.match(/\/ToUnicode/g) || []).length)
console.log('images=' + (bin.match(/\/Subtype\s*\/Image/g) || []).length)
console.log('filters=' + JSON.stringify([...new Set(bin.match(/\/Filter\s*\/?\w+/g) || [])]))

// inflate all FlateDecode streams and dump text-showing operators
const out = []
const re = /stream\r?\n/g
let m
let n = 0
while ((m = re.exec(bin))) {
  const start = m.index + m[0].length
  const end = bin.indexOf('endstream', start)
  if (end < 0) continue
  const raw = buf.subarray(start, end)
  n++
  let txt = null
  try {
    txt = zlib.inflateSync(raw).toString('latin1')
  } catch {
    try {
      txt = zlib.inflateRawSync(raw).toString('latin1')
    } catch {
      continue
    }
  }
  if (!/BT|Tj|TJ/.test(txt)) continue
  // pull show-text operands
  const shows = txt.match(/\((?:[^()\\]|\\.)*\)|<[0-9A-Fa-f\s]+>/g) || []
  const hexCount = shows.filter((s) => s.startsWith('<')).length
  out.push({ streamIndex: n, shows: shows.length, hex: hexCount, sample: shows.slice(0, 12) })
}
console.log('flate streams with text ops: ' + out.length)
for (const s of out.slice(0, 5)) {
  console.log('--- stream#' + s.streamIndex + ' shows=' + s.shows + ' hex=' + s.hex)
  console.log('    ' + s.sample.join(' '))
}
