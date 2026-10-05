#!/usr/bin/env node
/*
 * build_apk.mjs —— 不依赖 Gradle，直接用 build-tools 手工打出一个签好名的 APK。
 *
 * 流程（每一步都对应 AGP 内部干的事）：
 *   1. 把 public/ 整站拷进 android/build/assets/web
 *   2. aapt2 compile   —— 编译 res/ 里的资源
 *   3. aapt2 link      —— 合成 base.apk（含资源表与 assets）
 *   4. javac           —— 编译三个 Java 类 + aapt2 生成的 R.java
 *   5. d8              —— 把 .class 转成 classes.dex
 *   6. 把 classes.dex 追加进 base.apk（用 Python 的 zipfile，避免重打包动了 resources.arsc）
 *   7. zipalign -p 4   —— 对齐
 *   8. apksigner sign  —— 用项目自带 keystore 签名
 *
 * 用法：node tools/build_apk.mjs
 * 前置：node tools/android_sdk.mjs（会下到 <工作目录>\android-sdk）
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const WORKSPACE = path.resolve(ROOT, '..');

const SDK = process.env.ANDROID_SDK_ROOT || path.join(WORKSPACE, 'android-sdk');
const BT = path.join(SDK, 'build-tools', '34.0.0');
const JAVA_HOME = path.join(SDK, 'jdk17');
const JAVA = path.join(JAVA_HOME, 'bin', 'java.exe');
const ANDROID_JAR = path.join(SDK, 'platforms', 'android-34', 'android.jar');
/* d8.bat / apksigner.bat 只是 java 的包装。Node 24 在 Windows 上不能直接 spawn .bat
   （会 EINVAL），而且包装脚本还会把参数重新拼一遍，索性直接调 java。 */
const D8_JAR = path.join(BT, 'lib', 'd8.jar');
const APKSIGNER_JAR = path.join(BT, 'lib', 'apksigner.jar');

const APP = path.join(ROOT, 'android');
const BUILD = path.join(ROOT, 'build', 'apk');
const DIST = path.join(ROOT, 'dist');
const PY = process.env.PYTHON || 'C:\\Users\\31787\\.dsh\\dsh-runtimes\\dsh-primary-runtime\\dependencies\\python\\python.exe';
const NODE = process.execPath;

const VERSION_CODE = 3;
const VERSION_NAME = '1.2';
const APK_NAME = `词计划_${VERSION_NAME}.apk`;

const KS_DIR = path.join(APP, 'keystore');
const KS = path.join(KS_DIR, 'wordplan.jks');
const KS_PASS = 'wordplan';
const KS_ALIAS = 'wordplan';

/* ------------------------------------------------------------------ 工具 */

const log = (m) => process.stdout.write(m + '\n');
const step = (n, m) => process.stdout.write(`\n[${n}/8] ${m}\n`);

function run(cmd, args, opts) {
  const r = spawnSync(cmd, args, Object.assign({ stdio: 'inherit', env: Object.assign({}, process.env, { JAVA_HOME }) }, opts || {}));
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${path.basename(cmd)} 退出码 ${r.status}`);
  return r;
}

function capture(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', env: Object.assign({}, process.env, { JAVA_HOME }) });
  return { ok: r.status === 0, out: (r.stdout || '') + (r.stderr || ''), status: r.status };
}

function human(n) {
  const u = ['B', 'KB', 'MB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

function copyDir(src, dst, filter) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (filter && !filter(s, e)) continue;
    if (e.isDirectory()) copyDir(s, d, filter);
    else fs.copyFileSync(s, d);
  }
}

function walkFiles(dir, ext) {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (!ext || p.endsWith(ext)) out.push(p);
    }
  }
  return out;
}

function which(name) {
  const p = path.join(BT, name);
  return fs.existsSync(p) ? p : name;
}

/* --------------------------------------------------------------- 前置检查 */

if (!fs.existsSync(path.join(JAVA_HOME, 'bin', 'javac.exe'))) {
  console.error('没找到 JDK17。先跑一次：node tools/android_sdk.mjs');
  process.exit(1);
}

fs.rmSync(BUILD, { recursive: true, force: true });
fs.mkdirSync(BUILD, { recursive: true });
fs.mkdirSync(DIST, { recursive: true });

/* ---------------------------------------------------- 1. 前端整站 → assets */

step(1, '把 public/ 拷进 android/build/assets/web');
const ASSETS = path.join(BUILD, 'assets', 'web');
fs.rmSync(ASSETS, { recursive: true, force: true });
copyDir(path.join(ROOT, 'public'), ASSETS, (_p, e) => e.name !== 'sw.js' ? true : false);
const assetCount = walkFiles(ASSETS).length;
const assetBytes = walkFiles(ASSETS).reduce((a, p) => a + fs.statSync(p).size, 0);
log(`    ${assetCount} 个文件，${human(assetBytes)}（不含 sw.js —— 这里没有 Service Worker 的场景）`);

/* ------------------------------------------------------- 2. aapt2 compile */

step(2, 'aapt2 compile —— 编译资源');
const RES_ZIP = path.join(BUILD, 'res.zip');
run(which('aapt2.exe'), ['compile', '--dir', path.join(APP, 'res'), '-o', RES_ZIP]);
log(`    ${human(fs.statSync(RES_ZIP).size)}`);

/* ---------------------------------------------------------- 3. aapt2 link */

step(3, 'aapt2 link —— 生成 base.apk（资源 + assets）');
const BASE_APK = path.join(BUILD, 'base.apk');
const GEN = path.join(BUILD, 'gen');
fs.mkdirSync(GEN, { recursive: true });
run(which('aapt2.exe'), [
  'link',
  '-o', BASE_APK,
  '-I', ANDROID_JAR,
  '--manifest', path.join(APP, 'AndroidManifest.xml'),
  '--java', GEN,
  '-A', path.join(BUILD, 'assets'),
  '--min-sdk-version', '21',
  '--target-sdk-version', '34',
  '--version-code', String(VERSION_CODE),
  '--version-name', VERSION_NAME,
  '--no-version-vectors',
  RES_ZIP, // 编译产物是位置参数，不是 -R（-R 是 overlay，会让 aapt2 要求覆盖已有资源）
]);
log(`    ${human(fs.statSync(BASE_APK).size)}`);

/* --------------------------------------------------------------- 4. javac */

step(4, 'javac —— 编译 Java 源码');
const CLASSES = path.join(BUILD, 'classes');
fs.mkdirSync(CLASSES, { recursive: true });
const javaSources = walkFiles(path.join(APP, 'java'), '.java').concat(walkFiles(GEN, '.java'));
log(`    ${javaSources.length} 个源文件`);
run(path.join(JAVA_HOME, 'bin', 'javac.exe'), [
  '-encoding', 'UTF-8',
  '-source', '8',
  '-target', '8',
  '-bootclasspath', ANDROID_JAR,
  '-classpath', ANDROID_JAR,
  '-nowarn',
  '-d', CLASSES,
].concat(javaSources));

/* ------------------------------------------------------------------ 5. d8 */

step(5, 'd8 —— 生成 classes.dex');
const DEX_DIR = path.join(BUILD, 'dex');
fs.mkdirSync(DEX_DIR, { recursive: true });
const classFiles = walkFiles(CLASSES, '.class');
log(`    ${classFiles.length} 个 class 文件`);
// d8 的参数表可能有几千项，用 @argfile 递进去。
// 注意：d8 的 argfile 是一行一个参数，且不像 javac 那样会剥掉双引号 —— 千万别加引号。
const argFile = path.join(BUILD, 'd8-args.txt');
fs.writeFileSync(argFile, classFiles.join('\r\n') + '\r\n', 'utf8');
run(JAVA, [
  '-Xmx1024M', '-Xss1m',
  '-cp', D8_JAR,
  'com.android.tools.r8.D8',
  '--lib', ANDROID_JAR,
  '--min-api', '21',
  '--output', DEX_DIR,
  '@' + argFile,
]);
const DEX = path.join(DEX_DIR, 'classes.dex');
if (!fs.existsSync(DEX)) throw new Error('d8 没有产出 classes.dex');
log(`    classes.dex ${human(fs.statSync(DEX).size)}`);

/* -------------------------------------------- 6. 把 dex 追加进 apk（Python） */

step(6, '把 classes.dex 附加进 base.apk');
const zipHelper = path.join(BUILD, '_add_dex.py');
fs.writeFileSync(zipHelper, [
  'import sys, zipfile, shutil, os',
  'apk, dex, out = sys.argv[1], sys.argv[2], sys.argv[3]',
  'shutil.copyfile(apk, out)',
  'with zipfile.ZipFile(out, "a", zipfile.ZIP_DEFLATED) as z:',
  '    z.write(dex, "classes.dex")',
  '    names = z.namelist()',
  'info = zipfile.ZipFile(out).getinfo("resources.arsc")',
  'print("    entries=%d  resources.arsc compress_type=%d (0=stored)" % (len(names), info.compress_type))',
  'assert "classes.dex" in names',
  'assert info.compress_type == zipfile.ZIP_STORED, "resources.arsc 必须保持不压缩"',
].join('\n'), 'utf8');
const UNSIGNED = path.join(BUILD, 'unsigned.apk');
run(PY, [zipHelper, BASE_APK, DEX, UNSIGNED]);

/* ------------------------------------------------------ 7. zipalign -p 4 */

step(7, 'zipalign -p 4');
const ALIGNED = path.join(BUILD, 'aligned.apk');
run(which('zipalign.exe'), ['-f', '-p', '4', UNSIGNED, ALIGNED]);
const chk = capture(which('zipalign.exe'), ['-c', '-p', '-v', '4', ALIGNED]);
log(`    对齐校验：${chk.ok ? '通过' : '失败'}`);

/* ------------------------------------------------------------- 8. 签名 */

step(8, 'apksigner 签名');
if (!fs.existsSync(KS)) {
  fs.mkdirSync(KS_DIR, { recursive: true });
  log('    生成 keystore（首次）：android/keystore/wordplan.jks');
  run(path.join(JAVA_HOME, 'bin', 'keytool.exe'), [
    '-genkeypair', '-v',
    '-keystore', KS,
    '-alias', KS_ALIAS,
    '-keyalg', 'RSA',
    '-keysize', '2048',
    '-validity', '10000',
    '-storepass', KS_PASS,
    '-keypass', KS_PASS,
    '-dname', 'CN=WordPlan, OU=CET4, O=WordPlan, L=Beijing, ST=Beijing, C=CN',
  ]);
}

const OUT_APK = path.join(DIST, APK_NAME);
const signArgs = [
  'sign',
  '--ks', KS,
  '--ks-key-alias', KS_ALIAS,
  '--ks-pass', 'pass:' + KS_PASS,
  '--key-pass', 'pass:' + KS_PASS,
  '--v1-signing-enabled', 'true',
  '--v2-signing-enabled', 'true',
  '--out', OUT_APK,
  ALIGNED,
];
run(JAVA, ['-Xmx1024M', '-Xss1m', '-jar', APKSIGNER_JAR].concat(signArgs));

const verify = capture(JAVA, ['-Xmx1024M', '-Xss1m', '-jar', APKSIGNER_JAR, 'verify', '--verbose', '--print-certs', OUT_APK]);
log(verify.ok ? '    签名校验：通过' : '    签名校验：失败');
if (/Verified using v2 scheme/.test(verify.out)) log('    v2 签名 ✓');
if (/Verified using v1 scheme/.test(verify.out)) log('    v1 签名 ✓');

/* ------------------------------------------------------------------ 收尾 */

const badging = capture(which('aapt2.exe'), ['dump', 'badging', OUT_APK]);
const pick = (re) => (badging.out.match(re) || [])[1] || '?';
log('');
log('卡片信息：');
log(`    package    ${pick(/package: name='([^']+)'/)}`);
log(`    version    ${pick(/versionCode='([^']+)'/)} / ${pick(/versionName='([^']+)'/)}`);
log(`    minSdk     ${pick(/sdkVersion:'([^']+)'/)}`);
log(`    targetSdk  ${pick(/targetSdkVersion:'([^']+)'/)}`);
log(`    label      ${pick(/application-label:'([^']+)'/)}`);
log('');
log(`✔ ${path.relative(ROOT, OUT_APK)}  ${human(fs.statSync(OUT_APK).size)}`);
