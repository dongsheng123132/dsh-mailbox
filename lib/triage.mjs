/**
 * triage.mjs —— 把邮件分成四栏，并抽出「要不要我动」的判据。
 *
 * 四栏（与 mailbox-triage 技能同一口径，便于人和 AI 对得上）：
 *   action       要动的：有截止日 / 对方在等人 / 有金额
 *   red          坏的：失败、到期、告警、欠费
 *   good         好的：成功、合并、通过
 *   opportunity  机会：邀请、比赛、合作
 *
 * 判据纪律：
 * - 规则只做「初筛」，不假装懂语义；每条结论都带 matched 关键词，便于人复核。
 * - 拿不准一律进 `notify`（通知/营销），不硬塞进 action 制造噪音。
 * - 不调用任何模型，纯本地字符串判据，结果可复现。
 * - 只看「这封信新写的内容」：引用历史（`>` 行、`-----原始邮件-----`、`On … wrote:`）不参与判据，
 *   否则回复里引用的旧截止日 / 旧报错会把已办结的邮件打成「要动的」「坏的」。
 * - 无年份的日期按**邮件自己的日期**推年份（不是运行年份），归档里翻旧信才不会全错。
 */

/** 发件人域名 → 是否自动通知类（这类通常不需要人动）。 */
const AUTOMATED_SENDER = [
  /no-?reply/i, /do-?not-?reply/i, /notification/i, /notifications@/i,
  /github\.com$/i, /gitlab\.com$/i, /vercel\.com$/i, /cloudflare/i,
  /noreply@/i, /bounce/i, /mailer-daemon/i, /automated/i,
]

const RED_PATTERNS = [
  /fail(ed|ure)?/i, /error/i, /denied/i, /rejected/i, /expired?/i,
  /suspend(ed)?/i, /overdue/i, /unpaid/i, /payment failed/i, /quota/i,
  /security alert/i, /vulnerab/i, /breach/i, /compromised/i,
  /失败/, /错误/, /过期/, /欠费/, /被封/, /告警/, /漏洞/, /驳回/,
]

const GOOD_PATTERNS = [
  /success(ful|fully)?/i, /merged?/i, /approved?/i, /passed?/i, /completed?/i,
  /welcome/i, /confirmed?/i, /shipped/i, /delivered/i,
  /成功/, /已通过/, /已合并/, /已批准/, /完成/, /欢迎/, /已确认/,
]

const OPPORTUNITY_PATTERNS = [
  /invit(e|ation)/i, /hackathon/i, /grant/i, /bounty/i, /partnership/i,
  /collaborat/i, /sponsor/i, /speak(er|ing)/i, /apply/i, /submission/i,
  /邀请/, /比赛/, /奖金/, /合作/, /赞助/, /申请/, /投稿/,
]

const ACTION_PATTERNS = [
  /please (reply|confirm|review|sign|send|provide|complete|submit)/i,
  /could you/i, /can you/i, /need your/i, /waiting for/i, /action required/i,
  /rsvp/i, /deadline/i, /due (by|on|date)/i, /asap/i, /urgent/i,
  /请(回复|确认|审核|签署|提供|完成|提交)/, /麻烦(你|您)/, /等你/, /尽快/, /截止/,
  // 「请于下周三前回复确认」——日期不猜，但「有人在等你」这件事要认出来
  /请于[^\n。；;]{0,24}?(回复|答复|确认|提交|反馈)/,
]

/** 日期写法。有年份的写在前面，避免「2026年11月20日」被当成没有年份的「11月20日」。 */
const DEADLINE_PATTERNS = [
  // 2026年11月20日 / 2026 年 11 月 20 号
  /(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/,
  // 2026-11-20 / 2026/11/20 / 2026.11.20
  /\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/,
  // Nov 20 / November 20, 2026
  /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2})(?:,?\s*(20\d{2}))?\b/i,
  // 11月20日 / 11月20号
  /(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/,
  // within N days / N 天内
  /within\s+(\d+)\s+(day|days|business days)/i,
  /(\d+)\s*天内/,
]

// ── 引用历史剥离 ──────────────────────────────────────────
// 只看收件人新写的那段：引用块里的旧日期 / 旧报错不属于这封信的判据。
const QUOTE_MARKERS = [
  /^\s*-{2,}\s*(原始邮件|原邮件|original message|forwarded message|转发的邮件|邮件原文|邮件原件)\s*-*\s*$/i,
  /^\s*_{20,}\s*$/,
  /^\s*(在.{0,160}?)?写道\s*[:：]\s*$/,
  /^\s*on\s+.{5,160}?\bwrote\s*:\s*$/i,
]
const QUOTE_HEADER_FROM = /^\s*(发件人|from)\s*[:：]\s*\S/i
const QUOTE_HEADER_NEXT = /^\s*(发送时间|日期|收件人|主题|抄送|sent|date|to|subject|cc)\s*[:：]/i

/**
 * 去掉引用历史，只留这封信自己写的内容。
 * 认的边界：`>` 行、`-----原始邮件-----` / `-----Original Message-----`、
 * Gmail 的「在 … 写道：」与「On … wrote:」、Outlook 的 `发件人:` + `发送时间:` 头部块。
 * @param {string} text 正文
 * @returns {string}
 */
export function stripQuotedText(text) {
  if (!text) return ''
  const lines = String(text).split(/\r?\n/)
  let cut = lines.length
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (QUOTE_MARKERS.some(re => re.test(line))) { cut = i; break }
    if (QUOTE_HEADER_FROM.test(line) && lines.slice(i + 1, i + 4).some(l => QUOTE_HEADER_NEXT.test(l))) {
      cut = i
      break
    }
  }
  return lines.slice(0, cut).filter(l => !/^\s*>/.test(l)).join('\n')
}


/** 判断是否自动通知发件人。 */
export function isAutomated(m) {
  const from = m.from || ''
  return AUTOMATED_SENDER.some(re => re.test(from))
}

/**
 * 判据用的文本：主题 + 这封信自己写的正文（引用历史已剥离）。
 * @param {object} m 消息记录
 * @returns {string}
 */
function haystack(m) {
  return `${m.subject || ''}\n${stripQuotedText(m.text)}`.slice(0, 20000)
}

/**
 * 无年份日期的参考时间：优先用邮件自己的日期，缺了才用运行时间。
 * 归档里翻 2024 年的信，不能按 2026 年推年份。
 */
function referenceDate(m, now) {
  const t = m?.dateIso ? Date.parse(m.dateIso) : NaN
  return Number.isNaN(t) ? now : new Date(t)
}

/** 抽截止日（返回原始匹配串 + 归一化 ISO，拿不准就 null）。 */
export function extractDeadline(m, now = new Date()) {
  const hay = haystack(m)
  const ref = referenceDate(m, now)
  for (const re of DEADLINE_PATTERNS) {
    const hit = re.exec(hay)
    if (!hit) continue
    const iso = normalizeDeadline(hit, ref)
    return { raw: hit[0], iso }
  }
  return null
}

function normalizeDeadline(hit, ref) {
  const s = hit[0]
  // 2026年11月20日
  let m = /^(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]$/.exec(s)
  if (m) return iso(m[1], m[2], m[3])
  // YYYY-MM-DD / YYYY.MM.DD
  m = /^(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s)
  if (m) return iso(m[1], m[2], m[3])
  // Mon D, YYYY / Mon D
  m = /^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})(?:,?\s*(20\d{2}))?$/.exec(s)
  if (m) {
    const mon = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(m[1].toLowerCase()) + 1
    if (mon > 0) return m[3] ? iso(m[3], mon, m[2]) : resolveYearless(ref, mon, m[2])
  }
  // 11月20日
  m = /^(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]$/.exec(s)
  if (m) return resolveYearless(ref, m[1], m[2])
  // within N days / N 天内：按邮件日期往后数，算得出就给出具体日期
  m = /^within\s+(\d+)\s+days?$/i.exec(s) || /^(\d+)\s*天内$/.exec(s)
  if (m) return addDays(ref, Number(m[1]))
  return null
}

/**
 * 没有年份的日期：用参考年的年份；若因此比参考日期早 45 天以上，说明跨年（12 月说「1 月 5 日」），顺延一年。
 */
function resolveYearless(ref, mo, d) {
  const y = ref.getUTCFullYear()
  const first = iso(String(y), mo, d)
  if (!first) return null
  const days = (Date.parse(first) - ref.getTime()) / 86400000
  return days < -45 ? iso(String(y + 1), mo, d) : first
}

/** 参考日期 + N 天（按日历日；不猜工作日/节假日）。 */
function addDays(ref, n) {
  const base = Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate())
  return new Date(base + n * 86400000).toISOString().slice(0, 10)
}

function iso(y, mo, d) {
  const yy = Number(y), mm = Number(mo), dd = Number(d)
  if (!yy || mm < 1 || mm > 12 || dd < 1 || dd > 31) return null
  const dt = new Date(Date.UTC(yy, mm - 1, dd))
  if (dt.getUTCMonth() !== mm - 1) return null
  return dt.toISOString().slice(0, 10)
}

/**
 * 给一封邮件分栏。
 * @param {object} m 消息记录
 * @param {Date} now 当前时间（判断紧迫度）
 * @returns {{bucket: string, score: number, matched: string[], deadline: object|null, needsReply: boolean}}
 */
export function classify(m, now = new Date()) {
  const hay = haystack(m)
  const matched = []
  const automated = isAutomated(m)

  const hit = (pats, tag) => {
    for (const re of pats) {
      const g = re.exec(hay)
      if (g) { matched.push(`${tag}:${g[0].slice(0, 24)}`); return true }
    }
    return false
  }

  const isRed = hit(RED_PATTERNS, 'red')
  const isGood = !isRed && hit(GOOD_PATTERNS, 'good')
  const isOpp = hit(OPPORTUNITY_PATTERNS, 'opportunity')
  const asksAction = hit(ACTION_PATTERNS, 'action')
  const deadline = extractDeadline(m, now)

  // 要不要人回复：非自动发件人 + 有请求语气 或 有截止日
  const needsReply = !automated && (asksAction || !!deadline)

  let bucket = 'notify'
  if (isRed) bucket = 'red'
  else if (needsReply) bucket = 'action'
  else if (isOpp) bucket = 'opportunity'
  else if (isGood) bucket = 'good'

  // 评分：越靠前越该先看
  let score = 0
  if (bucket === 'action') score += 60
  if (bucket === 'red') score += 55
  if (bucket === 'opportunity') score += 35
  if (bucket === 'good') score += 10
  if (deadline?.iso) {
    const days = Math.round((Date.parse(deadline.iso) - now.getTime()) / 86400000)
    if (days >= 0 && days <= 3) score += 30
    else if (days >= 0 && days <= 14) score += 15
    else if (days < 0) score += 5 // 已过期，仍值得看一眼
    deadline.daysLeft = days
  }
  if (!automated) score += 10

  return { bucket, score, matched, deadline, needsReply }
}

const BUCKET_LABEL = {
  action: '要动的',
  red: '坏的',
  good: '好的',
  opportunity: '机会',
  notify: '通知/营销',
}

/** 中文栏名。 */
export function bucketLabel(b) { return BUCKET_LABEL[b] || b }

/**
 * 全量分诊：给每条记录打标并按四栏分组。
 * @param {Array} messages 消息列表
 * @param {Date} now 基准时间
 * @returns {{groups: object, all: Array}}
 */
export function triageAll(messages, now = new Date()) {
  const all = messages.map(m => {
    const c = classify(m, now)
    return { ...m, ...c }
  })
  const groups = { action: [], red: [], good: [], opportunity: [], notify: [] }
  for (const m of all) groups[m.bucket].push(m)
  for (const k of Object.keys(groups)) {
    groups[k].sort((a, b) => {
      // 有截止日的按截止日升序，其次按评分降序，最后按时间降序
      const da = a.deadline?.iso || '9999-99-99'
      const db = b.deadline?.iso || '9999-99-99'
      if (da !== db) return da.localeCompare(db)
      if (b.score !== a.score) return b.score - a.score
      return String(b.dateIso || '').localeCompare(String(a.dateIso || ''))
    })
  }
  return { groups, all }
}
