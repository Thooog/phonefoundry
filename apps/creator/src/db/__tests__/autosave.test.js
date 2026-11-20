

import { describe, it, expect } from 'vitest'
import { createAutosaver, SAVE_STATUS } from '../autosave.js'

/**
 * 造一个可手动控制完成时机的 persist。
 * 每个调用返回一个由测试代码决定何时 resolve 的 promise。
 */
function createControllablePersist() {
  const calls = []
  const pending = []

  const persist = (project) => {
    const record = { project: structuredClone(project) }
    calls.push(record)
    return new Promise((resolve, reject) => {
      pending.push({ resolve, reject, record })
    })
  }

  return {
    persist,
    calls,
    get count() {
      return calls.length
    },
    /** 完成最早一个未完成的写入 */
    resolveNext() {
      const next = pending.shift()
      next?.resolve()
      return next
    },
    rejectNext(err) {
      const next = pending.shift()
      next?.reject(err)
      return next
    },
    get pendingCount() {
      return pending.length
    },
  }
}

/** 造一个可变更的内存项目 */
function createMemoryProject() {
  const state = { project: { id: 'prj_1', revision: 0, name: '初始', messages: [] } }
  return {
    state,
    read: () => state.project,
    set(patch) {
      state.project = { ...state.project, ...patch }
    },
  }
}

// ───────────────────── A-3 保存竞争 ─────────────────────

describe('A-3 保存竞争：最终落盘的一定是最新数据', () => {
  it('连续 10 次修改，flush 后磁盘是最后一次的内容', async () => {
    const mem = createMemoryProject()
    const p = createControllablePersist()
    const saver = createAutosaver({
      persist: p.persist,
      readProject: mem.read,
      debounceMs: 5,
    })
    saver.reset(mem.state.project)

    for (let i = 1; i <= 10; i += 1) {
      mem.set({ name: `第${i}次` })
      saver.markDirty()
    }

    // flush 会等所有排队写入完成；这里需要手工推进假 persist
    const flushPromise = saver.flush()
    // 持续完成写入直到 flush 收敛
    await drainUntilSettled(p, flushPromise)

    const last = p.calls[p.calls.length - 1]
    expect(last.project.name).toBe('第10次')
    expect(saver.getState().status).toBe(SAVE_STATUS.SAVED)
  })

  it('同时只有一个写入在飞（串行，不并发）', async () => {
    const mem = createMemoryProject()
    const p = createControllablePersist()
    const saver = createAutosaver({ persist: p.persist, readProject: mem.read, debounceMs: 1 })
    saver.reset(mem.state.project)

    for (let i = 0; i < 5; i += 1) {
      mem.set({ name: `n${i}` })
      saver.markDirty()
    }

    const flushPromise = saver.flush()
    await tick()

    // 关键：无论排了多少次，同一时刻 pending 里最多只有 1 个
    expect(p.pendingCount).toBeLessThanOrEqual(1)

    await drainUntilSettled(p, flushPromise)
  })
})

// ───────────────────── A-4 flush ─────────────────────

describe('A-4 flush 立即落盘，不等防抖', () => {
  it('防抖还没触发时调 flush，写入立即发生', async () => {
    const mem = createMemoryProject()
    const p = createControllablePersist()
    // 防抖设成 10 秒，确保不会自己触发
    const saver = createAutosaver({ persist: p.persist, readProject: mem.read, debounceMs: 10000 })
    saver.reset(mem.state.project)

    mem.set({ name: '新名字' })
    saver.markDirty()

    // 防抖期间不应有写入
    expect(p.count).toBe(0)

    const flushPromise = saver.flush()
    await tick()
    // flush 应立刻排了一次写入
    expect(p.count).toBe(1)

    await drainUntilSettled(p, flushPromise)
    expect(p.calls[0].project.name).toBe('新名字')
  })

  it('没有脏数据时 flush 直接返回，不产生多余写入', async () => {
    const mem = createMemoryProject()
    const p = createControllablePersist()
    const saver = createAutosaver({ persist: p.persist, readProject: mem.read, debounceMs: 1 })
    saver.reset(mem.state.project)

    await saver.flush()
    expect(p.count).toBe(0)
  })
})

// ───────────────────── A-5 保存失败 ─────────────────────

describe('A-5 保存失败：内存态保留 + 明确报错 + 可重试', () => {
  it('写入失败后 status 变 error，内存数据不变', async () => {
    const mem = createMemoryProject()
    const p = createControllablePersist()
    const saver = createAutosaver({ persist: p.persist, readProject: mem.read, debounceMs: 1 })
    saver.reset(mem.state.project)

    mem.set({ name: '重要内容' })
    saver.markDirty()

    const flushPromise = saver.flush()
    await tick()
    p.rejectNext(new Error('磁盘满了'))

    await expect(flushPromise).rejects.toThrow()

    const state = saver.getState()
    expect(state.status).toBe(SAVE_STATUS.ERROR)
    expect(state.error).toBeTruthy()
    // 内存态必须完好
    expect(mem.read().name).toBe('重要内容')
  })

  it('失败后 retry 能成功，状态回到 saved', async () => {
    const mem = createMemoryProject()
    const p = createControllablePersist()
    const saver = createAutosaver({ persist: p.persist, readProject: mem.read, debounceMs: 1 })
    saver.reset(mem.state.project)

    mem.set({ name: '重试内容' })
    saver.markDirty()

    const flushPromise = saver.flush()
    await tick()
    p.rejectNext(new Error('临时故障'))
    await flushPromise.catch(() => {})

    expect(saver.getState().status).toBe(SAVE_STATUS.ERROR)

    const retryPromise = saver.retry()
    await tick()
    p.resolveNext()
    const ok = await retryPromise

    expect(ok).toBe(true)
    expect(saver.getState().status).toBe(SAVE_STATUS.SAVED)
  })

  it('配额错误给出可读文案，而不是裸 DOMException', async () => {
    const mem = createMemoryProject()
    const p = createControllablePersist()
    const saver = createAutosaver({ persist: p.persist, readProject: mem.read, debounceMs: 1 })
    saver.reset(mem.state.project)

    mem.set({ name: 'x' })
    saver.markDirty()

    const flushPromise = saver.flush()
    await tick()
    const quotaErr = new Error('quota')
    quotaErr.name = 'QuotaExceededError'
    p.rejectNext(quotaErr)

    await expect(flushPromise).rejects.toThrow(/存储空间不足/)
  })
})

describe('A-5b 快照失败必须报错，不能静默停在 saving', () => {
  it('项目树里有不可克隆的内容（响应式代理）→ error，而不是永久 saving', async () => {
    const state = { project: { id: 'prj_1', revision: 0, name: '初始' } }
    const calls = []
    const saver = createAutosaver({
      persist: async (data) => { calls.push(data) },
      readProject: () => state.project,
      debounceMs: 1,
    })
    saver.reset(state.project)

    // Vue 的 reactive 数组就是 Proxy：structuredClone 会抛 DataCloneError
    state.project = {
      ...state.project,
      revision: 1,
      name: '改过',
      workSettings: { homeLayout: { items: [{ content: { schedules: new Proxy([], {}) } }] } },
    }
    saver.markDirty()

    await expect(saver.flush()).rejects.toThrow(/无法存储/)

    const st = saver.getState()
    expect(st.status).toBe(SAVE_STATUS.ERROR)
    expect(st.error).toBeTruthy()
    // 一个字节都不该写下去
    expect(calls.length).toBe(0)
    // 内存态不回滚：用户的改动还在，可以另存
    expect(state.project.name).toBe('改过')
  })

  it('没有内存态可写时也不会停在 saving', async () => {
    const saver = createAutosaver({
      persist: async () => {},
      readProject: () => null,
      debounceMs: 1,
    })
    saver.reset({ id: 'prj_1', revision: 0 })

    saver.markDirty()
    await saver.flush()

    expect(saver.getState().status).toBe(SAVE_STATUS.SAVED)
    expect(saver.getState().dirty).toBe(false)
  })
})

// ───────────────────── A-11 保存期间再次修改 ─────────────────────

describe('A-11 保存期间再次修改，不能误标 saved', () => {
  it('保存中改数据 → 状态保持 saving，并再次落盘', async () => {
    const mem = createMemoryProject()
    const p = createControllablePersist()
    const saver = createAutosaver({ persist: p.persist, readProject: mem.read, debounceMs: 1 })
    saver.reset(mem.state.project)

    mem.set({ name: 'A' })
    saver.markDirty()

    const flushPromise = saver.flush()
    await tick()
    expect(p.count).toBe(1)

    // ★ 关键窗口：第一次写入还没完成时，又改了一次
    mem.set({ name: 'B' })
    saver.markDirty()

    // 完成第一次写入
    p.resolveNext()
    await tick()

    // 此时不能是 saved —— 因为内存已经是 B，磁盘还是 A
    expect(saver.getState().status).not.toBe(SAVE_STATUS.SAVED)
    expect(saver.getState().hasPendingWrites).toBe(true)

    await drainUntilSettled(p, flushPromise)

    // 最终磁盘必须是 B
    const last = p.calls[p.calls.length - 1]
    expect(last.project.name).toBe('B')
    expect(saver.getState().status).toBe(SAVE_STATUS.SAVED)
  })

  it('revision 由修改方递增，保存器原样落盘、不覆写', async () => {
    const mem = createMemoryProject()
    const p = createControllablePersist()
    const saver = createAutosaver({ persist: p.persist, readProject: mem.read, debounceMs: 1 })
    saver.reset(mem.state.project)

    // 模拟真实调用方（store）：改内容的同时把 revision 推进
    saver.markDirty()
    mem.set({ revision: 1 })
    saver.markDirty()
    mem.set({ revision: 2 })
    saver.markDirty()
    mem.set({ revision: 3 })

    const flushPromise = saver.flush()
    await drainUntilSettled(p, flushPromise)

    const last = p.calls[p.calls.length - 1]
    // ★ 落盘的 revision 必须是内存里的那个值，不是保存器自己的计数器
    expect(last.project.revision).toBe(3)
    expect(saver.getState().savedRevision).toBe(3)
  })

  it('保存器不会把 revision 凭空改大（内存态没变就不动）', async () => {
    const mem = createMemoryProject()
    const p = createControllablePersist()
    const saver = createAutosaver({ persist: p.persist, readProject: mem.read, debounceMs: 1 })
    saver.reset(mem.state.project)

    // 内存里 revision 一直是 7，但 markDirty 了 5 次
    mem.set({ revision: 7 })
    for (let i = 0; i < 5; i += 1) saver.markDirty()

    const flushPromise = saver.flush()
    await drainUntilSettled(p, flushPromise)

    expect(p.calls[0].project.revision).toBe(7)
  })

  it('savedRevision 不会写进落盘数据', async () => {
    const mem = createMemoryProject()
    const p = createControllablePersist()
    const saver = createAutosaver({ persist: p.persist, readProject: mem.read, debounceMs: 1 })
    saver.reset(mem.state.project)

    mem.set({ revision: 1 })
    saver.markDirty()
    const flushPromise = saver.flush()
    await drainUntilSettled(p, flushPromise)

    const written = p.calls[0].project
    expect(written).not.toHaveProperty('savedRevision')
    expect(written).not.toHaveProperty('inMemoryRevision')
    expect(written).not.toHaveProperty('dirty')
  })
})

// ───────────────────── 状态回调 ─────────────────────

describe('状态变化可观测', () => {
  it('onStatusChange 收到 saving → saved 序列', async () => {
    const mem = createMemoryProject()
    const p = createControllablePersist()
    const seen = []
    const saver = createAutosaver({
      persist: p.persist,
      readProject: mem.read,
      debounceMs: 1,
      onStatusChange: (s) => seen.push(s.status),
    })
    saver.reset(mem.state.project)
    seen.length = 0

    mem.set({ name: 'x' })
    saver.markDirty()
    const flushPromise = saver.flush()
    await drainUntilSettled(p, flushPromise)

    expect(seen).toContain(SAVE_STATUS.SAVING)
    expect(seen[seen.length - 1]).toBe(SAVE_STATUS.SAVED)
  })
})

// ───────────────────── 工具 ─────────────────────

/** 让微任务队列跑一轮 */
function tick(ms = 0) {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * 反复完成假 persist 的写入，直到 flushPromise 落地。
 * 这是测试专用驱动器 —— 模拟"真实 persist 总会完成"。
 */
async function drainUntilSettled(controller, flushPromise) {
  let settled = false
  const done = flushPromise.then(
    () => {
      settled = true
    },
    () => {
      settled = true
    },
  )

  for (let i = 0; i < 200 && !settled; i += 1) {
    await tick(1)
    while (controller.pendingCount > 0) {
      controller.resolveNext()
      await tick(0)
      if (settled) break
    }
  }
  await done
}
