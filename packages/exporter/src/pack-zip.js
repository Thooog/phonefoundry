

import { strToU8, unzipSync, zipSync } from 'fflate'

/**
 * 文本的压缩级别。`index.html` 里主要是 JS/CSS 和作品数据，
 * 重复度很高，9 级压缩通常能从 190KB 压到 60KB 左右。
 */
const TEXT_LEVEL = 9

/**
 * 二进制的压缩级别：0（只存储）。
 *
 * 作品里的资源是 webp / png / jpg，本身已经压过一轮了，
 * 再跑一遍 deflate 通常只能再省 0~2%，却要在导出时把每张图完整读一遍并做 CPU 密集的熵编码。
 * 一张 3MB 的图会让导出卡住几百毫秒，换来几十 KB —— 不划算。
 */
const BINARY_LEVEL = 0

/**
 * @param {Array<{ path: string, text?: string, bytes?: Uint8Array, binary?: boolean }>} entries
 * @returns {Uint8Array} ZIP 字节
 */
export function buildZip(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('ZIP 内容为空：没有任何文件可打包。')
  }

  /** @type {Record<string, [Uint8Array, { level: number }]>} */
  const input = Object.create(null)
  for (const entry of entries) {
    if (!entry?.path) throw new Error('ZIP 条目缺少 path。')
    if (input[entry.path]) throw new Error(`ZIP 条目重名：${entry.path}`)

    const data = entry.text !== undefined ? strToU8(entry.text) : toBytes(entry.bytes)
    input[entry.path] = [data, { level: entry.binary ? BINARY_LEVEL : TEXT_LEVEL }]
  }

  return zipSync(input)
}

function toBytes(value) {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  throw new TypeError('ZIP 条目的内容必须是 Uint8Array / ArrayBuffer，或改用 text。')
}

/**
 * 解开 ZIP，返回 `路径 → 字节`。
 *
 * 导入备份包时用。两条必须守住的规则：
 *
 *  1. **路径穿越要挡在门外**。ZIP 条目名是攻击者可控的（`../../.bashrc`），
 *     解压到磁盘的库必须防这一手。这里虽然只在内存里读、不落盘，
 *     但把带 `..` 的条目直接丢掉更省事 —— 合法备份包里不可能有这种路径。
 *  2. **目录条目要滤掉**。部分打包工具会写入以 `/` 结尾的空条目，
 *     留着它们会让调用方误以为多了一个"文件"。
 *
 * 文件名的反斜杠统一成正斜杠：Windows 上打出来的包偶尔会用 `\` 当分隔符。
 *
 * @param {Uint8Array} bytes
 * @returns {Map<string, Uint8Array>}
 */
export function readZip(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError('readZip 需要 Uint8Array。')
  }
  if (!bytes.length) {
    throw new Error('压缩包是空的。')
  }

  let files
  try {
    files = unzipSync(bytes)
  } catch (err) {
    throw new Error(`压缩包读不出来，可能已损坏或不是 ZIP：${err?.message ?? err}`)
  }

  const out = new Map()
  for (const [rawPath, data] of Object.entries(files)) {
    if (/[\\/]$/.test(rawPath)) continue
    const path = normalizeZipPath(rawPath)
    if (!path || path.endsWith('/')) continue
    if (out.has(path)) throw new Error(`压缩包包含重复路径：${path}`)
    out.set(path, data)
  }
  return out
}

/**
 * ZIP 条目名归一化；不安全的路径返回空串（调用方据此丢弃）。
 * @param {string} path
 */
export function normalizeZipPath(path) {
  const slashed = String(path ?? '').replace(/\\/g, '/')
  // 绝对路径（/etc/x、C:/x）与任何带 `..` 的段一律拒绝
  if (slashed.startsWith('/') || /^[a-zA-Z]:/.test(slashed)) return ''
  const parts = slashed.split('/')
  if (parts.some((p) => p === '..')) return ''
  return parts.filter((p) => p && p !== '.').join('/')
}
