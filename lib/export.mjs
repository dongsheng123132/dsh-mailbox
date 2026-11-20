/**
 * export.mjs —— 把分诊结果导出成 CSV 待办表（Excel / Numbers / 飞书表格能直接打开）。
 *
 * 为什么只输出文本、不写文件：本包的红线是「只读档案、不动盘上任何东西」，
 * 自检脚本会拦「写文件」一类调用（连注释里的字面量都会拦）。落盘交给用户自己重定向：
 *
 *   dsh-mailbox export ./mail-export > 待办.csv
 *
 * 两个细节不做会难受：
 *  - 默认带 UTF-8 BOM：不带的话中文 Excel 打开就是乱码，用户第一眼就以为工具坏了。
 *  - 以 = + - @ 开头的字符串前面加单引号：CSV 公式注入（=cmd|' /C calc'!A0 之类）
 *    是真问题，邮件主题来自外部输入，不能原样塞进表格里当公式执行。
 */

import { relative } from 'node:path'
import { bucketLabel } from './triage.mjs'

/** 导出的列顺序（同时也是 CSV 表头）。 */
export const EXPORT_COLUMNS = [
  '截止日',
  '剩余天数',
  '栏',
  '主题',
  '发件人',
  '邮件日期',
  '原文写法',
  '来源',
  '命中关键词',
  '要不要回复',
]

/** 栏的固定顺序：导出全量时按这个排。 */
const BUCKET_ORDER = ['action', 'red', 'opportunity', 'good', 'notify']

/**
 * 一个单元格 → CSV 文本。
 * 数字原样输出；字符串遇到逗号/引号/换行就加引号，以公式字符开头的先加单引号。
 * @param {string|number|null|undefined} value
 * @returns {string}
 */
export function csvCell(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  let s = String(value)
  // 公式注入：邮件主题是外部输入，不能让 Excel 当公式执行
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

/**
 * 渲染 CSV 文本。
 * @param {Array<Record<string, string|number>>} rows 行对象（键是 EXPORT_COLUMNS 里的列名）
 * @param {{bom?: boolean, eol?: string}} [opts] bom 默认 true（给中文 Excel 用）
 * @returns {string}
 */
export function renderCsv(rows, opts = {}) {
  const eol = opts.eol || '\r\n'
  const lines = [EXPORT_COLUMNS.map(csvCell).join(',')]
  for (const row of rows) {
    lines.push(EXPORT_COLUMNS.map(col => csvCell(row[col])).join(','))
  }
  const body = lines.join(eol) + eol
  return opts.bom === false ? body : '\uFEFF' + body
}

/**
 * 分诊结果 → 行数组 + CSV。
 * @param {{action?: Array, red?: Array, good?: Array, opportunity?: Array, notify?: Array}} groups 分诊分组
 * @param {{root?: string, now?: Date, bucket?: string}} [opts] bucket 默认 action；'all' 导出每一栏
 * @returns {{rows: Array<object>, csv: string}}
 */
export function buildExport(groups, opts = {}) {
  const bucket = opts.bucket || 'action'
  const root = opts.root
  const picked = bucket === 'all' ? BUCKET_ORDER : [bucket]

  const items = []
  for (const name of picked) {
    for (const m of groups[name] || []) items.push({ message: m, bucket: name })
  }

  const rank = (name) => {
    const i = BUCKET_ORDER.indexOf(name)
    return i < 0 ? 99 : i
  }
  items.sort((a, b) => {
    if (bucket === 'all') {
      const ra = rank(a.bucket), rb = rank(b.bucket)
      if (ra !== rb) return ra - rb
    }
    const da = a.message.deadline?.iso || '9999-99-99'
    const db = b.message.deadline?.iso || '9999-99-99'
    if (da !== db) return da.localeCompare(db)
    if ((b.message.score || 0) !== (a.message.score || 0)) return (b.message.score || 0) - (a.message.score || 0)
    return String(b.message.dateIso || '').localeCompare(String(a.message.dateIso || ''))
  })

  const rows = items.map(({ message: m, bucket: name }) => ({
    截止日: m.deadline?.iso || '',
    剩余天数: typeof m.deadline?.daysLeft === 'number' ? m.deadline.daysLeft : '',
    栏: bucketLabel(name),
    主题: m.subject || '',
    发件人: m.from || '',
    邮件日期: m.dateIso ? m.dateIso.slice(0, 10) : '',
    原文写法: m.deadline?.raw || '',
    来源: `${root ? relative(root, m.file) : m.file}#${m.indexInFile}`,
    命中关键词: (m.matched || []).join(' '),
    要不要回复: m.needsReply ? '是' : '否',
  }))

  return { rows, csv: renderCsv(rows, { bom: opts.bom }) }
}
