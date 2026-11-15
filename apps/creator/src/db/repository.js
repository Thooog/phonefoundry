

import { openDatabase, getOpenDatabase } from './connection.js'
import { STORE, toSummary } from './schema.js'
import { toStorageError } from './errors.js'
import { decideTakeover, decideVerify, isLockAlive, lockKey, STALE_MS } from './lock-logic.js'

/**
 * 在一个事务里执行操作，并等待事务真正提交。
 * @param {IDBDatabase} db
 * @param {string[]} storeNames
 * @param {IDBTransactionMode} mode
 * @param {(tx: IDBTransaction) => Promise<any>} work
 */
async function withTransaction(db, storeNames, mode, work) {
  let tx
  try {
    tx = db.transaction(storeNames, mode)
  } catch (err) {
    throw toStorageError(err)
  }

  // 事务级错误（含配额超限）必须能被捕获到，否则会变成未处理的 rejection
  const txDone = new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(toStorageError(tx.error))
    tx.onerror = () => {
      // 让事务自然 abort，错误统一在 onabort 里抛
    }
  })

  let result
  try {
    result = await work(tx)
  } catch (err) {
    try {
      tx.abort()
    } catch {
      /* 可能已结束 */
    }
    await txDone.catch(() => {})
    throw toStorageError(err)
  }

  await txDone
  return result
}

function req(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/** 用游标收集索引/表里的全部记录（避免 getAll 一次性吃满内存） */
function collect(openCursorRequest) {
  return new Promise((resolve, reject) => {
    const rows = []
    openCursorRequest.onsuccess = (event) => {
      const cursor = event.target.result
      if (!cursor) {
        resolve(rows)
        return
      }
      rows.push(cursor.value)
      cursor.continue()
    }
    openCursorRequest.onerror = () => reject(openCursorRequest.error)
  })
}

// ───────────────────────────── 项目 ─────────────────────────────

/**
 * 列出所有项目摘要（列表页唯一数据源）。
 * 只读 projectSummaries，不碰完整项目，因此与项目体量无关。
 * @returns {Promise<Array<object>>}
 */
export async function listSummaries() {
  const db = await openDatabase()
  return withTransaction(db, [STORE.SUMMARIES], 'readonly', (tx) =>
    collect(tx.objectStore(STORE.SUMMARIES).openCursor()),
  )
}

/** 读取完整项目；不存在返回 undefined */
export async function getProject(projectId) {
  const db = await openDatabase()
  return withTransaction(db, [STORE.PROJECTS], 'readonly', (tx) =>
    req(tx.objectStore(STORE.PROJECTS).get(projectId)),
  )
}

/**
 * 只取所有项目的主键，不读项目体。
 * 用于完整性自检与重建摘要 —— 避免把全部项目读进内存。
 * @returns {Promise<string[]>}
 */
export async function listAllProjectIds() {
  const db = await openDatabase()
  return withTransaction(db, [STORE.PROJECTS], 'readonly', (tx) =>
    req(tx.objectStore(STORE.PROJECTS).getAllKeys()),
  )
}

/**
 * 保存项目 —— 项目与摘要同事务写。
 * @param {object} project
 */
export async function saveProject(project) {
  const db = await openDatabase()
  await withTransaction(db, [STORE.PROJECTS, STORE.SUMMARIES], 'readwrite', async (tx) => {
    tx.objectStore(STORE.PROJECTS).put(project)
    tx.objectStore(STORE.SUMMARIES).put(toSummary(project))
  })
}

/**
 * 有锁保护地保存项目。
 * 锁校验与项目/摘要写入在同一笔 readwrite 事务里，接管或删除无法插入竞态窗口。
 * @param {object} project
 * @param {{key:string, tabId:string, fence:number}} owner
 * @returns {Promise<{saved:boolean, reason?:string}>}
 */
export async function saveProjectWithLock(project, owner, removedAssetIds = []) {
  if (
    owner?.key !== lockKey(project?.id) ||
    !owner?.tabId ||
    !Number.isFinite(Number(owner?.fence))
  ) {
    return { saved: false, reason: 'missing' }
  }
  const db = await openDatabase()
  return withTransaction(
    db,
    [STORE.META, STORE.PROJECTS, STORE.SUMMARIES, STORE.ASSETS],
    'readwrite',
    async (tx) => {
      const metaStore = tx.objectStore(STORE.META)
      const projectStore = tx.objectStore(STORE.PROJECTS)
      const row = await req(metaStore.get(owner.key))
      const verdict = decideVerify(row?.value ?? null, {
        tabId: owner.tabId,
        fence: owner.fence,
      })
      if (!verdict.valid) return { saved: false, reason: verdict.reason }
      const previous = await req(projectStore.get(project.id))
      if (!previous) return { saved: false, reason: 'missing' }
      // Reclaim only resources removed by this snapshot, in the same locked transaction.
      const retained = new Set((project.assets ?? []).map(asset => asset.id))
      const assets = tx.objectStore(STORE.ASSETS)
      const candidates = new Set([...removedAssetIds, ...(previous.assets ?? []).map(asset => asset.id)])
      for (const id of candidates) {
        if (retained.has(id)) continue
        const record = await req(assets.get(id))
        if (record?.projectId === project.id) assets.delete(id)
      }

      projectStore.put(project)
      tx.objectStore(STORE.SUMMARIES).put(toSummary(project))
      return { saved: true }
    },
  )
}

/**
 * 安全地重命名已有项目：拒绝仍活跃的编辑锁，并在同一事务中推进 fence。
 * 这样旧标签页即使停心跳后恢复，也不能把旧项目快照写回覆盖新名称。
 */
export async function renameProject(projectId, name, updatedAt, now = Date.now()) {
  const db = await openDatabase()
  return withTransaction(
    db,
    [STORE.META, STORE.PROJECTS, STORE.SUMMARIES],
    'readwrite',
    async (tx) => {
      const metaStore = tx.objectStore(STORE.META)
      const projectStore = tx.objectStore(STORE.PROJECTS)
      const project = await req(projectStore.get(projectId))
      if (!project) return { renamed: false, reason: 'missing' }

      const key = lockKey(projectId)
      const row = await req(metaStore.get(key))
      const lock = row?.value ?? null
      if (lock?.tabId && isLockAlive(lock, now, STALE_MS)) {
        return { renamed: false, reason: 'held_by_other' }
      }

      const updated = {
        ...project,
        name,
        updatedAt,
        revision: (project.revision ?? 0) + 1,
      }
      const retiredLock = decideTakeover(lock, { tabId: 'rename-operation', now, projectId })
      metaStore.put({ key, value: { ...retiredLock, tabId: null, heartbeatAt: 0 } })
      projectStore.put(updated)
      tx.objectStore(STORE.SUMMARIES).put(toSummary(updated))
      return { renamed: true, project: updated }
    },
  )
}

export async function removeProject(projectId) {
  const db = await openDatabase()
  return withTransaction(db, [STORE.PROJECTS, STORE.SUMMARIES, STORE.ASSETS, STORE.META], 'readwrite', async (tx) => {
    const assetStore = tx.objectStore(STORE.ASSETS)
    const assetIds = await req(assetStore.index('projectId').getAllKeys(IDBKeyRange.only(projectId)))

    for (const assetId of assetIds) assetStore.delete(assetId)
    tx.objectStore(STORE.PROJECTS).delete(projectId)
    tx.objectStore(STORE.SUMMARIES).delete(projectId)
    tx.objectStore(STORE.META).delete(lockKey(projectId))

    return assetIds.length
  })
}

/**
 * 写入项目 + 一批资源（复制/导入用，必须全成功或全失败）。
 * @param {object} project
 * @param {Array<{ assetId: string, projectId: string, blob: Blob }>} assetRecords
 */
export async function writeProjectWithAssets(project, assetRecords = []) {
  const db = await openDatabase()
  await withTransaction(db, [STORE.PROJECTS, STORE.SUMMARIES, STORE.ASSETS], 'readwrite', async (tx) => {
    tx.objectStore(STORE.PROJECTS).put(project)
    tx.objectStore(STORE.SUMMARIES).put(toSummary(project))
    const assetStore = tx.objectStore(STORE.ASSETS)
    for (const record of assetRecords) {
      assetStore.put({
        assetId: record.assetId,
        projectId: record.projectId,
        blob: record.blob,
        createdAt: record.createdAt ?? new Date().toISOString(),
      })
    }
  })
}

export async function saveProjectOnly(project) {
  const db = await openDatabase()
  await withTransaction(db, [STORE.PROJECTS], 'readwrite', async (tx) => {
    tx.objectStore(STORE.PROJECTS).put(project)
  })
}

// ───────────────────────────── 资源 ─────────────────────────────

/** 写入单个资源的二进制 */
export async function putAssetBlob({ assetId, projectId, blob, mimeType = '' }) {
  const db = await openDatabase()
  await withTransaction(db, [STORE.ASSETS], 'readwrite', async (tx) => {
    tx.objectStore(STORE.ASSETS).put({
      assetId,
      projectId,
      blob,
      mimeType,
      createdAt: new Date().toISOString(),
    })
  })
}

/** 批量写入资源二进制 */
export async function putAssetBlobs(records) {
  if (!records.length) return
  const db = await openDatabase()
  await withTransaction(db, [STORE.ASSETS], 'readwrite', async (tx) => {
    const store = tx.objectStore(STORE.ASSETS)
    for (const r of records) {
      store.put({
        assetId: r.assetId,
        projectId: r.projectId,
        blob: r.blob,
        mimeType: r.mimeType ?? '',
        createdAt: r.createdAt ?? new Date().toISOString(),
      })
    }
  })
}

/** 读取单个资源二进制；不存在返回 null */
export async function getAssetBlob(assetId) {
  const db = await openDatabase()
  const record = await withTransaction(db, [STORE.ASSETS], 'readonly', (tx) =>
    req(tx.objectStore(STORE.ASSETS).get(assetId)),
  )
  return record?.blob ?? null
}

/** 批量读取资源二进制，返回 Map<assetId, Blob> */
export async function getAssetBlobs(assetIds) {
  const ids = (assetIds ?? []).filter(Boolean)
  if (!ids.length) return new Map()
  const db = await openDatabase()
  const map = new Map()
  await withTransaction(db, [STORE.ASSETS], 'readonly', async (tx) => {
    const store = tx.objectStore(STORE.ASSETS)
    for (const id of ids) {
      const row = await req(store.get(id))
      if (row?.blob) map.set(id, row.blob)
    }
  })
  return map
}

/** 列出某项目的全部资源记录（含 blob，仅内部使用） */
export async function listAssetRecords(projectId) {
  const db = await openDatabase()
  return withTransaction(db, [STORE.ASSETS], 'readonly', (tx) =>
    collect(tx.objectStore(STORE.ASSETS).index('projectId').openCursor(IDBKeyRange.only(projectId))),
  )
}

/** 统计某项目的资源总字节数 */
export async function sumAssetBytes(projectId) {
  const records = await listAssetRecords(projectId)
  return records.reduce((sum, r) => sum + (r.blob?.size ?? 0), 0)
}

/** 删除单个资源 */
export async function deleteAsset(assetId) {
  const db = await openDatabase()
  await withTransaction(db, [STORE.ASSETS], 'readwrite', async (tx) => {
    tx.objectStore(STORE.ASSETS).delete(assetId)
  })
}

/** 删除一批资源 */
export async function deleteAssets(assetIds) {
  const ids = (assetIds ?? []).filter(Boolean)
  if (!ids.length) return
  const db = await openDatabase()
  await withTransaction(db, [STORE.ASSETS], 'readwrite', async (tx) => {
    const store = tx.objectStore(STORE.ASSETS)
    for (const id of ids) store.delete(id)
  })
}

// ───────────────────────────── meta ─────────────────────────────

export async function getMeta(key) {
  const db = await openDatabase()
  const row = await withTransaction(db, [STORE.META], 'readonly', (tx) =>
    req(tx.objectStore(STORE.META).get(key)),
  )
  return row?.value ?? null
}

export async function setMeta(key, value) {
  const db = await openDatabase()
  await withTransaction(db, [STORE.META], 'readwrite', async (tx) => {
    tx.objectStore(STORE.META).put({ key, value })
  })
}

export async function deleteMeta(key) {
  const db = await openDatabase()
  await withTransaction(db, [STORE.META], 'readwrite', async (tx) => {
    tx.objectStore(STORE.META).delete(key)
  })
}

export async function updateMeta(key, decide) {
  const db = await openDatabase()
  return withTransaction(db, [STORE.META], 'readwrite', async (tx) => {
    const store = tx.objectStore(STORE.META)
    const row = await req(store.get(key))
    const decision = decide(row?.value ?? null)
    if (decision?.delete) store.delete(key)
    else if (decision?.write) store.put({ key, value: decision.value })
    return decision?.result
  })
}

/** 页面卸载时只释放匹配的锁凭据，并保留 fence 代数。 */
export function releaseMetaSyncIfLockOwned(key, { tabId, fence }) {
  const db = getOpenDatabase()
  if (!db || !tabId || !Number.isFinite(Number(fence))) return false
  try {
    const tx = db.transaction(STORE.META, 'readwrite')
    const store = tx.objectStore(STORE.META)
    const get = store.get(key)
    get.onsuccess = () => {
      const current = get.result?.value
      if (current?.tabId === tabId && Number(current.fence) === Number(fence)) {
        store.put({ key, value: { ...current, tabId: null, heartbeatAt: 0 } })
      }
    }
    return true
  } catch {
    return false
  }
}
