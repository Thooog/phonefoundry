

import * as repo from './repository.js'
import {
  HEARTBEAT_MS,
  STALE_MS,
  decideAcquire,
  decideRenew,
  decideTakeover,
  decideVerify,
  isLockAlive,
  lockKey,
} from './lock-logic.js'

let tabId = null
let heartbeatTimer = null
/** 当前正在编辑的项目 */
let currentProjectId = null
/** 当前持有的代数。失锁后与锁记录不等，写入会被拒 */
let currentFence = 0

let ownsCurrentLock = false
let visibilityBound = false
const listeners = new Set()

/** 可注入的时间参数，仅测试使用（避免真的等 15 秒） */
let timing = { heartbeatMs: HEARTBEAT_MS, staleMs: STALE_MS }

/** sessionStorage 里存 tabId 的键 */
const TAB_ID_KEY = 'phone-sim-tab-id'
const TAB_CHANNEL = 'phone-sim-tab-presence'

const ALIVE_KEY_PREFIX = 'phone-sim-tab-alive:'
const PRESENCE_HANDSHAKE_MS = 100
let identityPromise = null
let presenceChannel = null
let presenceInstanceId = null
let presenceActive = false

/**
 * 本标签页的身份 id。
 *
 * 必须跨刷新保持稳定，所以存 sessionStorage。复制标签页可能克隆这份值，
 * 因此初始化时还会用 BroadcastChannel 检查是否已有同 id 的活动页面。
 *
 * 如果每次加载都生成新的：
 *   用户按 F5 → 新 id ≠ 锁记录里的旧 id → 旧心跳还在 15 秒有效期内
 *   → 自己被判成"另一个标签页"→ 刷新后反而变成只读。
 *   这是最容易被当成"锁坏了"的那种 bug。
 */
function createTabId() {
  try {
    const existing = sessionStorage.getItem(TAB_ID_KEY)
    if (existing) return existing
    return saveTabId(createFreshTabId())
  } catch {
    // 隐私模式或存储被禁用：退回内存 id。
    // 代价是刷新后要重新接管一次，但不至于整个编辑器不能用。
    return createFreshTabId()
  }
}

function createFreshTabId() {
  const randomId = globalThis.crypto?.randomUUID?.()
  return `tab_${randomId ?? `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`}`
}

function saveTabId(id) {
  try {
    sessionStorage.setItem(TAB_ID_KEY, id)
  } catch {
    /* 存储被禁用时仅保存在内存 */
  }
  return id
}

async function initializeTabIdentity() {
  tabId = createTabId()
  presenceInstanceId = createFreshTabId()

  // 复制标签页可能复制 sessionStorage。新页面探测同 id 的活动页；
  // 两个复制页同时启动时，它们也会互相发现并各自换成独立 id。
  if (typeof window === 'undefined' || typeof BroadcastChannel !== 'function') return tabId
  try {
    presenceChannel = new BroadcastChannel(TAB_CHANNEL)
    let collision = false
    presenceChannel.onmessage = ({ data }) => {
      if (!data) return

      // 别的标签页正在关闭，喊了一声 bye。
      //
      // 为什么清锁要由**活着的**页面来做：
      //   关闭方在 pagehide 里发起的 IDB 事务会被浏览器在销毁过程中丢弃

      //    但那条 release 事务一条记录都没写进去）。
      //   所以卸载方只负责"广播"（同步 postMessage，消息已经进了浏览器进程队列），
      //   真正落盘交给还活着的标签页。
      //

      if (data.type === 'bye') {
        void releaseLockOfTab(data.projectId, { tabId: data.tabId, fence: data.fence })
        return
      }

      if (data.tabId !== tabId || data.instanceId === presenceInstanceId) return
      if (data.type === 'hello') {
        if (!presenceActive) collision = true
        presenceChannel.postMessage({
          type: 'hello_ack',
          tabId,
          instanceId: presenceInstanceId,
          to: data.instanceId,
          active: presenceActive,
        })
      } else if (data.type === 'hello_ack' && data.to === presenceInstanceId) {
        collision = true
      }
    }
    presenceChannel.postMessage({ type: 'hello', tabId, instanceId: presenceInstanceId })
    await new Promise((resolve) => setTimeout(resolve, PRESENCE_HANDSHAKE_MS))
    if (collision) tabId = saveTabId(createFreshTabId())
    presenceActive = true
  } catch {
    presenceChannel?.close()
    presenceChannel = null
    // BroadcastChannel 不可用时仍可编辑；普通新标签页仍由 sessionStorage 隔离。
    presenceActive = true
  }
  return tabId
}

function now() {
  return Date.now()
}

// ───────────────────── 标签页存活标记 ─────────────────────

/**
 * 写下"本页还活着"。拿到锁、每次心跳续租时都刷一次。
 * localStorage 不可用（隐私模式、被策略禁用）时静默降级 —— 只影响"提前判定已死"，
 * 不影响锁的正确性：那时会退回"等心跳过期 15 秒"。
 */
function markTabAlive() {
  if (!tabId) return
  try {
    localStorage.setItem(ALIVE_KEY_PREFIX + tabId, String(now()))
  } catch {
    /* 降级：靠心跳过期兜底 */
  }
}

/** 删掉存活标记。释放、失锁、关闭页面时调用。 */
function clearTabAlive(id = tabId) {
  if (!id) return
  try {
    localStorage.removeItem(ALIVE_KEY_PREFIX + id)
  } catch {
    /* 忽略 */
  }
}

/**
 * 查某个标签页的存活标记。
 * @returns {boolean|undefined} `false` = 标记已消失（那个标签页关了）；`undefined` = 查不了
 */
function isTabAliveByMarker(id) {
  if (!id) return undefined
  try {
    return localStorage.getItem(ALIVE_KEY_PREFIX + id) !== null
  } catch {
    return undefined
  }
}

async function readLock(projectId) {
  try {
    const record = await repo.getMeta(lockKey(projectId))
    return { ok: true, record: record ?? null }
  } catch {
    return { ok: false, record: null }
  }
}

/** 通知订阅者失锁（store 用它切到只读 + 给"另存为副本"出口） */
function emitLostLock(projectId, reason) {
  for (const fn of listeners) {
    try {
      fn({ type: 'lock_lost', projectId, reason })
    } catch {
      /* 订阅者自己的问题不该影响锁逻辑 */
    }
  }
}

// ───────────────────── 身份与心跳 ─────────────────────

/**
 * 启动心跳。每个标签页只需调用一次。
 * 注意：这里**不写任何锁**，只是开始为"当前项目"续租。拿锁是 acquireLock 的事。
 * @returns {Promise<string>} 本标签页的 id
 */
export async function startHeartbeat() {
  if (identityPromise) {
    await identityPromise
    return tabId
  }
  if (tabId) return tabId

  identityPromise = initializeTabIdentity()
  try {
    await identityPromise
  } finally {
    identityPromise = null
  }
  heartbeatTimer = setInterval(renewCurrent, timing.heartbeatMs)

  // 页面回到前台时补一次，缩短"切回来才发现被接管"的滞后
  if (!visibilityBound && typeof document !== 'undefined') {
    visibilityBound = true
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') renewCurrent()
    })

    // 关标签页 / 关窗口时交还锁。
    //
    // 为什么必须监听 pagehide：
    //   心跳每 5s 一次、锁 15s 过期。如果关闭页面时不主动释放，
    //   别的标签页要白等最多 15 秒才能接管这个项目 —— 用户会以为应用卡住了。
    //   而 stopHeartbeat() 里的 releaseProject() 只有测试在调，页面卸载时根本不会跑。
    //
    // 为什么用 pagehide 而不是 beforeunload：
    //   beforeunload 在部分场景（尤其是移动端）不触发；
    //   pagehide 是页面真正离开的标准信号，覆盖关闭标签页、后退、导航离开。
    //
    // 为什么必须监听 **window** 而不是 document：
    //   pagehide 是派发在 Window 上的事件，传播路径只有 Window 自己 ——
    //   注册在 document 上的监听器永远不会被调用（只是"注册成功"，看起来没坏）。
    //
    // 为什么不等它完成：
    //   页面卸载时无法 await IDB 事务，所以这里发起条件释放后立即返回。
    //   最坏情况是事务没完成 —— 那条存活标记会兜住（见 ALIVE_KEY_PREFIX）。
    window.addEventListener('pagehide', () => {
      releaseOnUnload()
    })
    // 记一个"监听器已注册"的标记。
    // 没有它就无法区分"pagehide 没触发"和"根本没注册监听器"——

    try {
      localStorage.setItem('__tabGuardPagehideBound', '1')
    } catch {
      /* 隐私模式下 localStorage 可能不可用 */
    }
  }
  return tabId
}

/**
 * 页面卸载时释放锁（不等结果）。
 *
 * 与 releaseProject 的区别：
 *   releaseProject 会等事务完成，用于正常流程；
 *   这里必须"发起即忘" —— 页面正在销毁，等一个永远不会完成的 await 没有意义。
 *
 * 仅释放凭据仍匹配的锁，并保留 fence，防止下一轮从旧代数重新开始。
 */
function releaseOnUnload() {
  const projectId = currentProjectId
  const owner = { tabId, fence: currentFence }

  // ① 抹掉存活标记。这是**唯一**在关标签页这条路径上确定能生效的一步：
  //    localStorage 同步写、跨标签页立即可见，不等事务、也不怕文档销毁。
  //    别的标签页看到标记不在，就会立刻接手（decideAcquire 的 ownerAliveHint），
  //    不用白等 15 秒心跳过期。
  //    放在最前面：即使本页没持锁，也要把痕迹清掉，否则 localStorage 里会积累陈旧键。
  clearTabAlive(tabId)

  if (!projectId || !tabId) return

  // 先停心跳：否则释放的读操作还没回来，心跳可能又把锁写回去。
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }

  // 释放前提：确认这把锁确实还是我的。
  //
  // 卸载时不能做异步读（新建 IDB 事务会被中止），
  // 所以靠本地缓存 ownsCurrentLock 判断。
  // 它在拿锁成功后为 true，在释放 / 失锁后为 false ——
  // 期间若有别人接管，本页的 verifyLock 会失败并触发失锁回调，把缓存置回 false。
  if (!ownsCurrentLock) return

  currentProjectId = null
  currentFence = 0
  ownsCurrentLock = false

  // ② 广播"我要走了"：收到的一方能立刻清墓碑。

  //    探针里旁听通道一帧都没收到），所以它只是锦上添花，真正兜底的是上面那个标记。
  try {
    presenceChannel?.postMessage({ type: 'bye', tabId: owner.tabId, fence: owner.fence, projectId })
  } catch {
    /* 通道不可用就只剩下面那条兜底 */
  }

  // ③ 再试一次同步条件释放。

  //    但覆盖"卸载后进程仍存活"（如 bfcache、后台标签）等情形，保留成本极低。
  repo.releaseMetaSyncIfLockOwned(lockKey(projectId), owner)
}

/**
 * 替**另一个**标签页交还它持有的锁。
 *
 * 只由 BroadcastChannel 的 bye 消息触发：对方正在关闭，自己已经无法可靠落盘。
 *
 * 两道校验缺一不可：
 *   · tabId 必须仍是发起者 —— 否则等于随便一个页面就能释放别人的锁；
 *   · fence 必须一致 —— 否则"迟到的 bye"会把已经易主给新标签页的锁清掉，
 *     而新主人还在编辑器里正常保存，它的下一次写入会莫名其妙报 lock_lost。
 *
 * 校验不过就什么都不做，让心跳自然过期（15s）兜住。
 */
export async function releaseLockOfTab(projectId, owner) {
  if (!projectId || !owner?.tabId) return { released: false, reason: 'bad_request' }
  try {
    const released = await repo.updateMeta(lockKey(projectId), (record) => {
      if (!record || record.tabId !== owner.tabId) return { result: false }
      if (Number(record.fence ?? 0) !== Number(owner.fence)) return { result: false }
      return { write: true, value: { ...record, tabId: null, heartbeatAt: 0 }, result: true }
    })
    if (released === true) clearTabAlive(owner.tabId)
    return { released: released === true, reason: released === true ? 'released' : 'not_owned' }
  } catch {
    return { released: false, reason: 'error' }
  }
}

/**
 * 续租当前项目的锁。
 *
 * 关键：**失锁即停止续租**。
 * 若无脑刷心跳，旧标签页会把已经被夺走的锁重新写成自己的 —— fence 就白设计了。
 */
async function renewCurrent() {
  if (!tabId || !currentProjectId) return
  const projectId = currentProjectId
  const owner = { tabId, fence: currentFence }
  let verdict
  try {
    verdict = await repo.updateMeta(lockKey(projectId), (record) => {
      const next = decideRenew(record, {
        ...owner,
        now: now(),
        staleMs: timing.staleMs,
      })
      return next.renewed
        ? { write: true, value: next.next, result: next }
        : { result: next }
    })
  } catch {
    // 一轮事务失败只跳过心跳，不因存储抖动判失锁。
    return
  }
  if (!verdict.renewed) {
    if (verdict.reason === 'not_owner' || verdict.reason === 'stale_fence' || verdict.reason === 'missing') {
      // 失锁：本地缓存也要立刻置否，
      // 否则卸载时 releaseOnUnload 会以为锁还是自己的，去删对方的锁。
      ownsCurrentLock = false
      clearTabAlive(tabId)
      emitLostLock(projectId, verdict.reason)
    }
    return
  }

  // 续租成功 → 刷新存活标记。这是"这一页还在"的心跳信号，
  // 另一个标签页拿锁时靠它区分"持有者还活着"和"持有者已经关了"。
  markTabAlive()
}

/** 停止心跳并释放当前项目的锁 */
export async function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
  await releaseProject()
  // 本页已经明确退出编辑，存活标记一并收掉（否则 localStorage 里留陈旧键）
  clearTabAlive(tabId)
  presenceChannel?.close()
  presenceChannel = null
  presenceInstanceId = null
  presenceActive = false
  tabId = null
}

// ───────────────────── 拿锁 / 放锁 ─────────────────────

/**
 * 尝试获取某项目的编辑锁。
 *
 * @param {string} projectId
 * @returns {Promise<{acquired: boolean, fence?: number, ownerTabId?: string, reason?: string}>}
 */
export async function acquireLock(projectId) {
  await startHeartbeat()
  let result
  try {
    result = await repo.updateMeta(lockKey(projectId), (record) => {
      const decision = decideAcquire(record, {
        tabId,
        now: now(),
        projectId,
        staleMs: timing.staleMs,
        // 持有者的存活标记：消失即可判定"那页已关"，不必等心跳过期。
        //
        // 只有在**锁记录本身带 aliveMarker 字段**时才敢用这个判据：
        // 该字段表示"这条记录是由会写存活标记的代码写下的"。
        // 老记录、以及测试里手工写的锁记录都没有这个字段 ——
        // 那种情况下"标记不存在"只说明我们不知道，不能推断成已死，
        // 否则一个正常运行中的标签页会被瞬间顶掉（fence+1，对方莫名失锁）。
        ownerAliveHint: record?.aliveMarker ? isTabAliveByMarker(record.tabId) : undefined,
      })
      return decision.acquired
        ? {
            write: true,
            value: { ...decision.next, aliveMarker: true },
            result: { acquired: true, fence: decision.next.fence },
          }
        : {
            result: {
              acquired: false,
              ownerTabId: decision.ownerTabId,
              reason: decision.reason,
            },
          }
    })
  } catch {
    return { acquired: false, reason: 'lock_unreadable' }
  }
  if (!result?.acquired) return result ?? { acquired: false, reason: 'write_failed' }

  currentProjectId = projectId
  currentFence = result.fence
  ownsCurrentLock = true
  markTabAlive()
  return result
}

/**
 * 强制接管：不管对方死活，fence 必增。
 * 用户明确选择承担"对方的改动不会保留"的后果时才调用。
 *
 * @param {string} projectId
 * @returns {Promise<{ok: boolean, fence?: number}>}
 */
export async function forceTakeover(projectId) {
  await startHeartbeat()
  let result
  try {
    result = await repo.updateMeta(lockKey(projectId), (record) => {
      const next = decideTakeover(record, { tabId, now: now(), projectId })
      return { write: true, value: { ...next, aliveMarker: true }, result: { ok: true, fence: next.fence } }
    })
  } catch {
    return { ok: false, reason: 'lock_unreadable' }
  }

  currentProjectId = projectId
  currentFence = result.fence
  ownsCurrentLock = true
  markTabAlive()
  return result
}

/**
 * 校验"我现在还能不能写这个项目"。
 * 预检项目编辑权。最终授权由保存事务再次原子校验。
 *
 * @param {string} [projectId] 省略时用当前项目
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function verifyLock(projectId = currentProjectId) {
  if (!projectId || !tabId) return { ok: false, reason: 'missing' }

  let read = await readLock(projectId)
  // 写入前的关键校验，抖动容忍度给两次：一次失败就拒绝写入会让偶发卡顿变成"保存失败"
  if (!read.ok) {
    read = await readLock(projectId)
    if (!read.ok) return { ok: false, reason: 'lock_unreadable' }
  }

  const verdict = decideVerify(read.record, {
    tabId,
    fence: currentFence,
    now: now(),
    staleMs: timing.staleMs,
  })
  return verdict.valid ? { ok: true } : { ok: false, reason: verdict.reason }
}

/** 释放当前项目的锁（只清空自己的 owner，并保留 fence） */
export async function releaseProject() {
  const projectId = currentProjectId
  const owner = { tabId, fence: currentFence }
  currentProjectId = null
  currentFence = 0
  ownsCurrentLock = false
  if (!projectId || !owner.tabId) return

  try {
    await repo.updateMeta(lockKey(projectId), (record) => {
      const verdict = decideVerify(record, owner)
      return verdict.valid
        ? { write: true, value: { ...record, tabId: null, heartbeatAt: 0 }, result: true }
        : { result: false }
    })
  } catch {
    /* 释放失败等超时自然失效 */
  }
}

/** 保存事务使用的锁凭据；真正授权仍在 repository 的写事务内校验。 */
export function getCurrentLockContext(projectId = currentProjectId) {
  if (!ownsCurrentLock || !tabId || !projectId || currentProjectId !== projectId) return null
  return { key: lockKey(projectId), tabId, fence: currentFence }
}

/**
 * 查某项目当前的锁状态（用于"以只读方式打开"的判断）。
 * @param {string} projectId
 * @returns {Promise<{locked: boolean, byTabId?: string, isSelf?: boolean}>}
 */
export async function checkOtherTabs(projectId) {
  const read = await readLock(projectId)
  // 只读判断宁可多挡一次：读不到就当有人在编辑，代价是用户多点一次「接管」
  if (!read.ok) return { locked: true, unreadable: true }

  const record = read.record
  if (!record || !record.tabId) return { locked: false }
  if (!isLockAlive(record, now(), timing.staleMs)) return { locked: false }
  if (record.tabId === tabId) return { locked: false, isSelf: true }
  return { locked: true, byTabId: record.tabId }
}

/** 订阅失锁事件，返回取消订阅函数 */
export function onLockLost(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// ───────────────────── 测试辅助 ─────────────────────

export function __setTimingForTest(next = {}) {
  timing = { ...timing, ...next }
}

/**
 * @param {{keepTabIdentity?: boolean}} [options]
 *   keepTabIdentity = true 时保留 sessionStorage 里的身份，用于模拟"同一标签页刷新"
 */
export async function __resetForTest({ keepTabIdentity = false } = {}) {
  if (heartbeatTimer) clearInterval(heartbeatTimer)
  heartbeatTimer = null
  presenceChannel?.close()
  presenceChannel = null
  presenceInstanceId = null
  presenceActive = false
  identityPromise = null
  tabId = null
  currentProjectId = null
  currentFence = 0
  ownsCurrentLock = false
  listeners.clear()
  timing = { heartbeatMs: HEARTBEAT_MS, staleMs: STALE_MS }
  if (!keepTabIdentity) {
    // 清掉持久化的身份，否则用例之间会互相继承同一个 tabId
    try {
      sessionStorage.removeItem(TAB_ID_KEY)
    } catch {
      /* node 环境没有 sessionStorage */
    }
  }
}

export function __getFence() {
  return currentFence
}
