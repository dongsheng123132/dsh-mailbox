/**
 * threads.test.mjs —— 线程归并：引用优先，没有引用时按「主题 + 时间窗 + 联系人」兜底。
 *
 * 为什么要兜底：真导出里大量回复没有 References / In-Reply-To（有的导出工具直接丢掉），
 * 只剩 `Re:` / `答复:` 前缀。只认引用头的话，一段对话会被读成好几件互不相干的事。
 * 兜底必须保守：同主题但不同客户、或隔了好几个月，都不合并。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadArchive, groupThreads, normalizeSubject } from '../lib/archive.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const subjFixtures = join(here, 'fixtures-subject')
const refFixtures = join(here, 'fixtures')

const bySize = (threads) => [...threads].sort((a, b) => b.count - a.count)

test('normalizeSubject：剥掉多层 Re:/Fwd:/答复:/[外部] 前缀', () => {
  assert.equal(normalizeSubject('Re: 报价单确认'), '报价单确认')
  assert.equal(normalizeSubject('答复: 报价单确认'), '报价单确认')
  assert.equal(normalizeSubject('Fwd: [外部] Re: 报价单确认'), '报价单确认')
  assert.equal(normalizeSubject('Re:Re:Re: hello'), 'hello')
  assert.equal(normalizeSubject('  Re:   Q4   planning '), 'q4 planning')
  assert.equal(normalizeSubject(''), '')
})

test('groupThreads：没有引用头的对话按主题+时间窗串成一条', async () => {
  const a = await loadArchive(subjFixtures)
  const threads = groupThreads(a.messages)
  const biggest = bySize(threads)[0]
  assert.equal(biggest.count, 4, 'a/b/c/f 四封应归为一条线程')
  assert.equal(biggest.via, 'subject', '要标出这条是靠主题兜底归并的')
  const subjects = biggest.messages.map(m => m.subject)
  assert.ok(subjects.some(s => /报价单确认/.test(s)))
})

test('groupThreads：同主题但不同客户（除邮箱主人外无共同联系人）不合并', async () => {
  const a = await loadArchive(subjFixtures)
  const threads = groupThreads(a.messages)
  const other = threads.find(t => t.messages.some(m => m.from.includes('another.example')))
  assert.ok(other, '另一个客户的邮件要单独成线程')
  assert.equal(other.count, 1)
})

test('groupThreads：超出时间窗不合并，放宽窗口才合并', async () => {
  const a = await loadArchive(subjFixtures)
  const strict = groupThreads(a.messages)
  const late = strict.find(t => t.messages.some(m => m.dateIso?.startsWith('2027-03-01')))
  assert.ok(late, '隔了四个月的回复默认要单独成线程')
  assert.equal(late.count, 1)

  const loose = groupThreads(a.messages, { windowDays: 200 })
  const merged = bySize(loose)[0]
  assert.equal(merged.count, 5, '放宽到 200 天后 a/b/c/f + e 应合成一条')
})

test('groupThreads：有引用头时仍以引用为准，via=references', async () => {
  const a = await loadArchive(refFixtures)
  const threads = groupThreads(a.messages)
  const q4 = threads.find(t => t.messages.some(m => m.messageId === '<thread-root@example.com>'))
  assert.equal(q4.count, 2)
  assert.equal(q4.via, 'references')
})

test('groupThreads：同主题但引用到不同根的两封不合并（引用优先于主题）', () => {
  const mk = (id, subject, parent, dateIso) => ({
    messageId: id, syntheticId: `synth:${id}`, subject, from: 'a@x.cn', to: 'me@x.cn',
    inReplyTo: parent, references: parent ? [parent] : [], dateIso,
    text: '', attachments: [], file: '/tmp/x.eml', indexInFile: 0,
  })
  const list = [
    mk('<r1@x>', '报价单', null, '2026-11-01T00:00:00.000Z'),
    mk('<r2@x>', '另一件事', null, '2026-11-01T01:00:00.000Z'),
    mk('<c1@x>', 'Re: 报价单', '<r1@x>', '2026-11-02T00:00:00.000Z'),
    mk('<c2@x>', 'Re: 报价单', '<r2@x>', '2026-11-02T01:00:00.000Z'),
  ]
  const threads = groupThreads(list)
  assert.equal(threads.length, 2, '两串对话即使主题归一后相同，也要跟着各自的引用根走')
})
