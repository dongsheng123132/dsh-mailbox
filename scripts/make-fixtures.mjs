#!/usr/bin/env node
/**
 * make-fixtures.mjs —— 生成测试样本（只在开发时跑一次，产物已提交到 test/fixtures/）。
 *
 * 为什么要生成而不是手写：中文/GBK/base64/QP 这些编码手写极易错，
 * 用脚本编码能保证「测试通过」确实说明解析器对，而不是样本恰好简单。
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures')
mkdirSync(dir, { recursive: true })

const CRLF = '\r\n'
const joinLines = (arr) => arr.join(CRLF)

// 1) 纯文本
writeFileSync(join(dir, 'basic.eml'), joinLines([
  'From: Alice <alice@example.com>',
  'To: me@example.com',
  'Subject: Project kickoff',
  'Date: Mon, 17 Nov 2026 09:00:00 +0800',
  'Message-ID: <basic-1@example.com>',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Hi,',
  '',
  'Let us start the project on Monday.',
  'Thanks,',
  'Alice',
]))

// 2) multipart/alternative，base64 UTF-8 中文 + RFC2047 主题
const plain = '你好，\n\n这是中文正文。请确认收到。\n'
const html = '<html><body><p>你好，</p><p>这是中文正文。请确认收到。</p></body></html>'
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64')
writeFileSync(join(dir, 'multipart.eml'), joinLines([
  `From: =?UTF-8?B?${b64('张三')}?= <zhangsan@example.com>`,
  'To: me@example.com',
  `Subject: =?UTF-8?B?${b64('项目确认')}?=`,
  'Date: Tue, 18 Nov 2026 10:30:00 +0800',
  'Message-ID: <multi-1@example.com>',
  'MIME-Version: 1.0',
  'Content-Type: multipart/alternative; boundary="BOUND1"',
  '',
  '--BOUND1',
  'Content-Type: text/plain; charset=utf-8',
  'Content-Transfer-Encoding: base64',
  '',
  b64(plain),
  '--BOUND1',
  'Content-Type: text/html; charset=utf-8',
  'Content-Transfer-Encoding: base64',
  '',
  b64(html),
  '--BOUND1--',
  '',
]))

// 3) GBK 主题（B 编码）+ quoted-printable GBK 正文
// 预生成：printf '报价单截止' | iconv -f UTF-8 -t GBK | base64
const GBK_SUBJECT_B64 = 'sai827WlvdjWuQ=='
// '请在11月20日前确认报价。' 的 GBK 字节转 QP
const GBK_BODY_QP = '=C7=EB=D4=DA11=D4=C220=C8=D5=C7=B0=C8=B7=C8=CF=B1=A8=BC=DB=A1=A3'
writeFileSync(join(dir, 'gbk.eml'), joinLines([
  'From: vendor@example.cn',
  'To: me@example.com',
  `Subject: =?GBK?B?${GBK_SUBJECT_B64}?=`,
  'Date: Wed, 19 Nov 2026 14:00:00 +0800',
  'Message-ID: <gbk-1@example.com>',
  'MIME-Version: 1.0',
  'Content-Type: text/plain; charset=gbk',
  'Content-Transfer-Encoding: quoted-printable',
  '',
  GBK_BODY_QP,
]))

// 4) 带附件（multipart/mixed）
const pdfBytes = Buffer.from('%PDF-1.4 fake pdf content for tests')
writeFileSync(join(dir, 'attachment.eml'), joinLines([
  'From: bob@example.com',
  'To: me@example.com',
  'Subject: Contract attached',
  'Date: Thu, 20 Nov 2026 08:15:00 +0800',
  'Message-ID: <att-1@example.com>',
  'MIME-Version: 1.0',
  'Content-Type: multipart/mixed; boundary="MIX1"',
  '',
  '--MIX1',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Please find the contract attached.',
  '--MIX1',
  'Content-Type: application/pdf; name="contract.pdf"',
  'Content-Disposition: attachment; filename="contract.pdf"',
  'Content-Transfer-Encoding: base64',
  '',
  pdfBytes.toString('base64'),
  '--MIX1--',
  '',
]))

// 5) 线程：两封（回复）
writeFileSync(join(dir, 'thread-1.eml'), joinLines([
  'From: lead@example.com',
  'To: me@example.com',
  'Subject: Q4 planning',
  'Date: Fri, 21 Nov 2026 09:00:00 +0800',
  'Message-ID: <thread-root@example.com>',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Could you send the Q4 numbers by 2026-11-25?',
]))
writeFileSync(join(dir, 'thread-2.eml'), joinLines([
  'From: me@example.com',
  'To: lead@example.com',
  'Subject: Re: Q4 planning',
  'Date: Fri, 21 Nov 2026 10:30:00 +0800',
  'Message-ID: <thread-reply@example.com>',
  'In-Reply-To: <thread-root@example.com>',
  'References: <thread-root@example.com>',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Will send by Friday.',
]))

// 6) mbox：两封
writeFileSync(join(dir, 'sample.mbox'), [
  'From alice@example.com Mon Nov 17 09:00:00 2026',
  'From: alice@example.com',
  'To: me@example.com',
  'Subject: First in mbox',
  'Date: Mon, 17 Nov 2026 09:00:00 +0800',
  'Message-ID: <mbox-1@example.com>',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'First message body.',
  '',
  'From dan@example.com Tue Nov 18 11:00:00 2026',
  'From: dan@example.com',
  'To: me@example.com',
  'Subject: Deploy failed on staging',
  'Date: Tue, 18 Nov 2026 11:00:00 +0800',
  'Message-ID: <mbox-2@example.com>',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'The staging deploy failed with error 500.',
].join('\n'))

// 7) 重复（同 Message-ID，用来测去重）
writeFileSync(join(dir, 'dup-basic.eml'), joinLines([
  'From: Alice <alice@example.com>',
  'To: me@example.com',
  'Subject: Project kickoff',
  'Date: Mon, 17 Nov 2026 09:00:00 +0800',
  'Message-ID: <basic-1@example.com>',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Duplicate copy of the same message.',
]))

console.log('fixtures written to', dir)

// ── 8) 真实世界的乱码样本：test/fixtures-encoding/ ──────────────
// 这些文件必须按**字节**写：写成 JS 字符串就测不出「按字节猜字符集」这件事了。
// GBK 字节由 printf '…' | iconv -f UTF-8 -t GBK | xxd -p 预生成：
//   '报价单确认'              = b1a8bcdbb5a5c8b7c8cf
//   '请在11月20日前确认报价。' = c7ebd4da3131d4c23230c8d5c7b0c8b7c8cfb1a8bcdba1a3
//   '附件：合同扫描件.pdf'     = b8bdbcfebacfcdefb8bdc9a8c3e8c9a8c8bdb0e5
const encDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures-encoding')
mkdirSync(encDir, { recursive: true })

const utf8 = (s) => Buffer.from(s, 'utf8')
const gbk = (hex) => Buffer.from(hex.replace(/\s+/g, ''), 'hex')
const crlf = (s) => Buffer.from(s + CRLF, 'latin1')
const raw = (s) => Buffer.from(s, 'latin1')

const GBK_SUBJECT = 'b1a8bcdbb5a5c8b7c8cf'                       // 报价单确认
const GBK_QUOTE_BODY = 'c7ebd4da3131d4c23230c8d5c7b0c8b7c8cfb1a8bcdba1a3' // 请在11月20日前确认报价。
const GBK_PDF_NAME = 'b8bdbcfebacfcdefb8bdc9a8c3e8c9a8c8bdb0e5'  // 附件：合同扫描件.pdf

/** 按字节拼一封邮件：主题 / 正文可以是任意字符集，Content-Type 由调用方声明。 */
function writeBytes(file, { subjectBytes, contentType, bodyBytes, afterBody = [] }) {
  const parts = [
    crlf('From: vendor@example.cn'),
    crlf('To: me@example.com'),
    raw('Subject: '), subjectBytes, crlf(''),
    crlf(`Date: Wed, 19 Nov 2025 14:00:00 +0800`),
    crlf(`Message-ID: <${file.replace(/[^a-z0-9]+/gi, '-')}@example.com>`),
    crlf('MIME-Version: 1.0'),
    crlf(`Content-Type: ${contentType}`),
    crlf(''),
    bodyBytes,
    ...afterBody,
  ]
  writeFileSync(join(encDir, file), Buffer.concat(parts))
}

// 8a) 主题是原始 UTF-8 字节（没做 RFC 2047 编码）——中文客户端常见
writeBytes('raw-utf8-subject.eml', {
  subjectBytes: utf8('报价单确认'),
  contentType: 'text/plain; charset=utf-8',
  bodyBytes: utf8('请于11月20日前确认报价。\r\n'),
})

// 8b) 主题是原始 GBK 字节（老中文客户端的 8bit 头）
writeBytes('raw-gbk-subject.eml', {
  subjectBytes: gbk(GBK_SUBJECT),
  contentType: 'text/plain; charset=utf-8',
  bodyBytes: utf8('please confirm\r\n'),
})

// 8c) 声明 utf-8、正文其实是 GBK（导出工具写错 charset 的典型）
writeBytes('declared-utf8-but-gbk.eml', {
  subjectBytes: utf8('quote'),
  contentType: 'text/plain; charset=utf-8',
  bodyBytes: Buffer.concat([gbk(GBK_QUOTE_BODY), crlf('')]),
})

// 8d) 声明 gbk、正文其实是 UTF-8
writeBytes('declared-gbk-but-utf8.eml', {
  subjectBytes: utf8('quote'),
  contentType: 'text/plain; charset=gbk',
  bodyBytes: utf8('请在11月20日前确认报价。\r\n'),
})

// 8e) 完全没写 charset，正文是 GBK
writeBytes('no-charset-gbk-body.eml', {
  subjectBytes: utf8('quote'),
  contentType: 'text/plain',
  bodyBytes: Buffer.concat([gbk(GBK_QUOTE_BODY), crlf('')]),
})

// 8f) 附件文件名是原始 UTF-8 字节（不是 RFC 2047/2231）
writeBytes('raw-utf8-filename.eml', {
  subjectBytes: utf8('附件测试'),
  contentType: 'multipart/mixed; boundary="ENC1"',
  bodyBytes: Buffer.concat([
    crlf('--ENC1'),
    crlf('Content-Type: text/plain; charset=utf-8'),
    crlf(''),
    crlf('see attached'),
    crlf('--ENC1'),
    crlf('Content-Type: application/pdf'),
    Buffer.from('Content-Disposition: attachment; filename="', 'latin1'), utf8('附件：合同扫描件.pdf'), crlf('"'),
    crlf('Content-Transfer-Encoding: base64'),
    crlf(''),
    crlf(Buffer.from('%PDF-1.4 fake').toString('base64')),
    crlf('--ENC1--'),
    crlf(''),
  ]),
})

console.log('encoding fixtures written to', encDir)

// ── 9) 线程兜底样本：test/fixtures-subject/ ────────────────────
// 真导出里常见「没有 References / In-Reply-To，只有 Re: / 答复: 前缀」的对话。
// 这里放一串该合并的、一个不同客户的（不该合并）、一封跨窗口的（默认不该合并）。
const subjDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures-subject')
mkdirSync(subjDir, { recursive: true })

const subjEml = (file, { from, to, subject, date, body }) => writeFileSync(join(subjDir, file), joinLines([
  `From: ${from}`,
  `To: ${to}`,
  `Subject: ${subject}`,
  `Date: ${date}`,
  `Message-ID: <${file.replace(/[^a-z0-9]+/gi, '-')}@example.com>`,
  'Content-Type: text/plain; charset=utf-8',
  '',
  body,
]))

subjEml('a-vendor.eml', {
  from: 'vendor@example.cn', to: 'me@example.com',
  subject: '报价单确认', date: 'Mon, 02 Nov 2026 09:00:00 +0800',
  body: '请确认报价。',
})
subjEml('b-me.eml', {
  from: 'me@example.com', to: 'vendor@example.cn',
  subject: 'Re: 报价单确认', date: 'Tue, 03 Nov 2026 10:00:00 +0800',
  body: '收到，我看看。',
})
subjEml('c-vendor-reply.eml', {
  from: 'vendor@example.cn', to: 'me@example.com',
  subject: '答复: 报价单确认', date: 'Thu, 05 Nov 2026 11:00:00 +0800',
  body: '再确认一下。',
})
subjEml('d-other-customer.eml', {
  from: 'other@another.example', to: 'me@example.com',
  subject: '答复: 报价单确认', date: 'Wed, 04 Nov 2026 15:00:00 +0800',
  body: '这是另一个客户的同名报价单。',
})
subjEml('e-late.eml', {
  from: 'vendor@example.cn', to: 'me@example.com',
  subject: 'Re: 报价单确认', date: 'Mon, 01 Mar 2027 09:00:00 +0800',
  body: '隔了四个月再问一次。',
})
subjEml('f-fwd.eml', {
  from: 'me@example.com', to: 'vendor@example.cn',
  subject: 'Fwd: [外部] Re: 报价单确认', date: 'Fri, 06 Nov 2026 09:30:00 +0800',
  body: '转给同事看看。',
})

console.log('subject fixtures written to', subjDir)
