

/** 心跳周期：5 秒写一次，15 秒没心跳视为已死 */
export const HEARTBEAT_MS = 5000
export const STALE_MS = 15000

export const LOCK_KEY_PREFIX = 'lock:'

export function lockKey(projectId) {
  return `${LOCK_KEY_PREFIX}${projectId}`
}

/**
 * 锁是否还活着（owner 心跳未过期）。
 *
 * 处理三种异常而非只有"过期"一种：
 *  - 心跳在未来：系统时钟被回拨过，或机器时间不同步。
 *    若当成"活着"，锁会被一个根本不存在的时刻永久占住（用户只能手动接管）。
 *    这里按"死亡"处理 —— 因为一个看似来自未来的心跳，无论如何都不该阻止本人编辑。
 *  - 心跳为 0 / 缺失：残留记录，视为死亡。
 *  - 正常过期：视为死亡。
 *
 * @param {object|null} record
 * @param {number} now
 * @param {number} [staleMs]
 */
export function isLockAlive(record, now, staleMs = STALE_MS) {
  if (!record || !record.tabId) return false
  const beat = Number(record.heartbeatAt ?? 0)
  if (!Number.isFinite(beat) || beat <= 0) return false
  // 未来心跳：时钟回拨，不认
  if (beat > now) return false
  return now - beat <= staleMs
}

/**
 * 判断"我现在能不能拿到锁"。
 *
 * 注意"拿锁"在这里是**判定**，不是"写入"——写入锁记录由调用方在同一事务里做，
 * 因为 IDB 的读改写必须原子，纯函数只负责给出结论。
 *
 * @param {object|null} record 现有锁记录（可能为 null）
 * @param {{tabId: string, now: number, staleMs?: number, projectId?: string, ownerAliveHint?: boolean}} ctx
 *   ownerAliveHint：持有者所在标签页的存活标记（`true` 在 / `false` 已消失 / `undefined` 未知）。
 *   只用于"提前判定已死"，不参与安全性判断。
 * @returns {{acquired: boolean, next: object|null, reason?: string, ownerTabId?: string}}
 *   acquired=true 时 next 是应当写入的新锁记录；
 *   acquired=false 时 reason 说明原因。
 */
export function decideAcquire(record, ctx) {
  const { tabId, now, staleMs = STALE_MS, projectId, ownerAliveHint } = ctx

  // 新锁从 1 开始；已释放的 tombstone 则在原 fence 上递增。
  if (!record || !record.tabId) {
    return {
      acquired: true,
      next: {
        key: lockKey(projectId),
        projectId,
        tabId,
        fence: nextFence(record),
        heartbeatAt: now,
      },
    }
  }

  // 自己已经是 owner：续租，fence 不变（这一点很关键，
  // 否则每次心跳都换代数，自己的在飞写入会被自己作废）
  if (record.tabId === tabId) {
    return {
      acquired: true,
      next: { ...record, projectId, heartbeatAt: now },
    }
  }

  // 别人持有但已过期：接手，fence 递增
  if (!isLockAlive(record, now, staleMs)) {
    return {
      acquired: true,
      next: {
        key: lockKey(projectId),
        projectId,
        tabId,
        fence: nextFence(record),
        heartbeatAt: now,
      },
    }
  }

  // 心跳还新鲜，但持有者的**存活标记已经消失** → 那个标签页已经关了。
  //
  // 为什么不能只靠心跳过期：
  //   心跳 5s 一次、15s 过期，而关闭标签页时那条"交还锁"的 IDB 事务会被浏览器

  //   于是用户关掉标签页再打开，要白等最多 15 秒才拿回自己的项目。
  //
  // 存活标记是 localStorage 里的同步写，关闭时删除必然成功，跨标签页立即可见。
  // 它只是**加速判据**，不是安全判据：即使被误删，接手方仍会 fence+1，
  // 旧页的在飞写入照样被写入端拒掉。
  if (ownerAliveHint === false) {
    return {
      acquired: true,
      next: {
        key: lockKey(projectId),
        projectId,
        tabId,
        fence: nextFence(record),
        heartbeatAt: now,
      },
    }
  }

  return {
    acquired: false,
    next: null,
    reason: 'held_by_other',
    ownerTabId: record.tabId,
  }
}

/**
 * 强制接管：不管对方是否还活着，直接把 owner 换成自己，fence 必增。
 *
 * fence 必增是硬要求 —— 哪怕接管者恰好是同一个 tabId（例如页面刷新后
 * 复用旧 id 的极端情况），代数也必须变化，否则无法区分"接管前"和"接管后"的写入。
 *
 * @param {object|null} record
 * @param {{tabId: string, now: number, projectId: string}} ctx
 */
export function decideTakeover(record, ctx) {
  const { tabId, now, projectId } = ctx
  return {
    key: lockKey(projectId),
    projectId,
    tabId,
    fence: nextFence(record),
    heartbeatAt: now,
  }
}

function nextFence(record) {
  const current = Number(record?.fence ?? 0)
  return Number.isSafeInteger(current) && current >= 0 ? current + 1 : 1
}

/**
 * 我持有的锁是否仍然有效。
 *
 * 用于项目写事务内的最终校验，也可用于快速预检。
 *
 * @param {object|null} record 当前锁记录
 * @param {{tabId: string, fence: number}} ctx
 *   fence 是我开始编辑时拿到的代数（不是"当前代数"）
 * 注意：这里**不看时间**。锁是否"活着"由心跳负责；
 * 写入校验只认"持有者 + 代数"，两者都过就是可写。
 * @returns {{valid: boolean, reason?: 'not_owner'|'stale_fence'|'missing', currentFence?: number}}
 */
export function decideVerify(record, ctx) {
  const { tabId, fence } = ctx

  if (!record || !record.tabId) {
    return { valid: false, reason: 'missing', currentFence: 0 }
  }
  if (record.tabId !== tabId) {
    return { valid: false, reason: 'not_owner', currentFence: Number(record.fence ?? 0) }
  }
  // 代数对不上 = 在我拿到锁之后，有人接管过。
  // 就算现在 owner 又是我的 tabId，中间那段写入也必须作废。
  if (Number(record.fence ?? 0) !== Number(fence)) {
    return { valid: false, reason: 'stale_fence', currentFence: Number(record.fence ?? 0) }
  }
  return { valid: true, currentFence: Number(record.fence ?? 0) }
}

/**
 * 能否续租心跳。
 * 失锁后必须停止续租 —— 否则旧页会把已经被夺走的锁又"刷"回来。
 *
 * @param {object|null} record
 * @param {{tabId: string, fence: number, now: number, staleMs?: number}} ctx
 */
export function decideRenew(record, ctx) {
  const verdict = decideVerify(record, ctx)
  if (!verdict.valid) return { renewed: false, reason: verdict.reason }
  return { renewed: true, next: { ...record, heartbeatAt: ctx.now } }
}

/**
 * 我能不能删掉这条锁。
 * 只能删自己的 —— 否则关闭一个标签页会顺手释放别人的锁。
 *
 * @param {object|null} record
 * @param {{tabId: string, fence?: number}} ctx
 */
export function decideRelease(record, ctx) {
  if (!record || !record.tabId) return false
  if (record.tabId !== ctx.tabId) return false
  // 不校验 fence：即使被接管过又转回自己，关闭时也该清掉自己的痕迹
  return true
}
