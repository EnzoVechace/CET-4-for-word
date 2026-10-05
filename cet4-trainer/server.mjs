// 词计划 · 静态服务器（零依赖）
// usage: node server.mjs [port]          默认只监听本机 127.0.0.1
//        node server.mjs 5199 --lan      监听 0.0.0.0，手机连同一个 Wi-Fi 就能打开
import http from 'node:http'
import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PUBLIC = path.join(__dirname, 'public')
const args = process.argv.slice(2)
const PORT = Number(args.find((a) => /^\d+$/.test(a)) || process.env.PORT || 5199)
const LAN = args.includes('--lan') || process.env.LAN === '1'
const HOST = process.env.HOST || (LAN ? '0.0.0.0' : '127.0.0.1')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}

const server = http.createServer((req, res) => {
  let urlPath
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  } catch {
    res.writeHead(400).end('bad request')
    return
  }
  if (urlPath.endsWith('/')) urlPath += 'index.html'
  const filePath = path.join(PUBLIC, path.normalize(urlPath).replace(/^([/\\])+/, ''))
  if (!filePath.startsWith(PUBLIC)) {
    res.writeHead(403).end('forbidden')
    return
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 ' + urlPath)
      return
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    })
    res.end(data)
  })
})

server.listen(PORT, HOST, () => {
  console.log(`词计划 running at http://127.0.0.1:${PORT}/`)
  if (LAN) {
    for (const list of Object.values(os.networkInterfaces())) {
      for (const ni of list || []) {
        if (ni.family === 'IPv4' && !ni.internal) {
          console.log(`  手机/平板（同一个 Wi-Fi）打开： http://${ni.address}:${PORT}/`)
        }
      }
    }
  }
})
