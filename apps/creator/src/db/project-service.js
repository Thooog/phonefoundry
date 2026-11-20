

import {
  createId,
  createAsset,
  createProject,
  createSampleProject,
  ID_PREFIX,
  prepareProject,
  summarizeHomeLayoutLoss,
} from '@phone-sim/shared'
import * as repo from './repository.js'
import { rewriteAssetRefs, rewriteAssetInternalRefs } from './asset-refs.js'
import { lockLostError } from './errors.js'

const RECENT_KEY = 'recentProjectId'

/** 项目名上限：列表页单行显示，太长的名字会被截断成一片省略号 */
const MAX_NAME_LENGTH = 80

/**
 * 归一化项目名：去空白、限长、空则回落到默认名。
 *
 * 不在这里抛错 —— "用户把名字删空了"是常见操作，
 * 直接回落到"未命名作品"比弹一个错误框友好得多。
 */
function normalizeName(raw) {
  const trimmed = String(raw ?? '').trim().slice(0, MAX_NAME_LENGTH)
  return trimmed || '未命名作品'
}

/**
 * 丢掉深值为 `undefined` 的键。
 *
 * `undefined` 不是 JSON 值：它进不了 `JSON.stringify`，也过不了作品数据的
 * `assertPlain()` 守卫。旧版本在复制 / 导入项目时，会给本来没有这个字段的
 * 记录（X 的回复、Instagram 的评论、相簿封面……）凭空补一个 `undefined`
 * —— 于是那份项目从此导出作品、导出备份都报
 * 「work.appData.x.replies[0].mediaAssetIds 类型为 undefined，无法安全序列化」。
 *
 * 补在读取端：用户不用重做项目，打开一次、保存一次就自动写回干净数据。
 */
function dropUndefinedKeys(value) {
  if (Array.isArray(value)) return value.map(dropUndefinedKeys)
  if (!value || typeof value !== 'object') return value
  // Date / Blob 等非纯对象原样返回，别把类型拆散
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) return value
  const out = {}
  for (const [k, v] of Object.entries(value)) {
    if (v === undefined) continue
    out[k] = dropUndefinedKeys(v)
  }
  return out
}

// ───────────────────── 读取 ─────────────────────

export async function listProjects() {
  const rows = await repo.listSummaries()
  return rows.slice().sort(byUpdatedDesc)
}

function byUpdatedDesc(a, b) {
  const byUpdated = String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? ''))
  if (byUpdated !== 0) return byUpdated
  const byCreated = String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? ''))
  if (byCreated !== 0) return byCreated
  // 两个时间戳都相等：保持原数组顺序（Array.prototype.sort 在 ES2019 后保证稳定），
  // 至少同一次会话内不会来回跳。真正区分靠写入侧的单调时钟。
  return 0
}

let lastStamp = 0
export function monotonicIso() {
  let ms = Date.now()
  if (ms <= lastStamp) ms = lastStamp + 1
  lastStamp = ms
  return new Date(ms).toISOString()
}

/** 读取项目；不存在返回 null（列表里的过期项不该让页面崩） */
export async function readProject(projectId) {
  if (!projectId) return null
  const record = (await repo.getProject(projectId)) ?? null
  // 顺带清掉历史遗留的 `undefined` 键（见 dropUndefinedKeys）
  return record ? dropUndefinedKeys(record) : null
}

/** 落盘项目 —— 必须带当前锁凭据；仓储层会在同一事务内复核 */
export async function writeProject(project, lockContext, removedAssetIds = []) {
  const result = await repo.saveProjectWithLock(project, lockContext, removedAssetIds)
  if (!result.saved) throw lockLostError(result.reason)
}

// ───────────────────── 新建 ─────────────────────

export async function createProjectRecord(input = {}) {
  const ts = monotonicIso()
  const project = createProject({
    name: normalizeName(input.name),
    projectDescription: String(input.projectDescription ?? '').trim(),
    // 覆盖 factory 里同一毫秒可能重复的时间戳，保证列表顺序确定
    createdAt: ts,
    updatedAt: ts,
  })
  await repo.saveProject(project)
  await setRecentProjectId(project.id)
  return project
}

/**
 * 创建一个中性功能展示项目（占位人物、账号与各应用样本）。
 *
 * 示例项目**不带任何图片资源**，所以不需要写 assets 表，
 * 走的是和 createProjectRecord 相同的落盘路径。
 *
 * @param {object} [overrides]
 * @returns {Promise<object>}
 */
export async function createSample(input = {}) {
  const ts = monotonicIso()
  const project = createSampleProject({
    name: normalizeName(input.name ?? '功能展示 · 从这里开始'),
    createdAt: ts,
    updatedAt: ts,
  })
  await repo.saveProject(project)
  await setRecentProjectId(project.id)
  return project
}

// ───────────────────── 修改 ─────────────────────

export async function renameProject(projectId, nextName) {
  const result = await repo.renameProject(projectId, normalizeName(nextName), monotonicIso())
  if (result.renamed) return result.project
  if (result.reason === 'held_by_other') {
    throw new Error('该项目仍在编辑中，请先关闭编辑页后再重命名。')
  }
  throw new Error('要重命名的项目不存在，可能已被删除。')
}

/**
 * 删除项目及其全部资源（单事务）。
 * @returns {Promise<{ removedAssets: number }>}
 */
export async function deleteProject(projectId) {
  const removedAssets = await repo.removeProject(projectId)
  if ((await getRecentProjectId()) === projectId) await repo.deleteMeta(RECENT_KEY)
  return { removedAssets }
}

// ───────────────────── 最近打开 ─────────────────────

export async function setRecentProjectId(projectId) {
  await repo.setMeta(RECENT_KEY, projectId)
}

export async function getRecentProjectId() {
  try {
    return await repo.getMeta(RECENT_KEY)
  } catch {
    return null
  }
}

/** 取最近打开且仍然存在的项目 id —— 项目可能已被删除，必须校验存在性 */
export async function resolveRecentProjectId() {
  const id = await getRecentProjectId()
  if (!id) return null
  const project = await repo.getProject(id)
  return project ? id : null
}

// ───────────────────── 复制 ─────────────────────

export async function duplicateProject(sourceProjectId) {
  const source = await repo.getProject(sourceProjectId)
  if (!source) throw new Error('要复制的项目不存在，可能已被删除。')
  return cloneProject(source, sourceProjectId)
}

export async function duplicateFromSnapshot(snapshot) {
  if (!snapshot) throw new Error('没有可保存的内容。')
  return cloneProject(snapshot, snapshot.id)
}

/**
 * 从**外部文件**导入的项目创建一个新项目。
 *
 * 与 `duplicateProject` 的三处分歧，每一处都是"不这么做就会毁数据"：
 *
 *  1. **必须换全部 id**。备份包可能来自另一台电脑，id 是随机短串，
 *     撞上的概率不为零；一旦撞上，`put` 会覆盖本机已有的项目 ——
 *     用户点一次"导入"，丢掉的是他自己正在写的作品。
 *  2. **名字加后缀**。同一个包导两次应该得到两个项目，
 *     否则第二次导入看起来"什么都没发生"（其实是覆盖了第一次的）。
 *  3. **二进制来自文件**，不是本机 assets 表。所以 blobs 按**旧 id** 索引，
 *     换完 id 再重新对应。
 *
 * 资源取不到不阻断：`validateProject` 已经把"引用找不到文件"降级成警告，
 * 作品端遇到缺失资源会显示占位。导入一半失败全部回滚，比"导入成功但缺图"更糟。
 *
 * @param {object} params
 * @param {object} params.project   备份包里的 project.json（原样，未换 id）
 * @param {Map<string, Blob>} [params.blobs] 旧 assetId → 二进制
 * @param {string} [params.nameSuffix] 名字后缀，用来区分多次导入
 * @returns {Promise<{ project: object, warnings: string[], homeLayoutLoss: object|null, missingAssets: string[], importedAssets: number }>}
 */
export async function importProjectRecord({ project, blobs = new Map(), nameSuffix = '（导入）' }) {
  const prepared = prepareProject(project)
  project = prepared.project
  const check = { warnings: prepared.warnings }

  // 桌面里超限或残缺的条目会在读取时被静默清洗掉（`normalizeHomeLayout`），
  // 导入是唯一能告诉用户"桌面少了几个组件"的时机
  const homeLayoutLoss = summarizeHomeLayoutLoss(project.workSettings?.homeLayout)
  if (homeLayoutLoss) check.warnings.push(describeHomeLayoutLoss(homeLayoutLoss))

  const ts = monotonicIso()
  const newProjectId = createId(ID_PREFIX.PROJECT)
  const idMap = new Map()

  const clone = structuredClone(project)
  clone.id = newProjectId
  clone.name = withSuffix(project.name, nameSuffix)
  // 导入的东西是用户自己的作品，不该继续顶着"示例"标记（示例会被特殊处理成只读提示）
  clone.isSample = false
  clone.revision = 0
  clone.createdAt = ts
  clone.updatedAt = ts

  clone.assets = (project.assets ?? []).map((asset) => {
    const newId = createId(ID_PREFIX.ASSET)
    idMap.set(asset.id, newId)
    return createAsset(newProjectId, { ...asset, id: newId, projectId: newProjectId })
  })

  rewriteAssetRefs(clone, idMap)
  rewriteAssetInternalRefs(clone.assets, idMap)

  const assetRecords = []
  const missingAssets = []
  for (const asset of project.assets ?? []) {
    const blob = blobs.get(asset.id)
    if (!blob) {
      missingAssets.push(asset.id)
      continue
    }
    assetRecords.push({
      assetId: idMap.get(asset.id),
      projectId: newProjectId,
      blob,
      // 记录里的类型优先（blob.type 在 IndexedDB / 文件往返后可能是空串）
      mimeType: asset.mimeType || blob.type || '',
    })
  }

  await repo.writeProjectWithAssets(clone, assetRecords)
  await setRecentProjectId(newProjectId)

  return {
    project: clone,
    warnings: check.warnings,
    homeLayoutLoss,
    missingAssets,
    importedAssets: assetRecords.length,
  }
}

/**
 * 把"桌面丢了几个组件"翻成人话。
 *
 * 两种原因对用户的意义完全不同：HTML 超限是他自己写太长（可以删一点再导），
 * 其余是数据本身不合规（只能重新添加）。所以分开说，别合并成"导入有问题"。
 */
function describeHomeLayoutLoss({ oversized, invalid }) {
  const parts = []
  if (oversized) parts.push(`${oversized} 个的 HTML 超过 256 KiB`)
  if (invalid) parts.push(`${invalid} 个的名称、尺寸或位置不合规`)
  return `桌面有 ${oversized + invalid} 个小组件没能恢复（${parts.join('，')}），已跳过。`
}

/**
 * 给项目名加后缀，并保证总长不超上限。
 *
 * 按**码点**截断而不是 `slice`：作品名里常有 emoji，
 * 切在代理对中间会得到乱码，且那个乱码会一直留在项目列表里。
 */
function withSuffix(name, suffix) {
  const base = String(name ?? '').trim() || '未命名作品'
  const tail = String(suffix ?? '')
  const room = Math.max(1, MAX_NAME_LENGTH - Array.from(tail).length)
  const head = Array.from(base).slice(0, room).join('')
  return normalizeName(`${head}${tail}`)
}

/** 共用的克隆逻辑：换 id、换 name、深拷贝资源、重写引用 */
async function cloneProject(source, sourceAssetOwnerId) {
  const newProjectId = createId(ID_PREFIX.PROJECT)
  const idMap = new Map()

  const clone = dropUndefinedKeys(structuredClone(source))
  clone.id = newProjectId
  clone.name = `${source.name || '未命名作品'} 副本`
  clone.isSample = false
  clone.revision = 0
  clone.createdAt = new Date().toISOString()
  clone.updatedAt = clone.createdAt

  // 资源元信息换新 id
  clone.assets = (source.assets ?? []).map((asset) => {
    const newId = createId(ID_PREFIX.ASSET)
    idMap.set(asset.id, newId)
    return createAsset(newProjectId, {
      ...asset,
      id: newId,
      projectId: newProjectId,
    })
  })

  // 内容引用 + 资源内部引用一起换
  rewriteAssetRefs(clone, idMap)
  rewriteAssetInternalRefs(clone.assets, idMap)

  // 二进制也跟着复制（从源项目的 assets 表取）
  const sourceRecords = await repo.listAssetRecords(sourceAssetOwnerId)
  const assetRecords = sourceRecords
    .filter((r) => idMap.has(r.assetId))
    .map((r) => ({
      assetId: idMap.get(r.assetId),
      projectId: newProjectId,
      blob: r.blob,
      mimeType: r.mimeType ?? '',
    }))

  await repo.writeProjectWithAssets(clone, assetRecords)
  return clone
}

// ───────────────────── 完整性 ─────────────────────

export async function ensureSummaryIntegrity() {
  const projectIds = await repo.listAllProjectIds()
  const summaries = await repo.listSummaries()
  const summaryIds = new Set(summaries.map((s) => s.id))
  const missing = projectIds.filter((id) => !summaryIds.has(id))

  for (const id of missing) {
    const project = await repo.getProject(id)
    if (project) await repo.saveProject(project)
  }
  return { repaired: missing.length, projectCount: projectIds.length }
}

/**
 * 强制从项目表重建全部摘要。
 * 用于"摘要表被破坏"这种极端情况，也会被 ensureSummaryIntegrity 覆盖日常场景。
 */
export async function rebuildSummaries() {
  const projectIds = await repo.listAllProjectIds()
  for (const id of projectIds) {
    const project = await repo.getProject(id)
    if (project) await repo.saveProject(project)
  }
  return { rebuilt: projectIds.length }
}
