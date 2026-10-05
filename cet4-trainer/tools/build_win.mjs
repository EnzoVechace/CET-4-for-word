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

  // SAPI5 语音合成。csc.exe（.NET Framework 4 自带那个）不会自动找到它，
  // 必须给出真实路径——它躺在 WPF 子目录或 GAC 里，不在默认引用目录。
  const SPEECH_CANDIDATES = [
    'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\WPF\\System.Speech.dll',
    'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\WPF\\System.Speech.dll',
    'C:\\Windows\\Microsoft.NET\\assembly\\GAC_MSIL\\System.Speech\\v4.0_4.0.0.0__31bf3856ad364e35\\System.Speech.dll',
  ];
  const speechDll = SPEECH_CANDIDATES.find((p) => fs.existsSync(p));
  if (!speechDll) {
    throw new Error('找不到 System.Speech.dll（Windows 版念单词要靠它）');
  }

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
    // 解音频 zip 用（Payload.ExtractAll 里的 ZipFile.ExtractToDirectory）
    '/reference:System.IO.Compression.dll',
    '/reference:System.IO.Compression.FileSystem.dll',
    // 念单词 / 释义用的 SAPI5（见 native/Program.cs 里的 WindowsTts）
    `/reference:${speechDll}`,
  ];

  // 网页资源。
  // public/audio/ 下是几千个发音小文件，一个个当 /resource: 会撑爆 Windows 的
  // 命令行长度上限（约 32k 字符），所以单独打成一个 zip 当**单个**嵌入资源，
  // 运行时由 Program.cs 的 Payload.ExtractAll() 解到 web/audio/ 下。
  const files = walk(PUBLIC).filter((rel) => !rel.startsWith('audio/'));
  for (const rel of files) {
    args.push(`/resource:${path.join(PUBLIC, rel)},web/${rel}`);
  }

  let audioNote = '没有打包音频';
  const audioDir = path.join(PUBLIC, 'audio');
  if (fs.existsSync(path.join(audioDir, 'manifest.json'))) {
    const zip = path.join(BUILD, 'audio.zip');
    if (fs.existsSync(zip)) fs.rmSync(zip, { force: true });
    // tar.exe（Windows 10+ 自带 bsdtar）按扩展名自动出 zip，比 Compress-Archive 快得多
    let z = spawnSync('tar', ['-a', '-c', '-f', zip, '-C', PUBLIC, 'audio'], { stdio: 'inherit' });
    if (z.error || z.status !== 0) {
      console.log('  tar 打包音频失败，改用 Compress-Archive');
      z = spawnSync('powershell.exe', ['-NoProfile', '-Command',
        `Compress-Archive -Path '${audioDir}' -DestinationPath '${zip}' -Force`], { stdio: 'inherit' });
      if (z.error) throw z.error;
      if (z.status !== 0) throw new Error(`音频打包失败，退出码 ${z.status}`);
    }
    args.push(`/resource:${zip},audiozip/audio.zip`);
    audioNote = `音频 zip ${(fs.statSync(zip).size / 1048576).toFixed(1)} MB`;
  }

  // WebView2 托管 DLL + 原生 loader + 图标
  args.push(`/resource:${core},lib/Microsoft.Web.WebView2.Core.dll`);
  args.push(`/resource:${winforms},lib/Microsoft.Web.WebView2.WinForms.dll`);
  args.push(`/resource:${loader},native/WebView2Loader.dll`);
  args.push(`/resource:${ico},icon/app.ico`);
  args.push(`/resource:${bootstrap},boot/WebView2Setup.exe`);

  args.push(path.join(ROOT, 'native', 'Program.cs'));

  console.log(`嵌入 ${files.length} 个网页文件 + 3 个本地库 + WebView2 引导安装器 + ${audioNote}`);
  // 音频 zip 里文件太多，csc 的 /resource 本身不限制，但我们得确认总参数长度没爆
  const argLen = args.reduce((a, s) => a + s.length + 3, 0);
  if (argLen > 30000) throw new Error(`命令行参数总长 ${argLen}，接近 Windows 上限了`);
  const res = spawnSync(CSC, args, { stdio: 'inherit', cwd: ROOT });
  if (res.error) throw res.error;
  if (res.status !== 0) throw new Error(`csc 退出码 ${res.status}`);

  fs.copyFileSync(exeAscii, exeChinese);
  for (const p of [exeAscii, exeChinese]) {
    console.log(`${String(fs.statSync(p).size).padStart(9)}  ${path.relative(ROOT, p)}`);
  }
}

main();
