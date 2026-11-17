#!/usr/bin/env node
/**
 * check.mjs —— 装机前自检（`npm run check`）。
 *
 * 五道闸门，任何一道不过就退出 1：
 *  1) 包结构：必需字段、files 白名单、零运行时依赖、main 存在
 *  2) 语法：所有 .mjs 过 `node --check`
 *  3) 命名四处同源：package.name = cordis patch 的 id/name = naming.json 的包名与工具名
 *  4) 假 ctx 真加载：apply() 能注册出 dsh_mailbox，且参数 schema 合法
 *  5) 红线：不 import @deepseek-ai/*、不用网络模块、不写文件、不用 eval/child_process
 *
 * 只读：不写任何文件。
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import * as plugin from '../plugin.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const problems = []
const fail = (m) => problems.push(m)

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const naming = JSON.parse(readFileSync(join(root, 'dsh-plugin.naming.json'), 'utf8'))
const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')

// ── 1) 包结构 ──
for (const field of ['name', 'version', 'description', 'license', 'type', 'main']) {
  if (!pkg[field]) fail(`package.json 缺字段 ${field}`)
}
if (pkg.type !== 'module') fail('package.json 的 type 必须是 module')
if (!pkg.dsh?.bundle?.patch) fail('缺 dsh.bundle.patch')
if (!pkg.files?.includes('lib/')) fail('files 白名单必须包含 lib/')
if (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) fail('不允许有运行时依赖')
if (!existsSync(join(root, pkg.main))) fail(`main 指向的文件不存在：${pkg.main}`)
if (!existsSync(join(root, pkg.dsh.bundle.patch))) fail('dsh.bundle.patch 指向的文件不存在')

// ── 2) 语法 ──
function listModules(dir = join(root, 'lib')) {
  const out = []
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name)
    if (ent.isDirectory()) out.push(...listModules(p))
    else if (ent.name.endsWith('.mjs')) out.push(p)
  }
  return out
}
const targets = [join(root, 'plugin.mjs'), ...listModules()]
for (const t of targets) {
  try {
    execFileSync(process.execPath, ['--check', t], { stdio: 'pipe' })
  } catch (e) {
    fail(`语法错误 ${relative(root, t)}: ${String(e.stderr || e.message).split('\n')[0]}`)
  }
}

// ── 3) 命名四处同源 ──
if (naming.plugin?.packageName !== pkg.name) {
  fail(`naming.json 包名 ${naming.plugin?.packageName} ≠ package.json ${pkg.name}`)
}
if (!patch.includes(`id: ${pkg.name}`)) fail(`cordis.patch.yml 缺 id: ${pkg.name}`)
if (!patch.includes(`name: ${pkg.name}`)) fail(`cordis.patch.yml 缺 name: ${pkg.name}`)
const declaredTool = naming.names?.tools?.[0]
if (!declaredTool) fail('naming.json 未声明 tools')

// ── 4) 假 ctx 真加载 ──
const registered = []
const ctx = { tools: { register: (d) => registered.push(d) }, logger: { info: () => {} } }
try {
  plugin.apply(ctx, {})
} catch (e) {
  fail(`apply() 抛错：${e.message}`)
}
if (registered.length !== 1) fail(`应注册 1 个工具，实际 ${registered.length}`)
const def = registered[0]
if (def?.name !== declaredTool) fail(`注册工具名 ${def?.name} ≠ naming.json 的 ${declaredTool}`)
if (def?.parameters?.type !== 'object') fail('parameters 必须是 object schema')
if (!def?.output?.schema) fail('缺 output.schema')
if (typeof def?.execute !== 'function') fail('缺 execute')
if (typeof plugin.name !== 'string' || plugin.name !== pkg.name) fail('插件导出 name 必须等于包名')

// ── 5) 红线 ──
const RED_LINES = [
  { re: /from\s+['"]@deepseek-ai\//, msg: '不得 import @deepseek-ai/*（会与宿主各存一份 cordis）' },
  { re: /from\s+['"]node:(http|https|net|dns|tls|dgram)['"]/, msg: '不得使用网络模块（本包承诺离线）' },
  { re: /\b(eval|new Function)\s*\(/, msg: '不得使用 eval / new Function' },
  { re: /from\s+['"]node:child_process['"]/, msg: '不得使用 child_process（插件只读档案）' },
  { re: /\b(writeFile|appendFile|createWriteStream|unlink|rmSync|renameSync|mkdirSync)\b/, msg: '不得写文件（本包承诺只读）' },
]
for (const t of targets) {
  const src = readFileSync(t, 'utf8')
  for (const { re, msg } of RED_LINES) {
    if (re.test(src)) fail(`${msg}（${relative(root, t)}）`)
  }
}

// ── 6) README 必需段落 ──
const readmePath = join(root, 'README.md')
if (!existsSync(readmePath)) fail('缺 README.md')
else {
  const readme = readFileSync(readmePath, 'utf8')
  for (const need of ['安装', '明确不做什么', '只读']) {
    if (!readme.includes(need)) fail(`README.md 缺段落/关键词：${need}`)
  }
}

// ── 汇总 ──
if (problems.length) {
  console.error(`✖ 自检未通过（${problems.length} 项）：`)
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}
console.log(`✓ 自检通过：结构 / 语法 / 命名 / 加载 / 红线 / README（${targets.length} 个模块）`)
