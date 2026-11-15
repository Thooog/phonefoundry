import { ESLint } from 'eslint'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
// Only maintained command entry points; scratch probes and browser profiles are not source.
const scripts = [...new Set(Object.values(pkg.scripts).flatMap(command => [...command.matchAll(/node (scripts\/[\w.-]+\.mjs)/g)].map(match => match[1])))]
const eslint = new ESLint({ cwd: root, fix: process.argv.includes('--fix') })
const results = await eslint.lintFiles([
  'apps/*/src/**/*.{js,vue}', 'packages/*/src/**/*.{js,vue}',
  'apps/*/vite.config.js', ...scripts, 'scripts/lib/*.mjs',
  'scripts/vitest.setup.js', 'eslint.config.js', 'vitest.config.js',
])
if (process.argv.includes('--fix')) await ESLint.outputFixes(results)
const formatter = await eslint.loadFormatter('stylish')
const report = formatter.format(results)
if (report) console.log(report)
const errors = results.reduce((sum, result) => sum + result.errorCount, 0)
const warnings = results.reduce((sum, result) => sum + result.warningCount, 0)
console.log(`[lint] ${results.length} files; ${errors} errors; ${warnings} warnings`)
process.exitCode = errors ? 1 : 0
