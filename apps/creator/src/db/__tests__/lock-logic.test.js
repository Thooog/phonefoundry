

import { describe, it, expect } from 'vitest'
import {
  decideAcquire,
  decideTakeover,
  decideVerify,
  decideRenew,
  decideRelease,
  isLockAlive,
  lockKey,
  STALE_MS,
} from '../lock-logic.js'

const PRJ = 'prj_1'
const T0 = 1_700_000_000_000

/** 造一个"我现在调用"的上下文 */
function me(tabId, now = T0, extra = {}) {
  return { tabId, now, projectId: PRJ, ...extra }
}

// ───────────────────── 获取 ─────────────────────

describe('decideAcquire', () => {
  it('无锁时获取成功，fence 从 1 开始', () => {
    const r = decideAcquire(null, me('tabA'))
    expect(r.acquired).toBe(true)
    expect(r.next.fence).toBe(1)
    expect(r.next.tabId).toBe('tabA')
    expect(r.next.projectId).toBe(PRJ)
    expect(r.next.key).toBe(`lock:${PRJ}`)
  })

  it('别人持有且心跳新鲜 → 拒绝，并告知持有者', () => {
    const held = { key: lockKey(PRJ), projectId: PRJ, tabId: 'tabA', fence: 1, heartbeatAt: T0 }
    const r = decideAcquire(held, me('tabB', T0 + 1000))

    expect(r.acquired).toBe(false)
    expect(r.reason).toBe('held_by_other')
    expect(r.ownerTabId).toBe('tabA')
    expect(r.next).toBeNull()
  })

  it('别人持有但心跳过期 → 可以接手，fence 递增', () => {
    const held = {
      key: lockKey(PRJ),
      projectId: PRJ,
      tabId: 'tabA',
      fence: 1,
      heartbeatAt: T0,
    }
    const r = decideAcquire(held, me('tabB', T0 + STALE_MS + 1))

    expect(r.acquired).toBe(true)
    expect(r.next.tabId).toBe('tabB')
    expect(r.next.fence).toBe(2)
  })

  it('自己已是 owner → 续租，fence 不变', () => {
    const held = { key: lockKey(PRJ), projectId: PRJ, tabId: 'tabA', fence: 3, heartbeatAt: T0 }
    const r = decideAcquire(held, me('tabA', T0 + 5000))

    expect(r.acquired).toBe(true)
    // ★ 心跳绝不能改 fence，否则自己的在飞写入会被自己作废
    expect(r.next.fence).toBe(3)
    expect(r.next.heartbeatAt).toBe(T0 + 5000)
  })

  it('tabId 为空字符串的残留记录视为无锁', () => {
    const residue = { key: lockKey(PRJ), projectId: PRJ, tabId: '', fence: 5, heartbeatAt: 0 }
    const r = decideAcquire(residue, me('tabB'))
    expect(r.acquired).toBe(true)
    // 已释放记录里的 fence 应递增，避免旧写入凭据重新有效
    expect(r.next.fence).toBe(6)
  })

  /**
   * 存活标记只用来"提前判定已死"，不能替代心跳。
   * 这三条一起定义了它的边界：
   *   标记在 / 不知道 → 按心跳走（可能拿到，也可能等人）
   *   标记明确消失   → 立即接手（关标签页后不必白等 15 秒）
   */
  describe('持有者存活标记（ownerAliveHint）', () => {
    const fresh = { key: lockKey(PRJ), projectId: PRJ, tabId: 'tabA', fence: 1, heartbeatAt: T0 }

    it('心跳新鲜 + 标记在 → 仍然只读', () => {
      const r = decideAcquire(fresh, me('tabB', T0 + 1000, { ownerAliveHint: true }))
      expect(r.acquired).toBe(false)
      expect(r.reason).toBe('held_by_other')
    })

    it('心跳新鲜 + 标记消失 → 立即接手，且 fence 递增', () => {
      const r = decideAcquire(fresh, me('tabB', T0 + 1000, { ownerAliveHint: false }))
      expect(r.acquired).toBe(true)
      expect(r.next.fence).toBe(2)
      // 旧页的在飞写入仍会被写入端拒掉
      expect(decideVerify(r.next, { tabId: 'tabA', fence: 1 }).valid).toBe(false)
    })

    it('不知道存活状态 → 保守按心跳走，不抢', () => {
      const r = decideAcquire(fresh, me('tabB', T0 + 1000, { ownerAliveHint: undefined }))
      expect(r.acquired).toBe(false)
    })
  })
})

// ───────────────────── ★ 核心：接管后的旧写入必须被拒 ─────────────────────

describe('A-12 核心：接管后旧标签页的写入必须被拒', () => {
  it('fence 变化后，旧 fence 的持有者校验失败', () => {
    // 时间线：
    //  1. tabA 拿到锁，fence=1
    //  2. tabB 强制接管，fence=2
    //  3. tabA 还想写入
    const aLock = decideAcquire(null, me('tabA')).next
    const bLock = decideTakeover(aLock, { tabId: 'tabB', now: T0 + 100, projectId: PRJ })

    expect(bLock.fence).toBe(2)

    // A 拿的是 fence=1，当前锁是 fence=2 → 必须拒绝
    const verdict = decideVerify(bLock, { tabId: 'tabA', fence: aLock.fence, now: T0 + 200 })
    expect(verdict.valid).toBe(false)
    expect(verdict.reason).toBe('not_owner')
    expect(verdict.currentFence).toBe(2)
  })

  it('即使接管后又"转回同一个 tabId"，旧代数也无效（stale_fence）', () => {
    // 这是 tabId 单字段方案绝对防不住的场景：
    // 页面刷新后复用了同一个 tabId，但中间的接管代数变了。
    const aLock = decideAcquire(null, me('tabA')).next // fence=1
    const bLock = decideTakeover(aLock, { tabId: 'tabB', now: T0 + 100, projectId: PRJ }) // fence=2
    const aLockAgain = decideTakeover(bLock, { tabId: 'tabA', now: T0 + 200, projectId: PRJ }) // fence=3

    // A 手里还是 fence=1（它没意识到中间被接管过两次）
    const verdict = decideVerify(aLockAgain, { tabId: 'tabA', fence: 1, now: T0 + 300 })
    expect(verdict.valid).toBe(false)
    expect(verdict.reason).toBe('stale_fence')

    // 而 A 如果用上最新的 fence=3，就有效
    expect(decideVerify(aLockAgain, { tabId: 'tabA', fence: 3, now: T0 + 300 }).valid).toBe(true)
  })

  it('未经接管的正常持有者校验通过', () => {
    const lock = decideAcquire(null, me('tabA')).next
    const verdict = decideVerify(lock, { tabId: 'tabA', fence: lock.fence, now: T0 + 1000 })
    expect(verdict.valid).toBe(true)
  })

  it('锁被删掉后校验失败（missing）', () => {
    const verdict = decideVerify(null, { tabId: 'tabA', fence: 1, now: T0 })
    expect(verdict.valid).toBe(false)
    expect(verdict.reason).toBe('missing')
  })

  it('接管时 fence 必增，哪怕对方已死', () => {
    const dead = { key: lockKey(PRJ), projectId: PRJ, tabId: 'tabA', fence: 7, heartbeatAt: 0 }
    const r = decideTakeover(dead, { tabId: 'tabB', now: T0, projectId: PRJ })
    expect(r.fence).toBe(8)
  })
})

// ───────────────────── 心跳续租 ─────────────────────

describe('decideRenew', () => {
  it('有效持有者可以续租，updated heartbeat 但不改 fence', () => {
    const lock = decideAcquire(null, me('tabA')).next
    const r = decideRenew(lock, { tabId: 'tabA', fence: lock.fence, now: T0 + 5000 })

    expect(r.renewed).toBe(true)
    expect(r.next.heartbeatAt).toBe(T0 + 5000)
    expect(r.next.fence).toBe(lock.fence)
  })

  it('★ 失锁后停止续租 —— 否则旧页会把已被夺走的锁刷回来', () => {
    const aLock = decideAcquire(null, me('tabA')).next
    const bLock = decideTakeover(aLock, { tabId: 'tabB', now: T0 + 100, projectId: PRJ })

    const r = decideRenew(bLock, { tabId: 'tabA', fence: 1, now: T0 + 200 })
    expect(r.renewed).toBe(false)
  })

  it('fence 过期时也不续租', () => {
    const lock = decideAcquire(null, me('tabA')).next // fence=1
    const r = decideRenew(lock, { tabId: 'tabA', fence: 0, now: T0 + 100 })
    expect(r.renewed).toBe(false)
    expect(r.reason).toBe('stale_fence')
  })
})

// ───────────────────── 释放 ─────────────────────

describe('decideRelease', () => {
  it('能删自己的锁', () => {
    const lock = decideAcquire(null, me('tabA')).next
    expect(decideRelease(lock, { tabId: 'tabA' })).toBe(true)
  })

  it('不能删别人的锁', () => {
    const lock = decideAcquire(null, me('tabA')).next
    expect(decideRelease(lock, { tabId: 'tabB' })).toBe(false)
  })

  it('无锁时不删', () => {
    expect(decideRelease(null, { tabId: 'tabA' })).toBe(false)
  })
})

// ───────────────────── 每项目独立 ─────────────────────

describe('每项目一条锁，互不影响', () => {
  it('同一标签页可同时持有两个不同项目的锁', () => {
    const lockA = decideAcquire(null, { tabId: 'tabA', now: T0, projectId: 'prj_A' })
    const lockB = decideAcquire(null, { tabId: 'tabA', now: T0, projectId: 'prj_B' })

    expect(lockA.acquired).toBe(true)
    expect(lockB.acquired).toBe(true)
    expect(lockA.next.key).toBe('lock:prj_A')
    expect(lockB.next.key).toBe('lock:prj_B')
  })

  it('A 编辑项目 1、B 编辑项目 2，互不阻塞', () => {
    const lock1 = decideAcquire(null, { tabId: 'tabA', now: T0, projectId: 'prj_1' }).next

    // B 去拿项目 2 的锁，与项目 1 无关
    const r = decideAcquire(null, { tabId: 'tabB', now: T0, projectId: 'prj_2' })
    expect(r.acquired).toBe(true)

    // 回到项目 1，A 依然有效
    expect(decideVerify(lock1, { tabId: 'tabA', fence: 1, now: T0 + 10 }).valid).toBe(true)
  })
})

// ───────────────────── 存活判定 ─────────────────────

describe('isLockAlive', () => {
  it('心跳在窗口内算活着', () => {
    expect(isLockAlive({ tabId: 'a', heartbeatAt: T0 }, T0 + STALE_MS - 1)).toBe(true)
  })

  it('刚好卡在边界上算活着（<= 比较）', () => {
    expect(isLockAlive({ tabId: 'a', heartbeatAt: T0 }, T0 + STALE_MS)).toBe(true)
  })

  it('超过窗口算死亡', () => {
    expect(isLockAlive({ tabId: 'a', heartbeatAt: T0 }, T0 + STALE_MS + 1)).toBe(false)
  })

  it('空记录、缺心跳、时间倒流都算死亡', () => {
    expect(isLockAlive(null, T0)).toBe(false)
    expect(isLockAlive({ tabId: 'a' }, T0)).toBe(false)
    expect(isLockAlive({ tabId: 'a', heartbeatAt: 0 }, T0)).toBe(false)
    expect(isLockAlive({ tabId: 'a', heartbeatAt: T0 + 999999 }, T0)).toBe(false)
  })
})
