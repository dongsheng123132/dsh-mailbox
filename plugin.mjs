/**
 * dsh-mailbox 的 host 半：往 DSH 里注册模型可调用工具 `dsh_mailbox`。
 *
 * 契约（照本机 dsh-keys 实测样本）：
 * - 只 import `node:` 内置与包内相对路径，不 import `@deepseek-ai/*`；
 * - 工具用裸 JSON Schema ToolDefinition 注册；
 * - 默认只读：只读档案目录，不写原文件、不联网、不需要 OAuth。
 */

import { loadArchive, groupThreads } from './lib/archive.mjs'
import { triageAll, bucketLabel } from './lib/triage.mjs'
import { renderMarkdown, renderBrief } from './lib/report.mjs'

/** cordis 插件名（= 包名）。 */
export const name = 'dsh-mailbox'

/** 需要宿主提供的服务：工具注册表。 */
export const inject = ['tools']

export const VERSION = '0.1.0'

/** 默认配置，可被 cordis.patch.yml 覆盖。 */
const DEFAULTS = {
  root: '',
  topN: 20,
  allowHome: false,
}

const PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: {
      type: 'string',
      enum: ['scan', 'triage', 'threads', 'attachments', 'search'],
      description: 'scan = 清点档案；triage = 四栏分诊；threads = 线程归并；attachments = 附件盘点；search = 搜索。',
    },
    root: { type: 'string', description: '档案目录（含 .eml / .mbox）。拒绝 / 与 home（除非 allow_home:true）。' },
    query: { type: 'string', description: 'search 的关键词。' },
    top: { type: 'integer', description: '最多返回多少条，默认 20。' },
    brief: { type: 'boolean', description: 'triage 只返回精简摘要（默认 false = 完整 Markdown）。' },
    windowDays: { type: 'integer', description: 'threads 的主题兜底时间窗（天），默认 30；0 = 关闭兜底，只看 References / In-Reply-To。' },
    allow_home: { type: 'boolean', description: '允许把 home 当 root（默认拒绝，防误扫整台机器）。' },
  },
  required: ['action'],
  // root 由 execute 兜底填默认值
  anyOf: [{ required: ['root'] }, { required: ['action'] }],
}

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    tool: { type: 'string' },
    version: { type: 'string' },
    action: { type: 'string' },
    readOnly: { type: 'boolean' },
    root: { type: 'string' },
    stats: {},
    groups: {},
    threads: {},
    attachments: {},
    hits: {},
    markdown: { type: 'string' },
    summary: { type: 'string' },
    notes: { type: 'array', items: { type: 'string' } },
  },
  required: ['action', 'readOnly', 'root'],
}

/** 把绝对路径收敛到 root 内，并拒绝 home/根目录。 */
function resolveRoot(input, settings) {
  const candidate = input || settings.root
  if (!candidate) throw new Error('[bad_root] 缺少 root：请给出档案目录，或在插件配置里设 root')
  return candidate
}

function guardRoot(root, allowHome) {
  const p = String(root)
  if (p === '/' || p === '') throw new Error('[bad_root] 拒绝扫描根目录 /')
  if (!allowHome && /^\/(Users|home)\/[^/]+\/?$/.test(p)) {
    throw new Error('[bad_root] 拒绝把 home 当 root（确需如此请传 allow_home:true）')
  }
}

export function createToolDefinition(config = {}) {
  const settings = { ...DEFAULTS, ...config }

  return {
    name: 'dsh_mailbox',
    description:
      '离线邮件档案工作台：直接读已导出的 .eml / .mbox，不联网、不需要 OAuth。'
      + '做清点（文件/封数/去重/日期范围/附件）、四栏分诊（要动的/坏的/好的/机会）、'
      + '线程归并、附件盘点和全文搜索；每条结论都带文件路径与序号，可回指原文。'
      + '默认只读，不改原文件。',
    parameters: PARAMETERS,
    output: {
      schema: OUTPUT_SCHEMA,
      render(_args, value) {
        const text = value.markdown || value.summary || '(无输出)'
        return [{ type: 'text', text }]
      },
      presentationMeta(_args, value) {
        return {
          action: value.action,
          unique: value.stats?.unique ?? null,
          actionCount: value.groups?.action?.length ?? null,
          redCount: value.groups?.red?.length ?? null,
        }
      },
    },
    presentCall(args) {
      return {
        card: 'search',
        title: `邮件档案 ${args.action}${args.root ? ` · ${args.root}` : ''}`,
        kind: 'search',
        rawInput: args,
      }
    },
    presentResult(_args, result) {
      if (result.isError || !result.meta) return undefined
      const m = result.meta
      const state = m.action === 'triage'
        ? `${m.unique ?? 0} 封 · 要动 ${m.actionCount ?? 0}`
        : `${m.unique ?? 0} 封`
      return { card: 'search', title: `dsh_mailbox · ${state}`, content: result.content }
    },
    async execute(args, exec) {
      const root = resolveRoot(args.root, settings)
      guardRoot(root, args.allow_home ?? settings.allowHome)

      const archive = await loadArchive(root)
      const base = {
        tool: 'dsh_mailbox',
        version: VERSION,
        action: args.action,
        readOnly: true,
        root,
        stats: archive.stats,
        notes: [],
      }
      const top = args.top ?? settings.topN
      const now = new Date()

      if (archive.stats.skipped?.length) {
        base.notes.push(`跳过 ${archive.stats.skipped.length} 项（超限/不可读），详见 stats.skipped`)
      }

      if (args.action === 'scan') {
        base.summary = `文件 ${archive.stats.files} · 邮件 ${archive.stats.total} · 去重后 ${archive.stats.unique} · 附件 ${archive.stats.attachments}`
        return base
      }

      if (args.action === 'triage') {
        const result = triageAll(archive.messages, now)
        const merged = { ...result, stats: archive.stats }
        base.groups = Object.fromEntries(
          Object.entries(result.groups).map(([k, v]) => [k, v.slice(0, top)])
        )
        base.summary = renderBrief(merged)
        base.markdown = args.brief ? base.summary : renderMarkdown(merged, { root, now, topN: top })
        return base
      }

      if (args.action === 'threads') {
        const windowDays = args.windowDays === undefined ? 30 : Number(args.windowDays)
        if (!Number.isFinite(windowDays) || windowDays < 0) throw new Error('windowDays 需要 ≥ 0 的天数')
        const threads = groupThreads(archive.messages, { windowDays })
        const merged = threads.filter(t => t.subjectMerged).length
        const longest = threads.reduce((n, t) => Math.max(n, t.count), 0)
        base.threads = threads.slice(0, top).map(t => ({
          key: t.key,
          count: t.count,
          subject: t.messages[0]?.subject,
          from: t.messages[0]?.from,
          lastDate: t.lastDate,
          via: t.via,
          subjectMerged: t.subjectMerged,
        }))
        base.summary = `共 ${threads.length} 个线程，最长 ${longest} 封` +
          (windowDays > 0 ? `（其中 ${merged} 个靠主题+${windowDays}天窗兜底归并）` : '（已关闭主题兜底）')
        return base
      }

      if (args.action === 'attachments') {
        const counts = new Map()
        for (const m of archive.messages) {
          for (const a of m.attachments) {
            const key = `${a.contentType}|${a.filename}`
            const cur = counts.get(key) || { ...a, count: 0 }
            cur.count++
            counts.set(key, cur)
          }
        }
        const rows = [...counts.values()].sort((a, b) => b.bytes - a.bytes).slice(0, top)
        base.attachments = rows
        base.summary = `附件 ${rows.length} 种（按大小前 ${top}）`
        return base
      }

      if (args.action === 'search') {
        const q = String(args.query || '').toLowerCase()
        if (!q) throw new Error('[bad_query] search 需要 query')
        const hits = archive.messages
          .filter(m => `${m.subject}\n${m.text}\n${m.from}\n${m.to}`.toLowerCase().includes(q))
          .slice(0, top)
          .map(m => ({ subject: m.subject, from: m.from, date: m.dateIso, file: m.file, index: m.indexInFile }))
        base.hits = hits
        base.summary = `命中 ${hits.length} 封（最多返回 ${top}）`
        return base
      }

      throw new Error(`[bad_action] 未知 action：${args.action}`)
    },
  }
}

/**
 * 插件激活。
 * @param {object} ctx cordis 上下文（需已注入 tools）
 * @param {object} [config] 插件配置
 */
export function apply(ctx, config = {}) {
  ctx.tools.register(createToolDefinition(config))
  ctx.logger?.info?.(`dsh-mailbox ${VERSION}: 已注册工具 dsh_mailbox（离线只读，不需要 OAuth）`)
}
