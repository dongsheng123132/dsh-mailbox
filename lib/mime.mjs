/**
 * mime.mjs —— 零依赖 MIME / RFC 5322 解析。
 *
 * 为什么手写：本包承诺「装完即用、不联网、零供应链」。邮件解析库（mailparser 等）
 * 会带一串传递依赖，与 dsh 插件的零依赖约定冲突；而我们只需要「读已导出的档案」，
 * 不需要 IMAP / SMTP / OAuth 那一整套。
 *
 * 能力边界（写进 README，不夸大）：
 * - 支持：头部折叠、RFC 2047 编码字、multipart（含嵌套）、base64 / quoted-printable、
 *   常见字符集（utf-8 / gbk / big5 / iso-8859-*）、附件识别。
 * - 不支持：TNEF(winmail.dat)、S/MIME 解密、加密邮件、MS 专有富文本。
 * - 不做：不执行 HTML 里的脚本、不自动加载远程图片（只提取文本）。
 */

/** 常见字符集别名 → TextDecoder 认的名字。认不出的退回 utf-8 并标记。 */
const CHARSET_ALIAS = {
  'utf8': 'utf-8', 'utf-8': 'utf-8', 'us-ascii': 'utf-8', 'ascii': 'utf-8',
  'gb2312': 'gbk', 'gbk': 'gbk', 'gb18030': 'gbk', 'x-gbk': 'gbk', 'cp936': 'gbk',
  'big5': 'big5', 'big-5': 'big5', 'cp950': 'big5',
  'latin1': 'iso-8859-1', 'iso-8859-1': 'iso-8859-1', 'windows-1252': 'windows-1252',
  'cp1252': 'windows-1252', 'shift_jis': 'shift_jis', 'sjis': 'shift_jis',
  'euc-jp': 'euc-jp', 'euc-kr': 'euc-kr', 'koi8-r': 'koi8-r',
}

/**
 * 解码字节到字符串。认不出的字符集不静默假装成功——返回 used 字段让调用方知道。
 * @param {Buffer} buf 原始字节
 * @param {string} charset 头部声明的字符集
 * @returns {{text: string, charset: string, replaced: boolean}}
 */
export function decodeBytes(buf, charset = 'utf-8') {
  const name = CHARSET_ALIAS[String(charset || '').toLowerCase().trim()] || String(charset || '').toLowerCase().trim()
  try {
    const dec = new TextDecoder(name, { fatal: false })
    // 用 fatal 探一次，判断有没有替换字符，便于报告「编码可能不对」
    let replaced = false
    try { new TextDecoder(name, { fatal: true }).decode(buf) } catch { replaced = true }
    return { text: dec.decode(buf), charset: name, replaced }
  } catch {
    return { text: new TextDecoder('utf-8', { fatal: false }).decode(buf), charset: 'utf-8', replaced: true }
  }
}

/**
 * 解 RFC 2047 编码字：=?UTF-8?B?...?= / =?gbk?Q?...?=
 * @param {string} input 头部原值
 * @returns {string}
 */
export function decodeRFC2047(input) {
  if (!input || !input.includes('=?')) return input
  return input.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_m, charset, enc, payload) => {
    let buf
    try {
      if (enc.toUpperCase() === 'B') {
        buf = Buffer.from(payload.replace(/\s+/g, ''), 'base64')
      } else {
        // Q 编码：_ 代表空格，=XX 是十六进制
        const s = payload.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_x, h) => String.fromCharCode(parseInt(h, 16)))
        buf = Buffer.from(s, 'latin1')
      }
      const name = CHARSET_ALIAS[charset.toLowerCase()] || charset.toLowerCase()
      return new TextDecoder(name, { fatal: false }).decode(buf)
    } catch {
      return _m
    }
  })
}

/**
 * 把折行头部还原成单行（RFC 5322 §2.2.3）。
 * @param {string} raw 头部块
 * @returns {Map<string, string>} 小写键 → 值（同键多次出现用逗号合并）
 */
export function parseHeaders(raw) {
  const out = new Map()
  if (!raw) return out
  // 先把续行接上：行首空白表示继续上一行
  const lines = raw.split(/\r?\n/)
  const merged = []
  for (const line of lines) {
    if (/^[ \t]/.test(line) && merged.length) merged[merged.length - 1] += ' ' + line.trim()
    else if (line.trim()) merged.push(line)
  }
  for (const line of merged) {
    const i = line.indexOf(':')
    if (i <= 0) continue
    const key = line.slice(0, i).trim().toLowerCase()
    const value = line.slice(i + 1).trim()
    if (out.has(key)) out.set(key, out.get(key) + ', ' + value)
    else out.set(key, value)
  }
  return out
}

/**
 * 解析 Content-Type / Content-Disposition 这类「主值 + 参数」的头。
 * @param {string} value 头部值
 * @returns {{value: string, params: Record<string,string>}}
 */
export function parseParamHeader(value) {
  const params = {}
  if (!value) return { value: '', params }
  const parts = splitUnquoted(value, ';')
  const main = (parts.shift() || '').trim().toLowerCase()
  for (const p of parts) {
    const eq = p.indexOf('=')
    if (eq < 0) continue
    const k = p.slice(0, eq).trim().toLowerCase()
    let v = p.slice(eq + 1).trim()
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1).replace(/\\"/g, '"')
    params[k] = decodeRFC2047(v)
  }
  return { value: main, params }
}

/** 按分隔符切分，但不切引号里的内容。 */
function splitUnquoted(s, sep) {
  const out = []
  let cur = ''
  let inQuote = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '"' && s[i - 1] !== '\\') inQuote = !inQuote
    if (c === sep && !inQuote) { out.push(cur); cur = ''; continue }
    cur += c
  }
  out.push(cur)
  return out
}

/**
 * 解 Content-Transfer-Encoding。
 * @param {Buffer} buf 正文原始字节
 * @param {string} encoding 编码名
 * @returns {Buffer}
 */
export function decodeTransfer(buf, encoding) {
  const enc = String(encoding || '').toLowerCase().trim()
  if (enc === 'base64') {
    const s = buf.toString('latin1').replace(/[^A-Za-z0-9+/=]/g, '')
    return Buffer.from(s, 'base64')
  }
  if (enc === 'quoted-printable') {
    // QP：=XX 十六进制；行尾 = 表示软换行
    return Buffer.from(
      buf.toString('latin1')
        .replace(/=\r?\n/g, '')
        .replace(/=([0-9A-Fa-f]{2})/g, (_m, h) => String.fromCharCode(parseInt(h, 16))),
      'latin1'
    )
  }
  return buf
}

/**
 * 拆分 multipart 正文。
 * @param {string} body 正文（latin1 字符串，保持字节原样）
 * @param {string} boundary 分隔串
 * @returns {string[]} 各段原文
 */
export function splitMultipart(body, boundary) {
  if (!boundary) return [body]
  const delim = '--' + boundary
  const out = []
  const lines = body.split(/\r?\n/)
  let cur = null
  for (const line of lines) {
    if (line === delim || line === delim + '--' || line.startsWith(delim)) {
      if (line === delim + '--') { if (cur) out.push(cur.join('\n')); cur = null; break }
      if (cur) out.push(cur.join('\n'))
      cur = []
      continue
    }
    if (cur) cur.push(line)
  }
  if (cur && cur.length) out.push(cur.join('\n'))
  return out.filter(p => p.trim())
}

/** HTML → 纯文本的保守实现（不执行脚本、不加载图片）。 */
export function htmlToText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * 解析一封原始邮件。
 * @param {Buffer|string} raw 原始内容
 * @returns {{headers: Map<string,string>, subject: string, from: string, to: string,
 *   date: string|null, messageId: string|null, inReplyTo: string|null,
 *   references: string[], text: string, html: string, attachments: Array,
 *   charsetIssues: string[]}}
 */
export function parseMessage(raw) {
  const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw, 'utf8')
  // 头/体分界：第一个空行
  const text = buf.toString('latin1')
  const m = /\r?\n\r?\n/.exec(text)
  const headerRaw = m ? text.slice(0, m.index) : text
  const bodyRaw = m ? text.slice(m.index + m[0].length) : ''

  const headers = parseHeaders(headerRaw)
  const charsetIssues = []

  const ct = parseParamHeader(headers.get('content-type') || 'text/plain')
  const parts = ct.value.startsWith('multipart/') && ct.params.boundary
    ? splitMultipart(bodyRaw, ct.params.boundary)
    : null

  const attachments = []
  let plain = ''
  let html = ''

  /** 递归收集文本与附件。 */
  const walk = (partText, depth = 0) => {
    if (depth > 10) return
    const pm = /\r?\n\r?\n/.exec(partText)
    const hRaw = pm ? partText.slice(0, pm.index) : partText
    const bRaw = pm ? partText.slice(pm.index + pm[0].length) : ''
    const h = parseHeaders(hRaw)

    const pct = parseParamHeader(h.get('content-type') || 'text/plain')
    if (pct.value.startsWith('multipart/') && pct.params.boundary) {
      for (const child of splitMultipart(bRaw, pct.params.boundary)) walk(child, depth + 1)
      return
    }

    const enc = h.get('content-transfer-encoding') || ''
    const decoded = decodeTransfer(Buffer.from(bRaw, 'latin1'), enc)
    const disp = parseParamHeader(h.get('content-disposition') || '')
    const name = disp.params.filename || pct.params.name || ''
    const isAttachment = disp.value === 'attachment' || (!!name && !pct.value.startsWith('text/'))

    if (isAttachment) {
      attachments.push({
        filename: name || '(未命名)',
        contentType: pct.value || 'application/octet-stream',
        bytes: decoded.length,
        inline: disp.value === 'inline',
      })
      return
    }

    if (pct.value === 'text/plain' && !plain) {
      const { text: t, charset, replaced } = decodeBytes(decoded, pct.params.charset)
      if (replaced) charsetIssues.push(`text/plain 声称 ${charset}，解码有替换字符`)
      plain = t
    } else if (pct.value === 'text/html' && !html) {
      const { text: t, charset, replaced } = decodeBytes(decoded, pct.params.charset)
      if (replaced) charsetIssues.push(`text/html 声称 ${charset}，解码有替换字符`)
      html = t
    }
  }

  if (parts) {
    for (const p of parts) walk(p)
  } else {
    walk(text.slice(0, m ? m.index : text.length) + '\n\n' + bodyRaw)
  }

  const refs = (headers.get('references') || '')
    .split(/[\s,]+/).map(s => s.trim()).filter(Boolean)

  return {
    headers,
    subject: decodeRFC2047(headers.get('subject') || ''),
    from: decodeRFC2047(headers.get('from') || ''),
    to: decodeRFC2047(headers.get('to') || ''),
    date: headers.get('date') || null,
    messageId: (headers.get('message-id') || '').trim() || null,
    inReplyTo: (headers.get('in-reply-to') || '').trim() || null,
    references: refs,
    text: plain || htmlToText(html),
    html,
    attachments,
    charsetIssues,
  }
}

/**
 * 拆分 mbox 文件（按行首 "From " 分隔，非严格但够用）。
 * @param {string} content mbox 全文
 * @returns {string[]} 每封的原文（不含分隔行）
 */
export function splitMbox(content) {
  const lines = String(content).split(/\r?\n/)
  const out = []
  let cur = null
  for (const line of lines) {
    if (/^From .+@.+ \w{3} \w{3} .+ \d{4}/.test(line) || /^From .+ \d{4}$/.test(line)) {
      if (cur) out.push(cur.join('\n'))
      cur = []
      continue
    }
    if (cur) cur.push(line)
  }
  if (cur && cur.length) out.push(cur.join('\n'))
  return out
}
