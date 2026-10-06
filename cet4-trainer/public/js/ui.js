/* 词计划 · 通用 UI 工具 -------------------------------------------------- */

export function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 由 HTML 字符串建元素 */
export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

let toastTimer = null;
export function toast(msg, ms = 2000) {
  const box = document.getElementById('toast');
  if (!box) return;
  box.textContent = msg;
  box.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove('show'), ms);
}

const POS_RE = /^((?:n|v|vt|vi|adj|adv|prep|conj|pron|num|int|art|aux|abbr|a|ad)\.)\s*/i;

/** 一个词性行里有多少个义项（按中英文分号、句号切） */
export function countSenses(line) {
  const body = line.replace(POS_RE, '');
  return body.split(/[；;。]/).filter((x) => x.trim()).length;
}

/** 精简释义的默认上限：每个词性最多留几个义项、整行最多多少字 */
export const SENSE_CAP = 3;
export const LINE_CAP = 46;

/**
 * 精简一个词性行：**词性标记一定保留**，只把这一行末尾的义项剪掉一部分。
 *
 * 词书释义经常一个词性甩出十几个义项（stock 的 n. 有 26 条、223 字），
 * 一屏全被占满。这里按「义项」为单位从后往前剪，不会把 mid-word 截断；
 * 只有第一个义项本身就超长时，才退到逗号/顿号处切一刀。
 *
 * @param {string} line       形如 `n. 计划，方案；节目`
 * @param {number} maxSenses  每个词性最多留几个义项
 * @param {number} maxChars   整行最多多少字
 * @param {number} atLeast    前几个义项无论如何都要留（高频义项可能排在后面）
 */
export function trimLine(line, maxSenses = SENSE_CAP, maxChars = LINE_CAP, atLeast = 0) {
  const text = String(line == null ? '' : line);
  const m = POS_RE.exec(text);
  const prefix = m ? m[0] : '';           // 含词性后面那个空格，照原样还回去
  const body = (m ? text.slice(m[0].length) : text).trim();
  const parts = body.split(/[；;]/).map((x) => x.trim()).filter(Boolean);
  if (!parts.length) return text;
  // 本来就短，一个字都别动
  if (parts.length <= 1 && body.length <= maxChars) return text;

  const kept = [];
  let len = 0;
  let cut = false;
  for (const s of parts) {
    if (kept.length >= maxSenses) { cut = true; break; }
    if (kept.length >= atLeast && kept.length && len + 1 + s.length > maxChars) { cut = true; break; }
    kept.push(s);
    len += (kept.length > 1 ? 1 : 0) + s.length;
  }
  // 头一个义项自己就超长 → 退到最近的逗号/顿号处切
  if (kept[0].length > maxChars) {
    const head = kept[0].slice(0, maxChars);
    const at = Math.max(head.lastIndexOf('，'), head.lastIndexOf('、'), head.lastIndexOf(','));
    kept[0] = at > maxChars * 0.5 ? head.slice(0, at) : head;
    cut = true;
  }
  return prefix + kept.join('；') + (cut ? '…' : '');
}

/** 整段释义按行精简 */
export function trimLines(trans, maxSenses = SENSE_CAP, maxChars = LINE_CAP) {
  if (!Array.isArray(trans)) return [];
  return trans.map((line) => trimLine(line, maxSenses, maxChars));
}

/** 取一个词条的简短释义（选项提示、悬停 title 用）：每个词性留 1 条义项，整串再限个字 */
export function shortMeaning(trans, maxSenses = 1, maxChars = 22) {
  const parts = trimLines(trans, maxSenses, maxChars)
    .map((line) => line.replace(POS_RE, '').replace(/…$/, ''))
    .filter(Boolean);
  // 一行不超，几行加起来还是会超，所以再按总字数收一次
  let out = '';
  for (const p of parts) {
    if (!out) { out = p; continue; }
    if (out.length + 1 + p.length > maxChars) break;
    out += '；' + p;
  }
  if (out.length <= maxChars) return out;
  const head = out.slice(0, maxChars);
  const at = Math.max(head.lastIndexOf('；'), head.lastIndexOf('，'), head.lastIndexOf('、'), head.lastIndexOf(','));
  return (at > maxChars * 0.5 ? head.slice(0, at) : head) + '…';
}

/**
 * 释义条目 → HTML（词性斜体高亮）。
 *
 * hf 给的是要标虚线的义项位置：`[[释义行号, 行内义项序号], ...]`。
 * 这个位置由 `tools/build_dict.mjs` 按 Collins COBUILD 语料库的义项频次序算好，
 * 写进词库第 6 列——不是「排在第一个的义项」那种猜法。
 * 基础词汇附录没有这个数据，所以传空数组就不标。
 *
 * @param {string[]} trans   释义行
 * @param {boolean} trim     精简释义：每个词性剪掉末尾多出来的义项（词性保留）
 * @param {[number,number][]} hf 要标高频的义项位置
 */
export function meaningHTML(trans, trim = false, hf = null) {
  const marks = Array.isArray(hf) ? hf : [];
  // 精简时不能把「高频义项」剪掉——按 Collins 语料库排出来的高频义项常常不是第一条
  const list = trim
    ? trans.map((line, lineIdx) => {
        const want = marks.filter((x) => x[0] === lineIdx).map((x) => x[1]);
        const atLeast = want.length ? Math.max.apply(null, want) + 1 : 0;
        return trimLine(line, Math.max(SENSE_CAP, atLeast), LINE_CAP, atLeast);
      })
    : trans;
  return list
    .map((line, lineIdx) => {
      const m = POS_RE.exec(line);
      const pos = m ? `<span class="pos">${esc(m[1])}</span>` : '';
      const body = m ? line.slice(m[0].length) : line;
      const wanted = new Set(marks.filter((x) => x[0] === lineIdx).map((x) => x[1]));
      if (!wanted.size) return `<div>${pos}${esc(body)}</div>`;
      // 保留分隔符：偶数下标是义项正文，奇数下标是「；」
      const parts = body.split(/([；;])/);
      let senseIdx = -1;
      const inner = parts
        .map((p, i) => {
          if (i % 2 === 1) return esc(p);
          senseIdx += 1;
          if (!wanted.has(senseIdx) || !p.trim()) return esc(p);
          return `<span class="hf">${esc(p)}</span>`;
        })
        .join('');
      return `<div>${pos}${inner}</div>`;
    })
    .join('');
}

export function plainTrans(trans, trim = false) {
  const list = trim ? trimLines(trans) : trans;
  return list.join('；');
}

/**
 * 释义 → 适合朗读的纯文本：去掉词性标记，每个词性只保留前 N 个义项。
 * 词书释义经常一个词性十几条（focus 的 n. 就是），全读会又长又吵。
 */
export function speakableTrans(trans, sensesPerPos = 2) {
  const out = [];
  for (const line of trans) {
    const body = line.replace(POS_RE, '');
    const senses = body
      .split(/[；;。]/)
      .map((x) => x.trim().replace(/^[，,、]+/, '').replace(/[，,、]+$/, ''))
      .filter(Boolean)
      .slice(0, sensesPerPos);
    if (senses.length) out.push(senses.join('，'));
  }
  return out.join('。');
}

/**
 * 按设置取「要朗读的释义文本」
 * @param {string[]} trans
 * @param {'off'|'brief'|'full'} mode
 */
export function spokenMeaning(trans, mode) {
  if (mode === 'off') return '';
  if (mode === 'full') return plainTrans(trans, false);
  return speakableTrans(trans);
}

export function fmtTime(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function fmtMinutes(ms) {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} 分钟`;
  return `${Math.floor(mins / 60)} 小时 ${mins % 60} 分`;
}

export function confirmDialog(message) {
  return window.confirm(message);
}

export function download(filename, text, mime = 'application/json') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
