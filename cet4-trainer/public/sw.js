/* 词计划 Service Worker
 *
 * 策略：**网络优先，缓存兜底**。
 *  - 有网时永远拿最新文件（本地开发改完刷新就是新的，不会吃缓存）
 *  - 断网时用缓存运行，装到手机上以后完全离线可用
 *  - 只处理同源 GET；`__seed__` 是测试工具用的探针页，直接放行不插手
 */
const CACHE = 'wordplan-v1';

const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/app.js',
  './js/store.js',
  './js/dict.js',
  './js/speech.js',
  './js/ui.js',
  './js/practice.js',
  './js/stats.js',
  './js/settings.js',
  './data/dicts.json',
  './dict/week1.json',
  './dict/week2.json',
  './dict/week3.json',
  './dict/week4.json',
  './dict/week5.json',
  './dict/week6.json',
  './dict/week7.json',
  './dict/cognitive.json',
  './dict/basic.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // 单个资源失败不能让整个安装挂掉
    await Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('__seed__')) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req);
      if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    } catch (err) {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') {
        const shell = await cache.match('./index.html');
        if (shell) return shell;
      }
      throw err;
    }
  })());
});
