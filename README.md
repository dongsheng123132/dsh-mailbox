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
| `threads` | 按引用关系归并线程，找出最长的对话 |
| `attachments` | 附件盘点：类型、大小、出现次数 |
| `search` | 在主题/正文/发件人里搜 |

```bash
dsh-mailbox scan        ./mail-export
dsh-mailbox triage      ./mail-export            # 完整 Markdown 报告
dsh-mailbox triage      ./mail-export --brief    # 一屏摘要
dsh-mailbox triage      ./mail-export --json     # 机读
dsh-mailbox threads     ./mail-export --top 10
dsh-mailbox attachments ./mail-export
dsh-mailbox search      ./mail-export --q "invoice"
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

## 明确不做什么

这些边界是设计的一部分，不是暂未实现：

- **不连邮箱**：不实现 IMAP / SMTP / POP3 / OAuth。要连活邮箱请用 `dsh-email`。
- **不改原文件**：只读；不移动、不删除、不重命名、不回写。
- **不联网**：没有任何网络调用（自检脚本会拦 `node:http/https/net/tls` 等导入）。
- **不执行邮件内容**：HTML 里的脚本被剥离，远程图片不会自动加载。
- **不支持**：TNEF（`winmail.dat`）、S/MIME 解密、加密邮件、MS 专有富文本；这些会如实报告，不假装解析成功。
- **不判断语义**：四栏分类是关键词规则，不是模型推理。每条结论都带命中的关键词，便于人工复核；拿不准的进「通知/营销」，不硬塞进「要动的」制造噪音。
- **只看这封信自己写的话**：引用历史（`>` 行、`-----原始邮件-----`、`在 … 写道：`、Outlook 的 `发件人:` 头）不参与判据——否则回复里引用的旧截止日、旧报错会把已经办结的邮件重新打成「要动的」「坏的」。主题头始终参与（转发的邮件主题也是你自己写的）。
- **不保证截止日一定对**：只认明确的日期写法（`2026-11-25`、`2026/11/25`、`2026.11.25`、`2026年11月25日`、`11月20日`、`Nov 24, 2026`、`within 5 days`、`7天内`）；「尽快」「下周」「下周三」不猜日期，但「请于下周三前回复」这类明确的请求仍会进「要动的」。
- **年份不靠运行时间猜**：没有年份的日期按**邮件自己的发送日期**推年份（12 月里写「1 月 5 日」顺延到下一年）；翻 2024 年的存档不会得到 2026 年的截止日。
- **不索引超大档案**：单文件 > 200MB 跳过并报告；不建持久索引，退出即释放。

## 编码支持

| 编码 | 状态 |
|---|---|
| UTF-8 | ✅ |
| GBK / GB2312 / GB18030 | ✅ |
| Big5 | ✅ |
| ISO-8859-1 / Windows-1252 | ✅ |
| Shift_JIS / EUC-JP / EUC-KR | ✅ |

解不出的字符集不会静默假装成功：报告里会列「编码告警」，指出哪些邮件可能不完整。

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
npm test          # 74 条测试
npm run check     # 五道门禁：结构/语法/命名/加载/红线
node scripts/make-fixtures.mjs   # 重新生成测试样本（GBK/base64/QP/附件/mbox）
```

测试样本用真实编码生成（GBK 主题、base64 中文正文、quoted-printable、PDF 附件、mbox 两封、同 Message-ID 重复），不是手写字符串——手写会让「测试通过」失去意义。
