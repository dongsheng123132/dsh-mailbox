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
/**
 * 主题归一化：剥掉 Re: / Fwd: / 答复: / 回复: / 转: / [外部] 这类前缀，压空白、转小写。
 * 只用于「没有引用头时的兜底归并」，不改变展示用主题。
 * @param {string} subject 原始主题
 * @returns {string} 归一化后的比较键（空主题返回 ''）
 */
const SUBJECT_PREFIX = /^\s*(?:re|fw|fwd|aw|sv|antw|tr|答复|回复|回覆|转发|轉寄|转寄|回覆)\s*(?:\[\d+\])?\s*[:：]\s*/i
const SUBJECT_TAG = /^\s*\[(?:外部|external|ext|ex)\]\s*/i

export function normalizeSubject(subject) {
  let s = String(subject || '')
  if (!s.trim()) return ''
  let guard = 0
  let prev
  do {
    prev = s
    s = s.replace(SUBJECT_PREFIX, '').replace(SUBJECT_TAG, '')
    guard++
  } while (s !== prev && guard < 10)
  return s.replace(/\s+/g, ' ').trim().toLowerCase()
}

/** 从 from/to 里抠出地址（小写）。 */
function addressesOf(message) {
  const raw = `${message.from || ''} ${message.to || ''}`
  const out = []
  const re = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g
  let m
  while ((m = re.exec(raw))) out.push(m[0].toLowerCase())
  return out
}

/**
 * 邮箱主人 = 全档出现次数最多的地址（几乎每封都在）。
 * 判断「同一段对话」时不能拿它当共同联系人，否则所有邮件都「有共同联系人」。
 */
function dominantAddress(messages) {
  const counts = new Map()
  for (const message of messages) {
    for (const addr of new Set(addressesOf(message))) {
      counts.set(addr, (counts.get(addr) || 0) + 1)
    }
  }
  let best = null
  let bestCount = -1
  for (const [addr, n] of counts) {
    if (n > bestCount) { best = addr; bestCount = n }
  }
  return best
}

/**
 * 按线程归并：先按 References / In-Reply-To 找根，再对「没有引用头」的信按
 * 主题 + 时间窗 + 共同联系人兜底。
 *
 * 兜底的三道闸（缺一不合并，宁可分开也不要把两件事粘在一起）：
 *   1. 归一化后的主题相同；
 *   2. 除邮箱主人外至少有一个共同联系人（不同客户发的同名报价单不会被粘在一起）；
 *   3. 与线程起点相差不超过 windowDays 天（默认 30）。
 *
 * @param {Array} messages 消息列表
 * @param {{windowDays?: number}} [opts] windowDays=0 关闭兜底
 * @returns {Array<{key: string, messages: Array, count: number, lastDate: string|null,
 *   via: 'references'|'subject'|'single', subjectMerged: boolean}>}
 */
export function groupThreads(messages, opts = {}) {
  const windowDays = opts.windowDays === undefined ? 30 : Number(opts.windowDays)
  const windowMs = windowDays > 0 ? windowDays * 86400000 : -1
  const owner = dominantAddress(messages)

  const byId = new Map()
  for (const m of messages) {
    if (m.messageId) byId.set(m.messageId, m)
  }

  // 第一轮：按引用头找根（保持原有行为）
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

  const startsAt = (list) => {
    const dates = list.map(m => Date.parse(m.dateIso || '')).filter(t => Number.isFinite(t))
    return dates.length ? Math.min(...dates) : NaN
  }

  // 第二轮：引用线程原样落地；无引用的信尝试挂到同主题的线程上
  const clusters = []
  // 同主题的线程按主题建索引：大档案里线性扫全部线程会退化成 O(n²)
  const bySubjectKey = new Map()
  const sorted = [...threads.values()].sort((a, b) => {
    const sa = startsAt(a.messages)
    const sb = startsAt(b.messages)
    return (Number.isFinite(sa) ? sa : Infinity) - (Number.isFinite(sb) ? sb : Infinity)
  })

  for (const t of sorted) {
    const hasRefs = t.messages.some(m => m.inReplyTo || (m.references && m.references.length))
    const start = startsAt(t.messages)
    const subjectKey = normalizeSubject(t.messages[0]?.subject)
    const people = new Set()
    for (const m of t.messages) {
      for (const addr of addressesOf(m)) if (addr !== owner) people.add(addr)
    }

    const canMerge = !hasRefs && windowMs > 0 && !!subjectKey && subjectKey !== '(无主题)' && Number.isFinite(start)
    let host = null
    if (canMerge) {
      const candidates = bySubjectKey.get(subjectKey) || []
      host = candidates.find(c =>
        Number.isFinite(c.start) &&
        Math.abs(start - c.start) <= windowMs &&
        [...people].some(p => c.people.has(p))) || null
    }

    if (host) {
      host.messages.push(...t.messages)
      for (const p of people) host.people.add(p)
      host.subjectMerged = true
      continue
    }

    const cluster = {
      key: t.key,
      messages: [...t.messages],
      via: hasRefs ? 'references' : (subjectKey ? 'subject' : 'single'),
      subjectKey,
      people,
      start,
      subjectMerged: false,
    }
    clusters.push(cluster)
    if (subjectKey) {
      if (!bySubjectKey.has(subjectKey)) bySubjectKey.set(subjectKey, [])
      bySubjectKey.get(subjectKey).push(cluster)
    }
  }

  for (const c of clusters) {
    c.messages.sort((a, b) => String(a.dateIso || '').localeCompare(String(b.dateIso || '')))
    c.count = c.messages.length
    c.lastDate = c.messages.at(-1)?.dateIso || null
    delete c.subjectKey
    delete c.people
    delete c.start
  }
  clusters.sort((a, b) => String(b.lastDate || '').localeCompare(String(a.lastDate || '')))
  return clusters
}
