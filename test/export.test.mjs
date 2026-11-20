/**
 * export.test.mjs —— 导出 CSV 待办表。
 *
 * 两条不能让步的：
 *  - 只输出文本，不写文件（本包底线；落盘交给用户重定向）。
 *  - Excel 打开不能串行：逗号/引号/换行要转义，以 = + - @ 开头的字符串要防公式注入。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { csvCell, renderCsv, buildExport, EXPORT_COLUMNS } from '../lib/export.mjs'
import { loadArchive } from '../lib/archive.mjs'
import { triageAll } from '../lib/triage.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const cli = join(here, '..', 'lib', 'cli.mjs')
const fixtures = join(here, 'fixtures')
const NOW = new Date('2026-11-19T00:00:00Z')

function run(args) {
  const r = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' })
  return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}

/** 极简 CSV 解析（只处理本包会产出的形状），用来验证转义能被读回来。 */
function parseCsvLine(line) {
  const out = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (c === '"') quoted = false
      else cur += c
    } else if (c === '"') quoted = true
    else if (c === ',') { out.push(cur); cur = '' }
    else cur += c
  }
  out.push(cur)
  return out
}

test('csvCell：逗号/引号/换行会被包起来并可读回', () => {
  assert.equal(parseCsvLine(csvCell('a,b'))[0], 'a,b')
  assert.equal(parseCsvLine(csvCell('他说"好"'))[0], '他说"好"')
  assert.equal(parseCsvLine(csvCell('第一行\n第二行'))[0], '第一行\n第二行')
  assert.equal(csvCell('普通'), '普通')
})

test('csvCell：= + - @ 开头的字符串防 Excel 公式注入，数字不受影响', () => {
  assert.equal(csvCell('=1+1'), "'=1+1")
  assert.equal(csvCell('+86 138'), "'+86 138")
  assert.equal(csvCell('@here'), "'@here")
  assert.equal(csvCell(-1), '-1', '数字列不该被加前缀')
})

test('renderCsv：表头固定且行数正确', () => {
  const csv = renderCsv([
    { 截止日: '2026-11-20', 主题: '报价单' },
    { 截止日: '', 主题: '闲聊' },
  ], { bom: false })
  const lines = csv.split('\r\n').filter(Boolean)
  assert.equal(lines[0], EXPORT_COLUMNS.join(','))
  assert.equal(lines.length, 3)
})

test('buildExport：默认只导「要动的」，按截止日升序、无截止日排最后', async () => {
  const a = await loadArchive(fixtures)
  const { groups } = triageAll(a.messages, NOW)
  const { rows, csv } = buildExport(groups, { root: fixtures, now: NOW })
  assert.equal(rows.length, groups.action.length)
  const withDue = rows.filter(r => r['截止日'])
  const noDue = rows.filter(r => !r['截止日'])
  assert.equal(rows.slice(0, withDue.length).length, withDue.length, '有截止日的排前面')
  assert.equal(rows.slice(withDue.length).length, noDue.length)
  for (let i = 1; i < withDue.length; i++) {
    assert.ok(withDue[i - 1]['截止日'] <= withDue[i]['截止日'], '截止日升序')
  }
  assert.match(csv, /报价单截止/)
})

test('buildExport：--all 带上每一栏，栏列写中文名', async () => {
  const a = await loadArchive(fixtures)
  const { groups } = triageAll(a.messages, NOW)
  const { rows } = buildExport(groups, { root: fixtures, now: NOW, bucket: 'all' })
  assert.equal(rows.length, a.messages.length, 'all 要把每封都导出')
  const buckets = new Set(rows.map(r => r['栏']))
  assert.ok(buckets.size >= 2, '至少有两栏')
  assert.ok([...buckets].every(b => /要动的|坏的|好的|机会|通知/.test(b)))
})

test('buildExport：来源列是相对路径 + 序号，能回指原文', async () => {
  const a = await loadArchive(fixtures)
  const { groups } = triageAll(a.messages, NOW)
  const { rows } = buildExport(groups, { root: fixtures, now: NOW, bucket: 'all' })
  assert.ok(rows.every(r => /#\d+$/.test(r['来源'])), '来源要带 #序号')
  assert.ok(rows.every(r => !r['来源'].startsWith('/')), '来源不要绝对路径')
  assert.ok(rows.some(r => r['来源'] === 'gbk.eml#0'))
})

test('cli export：默认带 BOM、含表头、可被 Excel 认出中文', () => {
  const r = run(['export', fixtures])
  assert.equal(r.status, 0)
  assert.ok(r.stdout.startsWith('\uFEFF'), '默认要带 BOM，否则 Excel 打开中文是乱码')
  assert.match(r.stdout, new RegExp(EXPORT_COLUMNS.join(',')))
  assert.match(r.stdout, /报价单截止/)
})

test('cli export --no-bom：不带 BOM', () => {
  const r = run(['export', fixtures, '--no-bom'])
  assert.equal(r.status, 0)
  assert.ok(!r.stdout.startsWith('\uFEFF'))
})

test('cli export --all --json：机读形状', () => {
  const r = run(['export', fixtures, '--all', '--json'])
  assert.equal(r.status, 0)
  const j = JSON.parse(r.stdout)
  assert.ok(Array.isArray(j.rows))
  assert.equal(j.rows.length, 8)
  assert.ok(j.csv.includes('来源'))
})
