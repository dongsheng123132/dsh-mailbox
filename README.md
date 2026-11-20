# dsh-mailbox

**离线邮件档案工作台**：把已导出的 `.eml` / `.mbox` 变成带截止日的待办清单——不联网、不需要 OAuth、不改原文件。

**[English](README.en.md)** · [安装](#安装) · [怎么用](#怎么用) · [明确不做什么](#明确不做什么)

---

## 它解决什么问题

`dsh-email` 管的是**活邮箱**：连 IMAP/SMTP、走 OAuth、收发邮件。

但很多场景下你手上只有**一堆导出文件**：

- 离职/换邮箱前，把几年邮件导成 `.mbox` 存档
- 客户/供应商发来一批 `.eml`，要挑出「哪封在等回复、哪天截止」
- 邮箱令牌过期、公司网络禁 IMAP，只想离线看一眼

`dsh-mailbox` 就是这一层：**只读文件，零配置，不上传，不需要任何账号**。

## 安装

```bash
dsh plugin --profile desktop add dsh-mailbox
```

网页版把 `desktop` 改成 `web`；装完重启对应的 DSH。

也可以直接用 CLI：

```bash
npx dsh-mailbox scan ./mail-export
```

## 怎么用

五个动作，都不改原文件：

| 动作 | 做什么 |
|---|---|
| `scan` | 清点：文件数、邮件数、去重、日期范围、附件数 |
| `triage` | 四栏分诊：**要动的** / 坏的 / 好的 / 机会 |
| `threads` | 归并线程：有引用头按 References/In-Reply-To，没有就按主题+时间窗兜底 |
| `attachments` | 附件盘点：类型、大小、出现次数 |
| `search` | 在主题/正文/发件人里搜 |
| `export` | 把分诊结果导成 CSV 待办表（Excel / Numbers / 飞书表格直接打开） |

```bash
dsh-mailbox scan        ./mail-export
dsh-mailbox triage      ./mail-export            # 完整 Markdown 报告
dsh-mailbox triage      ./mail-export --brief    # 一屏摘要
dsh-mailbox triage      ./mail-export --json     # 机读
dsh-mailbox threads     ./mail-export --top 10            # 30 天窗兜底
dsh-mailbox threads     ./mail-export --window 0          # 只认引用头
dsh-mailbox threads     ./mail-export --window 90 --top 5  # 放宽时间窗
dsh-mailbox attachments ./mail-export
dsh-mailbox search      ./mail-export --q "invoice"
dsh-mailbox export      ./mail-export > 待办.csv       # 默认只导「要动的」，带 BOM
dsh-mailbox export      ./mail-export --all            # 每一栏都导（多一列「栏」）
dsh-mailbox export      ./mail-export --bucket red     # 只导某一栏
dsh-mailbox export      ./mail-export --no-bom         # 不带 BOM（喂脚本/API）
```

在 DSH 里对 AI 说：

> 用 dsh_mailbox 分诊 `~/Downloads/mail-export`，只告诉我这周要动哪几封。

### 报告长什么样

```
## 要动的（3）

| 截止 | 主题 | 发件人 | 来源文件 |
|---|---|---|---|
| 2026-11-20（剩 3 天） | 报价单截止 | vendor@example.cn | `mail-export/gbk.eml#0` |
| 2026-11-25（剩 8 天） | Q4 planning | lead@example.com | `mail-export/thread-1.eml#0` |
```

每条结论都带**文件路径 + 序号**，用户质疑时能当场翻开原文。

### 线程是怎么归并的（以及为什么不会乱粘）

真导出里大量回复没有 `References` / `In-Reply-To`（有的工具直接丢掉），只剩 `Re:` / `答复:` 前缀。只认引用头的话，一段对话会被读成好几件互不相干的事。

所以 `threads` 分两轮：

1. **有引用头就用引用头**：沿着 `In-Reply-To` / `References` 找根，这一轮永远优先。
2. **没有引用头才兜底**：归一化主题（剥 `Re:` / `Fwd:` / `答复:` / `回复:` / `转:` / `[外部]`，压空白、忽略大小写）后，要求同时满足三条才合并——
   - 主题相同；
   - 除邮箱主人外**至少有一个共同联系人**（两个客户发的同名「报价单」不会被粘成一条）；
   - 与线程起点相差不超过 `--window` 天（默认 30）。

输出会把靠兜底合并的线程标成 `·主题兜底`，你能一眼看出哪些结论是猜的、哪些是引用头证实的。默认只认 30 天；`--window 0` 完全关掉兜底。

### 把待办落成表格（export）

`export` 输出的是 **CSV 文本**，不是文件——本包不写盘，落盘由你决定：

```bash
dsh-mailbox export ./mail-export > 待办.csv
```

列固定为：`截止日 / 剩余天数 / 栏 / 主题 / 发件人 / 邮件日期 / 原文写法 / 来源 / 命中关键词 / 要不要回复`。

- **默认只导「要动的」**；`--all` 导每一栏（用「栏」列区分）；`--bucket red` 只导某一栏。
- **默认带 UTF-8 BOM**：不带的话中文 Excel 打开是乱码。给脚本吃用 `--no-bom`。
- 「来源」是相对档案目录的路径 + `#序号`（如 `gbk.eml#0`），在表格里也能翻回原文。
- 「原文写法」保留邮件里怎么写的（`11月20日`），和归一化后的「截止日」对照着看。
- **防公式注入**：主题来自外部输入，以 `= + - @` 开头的单元格会加前导单引号，避免 Excel 把邮件主题当公式执行。
- `--json` 给机读（`{bucket, count, rows, csv}`）。

## 明确不做什么

这些边界是设计的一部分，不是暂未实现：

- **不连邮箱**：不实现 IMAP / SMTP / POP3 / OAuth。要连活邮箱请用 `dsh-email`。
- **不改原文件**：只读；不移动、不删除、不重命名、不回写。
- **不写任何文件**：包括 `export`——它只把 CSV 打到标准输出，落盘用 `>` 重定向，插件自己一个字节都不写。
- **不联网**：没有任何网络调用（自检脚本会拦 `node:http/https/net/tls` 等导入）。
- **不执行邮件内容**：HTML 里的脚本被剥离，远程图片不会自动加载。
- **不支持**：TNEF（`winmail.dat`）、S/MIME 解密、加密邮件、MS 专有富文本；这些会如实报告，不假装解析成功。
- **不判断语义**：四栏分类是关键词规则，不是模型推理。每条结论都带命中的关键词，便于人工复核；拿不准的进「通知/营销」，不硬塞进「要动的」制造噪音。
- **只看这封信自己写的话**：引用历史（`>` 行、`-----原始邮件-----`、`在 … 写道：`、Outlook 的 `发件人:` 头）不参与判据——否则回复里引用的旧截止日、旧报错会把已经办结的邮件重新打成「要动的」「坏的」。主题头始终参与（转发的邮件主题也是你自己写的）。
- **不保证截止日一定对**：只认明确的日期写法（`2026-11-25`、`2026/11/25`、`2026.11.25`、`2026年11月25日`、`11月20日`、`Nov 24, 2026`、`within 5 days`、`7天内`）；「尽快」「下周」「下周三」不猜日期，但「请于下周三前回复」这类明确的请求仍会进「要动的」。
- **年份不靠运行时间猜**：没有年份的日期按**邮件自己的发送日期**推年份（12 月里写「1 月 5 日」顺延到下一年）；翻 2024 年的存档不会得到 2026 年的截止日。
- **不索引超大档案**：单文件 > 200MB 跳过并报告；不建持久索引，退出即释放。

## 编码支持

| 情况 | 状态 |
|---|---|
| UTF-8 / GBK / GB2312 / GB18030 / Big5 / ISO-8859-1 / Windows-1252 / Shift_JIS / EUC-JP / EUC-KR | ✅ |
| 主题 / 发件人 / 附件文件名里的**原始 8bit 字节**（UTF-8 或 GBK，没做 RFC 2047 编码） | ✅ 自动识别 |
| **写错的 charset**（声称 utf-8 其实 GBK，或反过来） | ✅ 按字节纠正 |
| 完全没写 charset 的 GBK 正文 | ✅ 兜底解出 |
| 个别坏字节（整段编码是对的，只有 1–2 个字节坏了） | ✅ 保留原文，不整段改判 |

两种真实世界的错法都能识别并说明：

- 主题是 `æ¥ä»·åç¡®è®¤` / `±¨¼Ûµ¥È·ÈÏ` 这种乱码——客户端把 8bit 字节直接写进头部，没做 RFC 2047 编码。
  猜法：UTF-8 是自校验编码先试它，不成再试 GBK；都解不出就原样保留，不编造。
- 正文解出一串 `����`，或解出一段「看着像中文、其实全错」的字——charset 声明与实际字节不符。

解不出的字符集不会静默假装成功：报告里会列「编码告警」，写清**声称的是哪个**、**实际按哪个解出**（例如「声称 utf-8，实际按 gbk 解出」）。

## 退出码

| 码 | 含义 |
|---|---|
| 0 | 成功 |
| 1 | 参数错误 |
| 2 | 目录不存在或不可读 |
| 3 | 目录里没有 `.eml` / `.mbox` |

## 参考与许可

- 邮件格式标准：[RFC 5322](https://datatracker.ietf.org/doc/html/rfc5322)（消息格式）、[RFC 2045–2047](https://datatracker.ietf.org/doc/html/rfc2045)（MIME 与编码字）。
- 分类口径参考了本地技能 `mailbox-triage`（四栏：要动的 / 坏的 / 好的 / 机会），保持人和 AI 对得上。
- 本包**零运行时依赖**，MIME 解析为手写实现，未复制任何第三方解析库代码。
- 许可证：MIT。

## 开发

```bash
npm test          # 105 条测试
npm run check     # 五道门禁：结构/语法/命名/加载/红线
node scripts/make-fixtures.mjs   # 重新生成测试样本（GBK/base64/QP/附件/mbox）
```

测试样本用真实编码生成（GBK 主题、base64 中文正文、quoted-printable、PDF 附件、mbox 两封、同 Message-ID 重复），不是手写字符串——手写会让「测试通过」失去意义。
