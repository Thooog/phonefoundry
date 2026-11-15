

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import * as service from '../db/project-service.js'
import { importProjectFromFile } from '../import/import-backup.js'
import { readIndexCache, writeIndexCache, clearIndexCache, isCacheAvailable } from '../db/index-cache.js'
import { toSummary } from '../db/schema.js'
import { toStorageError } from '../db/errors.js'

export const useProjectsStore = defineStore('projects', () => {
  /** 摘要数组，按 updatedAt 倒序 */
  const items = ref([])
  /** true 时 items 来自缓存而非 IDB，不能作为"项目存在"的依据 */
  const isFromCache = ref(false)
  const loading = ref(false)
  const error = ref(null)

  const count = computed(() => items.value.length)
  const isEmpty = computed(() => !loading.value && items.value.length === 0)

  /** 缓存可用性只在初始化时探测一次 */
  let cacheUsable = null

  /**
   * 加载项目列表。
   *
   * 关键顺序：
   *   1. 先读缓存并立刻渲染（isFromCache=true）
   *   2. 再用 IDB 的真相覆盖
   * 若第 2 步失败，**不能**清空已显示的缓存 ——
   * 用户至少还能看到自己的项目名，比白屏有用。
   */
  async function load() {
    if (cacheUsable === null) cacheUsable = isCacheAvailable()

    if (cacheUsable && items.value.length === 0) {
      const cached = readIndexCache()
      if (cached) {
        items.value = cached
        isFromCache.value = true
      }
    }

    loading.value = true
    error.value = null
    try {
      const fresh = await service.listProjects()
      items.value = fresh
      isFromCache.value = false
      if (cacheUsable) writeIndexCache(fresh)
    } catch (err) {
      const readable = toStorageError(err)
      error.value = readable
      // 有缓存就保留，让用户至少能看到列表；没有缓存才是真的空
      if (items.value.length === 0) throw readable
    } finally {
      loading.value = false
    }
  }

  /** 强制从 IDB 重读（用于破坏性操作后确保一致） */
  async function reload() {
    items.value = []
    clearIndexCache()
    await load()
  }

  /** 本地插入一条摘要，避免新建后整页重刷 */
  function upsertSummary(summary) {
    const rest = items.value.filter((p) => p.id !== summary.id)
    items.value = [summary, ...rest].sort(byUpdatedDesc)
    if (cacheUsable) writeIndexCache(items.value)
  }

  function removeSummary(projectId) {
    items.value = items.value.filter((p) => p.id !== projectId)
    if (cacheUsable) writeIndexCache(items.value)
  }

  /**
   * 新建空项目，并插到列表最前。
   *
   * 为什么用 upsertSummary 而不是 await load()：
   * 新建是列表页最高频的动作，重读整张摘要表在项目多时会让点击有明显延迟。
   * 而 saveProject 已经在同一事务里写好了摘要，前端按摘要结构投影一份即可，
   * 与磁盘内容天然一致。
   *
   * @param {{name?: string}} [input]
   * @returns {Promise<object>} 新建的项目
   */
  async function create(input = {}) {
    const project = await service.createProjectRecord(input)
    upsertSummary(toSummary(project))
    return project
  }

  /**
   * 载入示例项目。
   * @returns {Promise<object>}
   */
  async function createSample(input = {}) {
    const project = await service.createSample(input)
    upsertSummary(toSummary(project))
    return project
  }

  async function rename(projectId, nextName) {
    const project = await service.renameProject(projectId, nextName)
    upsertSummary(toSummary(project))
    return project
  }

  async function remove(projectId) {
    await service.deleteProject(projectId)
    removeSummary(projectId)
    return true
  }

  /**
   * 复制项目，并把副本插到列表最前。
   * @returns {Promise<object>} 副本项目
   */
  async function duplicate(projectId) {
    const copy = await service.duplicateProject(projectId)
    await load()
    return copy
  }

  /**
   * 从文件导入一个项目。
   *
   * 这里用 `load()` 重新拉整张摘要表，而不是像 create 那样插一条：
   * 导入是有副作用的批量写（项目 + 一批资源），中途可能因为存储配额失败，
   * 拿不准磁盘上到底是什么状态。重读一次的成本是一次 get,而"列表写错了"
   * 会让用户对着一个不存在的项目点进去。
   *
   * @param {File} file
   */
  async function importProject(file) {
    const result = await importProjectFromFile(file)
    await load()
    return result
  }

  function findById(projectId) {
    return items.value.find((p) => p.id === projectId) ?? null
  }

  function reset() {
    items.value = []
    isFromCache.value = false
    loading.value = false
    error.value = null
  }

  return {
    items,
    isFromCache,
    loading,
    error,
    count,
    isEmpty,
    load,
    reload,
    upsertSummary,
    removeSummary,
    create,
    createSample,
    rename,
    remove,
    duplicate,
    importProject,
    findById,
    reset,
  }
})

function byUpdatedDesc(a, b) {
  return String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? ''))
}
