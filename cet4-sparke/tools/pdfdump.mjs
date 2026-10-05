// PDF text extractor with ToUnicode CMap support (Node, no deps).
// usage: node pdfdump.mjs <file.pdf> <out.txt>
import fs from 'node:fs'
import zlib from 'node:zlib'

const file = process.argv[2]
const outFile = process.argv[3] || file + '.txt'
const buf = fs.readFileSync(file)
const s = buf.toString('latin1')

// ---------- object table ----------
const objs = new Map() // num -> {raw, dict, stream|null}
const objRe = /(\d+)\s+(\d+)\s+obj\b/g
let m
while ((m = objRe.exec(s))) {
  objs.set(Number(m[1]), { start: m.index, bodyStart: objRe.lastIndex })
}
for (const [num, o] of objs) {
  const end = s.indexOf('endobj', o.bodyStart)
  const body = s.slice(o.bodyStart, end < 0 ? s.length : end)
  const si = body.indexOf('stream')
  let dict = body
  let stream = null
  if (si >= 0) {
    dict = body.slice(0, si)
    let p = o.bodyStart + si + 6
    if (s[p] === '\r') p++
    if (s[p] === '\n') p++
    let e = s.indexOf('endstream', p)
    stream = buf.subarray(p, e < 0 ? buf.length : e)
  }
  o.dict = dict
  o.stream = stream
}

function inflate(b) {
  try {
    return zlib.inflateSync(b)
  } catch {
    try {
      return zlib.inflateRawSync(b)
    } catch {
      return null
    }
  }
}
function decodeStream(stream, dict) {
  if (!stream) return null
  if (/FlateDecode/.test(dict)) {
    const d = inflate(stream)
    return d ? d.toString('latin1') : null
  }
  return stream.toString('latin1')
}
function getDictText(num) {
  const o = objs.get(num)
  return o ? o.dict : null
}
function resolveRef(str, key) {
  const r = new RegExp('/' + key + '\\s+(\\d+)\\s+\\d+\\s+R')
  const mm = str.match(r)
  return mm ? Number(mm[1]) : null
}

// ---------- ObjStm (compressed object streams) ----------
for (const [num, o] of [...objs]) {
  if (!/\/Type\s*\/ObjStm/.test(o.dict)) continue
  const data = decodeStream(o.stream, o.dict)
  if (!data) continue
  const n = Number((o.dict.match(/\/N\s+(\d+)/) || [])[1])
  const first = Number((o.dict.match(/\/First\s+(\d+)/) || [])[1])
  const header = data.slice(0, first).trim().split(/\s+/).map(Number)
  for (let i = 0; i < n; i++) {
    const onum = header[2 * i]
    const off = header[2 * i + 1]
    const nextOff = i + 1 < n ? header[2 * i + 3] : data.length - first
    const body = data.slice(first + off, first + nextOff)
    if (!objs.has(onum)) objs.set(onum, { dict: body, stream: null })
  }
}

// ---------- ToUnicode cmaps ----------
const cmaps = new Map() // objNum -> Map(codeHexUpper -> string)
function parseCmap(num) {
  if (cmaps.has(num)) return cmaps.get(num)
  const o = objs.get(num)
  const map = new Map()
  cmaps.set(num, map)
  if (!o) return map
  const txt = decodeStream(o.stream, o.dict)
  if (!txt) return map
  const toStr = (hex) => {
    let r = ''
    for (let i = 0; i + 3 < hex.length + 1; i += 4) {
      const cp = parseInt(hex.substr(i, 4), 16)
      if (!isNaN(cp)) r += String.fromCharCode(cp)
    }
    return r
  }
  const bfchar = /beginbfchar([\s\S]*?)endbfchar/g
  let b
  while ((b = bfchar.exec(txt))) {
    const pairs = b[1].match(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>/g) || []
    for (const p of pairs) {
      const q = p.match(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>/)
      map.set(q[1].toUpperCase().padStart(4, '0'), toStr(q[2]))
    }
  }
  const bfrange = /beginbfrange([\s\S]*?)endbfrange/g
  while ((b = bfrange.exec(txt))) {
    const items = b[1].match(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<[0-9A-Fa-f]*>|\[[^\]]*\])/g) || []
    for (const it of items) {
      const q = it.match(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<[0-9A-Fa-f]*>|\[[^\]]*\])/)
      const lo = parseInt(q[1], 16)
      const hi = parseInt(q[2], 16)
      const w = q[1].length
      if (q[3].startsWith('[')) {
        const arr = q[3].match(/<([0-9A-Fa-f]*)>/g) || []
        arr.forEach((a, i) => {
          const hex = a.slice(1, -1)
          map.set((lo + i).toString(16).toUpperCase().padStart(w, '0'), toStr(hex))
        })
      } else {
        const dst = q[3].slice(1, -1)
        for (let c = lo; c <= hi && c - lo < 65536; c++) {
          const dv = (parseInt(dst || '0', 16) + (c - lo)).toString(16).toUpperCase().padStart(dst.length, '0')
          map.set(c.toString(16).toUpperCase().padStart(w, '0'), toStr(dv))
        }
      }
    }
  }
  return map
}

// ---------- pages ----------
const pages = []
for (const [num, o] of objs) {
  if (!/\/Type\s*\/Page[^s]/.test(o.dict)) continue
  if (/\/Type\s*\/Pages/.test(o.dict)) continue
  pages.push(num)
}
pages.sort((a, b) => a - b)

function pageFonts(dict) {
  // /Resources may be inline or a ref
  let res = dict
  const rr = resolveRef(dict, 'Resources')
  if (rr && objs.has(rr)) res = objs.get(rr).dict
  const fm = res.match(/\/Font\s*<<([\s\S]*?)>>/)
  const map = new Map()
  if (!fm) return map
  const entries = fm[1].match(/\/([A-Za-z0-9_.+-]+)\s+(\d+)\s+\d+\s+R/g) || []
  for (const e of entries) {
    const q = e.match(/\/([A-Za-z0-9_.+-]+)\s+(\d+)\s+\d+\s+R/)
    const fnum = Number(q[2])
    const fd = getDictText(fnum) || ''
    const tu = resolveRef(fd, 'ToUnicode') || (fd.match(/\/ToUnicode\s+(\d+)\s+\d+\s+R/) || [])[1]
    map.set(q[1], tu ? Number(tu) : null)
  }
  return map
}

function decodeText(str, cmap) {
  return str.replace(/<([0-9A-Fa-f\s]+)>/g, (_, hex) => {
    const h = hex.replace(/\s+/g, '').toUpperCase()
    if (!cmap) return ''
    let r = ''
    for (let i = 0; i + 4 <= h.length; i += 4) {
      const code = h.substr(i, 4)
      const v = cmap.get(code)
      if (v !== undefined) r += v
    }
    return r
  }).replace(/\(((?:[^()\\]|\\.)*)\)/g, (_, t) => {
    if (!cmap) return t
    return t.replace(/\\(\d{1,3}|.)/g, (_, c) => (c.length === 3 ? String.fromCharCode(parseInt(c, 8)) : c))
  })
}

const out = []
pages.forEach((pnum, pi) => {
  const o = objs.get(pnum)
  const fonts = pageFonts(o.dict)
  const contents = []
  const cref = resolveRef(o.dict, 'Contents')
  if (cref) contents.push(cref)
  else {
    const arr = o.dict.match(/\/Contents\s*\[([^\]]*)\]/)
    if (arr) for (const r of arr[1].match(/(\d+)\s+\d+\s+R/g) || []) contents.push(Number(r.match(/\d+/)[0]))
  }
  out.push(`\n===PAGE ${pi + 1}===`)
  for (const cnum of contents) {
    const co = objs.get(cnum)
    if (!co) continue
    const txt = decodeStream(co.stream, co.dict)
    if (!txt) continue
    let curCmap = null
    const toks = txt.match(/\/[A-Za-z0-9_.+-]+\s+[\d.]+\s+Tf|\[[^\]]*\]\s*TJ|<[0-9A-Fa-f\s]+>|\((?:[^()\\]|\\.)*\)|T\*|Td|TD|ET|BT/g) || []
    let line = ''
    for (const t of toks) {
      if (/Tf$/.test(t)) {
        const fn = t.match(/\/([A-Za-z0-9_.+-]+)/)[1]
        const tu = fonts.get(fn)
        curCmap = tu ? parseCmap(tu) : null
      } else if (/TJ$/.test(t)) {
        line += decodeText(t, curCmap)
      } else if (t.startsWith('<') || t.startsWith('(')) {
        line += decodeText(t, curCmap)
      } else if (t === 'T*' || t === 'Td' || t === 'TD' || t === 'ET') {
        if (line.trim()) out.push(line)
        line = ''
      }
    }
    if (line.trim()) out.push(line)
  }
})

fs.writeFileSync(outFile, out.join('\n'), 'utf8')
console.log('pages=' + pages.length + ' lines=' + out.length + ' -> ' + outFile)
