# 词计划 · 四级词汇周计划训练台

一个**零依赖**的背单词 Web 应用（原生 ES modules + 手写 CSS，没有任何构建步骤、没有 npm 依赖），
词库来自你手上那本星火《四级词汇周计划》的官方配套资源，**单词与顺序和书上完全一致**。

---

## 快速开始

```powershell
# 1) 启动本地服务（默认 http://127.0.0.1:5199）
node server.mjs

# 2) 浏览器打开
start http://127.0.0.1:5199
```

也可以直接双击 `start.cmd`。

> 需要 Node 18+。服务只监听 `127.0.0.1`，纯静态，不联网、不上传任何数据。

---

## 三种用法，挑一个就行

**不想自己编译的话直接去 [Releases](https://github.com/EnzoVechace/CET-4-for-word/releases/latest) 下载**（里面的附件名是英文：`WordPlan-1.4-win64.exe` / `-android.apk` / `-web.html` / `-readme-zh.txt`，原因见根 README）。

| 想怎么用 | 用哪个文件 | 怎么装 |
| --- | --- | --- |
| **Windows 桌面程序** | `dist\词计划.exe`（19.8 MB，单文件） | 双击就能跑。全部网页资源和 16.97 MB 发音都编在 exe 里，第一次运行解到 `%LOCALAPPDATA%\WordPlan`；那里写不进去就自动退回 exe 旁边的 `WordPlan-data`（绿色便携版） |
| **安卓手机** | `dist\词计划_1.4.apk`（19.8 MB） | 传进手机点一下装。内置本地静态服务器（固定端口 `127.0.0.1:17653`），完全离线。装过旧版直接覆盖安装，进度会保留。1.3 起进度还会再往安卓系统存储里存一份，网页存储被系统清掉也能恢复 |
| **网页版 / 手机免安装** | `dist\词计划.html`（744 KB，单文件） | 双击就能用；拷到手机（微信/QQ/USB/云盘都行）用 Chrome / Edge / 夸克 打开也行，**完全离线**。想更像 App：浏览器菜单 →「添加到主屏幕」 |

> **exe / apk 自带发音，不用装任何语音引擎**（3700 个词 × 美音/英音 = 7394 段 Opus，16.97 MB）。
> 网页版为了保持 744 KB 的体积没内置音频，靠浏览器自带的语音合成。

> **Windows 版依赖 WebView2 运行时**：Win11 和大部分 Win10 自带。
> 万一目标机器上没有，**exe 会自己弹窗问你要不要装**，你点「是」它就调用内嵌的
> 微软官方引导安装器（`MicrosoftEdgeWebview2Setup.exe`，1.8 MB，只装给当前用户、不需要管理员）
> 静默装好再继续启动。所以这个 exe 发给别人，对方双击就能用。

### 重新打包

```powershell
node tools/make_single.mjs       # → dist\词计划.html（单文件离线版）
node tools/build_win.mjs         # → dist\词计划.exe（Windows 桌面版）
node tools/build_apk.mjs         # → dist\词计划_1.4.apk（安卓版）
python tools/make_icons.py       # 重新生成图标
node tools/get_webview2.mjs      # 重新下载 WebView2 SDK（只在首次编译时需要）
node tools/get_bootstrapper.mjs  # 重新下载 WebView2 引导安装器（只在首次编译时需要）
node tools/android_sdk.mjs       # 首次编译安卓版前下载 Android SDK 部件
node tools/fetch_audio.mjs       # 抓 7394 段发音（约 16 分钟，只在首次编译时需要）
```

---

## 它能做什么

### 词库（10 个，共 3700 个词条）

| 词库 | 说明 | 词数 |
| --- | --- | --- |
| 全书 | 核心词汇 + 认知词汇，按书上原始顺序 | 2177 |
| Week 1 – Week 7 | 每周 250 词，书序 | 250 × 7 |
| 认知词汇 | 附录一，含 A-C / D-H / I-Q / R-Z 小节标签 | 427 |
| 基础词汇 | 附录二（书上原释义） | 1523 |

### 四种练习模式

- **跟打** —— 看着单词照着敲。敲对变绿、敲错立刻变红，但**不打断输入**：
  打错的、打多的都能看见，`Backspace` 随便删，按 `Enter` 提交时才整词判分
- **默写** —— 字母全部遮罩，凭释义写出整词
- **听音** —— 只听发音拼写，释义在作答后才揭晓。**只有这个模式进词时自动出声**（题目本身就是声音）
- **选择** —— 英译中反向，4 个选项，可按 `1`–`4` 直接选。
  提交后会顺手把**其它几个选项**的简短释义标在小字里（正确答案那条不标，避免喧宾夺主），一眼看懂错在哪

卡片分两层：上面是**整词**（跟书上一样连着写，不再一格一格拆散；默写/听音作答前显示为 `•••`），
下面是一条**独立的输入行**，你敲进去的字符出现在那里。
跟打时**逐字母判色**——敲对变绿（微微放大 + 一圈淡绿光晕），敲错立刻变红；
但**判色不打断输入**：打错的、打多的都照单全收，`Backspace` 随便删，
最后按 `Enter` 提交时才整词定对错。判色只是视觉提示，任何时候都不锁键盘。

### 其它

- **间隔重复**：熟练度 0–7 级，间隔 `0/1/2/4/7/15/30/60` 天；答对升级，答错降 2 级并 10 分钟后重来；≥5 级算「已掌握」
- **范围过滤**：全部 / 未学 / 未掌握 / 错词本 / 待复习（按遗忘曲线到期）
- **每轮数量自己填**：侧栏「每轮数量」是一个输入框，想背多少个就填多少个，回车生效；
  留空（或点「不限」）就是整个词库一次背完。顺序照旧可选「书序 / 打乱」
- **高频释义划虚线**：像书上那样，给高频的那条释义划一条虚线。
  书上那份标注官方资源包里没有（包里只有 MP3、LRC 和一个基础词汇 PDF），
  所以这里改用**真实语料频次**做依据——有道「权威英汉双解」里那套 **Collins COBUILD 义项频次序**
  （抓取脚本 `tools/fetch_collins.mjs`，缓存在 `build/collins.json`，3789 个词）。
  规则（`tools/hf.mjs` 的 `pickHf`）：取 Collins 前 5 条义项按词性计数，
  出现 ≥2 次的词性各标「该词性那一行的第一个义项」，都不够 2 次就退回 Collins 排第一的那个词性，最多标 2 条。
  例如 `focus` 会同时标 `v. 集中，关注`（Collins 排第一）和 `n. 重点，中心点`；
  `career` 只标 `n. 职业，事业`；`according to` 标 `根据…`。
  核心词库 2177 词里 **2146 词（98.6%）** 会划上；`rate`、`assume`、`reference` 等 31 个词
  有道那边压根不返回 Collins 数据，就没标（宁可留白，也不拿「第一个义项」滥竽充数）。
  不想要可以在「设置 → 练习 → 高频释义虚线」关掉
- **释义自动精简**：长词条（`stock` 的 n. 有 26 条义项、223 个字）读起来太累，
  所以显示时每个**词性行**最多留 3 条义项、整行不超过 46 个字，超了用 `…` 收尾；
  词性本身（斜体的 `n.` `v.` `adj.`）**永远保留**，划了虚线的高频义项**绝不会被剪掉**
  （它常常不是第一条，所以 `trimLine` 有个 `atLeast` 参数专门保它）。
  这是**显示层**行为（`js/ui.js` 的 `trimLine` / `shortMeaning`），词库 JSON 里一条没删。
  不想要就在「设置 → 练习 → 精简释义」关掉，关掉后义项一条不少
- **「可选写法」都算对**：书上很多词条写的是可变拼法，输入时敲任意一种都判对——
  `program(me)` → `program` 或 `programme`、`harbo(u)r` → `harbor`/`harbour`、
  `realize,-ise` → `realize`/`realise`、`fiber/-bre` → `fiber`/`fibre`、`a/an`、`OK/okay`、`o'clock`。
  卡片上仍按书上原样显示 `program(me)`；逐字母判色按「任意一种写法」比，答错时提示会把几种写法都列出来
- **音标点一下就发音**：卡片上的 `美 /ˈfoʊkəs/` 和 `英 /ˈfəʊkəs/` 都是按钮，
  点「美」用美音念、点「英」用英音念，跟当前设置的口音无关。
  点下去那一块只亮 260ms 就恢复原样，不会一直停在「被选中」的样子
- **错词回收**：本轮答错的词会自动排到队尾再考一遍（只补一次）
- **点词库能展开看词表**：每个词库右边都有一个看得见的 **「展开 / 收起」** 小药丸按钮，点它就展开 / 收起这个词库的单词；
  点词库整行则是「选中它 + 展开词表」两件事一起做。展开区每行是「序号 + 单词 + 释义头一小截」，已经掌握的词标绿。
  展开区**最高只占半屏多一点**（`min(46vh, 400px)`），再多就在框里用滚轮滚，不会把下面的 Week 2 顶到屏幕外面去。
  一次只展开一个（手风琴）
- **随背随记 · 进度续传**：每答一个词就立刻落盘（`cursors` 记下每个词库「学到哪儿」），关掉页面、换一天再来，
  点开同一个词库会**接着上次的词往下背**，并弹一句「接着上次：从第 N 个词继续（按「上一词」能往回看）」。
  续传时**上次背过的那一段仍然留在会话里**，所以按「上一词」能一路翻回这个词库的第一个词去复习；
  卡片上方的计数器报的是**这本书里的第几个 / 这个词库一共多少词**（如 `第 6 / 250 词`），
  进度条则只反映当前这一轮。想从头再来，点完成面板上的「重头开始」即可。
  （错词本 / 待复习 这两批不续传，它们本来就要整个过一遍）
- **自己挑起点**（1.4 起）：侧栏「每轮数量」下面有「从第几个词开始」，填序号（`12`）或直接填单词
  （`benefit`）都行，回车生效；点「从头」把起点清掉。**展开词表后点任意一个单词**，也能直接从它开始背，
  起点那一行会标一个「起点」小标 —— 适合已经背到一半、不想从头再来的人。
  起点存在 `cursors` 里（和续传用的是同一份），所以关掉再打开还会停在那儿。
- **统计**：已掌握 / 学习中 / 总正确率 / 连续打卡、今日四格、17 周热力图、各词库进度条、错词榜
- **朗读**：**自动朗读只在「听音」模式进词时出声**（那个模式的题目就是声音）；
  跟打 / 默写 / 选择都是**提交答案后**才读，进新词时绝不抢先念出来 —— 免得还没看清单词就被剧透。
  读的时候先英文单词、再中文释义；每次作答后（对错都算）再读一遍。
  切换到下一个词时上一段朗读会被立刻掐掉，不会两段叠在一起
- **翻词**：卡片下方有「← 上一词 / 下一词 →」按钮，也可以用 `←` `→` 方向键。
  输入行是空的时，`下一词` 只翻页、不动进度（方便先翻一遍看看）；**输入行里已经敲了东西时，
  它会先按正常流程判分**（没敲完就是答错、写进错词本），判完再点一次才真的翻到下一词 ——
  不会让半截输入白白溜过去
- **答错的词一定停下来**：设置里的「答对后自动下一词」只对**答对**的词生效；答错时画面会停在原地，
  等你把正确答案看完、按 `Enter` 或点「继续 →」才走。手机上「提交」判完会在原地变成「继续 →」，
  为了不被手快的连点带过去，判分后 360ms 内的这一下会被忽略
- **外观**：浅色 / 深色主题，窗口变窄时侧栏收成抽屉（左上角 ☰）
- **数据**：进度全部存在浏览器 localStorage（键 `wordplan.v1`），可导出 / 导入 JSON 备份
- **快捷键**：`Enter` 提交或下一词 · `←` `→` 上一词 / 下一词 · `Backspace` 退格重敲 · `Space` 发音 · `Tab` 提示下一个字母（计入错误）· `Esc` 看答案
- **即时反馈**：敲对立刻变绿、微微放大并带一圈淡绿光晕；敲错立刻变红，但不会挡住你继续输入或退格

进度以**单词本身**为键，所以「全书」「Week 3」「认知词汇」共享同一份熟练度——
在任意词库里练过的词，换个词库进来仍然是练过的。

---

## 目录结构

```
cet4-trainer/
├─ server.mjs                 零依赖静态服务器（127.0.0.1:5199，路径穿越防护）
├─ start.cmd                  一键启动
├─ public/
│  ├─ index.html              外壳
│  ├─ css/style.css           设计系统（CSS 变量 + 深浅色 + 响应式）
│  ├─ js/
│  │  ├─ app.js               外壳、哈希路由、顶栏、侧栏
│  │  ├─ store.js             状态、间隔重复、统计、导入导出
│  │  ├─ dict.js              词库加载（支持 compose 组合虚拟词库）
│  │  ├─ speech.js            Web Speech 发音
│  │  ├─ ui.js                转义、toast、释义排版等小工具
│  │  ├─ practice.js          四种练习模式的会话状态机
│  │  ├─ stats.js             统计页
│  │  └─ settings.js          设置页
│  ├─ data/dicts.json         词库索引
│  ├─ dict/*.json             词库数据
│  ├─ icons/*.png             应用图标（PWA / 桌面 / 主屏幕）
│  ├─ manifest.webmanifest    PWA 清单
│  └─ sw.js                   Service Worker（网络优先 + 缓存兜底）
├─ native/
│  ├─ Program.cs              Windows 桌面版外壳（WinForms + WebView2，C# 5）
│  └─ app.manifest            DPI 感知 / Windows 兼容性声明
├─ dist/                      交付物：词计划.exe / 词计划.html / 使用说明.txt
├─ tools/
│  ├─ build_dict.mjs          从 ../../cet4-sparke/output 编译词库
│  ├─ make_icons.py           Pillow 生成图标 + app.ico
│  ├─ make_single.mjs         打成一个单文件离线 HTML
│  ├─ build_win.mjs           用系统 csc.exe 编译单文件 exe
│  ├─ get_webview2.mjs        下载并解包 WebView2 SDK（编译 exe 需要）
│  ├─ e2e.mjs                 端到端冒烟测试（CDP 驱动无头 Edge，53 项断言）
│  ├─ check_single.mjs        验证单文件 HTML 在 file:// 下能用（6 项断言）
│  └─ shots.mjs               造进度 + 逐页截图
└─ shots/                     截图（演示用）
```

---

## 数据来源

- **单词与顺序**：星火官方配套资源包里的 `.lrc` 音频歌词文件，逐词带时间戳，即书上的原始词序。
  已用 MD5 比对确认 `DCZB231`（你书上印的图书代码）与 `DCZB251` 两个资源包的音频完全一致，
  故两者词表通用。
- **释义与音标**：在线词典查询结果（有道 jsonapi）。
- **基础词汇（附录二）**：从官方资源包的 PDF 抽取，采用**书上原释义**。

词库由 `../cet4-sparke/` 的产出编译而来，详见 `../cet4-sparke/README.md`。

---

## 开发与验证

```powershell
# 重新编译词库（改了 ../cet4-sparke/output 之后）
node tools/build_dict.mjs

# 端到端测试：先启动 server.mjs，再启动带调试端口的 Edge
& "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" `
  --headless=new --disable-gpu --remote-debugging-port=9222 `
  --user-data-dir="$PWD\.edgeprof" http://127.0.0.1:5199/
node tools/e2e.mjs            # 53/53 通过
node tools/e2e_mobile.mjs     # 15/15 通过（触摸端）
node tools/check_single.mjs   # 6/6 通过（单文件离线版的 file:// 验证）

# 重新生成截图
node tools/shots.mjs

# Windows 版自检：编译后跑一次，程序会自己截图并退出
node tools/build_win.mjs
node tools/get_webview2.mjs
.\dist\词计划.exe --shot .\shots\windows.png
```

> 注意：无头 Edge 在受限沙箱里会因命名管道被禁而崩溃
> （`mojo platform_channel.cc: Check failed: . : 拒绝访问。`），需要放宽权限运行。

---

## 发音是怎么发出来的

**应用自带发音，不依赖系统语音引擎。** 7394 个发音片段（3700 词 × 美音/英音，同形异义的词共用一个文件）已经抓下来、
用 Opus 压到 16 kbps 单声道（**合计 16.97 MB**），随 exe / apk 一起分发：

```
public/audio/manifest.json          { ext: ".ogg", codec: "opus", accents: ["us","uk"], count: 7394 }
public/audio/us/<slug>.ogg          3697 个
public/audio/uk/<slug>.ogg          3697 个
```

`js/speech.js` 按这个优先级选路（`isSupported()` 也会跟着变）：

| 顺序 | 走哪条路 | 什么时候用得上 |
| --- | --- | --- |
| 0 | **打包好的音频文件**（`<audio>` 播 Opus） | exe / apk 里首选；**什么都不用装**。slug 由 `altForms(词)[0]` 算出来（`program(me)` → `programme`、`according to` → `according_to`），和抓取脚本 `tools/fetch_audio.mjs` 完全一致 |
| 1 | Windows 宿主对象 `WordPlanTts`（宿主进程里的 SAPI5，跑在专用 STA 线程上） | exe 里万一某个词没抓到音频 |
| 2 | Android 桥 `AndroidTTS` → 系统 TextToSpeech | apk 里同上 |
| 3 | Web Speech（Edge/Chrome 自带） | 浏览器 / 单文件 HTML（`dist\词计划.html` **不带音频**，走这条） |

单文件 HTML 故意不含音频（那样会胖 17 MB），双击打开时自动退回 Web Speech，
所以想在浏览器里也有稳定发音，就用 exe / apk 或跑 `node server.mjs` 用带音频的目录版。

**真机验证**（模拟器 `emulator-5554`，这台机器上**一个 TTS 引擎都没装**）：

```js
{ speechSupported: true, played: ["audio/us/focus.ogg"], engineReady: false }
```

—— 系统引擎是 `false`，点 🔊 照样播出了 `audio/us/focus.ogg`。这就是「不要引擎」那条要求的落地结果。

### 还是没声音的话

**先点「设置 → 发音 → 测试发音」。** 它会真的念一句，并把下面这些一次性写在下边：

```
外壳：Windows 壳（宿主对象 WordPlanTts）     ← 说明走的哪条路
Web Speech 接口：存在
原生语音引擎可用：true
系统嗓子列表：count=3 | Microsoft Huihui Desktop / zh-CN enabled=True | Microsoft Zira Desktop / en-US enabled=True
原生桥实念一句（test / 美音）：true / false
浏览器语音数：3
   · Microsoft Huihui - Chinese (Simplified, PRC) / zh-CN
   …
Web Speech 实念一句：念完了（start → end 都收到了） / 失败：xxx / 超时…
```

| 外壳 | 没声音时先查什么 |
| --- | --- |
| Windows exe / Android apk | 先确认音频文件在不在：exe 看 `%LOCALAPPDATA%\WordPlan\web\audio\`（或 exe 旁边 `WordPlan-data\web\audio\`），apk 看设置页自检里的「外壳」那行。文件在而没声音 = 系统静音 / 音量合成器把这个应用调没了 |
| 浏览器 / PWA | Edge 一般自带 300 多个嗓子（含在线的 Natural 语音），出问题通常是没联网或系统静音 |
| 单文件 HTML | 本来就没有打包音频，只能靠 Web Speech；想要稳定发音就用 exe / apk |

> 老坑记一笔：**WebView2（exe 用的内核）和 Edge 浏览器虽然同源，但能用的语音不是一套。**
> 实测同一台机器：Edge 能列出 325 个语音并正常朗读；WebView2 只列出 3 个本机中文语音，
> 而且逐个试都是 `synthesis-failed`。这就是为什么 exe 里必须自带音频 + 备一条原生 SAPI 桥。
>
> 另一个老坑：安卓侧以前不管念什么都用 `Locale.US`——**中文释义也被丢给英文嗓子**。
> 现在按口音选语言（`us` → `en-US`、`uk` → `en-GB`、`zh` → `zh-CN`），
> 想要的变体没装时会退一步试同语系的另一个。

---

## 已知限制

- 选择模式只有「英译中」方向；听音模式的音色就是打包音频里的声音，跟着口音走
- 进度存在浏览器里，换浏览器或清缓存会丢（记得偶尔导出 JSON 备份）。
  安卓版另外往系统 `SharedPreferences` 存了一份（1.3 起），那份丢了才会真丢
- 词库是静态文件，应用不做任何联网请求
- **安卓版是自签名的**：`tools/build_apk.mjs` 用 `android/keystore/wordplan.jks` 签名（口令 `wordplan`），
  没走 Play 商店，安装时需要允许「未知来源」。这个 keystore **不进仓库**（公开了等于谁都能签同一个包名的升级包）。
- **exe / apk 自带发音，不依赖系统语音引擎**（7394 段 Opus，16.97 MB，随包分发）；
  只有**单文件 HTML**和浏览器版退回 Web Speech，那时候才需要系统/浏览器装了英语语音。
  另外音频只抓了「书上那 3700 个词」，自己往里加新词的话那个词就没有自带音频，会自动退回系统语音。
- 释义精简是**显示层**行为（`js/ui.js` 的 `trimLine` / `shortMeaning`），词库 JSON 里的完整释义一条没删；
  想直接改词库就用 `tools/build_dict.mjs` 重新生成。
- **Windows 版只编了 x64**：32 位 Windows 需要把 `tools/build_win.mjs` 里的 `/platform:x64` 改成 `x86`，
  并把 WebView2 的 loader 换成 `runtimes\win-x86\native\WebView2Loader.dll`。
- Windows 版外壳用 .NET Framework 4.x 自带的 `csc.exe` 编译（这台机器上没有 Roslyn / .NET SDK），
  所以 `native/Program.cs` 必须一直保持 **C# 5 语法**：不能用 `$"插值"`、`?.`、`nameof`、表达式体成员。
