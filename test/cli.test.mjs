/**
 * cli.test.mjs —— 真跑进程，验退出码、输出形状、只读性。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { statSync } from 'node:fs'

const here = dirname(fileURLToPath(import.meta.url))
const cli = join(here, '..', 'lib', 'cli.mjs')
const fixtures = join(here, 'fixtures')

function run(args) {
  const r = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' })
  return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}

test('cli scan：输出统计', () => {
  const r = run(['scan', fixtures])
  assert.equal(r.status, 0)
  assert.match(r.stdout, /文件 8/)
  assert.match(r.stdout, /去重后 8/)
})

test('cli scan --json：合法 JSON', () => {
  const r = run(['scan', fixtures, '--json'])
  assert.equal(r.status, 0)
  const j = JSON.parse(r.stdout)
  assert.equal(j.unique, 8)
  assert.equal(j.duplicates, 1)
})

test('cli triage：含四栏中文标题', () => {
  const r = run(['triage', fixtures])
  assert.equal(r.status, 0)
  assert.match(r.stdout, /邮件档案分诊/)
  assert.match(r.stdout, /要动的/)
})

test('cli triage --json：分组可解析', () => {
  const r = run(['triage', fixtures, '--json'])
  assert.equal(r.status, 0)
  const j = JSON.parse(r.stdout)
  assert.ok(Array.isArray(j.groups.action))
  assert.ok(j.groups.action.length >= 1)
})

test('cli triage --brief：简短版', () => {
  const r = run(['triage', fixtures, '--brief'])
  assert.equal(r.status, 0)
  assert.match(r.stdout, /共 8 封/)
})

test('cli threads：归并出 Q4 线程', () => {
  const r = run(['threads', fixtures])
  assert.equal(r.status, 0)
  assert.match(r.stdout, /Q4 planning/)
})

test('cli attachments：列出 contract.pdf', () => {
  const r = run(['attachments', fixtures])
  assert.equal(r.status, 0)
  assert.match(r.stdout, /contract\.pdf/)
})

test('cli search：命中关键词', () => {
  const r = run(['search', fixtures, '--q', 'deploy'])
  assert.equal(r.status, 0)
  assert.match(r.stdout, /命中/)
  assert.match(r.stdout, /Deploy failed/)
})

test('cli：缺目录参数退出 1', () => {
  const r = run(['scan'])
  assert.equal(r.status, 1)
})

test('cli：目录不存在退出 2', () => {
  const r = run(['scan', '/definitely/not/here'])
  assert.equal(r.status, 2)
})

test('cli：空目录退出 3', () => {
  const r = run(['scan', join(here, '..', 'lib')])
  assert.equal(r.status, 3)
})

test('cli：未知动作退出 1', () => {
  const r = run(['nope', fixtures])
  assert.equal(r.status, 1)
})

test('cli：只读——跑完 fixture 文件 mtime 不变', () => {
  const target = join(fixtures, 'basic.eml')
  const before = statSync(target).mtimeMs
  run(['triage', fixtures])
  const after = statSync(target).mtimeMs
  assert.equal(before, after)
})
