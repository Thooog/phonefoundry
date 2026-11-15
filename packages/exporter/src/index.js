

import { assertPlain, collectAssetRefs, createProject, toWorkData } from '@phone-sim/shared'
import { buildWorkHtml } from './build-html.js'
import { planAssetFiles } from './group-assets.js'
import { buildZip } from './pack-zip.js'
import { buildBackupManifest } from './manifest.js'
import {
  assetFileName,
  buildBackupFileName,
  buildWorkFileName,
  dateStamp,
  sanitizeFileName,
} from './sanitize-filename.js'
import { sizeHint, sizeTier } from './estimate.js'
export { buildWorkHtml, escapeHtmlText, escapeJsonForScriptNode } from './build-html.js'
export { planAssetFiles } from './group-assets.js'
export { buildZip, readZip, normalizeZipPath } from './pack-zip.js'
export {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  BACKUP_APP_ID,
  buildBackupManifest,
  countProject,
  isBackupManifest,
} from './manifest.js'
export { sizeTier, sizeHint, formatBytes, estimateExportSizes } from './estimate.js'
export {
  sanitizeFileName,
  assetFileName,
  extensionForMime,
  buildWorkFileName,
  buildBackupFileName,
  dateStamp,
} from './sanitize-filename.js'

export const EXPORT_FORMATS = Object.freeze({
  WORK_PACKAGE: 'work-package',
  STANDALONE_HTML: 'standalone-html',
  PROJECT_BACKUP: 'project-backup',
  CHARACTERS: 'characters',
})

/** 人物包沿用项目备份格式，导入后可直接以这些人物开始新作品。 */
export function buildCharacterProject(project) {
  if (!project || typeof project !== 'object') throw new TypeError('导出需要传入项目对象。')
  const characters = structuredClone(project.characters ?? [])
  const ids = new Set(characters.map((character) => character.id))
  const template = createProject({
    name: `${project.name || '未命名作品'} · 人物`,
    characters,
    platformAccounts: structuredClone((project.platformAccounts ?? []).filter((account) => ids.has(account.characterId))),
  })
  // 只携带人物与账号用到的图片；保留这些图片关联的原图，排除剧情图片。
  const refs = collectAssetRefs(template)
  const assets = new Map((project.assets ?? []).map((asset) => [asset.id, asset]))
  for (const id of refs) {
    const originalId = assets.get(id)?.originalAssetId
    if (originalId) refs.add(originalId)
  }
  template.assets = structuredClone((project.assets ?? []).filter((asset) => refs.has(asset.id)))
  for (const asset of template.assets) asset.projectId = template.id
  return template
}

export async function exportCharacters({ project, assets = new Map(), appVersion = '', now = new Date() }) {
  const template = buildCharacterProject(project)
  if (!template.characters.length) throw new Error('项目中还没有人物，请先创建人物再导出。')
  const result = await exportProjectBackup({ project: template, assets, appVersion, now })
  const assetIds = new Set(template.assets.map((asset) => asset.id))
  const missingMetadata = [...collectAssetRefs(template)].filter((id) => !assetIds.has(id))
  return {
    ...result,
    format: EXPORT_FORMATS.CHARACTERS,
    fileName: `${sanitizeFileName(project.name)}_人物包_${dateStamp(now)}.zip`,
    missing: [...new Set([...result.missing, ...missingMetadata])],
  }
}

export async function exportWorkPackage({
  project,
  assets = new Map(),
  player,
  mode = 'folder',
  now = new Date(),
}) {
  if (!project || typeof project !== 'object') {
    throw new TypeError('导出需要传入项目对象。')
  }
  if (!player?.js) {
    throw new Error('缺少作品端产物（renderer.js）。请先构建作品端再导出。')
  }

  // 1. 裁剪成作品数据。预览走的是同一个函数，这里是"预览即导出"的第一道保证
  const work = toWorkData(project)
  // 2. 守卫：确认能安全序列化。有函数/类实例混进来时，宁可现在失败，
  //    也不要导出一个双击打开白屏的文件
  assertPlain(work)

  const isInline = mode === 'inline'

  // 3. 规划资源。inline 模式同样需要清单（只是内容变成 dataURL 而不是文件）
  const plan = planAssetFiles({ work, blobs: assets })

  const assetEntries = []
  const assetMap = {}
  let assetBytes = 0

  for (const item of plan.assets) {
    const bytes = await toBytes(item.blob)
    assetBytes += bytes.length
    if (isInline) {
      assetMap[item.assetId] = toDataUrl(item.mimeType, bytes)
    } else {
      assetMap[item.assetId] = item.fileName
      assetEntries.push({ path: `assets/${item.fileName}`, bytes, binary: true })
    }
  }

  // 4. 生成 HTML
  const html = buildWorkHtml({
    title: work.title,
    work,
    player,
    assets: assetMap,
    mode: isInline ? 'inline' : 'folder',
    basePath: './assets/',
  })

  // 5. 打包
  const folder = `${sanitizeFileName(work.title)}_${dateStamp(now)}`
  let bytes
  let fileName

  if (isInline) {
    bytes = toBytesFromText(html)
    fileName = buildWorkFileName(work.title, now, 'html')
  } else {
    bytes = buildZip([{ path: `${folder}/index.html`, text: html }, ...prefixed(folder, assetEntries)])
    fileName = buildWorkFileName(work.title, now, 'zip')
  }

  return {
    format: isInline ? EXPORT_FORMATS.STANDALONE_HTML : EXPORT_FORMATS.WORK_PACKAGE,
    fileName,
    folder,
    bytes,
    size: bytes.length,
    html,
    assetCount: plan.assets.length,
    assetBytes,
    missing: plan.missing,
    tier: sizeTier(bytes.length),
    hint: sizeHint(bytes.length),
  }
}

/**
 * 独立 HTML 导出 —— 一个文件带走整个作品。
 *
 * 实现就是 `exportWorkPackage({ mode: 'inline' })`，因为两者的差异
 * **只有资源通道**：作品包把图片写成 `assets/*.webp` 并注入文件名表，
 * 独立 HTML 把同样的字节转成 dataURL 注入同一张表。
 * 模板、数据裁剪、转义、体积档位全部复用 —— 这样"预览 = 作品包 = 独立 HTML"
 * 不是靠人去对齐三份代码，而是结构上就没有第二份。
 *
 * 体积代价：base64 让二进制膨胀约 33%。这不是实现选择，是 base64 的定义，
 * 所以调用方在导出前必须把预估体积给用户看（见 estimate.js）。
 *
 * @param {{ project: object, assets?: Map|Record, player: {js: string, css: string}, now?: Date }} params
 * @returns {Promise<WorkPackageResult>}
 */
export async function exportStandaloneHtml({ project, assets = new Map(), player, now = new Date() }) {
  return exportWorkPackage({ project, assets, player, mode: 'inline', now })
}

export async function exportProjectBackup({
  project,
  assets = new Map(),
  appVersion = '',
  now = new Date(),
}) {
  if (!project || typeof project !== 'object') {
    throw new TypeError('导出需要传入项目对象。')
  }

  // 深拷贝一份再断言可序列化：调用方手里的项目对象是活的（Pinia 里还在被编辑），
  // 序列化过程中它可能正被 mutate。拷一份既避免这个竞态，也让下面的
  // "把真实文件名写回 assets 元信息"不会污染编辑态。
  let snapshot
  try {
    snapshot = structuredClone(project)
  } catch {
    throw new Error('项目数据里有无法拷贝的内容（可能是函数或类实例），无法备份。')
  }
  assertPlain(snapshot, 'project')

  const lookup = toLookup(assets)
  const assetEntries = []
  const missing = []
  let assetBytes = 0

  // 按 project.assets 的清单走，而不是按 lookup 的键：
  // 资源表是"这个项目声称自己有哪些图"，多出来的二进制属于别的项目或已废弃
  for (const meta of snapshot.assets ?? []) {
    if (!meta?.id) continue
    const blob = lookup.get(meta.id)
    if (!blob) {
      missing.push(meta.id)
      continue
    }
    const bytes = await toBytes(blob)
    assetBytes += bytes.length
    // 记录里的 mimeType 优先，理由同 planAssetFiles：IndexedDB 往返后 blob.type 可能是空串
    const mimeType = meta.mimeType || blob.type || ''
    const fileName = assetFileName(meta.id, mimeType)
    // 写回真实文件名，导入时就算 mimeType 丢了也能按名字找到文件
    meta.fileName = fileName
    if (!meta.mimeType) meta.mimeType = mimeType
    assetEntries.push({ path: `assets/${fileName}`, bytes, binary: true })
  }

  const manifest = buildBackupManifest({
    project: snapshot,
    assetCount: assetEntries.length,
    appVersion,
    now,
  })

  const bytes = buildZip([
    { path: 'manifest.json', text: JSON.stringify(manifest, null, 2) },
    { path: 'project.json', text: JSON.stringify(snapshot, null, 2) },
    ...assetEntries,
  ])

  return {
    format: EXPORT_FORMATS.PROJECT_BACKUP,
    fileName: buildBackupFileName(snapshot.name, now),
    bytes,
    size: bytes.length,
    manifest,
    assetCount: assetEntries.length,
    assetBytes,
    missing,
    tier: sizeTier(bytes.length),
    hint: sizeHint(bytes.length),
  }
}

/** Map 与普通对象都接受，统一成 Map */
function toLookup(blobs) {
  if (blobs instanceof Map) return blobs
  if (!blobs || typeof blobs !== 'object') return new Map()
  return new Map(Object.entries(blobs))
}

/** 把 assets/ 里的条目加上顶层目录前缀 */
function prefixed(folder, entries) {
  return entries.map((e) => ({ ...e, path: `${folder}/${e.path}` }))
}

/** Blob / Uint8Array / ArrayBuffer → Uint8Array */
async function toBytes(value) {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (value && typeof value.arrayBuffer === 'function') {
    return new Uint8Array(await value.arrayBuffer())
  }
  throw new TypeError('资源二进制必须是 Blob / Uint8Array / ArrayBuffer。')
}

function toBytesFromText(text) {
  // 不引 fflate 的 strToU8：这里要的是一个普通 UTF-8 编码的字节数组，
  // TextEncoder 在两端的可用性都比库函数更稳
  return new TextEncoder().encode(text)
}

/**
 * Uint8Array → dataURL。
 * 手写而不是用 FileReader：FileReader 只有浏览器有，而这段代码要在 Node 里被探针跑。
 */
function toDataUrl(mimeType, bytes) {
  const mime = mimeType || 'application/octet-stream'
  return `data:${mime};base64,${bytesToBase64(bytes)}`
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function bytesToBase64(bytes) {
  // 分块处理：一次拼接几十万个字符的字符串在某些引擎上会明显变慢
  const chunk = 0x8000
  let out = ''
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
  }
  return btoaOrManual(out)
}

/** Node 20 起有全局 btoa；仍然兜一个纯 JS 版本，避免老环境直接崩 */
function btoaOrManual(binary) {
  if (typeof btoa === 'function') return btoa(binary)
  let out = ''
  for (let i = 0; i < binary.length; i += 3) {
    const a = binary.charCodeAt(i)
    const b = binary.charCodeAt(i + 1)
    const c = binary.charCodeAt(i + 2)
    out += B64[a >> 2]
    out += B64[((a & 3) << 4) | (Number.isNaN(b) ? 0 : b >> 4)]
    out += Number.isNaN(b) ? '=' : B64[((b & 15) << 2) | (Number.isNaN(c) ? 0 : c >> 6)]
    out += Number.isNaN(c) ? '=' : B64[c & 63]
  }
  return out
}

/** 便于调用方少 import 一个函数：拿引用集合 */
export { collectAssetRefs }
