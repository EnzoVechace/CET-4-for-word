#!/usr/bin/env node
/**
 * 把 dist/ 里的三端成品挂到 GitHub Releases 上。
 *
 *   set GH_TOKEN=ghp_xxx          # 需要 repo 权限的 Personal Access Token
 *   node tools/release.mjs v1.1   # 第二个参数省略时用 package 版本号
 *
 * 会做这些事：
 *   1. 按 tag 找 release，没有就建一个（默认不是 draft）
 *   2. 同名 asset 先删掉再传，所以可以反复跑
 *   3. 传完后打印下载直链
 *
 * 仓库用 REPO 环境变量覆盖，默认 EnzoVechace/CET-4-for-word。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DIST = path.join(ROOT, 'dist');

const REPO = process.env.REPO || 'EnzoVechace/CET-4-for-word';
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const TAG = process.argv[2] || process.env.TAG || 'v1.1';

/** 要上传的文件：文件名 → 在 dist 下的实际文件名 */
const ASSETS = [
  ['词计划.html', '词计划.html'],
  ['词计划.exe', '词计划.exe'],
  ['词计划_1.1.apk', '词计划_1.1.apk'],
  ['使用说明.txt', '使用说明.txt'],
];

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
      '    $env:GH_TOKEN="ghp_xxx"; node tools/release.mjs v1.1');
}

const API = 'https://api.github.com';
const UPLOADS = 'https://uploads.github.com';

async function api(method, url, { json, body, headers } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'wordplan-release',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(json ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: json ? JSON.stringify(json) : body,
    redirect: 'follow',
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

function defaultBody() {
  return [
    '## 词计划 · 四级词汇周计划',
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
    '| `词计划_1.1.apk` | 安卓版。装之前若装过旧版，直接覆盖安装即可（进度会保留） |',
    '| `使用说明.txt` | 上面三个的简版说明 |',
    '',
    '### 这一版有什么',
    '',
    '- 四种练习模式：跟打 / 默写 / 听音 / 选择',
    '- 范围筛选：全部 / 未学 / 未掌握 / 错词本 / 待复习；书序或打乱；每轮数量随便填',
    '- 熟练度 0–7 的间隔重复，进度按词保存，三端互通不了但同一端内不会丢',
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
  const r = await api('GET', `${API}/repos/${REPO}/releases/tags/${encodeURIComponent(TAG)}`);
  if (r.ok) return r.data;
  if (r.status === 404) return null;
  die(`查询 release 失败：HTTP ${r.status} ${JSON.stringify(r.data).slice(0, 300)}`);
}

async function createRelease() {
  const r = await api('POST', `${API}/repos/${REPO}/releases`, {
    json: {
      tag_name: TAG,
      name: `词计划 ${TAG} · 四级词汇周计划`,
      body: defaultBody(),
      draft: false,
      prerelease: false,
    },
  });
  if (!r.ok) die(`创建 release 失败：HTTP ${r.status} ${JSON.stringify(r.data).slice(0, 300)}`);
  return r.data;
}

async function deleteAsset(assetId) {
  const r = await api('DELETE', `${API}/repos/${REPO}/releases/assets/${assetId}`);
  if (!r.ok) log(`  （删除旧 asset ${assetId} 失败：HTTP ${r.status}，继续）`);
}

async function upload(releaseId, name, file) {
  const buf = fs.readFileSync(file);
  const url = `${UPLOADS}/repos/${REPO}/releases/${releaseId}/assets?name=${encodeURIComponent(name)}`;
  const r = await api('POST', url, {
    body: buf,
    headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(buf.length) },
  });
  if (!r.ok) die(`上传 ${name} 失败：HTTP ${r.status} ${JSON.stringify(r.data).slice(0, 300)}`);
  return r.data;
}

/* ------------------------------------------------------------------ */

log(`仓库   ${REPO}`);
log(`标签   ${TAG}`);

let release = await findRelease();
if (release) {
  log(`找到已有 release #${release.id}  ${release.html_url}`);
} else {
  release = await createRelease();
  log(`已创建 release #${release.id}  ${release.html_url}`);
}

log('');

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
