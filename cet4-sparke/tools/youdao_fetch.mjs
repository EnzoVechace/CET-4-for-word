// Fetch concise Chinese definitions + phonetics from Youdao for every book word.
// Resumable: results are cached in dict/defs.json.
// usage: node youdao_fetch.mjs
import fs from 'node:fs'
import path from 'node:path'
import https from 'node:https'
import http from 'node:http'
import crypto from 'node:crypto'
import { URL } from 'node:url'

const DIR = 'C:/Users/31787/Documents/deepseek-harness/default-workspace/cet4-sparke'
const BOOK = process.env.BOOK || path.join(DIR, 'sparke_pack/book_words.json')
const CACHE = process.env.CACHE || path.join(DIR, 'dict/defs.json')
const QMAP = process.env.QMAP || path.join(DIR, 'dict/query_map.json')
const PROXY = process.env.HTTPS_PROXY || 'http://127.0.0.1:7897'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36'
const CONCURRENCY = Number(process.env.CONC || 4)

function get(targetUrl, proxy, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 6) return reject(new Error('too many redirects'))
    const u = new URL(targetUrl)
    const isTls = u.protocol === 'https:'
    const headers = { 'User-Agent': UA, Accept: 'application/json,text/plain,*/*', 'Accept-Encoding': 'identity' }
    const onResponse = (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        return get(new URL(res.headers.location, targetUrl).toString(), proxy, redirects + 1).then(resolve, reject)
      }
      if (res.statusCode !== 200) {
        res.resume()
        return reject(new Error('HTTP ' + res.statusCode))
      }
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    }
    if (proxy && isTls) {
      const p = new URL(proxy)
      const creq = http.request({
        host: p.hostname,
        port: p.port || 80,
        method: 'CONNECT',
        path: u.hostname + ':' + (u.port || 443),
        headers: { Host: u.hostname + ':' + (u.port || 443) },
      })
      creq.on('connect', (cres, socket) => {
        if (cres.statusCode !== 200) return reject(new Error('proxy CONNECT ' + cres.statusCode))
        const r = https.request({ host: u.hostname, port: u.port || 443, path: u.pathname + u.search, method: 'GET', headers, socket, agent: false, servername: u.hostname }, onResponse)
        r.on('error', reject)
        r.end()
      })
      creq.on('error', reject)
      creq.end()
    } else {
      const r = (isTls ? https : http).request({ host: u.hostname, port: u.port || (isTls ? 443 : 80), path: u.pathname + u.search, method: 'GET', headers }, onResponse)
      r.on('error', reject)
      r.end()
    }
  })
}

// ---- target queries -------------------------------------------------------
const book = JSON.parse(fs.readFileSync(BOOK, 'utf8'))
const queries = new Map() // query -> {entries:[bookWord,...]}

function qVariants(raw) {
  const w0 = raw.trim()
  // slash shorthand: fiber/-bre -> fiber, fibre ; OK/okay -> OK, okay ; email/e-mail -> email, e-mail
  const parts = w0.split('/')
  const heads = [parts[0]]
  if (parts[1]) {
    const s = parts[1].trim()
    heads.push(s.startsWith('-') ? parts[0].slice(0, Math.max(0, parts[0].length - (s.length - 1))) + s.slice(1) : s)
  }
  const out = []
  for (const b of heads) {
    const withParen = b.replace(/\(([^)]*)\)/g, '$1')
    const withoutParen = b.replace(/\(([^)]*)\)/g, '')
    const comma = b.split(',')[0]
    // prefer the full/expanded spelling, then the bare one
    for (let v of [withParen, comma, withoutParen, b, w0]) {
      v = v
        .replace(/[\u2460-\u2473]/g, '')
        .replace(/(?<=[a-zA-Z])\d+$/, '')
        .trim()
      if (v) out.push(v)
    }
  }
  return [...new Set(out)]
}

const variantsOfEntry = new Map() // book word -> [candidate queries]
for (const e of book) {
  const vs = qVariants(e.word)
  variantsOfEntry.set(e.word, vs)
  for (const v of vs) if (!queries.has(v)) queries.set(v, [])
  const q = vs[0]
  queries.get(q).push(e.word)
}

const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {}
let todo = [...queries.keys()].filter((q) => !cache[q] || cache[q]._retry)
if (process.env.LIMIT) todo = todo.slice(0, Number(process.env.LIMIT))
console.log(`unique queries=${queries.size} cached=${queries.size - todo.length} todo=${todo.length}`)

// ---- parse ----------------------------------------------------------------
function clean(text) {
  return String(text)
    .replace(/<[^>]+>/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function parse(json, query) {
  const ec = json && json.ec && json.ec.word && json.ec.word[0]
  const res = { query, usphone: null, ukphone: null, trans: [], source: null, _retry: false }
  if (ec) {
    const fix = (p) => (p && p !== 'undefined' && p !== 'null' ? String(p).trim() : null)
    res.usphone = fix(ec.usphone)
    res.ukphone = fix(ec.ukphone)
    const lines = []
    for (const grp of ec.trs || []) {
      for (const tr of grp.tr || []) {
        const items = (tr.l && tr.l.i) || []
        for (const it of items) {
          const t = clean(it)
          if (!t) continue
          if (/^【名】|（人名）|\(人名\)/.test(t)) continue
          lines.push(t)
        }
      }
    }
    // dedupe preserving order
    res.trans = [...new Set(lines)]
    res.source = 'ec'
  }
  if (!res.trans.length && json && json.web_trans) {
    const wt = json.web_trans['web-translation'] || []
    const first = wt.find((x) => x.key && x.key.toLowerCase() === query.toLowerCase())
    if (first) {
      res.trans = (first.trans || []).slice(0, 4).map((t) => clean(t.value)).filter(Boolean)
      res.source = 'web_trans'
    }
  }
  if (!res.trans.length) res._retry = true
  return res
}

// ---- worker pool ----------------------------------------------------------
let done = 0
let failed = 0
let idx = 0
const started = Date.now()

async function worker() {
  while (idx < todo.length) {
    const q = todo[idx++]
    let ok = false
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      try {
        const body = await get('https://dict.youdao.com/jsonapi?q=' + encodeURIComponent(q), PROXY)
        const json = JSON.parse(body)
        cache[q] = parse(json, q)
        ok = true
      } catch (err) {
        if (attempt === 2) {
          failed++
          cache[q] = { query: q, usphone: null, ukphone: null, trans: [], source: 'error:' + err.message, _retry: true }
          console.log('FAIL ' + q + ' :: ' + err.message)
        } else {
          await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
        }
      }
    }
    done++
    if (done % 25 === 0) {
      fs.writeFileSync(CACHE, JSON.stringify(cache), 'utf8')
      const rate = done / ((Date.now() - started) / 1000)
      process.stdout.write(`\r  ${done}/${todo.length}  ${rate.toFixed(1)}/s  failed=${failed}   `)
    }
    await new Promise((r) => setTimeout(r, 120 + Math.random() * 180))
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker))
fs.writeFileSync(CACHE, JSON.stringify(cache), 'utf8')

const empty = Object.entries(cache).filter(([, v]) => !v.trans.length)
fs.writeFileSync(QMAP, JSON.stringify(Object.fromEntries(variantsOfEntry)), 'utf8')
console.log(`\ndone. queries=${Object.keys(cache).length} parsed=${Object.keys(cache).length - empty.length} empty/error=${empty.length}`)
if (empty.length) console.log('empty: ' + empty.slice(0, 80).map(([k]) => k).join(', '))
