/**
 * encoding.test.mjs —— 真实世界的乱码样本：8bit 头、写错的 charset、没写 charset。
 *
 * 样本在 test/fixtures-encoding/，由 scripts/make-fixtures.mjs 按**字节**生成
 * （GBK 字节用 iconv 预生成），不是手敲的乱码字符串——手敲的样本测不出「按字节猜」。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseMessage, decodeHeaderValue } from '../lib/mime.mjs'
import { loadArchive } from '../lib/archive.mjs'
import { classify } from '../lib/triage.mjs'

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures-encoding')
const read = (f) => readFileSync(join(fixtures, f))

test('主题是原始 UTF-8 字节（没做 RFC 2047）→ 不乱码', () => {
  const m = parseMessage(read('raw-utf8-subject.eml'))
  assert.equal(m.subject, '报价单确认')
})

test('主题是原始 GBK 字节（8bit 头）→ 不乱码', () => {
  const m = parseMessage(read('raw-gbk-subject.eml'))
  assert.equal(m.subject, '报价单确认')
})

test('声明 utf-8 实际 GBK 的正文 → 按 GBK 解出并说明', () => {
  const m = parseMessage(read('declared-utf8-but-gbk.eml'))
  assert.match(m.text, /请在11月20日前确认报价/)
  assert.ok(m.charsetIssues.some(s => /GBK|gbk/.test(s)), '要说清实际用了什么字符集')
})

test('声明 gbk 实际 UTF-8 的正文 → 按 UTF-8 解出（GBK 也能「解成功」但那是乱码）', () => {
  const m = parseMessage(read('declared-gbk-but-utf8.eml'))
  assert.match(m.text, /请在11月20日前确认报价/)
})

test('没写 charset 的 GBK 正文 → 也能解出', () => {
  const m = parseMessage(read('no-charset-gbk-body.eml'))
  assert.match(m.text, /请在11月20日前确认报价/)
})

test('附件文件名是原始 UTF-8 字节 → 不乱码', () => {
  const m = parseMessage(read('raw-utf8-filename.eml'))
  assert.equal(m.attachments.length, 1)
  assert.equal(m.attachments[0].filename, '附件：合同扫描件.pdf')
})

test('decodeHeaderValue：真的 Latin-1 重音字母不被误改', () => {
  const latin1 = Buffer.from('Café résumé', 'latin1').toString('latin1')
  assert.equal(decodeHeaderValue(latin1), 'Café résumé')
})

test('loadArchive：乱码修好后，截止日能抽出来（分诊不再漏判）', async () => {
  const a = await loadArchive(fixtures)
  const m = a.messages.find(x => x.file.endsWith('declared-utf8-but-gbk.eml'))
  assert.ok(m, '样本要被读进来')
  const c = classify(m, new Date('2025-11-19T00:00:00Z'))
  assert.equal(c.deadline?.iso, '2025-11-20')
  assert.equal(c.needsReply, true)
})

test('decodeHeaderValue：拉丁字母不在「猜字符集」里被误判成汉字', () => {
  // =?ISO-8859-1?Q?=E9=E9?= 解出来是真 Unicode 的「éé」，不该按 GBK 改判
  assert.equal(decodeHeaderValue('=?ISO-8859-1?Q?=E9=E9?='), 'éé')
})
