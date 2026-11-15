

import { isBackupManifest, normalizeZipPath, readZip } from '@exporter'
import { assertProject } from '@phone-sim/shared'

/** 导入来源。UI 用它在确认框里说"这是一份备份"还是"只是一份数据" */
export const IMPORT_KIND = Object.freeze({
  BACKUP: 'backup',
  BARE_JSON: 'bare-json',
})

/** ZIP 本地文件头魔数 */
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]

/**
 * @typedef {object} ParsedImport
 * @property {'backup'|'bare-json'} kind
 * @property {object} project                未换 id 的原始项目数据
 * @property {Map<string, Blob>} blobs       旧 assetId → 二进制（裸 JSON 时为空）
 * @property {object|null} manifest         备份包的 manifest；裸 JSON 为 null
 * @property {string[]} missingAssets       声明了但包里找不到文件的 assetId
 */

/**
 * 解析一个用户选择的文件。
 *
 * @param {File|Blob} file
 * @returns {Promise<ParsedImport>}
 */
export async function parseImportFile(file) {
  if (!file || typeof file.arrayBuffer !== 'function') {
    throw new Error('没有选到文件。')
  }
  if (file.size === 0) {
    throw new Error('这个文件是空的。')
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  return looksLikeZip(bytes) ? parseBackupZip(bytes) : parseBareJson(bytes)
}

/**
 * 解析作品备份包（ZIP）。
 *
 * @param {Uint8Array} bytes
 * @returns {ParsedImport}
 */
export function parseBackupZip(bytes) {
  const files = readZip(bytes)

  const projectPath = findProjectEntry(files)
  if (!projectPath) {
    throw new Error(
      '这个压缩包里没有 project.json。' +
        '如果这是导出的作品包（给读者看的那种），它不能导入 —— ' +
        '导入需要「项目备份包」。',
    )
  }

  const project = readJsonEntry(files, projectPath, 'project.json')
  assertProject(project)

  // manifest 可缺：它不是真相来源，只是身份证明。
  // 缺了就当"可能是别的工具打的包"，让 validateProject 去判断能不能用。
  const manifest = readOptionalJson(files, 'manifest.json')
  if (manifest && !isBackupManifest(manifest)) {
    // 有 manifest 但不是我们的格式 —— 大概率是别的软件的同名文件
    throw new Error('这个压缩包的 manifest 不是本工具生成的备份，无法导入。')
  }

  const { blobs, missingAssets } = collectAssetBlobs(files, project)

  return {
    kind: IMPORT_KIND.BACKUP,
    project,
    blobs,
    manifest: manifest ?? null,
    missingAssets,
  }
}

export function parseBareJson(bytes) {
  let data
  try {
    data = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new Error('这个文件既不是 ZIP 包，也不是合法的 JSON。')
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('JSON 顶层应该是一个对象。')
  }

  // 单飞的 manifest 会被误当项目导入 —— 它的字段（format / counts）看着也挺像
  if (isBackupManifest(data)) {
    throw new Error(
      '这是备份包的 manifest.json，不含项目内容。请导入整个 .zip 备份包。',
    )
  }

  // 兼容两种写法：直接是项目对象，或 `{ project: {...} }` 包了一层
  const project =
    data.project && typeof data.project === 'object' && !Array.isArray(data.project)
      ? data.project
      : data

  if (!Array.isArray(project.characters)) {
    throw new Error('这份 JSON 不像项目数据（缺少角色列表）。')
  }

  assertProject(project)

  return {
    kind: IMPORT_KIND.BARE_JSON,
    project,
    blobs: new Map(),
    manifest: null,
    missingAssets: (project.assets ?? []).map((a) => a?.id).filter(Boolean),
  }
}

// ───────────────────── 内部 ─────────────────────

function looksLikeZip(bytes) {
  if (bytes.length < 4) return false
  return ZIP_MAGIC.every((b, i) => bytes[i] === b)
}

/**
 * 找 project.json。允许它在一层子目录里：
 * 用户可能把备份包解压后重新压缩成 `备份/project.json`，那也该能导入。
 */
function findProjectEntry(files) {
  if (files.has('project.json')) return 'project.json'
  for (const path of files.keys()) {
    if (path.endsWith('/project.json') && path.split('/').length === 2) return path
  }
  return ''
}

function readJsonEntry(files, path, label) {
  const data = files.get(path)
  if (!data) throw new Error(`压缩包里缺少 ${label}。`)
  try {
    return JSON.parse(new TextDecoder().decode(data))
  } catch {
    throw new Error(`${label} 不是合法的 JSON，文件可能已损坏。`)
  }
}

function readOptionalJson(files, name) {
  if (!files.has(name)) return null
  try {
    return JSON.parse(new TextDecoder().decode(files.get(name)))
  } catch {
    return null
  }
}

/**
 * 按 project.json 的资源清单从包里取二进制。
 * @returns {{ blobs: Map<string, Blob>, missingAssets: string[] }}
 */
function collectAssetBlobs(files, project) {
  const blobs = new Map()
  const missingAssets = []

  // 只扫一次 assets/ 下的条目名，供第三种找法用
  const assetPaths = [...files.keys()].filter((p) => p.startsWith('assets/'))

  for (const asset of project.assets ?? []) {
    if (!asset?.id) continue
    const path = resolveAssetPath(files, assetPaths, asset)
    const data = path ? files.get(path) : null
    if (!data) {
      missingAssets.push(asset.id)
      continue
    }
    const mime = asset.mimeType || mimeFromPath(path)
    blobs.set(asset.id, new Blob([data], { type: mime }))
  }

  return { blobs, missingAssets }
}

function resolveAssetPath(files, assetPaths, asset) {

  if (asset.fileName) {
    const recorded = normalizeZipPath(`assets/${asset.fileName}`)
    if (recorded && files.has(recorded)) return recorded
  }
  // 2. 按 mimeType 现算
  const computed = normalizeZipPath(`assets/${asset.id}.${extensionOf(asset.mimeType)}`)
  if (computed && files.has(computed)) return computed
  // 3. 同 id 任意扩展名
  const prefix = `assets/${asset.id}.`
  return assetPaths.find((p) => p.startsWith(prefix)) ?? ''
}

/** 只在扩展名兜底时用；不认识就当 webp，比 `bin` 更可能是对的 */
function extensionOf(mimeType) {
  const map = {
    'image/webp': 'webp',
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/gif': 'gif',
    'image/avif': 'avif',
    'image/svg+xml': 'svg',
  }
  return map[String(mimeType ?? '').split(';')[0].trim().toLowerCase()] ?? 'webp'
}

function mimeFromPath(path) {
  const ext = String(path).split('.').pop()?.toLowerCase()
  const map = {
    webp: 'image/webp',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    avif: 'image/avif',
    svg: 'image/svg+xml',
  }
  return map[ext] ?? 'image/webp'
}
