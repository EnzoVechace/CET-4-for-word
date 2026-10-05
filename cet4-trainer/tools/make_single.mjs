/* 把整个应用打成一个「单文件离线 HTML」。
 *
 * 为什么需要：安卓上没有 Android SDK 就编不出 APK，
 * 而 file:// 下浏览器不允许加载 ES module（CORS），所以把
 *   - CSS 内联成 <style>
 *   - 8 个 ES module 打成一个普通 <script>
 *   - 10 个词库 JSON 塞进 window.__EMBEDDED_DICTS
 * 之后就得到一个双击即用、完全离线、可以拷到手机上打开的文件。
 *
 * usage: node tools/make_single.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);
const PUBLIC = path.join(ROOT, 'public');
const DIST = path.join(ROOT, 'dist');

/* 依赖顺序：靠前的模块不能 import 靠后的。
   speech.js 现在要从 dict.js 取 altForms()（算发音文件的 slug），
   所以 dict.js 必须排在 speech.js 前面，否则 __M['./dict.js'] 还是 undefined。 */
const ORDER = [
  'js/store.js',
  'js/ui.js',
  'js/dict.js',
  'js/speech.js',
  'js/practice.js',
  'js/stats.js',
  'js/settings.js',
  'js/app.js',
];

const RE_NS_IMPORT = /^import\s+\*\s+as\s+(\w+)\s+from\s+'([^']+)';?[ \t]*$/gm;
const RE_NAMED_IMPORT = /^import\s+\{([^}]+)\}\s+from\s+'([^']+)';?[ \t]*$/gm;
const RE_EXPORT_FN = /^export\s+(?:async\s+)?function\s+(\w+)/gm;
const RE_EXPORT_VAR = /^export\s+(?:const|let|var)\s+(\w+)/gm;

function bundleModule(rel) {
  const abs = path.join(PUBLIC, rel);
  let code = fs.readFileSync(abs, 'utf8');

  const names = [];
  for (const m of code.matchAll(RE_EXPORT_FN)) names.push(m[1]);
  for (const m of code.matchAll(RE_EXPORT_VAR)) names.push(m[1]);

  code = code
    .replace(RE_NS_IMPORT, (_s, id, from) => `const ${id} = __M['${from}'];`)
    .replace(RE_NAMED_IMPORT, (_s, list, from) => `const {${list}} = __M['${from}'];`)
    .replace(/^export\s+/gm, '');

  const key = './' + rel.replace(/^js\//, '');
  const tail = names.length ? `\nreturn { ${names.join(', ')} };\n` : '\nreturn {};\n';
  return `__M[${JSON.stringify(key)}] = (function () {\n${code}${tail}})();\n`;
}

function readDicts() {
  const out = {};
  out['data/dicts.json'] = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'data/dicts.json'), 'utf8'));
  const dictDir = path.join(PUBLIC, 'dict');
  for (const f of fs.readdirSync(dictDir).sort()) {
    if (!f.endsWith('.json')) continue;
    out[`dict/${f}`] = JSON.parse(fs.readFileSync(path.join(dictDir, f), 'utf8'));
  }
  return out;
}

function main() {
  const css = fs.readFileSync(path.join(PUBLIC, 'css/style.css'), 'utf8');
  const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');

  const modules = ORDER.map(bundleModule).join('\n');
  const dicts = readDicts();

  const json = JSON.stringify(dicts).replace(/<\//g, '<\\/');
  const script =
    `<script>\nwindow.__EMBEDDED_DICTS = ${json};\n</script>\n` +
    `<script>\n(function () {\n'use strict';\nvar __M = {};\nwindow.__M = __M;\n${modules}\n})();\n</script>`;

  let out = html
    .replace(/^\s*<link rel="manifest"[^>]*>\s*$/m, '')
    .replace(/^\s*<link rel="stylesheet" href="css\/style\.css"[^>]*>\s*$/m, `<style>\n${css}\n</style>`)
    .replace(/^\s*<script type="module" src="js\/app\.js"><\/script>\s*$/m, script);

  if (out === html) throw new Error('替换失败：index.html 的结构变了，检查 style.css / app.js 的引用行');
  if (out.includes('js/app.js')) throw new Error('还有残留的模块引用');

  fs.mkdirSync(DIST, { recursive: true });
  const targets = [path.join(DIST, '词计划.html'), path.join(DIST, 'wordplan-offline.html')];
  for (const t of targets) fs.writeFileSync(t, out, 'utf8');

  console.log(`单文件离线版已生成（${dicts.__count ?? Object.keys(dicts).length} 份数据）`);
  for (const t of targets) console.log(`${String(fs.statSync(t).size).padStart(9)}  ${path.relative(ROOT, t)}`);
}

main();
