/**
 * plugin.test.mjs —— 假 ctx 加载，验工具注册名、参数、执行与 root 守卫。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import * as plugin from '../plugin.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const fixtures = join(here, 'fixtures')
const subjFixtures = join(here, 'fixtures-subject')

/** 最小假 ctx：记录注册的 tool。 */
function makeCtx() {
  const registered = []
  return {
    tools: { register: (def) => registered.push(def) },
    logger: { info: () => {} },
    registered,
  }
}

test('apply：注册且只注册一个工具，名字是 dsh_mailbox', () => {
  const ctx = makeCtx()
  plugin.apply(ctx, {})
  assert.equal(ctx.registered.length, 1)
  assert.equal(ctx.registered[0].name, 'dsh_mailbox')
})

test('插件名与包名同源', async () => {
  const pkg = (await import('../package.json', { with: { type: 'json' } })).default
  assert.equal(plugin.name, pkg.name)
})

test('execute scan：返回只读标志与统计', async () => {
  const ctx = makeCtx()
  plugin.apply(ctx, {})
  const def = ctx.registered[0]
  const out = await def.execute({ action: 'scan', root: fixtures }, {})
  assert.equal(out.readOnly, true)
  assert.equal(out.stats.unique, 8)
  assert.equal(out.action, 'scan')
})

test('execute triage：返回 Markdown 与分组', async () => {
  const ctx = makeCtx()
  plugin.apply(ctx, {})
  const def = ctx.registered[0]
  const out = await def.execute({ action: 'triage', root: fixtures }, {})
  assert.equal(out.readOnly, true)
  assert.match(out.markdown, /邮件档案分诊/)
  assert.ok(out.groups.action.length >= 1)
})

test('execute triage brief：只给摘要', async () => {
  const ctx = makeCtx()
  plugin.apply(ctx, {})
  const def = ctx.registered[0]
  const out = await def.execute({ action: 'triage', root: fixtures, brief: true }, {})
  assert.equal(out.markdown, out.summary)
  assert.match(out.summary, /共 8 封/)
})

test('execute threads：返回线程数', async () => {
  const ctx = makeCtx()
  plugin.apply(ctx, {})
  const def = ctx.registered[0]
  const out = await def.execute({ action: 'threads', root: fixtures, top: 3 }, {})
  assert.ok(Array.isArray(out.threads))
  assert.ok(out.threads.length <= 3)
})

test('execute threads：主题兜底可开关，兜底后线程变少', async () => {
  const ctx = makeCtx()
  plugin.apply(ctx, {})
  const def = ctx.registered[0]
  const on = await def.execute({ action: 'threads', root: subjFixtures, top: 10 }, {})
  assert.match(on.summary, /兜底归并/)
  const off = await def.execute({ action: 'threads', root: subjFixtures, top: 10, windowDays: 0 }, {})
  assert.match(off.summary, /已关闭主题兜底/)
  assert.ok(off.threads.length > on.threads.length, '关掉兜底应该拆成更多线程')
})

test('execute export：返回 CSV 文本（不写文件），默认只导「要动的」', async () => {
  const ctx = makeCtx()
  plugin.apply(ctx, {})
  const def = ctx.registered[0]
  const out = await def.execute({ action: 'export', root: fixtures }, {})
  assert.equal(typeof out.csv, 'string')
  assert.ok(out.csv.startsWith('\uFEFF'), '默认带 BOM 给中文 Excel')
  assert.match(out.csv, /截止日/)
  assert.match(out.csv, /报价单截止/)
  assert.match(out.summary, /导出/)
})

test('execute export：--all 导出每一栏，bucket 非法要报错', async () => {
  const ctx = makeCtx()
  plugin.apply(ctx, {})
  const def = ctx.registered[0]
  const all = await def.execute({ action: 'export', root: fixtures, bucket: 'all' }, {})
  const lines = all.csv.split('\r\n').filter(Boolean)
  assert.equal(lines.length, 9, '表头 + 8 封')
  await assert.rejects(
    () => def.execute({ action: 'export', root: fixtures, bucket: 'nope' }, {}),
    /bucket/,
  )
})

test('execute attachments：识别 pdf', async () => {
  const ctx = makeCtx()
  plugin.apply(ctx, {})
  const def = ctx.registered[0]
  const out = await def.execute({ action: 'attachments', root: fixtures }, {})
  assert.ok(out.attachments.some(a => a.filename === 'contract.pdf'))
})

test('execute search：缺 query 报错', async () => {
  const ctx = makeCtx()
  plugin.apply(ctx, {})
  const def = ctx.registered[0]
  await assert.rejects(() => def.execute({ action: 'search', root: fixtures }, {}), /bad_query/)
})

test('execute：拒绝 / 作为 root', async () => {
  const ctx = makeCtx()
  plugin.apply(ctx, {})
  const def = ctx.registered[0]
  await assert.rejects(() => def.execute({ action: 'scan', root: '/' }, {}), /bad_root/)
})

test('execute：拒绝 home 作为 root（除非 allow_home）', async () => {
  const ctx = makeCtx()
  plugin.apply(ctx, {})
  const def = ctx.registered[0]
  await assert.rejects(
    () => def.execute({ action: 'scan', root: `/Users/${process.env.USER || 'x'}` }, {}),
    /bad_root/,
  )
})

test('execute：缺 root 时报错', async () => {
  const ctx = makeCtx()
  plugin.apply(ctx, {})
  const def = ctx.registered[0]
  await assert.rejects(() => def.execute({ action: 'scan' }, {}), /bad_root/)
})

test('execute：未知 action 报错', async () => {
  const ctx = makeCtx()
  plugin.apply(ctx, {})
  const def = ctx.registered[0]
  await assert.rejects(() => def.execute({ action: 'nope', root: fixtures }, {}), /bad_action/)
})

test('配置默认值生效：config.root 被使用', async () => {
  const ctx = makeCtx()
  plugin.apply(ctx, { root: fixtures })
  const def = ctx.registered[0]
  const out = await def.execute({ action: 'scan' }, {})
  assert.equal(out.stats.unique, 8)
})
