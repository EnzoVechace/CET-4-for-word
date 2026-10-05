/**
 * 一次性拿到一个 static ffmpeg，只为把有道那批 64 kbps 的单词音频压成 ~16 kbps Opus。
 *
 * 为什么要它：不压的话 3700 个词 × 2 种口音 ≈ 75 MB，塞进 APK/exe 太臃肿；
 * 压成 Opus 之后大约 10 MB，而且 Edge / Chrome / Android WebView 的 <audio> 都支持 Ogg Opus。
 *
 * 两条来源，优先 npm（快且稳）：
 *   1. https://registry.npmjs.org/@ffmpeg-installer/win32-x64/-/win32-x64-4.1.0.tgz
 *      这个包里直接带着 ffmpeg.exe，不用再去 GitHub 下载。
 *   2. https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip（会 303 到 packages/…，109 MB）
 *
 * 产物放在 cet4-trainer/build/ffmpeg/（已在 .gitignore 里），不进仓库。
 *
 * usage: node tools/get_ffmpeg.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'build', 'ffmpeg');
const UA = 'Mozilla/5.0';

const SOURCES = [
  {
    name: 'npm @ffmpeg-installer/win32-x64',
    url: 'https://registry.npmjs.org/@ffmpeg-installer/win32-x64/-/win32-x64-4.1.0.tgz',
    file: 'win32-x64.tgz',
    kind: 'tgz',
  },
  {
    name: 'gyan.dev essentials build',
    url: 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
    file: 'ffmpeg.zip',
    kind: 'zip',
  },
];

function follow(url, depth = 0) {
  if (depth > 6) throw new Error('重定向太多');
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, Accept: '*/*' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        console.log(`  → ${res.statusCode} ${next.slice(0, 100)}`);
        return follow(next, depth + 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode));
      }
      resolve({ res, url });
    });
    req.setTimeout(120000, () => req.destroy(new Error('连接超时（120 秒没动静）')));
    req.on('error', reject);
  });
}

async function download(src) {
  const out = path.join(DIR, src.file);
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const { res, url } = await follow(src.url);
      const total = Number(res.headers['content-length'] || 0);
      console.log(`  下载 ${url}`);
      if (total) console.log(`  大小 ${(total / 1048576).toFixed(1)} MB`);
      const ws = fs.createWriteStream(out);
      let got = 0;
      let lastPct = -1;
      await new Promise((resolve, reject) => {
        res.on('data', (c) => {
          got += c.length;
          ws.write(c);
          if (total) {
            const pct = Math.floor((got / total) * 100);
            if (pct >= lastPct + 20) { lastPct = pct; console.log(`  ${pct}%  ${(got / 1048576).toFixed(1)} MB`); }
          }
        });
        res.on('end', () => ws.end(resolve));
        res.on('error', reject);
        ws.on('error', reject);
      });
      if (total && got !== total) throw new Error(`只下到 ${got} / ${total} 字节`);
      console.log(`  已保存 ${(got / 1048576).toFixed(1)} MB`);
      return out;
    } catch (e) {
      console.log(`  第 ${attempt} 次失败：${e.message}`);
      try { fs.rmSync(out, { force: true }); } catch { /* ignore */ }
    }
  }
  return null;
}

function extractArchive(file, kind) {
  console.log(`  解压（${kind}）…`);
  const isTgz = kind === 'tgz';
  const r = isTgz
    ? spawnSync('tar', ['-xzf', file, '-C', DIR], { stdio: 'inherit' })
    : spawnSync('powershell.exe', ['-NoProfile', '-Command',
        `Expand-Archive -LiteralPath '${file}' -DestinationPath '${DIR}' -Force`], { stdio: 'inherit' });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error('解压失败，退出码 ' + r.status);
}

function findExe() {
  const found = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/^ffmpeg\.exe$/i.test(e.name)) found.push(p);
    }
  })(DIR);
  return found[0] || null;
}

/**
 * 把找到的 ffmpeg.exe 挪到 DIR 根下，其余解压出来的东西全删掉。
 * 注意：不能直接遍历 DIR 顶层就删 —— tarball 里 exe 在 `package/` 子目录里，
 * 删掉那个子目录就把 exe 一起删了（第一版就踩了这个，报
 * `ENOENT: stat 'build\ffmpeg\package\ffmpeg.exe'`）。所以先复制到根，再清理。
 */
function keepOnly(found) {
  const finalPath = path.join(DIR, 'ffmpeg.exe');
  if (path.resolve(found) !== path.resolve(finalPath)) {
    fs.copyFileSync(found, finalPath);
  }
  for (const e of fs.readdirSync(DIR, { withFileTypes: true })) {
    const p = path.join(DIR, e.name);
    if (path.resolve(p) === path.resolve(finalPath)) continue;
    try {
      if (e.isDirectory()) fs.rmSync(p, { recursive: true, force: true });
      else fs.rmSync(p, { force: true });
    } catch { /* ignore */ }
  }
  return finalPath;
}

async function main() {
  fs.mkdirSync(DIR, { recursive: true });
  const existing = findExe();
  if (existing) {
    console.log('已经有了：' + existing);
    return;
  }
  for (const src of SOURCES) {
    console.log(`\n试来源：${src.name}`);
    const file = await download(src);
    if (!file) continue;
    try { extractArchive(file, src.kind); } catch (e) { console.log('  ' + e.message); continue; }
    try { fs.rmSync(file, { force: true }); } catch { /* ignore */ }
    const found = findExe();
    if (!found) { console.log('  解压完没找到 ffmpeg.exe'); continue; }
    const exe = keepOnly(found);
    console.log(`\n✔ ${exe}  ${(fs.statSync(exe).size / 1048576).toFixed(1)} MB`);
    const v = spawnSync(exe, ['-version'], { encoding: 'utf8' });
    if (v.stdout) console.log('  ' + v.stdout.split('\n')[0]);
    return;
  }
  console.error('\n两条来源都没成功。');
  process.exit(1);
}

main();
