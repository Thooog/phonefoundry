

import { defineStore } from 'pinia'
import { ref, computed, shallowRef, markRaw } from 'vue'
import { createAutosaver, SAVE_STATUS } from '../db/autosave.js'
import * as service from '../db/project-service.js'
import * as repo from '../db/repository.js'
import * as tabGuard from '../db/tab-guard.js'
import { toStorageError, STORAGE_ERROR_CODE } from '../db/errors.js'
import { createAsset, prepareProject, resolveHomeLayout } from '@phone-sim/shared'

export const useProjectStore = defineStore('project', () => {
  /** 当前项目对象。用 shallowRef 避免 Vue 深度代理整个项目树（大项目会明显变慢） */
  const project = shallowRef(null)
  const projectId = ref(null)

  /** 保存状态：saved | saving | error */
  const saveStatus = ref(SAVE_STATUS.SAVED)
  const saveError = ref(null)
  /** 已落盘的 revision，用于 UI 上判断"是否有未保存改动" */
  const savedRevision = ref(0)

  const loading = ref(false)
  const loadError = ref(null)

  /** 只读原因：'locked' = 别的标签页在编辑 */
  const readOnlyReason = ref(null)
  const lockedByTabId = ref(null)

  let saver = null
  let closing = null
  const pendingAssetRemovals = new Set()

  const isReadOnly = computed(() => readOnlyReason.value !== null)
  const hasProject = computed(() => project.value !== null)
  const isDirty = computed(
    () => saveStatus.value !== SAVE_STATUS.SAVED || saveError.value !== null,
  )

  // ───────────────────── 打开 / 关闭 ─────────────────────

  /**
   * 打开项目。
   *
   * @param {string} id
   * @returns {Promise<{ok: boolean, reason?: string}>}
   */
  async function open(id) {
    if (closing) await closing
    loading.value = true
    loadError.value = null
    readOnlyReason.value = null
    lockedByTabId.value = null

    // 拿到锁之后任何一步失败都必须交还。
    // 否则心跳会一直为这个项目续租，本页停在空壳工作区（没有项目对象），
    // 别的标签页却长期显示"被别人编辑中"，只能点强制接管。
    let lockOwned = false

    try {
      await tabGuard.startHeartbeat()

      // 先拿锁再读数据 —— 顺序不能反。
      // 反过来会读到"别人正在改"的中间态，然后又发现自己拿不到锁，
      // 于是界面上显示的是别人的草稿，却告诉用户"你只能看"。
      const lock = await tabGuard.acquireLock(id)
      if (!lock.acquired) {
        // 只有"确实被别人占着"才走只读。
        // 读不到锁状态、写不进锁记录属于暂时性故障，
        // 当成"有人在编辑"会让用户盯着一个其实没人在改的项目干等。
        if (lock.reason !== 'held_by_other') {
          loadError.value = new Error('暂时无法取得这个作品的编辑权，请稍后再试。')
          return { ok: false, reason: 'lock_failed' }
        }

        const raw = await service.readProject(id)
        if (!raw) {
          loadError.value = new Error('项目不存在，可能已被删除。')
          return { ok: false, reason: 'missing' }
        }
        attachProject(raw, { readOnly: 'locked', lockedByTabId: lock.ownerTabId })
        return { ok: true, readOnly: true }
      }

      lockOwned = true

      const raw = await service.readProject(id)
      if (!raw) {
        // 拿到锁但项目没了（刚被另一个标签页删掉）：finally 里会交还锁，别留着占位
        loadError.value = new Error('项目不存在，可能已被删除。')
        return { ok: false, reason: 'missing' }
      }

      attachProject(raw)
      // 锁从此归这个项目所有，直到 close() 才释放
      lockOwned = false
      await service.setRecentProjectId(id)
      return { ok: true }
    } catch (err) {
      loadError.value = toStorageError(err)
      return { ok: false, reason: 'error' }
    } finally {
      if (lockOwned) await tabGuard.releaseProject()
      loading.value = false
    }
  }

  /**
   * 装配项目对象并接好 autosaver。
   * 迁移在这里做 —— 打开旧项目时字段一次性补齐，编辑期不必到处判空。
   */
  function attachProject(raw, { readOnly = null, lockedByTabId: byTab = null } = {}) {
    const migrated = normalize(prepareProject(raw).project)
    pendingAssetRemovals.clear()

    projectId.value = migrated.id
    project.value = markRaw(migrated)
    readOnlyReason.value = readOnly
    lockedByTabId.value = byTab
    savedRevision.value = migrated.revision ?? 0

    disposeSaver()
    saver = createAutosaver({
      persist: async (data) => {
        const removed = [...pendingAssetRemovals].filter(id => !data.assets.some(asset => asset.id === id))
        await service.writeProject(data, tabGuard.getCurrentLockContext(data.id), removed)
        for (const id of removed) pendingAssetRemovals.delete(id)
      },
      readProject: () => project.value,
      // 写入前校验锁：失锁则一个字节都不写
      guard: () => tabGuard.verifyLock(projectId.value),
      onStatusChange: (state) => {
        saveStatus.value = state.status
        saveError.value = state.error
        savedRevision.value = state.savedRevision
        // 失锁不是普通保存失败：必须切只读，并给用户"另存为副本"的出口。
        // 但只有"确实被别人抢走"才算失锁 —— 读不到锁状态只是暂时故障，
        // 那种情况切只读会让用户以为自己的编辑权没了，其实重试就能存。
        if (state.error?.code === STORAGE_ERROR_CODE.LOCK_LOST) {
          const reason = state.error.lockReason
          if (reason === 'not_owner' || reason === 'stale_fence' || reason === 'missing') {
            readOnlyReason.value = 'lost_lock'
          }
        }
      },
    })
    saver.reset(migrated)
  }

  /**
   * 强制接管：放弃本页对磁盘版本的认知，以磁盘为准重新打开。
   *
   * 为什么必须重读：接管前本页可能已经持有一份过期快照，
   * 直接开始编辑就等于用旧数据覆盖对方刚写的内容。
   *
   * 若本页有未保存的改动，**先让用户决定**（saveAsCopy 或放弃）——
   * 接管会丢掉这些改动，不能悄悄丢。
   */
  async function takeOver() {
    if (!projectId.value) return { ok: false, reason: 'no_project' }
    const result = await tabGuard.forceTakeover(projectId.value)
    if (!result.ok) return { ok: false, reason: 'lock_failed' }

    // 接管成功 = 新锁已经在手，此后失败同样要交还（理由同 open）
    let lockOwned = true
    try {
      const raw = await service.readProject(projectId.value)
      if (!raw) return { ok: false, reason: 'missing' }
      attachProject(raw)
      lockOwned = false
      return { ok: true }
    } catch (err) {
      loadError.value = toStorageError(err)
      return { ok: false, reason: 'error' }
    } finally {
      if (lockOwned) await tabGuard.releaseProject()
    }
  }

  /**
   * 把当前内存内容存成一个**新项目**。
   *
   * 这是失锁后的唯一出口：本页已经不能写原项目了，
   * 但用户刚才敲进去的内容不能就这么扔掉。
   *
   * @returns {Promise<object|null>} 新建的项目
   */
  async function saveAsCopy() {
    if (!project.value) return null
    return service.duplicateFromSnapshot(project.value)
  }

  function close(options = {}) {
    if (closing) return closing
    closing = closeCurrent(options).finally(() => { closing = null })
    return closing
  }

  async function closeCurrent({ discard = false } = {}) {
    // Failed saves retain the project and error until an explicit discard.
    if (saver && !discard) await saver.flush()
    disposeSaver()
    await tabGuard.releaseProject()
    project.value = null
    projectId.value = null
    readOnlyReason.value = null
    lockedByTabId.value = null
    saveStatus.value = SAVE_STATUS.SAVED
    saveError.value = null
  }

  function disposeSaver() {
    if (saver) {
      saver.dispose()
      saver = null
    }
  }

  // ───────────────────── 修改 ─────────────────────

  function patch(patchObj, options = {}) {
    if (!project.value) return null
    if (isReadOnly.value) return project.value

    const next = { ...project.value, ...patchObj, updatedAt: new Date().toISOString() }
    return commit(next, options)
  }

  /**
   * 深层修改兜底 —— 给"必须原地改嵌套结构"的场景用。
   *
   * 用 mutate 回调而不是直接给对象，是为了统一走一次 dirty 标记：
   *   editor.mutate((p) => { p.appData.messages.messages.push(m) })
   * 回调里可以随便改，但**不要在里面 await**（会让中间态被误当成完整快照保存）。
   *
   * draft 与当前项目隔离；回调失败不会留下未提交的半次修改。
   *
   * @param {(draft: object) => void} mutate
   */
  function mutate(mutateFn, options = {}) {
    if (!project.value) return null
    if (isReadOnly.value) return project.value

    const draft = structuredClone(project.value)
    const result = mutateFn(draft)
    if (result && typeof result.then === 'function') {
      result.catch(() => {})
      throw new TypeError('mutate 回调必须同步执行。')
    }
    draft.updatedAt = new Date().toISOString()
    return commit(draft, options)
  }

  function commit(next, options = {}) {
    // Persist automatic restores immediately, so clearing content later does not hide the icon again.
    if (next.workSettings?.homeLayout?.removedItems?.length) {
      next.workSettings = { ...next.workSettings, homeLayout: resolveHomeLayout(next) }
    }
    if (!options.silent) {
      next.revision = (project.value?.revision ?? 0) + 1
    }
    project.value = markRaw(next)
    if (options.silent) return project.value
    saver?.markDirty()
    return project.value
  }

  // ───────────────────── 保存 ─────────────────────

  async function flush() {
    if (!saver) return
    await saver.flush()
  }

  async function retrySave() {
    if (!saver) return true
    return saver.retry()
  }

  // ───────────────────── 资源 ─────────────────────

  async function addAsset(input) {
    if (!project.value) throw new Error('没有打开的项目。')
    if (isReadOnly.value) throw new Error('当前为只读状态，无法添加资源。')

    if (!input?.blob) throw new Error('没有可写入的图片数据。')

    const ownerProjectId = projectId.value
    const meta = createAsset(ownerProjectId, {
      kind: input.kind ?? 'image',
      fileName: input.fileName ?? '',
      mimeType: input.mimeType ?? input.blob.type ?? '',
      byteSize: input.blob.size ?? 0,
      width: input.width ?? 0,
      height: input.height ?? 0,
      hasAlpha: input.hasAlpha ?? false,
      originalAssetId: input.originalAssetId ?? null,
      ...(input.id ? { id: input.id } : {}),
    })

    await repo.putAssetBlob({
      assetId: meta.id,
      projectId: ownerProjectId,
      blob: input.blob,
      mimeType: meta.mimeType,
    })

    if (projectId.value !== ownerProjectId || isReadOnly.value) {
      await discardAssetBlob(meta.id)
      throw new Error('作品已切换或失去编辑权，请重新添加图片。')
    }
    try {
      mutate((p) => {
        p.assets.push(meta)
      })
    } catch (err) {
      // 二进制已落盘但项目没接受这次写入 —— 留着就是一个没有任何 assets
      // 元信息引用的孤儿，只能等删项目时按 projectId 连带清掉（没有周期 GC）。
      await discardAssetBlob(meta.id)
      throw err
    }
    return meta
  }

  /** 回收一个刚写入、但没被项目接受的资源。失败不该盖掉原始错误 */
  async function discardAssetBlob(assetId) {
    try {
      await repo.deleteAsset(assetId)
    } catch {
      /* 回收失败只是多占一点配额，删项目时还会按 projectId 再清一次 */
    }
  }

  async function getAssetBlob(assetId) {
    return repo.getAssetBlob(assetId)
  }

  async function getAssetBlobs(assetIds) {
    return repo.getAssetBlobs(assetIds)
  }

  /** Remove metadata and commit blob reclamation in the same locked transaction.
   * Callers must remove content references first. Failure keeps the disk snapshot intact.
   */
  async function removeAsset(assetId) {
    if (!assetId) return
    if (!project.value) return
    if (isReadOnly.value) return

    pendingAssetRemovals.add(assetId)
    mutate((p) => {
      p.assets = p.assets.filter((a) => a.id !== assetId)
    })
    await flush()
  }

  /** Batch reclamation; one revision and one atomic project/asset commit. */
  async function removeAssets(assetIds) {
    if (!project.value) return 0
    if (isReadOnly.value) return 0

    const ids = [...new Set(assetIds ?? [])].filter(Boolean)
    if (ids.length === 0) return 0

    for (const id of ids) pendingAssetRemovals.add(id)
    const idSet = new Set(ids)
    let removed = 0
    mutate((p) => {
      const kept = p.assets.filter((a) => !idSet.has(a.id))
      removed = p.assets.length - kept.length
      p.assets = kept
    })

    // The repository commits the snapshot and resource removals atomically.
    await flush()
    return removed
  }

  /** 资源总占用，用于"存储空间"提示 */
  async function assetBytes() {
    if (!projectId.value) return 0
    return repo.sumAssetBytes(projectId.value)
  }

  /**
   * 资源总占用（同步口径）。
   *
   * 与 assetBytes() 的区别：这个读的是项目里的 assets 元信息，不发 IO，
   * 所以在输入框旁边实时刷新不会卡；assetBytes() 问的是磁盘，
   * 会把"已删但没清掉的 blob"也算进去，不适合显示"我这作品现在多重"。
   */
  const assetTotalBytes = computed(() =>
    (project.value?.assets ?? []).reduce((sum, a) => sum + (a.byteSize ?? 0), 0),
  )

  function reset() {
    disposeSaver()
    project.value = null
    projectId.value = null
    readOnlyReason.value = null
    lockedByTabId.value = null
    saveStatus.value = SAVE_STATUS.SAVED
    saveError.value = null
    loadError.value = null
    savedRevision.value = 0
  }

  return {
    // 状态
    project,
    projectId,
    saveStatus,
    saveError,
    savedRevision,
    loading,
    loadError,
    readOnlyReason,
    lockedByTabId,
    // 派生
    isReadOnly,
    hasProject,
    isDirty,
    assetTotalBytes,
    // 动作
    open,
    close,
    takeOver,
    saveAsCopy,
    patch,
    mutate,
    flush,
    retrySave,
    addAsset,
    removeAsset,
    removeAssets,
    getAssetBlob,
    getAssetBlobs,
    assetBytes,
    reset,
  }
})

/**
 * 补齐"迁移不负责"的运行时字段。
 *
 * migrateProject 只处理结构版本差异；这里补的是"任何版本都该有、
 * 但可能因早期手写数据而缺失"的字段，保证编辑期不必到处写 ?? {}。
 */
function normalize(project) {
  if (!Array.isArray(project.characters)) project.characters = []
  if (!Array.isArray(project.platformAccounts)) project.platformAccounts = []
  if (!Array.isArray(project.assets)) project.assets = []
  if (!project.appData || typeof project.appData !== 'object') project.appData = {}
  if (!project.workSettings || typeof project.workSettings !== 'object') project.workSettings = {}
  return project
}
