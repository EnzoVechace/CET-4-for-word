// Robust HTTP(S) GET that works behind the local HTTP proxy and without it.
// Usage: node fetch.mjs <url> <outFile>
import https from 'node:https'
import http from 'node:http'
import fs from 'node:fs'
import { URL } from 'node:url'

const [url, outFile] = process.argv.slice(2)

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36'

function request(targetUrl, proxy, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 8) return reject(new Error('too many redirects'))
    const u = new URL(targetUrl)
    const isTls = u.protocol === 'https:'
    const headers = {
      'User-Agent': UA,
      Accept: '*/*',
      'Accept-Encoding': 'identity',
    }
    const onResponse = (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        const next = new URL(res.headers.location, targetUrl).toString()
        return request(next, proxy, redirects + 1).then(resolve, reject)
      }
      if (res.statusCode !== 200) {
        res.resume()
        return reject(new Error('HTTP ' + res.statusCode + ' for ' + targetUrl))
      }
      resolve(res)
    }
    const mod = isTls ? https : http
    if (proxy && isTls) {
      // tunnel through CONNECT
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
        const r = https.request(
          { host: u.hostname, port: u.port || 443, path: u.pathname + u.search, method: 'GET', headers, socket, agent: false, servername: u.hostname },
          onResponse,
        )
        r.on('error', reject)
        r.end()
      })
      creq.on('error', reject)
      creq.end()
    } else if (proxy && !isTls) {
      // plain HTTP through proxy: absolute-form request line
      const p = new URL(proxy)
      const r = http.request(
        { host: p.hostname, port: p.port || 80, path: targetUrl, method: 'GET', headers: { ...headers, Host: u.host } },
        onResponse,
      )
      r.on('error', reject)
      r.end()
    } else {
      const r = mod.request(
        { host: u.hostname, port: u.port || (isTls ? 443 : 80), path: u.pathname + u.search, method: 'GET', headers },
        onResponse,
      )
      r.on('error', reject)
      r.end()
    }
  })
}

const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || ''
const attempts = [proxy, ''].filter((v, i, a) => a.indexOf(v) === i)
let lastErr
for (const p of attempts) {
  try {
    const res = await request(url, p)
    const chunks = []
    for await (const c of res) chunks.push(c)
    const buf = Buffer.concat(chunks)
    fs.writeFileSync(outFile, buf)
    console.log('OK bytes=' + buf.length + ' via=' + (p || 'direct'))
    process.exit(0)
  } catch (e) {
    lastErr = e
    console.error('fail via=' + (p || 'direct') + ' :: ' + e.message)
  }
}
console.error('ALL FAILED: ' + lastErr.message)
process.exit(1)
