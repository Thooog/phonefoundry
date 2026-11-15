

import * as repo from '../db/repository.js'

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('读取图片失败'))
    reader.readAsDataURL(blob)
  })
}

/**
 * @param {object|null} project SourceProject
 * @returns {Promise<Record<string, string>>} assetId → dataURL
 */
export async function collectPreviewAssets(project) {
  const records = Array.isArray(project?.assets) ? project.assets : []
  if (!records.length) return {}

  let blobs
  try {
    blobs = await repo.getAssetBlobs(records.map((a) => a.id))
  } catch {
    // 读不到资源不该让预览整体失败：渲染层对缺失资源有占位降级
    return {}
  }

  const out = {}
  for (const [assetId, blob] of blobs) {
    try {
      out[assetId] = await blobToDataUrl(blob)
    } catch {
      /* 单张失败就跳过，交给占位 */
    }
  }
  return out
}

/** 资源元信息的指纹：变了才重新编码 dataURL，避免每次编辑都重读全部图片 */
export function assetsFingerprint(project) {
  const records = Array.isArray(project?.assets) ? project.assets : []
  return records.map((a) => `${a.id}:${a.byteSize ?? 0}`).join('|')
}
