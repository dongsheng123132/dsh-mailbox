/**
 * report.mjs —— 把分诊结果渲染成 Markdown / 纯文本。
 *
 * 原则：人先看「要动的」，再看「坏的」，其余一行带过。
 * 每条结论末尾带文件路径，用户质疑时能当场翻开。
 */

import { bucketLabel } from './triage.mjs'

function fmtDate(iso) {
  if (!iso) return '日期未知'
  return iso.slice(0, 10)
}

function shortPath(p) {
  // 只保留末两段，避免长路径刷屏
  const parts = String(p).split('/')
  return parts.slice(-2).join('/')
}

function clip(s, n = 90) {
  const t = String(s || '').replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}

/**
 * 生成 Markdown 报告。
 * @param {{stats: object, groups: object}} result 分诊结果
 * @param {{root: string, now: Date, topN?: number}} opts 选项
 * @returns {string}
 */
export function renderMarkdown(result, opts) {
  const { stats, groups } = result
  const now = opts.now || new Date()
  const topN = opts.topN ?? 20
  const L = []

  L.push('# 邮件档案分诊')
  L.push('')
  L.push(`> 目录：\`${opts.root}\` · 生成于 ${now.toISOString().replace('T', ' ').slice(0, 19)} UTC`)
  L.push('')
  L.push('## 先看数字')
  L.push('')
  L.push('| 项 | 数量 |')
  L.push('|---|---|')
  L.push(`| 文件 | ${stats.files} |`)
  L.push(`| 邮件总数（去重前） | ${stats.total} |`)
  L.push(`| 去重后 | ${stats.unique} |`)
  L.push(`| 重复 | ${stats.duplicates} |`)
  L.push(`| 附件 | ${stats.attachments} |`)
  L.push(`| 日期范围 | ${fmtDate(stats.earliest)} ~ ${fmtDate(stats.latest)} |`)
  L.push('')

  const show = (bucket, limit = topN) => {
    const items = groups[bucket] || []
    if (!items.length) return
    L.push(`## ${bucketLabel(bucket)}（${items.length}）`)
    L.push('')
    const hasDeadline = items.some(i => i.deadline?.iso)
    if (hasDeadline) {
      L.push('| 截止 | 主题 | 发件人 | 来源文件 |')
      L.push('|---|---|---|---|')
      for (const m of items.slice(0, limit)) {
        const due = m.deadline?.iso
          ? `${m.deadline.iso}${typeof m.deadline.daysLeft === 'number' ? `（${m.deadline.daysLeft >= 0 ? '剩' : '已过'} ${Math.abs(m.deadline.daysLeft)} 天）` : ''}`
          : '—'
        L.push(`| ${due} | ${clip(m.subject, 60)} | ${clip(m.from, 32)} | \`${shortPath(m.file)}#${m.indexInFile}\` |`)
      }
    } else {
      L.push('| 主题 | 发件人 | 来源文件 |')
      L.push('|---|---|---|')
      for (const m of items.slice(0, limit)) {
        L.push(`| ${clip(m.subject, 60)} | ${clip(m.from, 32)} | \`${shortPath(m.file)}#${m.indexInFile}\` |`)
      }
    }
    if (items.length > limit) L.push(`\n> 其余 ${items.length - limit} 封略；用 \`--top ${items.length}\` 看全。`)
    L.push('')
  }

  show('action')
  show('red')
  show('opportunity', 10)
  show('good', 10)

  const notify = groups.notify || []
  if (notify.length) {
    L.push(`## ${bucketLabel('notify')}（${notify.length}）`)
    L.push('')
    L.push(`一行带过：${notify.slice(0, 5).map(m => clip(m.subject, 30)).join(' / ')}${notify.length > 5 ? ' …' : ''}`)
    L.push('')
  }

  // 编码问题要说出来，不能静默
  const withIssues = (result.all || []).filter(m => m.charsetIssues?.length)
  if (withIssues.length) {
    L.push('## 编码告警')
    L.push('')
    L.push(`有 ${withIssues.length} 封在解码时出现替换字符，正文可能不完整：`)
    for (const m of withIssues.slice(0, 5)) {
      L.push(`- \`${shortPath(m.file)}#${m.indexInFile}\`：${m.charsetIssues[0]}`)
    }
    L.push('')
  }

  return L.join('\n')
}

/**
 * 一条命令能读的精简版（给人扫一眼）。
 * @param {{stats: object, groups: object}} result 分诊结果
 * @returns {string}
 */
export function renderBrief(result) {
  const { stats, groups } = result
  const lines = []
  lines.push(`共 ${stats.unique} 封（去重 ${stats.duplicates}，附件 ${stats.attachments}），${fmtDate(stats.earliest)} ~ ${fmtDate(stats.latest)}`)
  for (const b of ['action', 'red', 'opportunity', 'good']) {
    const n = (groups[b] || []).length
    if (n) lines.push(`${bucketLabel(b)} ${n}`)
  }
  const top = (groups.action || []).slice(0, 5)
  if (top.length) {
    lines.push('')
    lines.push('先看这几封：')
    for (const m of top) {
      const due = m.deadline?.iso ? `[${m.deadline.iso}] ` : ''
      lines.push(`- ${due}${clip(m.subject, 50)} — ${clip(m.from, 28)}`)
    }
  }
  return lines.join('\n')
}
