/**
 * archive.mjs —— 把一个目录里的 .eml / .mbox 变成可分析的内存档案。
 *
 * 设计口径：
 * - 只读原文件，绝不改写；所有索引都在内存里，进程退出即消失。
 * - 每条记录都带 `file` 与 `indexInFile`，报告里的任何结论都能回到「哪个文件第几封」。
 * - Message-ID 缺失时用「文件+序号+日期+主题」合成稳定 id，保证去重可复现。
 */

import { readFile, readdir, stat } from 'node:fs/promises'
import { join, extname, basename, resolve } from 'node:path'
import { parseMessage, splitMbox } from './mime.mjs'

const MAX_FILE_BYTES = 200 * 1024 * 1024 // 单文件 200MB 上限，超过跳过并说明

/**
 * 递归收集邮件文件。
 * @param {string} root 目录
 * @returns {Promise<{files: string[], skipped: Array<{path:string,reason:string}>}>}
 */
export async function findMailFiles(root) {
  const files = []
  const skipped = []
  const walk = async (dir, depth = 0) => {
    if (depth > 12) return
    let entries
    try { entries = await readdir(dir, { withFileTypes: true }) } catch (e) {
      skipped.push({ path: dir, reason: `无法读取目录: ${e.code || e.message}` })
      return
    }
    for (const ent of entries) {
      const p = join(dir, ent.name)
      if (ent.isDirectory()) {
        if (ent.name === '.git' || ent.name === 'node_modules') continue
        await walk(p, depth + 1)
      } else if (ent.isFile()) {
        const ext = extname(ent.name).toLowerCase()
        if (ext === '.eml' || ext === '.mbox' || ext === '.mbx') {
          files.push(p)
        }
      }
    }
  }
  await walk(resolve(root))
  files.sort()
  return { files, skipped }
}

/**
 * 读入并解析所有邮件。
 * @param {string} root 目录
 * @returns {Promise<{messages: Array, files: string[], skipped: Array, stats: object}>}
 */
export async function loadArchive(root) {
  const { files, skipped } = await findMailFiles(root)
  const messages = []

  for (const file of files) {
    let info
    try { info = await stat(file) } catch { continue }
    if (info.size > MAX_FILE_BYTES) {
      skipped.push({ path: file, reason: `文件超过 ${MAX_FILE_BYTES / 1024 / 1024}MB，跳过` })
      continue
    }
    let buf
    try { buf = await readFile(file) } catch (e) {
      skipped.push({ path: file, reason: `读取失败: ${e.code || e.message}` })
      continue
    }
    const ext = extname(file).toLowerCase()
    const isMbox = ext === '.mbox' || ext === '.mbx'

    if (isMbox) {
      const rawList = splitMbox(buf.toString('utf8'))
      rawList.forEach((raw, i) => {
        const parsed = parseMessage(raw)
        messages.push(toRecord(parsed, file, i))
      })
    } else {
      const parsed = parseMessage(buf)
      messages.push(toRecord(parsed, file, 0))
    }
  }

  // 去重：优先 Message-ID；缺失时用合成键
  const seen = new Map()
  const unique = []
  let duplicates = 0
  for (const m of messages) {
    const key = m.messageId || m.syntheticId
    if (seen.has(key)) {
      duplicates++
      seen.get(key).duplicateFiles.push(m.file)
      continue
    }
    seen.set(key, m)
    unique.push(m)
  }

  const dated = unique.filter(m => m.dateIso)
  const stats = {
    files: files.length,
    total: messages.length,
    unique: unique.length,
    duplicates,
    withValidDate: dated.length,
    earliest: dated.length ? dated.map(m => m.dateIso).sort()[0] : null,
    latest: dated.length ? dated.map(m => m.dateIso).sort().at(-1) : null,
    attachments: unique.reduce((n, m) => n + m.attachments.length, 0),
    skipped,
  }

  return { messages: unique, files, skipped, stats }
}

/** 统一成分析用的记录形状。 */
function toRecord(parsed, file, indexInFile) {
  const dateIso = parseDate(parsed.date)
  const syntheticId = `synth:${basename(file)}#${indexInFile}`
  return {
    file,
    indexInFile,
    messageId: parsed.messageId,
    syntheticId,
    subject: parsed.subject || '(无主题)',
    from: parsed.from || '(未知发件人)',
    to: parsed.to || '',
    date: parsed.date,
    dateIso,
    inReplyTo: parsed.inReplyTo,
    references: parsed.references,
    text: parsed.text || '',
    attachments: parsed.attachments || [],
    charsetIssues: parsed.charsetIssues || [],
    duplicateFiles: [],
    // 线程归并用的根治键
    threadKey: parsed.references?.[0] || parsed.inReplyTo || parsed.messageId || syntheticId,
  }
}

/**
 * 宽松解析邮件日期（RFC 5322 各种写法 + 常见变体）。
 * @param {string|null} value 原始 Date 头
 * @returns {string|null} ISO 字符串；解析不出返回 null（不猜）
 */
export function parseDate(value) {
  if (!value) return null
  // 去掉注释与多余空白
  const cleaned = String(value).replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim()
  const t = Date.parse(cleaned)
  if (!Number.isNaN(t)) return new Date(t).toISOString()
  // 兜底：有些导出会写 2026-11-17 09:00:00 +0800
  const m = /(\d{4}[-/]\d{2}[-/]\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)/.exec(cleaned)
  if (m) {
    const t2 = Date.parse(`${m[1].replace(/\//g, '-')}T${m[2]}Z`)
    if (!Number.isNaN(t2)) return new Date(t2).toISOString()
  }
  return null
}

/**
 * 按线程归并。
 * @param {Array} messages 消息列表
 * @returns {Array<{key: string, messages: Array}>}
 */
export function groupThreads(messages) {
  const byId = new Map()
  for (const m of messages) {
    if (m.messageId) byId.set(m.messageId, m)
  }
  const threads = new Map()
  for (const m of messages) {
    let key = m.messageId || m.syntheticId
    // 沿着 inReplyTo / references 往上找根
    let cur = m
    let guard = 0
    while (cur && guard++ < 50) {
      const parentId = cur.inReplyTo || cur.references?.[0]
      if (!parentId) break
      const parent = byId.get(parentId)
      if (!parent) break
      cur = parent
    }
    key = cur.messageId || cur.syntheticId
    if (!threads.has(key)) threads.set(key, { key, messages: [] })
    threads.get(key).messages.push(m)
  }
  const out = [...threads.values()]
  for (const t of out) {
    t.messages.sort((a, b) => String(a.dateIso || '').localeCompare(String(b.dateIso || '')))
    t.count = t.messages.length
    t.lastDate = t.messages.at(-1)?.dateIso || null
  }
  out.sort((a, b) => String(b.lastDate || '').localeCompare(String(a.lastDate || '')))
  return out
}
