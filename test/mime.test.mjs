/**
 * mime.test.mjs —— 解析器单测：编码、折行、multipart、附件、mbox。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  decodeRFC2047, parseHeaders, parseParamHeader,
  decodeTransfer, splitMultipart, htmlToText, parseMessage, splitMbox,
} from '../lib/mime.mjs'

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const read = (f) => readFileSync(join(fixtures, f))

test('decodeRFC2047：B 编码 UTF-8 中文', () => {
  const enc = Buffer.from('项目确认', 'utf8').toString('base64')
  assert.equal(decodeRFC2047(`=?UTF-8?B?${enc}?=`), '项目确认')
})

test('decodeRFC2047：Q 编码下划线转空格、=XX 转字节', () => {
  // =?utf-8?Q?hello_world?= → hello world
  assert.equal(decodeRFC2047('=?utf-8?Q?hello_world?='), 'hello world')
})

test('decodeRFC2047：GBK 编码字能解出中文', () => {
  // '报价单截止' 的 GBK base64
  assert.equal(decodeRFC2047('=?GBK?B?sai827WlvdjWuQ==?='), '报价单截止')
})

test('decodeRFC2047：不含编码字时原样返回', () => {
  assert.equal(decodeRFC2047('plain subject'), 'plain subject')
  assert.equal(decodeRFC2047(''), '')
})

test('parseHeaders：折行续行会被接上', () => {
  const raw = 'Subject: a very long\r\n subject line\r\nFrom: x@y.z'
  const h = parseHeaders(raw)
  assert.equal(h.get('subject'), 'a very long subject line')
  assert.equal(h.get('from'), 'x@y.z')
})

test('parseHeaders：同名头合并', () => {
  const h = parseHeaders('Received: one\nReceived: two')
  assert.equal(h.get('received'), 'one, two')
})

test('parseParamHeader：引号内的分号不切分', () => {
  const { value, params } = parseParamHeader('multipart/mixed; boundary="a;b"; charset=utf-8')
  assert.equal(value, 'multipart/mixed')
  assert.equal(params.boundary, 'a;b')
  assert.equal(params.charset, 'utf-8')
})

test('decodeTransfer：base64 与 quoted-printable', () => {
  const b64 = Buffer.from('中文', 'utf8').toString('base64')
  assert.equal(decodeTransfer(Buffer.from(b64), 'base64').toString('utf8'), '中文')
  // QP：=E4=B8=AD=E6=96=87 是「中文」的 UTF-8 字节
  assert.equal(decodeTransfer(Buffer.from('=E4=B8=AD=E6=96=87'), 'quoted-printable').toString('utf8'), '中文')
})

test('decodeTransfer：未知编码原样返回', () => {
  const buf = Buffer.from('abc')
  assert.equal(decodeTransfer(buf, '').toString(), 'abc')
  assert.equal(decodeTransfer(buf, '7bit').toString(), 'abc')
})

test('splitMultipart：按 boundary 切段并丢弃结束符', () => {
  const body = '--B\nA: 1\n\nhello\n--B\nA: 2\n\nworld\n--B--\n'
  const parts = splitMultipart(body, 'B')
  assert.equal(parts.length, 2)
  assert.match(parts[0], /hello/)
  assert.match(parts[1], /world/)
})

test('htmlToText：去脚本、去标签、保留换行', () => {
  const html = '<html><body><script>evil()</script><p>第一段</p><br><p>第二段</p></body></html>'
  const t = htmlToText(html)
  assert.ok(!t.includes('evil'))
  assert.ok(t.includes('第一段'))
  assert.ok(t.includes('第二段'))
})

test('parseMessage：纯文本样本', () => {
  const m = parseMessage(read('basic.eml'))
  assert.equal(m.subject, 'Project kickoff')
  assert.match(m.from, /alice@example\.com/)
  assert.equal(m.messageId, '<basic-1@example.com>')
  assert.match(m.text, /start the project/)
})

test('parseMessage：multipart/alternative 取 base64 中文正文', () => {
  const m = parseMessage(read('multipart.eml'))
  assert.equal(m.subject, '项目确认')
  assert.match(m.from, /张三/)
  assert.match(m.text, /这是中文正文/)
  assert.ok(m.html.includes('<p>'))
})

test('parseMessage：GBK + quoted-printable', () => {
  const m = parseMessage(read('gbk.eml'))
  assert.equal(m.subject, '报价单截止')
  assert.match(m.text, /请在11月20日前确认报价/)
})

test('parseMessage：附件被识别且不混进正文', () => {
  const m = parseMessage(read('attachment.eml'))
  assert.equal(m.attachments.length, 1)
  assert.equal(m.attachments[0].filename, 'contract.pdf')
  assert.equal(m.attachments[0].contentType, 'application/pdf')
  assert.ok(m.attachments[0].bytes > 0)
  assert.match(m.text, /contract attached/)
  assert.ok(!m.text.includes('PDF-1.4'))
})

test('splitMbox：按 From 行切分', () => {
  const list = splitMbox(read('sample.mbox').toString('utf8'))
  assert.equal(list.length, 2)
  const first = parseMessage(list[0])
  const second = parseMessage(list[1])
  assert.equal(first.subject, 'First in mbox')
  assert.equal(second.subject, 'Deploy failed on staging')
})

test('parseMessage：缺 Message-ID 时 messageId 为 null（不编造）', () => {
  const m = parseMessage('From: a@b.c\nSubject: x\n\nbody')
  assert.equal(m.messageId, null)
  assert.equal(m.subject, 'x')
})
