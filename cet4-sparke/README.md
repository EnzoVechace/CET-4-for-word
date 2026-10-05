# 星火《四级词汇周计划》词表导出

对应书目：**《四级词汇周计划》**（山东星火国际传媒集团，ISBN 978-7-231-02372-5，星火图书代码 `DCZB231`）

产出：**与书上单词、顺序完全一致的电子词表**，并转成多种可直接导入背单词软件的格式（Qwerty Learner / Anki / 通用 CSV）。

---

## 一、词表是怎么来的（重要，请先看）

书本身**没有官方电子词表**，所以分两步取：

### 1. 单词与顺序 —— 取自星火官方配套资源包里的逐词歌词文件

- 星火官网本书配套资源页（`http://down.sparke.cn/books/1648c8bc6a9d4095a5e0aa80f7e05e8f`）提供的是整包资源。
- **你手上这版（DCZB231）的资源包只有 MP3，没有词表。**
  同书的另一版资源包（`DCZB251`）里除了同名 MP3，还带了 **`.lrc` 逐词歌词文件**——每个单词一行、带时间戳，**顺序就是朗读顺序，也就是书上顺序**。
- 已做同一性验证：两包 Week 1/2/4/5/6/7 以及全部认知词汇的 MP3，**MD5 逐字节相同**（仅 `Week 3.mp3` 音频不同，但词表一致）。
  → 因此 DCZB251 的 LRC 词序 = 你这本书的词序。
- LRC 原文件是 GBK 编码，已转成 UTF-8 后解析，**保留书本原写法**（`program(me)`、`behavio(u)r`、`realize,-ise`、`calf①`、`according to` 等）。

### 2. 中文释义与音标 —— 取自有道词典

书上的释义（那种「①…②…」的应试简释）**没有任何数字化来源**，只能另取：
`https://dict.youdao.com/jsonapi?q=<单词>`，逐词抓取 2177 条，全部成功，无缺失。

> 所以请明确一点：**单词和顺序 = 书上原样；释义 = 有道词典**（偏《新牛津》风格，义项比书上全，但比书上啰嗦）。
> 唯一例外是附录「基础词汇」，它的释义是从官方 PDF 里抽出来的，**是书上的原释义**。

---

## 二、词表结构（共 2177 词）

| 分组 | 词数 |
| --- | --- |
| Week 1 – Week 7（核心词汇） | 各 250，共 **1750** |
| 认知词汇 A–C | 114 |
| 认知词汇 D–H | 92 |
| 认知词汇 I–Q | 120 |
| 认知词汇 R–Z | 101 |
| **合计** | **2177** |

另有附录「基础词汇」**1523 词**，与上面 2177 词**零重合**，可单独导入。

---

## 三、文件说明

全部在 `output/` 目录下。

### 主推（Qwerty Learner 格式）

| 文件 | 内容 |
| --- | --- |
| `cet4_zhoujihua_full.json` | **全书 2177 词**，完整释义（主推） |
| `cet4_zhoujihua_full_brief.json` | 全书 2177 词，简明释义（每个词性只留前 2 个义项） |
| `cet4_zhoujihua_week1.json` … `week7.json` | 按周拆分，每周 250 词 |
| `cet4_zhoujihua_cognitive.json` | 认知词汇 427 词 |
| `cet4_zhoujihua_basic.json` | 附录「基础词汇」1523 词（释义为**书上原释义**） |

Qwerty Learner 的格式就是：

```json
[
  { "name": "focus", "trans": ["n. 重点，中心点；关注，注意"], "usphone": "ˈfoʊkəs", "ukphone": "ˈfəʊkəs" }
]
```

### 通用格式

| 文件 | 内容 |
| --- | --- |
| `cet4_zhoujihua.csv` | UTF-8 带 BOM，Excel 可直接打开。列：序号 / 分组 / 组内序号 / 单词 / 简要释义 / 完整释义 / 美音 / 英音 / 音轨时间 |
| `cet4_zhoujihua_anki.txt` | Anki 导入用 TSV（前三行是 `#separator:tab` 等导入指令） |
| `cet4_zhoujihua_wordlist.txt` | 纯单词表，按组带 `# 组名` 和 `001. word` 编号 |
| `cet4_zhoujihua_basic.csv` | 基础词汇附录，含书上原释义与书上原音标 |
| `cet4_zhoujihua_basic_anki.txt` | 基础词汇附录 Anki TSV |

---

## 四、怎么导入

### 1. Qwerty Learner（qwertylearner.cn）

**官网线上版没有「上传自定义词典」入口**，自定义词库需要自己部署一份：

```bash
git clone https://github.com/RealKai42/qwerty-learner.git
cd qwerty-learner
pnpm i
```

把 json 放进 `public/dicts/`，然后在 `src/resources/dictionary.ts` 的 `chinaExam` 数组里加一项：

```ts
{
  id: 'cet4-zhoujihua',
  name: '四级词汇周计划',
  description: '星火《四级词汇周计划》原书词序',
  category: '英语考试',
  tags: ['CET-4', '四级', '星火'],
  url: '/dicts/cet4_zhoujihua_full.json',
  length: 2177,
  language: 'en',
  languageCategory: 'en',
},
```

然后 `pnpm dev`（或 `pnpm build`）即可在词库列表里看到「四级词汇周计划」。

### 2. Anki

「文件 → 导入」→ 选 `cet4_zhoujihua_anki.txt`，字段分隔符选 **Tab**，勾选「允许在字段中使用 HTML」取消即可。

### 3. Excel / 通用

直接打开 `cet4_zhoujihua.csv`（已带 BOM，不会乱码）。多数背单词 App（欧路词典、不背单词、墨墨等）支持「自定义词库」，一般接受**每行一个单词**的纯文本，用 `cet4_zhoujihua_wordlist.txt` 即可（导入前删掉 `#` 开头的分组行和行首编号）。

---

## 五、自己复现

```bash
# 0) 依赖：只需 Node（本机路径见 tools/ 中的硬编码 DIR）
cd cet4-sparke

# 1) 抓星火资源包（已在 sparke_pack/ 内）
node tools/fetch.mjs "http://spark-resource.sparke.cn/o_1ivk1996gb3516l319g8qvjt751c.rar?attname=x.rar" sparke_pack/pack2.rar

# 2) 解包（Windows 自带 bsdtar 即可读 rar）
tar -xf sparke_pack/pack2.rar -C sparke_pack/ex2

# 3) GBK -> UTF-8（PowerShell）
#    [Text.Encoding]::GetEncoding(936).GetString([IO.File]::ReadAllBytes($src))

# 4) LRC -> 词表（书本原序）
node tools/lrc2list.mjs sparke_pack/lrc_utf8 sparke_pack/book_words.json

# 5) 附录 PDF -> 基础词汇
node tools/pdfdump.mjs          # 生成 sparke_pack/jichu.txt
node tools/pdf2basic.mjs        # 生成 sparke_pack/basic_words.json

# 6) 抓释义
node tools/youdao_fetch.mjs                                          # -> dict/defs.json
BOOK=sparke_pack/basic_words.json CACHE=dict/defs_basic.json QMAP=dict/query_map_basic.json node tools/youdao_fetch.mjs

# 7) 生成全部输出
node tools/build_book.mjs
```

---

## 六、目录

```
cet4-sparke/
├─ output/                     ← 最终产物
├─ output_v1_大纲近似/          ← 第一版（按四级大纲词频近似排序，非书上顺序，留档）
├─ sparke_pack/
│  ├─ pack2.rar                官方资源包（DCZB251，含 lrc）
│  ├─ ex2/                     解包内容（lrc + mp3 + 基础词汇.pdf）
│  ├─ lrc_utf8/                转好编码的 lrc
│  ├─ book_words.json          ★ 书本原序词表（2177）
│  ├─ basic_words.json         附录基础词汇（1523）
│  └─ jichu.txt                基础词汇.pdf 的抽取文本
├─ dict/
│  ├─ defs.json                有道抓取缓存（2177 条）
│  └─ defs_basic.json          有道抓取缓存（基础词汇）
└─ tools/                      抓取、解包、抽取、构建脚本
```

---

## 七、已知限制

1. **释义不是书上那套**。除了附录「基础词汇」，书上的中文释义无法数字化获取，用的是有道词典释义，义项更多、更长。
2. **`Week 3.mp3` 与另一版资源包不同**，但 LRC 文本一致，不影响词表。
3. 书本对同形异义词用 `calf①/calf②`、`hack①/hack②`、`staple①/staple②` 区分，导出时**保留原写法**，但两者共用同一份有道释义（如需要可手工拆开）。
4. `according to`、`jet lag`、`snack bar`、`soft drink` 等短语没有音标，属正常。
5. 附录「基础词汇」的音标在 PDF 里用的是特殊字形，部分 IPA 符号抽取后损坏，因此该文件的音标取自**有道**；书上原音标另存在 `cet4_zhoujihua_basic.csv` 的最后一列。
