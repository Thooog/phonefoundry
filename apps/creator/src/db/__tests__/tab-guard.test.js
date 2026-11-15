

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as guard from '../tab-guard.js'
import * as repo from '../repository.js'
import { createAutosaver, SAVE_STATUS } from '../autosave.js'
import { lockKey } from '../lock-logic.js'
import { STORAGE_ERROR_CODE } from '../errors.js'
import { resetDatabase } from './support/fake-db.js'

const PRJ = 'prj_1'
const PRJ2 = 'prj_2'

/** 模拟"另一个标签页"持锁 */
async function otherTabHolds(projectId, { fence = 1, ageMs = 0 } = {}) {
  await repo.setMeta(lockKey(projectId), {
    key: lockKey(projectId),
    projectId,
    tabId: 'tab_other',
    fence,
    heartbeatAt: Date.now() - ageMs,
  })
}

beforeEach(async () => {
  await guard.__resetForTest()
  await resetDatabase()
})

afterEach(async () => {
  await guard.__resetForTest()
})

// ───────────────────── 拿锁 ─────────────────────

describe('acquireLock', () => {
  it('无人占用时拿到锁，fence = 1', async () => {
    const r = await guard.acquireLock(PRJ)
    expect(r.acquired).toBe(true)
    expect(r.fence).toBe(1)

    const record = await repo.getMeta(lockKey(PRJ))
    expect(record.projectId).toBe(PRJ)
    expect(record.fence).toBe(1)
  })

  it('他人持有且心跳新鲜 → 拿不到，返回持有者', async () => {
    await otherTabHolds(PRJ)
    const r = await guard.acquireLock(PRJ)

    expect(r.acquired).toBe(false)
    expect(r.ownerTabId).toBe('tab_other')
  })

  it('他人心跳过期 → 可以接手，fence 递增', async () => {
    guard.__setTimingForTest({ staleMs: 50 })
    await otherTabHolds(PRJ, { fence: 3, ageMs: 200 })

    const r = await guard.acquireLock(PRJ)
    expect(r.acquired).toBe(true)
    expect(r.fence).toBe(4)
  })

  it('每项目一把锁：拿 A 不影响 B', async () => {
    const a = await guard.acquireLock(PRJ)
    const b = await guard.acquireLock(PRJ2)

    expect(a.acquired).toBe(true)
    expect(b.acquired).toBe(true)
    expect(await repo.getMeta(lockKey(PRJ))).toBeTruthy()
    expect(await repo.getMeta(lockKey(PRJ2))).toBeTruthy()
  })

  it('已在编辑 A 时去拿 B，A 的锁不会被顺手删掉', async () => {
    await guard.acquireLock(PRJ)
    await guard.acquireLock(PRJ2)

    const aLock = await repo.getMeta(lockKey(PRJ))
    const bLock = await repo.getMeta(lockKey(PRJ2))
    expect(aLock.projectId).toBe(PRJ)
    expect(bLock.projectId).toBe(PRJ2)
  })
})

// ───────────────────── ★ 读锁失败必须保守 ─────────────────────

describe('读锁失败不能被当成「没人占用」', () => {
  /**
   * 这条是这套锁的安全底线，也是最容易写错的一行：
   * readLock 用 catch 把异常折成 null，decideAcquire 看到 null 就判定"没人占用"，
   * 于是在 IDB 抖动的那一瞬间主动放弃了保护 —— 正好是静默覆盖最可能发生的时候。
   */
  function breakReads() {
    const error = new Error('idb 忙')
    const spies = [
      vi.spyOn(repo, 'getMeta').mockRejectedValue(error),
      vi.spyOn(repo, 'updateMeta').mockRejectedValue(error),
    ]
    return { mockRestore: () => spies.forEach((spy) => spy.mockRestore()) }
  }

  it('读锁失败时拒绝拿锁，而不是抢走', async () => {
    const spy = breakReads()
    try {
      const r = await guard.acquireLock(PRJ)
      expect(r.acquired).toBe(false)
      expect(r.reason).toBe('lock_unreadable')
    } finally {
      spy.mockRestore()
    }
  })

  it('读锁失败时拒绝强制接管（否则新 fence 可能撞上对方的代数）', async () => {
    const spy = breakReads()
    try {
      const r = await guard.forceTakeover(PRJ)
      expect(r.ok).toBe(false)
      expect(r.reason).toBe('lock_unreadable')
    } finally {
      spy.mockRestore()
    }
  })

  it('写入前校验读锁失败 → 拒绝写入', async () => {
    const ok = await guard.acquireLock(PRJ)
    expect(ok.acquired).toBe(true)

    const spy = breakReads()
    try {
      const r = await guard.verifyLock(PRJ)
      expect(r.ok).toBe(false)
      expect(r.reason).toBe('lock_unreadable')
    } finally {
      spy.mockRestore()
    }
  })

  it('心跳期间读锁失败只跳过这一轮，不判失锁', async () => {
    guard.__setTimingForTest({ heartbeatMs: 10 })
    await guard.acquireLock(PRJ)

    const lost = vi.fn()
    const off = guard.onLockLost(lost)
    const spy = breakReads()

    try {
      await new Promise((r) => setTimeout(r, 60))
      // 60ms 内至少跳了 5 次心跳，一次都不该被当成失锁
      expect(lost).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
      off()
    }
  })

  it('读锁失败时只读判断偏保守：当作有人在编辑', async () => {
    const spy = breakReads()
    try {
      const r = await guard.checkOtherTabs(PRJ)
      expect(r.locked).toBe(true)
      expect(r.unreadable).toBe(true)
    } finally {
      spy.mockRestore()
    }
  })
})

// ───────────────────── ★ 刷新后仍是自己 ─────────────────────

describe('标签页身份跨刷新保持', () => {

  function installSessionStorage(initial = {}) {
    const store = new Map(Object.entries(initial))
    globalThis.sessionStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    }
    return store
  }

  afterEach(() => {
    delete globalThis.sessionStorage
  })

  it('刷新后复用同一个 tabId，能续上自己的锁而不是被自己挡住', async () => {
    installSessionStorage()
    await guard.__resetForTest()
    await guard.acquireLock(PRJ)
    const before = await repo.getMeta(lockKey(PRJ))

    // 模拟刷新：模块内状态全部清空，sessionStorage 保留
    await guard.__resetForTest({ keepTabIdentity: true })
    const again = await guard.acquireLock(PRJ)

    expect(again.acquired).toBe(true)
    // 续租而不是夺取：fence 必须不变，否则刷新会把刷新前的在飞写入作废
    expect(again.fence).toBe(before.fence)
    expect(await repo.getMeta(lockKey(PRJ))).toMatchObject({ tabId: before.tabId })
  })

  it('没有持久身份时才生成新的', async () => {
    const store = installSessionStorage()
    await guard.__resetForTest()
    await guard.acquireLock(PRJ)

    const saved = store.get('phone-sim-tab-id')
    expect(typeof saved).toBe('string')
    expect(saved.startsWith('tab_')).toBe(true)
  })
})

// ───────────────────── ★ 失锁后写入被拒 ─────────────────────

describe('A-12 核心：接管后旧标签页的写入必须被拒', () => {
  /**
   * 整份设计最要紧的一条。
   * 不是"界面显示只读"，而是写入端直接拒绝 —— 数据一个字节都不落盘。
   */
  it('接管后，旧持有者的 autosaver 写入失败且状态为 error', async () => {
    const acquired = await guard.acquireLock(PRJ)
    expect(acquired.acquired).toBe(true)

    let memory = { id: PRJ, revision: 0, name: '旧页内容' }
    const persisted = []
    const saver = createAutosaver({
      readProject: () => memory,
      persist: async (data) => {
        persisted.push(structuredClone(data))
        await repo.saveProject(data)
      },
      guard: () => guard.verifyLock(PRJ),
      debounceMs: 1,
    })
    saver.reset(memory)

    // 另一页强制接管
    await otherTabHolds(PRJ, { fence: 99 })

    memory = { ...memory, revision: 1, name: '接管后写的' }
    saver.markDirty()

    await expect(saver.flush()).rejects.toThrow()

    const state = saver.getState()
    expect(state.status).toBe(SAVE_STATUS.ERROR)
    expect(state.error.code).toBe(STORAGE_ERROR_CODE.LOCK_LOST)
    // ★ 关键：一个字节都没写出去
    expect(persisted).toHaveLength(0)
    // 内存态完好（用户的内容不能丢）
    expect(memory.name).toBe('接管后写的')

    saver.dispose()
  })

  it('未被接管时写入正常通过', async () => {
    await guard.acquireLock(PRJ)

    let memory = { id: PRJ, revision: 0, name: '正常' }
    const persisted = []
    const saver = createAutosaver({
      readProject: () => memory,
      persist: async (data) => {
        persisted.push(structuredClone(data))
      },
      guard: () => guard.verifyLock(PRJ),
      debounceMs: 1,
    })
    saver.reset(memory)

    memory = { ...memory, revision: 1, name: '改过了' }
    saver.markDirty()
    await saver.flush()

    expect(persisted).toHaveLength(1)
    expect(persisted[0].name).toBe('改过了')
    expect(saver.getState().status).toBe(SAVE_STATUS.SAVED)
    saver.dispose()
  })

  it('接管后重试也无效（失锁不是临时故障）', async () => {
    await guard.acquireLock(PRJ)

    let memory = { id: PRJ, revision: 0 }
    const saver = createAutosaver({
      readProject: () => memory,
      persist: async () => {
        throw new Error('不该被调用')
      },
      guard: () => guard.verifyLock(PRJ),
      debounceMs: 1,
    })
    saver.reset(memory)

    await otherTabHolds(PRJ, { fence: 50 })
    memory = { ...memory, revision: 1 }
    saver.markDirty()

    await expect(saver.flush()).rejects.toThrow()
    expect(await saver.retry()).toBe(false)
    expect(saver.getState().status).toBe(SAVE_STATUS.ERROR)
    saver.dispose()
  })
})

// ───────────────────── 心跳不得复活旧锁 ─────────────────────

describe('心跳不会把被夺走的锁刷回来', () => {
  it('失锁后续租被跳过，锁仍归新持有者', async () => {
    guard.__setTimingForTest({ heartbeatMs: 5 })
    await guard.acquireLock(PRJ)

    await otherTabHolds(PRJ, { fence: 9 })

    // 等几个心跳周期，让 renewCurrent 跑几轮
    await new Promise((r) => setTimeout(r, 40))

    const record = await repo.getMeta(lockKey(PRJ))
    // ★ 必须还是 tab_other —— 旧页不许抢回来
    expect(record.tabId).toBe('tab_other')
    expect(record.fence).toBe(9)
  })

  it('正常持有时心跳刷新 heartbeatAt 且不改 fence', async () => {
    guard.__setTimingForTest({ heartbeatMs: 5 })
    const { fence } = await guard.acquireLock(PRJ)
    const before = await repo.getMeta(lockKey(PRJ))

    await new Promise((r) => setTimeout(r, 30))

    const after = await repo.getMeta(lockKey(PRJ))
    expect(after.fence).toBe(fence)
    expect(after.heartbeatAt).toBeGreaterThanOrEqual(before.heartbeatAt)
    expect(await guard.verifyLock(PRJ)).toEqual({ ok: true })
  })
})

// ───────────────────── 失锁事件 ─────────────────────

describe('失锁通知', () => {
  it('心跳发现被接管时通知订阅者', async () => {
    guard.__setTimingForTest({ heartbeatMs: 5 })
    const events = []
    const off = guard.onLockLost((e) => events.push(e))

    await guard.acquireLock(PRJ)
    await otherTabHolds(PRJ, { fence: 9 })
    await new Promise((r) => setTimeout(r, 40))

    expect(events.length).toBeGreaterThan(0)
    expect(events[0].projectId).toBe(PRJ)
    expect(['not_owner', 'stale_fence']).toContain(events[0].reason)

    off()
  })
})

// ───────────────────── 释放 ─────────────────────

describe('释放', () => {
  it('释放后记录转墓碑（owner 清空、fence 保留），别人可立即获取（不等 15 秒）', async () => {
    await guard.acquireLock(PRJ)
    await guard.releaseProject()

    // 释放不是"删记录"，而是写墓碑：只有 owner 被清空，fence 必须留着。
    // 删记录会让下一轮从 fence=1 重新开始，而旧页可能还带着 fence=1 的在飞写入 ——
    // 那笔写入会重新"合法"，正是 fencing token 要防的事。
    const record = await repo.getMeta(lockKey(PRJ))
    expect(record).toMatchObject({ projectId: PRJ, tabId: null, heartbeatAt: 0, fence: 1 })

    // 墓碑视为"没人持有"，别人不必等 15s 过期
    expect((await guard.checkOtherTabs(PRJ)).locked).toBe(false)

    // 下一轮拿锁在原 fence 上递增，而不是回到 1
    const next = await guard.acquireLock(PRJ)
    expect(next.acquired).toBe(true)
    expect(next.fence).toBe(2)
  })

  it('不删别人的锁', async () => {
    await otherTabHolds(PRJ)
    await guard.releaseProject()

    const record = await repo.getMeta(lockKey(PRJ))
    expect(record?.tabId).toBe('tab_other')
  })

  it('stopHeartbeat 释放并清空身份', async () => {
    await guard.acquireLock(PRJ)
    await guard.stopHeartbeat()

    const record = await repo.getMeta(lockKey(PRJ))
    expect(record.tabId).toBeNull()
    expect(await guard.verifyLock(PRJ)).toEqual({ ok: false, reason: 'missing' })
  })

  // 关标签页那条路径：关闭方自己在 pagehide 里发起的 IDB 事务会被浏览器丢弃，
  // 所以真正落盘的是"还活着的标签页"收到 bye 之后执行的 releaseLockOfTab。
  describe('替别的标签页交还锁（bye）', () => {
    it('tabId 与 fence 都匹配时清成墓碑', async () => {
      await otherTabHolds(PRJ, { fence: 3 })

      const r = await guard.releaseLockOfTab(PRJ, { tabId: 'tab_other', fence: 3 })
      expect(r.released).toBe(true)

      const record = await repo.getMeta(lockKey(PRJ))
      expect(record).toMatchObject({ tabId: null, heartbeatAt: 0, fence: 3 })
    })

    it('fence 不一致时不动别人的锁（迟到的 bye 不能清掉新主人）', async () => {
      await otherTabHolds(PRJ, { fence: 5 })

      const r = await guard.releaseLockOfTab(PRJ, { tabId: 'tab_other', fence: 4 })
      expect(r.released).toBe(false)

      const record = await repo.getMeta(lockKey(PRJ))
      expect(record.tabId).toBe('tab_other')
      expect(record.fence).toBe(5)
    })

    it('tabId 不一致时不动', async () => {
      await otherTabHolds(PRJ, { fence: 2 })

      const r = await guard.releaseLockOfTab(PRJ, { tabId: 'tab_someone_else', fence: 2 })
      expect(r.released).toBe(false)

      expect((await repo.getMeta(lockKey(PRJ))).tabId).toBe('tab_other')
    })
  })
})

// ───────────────────── checkOtherTabs ─────────────────────

describe('checkOtherTabs（决定是否只读打开）', () => {
  it('无锁 → 不上锁', async () => {
    expect((await guard.checkOtherTabs(PRJ)).locked).toBe(false)
  })

  it('他人活跃持锁 → 上锁', async () => {
    await otherTabHolds(PRJ)
    const r = await guard.checkOtherTabs(PRJ)
    expect(r.locked).toBe(true)
    expect(r.byTabId).toBe('tab_other')
  })

  it('他人心跳过期 → 不上锁', async () => {
    guard.__setTimingForTest({ staleMs: 50 })
    await otherTabHolds(PRJ, { ageMs: 200 })
    expect((await guard.checkOtherTabs(PRJ)).locked).toBe(false)
  })

  it('自己持锁 → 不算冲突（否则自己打不开自己的项目）', async () => {
    await guard.acquireLock(PRJ)
    const r = await guard.checkOtherTabs(PRJ)
    expect(r.locked).toBe(false)
    expect(r.isSelf).toBe(true)
  })
})

// ───────────────────── 页面卸载时释放锁 ─────────────────────

/**
 * 为什么这些用例重要：
 *   页面卸载（pagehide）时浏览器会停止执行微任务队列，await 之后的代码都不跑，
 *   indexedDB.open() 也会被拒绝。所以卸载路径必须：
 *     1. 用本地缓存判断"这把锁还是我的"（不能现场去读）；
 *     2. 用已打开的 db 句柄发起条件释放（不能等事务完成）。
 *
 *   这两条任一做错，后果都是"关掉标签页后锁不交还"，
 *   别的标签页要白等 15 秒才能接管 —— 用户会以为应用卡住了。
 */
describe('页面卸载时释放锁', () => {
  it('拿锁后释放 owner 但保留 fence 代数', async () => {
    const acquired = await guard.acquireLock(PRJ)
    await guard.releaseProject()
    expect(await repo.getMeta(lockKey(PRJ))).toMatchObject({ tabId: null, fence: acquired.fence })
    const reacquired = await guard.acquireLock(PRJ)
    expect(reacquired.fence).toBe(acquired.fence + 1)
  })

  it('释放后缓存复位，再释放不会误删别人的锁', async () => {
    await guard.acquireLock(PRJ)
    await guard.releaseProject()

    // 模拟另一个标签页接管
    await otherTabHolds(PRJ, { fence: 3 })

    // 再次 release 应该什么都不做 —— 不能删掉对方的锁
    await guard.releaseProject()
    const still = await repo.getMeta(lockKey(PRJ))
    expect(still).not.toBeNull()
    expect(still.tabId).toBe('tab_other')
  })

  it('失锁后卸载路径不会删掉接管者的锁', async () => {
    await guard.acquireLock(PRJ)
    // 别人接管：tabId 与 fence 都变了
    await otherTabHolds(PRJ, { fence: 2 })

    // verifyLock 应当判定失锁
    const v = await guard.verifyLock(PRJ)
    expect(v.ok).toBe(false)

    // 卸载路径：模拟 pagehide 里调用的同步条件释放
    // （releaseOnUnload 内部依赖 ownsCurrentLock，这里通过 verify 触发的失锁路径验证语义）
    await guard.releaseProject()
    const still = await repo.getMeta(lockKey(PRJ))
    expect(still).not.toBeNull()
    expect(still.tabId).toBe('tab_other')
  })
})

// ───────────────────── 卸载时条件释放 ─────────────────────

describe('releaseMetaSyncIfLockOwned（卸载路径用的同步条件释放）', () => {
  it('只释放仍属于预期 owner/fence 的锁', async () => {
    await repo.setMeta('probe_key', { tabId: 'tab_owner', fence: 4, heartbeatAt: Date.now() })
    // 先确保连接已建立
    await repo.getMeta('probe_key')

    const fired = repo.releaseMetaSyncIfLockOwned('probe_key', { tabId: 'tab_owner', fence: 4 })
    expect(fired).toBe(true)

    // 事务是异步提交的，给它一点时间
    await new Promise((r) => setTimeout(r, 100))
    expect(await repo.getMeta('probe_key')).toMatchObject({ tabId: null, fence: 4 })
  })

})
