

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

/** 中央目录里的单条记录（file header）固定 46 字节，后面跟变长的名字/扩展/注释 */
const CD_HEADER_SIZE = 46
const CD_SIG = 0x02014b50
const EOCD_SIG = 0x06054b50
const EOCD_SIZE = 22
/** EOCD 尾部允许跟注释，长度字段是 16 位，所以最多往回找 64KB */
const MAX_COMMENT = 0xffff
/** ZIP64 占位符：真实大小写在扩展字段里，这里不解析 */
const ZIP64_MARKER = 0xffffffff

/**
 * 中央目录里声明的"全部条目解压后总字节"。
 *
 * 为什么要先看这个：`unzipSync` 会把所有条目一次性摊到内存里，
 * 而 deflate 的压缩比可以到 1000:1 —— 一个几 MB 的包声称解压后有几十 GB 时，
 * 光靠"压缩包多大"是挡不住的，等它真的解开，标签页已经 OOM 崩了
 * （而崩掉的同时，用户没保存的改动一起没了）。
 *
 * 只读目录、不解压，代价是几百字节的解析。
 *
 * @param {Uint8Array} bytes
 * @returns {number|null} 总字节；结构读不出来时返回 null（表示"没有结论"）。
 *   声明超过 4GB（ZIP64）时直接返回 Infinity —— 合法备份包远到不了这个量级。
 */
export function declaredUnzipBytes(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < EOCD_SIZE) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  // EOCD 在文件尾，可能带注释，所以从后往前扫
  let eocd = -1
  const stop = Math.max(0, bytes.length - EOCD_SIZE - MAX_COMMENT)
  for (let i = bytes.length - EOCD_SIZE; i >= stop; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) {
      eocd = i
      break
    }
  }
  if (eocd < 0) return null

  const count = view.getUint16(eocd + 10, true)
  const cdOffset = view.getUint32(eocd + 16, true)
  if (count === 0xffff || cdOffset === ZIP64_MARKER) return Infinity

  let offset = cdOffset
  let total = 0
  for (let i = 0; i < count; i++) {
    if (offset + CD_HEADER_SIZE > bytes.length) return null
    if (view.getUint32(offset, true) !== CD_SIG) return null
    const uncompressed = view.getUint32(offset + 24, true)
    if (uncompressed === ZIP64_MARKER) return Infinity
    total += uncompressed
    offset +=
      CD_HEADER_SIZE +
      view.getUint16(offset + 28, true) + // 文件名长度
      view.getUint16(offset + 30, true) + // 扩展字段长度
      view.getUint16(offset + 32, true) // 注释长度
  }
  return total
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
