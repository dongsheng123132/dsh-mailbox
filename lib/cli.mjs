#!/usr/bin/env node
/**
 * cli.mjs —— dsh-mailbox 的命令行入口。
 *
 * 动作：
 *   scan <dir>          清点：文件数、邮件数、去重、日期范围、附件
 *   triage <dir>        四栏分诊（默认 Markdown；--json 机读）
 *   threads <dir>       按线程归并，列出最长的对话
 *   attachments <dir>   附件盘点（类型、大小、出现次数）
 *   search <dir> --q X  在主题/正文/发件人里搜
 *
 * 退出码：0 成功；1 参数错误；2 目录不可读；3 没找到邮件文件。
 */

import { resolve } from 'node:path'
import { stat } from 'node:fs/promises'
import { loadArchive, groupThreads } from './archive.mjs'
import { triageAll, bucketLabel } from './triage.mjs'
import { renderMarkdown, renderBrief } from './report.mjs'

const args = process.argv.slice(2)
const cmd = args[0]
const rest = args.slice(1)

function flag(name, def = null) {
  const i = rest.indexOf(name)
  if (i < 0) return def
  return rest[i + 1] ?? true
}
const has = n => rest.includes(n)

function usage() {
  console.log(`dsh-mailbox — 离线邮件档案工作台

用法：
  dsh-mailbox scan <dir>                 清点档案
  dsh-mailbox triage <dir> [--json]      四栏分诊
  dsh-mailbox threads <dir> [--top 10] [--window 30]  线程归并
  dsh-mailbox attachments <dir>          附件盘点
  dsh-mailbox search <dir> --q <词>      搜索

只读：不改任何原文件。`)
}

function dirArg() {
  const d = rest.find(a => !a.startsWith('--'))
  return d ? resolve(d) : null
}

async function main() {
  if (!cmd || cmd === '-h' || cmd === '--help' || cmd === 'help') { usage(); return 0 }
  const dir = dirArg()
  if (!dir) { console.error('缺少目录参数'); usage(); return 1 }

  let archive
  try {
    const st = await stat(dir)
    if (!st.isDirectory()) {
      console.error(`不是目录：${dir}`)
      return 2
    }
    archive = await loadArchive(dir)
  } catch (e) {
    console.error(`目录不可读：${dir}（${e.code || e.message}）`)
    return 2
  }
  if (!archive.files.length) {
    console.error(`没有找到 .eml / .mbox 文件：${dir}`)
    return 3
  }

  if (cmd === 'scan') {
    const s = archive.stats
    if (has('--json')) {
      console.log(JSON.stringify(s, null, 2))
    } else {
      console.log(`文件 ${s.files} · 邮件 ${s.total} · 去重后 ${s.unique} · 重复 ${s.duplicates} · 附件 ${s.attachments}`)
      console.log(`日期范围 ${s.earliest?.slice(0, 10) || '未知'} ~ ${s.latest?.slice(0, 10) || '未知'}`)
      if (s.skipped.length) {
        console.log('')
        console.log(`跳过 ${s.skipped.length} 项：`)
        for (const k of s.skipped.slice(0, 5)) console.log(`- ${k.path}: ${k.reason}`)
      }
    }
    return 0
  }

  const now = new Date()

  if (cmd === 'triage') {
    const result = triageAll(archive.messages, now)
    const merged = { ...result, stats: archive.stats }
    if (has('--json')) {
      console.log(JSON.stringify({
        stats: archive.stats,
        groups: Object.fromEntries(Object.entries(result.groups).map(([k, v]) => [k, v.map(m => ({
          file: m.file, index: m.indexInFile, subject: m.subject, from: m.from,
          date: m.dateIso, bucket: m.bucket, score: m.score,
          deadline: m.deadline, needsReply: m.needsReply, matched: m.matched,
        }))])),
      }, null, 2))
    } else if (has('--brief')) {
      console.log(renderBrief(merged))
    } else {
      console.log(renderMarkdown(merged, { root: dir, now, topN: Number(flag('--top', 20)) }))
    }
    return 0
  }

  if (cmd === 'threads') {
    // --window 0 关闭「主题 + 时间窗」兜底，只看 References / In-Reply-To
    const windowDays = Number(flag('--window', 30))
    if (!Number.isFinite(windowDays) || windowDays < 0) { console.error('--window 需要 ≥ 0 的天数'); return 1 }
    const threads = groupThreads(archive.messages, { windowDays })
    const top = Number(flag('--top', 10))
    const mergedThreads = threads.filter(t => t.subjectMerged).length
    const longest = threads.reduce((n, t) => Math.max(n, t.count), 0)
    console.log(`共 ${threads.length} 个线程，最长 ${longest} 封` +
      (windowDays > 0 ? `（其中 ${mergedThreads} 个含没有引用头的回复，按主题+${windowDays}天窗兜底归并）` : '（已关闭主题兜底）'))
    console.log('')
    for (const t of threads.slice(0, top)) {
      const first = t.messages[0]
      const tag = t.subjectMerged ? '·主题兜底' : ''
      console.log(`[${t.count} 封${tag}] ${first?.subject || '(无主题)'} — ${first?.from || '?'}`)
      console.log(`        最后 ${t.lastDate?.slice(0, 10) || '日期未知'} · ${t.messages.at(-1)?.file || ''}`)
    }
    return 0
  }

  if (cmd === 'attachments') {
    const counts = new Map()
    let total = 0
    let bytes = 0
    for (const m of archive.messages) {
      for (const a of m.attachments) {
        total++
        bytes += a.bytes || 0
        const key = `${a.contentType}|${a.filename}`
        const cur = counts.get(key) || { ...a, count: 0 }
        cur.count++
        counts.set(key, cur)
      }
    }
    if (!total) { console.log('没有附件'); return 0 }
    const rows = [...counts.values()].sort((a, b) => b.bytes - a.bytes)
    console.log(`附件 ${total} 个（去重后 ${rows.length} 种），合计 ${(bytes / 1024 / 1024).toFixed(2)} MB`)
    console.log('')
    for (const r of rows.slice(0, 20)) {
      console.log(`${String((r.bytes / 1024).toFixed(0)).padStart(8)} KB  ${String(r.count).padStart(3)}×  ${r.contentType.padEnd(28)} ${r.filename}`)
    }
    return 0
  }

  if (cmd === 'search') {
    const q = String(flag('--q', '') || '').toLowerCase()
    if (!q) { console.error('缺少 --q <关键词>'); return 1 }
    const hits = archive.messages.filter(m =>
      `${m.subject}\n${m.text}\n${m.from}\n${m.to}`.toLowerCase().includes(q))
    console.log(`命中 ${hits.length} 封`)
    for (const m of hits.slice(0, 30)) {
      console.log(`- ${m.dateIso?.slice(0, 10) || '?'} ${m.subject.slice(0, 60)} — ${m.from.slice(0, 30)}`)
      console.log(`  ${m.file}#${m.indexInFile}`)
    }
    return 0
  }

  console.error(`未知动作：${cmd}`)
  usage()
  return 1
}

main().then(code => process.exit(code)).catch(e => {
  console.error(e?.stack || String(e))
  process.exit(1)
})
