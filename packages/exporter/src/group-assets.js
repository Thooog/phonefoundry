

import { collectAssetRefs } from '@phone-sim/shared'
import { assetFileName } from './sanitize-filename.js'

/**
 * @typedef {object} PlannedAsset
 * @property {string} assetId
 * @property {string} fileName  在 assets/ 里的名字（含真实扩展名）
 * @property {string} mimeType
 * @property {Blob} blob
 */

/**
 * @param {object} params
 * @param {object} params.work        WorkData（已裁剪）
 * @param {Map<string, Blob>|Record<string, Blob>} params.blobs assetId → 二进制
 * @returns {{ assets: PlannedAsset[], map: Record<string, string>, missing: string[] }}
 *   - `assets`：要写进 `assets/` 目录的文件，按 assetId 升序（保证同一份数据每次导出字节可控）
 *   - `map`：注入给作品端的 `assetId → fileName` 表（folder 模式用）
 *   - `missing`：被引用但取不到二进制的 assetId（作品里会显示占位，不该让导出失败）
 */
export function planAssetFiles({ work, blobs }) {
  const lookup = toBlobLookup(blobs)
  const metas = new Map()
  for (const meta of work?.assets ?? []) {
    if (meta?.id) metas.set(meta.id, meta)
  }

  const referenced = [...collectAssetRefs(work)].sort(compareIds)

  const assets = []
  const map = {}
  const missing = []
  /** 净化后撞名的兜底：理论上 assetId 唯一，但净化会删字符，必须防一手 */
  const usedNames = new Set()

  for (const assetId of referenced) {
    const blob = lookup.get(assetId)
    if (!blob) {
      missing.push(assetId)
      continue
    }
    const meta = metas.get(assetId)
    // 记录里的 mimeType 优先：它是入库时压缩产物的真实类型；
    // blob.type 在部分浏览器里是空串（IndexedDB 往返后偶尔丢失）
    const mimeType = meta?.mimeType || blob.type || ''
    const fileName = uniqueName(assetFileName(assetId, mimeType), usedNames)

    assets.push({ assetId, fileName, mimeType, blob })
    map[assetId] = fileName
  }

  return { assets, map, missing }
}

/** 稳定排序：不依赖 localeCompare（不同 ICU 数据下结果可能不同） */
function compareIds(a, b) {
  if (a === b) return 0
  return a < b ? -1 : 1
}

function toBlobLookup(blobs) {
  if (blobs instanceof Map) return blobs
  if (!blobs || typeof blobs !== 'object') return new Map()
  return new Map(Object.entries(blobs))
}

function uniqueName(fileName, used) {
  if (!used.has(fileName)) {
    used.add(fileName)
    return fileName
  }
  const dot = fileName.lastIndexOf('.')
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName
  const ext = dot > 0 ? fileName.slice(dot) : ''
  let i = 2
  while (used.has(`${stem}-${i}${ext}`)) i += 1
  const next = `${stem}-${i}${ext}`
  used.add(next)
  return next
}
