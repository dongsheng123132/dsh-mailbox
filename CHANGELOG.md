# Changelog

## 0.1.0 — 2026-11-17

首个可用版本。

**新增**
- 离线读取 `.eml` / `.mbox`，零依赖、不联网、不需要 OAuth。
- `scan`：文件数、邮件数、去重、日期范围、附件数。
- `triage`：四栏分诊（要动的 / 坏的 / 好的 / 机会 / 通知），带截止日抽取与天数换算。
- `threads`：按 `References` / `In-Reply-To` 归并线程。
- `attachments`：附件类型、大小、出现次数盘点。
- `search`：主题 / 正文 / 发件人全文搜索。
- DSH 工具 `dsh_mailbox`，五个动作与 CLI 一致。
- 手写 MIME 解析：头部折叠、RFC 2047 编码字、multipart（含嵌套）、base64、quoted-printable。
- 字符集：UTF-8 / GBK / Big5 / ISO-8859-1 / Windows-1252 / Shift_JIS / EUC-JP / EUC-KR。
- 同 `Message-ID` 去重，保留首次出现并记录重复文件。

**边界（已知不支持）**
- 不连邮箱（无 IMAP/SMTP/POP3/OAuth）。
- 不写原文件、不建持久索引。
- TNEF、S/MIME 解密、加密邮件不支持。
- 截止日只认明确日期写法，不猜「尽快」「下周」。

**质量**
- 65 条测试全绿（解析 / 加载 / 分诊 / CLI / 插件加载）。
- 五道门禁：包结构、语法、命名同源、假 ctx 加载、红线（无网络 / 无写文件 / 无 eval）。
