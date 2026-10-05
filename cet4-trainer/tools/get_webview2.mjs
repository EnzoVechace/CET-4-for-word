/**
 * 下载 Microsoft.Web.WebView2 的 nupkg 并解出编译 Windows 程序所需的 DLL。
 * 用法：node tools/get_webview2.mjs
 * 产物：build\webview2\   （lib\net45\*.dll + runtimes\win-x64\native\WebView2Loader.dll）
 */
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'build', 'webview2');
const PKG = path.join(ROOT, 'build', 'webview2.nupkg');

// 实测：api.nuget.org 走直连可以（走本机 7897 代理反而被 ECONNRESET），所以这里一律直连
function get(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 60000 }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        resolve(get(new URL(res.headers.location, url).href, redirects - 1));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      resolve(res);
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
  });
}

async function readAll(res) {
  const chunks = [];
  for await (const c of res) chunks.push(c);
  return Buffer.concat(chunks);
}

console.log('[1/4] 查询 NuGet 版本列表 …');
const index = JSON.parse((await readAll(await get('https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/index.json'))).toString());
const stable = index.versions.filter((v) => !/-/.test(v));
const version = stable[stable.length - 1];
console.log(`      最新稳定版：${version}`);

console.log('[2/4] 下载 nupkg …');
fs.mkdirSync(path.dirname(PKG), { recursive: true });
const nupkg = await readAll(await get(`https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/${version}/microsoft.web.webview2.${version}.nupkg`));
fs.writeFileSync(PKG, nupkg);
console.log(`      ${PKG}  ${nupkg.length} B`);

console.log('[3/4] 解压 …');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
// bsdtar（Windows 自带 tar.exe）能直接读 zip/nupkg
execFileSync('tar', ['-xf', PKG, '-C', OUT], { stdio: 'inherit' });

console.log('[4/4] 收集需要的 DLL …');
const wanted = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.dll$/i.test(e.name)) wanted.push(p);
  }
};
walk(OUT);

const lib = path.join(OUT, 'lib');
const native = path.join(OUT, 'runtimes', 'win-x64', 'native');
const files = fs.existsSync(lib) ? fs.readdirSync(lib) : [];
const nat = fs.existsSync(native) ? fs.readdirSync(native) : [];
console.log(`      lib 目录：${JSON.stringify(files)}`);
console.log(`      native 目录：${JSON.stringify(nat)}`);
fs.writeFileSync(path.join(ROOT, 'build', 'webview2-info.json'), JSON.stringify({ version, files, native: nat }, null, 2));
console.log('\n完成。版本信息写入 build/webview2-info.json');
