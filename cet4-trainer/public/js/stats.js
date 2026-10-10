/* 词计划 · 统计页 -------------------------------------------------------- */

import * as store from './store.js';
import { loadIndex, loadDeck } from './dict.js';
import { esc, fmtMinutes, plainTrans, confirmDialog, toast } from './ui.js';

let stageEl = null;

export function unmount() {
  stageEl = null;
}

export async function mount(stage) {
  stageEl = stage;
  stage.innerHTML = `<div class="view"><div class="empty"><div class="big">⏳</div>正在统计…</div></div>`;

  const idx = await loadIndex();
  const leaves = (idx.dicts || []).filter((d) => !d.compose);
  const loaded = [];
  let full = null;

  for (const meta of leaves) {
    try {
      const deck = await loadDeck(meta.id);
      loaded.push({ meta, deck });
      if (meta.id === 'cognitive') { /* noop */ }
    } catch { /* 跳过加载失败的词库 */ }
  }
  try { full = await loadDeck('full'); } catch { /* ignore */ }
  if (stageEl !== stage) return;

  const overallWords = full ? full.words : loaded.flatMap((x) => x.deck.words);
  const o = store.overallStats();
  const rate = Math.round(o.accuracy * 1000) / 10;
  const streak = store.streak();
  const today = store.today();
  const total = overallWords.length;
  const st = store.deckStats(overallWords.map((w) => w.w));

  const decks = [
    { name: '全书', words: overallWords },
    ...loaded
      .filter((x) => x.meta.id !== 'basic')
      .map((x) => ({ name: x.meta.name, words: x.deck.words })),
    ...loaded.filter((x) => x.meta.id === 'basic').map((x) => ({ name: '基础词汇（附录）', words: x.deck.words })),
  ];

  const wrongs = store.topWrongWords(40);
  const starred = store.starredWords();
  const lookup = new Map();
  for (const w of overallWords) lookup.set(w.w, w);
  for (const x of loaded) for (const w of x.deck.words) if (!lookup.has(w.w)) lookup.set(w.w, w);

  stageEl.innerHTML = `
    <div class="view">
      <div class="page-head">
        <h1>学习统计</h1>
        <p>数据保存在本机浏览器里 · 共 ${total} 个词条在练</p>
      </div>

      <div class="kpi-grid">
        <div class="kpi ok"><div class="k">已掌握</div><div class="v">${st.mastered}</div><div class="s">熟练度 ≥ ${store.MASTERED_LVL} 级</div></div>
        <div class="kpi accent"><div class="k">学习中</div><div class="v">${st.learning}</div><div class="s">已开始但未巩固</div></div>
        <div class="kpi"><div class="k">总正确率</div><div class="v">${o.answers ? `${rate}%` : '—'}</div><div class="s">${o.oks} / ${o.answers} 次作答</div></div>
        <div class="kpi"><div class="k">连续打卡</div><div class="v">${streak}</div><div class="s">累计 ${o.dayCount} 天 · ${fmtMinutes(store.state.totals.ms || 0)}</div></div>
      </div>

      <div class="panel">
        <h3>今日 <span class="sub">${new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })}</span></h3>
        <div class="kpi-grid" style="margin:0">
          <div class="kpi"><div class="k">新学</div><div class="v">${today.learned}</div><div class="s">首次作答</div></div>
          <div class="kpi"><div class="k">复习</div><div class="v">${today.reviewed}</div><div class="s">重复作答</div></div>
          <div class="kpi accent"><div class="k">今日正确率</div><div class="v">${today.correct + today.wrong ? `${Math.round((today.correct / (today.correct + today.wrong)) * 100)}%` : '—'}</div><div class="s">${today.correct} 对 / ${today.wrong} 错</div></div>
          <div class="kpi"><div class="k">待复习</div><div class="v">${o.due}</div><div class="s">按遗忘曲线到期</div></div>
        </div>
      </div>

      <div class="panel">
        <h3>学习日历 <span class="sub">最近 17 周</span></h3>
        <div class="heat">${store.heatmap(119).map((d) => `<div class="heat-day" data-l="${d.lvl}" title="${d.key}：${d.n} 词"></div>`).join('')}</div>
        <div class="heat-legend"><span>少</span>${[0, 1, 2, 3, 4].map((l) => `<div class="heat-day" data-l="${l}"></div>`).join('')}<span>多</span><span style="margin-left:auto;opacity:.8">每格 = 一天，颜色越深当天练得越多</span></div>
      </div>

      <div class="panel">
        <h3>各词库进度</h3>
        <div class="bar-list">
          ${decks.map((d) => barHTML(d.name, store.deckStats(d.words.map((w) => w.w)))).join('')}
        </div>
      </div>

      <div class="panel">
        <h3>错词本 <span class="sub">${wrongs.length ? `按错误次数排序，共 ${wrongs.length} 个` : ''}</span></h3>
        ${wrongs.length
          ? `<table class="wrong-table">
              <thead><tr><th>单词</th><th>释义</th><th style="text-align:right">错 / 总</th><th style="text-align:right">熟练度</th></tr></thead>
              <tbody>${wrongs
                .map((p) => {
                  const w = lookup.get(p.word);
                  return `<tr>
                    <td class="w">${esc(p.word)}</td>
                    <td style="color:var(--text-muted)">${w ? esc(w.trans[0]).slice(0, 46) : '<span class="mini">（不在当前词库中）</span>'}</td>
                    <td class="n" style="text-align:right">${p.bad} / ${p.n}</td>
                    <td style="text-align:right;color:var(--text-faint)">${p.lvl}</td>
                  </tr>`;
                })
                .join('')}</tbody>
            </table>`
          : '<div class="empty"><div class="big">🌱</div>还没有错词，继续加油</div>'}
      </div>

      <div class="panel">
        <h3>收藏的词 <span class="sub">${starred.length ? `共 ${starred.length} 个 · 最近收的排前面` : ''}</span></h3>
        ${starred.length
          ? `<table class="wrong-table">
              <thead><tr><th>单词</th><th>释义</th><th style="text-align:right">熟练度</th><th></th></tr></thead>
              <tbody>${starred
                .map((word) => {
                  const w = lookup.get(word);
                  const p = store.prog(word);
                  return `<tr>
                    <td class="w">${esc(word)}</td>
                    <td style="color:var(--text-muted)">${w ? esc(plainTrans(w.trans)).slice(0, 46) : '<span class="mini">（不在当前词库中）</span>'}</td>
                    <td style="text-align:right;color:var(--text-faint)">${p ? p.lvl : '—'}</td>
                    <td style="text-align:right"><button class="chip" data-unstar="${esc(word)}" title="把「${esc(word)}」移出收藏">☆ 取消</button></td>
                  </tr>`;
                })
                .join('')}</tbody>
            </table>
            <div style="margin-top:12px"><button class="btn ghost" data-act="unstar-all">清空收藏</button></div>`
          : '<div class="empty"><div class="big">☆</div>还没有收藏的词。练习时点卡片右上角的 ☆ 就能把词收进来</div>'}
      </div>
    </div>`;

  stageEl.querySelectorAll('[data-unstar]').forEach((b) => {
    b.addEventListener('click', () => {
      const word = b.dataset.unstar;
      store.toggleStar(word);
      toast(`已把「${word}」移出收藏`, 2200);
      if (stageEl === stage) mount(stage);
    });
  });

  const unstarAll = stageEl.querySelector('[data-act="unstar-all"]');
  if (unstarAll) unstarAll.addEventListener('click', () => {
    if (!confirmDialog(`确定清空这 ${starred.length} 个收藏吗？此操作不可撤销。`)) return;
    store.clearStars();
    toast('已清空收藏', 2200);
    if (stageEl === stage) mount(stage);
  });
}

function barHTML(name, s) {
  const pctM = s.total ? (s.mastered / s.total) * 100 : 0;
  const pctL = s.total ? (s.learning / s.total) * 100 : 0;
  return `<div class="bar-item">
    <div class="name">${esc(name)}</div>
    <div class="track"><i class="mastered" style="width:${pctM}%"></i><i class="learning" style="width:${pctL}%"></i></div>
    <div class="nums">${s.mastered} / ${s.total}</div>
  </div>`;
}
