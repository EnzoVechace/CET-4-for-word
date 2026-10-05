/* 下载 WebView2 Evergreen Bootstrapper（约 1.7 MB），编译 Windows 版时嵌进 exe。
 * 目标机器没装 WebView2 运行时时，exe 会自动跑它来装。
 *
 * usage: node tools/get_bootstrapper.mjs [--force]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);
const OUT = path.join(ROOT, 'build', 'MicrosoftEdgeWebview2Setup.exe');

// fwlink 会 302 到 https://msedge.sf.dl.delivery.mp.microsoft.com/…/MicrosoftEdgeWebview2Setup.exe
const URLS = [
  'https://go.microsoft.com/fwlink/p/?LinkId=2124703',
  'https://msedge.sf.dl.delivery.mp.microsoft.com/filestreamingservice/files/9e0d6b5c-0a5f-4c1e-9a75-3e1f2e2f5b6c/MicrosoftEdgeWebview2Setup.exe',
];

const force = process.argv.includes('--force');

async function grab(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 500000) throw new Error(`文件太小（${buf.length} B），不像 bootstrapper`);
  if (buf.subarray(0, 2).toString('ascii') !== 'MZ') throw new Error('不是 PE 可执行文件');
  return buf;
}

async function main() {
  if (fs.existsSync(OUT) && !force) {
    console.log(`已存在，跳过：${path.relative(ROOT, OUT)} (${fs.statSync(OUT).size} B)`);
    return;
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  let lastErr = null;
  for (const url of URLS) {
    try {
      const buf = await grab(url);
      fs.writeFileSync(OUT, buf);
      console.log(`✔ ${path.relative(ROOT, OUT)}  ${buf.length} B`);
      return;
    } catch (err) {
      lastErr = err;
      console.log(`  ✗ ${url}\n    ${err.message}`);
    }
  }
  throw lastErr || new Error('全部下载源都失败');
}

main().catch((err) => {
  console.error('失败：' + err.message);
  process.exit(1);
});
