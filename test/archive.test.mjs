/**
 * archive.test.mjs —— 目录加载、去重、日期解析、线程归并。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadArchive, groupThreads, parseDate, findMailFiles } from '../lib/archive.mjs'

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

test('findMailFiles：只收 .eml/.mbox/.mbx', async () => {
  const { files } = await findMailFiles(fixtures)
  assert.ok(files.every(f => /\.(eml|mbox|mbx)$/i.test(f)))
  assert.ok(files.length >= 8)
})

test('loadArchive：统计口径正确（去重 1 封）', async () => {
  const a = await loadArchive(fixtures)
  assert.equal(a.stats.total, 9, '9 封原始')
  assert.equal(a.stats.unique, 8, '去重后 8 封')
  assert.equal(a.stats.duplicates, 1)
  assert.equal(a.stats.attachments, 1)
  assert.equal(a.stats.files, 8)
})

test('loadArchive：去重保留首次出现，并记录重复文件', async () => {
  const a = await loadArchive(fixtures)
  const basic = a.messages.find(m => m.messageId === '<basic-1@example.com>')
  assert.ok(basic)
  assert.equal(basic.duplicateFiles.length, 1)
  assert.match(basic.duplicateFiles[0], /dup-basic\.eml$/)
})

test('loadArchive：每条记录都带可回指的文件与序号', async () => {
  const a = await loadArchive(fixtures)
  for (const m of a.messages) {
    assert.ok(m.file, 'file 必须有')
    assert.equal(typeof m.indexInFile, 'number')
  }
})

test('parseDate：RFC5322 与常见变体', () => {
  assert.equal(parseDate('Mon, 17 Nov 2026 09:00:00 +0800'), '2026-11-17T01:00:00.000Z')
  assert.equal(parseDate('17 Nov 2026 09:00:00 +0800'), '2026-11-17T01:00:00.000Z')
  assert.equal(parseDate('2026-11-17 09:00:00 +0800'), '2026-11-17T01:00:00.000Z')
})

test('parseDate：解析不出返回 null，不猜', () => {
  assert.equal(parseDate('not a date'), null)
  assert.equal(parseDate(''), null)
  assert.equal(parseDate(null), null)
})

test('groupThreads：回复被归到根线程', async () => {
  const a = await loadArchive(fixtures)
  const threads = groupThreads(a.messages)
  const q4 = threads.find(t => t.messages.some(m => m.messageId === '<thread-root@example.com>'))
  assert.ok(q4, '应找到 Q4 线程')
  assert.equal(q4.count, 2)
  assert.equal(q4.messages[0].messageId, '<thread-root@example.com>')
  assert.equal(q4.messages[1].messageId, '<thread-reply@example.com>')
})

test('groupThreads：无引用关系的各成一线程', async () => {
  const a = await loadArchive(fixtures)
  const threads = groupThreads(a.messages)
  assert.ok(threads.length >= 7)
})
