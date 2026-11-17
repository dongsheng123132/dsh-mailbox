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
