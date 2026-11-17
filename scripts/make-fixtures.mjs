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
