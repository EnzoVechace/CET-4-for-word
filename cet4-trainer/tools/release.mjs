#!/usr/bin/env node
/**
 * 把 dist/ 里的成品挂到 GitHub Releases 上。
 *
 *   $env:GH_TOKEN="ghp_xxx"          # 需要 repo 权限的 Personal Access Token
 *   node tools/release.mjs            # 版本号默认取 VERSION（1.2）
 *
 * 会做这些事：
 *   1. 按 tag 找 release，没有就建一个（默认不是 draft）
 *   2. 同名 asset 先删掉再传，所以可以反复跑
 *   3. 传完后打印下载直链
 *
 * 可调环境变量：
 *   REPO        仓库，默认 EnzoVechace/CET-4-for-word
 *   TAG         标签，等价于第一个命令行参数
 *   ASSETS      只传其中几个，逗号分隔，例如 ASSETS=词计划.exe,使用说明.txt
 *   DNS_SERVERS 解析 GitHub 用的 DNS，默认 114.114.114.114,223.5.5.5
 *
 * 为什么要自己解析 DNS：这台机器的 hosts 把 github.com / api.github.com /
 * uploads.github.com 全指到了 127.0.0.1（本地代理工具留下的），系统解析拿不到
 * 真实地址。这里改成向公共 DNS 直问真实 IP，再用「连 IP + SNI/Host 仍写域名」
 * 的方式发请求，就能绕开 hosts。
 */

import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import dns from 'node:dns';
import { Resolver } from 'node:dns/promises';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

/**
 * 这台机器上 HTTPS_PROXY / HTTP_PROXY 指着本地代理工具（127.0.0.1:7897），
 * 而那个代理已经挂了 —— 留着它会让 TLS 直接 ECONNRESET。
 *
 * 光在脚本里 delete process.env 不管用（网络栈在这之前就已经把代理配置读走了），
 * 所以这里直接**重开一个没有这些变量的子进程**再跑一遍自己。
 */
const PROXY_KEYS = ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy'];
if (PROXY_KEYS.some((k) => process.env[k])) {
  const env = { ...process.env };
  for (const k of PROXY_KEYS) delete env[k];
  console.log('清掉指向死代理的 *_PROXY 环境变量后重新执行…');
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { env, stdio: 'inherit' });
  process.exit(r.status === null ? 1 : r.status);
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DIST = path.join(ROOT, 'dist');

const REPO = process.env.REPO || 'EnzoVechace/CET-4-for-word';
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const VERSION = (process.env.VERSION || '1.2').replace(/^v/, '');
const TAG = process.argv[2] || process.env.TAG || `v${VERSION}`;
const DNS_SERVERS = (process.env.DNS_SERVERS || '114.114.114.114,223.5.5.5')
  .split(',').map((s) => s.trim()).filter(Boolean);

/**
 * 要上传的文件：[上传到 Release 的文件名, dist 下的实际文件名]
 *
 * 上传名必须是**纯 ASCII** —— GitHub 会把 Release 附件名里的非 ASCII 字符
 * 直接删掉（`wordplan-说明.txt` 会变成 `wordplan-.txt`，`词计划.exe` 会变成
 * `default.exe`），中文说明写在 release body 里。
 */
const ALL_ASSETS = [
  [`WordPlan-${VERSION}-web.html`, '词计划.html'],
  [`WordPlan-${VERSION}-win64.exe`, '词计划.exe'],
  [`WordPlan-${VERSION}-android.apk`, `词计划_${VERSION}.apk`],
  [`WordPlan-${VERSION}-readme-zh.txt`, '使用说明.txt'],
];

/* 只传其中几个：set ASSETS=WordPlan-1.2-win64.exe,WordPlan-1.2-readme-zh.txt */
const picked = (process.env.ASSETS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const ASSETS = picked.length ? ALL_ASSETS.filter(([n]) => picked.includes(n)) : ALL_ASSETS;

const API = 'https://api.github.com';
const UPLOADS = 'https://uploads.github.com';

function die(msg) {
  console.error('✖ ' + msg);
  process.exit(1);
}

function log(msg) {
  console.log(msg);
}

if (!TOKEN) {
  die('没有找到 GH_TOKEN / GITHUB_TOKEN。\n' +
      '  去 https://github.com/settings/tokens 建一个勾了 repo 的 token，然后：\n' +
      '    $env:GH_TOKEN="ghp_xxx"; node tools/release.mjs v' + VERSION);
}

/* ----------------------------------------------- DNS ------------------ */

const resolver = new Resolver();
resolver.setServers(DNS_SERVERS);
const ipCache = new Map();

async function realIp(host) {
  if (ipCache.has(host)) return ipCache.get(host);

  // 系统解析如果是公网地址就直接用（正常的网络环境下走这条）
  try {
    const viaSystem = await new Promise((res, rej) =>
      dns.lookup(host, { family: 4 }, (e, a) => (e ? rej(e) : res(a))));
    if (viaSystem && !viaSystem.startsWith('127.') && !viaSystem.startsWith('0.')) {
      ipCache.set(host, viaSystem);
      return viaSystem;
    }
  } catch { /* 落到下面直问 DNS */ }

  let lastErr = null;
  for (const server of [...DNS_SERVERS]) {
    const r = new Resolver();
    r.setServers([server]);
    try {
      const list = await r.resolve4(host);
      if (list && list.length) {
        ipCache.set(host, list[0]);
        return list[0];
      }
    } catch (e) {
      lastErr = e;
    }
  }
  die(`解析 ${host} 失败：${lastErr ? lastErr.code || lastErr.message : '无结果'}\n` +
      `  （本机 hosts 把 github 指到了 127.0.0.1；可用 DNS_SERVERS 换一个 DNS）`);
}

/* -------------------------------------------- HTTP -------------------- */

/**
 * 发一个请求。连的是真实 IP，但 SNI 与 Host 头仍然是域名，
 * 这样 TLS 证书校验和 GitHub 的路由都正常。
 */
async function request(method, urlStr, { headers = {}, body = null } = {}) {
  const url = new URL(urlStr);
  const ip = await realIp(url.hostname);
  const port = url.port || 443;

  return new Promise((resolve, reject) => {
    const req = https.request({
      host: ip,
      port: Number(port),
      servername: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        Host: url.hostname,
        'User-Agent': 'wordplan-release',
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...headers,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch { data = text; }
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, data });
      });
    });

    req.setTimeout(120000, () => req.destroy(new Error('请求超时（120s）')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function authHeaders(extra = {}) {
  return {
    Authorization: `Bearer ${TOKEN}`,
    ...extra,
  };
}

/* ------------------------------------------ release ------------------- */

function defaultBody() {
  return [
    `## 词计划 · 四级词汇周计划 ${TAG}`,
    '',
    '配合星火《四级词汇周计划》(ISBN 978-7-231-02372-5) 的词表与背单词应用。',
    '词表里的**单词和顺序与书上完全一致**（取自官方资源包的 `.lrc`）。',
    '',
    '### 下载哪个',
    '',
    '| 文件 | 用途 |',
    '|---|---|',
    '| `词计划.html` | **网页版，双击就能用**。单文件，词库内嵌，手机也能开 |',
    '| `词计划.exe` | Windows 版。第一次运行若缺 WebView2 运行时会弹窗问你要不要装 |',
    `| \`词计划_${VERSION}.apk\` | 安卓版。装之前若装过旧版，直接覆盖安装即可（进度会保留） |`,
    '| `使用说明.txt` | 上面三个的简版说明 |',
    '',
    '### 这一版最大的变化：发音不再依赖系统语音引擎',
    '',
    'exe 和 apk **自带 7400 段发音**（3700 个词 × 美音/英音，Opus 编码，合计 16.97 MB），',
    '所以手机 / 电脑上**一个语音引擎都不用装**，下载下来就能念。',
    '播放优先级：打包音频 → 系统原生语音 → 浏览器语音合成。',
    '（网页版 `词计划.html` 为了保持 700 多 KB 的体积没有内置音频，走浏览器自带的语音合成。）',
    '',
    '### 功能一览',
    '',
    '- 四种练习模式：跟打 / 默写 / 听音 / 选择',
    '- 范围筛选：全部 / 未学 / 未掌握 / 错词本 / 待复习；书序或打乱；每轮数量随便填',
    '- 熟练度 0–7 的间隔重复，进度按词保存',
    '- 点词库右边的「展开」能看里面每个词和一小截释义',
    '- 续传时上次背过的词还在会话里，「上一词」能翻回去',
    '- **答错一定停下来**（「答对后自动下一词」只对答对的词生效）',
    '- `program(me)`、`realize,-ise` 这类可选写法，打哪种都判对',
    '- 高频释义按 Collins COBUILD 语料库的义项频次划虚线',
    '- 点「美」发美音、点「英」发英音；深浅色跟随系统',
    '',
    '完整说明见仓库 [README](https://github.com/' + REPO + '#readme)。',
  ].join('\n');
}

async function findRelease() {
  const r = await request('GET', `${API}/repos/${REPO}/releases/tags/${encodeURIComponent(TAG)}`,
    { headers: authHeaders() });
  if (r.ok) return r.data;
  if (r.status === 404) return null;
  die(`查询 release 失败：HTTP ${r.status} ${JSON.stringify(r.data).slice(0, 300)}`);
}

async function createRelease() {
  const payload = Buffer.from(JSON.stringify({
    tag_name: TAG,
    name: `词计划 ${TAG} · 四级词汇周计划`,
    body: defaultBody(),
    draft: false,
    prerelease: false,
  }), 'utf8');
  const r = await request('POST', `${API}/repos/${REPO}/releases`, {
    headers: authHeaders({ 'Content-Type': 'application/json', 'Content-Length': String(payload.length) }),
    body: payload,
  });
  if (!r.ok) die(`创建 release 失败：HTTP ${r.status} ${JSON.stringify(r.data).slice(0, 300)}`);
  return r.data;
}

async function deleteAsset(assetId) {
  const r = await request('DELETE', `${API}/repos/${REPO}/releases/assets/${assetId}`,
    { headers: authHeaders() });
  if (!r.ok) log(`  （删除旧 asset ${assetId} 失败：HTTP ${r.status}，继续）`);
}

async function upload(releaseId, name, file) {
  const buf = fs.readFileSync(file);
  const url = `${UPLOADS}/repos/${REPO}/releases/${releaseId}/assets?name=${encodeURIComponent(name)}`;
  const r = await request('POST', url, {
    headers: authHeaders({ 'Content-Type': 'application/octet-stream', 'Content-Length': String(buf.length) }),
    body: buf,
  });
  if (!r.ok) die(`上传 ${name} 失败：HTTP ${r.status} ${JSON.stringify(r.data).slice(0, 300)}`);
  if (r.data && r.data.name !== name) {
    die(`上传 ${name} 后 GitHub 把名字改成了「${r.data.name}」——\n` +
        `  Release 附件名只允许 ASCII，非 ASCII 字符会被直接删掉。请改用英文名。`);
  }
  return r.data;
}

/** 把不在清单里的旧 asset 删掉（GitHub 改名前留下的垃圾），要 PRUNE=1 才动 */
async function prune(release, keep) {
  for (const a of release.assets || []) {
    if (keep.includes(a.name)) continue;
    log(`− 清掉多余 asset ${a.name}（${(a.size / 1024).toFixed(0)} KB）`);
    await deleteAsset(a.id);
  }
}

/* ---------------------------------------------------------------------- */

log(`仓库   ${REPO}`);
log(`标签   ${TAG}`);
log(`DNS    ${DNS_SERVERS.join(', ')}`);

let release = await findRelease();
if (release) {
  log(`找到已有 release #${release.id}  ${release.html_url}`);
} else {
  release = await createRelease();
  log(`已创建 release #${release.id}  ${release.html_url}`);
}

log('');

if (process.env.PRUNE) {
  // 只保留这次要传的 + 清单里所有的名字（避免把已传好的其它成品误删）
  await prune(release, ALL_ASSETS.map(([n]) => n));
  release = await findRelease();
}

for (const [assetName, fileName] of ASSETS) {
  const file = path.join(DIST, fileName);
  if (!fs.existsSync(file)) {
    log(`跳过 ${assetName}：${file} 不存在（先跑 tools/build_*.mjs）`);
    continue;
  }
  const existing = (release.assets || []).find((a) => a.name === assetName);
  if (existing) await deleteAsset(existing.id);
  const a = await upload(release.id, assetName, file);
  log(`✔ ${assetName.padEnd(20)} ${(a.size / 1024).toFixed(0).padStart(6)} KB  ${a.browser_download_url}`);
}

log('');
log(`完成 → ${release.html_url}`);
