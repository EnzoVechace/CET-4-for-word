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

/**
 * 释义条目 → HTML（词性斜体高亮）。
 *
 * hf 给的是要标虚线的义项位置：`[[释义行号, 行内义项序号], ...]`。
 * 这个位置由 `tools/build_dict.mjs` 按 Collins COBUILD 语料库的义项频次序算好，
 * 写进词库第 6 列——不是「排在第一个的义项」那种猜法。
 * 基础词汇附录没有这个数据，所以传空数组就不标。
 *
 * @param {string[]} trans   释义行
 * @param {boolean} trim     每个词性只留前两条
 * @param {[number,number][]} hf 要标高频的义项位置
 */
export function meaningHTML(trans, trim = false, hf = null) {
  const marks = Array.isArray(hf) ? hf : [];
  const list = trim ? trans.slice(0, 2) : trans;
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
  const list = trim ? trans.slice(0, 2) : trans;
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
