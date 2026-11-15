#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, URL } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

const RULES = [
  {
    name: 'shared 必须保持框架无关',
    dir: 'packages/shared/src',
    forbidden: [
      { pattern: /from\s+['"]vue['"]/, reason: '不得依赖 vue' },
      { pattern: /from\s+['"]pinia['"]/, reason: '不得依赖 pinia' },
      { pattern: /\bdocument\./, reason: '不得直接使用 DOM' },
      { pattern: /\bwindow\./, reason: '不得直接使用 window' },
      { pattern: /\blocalStorage\b/, reason: '不得直接使用 localStorage' },
      { pattern: /\bindexedDB\b/, reason: '不得直接使用 indexedDB' },
    ],
  },
  {
    name: 'player-ui 不得依赖编辑端',
    dir: 'packages/player-ui/src',
    forbidden: [
      { pattern: /@phone-sim\/creator|apps\/creator|@exporter|@phone-sim\/exporter/, reason: '不得依赖编辑端或导出器' },
      { pattern: /from\s+['"]pinia['"]/, reason: '作品端不得使用 pinia' },
      { pattern: /from\s+['"]vue-router['"]/, reason: '作品端不得使用 vue-router' },
    ],
  },
  {
    name: 'player 应用不得依赖编辑端',
    dir: 'apps/player/src',
    forbidden: [
      { pattern: /@phone-sim\/creator|apps\/creator|@exporter|@phone-sim\/exporter/, reason: '不得依赖编辑端或导出器' },
      { pattern: /from\s+['"]pinia['"]/, reason: '作品端不得使用 pinia' },
      { pattern: /from\s+['"]vue-router['"]/, reason: '作品端不得使用 vue-router' },
    ],
  },
]

const SCAN_EXT = new Set(['.js', '.mjs', '.vue', '.ts'])

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue
      walk(full, out)
    } else if (SCAN_EXT.has(path.extname(entry.name))) {
      out.push(full)
    }
  }
  return out
}

const violations = []

for (const rule of RULES) {
  const dir = path.join(ROOT, rule.dir)
  const files = walk(dir)
  for (const file of files) {
    const code = fs.readFileSync(file, 'utf8')
    const lines = code.split(/\r?\n/)
    for (const { pattern, reason } of rule.forbidden) {
      lines.forEach((line, i) => {
        // 允许在注释里说明规则本身（整行注释 / 行尾注释 / 块注释内）
        const trimmed = line.trim()
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return
        const noTrailingComment = line.split('//')[0]
        if (pattern.test(noTrailingComment)) {
          violations.push({
            rule: rule.name,
            file: path.relative(ROOT, file),
            line: i + 1,
            reason,
            text: trimmed.slice(0, 120),
          })
        }
      })
    }
  }
}

if (violations.length === 0) {
  console.log('[boundaries] 通过：3 条边界规则，无违规。')
  process.exit(0)
}

console.error(`[boundaries] 发现 ${violations.length} 处违规：\n`)
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}  [${v.rule}]`)
  console.error(`    原因：${v.reason}`)
  console.error(`    代码：${v.text}`)
  console.error('')
}
process.exit(1)
