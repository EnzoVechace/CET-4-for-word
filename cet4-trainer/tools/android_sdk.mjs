#!/usr/bin/env node
/*
 * android_sdk.mjs —— 把编译 APK 所需的 Android SDK 部件下载到工作目录里。
 *
 * 只下载真正需要的三件，不装 cmdline-tools（143 MB，而且新版 sdkmanager 要 JDK 17）：
 *   platform-tools-latest-windows.zip   adb / fastboot
 *   build-tools_r34-windows.zip         aapt2 / d8 / zipalign / apksigner
 *   platform-34-ext7_r03.zip            android.jar（编译时的 bootclasspath）
 *
 * 用法：
 *   node tools/android_sdk.mjs           安装（已装好的会跳过）
 *   node tools/android_sdk.mjs --check   只看装了什么
 *   node tools/android_sdk.mjs --force   忽略已存在的目录，重新下载解压
 *
 * 全部内容都落在 <工作目录>\android-sdk 下，卸载请运行 tools\uninstall_android_sdk.cmd。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..');
const WORKSPACE = path.resolve(PROJECT, '..');

export const SDK_ROOT = process.env.ANDROID_SDK_ROOT || path.join(WORKSPACE, 'android-sdk');
const DL_DIR = path.join(SDK_ROOT, '_downloads');
const META = path.join(SDK_ROOT, 'sdk-info.json');
const TAR = 'C:\\WINDOWS\\system32\\tar.exe';
const REPO = 'https://dl.google.com/android/repository/';

/** 每个部件：下载文件 → 解压后它内部的顶层目录名 → 要落到 SDK 里的相对路径
 *  url 可以是数组，按顺序回退（国内优先走清华镜像）。
 *  top 为 null 时自动取解压目录里唯一的顶层文件夹。
 *  size 为 0 表示不校验大小。
 */
const COMPONENTS = [
  {
    id: 'platform-tools',
    zip: 'platform-tools-latest-windows.zip',
    urls: [REPO + 'platform-tools-latest-windows.zip'],
    size: 8044989,
    top: 'platform-tools',
    dest: 'platform-tools',
    note: 'adb / fastboot（装到手机上要用）',
  },
  {
    id: 'build-tools',
    zip: 'build-tools_r34-windows.zip',
    urls: [REPO + 'build-tools_r34-windows.zip'],
    size: 58253258,
    top: 'android-14', // 这版 zip 内部顶层目录叫 android-14，落到 build-tools/34.0.0
    dest: path.join('build-tools', '34.0.0'),
    note: 'aapt2 / d8 / zipalign / apksigner',
  },
  {
    id: 'platform',
    zip: 'platform-34-ext7_r03.zip',
    urls: [REPO + 'platform-34-ext7_r03.zip'],
    size: 63180081,
    top: 'android-34',
    dest: path.join('platforms', 'android-34'),
    note: 'android.jar + res（编译用的框架）',
  },
  {
    // d8 是用 class file 55.0 编的，本机只有 JDK 8，跑不起来 —— 所以自带一份 JDK 17
    id: 'jdk17',
    zip: 'OpenJDK17U-jdk_x64_windows_hotspot_17.0.20.1_1.zip',
    urls: [
      'https://mirrors.tuna.tsinghua.edu.cn/Adoptium/17/jdk/x64/windows/OpenJDK17U-jdk_x64_windows_hotspot_17.0.20.1_1.zip',
      'https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse',
    ],
    size: 0,
    top: null,
    dest: 'jdk17',
    note: 'JDK 17（d8 / apksigner 要用，本机只有 JDK 8）',
  },
];

/* ---------------------------------------------------------------- 小工具 */

function human(n) {
  if (!Number.isFinite(n)) return '?';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

function log(msg) {
  process.stdout.write(`${msg}\n`);
}

function run(cmd, args, opts) {
  const r = spawnSync(cmd, args, Object.assign({ stdio: 'inherit' }, opts || {}));
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${path.basename(cmd)} 退出码 ${r.status}`);
  return r;
}

function exists(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}

async function download(urls, out, expectedSize) {
  if (exists(out) && (!expectedSize || fs.statSync(out).size === expectedSize)) {
    log(`    已下载过，跳过（${human(fs.statSync(out).size)}）`);
    return out;
  }
  const tmp = out + '.part';
  fs.rmSync(tmp, { force: true });

  let lastErr = null;
  for (const url of urls) {
    try {
      // 直连：dl.google.com / github 走本机代理会 TLS 断连
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const total = expectedSize || Number(res.headers.get('content-length')) || 0;
      const fd = fs.openSync(tmp, 'w');
      let got = 0;
      let last = 0;
      const started = Date.now();
      try {
        for await (const chunk of res.body) {
          fs.writeSync(fd, chunk);
          got += chunk.length;
          const now = Date.now();
          if (now - last > 1000) {
            last = now;
            const pct = total ? ((got / total) * 100).toFixed(1) + '%' : '';
            const speed = (got / 1048576) / ((now - started) / 1000);
            process.stdout.write(`\r    ${human(got)}${total ? ' / ' + human(total) : ''}  ${pct}  ${speed.toFixed(1)} MB/s   `);
          }
        }
      } finally {
        fs.closeSync(fd);
      }
      process.stdout.write('\n');
      // 只按事先探到的真实大小校验：dl.google.com 的 content-length 有时和实体大小对不上
      if (expectedSize && got !== expectedSize) throw new Error(`大小不符：期望 ${expectedSize}，实得 ${got}`);
      fs.renameSync(tmp, out);
      log(`    下载完成 ${human(got)}`);
      return out;
    } catch (e) {
      lastErr = e;
      fs.rmSync(tmp, { force: true });
      process.stdout.write('\n');
      log(`    这个源不行（${e.message}），换下一个…`);
    }
  }
  throw lastErr || new Error('没有可用的下载地址');
}

function extract(zipPath, topDir, destAbs, force) {
  if (exists(destAbs) && fs.readdirSync(destAbs).length && !force) {
    log('    已解压，跳过');
    return;
  }
  const stage = path.join(DL_DIR, 'stage-' + path.basename(zipPath, '.zip'));
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });
  log('    解压中…');
  run(TAR, ['-xf', zipPath, '-C', stage]);

  let src;
  if (topDir) {
    src = path.join(stage, topDir);
    if (!exists(src)) src = stage;
  } else {
    // 自动认领唯一的顶层目录（JDK 的 zip 里是 jdk-17.0.20.1+1/）
    const entries = fs.readdirSync(stage);
    src = entries.length === 1 && fs.statSync(path.join(stage, entries[0])).isDirectory()
      ? path.join(stage, entries[0])
      : stage;
  }
  fs.rmSync(destAbs, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(destAbs), { recursive: true });
  fs.renameSync(src, destAbs);
  fs.rmSync(stage, { recursive: true, force: true });
  log(`    解压到 ${path.relative(SDK_ROOT, destAbs)}`);
}

/* ---------------------------------------------------------------- 主流程 */

function readMeta() {
  try { return JSON.parse(fs.readFileSync(META, 'utf8')); } catch { return null; }
}

function check() {
  const meta = readMeta();
  log(`Android SDK 目录：${SDK_ROOT}`);
  if (!exists(SDK_ROOT)) { log('  （还不存在，运行 node tools/android_sdk.mjs 安装）'); return false; }
  let all = true;
  for (const c of COMPONENTS) {
    const abs = path.join(SDK_ROOT, c.dest);
    const n = exists(abs) ? fs.readdirSync(abs).length : 0;
    const ok = n > 0;
    if (!ok) all = false;
    log(`  ${ok ? 'OK  ' : '缺失'} ${c.dest.padEnd(24)} ${String(n).padStart(4)} 项   ${c.note}`);
  }
  const jar = path.join(SDK_ROOT, 'platforms', 'android-34', 'android.jar');
  log(`  ${exists(jar) ? 'OK  ' : '缺失'} platforms/android-34/android.jar`);
  const javac17 = path.join(SDK_ROOT, 'jdk17', 'bin', 'javac.exe');
  log(`  ${exists(javac17) ? 'OK  ' : '缺失'} jdk17/bin/javac.exe（d8 要用 Java 11+）`);
  if (meta) log(`  安装于 ${meta.installedAt}，共 ${human(meta.bytes)}`);
  return all && exists(jar) && exists(javac17);
}

async function install(force) {
  fs.mkdirSync(DL_DIR, { recursive: true });
  let bytes = 0;
  log(`Android SDK 将安装到：${SDK_ROOT}`);
  log('（只装 3 个部件，不装 cmdline-tools / emulator / NDK / Gradle）\n');

  for (const c of COMPONENTS) {
    log(`==> ${c.dest}  —— ${c.note}`);
    const zipPath = path.join(DL_DIR, c.zip);
    if (force) fs.rmSync(zipPath, { force: true });
    await download(c.urls, zipPath, c.size);
    bytes += fs.statSync(zipPath).size;
    extract(zipPath, c.top, path.join(SDK_ROOT, c.dest), force);
    log('');
  }

  // 记一份清单，卸载脚本照着删
  const meta = {
    installedAt: new Date().toISOString(),
    sdkRoot: SDK_ROOT,
    bytes,
    components: COMPONENTS.map((c) => ({ id: c.id, zip: c.zip, size: c.size, dest: c.dest })),
    alsoRemove: [path.join(process.env.USERPROFILE || '', '.android')],
  };
  fs.writeFileSync(META, JSON.stringify(meta, null, 2), 'utf8');

  fs.writeFileSync(
    path.join(SDK_ROOT, '卸载说明.txt'),
    [
      '这些是为了把「词计划」打包成 Android APK 才下载的构建工具，程序本身不需要它们。',
      '不再需要时，运行项目里的：',
      '',
      '    cet4-trainer\\tools\\uninstall_android_sdk.cmd',
      '',
      '它会把整个 android-sdk 目录（连同这里所有下载缓存）删掉。',
      '另外会提示删除 %USERPROFILE%\\.android（debug 签名证书的存放处）。',
      '',
    ].join('\r\n'),
    'utf8',
  );

  log('--- 检查 ---');
  const ok = check();
  log('');
  log(ok ? '全部就绪。' : '有部件缺失，请重新运行。');
  return ok;
}

const argv = process.argv.slice(2);
if (argv.includes('--check')) {
  process.exit(check() ? 0 : 1);
} else {
  install(argv.includes('--force'))
    .then((ok) => process.exit(ok ? 0 : 1))
    .catch((e) => { console.error('\n失败：' + e.message); process.exit(1); });
}
