/**
 * triage.test.mjs —— 四栏分诊、截止日抽取、自动发件人识别。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { classify, triageAll, extractDeadline, isAutomated, bucketLabel } from '../lib/triage.mjs'

const NOW = new Date('2026-11-21T12:00:00Z')

function msg(over = {}) {
  return {
    subject: 'hello', from: 'person@example.com', to: 'me@example.com',
    text: '', dateIso: '2026-11-20T00:00:00.000Z', attachments: [],
    file: '/tmp/x.eml', indexInFile: 0, ...over,
  }
}

test('isAutomated：识别 noreply / github 等自动发件人', () => {
  assert.equal(isAutomated(msg({ from: 'noreply@github.com' })), true)
  assert.equal(isAutomated(msg({ from: 'notifications@vercel.com' })), true)
  assert.equal(isAutomated(msg({ from: 'Alice <alice@example.com>' })), false)
})

test('extractDeadline：YYYY-MM-DD', () => {
  const d = extractDeadline(msg({ text: 'please reply by 2026-11-25' }), NOW)
  assert.equal(d.iso, '2026-11-25')
  assert.equal(d.raw, '2026-11-25')
})

test('extractDeadline：中文月日', () => {
  const d = extractDeadline(msg({ text: '请在11月20日前确认' }), NOW)
  assert.equal(d.iso, '2026-11-20')
})

test('extractDeadline：英文月日', () => {
  const d = extractDeadline(msg({ text: 'due on Nov 24, 2026' }), NOW)
  assert.equal(d.iso, '2026-11-24')
})

test('extractDeadline：没有截止日返回 null', () => {
  assert.equal(extractDeadline(msg({ text: 'just saying hi' }), NOW), null)
})

test('classify：有人在等回复 → action', () => {
  const c = classify(msg({ text: 'Could you review the draft?' }), NOW)
  assert.equal(c.bucket, 'action')
  assert.equal(c.needsReply, true)
})

test('classify：失败告警 → red', () => {
  const c = classify(msg({ text: 'The deploy failed with error 500' }), NOW)
  assert.equal(c.bucket, 'red')
})

test('classify：机会类 → opportunity', () => {
  const c = classify(msg({ from: 'someone@real.com', text: 'We would like to invite you to speak at our event' }), NOW)
  assert.equal(c.bucket, 'opportunity')
})

test('classify：成功通知 → good', () => {
  const c = classify(msg({ text: 'Your build completed successfully' }), NOW)
  assert.equal(c.bucket, 'good')
})

test('classify：自动发件人不会被判成 action（避免制造噪音）', () => {
  const c = classify(msg({ from: 'noreply@github.com', text: 'please do not reply, action required' }), NOW)
  assert.equal(c.needsReply, false)
  assert.notEqual(c.bucket, 'action')
})

test('classify：临近截止日加分', () => {
  const near = classify(msg({ text: 'please confirm by 2026-11-22' }), NOW)
  const far = classify(msg({ text: 'please confirm by 2026-12-30' }), NOW)
  assert.ok(near.score > far.score, '3 天内应比 1 个月后分高')
})

test('classify：已过期仍给基础分并标注负天数', () => {
  const c = classify(msg({ text: 'please reply by 2026-11-01' }), NOW)
  assert.equal(c.deadline.daysLeft < 0, true)
})

test('triageAll：五栏齐全且 action 按截止日升序', () => {
  const list = [
    msg({ subject: 'A', text: 'please reply by 2026-12-01' }),
    msg({ subject: 'B', text: 'please reply by 2026-11-22' }),
    msg({ subject: 'C', text: 'please reply by 2026-11-25' }),
  ]
  const { groups } = triageAll(list, NOW)
  const dates = groups.action.map(m => m.deadline.iso)
  assert.deepEqual(dates, ['2026-11-22', '2026-11-25', '2026-12-01'])
})

// ── 截止日判据补强（0.1.1）────────────────────────────────
// 以下 6 条在 0.1.0 上全部失败，用于锁定「年份 / 点号日期 / 引用历史 / 邮件年推断」四类真实误判。

test('extractDeadline：中文「2026年11月20日」不能丢掉年份', () => {
  const d = extractDeadline(
    msg({ dateIso: '2025-11-28T00:00:00.000Z', text: '请于2026年11月20日前回复确认。' }),
    new Date('2025-12-01T00:00:00Z'),
  )
  assert.equal(d.iso, '2026-11-20')
  assert.equal(d.raw, '2026年11月20日')
})

test('extractDeadline：点号写法 2026.11.20', () => {
  const d = extractDeadline(msg({ text: '请在2026.11.20前提交。' }), NOW)
  assert.equal(d.iso, '2026-11-20')
})

test('extractDeadline：无年份日期按邮件日期推断，不按运行年', () => {
  // 2024 年的存档邮件，在 2026 年才分诊
  const d = extractDeadline(
    msg({ dateIso: '2024-11-18T00:00:00.000Z', text: '请在11月20日前确认报价' }),
    NOW,
  )
  assert.equal(d.iso, '2024-11-20')
})

test('extractDeadline：跨年无年份日期顺延到邮件年的下一年', () => {
  const d = extractDeadline(
    msg({ dateIso: '2025-12-20T00:00:00.000Z', text: '请在1月5日前回复' }),
    NOW,
  )
  assert.equal(d.iso, '2026-01-05')
})

test('extractDeadline：within N days / N天内 能算出具体日期', () => {
  const a = extractDeadline(msg({ dateIso: '2026-11-20T00:00:00.000Z', text: 'please reply within 5 days' }), NOW)
  assert.equal(a.iso, '2026-11-25')
  const b = extractDeadline(msg({ dateIso: '2026-11-20T00:00:00.000Z', text: '请在7天内反馈' }), NOW)
  assert.equal(b.iso, '2026-11-27')
})

test('classify：引用历史里的旧截止日不算这封的待办', () => {
  const text = '收到，今天处理完。\n\n-----原始邮件-----\n发件人: ops@example.cn\n请在2026-01-05前提交。'
  const c = classify(msg({ text }), NOW)
  assert.equal(c.deadline, null)
  assert.equal(c.needsReply, false)
  assert.notEqual(c.bucket, 'action')
})

test('classify：引用历史里的 error 不把已办结邮件打成 red', () => {
  const text = '好了，已恢复。\n\n> Deploy failed with error 500\n> 已修复'
  const c = classify(msg({ text }), NOW)
  assert.notEqual(c.bucket, 'red')
})

test('classify：主题里的截止日仍参与（转发也算自己的事）', () => {
  const c = classify(msg({ subject: 'Fwd: 报价单（11月24日前回复）', text: '见下。\n-----原始邮件-----\n旧内容' }), NOW)
  assert.equal(c.deadline?.iso, '2026-11-24')
})

test('classify：中文「请于…前回复」算在等你回复（不猜日期也不漏判）', () => {
  const c = classify(msg({ text: '请于下周三前回复确认。' }), NOW)
  assert.equal(c.needsReply, true)
  assert.equal(c.bucket, 'action')
  assert.equal(c.deadline, null, '不猜具体日期')
})

test('bucketLabel：中文栏名', () => {
  assert.equal(bucketLabel('action'), '要动的')
  assert.equal(bucketLabel('red'), '坏的')
  assert.equal(bucketLabel('unknown'), 'unknown')
})
