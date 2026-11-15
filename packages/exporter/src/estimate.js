

import { SIZE_THRESHOLDS } from '@phone-sim/shared'

/**
 * @param {number} bytes
 * @returns {'ok'|'notice'|'warn'|'strong'}
 */
export function sizeTier(bytes) {
  const n = Number(bytes) || 0
  if (n >= SIZE_THRESHOLDS.STRONG) return 'strong'
  if (n >= SIZE_THRESHOLDS.WARN) return 'warn'
  if (n >= SIZE_THRESHOLDS.NOTICE) return 'notice'
  return 'ok'
}

/**
 * 档位对应的一句话提示；`ok` 不提示。
 * 话术遵循"告诉他后果"而不是"告诉他数字超了"：
 * 用户能理解的限制是"微信发不出去"，不是"超过 8MB 阈值"。
 * @param {number} bytes
 * @returns {string}
 */
export function sizeHint(bytes) {
  switch (sizeTier(bytes)) {
    case 'strong':
      return '体积较大，微信、邮件等渠道可能发不出去，建议用链接或网盘分享。'
    case 'warn':
      return '体积偏大，部分聊天工具会拒绝接收这个大小的文件。'
    case 'notice':
      return '图片较多，打开时可能需要等一两秒。'
    default:
      return ''
  }
}

/**
 * 人类可读的体积。用 1024 进制并保留一位小数：
 * 用户看到的"12.2MB"应该和系统文件管理器里的数字对得上。
 * 整数时不带 `.0`（写"98MB"而不是"98.0MB"）。
 * @param {number} bytes
 */
export function formatBytes(bytes) {
  const n = Number(bytes) || 0
  if (n < 1024) return `${n}B`
  const units = ['KB', 'MB', 'GB']
  let value = n / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i += 1
  }
  const rounded = Math.round(value * 10) / 10
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}${units[i]}`
}

/** base64 相对原始二进制的膨胀倍数（4/3，不是估算） */
const BASE64_RATIO = 4 / 3

const TEXT_ZIP_RATIO = 0.3

/**
 * 导出前的体积预估。
 *
 * ── 为什么不精确 ──
 *
 * 精确体积要真的把每一步跑一遍（读全部图片、做 base64、跑 deflate），
 * 那正是"导出"本身，预估就失去意义了。所以这里分两块算：
 *
 *  - **资源**：可靠的。ZIP 里资源以 level 0（仅存储）写入，大小 = 原始字节；
 *    独立 HTML 里以 base64 写入，大小 = 原始字节 × 4/3。这部分几乎无误差。
 *  - **文本**：不可靠的。JS/CSS/JSON 的 deflate 后大小取决于内容重复度，
 *    只能给一个经验系数。这是误差的唯一来源，且它只占小作品体积的零头。
 *
 * 误差特征：资源越多，相对误差越小（资源部分准，文本部分占比低）。
 * 纯文字作品（0 张图）误差最大，那种作品总大小也就 200KB 量级，差 20KB 无感。
 *
 * @param {object} params
 * @param {object} [params.work]         已裁剪的 WorkData（作品包 / 独立 HTML 用）
 * @param {object} [params.project]      完整项目（备份包用）
 * @param {{ js: string, css: string }} [params.player]
 * @param {number} [params.assetBytes]   资源原始字节合计
 * @returns {{ workPackage: number, standaloneHtml: number, projectBackup: number }}
 *   HTML 外壳（<style>/<script>/<div> 标签与换行）的固定开销已计入
 */
export function estimateExportSizes({ work, project, player, assetBytes = 0 }) {
  const jsBytes = textBytes(player?.js) + textBytes(player?.css)
  // 数据要序列化一次才知道多大；这里只估大小，不保留字符串
  const workDataBytes = textBytes(JSON.stringify(work ?? {}))
  const projectDataBytes = textBytes(JSON.stringify(project ?? {}))

  /** 外壳本身：doctype、<style>、<script> 标签、注入脚本，几百字节量级 */
  const SHELL_OVERHEAD = 512

  const workHtmlRaw = jsBytes + workDataBytes + SHELL_OVERHEAD
  const backupTextRaw = projectDataBytes + 1024 // project.json + manifest.json

  const assets = Math.max(0, Number(assetBytes) || 0)

  return {
    workPackage: Math.round(assets + workHtmlRaw * TEXT_ZIP_RATIO),
    standaloneHtml: Math.round(assets * BASE64_RATIO + workHtmlRaw),
    projectBackup: Math.round(assets + backupTextRaw * TEXT_ZIP_RATIO),
  }
}

function textBytes(text) {
  if (!text) return 0
  // 中文在 UTF-8 下是 3 字节，不能用 length 代替
  return new TextEncoder().encode(String(text)).length
}
