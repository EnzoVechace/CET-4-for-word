/* 编译「词计划.exe」——单文件 Windows 桌面版。
 *
 * 把 public/ 下的全部网页资源、两个 WebView2 托管 DLL、原生 WebView2Loader.dll
 * 以及图标，统统作为嵌入资源塞进 exe，运行时再解到 %LOCALAPPDATA%\WordPlan。
 * 所以最终交付的就是一个 exe 文件，旁边不需要任何东西。
 *
 * usage: node tools/build_win.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);
const PUBLIC = path.join(ROOT, 'public');
const DIST = path.join(ROOT, 'dist');
const BUILD = path.join(ROOT, 'build');
const WEBVIEW2 = path.join(BUILD, 'webview2');

const CSC = process.env.CSC || 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';

function walk(dir, base = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(path.join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out;
}

function main() {
  if (!fs.existsSync(CSC)) throw new Error(`找不到 csc.exe：${CSC}`);

  const core = path.join(WEBVIEW2, 'lib', 'net462', 'Microsoft.Web.WebView2.Core.dll');
  const winforms = path.join(WEBVIEW2, 'lib', 'net462', 'Microsoft.Web.WebView2.WinForms.dll');
  const loader = path.join(WEBVIEW2, 'runtimes', 'win-x64', 'native', 'WebView2Loader.dll');
  for (const p of [core, winforms, loader]) {
    if (!fs.existsSync(p)) throw new Error(`缺文件：${p}（先跑 node tools/get_webview2.mjs）`);
  }

  const ico = path.join(BUILD, 'app.ico');
  if (!fs.existsSync(ico)) throw new Error(`缺图标 ${ico}（先跑 python tools/make_icons.py）`);

  // WebView2 官方引导安装器：目标机器没装运行时时，exe 自己跑它来装
  const bootstrap = path.join(BUILD, 'MicrosoftEdgeWebview2Setup.exe');
  if (!fs.existsSync(bootstrap)) {
    throw new Error(`缺 ${bootstrap}（先跑 node tools/get_bootstrapper.mjs）`);
  }

  fs.mkdirSync(DIST, { recursive: true });
  const exeAscii = path.join(DIST, 'WordPlan.exe');
  const exeChinese = path.join(DIST, '词计划.exe');

  const args = [
    '/nologo',
    '/target:winexe',
    '/platform:x64',
    '/optimize+',
    '/codepage:65001',
    `/out:${exeAscii}`,
    `/win32icon:${ico}`,
    `/win32manifest:${path.join(ROOT, 'native', 'app.manifest')}`,
    `/reference:${core}`,
    `/reference:${winforms}`,
    '/reference:System.dll',
    '/reference:System.Drawing.dll',
    '/reference:System.Windows.Forms.dll',
  ];

  // 网页资源
  const files = walk(PUBLIC);
  for (const rel of files) {
    args.push(`/resource:${path.join(PUBLIC, rel)},web/${rel}`);
  }
  // WebView2 托管 DLL + 原生 loader + 图标
  args.push(`/resource:${core},lib/Microsoft.Web.WebView2.Core.dll`);
  args.push(`/resource:${winforms},lib/Microsoft.Web.WebView2.WinForms.dll`);
  args.push(`/resource:${loader},native/WebView2Loader.dll`);
  args.push(`/resource:${ico},icon/app.ico`);
  args.push(`/resource:${bootstrap},boot/WebView2Setup.exe`);

  args.push(path.join(ROOT, 'native', 'Program.cs'));

  console.log(`嵌入 ${files.length} 个网页文件 + 3 个本地库 + WebView2 引导安装器`);
  const res = spawnSync(CSC, args, { stdio: 'inherit', cwd: ROOT });
  if (res.error) throw res.error;
  if (res.status !== 0) throw new Error(`csc 退出码 ${res.status}`);

  fs.copyFileSync(exeAscii, exeChinese);
  for (const p of [exeAscii, exeChinese]) {
    console.log(`${String(fs.statSync(p).size).padStart(9)}  ${path.relative(ROOT, p)}`);
  }
}

main();
