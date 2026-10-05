/* 词计划 · 设置页 -------------------------------------------------------- */

import * as store from './store.js';
import { speak, speakWordAndMeaning, voiceList, chineseVoiceList, speechSupported, isAndroidTts, onVoicesReady, diagnose } from './speech.js';
import { toast, download, confirmDialog, spokenMeaning } from './ui.js';
import { loadDeck } from './dict.js';

let stageEl = null;

/** 试听当前设置：读一遍「focus + 释义」 */
async function previewSpeech() {
  const s = store.state.settings;
  let entry = { w: 'focus', trans: ['n. 重点，中心点；关注，注意；焦距', 'v. 集中，关注；聚焦，调焦'] };
  try {
    const deck = await loadDeck('week1');
    const found = deck.words.find((x) => x.w === 'focus');
    if (found) entry = found;
  } catch { /* 词库没拿到就用内置样例 */ }
  speakWordAndMeaning(entry.w, spokenMeaning(entry.trans, s.speakMeaning), { accent: s.accent, rate: s.rate });
}

export function unmount() {
  stageEl = null;
}

export async function mount(stage) {
  stageEl = stage;
  render();
  // 语音列表可能这一刻还没加载好，等它到位再把「检测到 N 个语音」刷新出来
  onVoicesReady(() => { if (stageEl) render(); });
}

function render() {
  const s = store.state.settings;
  const voices = speechSupported() ? voiceList() : [];
  const zhVoices = speechSupported() ? chineseVoiceList() : [];
  const o = store.overallStats();

  stageEl.innerHTML = `
    <div class="view">
      <div class="page-head">
        <h1>设置</h1>
        <p>所有偏好与学习进度都只保存在这台设备的浏览器里，不会上传</p>
      </div>

      <div class="panel">
        <h3>外观</h3>
        <div class="field">
          <div class="label">主题<small>深色模式更适合晚上刷词</small></div>
          <div class="control">
            <div class="chip-list">
              <button class="chip ${s.themeAuto === false ? '' : 'active'}" data-theme="auto">跟随系统</button>
              <button class="chip ${s.themeAuto === false && s.theme === 'light' ? 'active' : ''}" data-theme="light">浅色</button>
              <button class="chip ${s.themeAuto === false && s.theme === 'dark' ? 'active' : ''}" data-theme="dark">深色</button>
            </div>
          </div>
        </div>
      </div>

      <div class="panel">
        <h3>发音 <span class="sub">${isAndroidTts()
          ? '使用系统语音合成（在手机的「设置 → 语言和输入法 → 文字转语音」里换音色）'
          : speechSupported()
            ? `检测到 ${voices.length} 个英语语音${zhVoices.length ? ` · ${zhVoices.length} 个中文语音` : '（没有中文语音，释义将无法朗读）'}`
            : '当前浏览器不支持语音合成'}</span></h3>
        <div class="field">
          <div class="label">口音<small>美音 / 英音</small></div>
          <div class="control">
            <div class="chip-list">
              <button class="chip ${s.accent === 'us' ? 'active' : ''}" data-accent="us">美音 US</button>
              <button class="chip ${s.accent === 'uk' ? 'active' : ''}" data-accent="uk">英音 UK</button>
            </div>
            <button class="btn" data-act="test-speak">试听 focus</button>
          </div>
        </div>
        <div class="field">
          <div class="label">语速<small>当前 ${s.rate.toFixed(2)}×</small></div>
          <div class="control">
            <input type="range" min="0.5" max="1.3" step="0.05" value="${s.rate}" data-rate />
            <span style="color:var(--text-faint);font-size:12.5px">慢 ← → 快</span>
          </div>
        </div>
        <div class="field">
          <div class="label">自动朗读<small>进入新词、以及每次作答后都读一遍单词</small></div>
          <div class="control">
            <label class="switch"><input type="checkbox" ${s.autoSpeak ? 'checked' : ''} data-toggle="autoSpeak" /><span class="slider"></span></label>
          </div>
        </div>
        <div class="field">
          <div class="label">朗读释义<small>读完单词后接着读中文释义；过长会自动精简</small></div>
          <div class="control">
            <div class="chip-list">
              <button class="chip ${s.speakMeaning === 'off' ? 'active' : ''}" data-speak-meaning="off">只读单词</button>
              <button class="chip ${s.speakMeaning === 'brief' ? 'active' : ''}" data-speak-meaning="brief">简要释义</button>
              <button class="chip ${s.speakMeaning === 'full' ? 'active' : ''}" data-speak-meaning="full">完整释义</button>
            </div>
            <button class="btn" data-act="test-speak-meaning">试听「focus」</button>
          </div>
        </div>
        <div class="field">
          <div class="label">发音自检<small>没声音时点这个：它会真念一句，并把「走的哪条路、系统里有哪些嗓子、成没成」写在下边</small></div>
          <div class="control">
            <button class="btn" data-act="speak-diag">测试发音</button>
          </div>
        </div>
        <pre class="diag" id="speakDiag" hidden></pre>
      </div>

      <div class="panel">
        <h3>练习</h3>
        <div class="field">
          <div class="label">答对后自动下一词<small>只对答对的词生效；答错的词一定停下来等你看完正确答案</small></div>
          <div class="control">
            <label class="switch"><input type="checkbox" ${s.autoNext ? 'checked' : ''} data-toggle="autoNext" /><span class="slider"></span></label>
          </div>
        </div>
        <div class="field">
          <div class="label">高频释义虚线<small>给最常用的那条释义划虚线，像书上那样</small></div>
          <div class="control">
            <label class="switch"><input type="checkbox" ${s.hfMark !== false ? 'checked' : ''} data-toggle="hfMark" /><span class="slider"></span></label>
          </div>
        </div>
        <div class="field">
          <div class="label">简明释义<small>每个词性只保留前两条义项，卡片更清爽</small></div>
          <div class="control">
            <label class="switch"><input type="checkbox" ${s.trimTrans ? 'checked' : ''} data-toggle="trimTrans" /><span class="slider"></span></label>
          </div>
        </div>
      </div>

      <div class="panel">
        <h3>数据</h3>
        <div class="field">
          <div class="label">进度备份<small>已记录 ${o.seenWords} 个词 · ${o.answers} 次作答</small></div>
          <div class="control">
            <button class="btn" data-act="export">导出 JSON</button>
            <button class="btn" data-act="import">导入 JSON</button>
            <input type="file" accept="application/json,.json" id="importFile" hidden />
            <button class="btn ghost" data-act="reset-all" style="color:var(--danger)">清空全部进度</button>
          </div>
        </div>
      </div>

      <div class="panel">
        <h3>关于</h3>
        <p style="margin:0 0 10px;color:var(--text-muted);font-size:13.5px;line-height:1.9">
          词库来自星火《四级词汇周计划》（ISBN 978-7-231-02372-5）官方配套资源：单词与顺序取自官方听力资源包中的
          <code>.lrc</code> 时间轴，与纸质书逐词一致；中文释义与音标取自在线词典接口。
          附录「认知词汇」427 词、「基础词汇」1523 词同样收录。
        </p>
        <p style="margin:0;color:var(--text-faint);font-size:12.5px">
          共 ${store.state.progress ? Object.keys(store.state.progress).length : 0} 个词有学习记录 · 本页为纯前端离线应用
        </p>
      </div>
    </div>`;

  bind();
}

function bind() {
  stageEl.querySelectorAll('[data-theme]').forEach((b) =>
    b.addEventListener('click', () => {
      const picked = b.dataset.theme;
      if (picked === 'auto') {
        store.setSetting('themeAuto', true);
      } else {
        store.setSetting('themeAuto', false);
        store.setSetting('theme', picked);
      }
      // 具体切哪套主题由 app 层按「跟随系统 / 用户选择」统一裁决
      document.dispatchEvent(new CustomEvent('wordplan:theme'));
      render();
    }));
  stageEl.querySelectorAll('[data-accent]').forEach((b) =>
    b.addEventListener('click', () => {
      store.setSetting('accent', b.dataset.accent);
      speak('focus', { accent: b.dataset.accent, rate: store.state.settings.rate });
      render();
    }));
  stageEl.querySelectorAll('[data-toggle]').forEach((el) =>
    el.addEventListener('change', () => {
      store.setSetting(el.dataset.toggle, el.checked);
      if (el.dataset.toggle === 'autoSpeak') speak('focus', { accent: store.state.settings.accent, rate: store.state.settings.rate });
    }));
  const rate = stageEl.querySelector('[data-rate]');
  if (rate) {
    rate.addEventListener('input', () => {
      const label = rate.closest('.field').querySelector('.label small');
      label.textContent = `当前 ${Number(rate.value).toFixed(2)}×`;
    });
    rate.addEventListener('change', () => {
      store.setSetting('rate', Number(rate.value));
      speak('focus', { accent: store.state.settings.accent, rate: Number(rate.value) });
    });
  }

  stageEl.querySelectorAll('[data-speak-meaning]').forEach((b) =>
    b.addEventListener('click', () => {
      store.setSetting('speakMeaning', b.dataset.speakMeaning);
      previewSpeech();
      render();
    }));

  const test = stageEl.querySelector('[data-act="test-speak"]');
  if (test) test.addEventListener('click', () => speak('focus', { accent: store.state.settings.accent, rate: store.state.settings.rate }));

  const testMeaning = stageEl.querySelector('[data-act="test-speak-meaning"]');
  if (testMeaning) testMeaning.addEventListener('click', previewSpeech);

  // 发音自检：真念一句，并把完整结论摊在下面
  const diagBtn = stageEl.querySelector('[data-act="speak-diag"]');
  const diagBox = stageEl.querySelector('#speakDiag');
  if (diagBtn && diagBox) {
    diagBtn.addEventListener('click', async () => {
      diagBox.hidden = false;
      diagBox.textContent = '正在自检…';
      diagBtn.disabled = true;
      try {
        diagBox.textContent = await diagnose();
      } catch (err) {
        diagBox.textContent = '自检本身出错了：' + (err && err.message ? err.message : err);
      } finally {
        diagBtn.disabled = false;
      }
    });
  }

  const ex = stageEl.querySelector('[data-act="export"]');
  if (ex) ex.addEventListener('click', () => {
    const stamp = new Date().toISOString().slice(0, 10);
    download(`wordplan-progress-${stamp}.json`, store.exportJSON());
    toast('已导出进度备份');
  });

  const im = stageEl.querySelector('[data-act="import"]');
  const file = stageEl.querySelector('#importFile');
  if (im && file) {
    im.addEventListener('click', () => file.click());
    file.addEventListener('change', async () => {
      const f = file.files && file.files[0];
      if (!f) return;
      try {
        store.importJSON(await f.text());
        toast('进度已导入');
        render();
      } catch (err) {
        toast(`导入失败：${err.message}`, 3200);
      } finally {
        file.value = '';
      }
    });
  }

  const ra = stageEl.querySelector('[data-act="reset-all"]');
  if (ra) ra.addEventListener('click', () => {
    if (!confirmDialog('确定清空全部学习进度吗？此操作不可撤销。建议先导出备份。')) return;
    store.resetAll();
    toast('已清空全部进度');
    render();
  });
}
