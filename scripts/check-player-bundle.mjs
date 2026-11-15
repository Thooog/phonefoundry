#!/usr/bin/env node

import fs from 'node:fs'
import zlib from 'node:zlib'
import path from 'node:path'
import { fileURLToPath, URL } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const DIST = path.join(ROOT, 'apps/player/dist')

const BUDGET = {
  js: 380 * 1024,
  css: 140 * 1024,
}

/** 参考线（不阻断）：gzip 合计超过它就该考虑拆 CSS 或回收重复样式 */
const GZIP_HINT = 160 * 1024

/** 允许出现在 dist 的文件名（白名单） */
const ALLOWED = new Set(['renderer.js', 'renderer.css', 'preview.html'])

/** 禁止出现在产物里的库标识 */
const FORBIDDEN_MARKERS = [
  { marker: 'pinia', label: 'pinia' },
  { marker: 'vue-router', label: 'vue-router' },
  { marker: 'fflate', label: 'fflate' },
  { marker: 'defineStore', label: 'pinia store' },
  { marker: 'createWebHistory', label: 'vue-router history' },
]

const problems = []
const info = []

if (!fs.existsSync(DIST)) {
  console.error(`[bundle] 产物目录不存在：${DIST}`)
  console.error('[bundle] 请先运行 pnpm build:player')
  process.exit(1)
}

const files = fs.readdirSync(DIST, { withFileTypes: true })

// 1. 白名单
for (const entry of files) {
  if (entry.isDirectory()) {
    // 允许空 assets 目录（未来放字体等），但出现内容需人工确认
    const sub = fs.readdirSync(path.join(DIST, entry.name))
    if (sub.length > 0) {
      problems.push(`出现非预期目录 ${entry.name}/，内含：${sub.join(', ')}`)
    }
    continue
  }
  if (!ALLOWED.has(entry.name)) {
    problems.push(`出现非预期文件 ${entry.name}（说明发生了 code splitting 或额外资源）`)
  }
}

const jsPath = path.join(DIST, 'renderer.js')
const cssPath = path.join(DIST, 'renderer.css')

if (!fs.existsSync(jsPath)) problems.push('缺少 renderer.js')
if (!fs.existsSync(cssPath)) problems.push('缺少 renderer.css')

let jsSize = 0
let cssSize = 0

if (fs.existsSync(jsPath)) {
  const js = fs.readFileSync(jsPath, 'utf8')
  jsSize = Buffer.byteLength(js, 'utf8')

  // 2. 体积
  if (jsSize > BUDGET.js) {
    problems.push(`renderer.js ${kb(jsSize)} 超出预算 ${kb(BUDGET.js)}`)
  }

  // 3. 禁用库
  for (const { marker, label } of FORBIDDEN_MARKERS) {
    // 只检测出现在 import/require/包名上下文中的情况，避免误伤普通单词
    const re = new RegExp(`require\\(\\s*['"]${marker}|from\\s*['"]${marker}|node_modules/${marker}`)
    if (re.test(js)) {
      problems.push(`renderer.js 中含有被禁止的库：${label}`)
    }
  }

  // 4. ESM 残留
  if (/^\s*import\s+[\w{*]/m.test(js) || /^\s*export\s+(default|const|function|\{)/m.test(js)) {
    problems.push('renderer.js 中残留 ESM import/export 语句（file:// 下会加载失败）')
  }

  info.push(`renderer.js  ${kb(jsSize)}`)
}

if (fs.existsSync(cssPath)) {
  const css = fs.readFileSync(cssPath, 'utf8')
  cssSize = Buffer.byteLength(css, 'utf8')
  if (cssSize > BUDGET.css) {
    problems.push(`renderer.css ${kb(cssSize)} 超出预算 ${kb(BUDGET.css)}`)
  }
  if (/@import\s+url\(/i.test(css)) {
    problems.push('renderer.css 中存在远程 @import（作品端必须零外部请求）')
  }
  info.push(`renderer.css ${kb(cssSize)}`)
}

const total = jsSize + cssSize
info.push(`合计        ${kb(total)}`)

// gzip 后体积：真正影响"打开一颗多久"的量，只提示不阻断
const gzipTotal =
  (fs.existsSync(jsPath) ? gzipSize(fs.readFileSync(jsPath)) : 0) +
  (fs.existsSync(cssPath) ? gzipSize(fs.readFileSync(cssPath)) : 0)
info.push(`gzip 合计   ${kb(gzipTotal)}`)
if (gzipTotal > GZIP_HINT) {
  info.push(`（提示：gzip 已超 ${kb(GZIP_HINT)}，该回收重复样式或拆包了）`)
}

console.log('[bundle] 产物清单：')
for (const line of info) console.log(`  ${line}`)

if (problems.length > 0) {
  console.error(`\n[bundle] 发现 ${problems.length} 个问题：`)
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}

console.log('[bundle] 通过：单一 JS + 单一 CSS，无第三方库，体积在预算内。')
process.exit(0)

function kb(bytes) {
  return `${(bytes / 1024).toFixed(1)}KB`
}

function gzipSize(buffer) {
  return zlib.gzipSync(buffer, { level: 9 }).length
}
