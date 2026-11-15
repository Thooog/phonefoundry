

import { isRetryable, lockLostError, toStorageError } from './errors.js'

export const SAVE_STATUS = Object.freeze({
  SAVED: 'saved',
  SAVING: 'saving',
  ERROR: 'error',
})

/** 防抖时长：400ms 是"打字停顿"与"不及时落盘"之间的常见折中 */
export const DEFAULT_DEBOUNCE_MS = 400

/**
 * @param {object} options
 * @param {(project: object) => Promise<void>} options.persist  真正落盘的函数
 * @param {(project: object) => object} [options.snapshot]      深拷贝函数，默认 structuredClone
 * @param {number} [options.debounceMs]
 * @param {() => object|null} options.readProject               读取当前内存态
 * @param {(state: object) => void} [options.onStatusChange]    状态变化回调
 * @param {() => Promise<{ok: boolean, reason?: string}>} [options.guard]
 *   写入前的守卫（用于多标签页锁校验）。返回 ok:false 时**拒绝写入**并进入 error ——
 *   这是"接管后旧标签页不能覆盖新内容"的落地点，不能只靠界面提示。
 */
export function createAutosaver(options) {
  const {
    persist,
    readProject,
    snapshot = (p) => structuredClone(p),
    debounceMs = DEFAULT_DEBOUNCE_MS,
    onStatusChange = null,
    guard = null,
  } = options

  let status = SAVE_STATUS.SAVED
  /** 内存态版本号；每次 markDirty +1。与项目里的 revision 同步推进 */
  let inMemoryRevision = 0
  /** 最近一次成功落盘的版本号（运行时私有，不写进项目） */
  let savedRevision = 0
  /** 是否有未落盘的改动 */
  let dirty = false
  let timer = null
  let lastError = null
  /** 串行队列的尾部 */
  let tail = Promise.resolve()
  /** 连接失效类错误已自动重试的次数，成功后清零 */
  let autoRetried = 0
  const MAX_AUTO_RETRY = 1

  function setStatus(next, error = null) {
    const changed = status !== next || (error ? lastError !== error : lastError !== null)
    status = next
    lastError = error
    if (changed && onStatusChange) {
      onStatusChange({ status, error, revision: inMemoryRevision, savedRevision })
    }
  }

  function cancelTimer() {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  /**
   * 把一次落盘排进串行队列。
   * 关键：快照在 task 内部取（规则 B），因此排队期间的新改动会被包含进去。
   */
  function enqueuePersist() {
    const run = tail.then(
      () => doPersist(),
      () => doPersist(), // 前一个失败不阻塞后一个
    )
    tail = run.catch(() => {}) // 吞掉，避免污染队列
    return run
  }

  async function doPersist() {
    // 写入前先问一句"我还持有这个项目的锁吗"。
    // 锁都没了，快照没有意义，更不该写下去。
    if (guard) {
      let verdict
      try {
        verdict = await guard()
      } catch {
        // 守卫自身出错时保守处理：宁可不保存也不冒险覆盖
        verdict = { ok: false, reason: 'guard_failed' }
      }
      if (!verdict?.ok) {
        const err = lockLostError(verdict?.reason)
        // 与写入失败同等终止：不重排、不回滚内存态
        setStatus(SAVE_STATUS.ERROR, err)
        throw err
      }
    }

    // guard 是异步的；等待期间用户可能通过 patch 换掉项目根对象。
    // 必须在 guard 后读取快照，并在同一个同步区间内取 revision，保证两者匹配。
    const project = readProject()
    if (!project) return

    // 改写会制造两个真相：项目里的 revision 到底是"用户的修改次数"还是"保存器的计数器"。
    const data = snapshot(project)
    const snapshotRevision = inMemoryRevision

    setStatus(SAVE_STATUS.SAVING)

    try {
      await persist(data)
    } catch (rawErr) {
      const err = toStorageError(rawErr)
      // 连接失效类错误自动重试一次（例如另一个标签页升级了库版本）
      if (isRetryable(err) && autoRetried < MAX_AUTO_RETRY) {
        autoRetried += 1
        return doPersist()
      }
      autoRetried = 0
      // 内存态保持不动 —— 绝不回滚用户的输入
      setStatus(SAVE_STATUS.ERROR, err)
      throw err
    }

    autoRetried = 0
    savedRevision = snapshotRevision

    if (inMemoryRevision === savedRevision) {
      dirty = false
      setStatus(SAVE_STATUS.SAVED)
    } else {

      setStatus(SAVE_STATUS.SAVING)
      schedulePersist()
    }
  }

  function schedulePersist() {
    cancelTimer()
    timer = setTimeout(() => {
      timer = null
      enqueuePersist().catch(() => {
        // 错误已通过 onStatusChange 上报，这里只防止 unhandled rejection
      })
    }, debounceMs)
  }

  // ──────────────────── 对外接口 ────────────────────

  function reset(project) {
    cancelTimer()
    dirty = false
    lastError = null
    inMemoryRevision = project?.revision ?? 0
    savedRevision = inMemoryRevision
    setStatus(SAVE_STATUS.SAVED)
  }

  /** 标记内存态已变更；由 patch 调用 */
  function markDirty() {
    inMemoryRevision += 1
    dirty = true
    if (status !== SAVE_STATUS.SAVING) setStatus(SAVE_STATUS.SAVING)
    schedulePersist()
    return inMemoryRevision
  }

  async function flush() {
    // 上限只是防御：正常流程 2~3 轮就能收敛，无限循环意味着有 bug
    for (let guard = 0; guard < 50; guard += 1) {
      cancelTimer()
      if (!dirty && inMemoryRevision === savedRevision && status === SAVE_STATUS.SAVED) {
        return
      }

      if (status === SAVE_STATUS.ERROR) {
        throw lastError ?? toStorageError(new Error('保存失败'))
      }
      await enqueuePersist().catch((err) => {
        // 失败已记进 lastError 与 status，下一轮循环会抛出；这里只是别让 await 炸掉
        void err
      })
    }
    throw toStorageError(new Error('保存未能收敛，可能有并发写入冲突。'))
  }

  async function retry() {
    if (status === SAVE_STATUS.SAVED && !dirty) return true
    cancelTimer()
    autoRetried = 0 // 用户主动重试时重置，允许再自动重试一次
    await enqueuePersist().catch(() => {})
    return status === SAVE_STATUS.SAVED
  }

  /** 状态快照，供 store / 视图读取 */
  function getState() {
    return {
      status,
      error: lastError,
      dirty,
      revision: inMemoryRevision,
      savedRevision,
      /** 是否有未落盘改动的布尔快捷方式 */
      hasPendingWrites: dirty || inMemoryRevision !== savedRevision,
    }
  }

  function dispose() {
    cancelTimer()
  }

  return { reset, markDirty, flush, retry, getState, dispose }
}
