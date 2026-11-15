/**
 * 数据库连接管理。
 *
 * 职责：
 *  - 懒打开、单例缓存
 *  - 安装 upgradeSchema
 *  - 连接失效时关闭并重开（一次）
 *  - 申请持久化存储，避免浏览器在空间紧张时静默清理
 */

import { DB_NAME, DB_VERSION, upgradeSchema } from './schema.js'
import { toStorageError } from './errors.js'

/** @type {IDBDatabase|null} */
let db = null
/** 正在打开的 promise，防止并发打开产生多个连接 */
let opening = null

export function getOpenDatabase() {
  return db
}

/**
 * 打开数据库。首次调用会触发建表。
 * @param {{ fresh?: boolean }} [options] fresh=true 时丢弃缓存连接重新打开
 * @returns {Promise<IDBDatabase>}
 */
export function openDatabase({ fresh = false } = {}) {
  if (fresh) closeDatabase()
  if (db) return Promise.resolve(db)
  if (opening) return opening

  opening = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(toStorageError(new Error('当前环境不支持 IndexedDB')))
      return
    }

    let request
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION)
    } catch (err) {
      reject(toStorageError(err))
      return
    }

    request.onupgradeneeded = (event) => {
      try {
        upgradeSchema(request.result, event.oldVersion)
      } catch (err) {
        // 建表失败必须中止，否则会留下半建成的库
        request.transaction?.abort()
        console.error('[db] 建表失败', err)
      }
    }

    request.onsuccess = () => {
      const database = request.result
      // 另一个标签页要升级版本时，必须主动让路，否则对方会一直卡住
      database.onversionchange = () => {
        database.close()
        db = null
      }
      database.onclose = () => {
        db = null
      }
      db = database
      opening = null
      resolve(database)
    }

    request.onerror = () => {
      opening = null
      reject(toStorageError(request.error))
    }

    request.onblocked = () => {
      console.warn('[db] 数据库被其他标签页占用，升级被阻塞')
    }
  })

  return opening
}

export function closeDatabase() {
  if (db) {
    const old = db
    db = null
    try {
      old.close()
    } catch {
      /* 已关闭 */
    }
  }
  opening = null
}

/**
 * 彻底删除数据库（仅供测试）。
 *
 * onblocked 不能当作成功 —— 它意味着还有别的连接占着，
 * 此时 resolve 会让调用方以为删完了，实际下个用例会读到脏数据。
 * 所以 blocked 时也 reject，让测试立刻失败而不是静默串味。
 */
export function deleteDatabase(name = DB_NAME) {
  closeDatabase()
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error('数据库删除被阻塞：仍有未关闭的连接。'))
  })
}

/**
 * 申请持久化存储。
 * 失败不阻断 —— 只是降级为"浏览器可能在空间紧张时清理"。
 * @returns {Promise<{ persisted: boolean, usage?: number, quota?: number }>}
 */
export async function requestPersistence() {
  const result = { persisted: false }
  try {
    if (globalThis.navigator?.storage?.persisted) {
      result.persisted = await globalThis.navigator.storage.persisted()
    }
    if (!result.persisted && globalThis.navigator?.storage?.persist) {
      result.persisted = await globalThis.navigator.storage.persist()
    }
    if (globalThis.navigator?.storage?.estimate) {
      const est = await globalThis.navigator.storage.estimate()
      result.usage = est.usage ?? 0
      result.quota = est.quota ?? 0
    }
  } catch (err) {
    console.warn('[db] 申请持久化存储失败', err)
  }
  return result
}

/** 查询当前用量，用于配额错误时的提示 */
export async function estimateUsage() {
  try {
    const est = await navigator?.storage?.estimate?.()
    return est?.usage ?? null
  } catch {
    return null
  }
}
