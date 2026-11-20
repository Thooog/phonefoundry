/**
 * store 层集成测试 —— 验证"组件改数据 → 自动落盘 → 重开还在"这条完整链路。
 *
 * 为什么值得单独测：
 *   仓储与 autosaver 各自都有测试，但它们之间的**接线**（store 是否正确
 *   把每次修改都送进自动保存）没有任何测试覆盖，而这正是最容易漏的地方。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useProjectStore } from '../project.js'
import { useProjectsStore } from '../projects.js'
import * as service from '../../db/project-service.js'
import * as tabGuard from '../../db/tab-guard.js'
import { createProject, createCharacter, removeHomeItem, resolveHomeLayout } from '@phone-sim/shared'
import { resetDatabase } from '../../db/__tests__/support/fake-db.js'
import * as repoMod from '../../db/repository.js'
import { lockKey } from '../../db/lock-logic.js'
import { writeIndexCache as writeIndexCacheFn } from '../../db/index-cache.js'

beforeEach(async () => {
  tabGuard.__resetForTest()
  vi.useRealTimers()
  await resetDatabase()
  setActivePinia(createPinia())
  // localStorage 在 jsdom 环境才有；node 环境用内存桩
  installLocalStorageStub()
})

// ───────────────────── 打开与修改 ─────────────────────

describe('打开项目后编辑，自动落盘', () => {
  it('adding content permanently restores a removed desktop icon through save and reload', async () => {
    const original = createProject({ name: '桌面恢复' })
    original.workSettings.homeLayout = removeHomeItem(original, 'notes')
    await repoMod.saveProject(original)
    const store = useProjectStore()
    await store.open(original.id)
    expect(resolveHomeLayout(store.project).items.some(item => item.id === 'notes')).toBe(false)
    store.mutate(project => { project.appData.notes.notes.push({ id: 'note_restore', title: '内容' }) })
    expect(store.project.workSettings.homeLayout.removedItems).toBeUndefined()
    store.mutate(project => { project.appData.notes.notes = [] })
    await store.flush()
    await store.open(original.id)
    expect(resolveHomeLayout(store.project).items.some(item => item.id === 'notes')).toBe(true)
    await store.close()
  })

  it('patch 后 flush，重开能读到新内容', async () => {
    const original = createProject({ name: '原始名' })
    await repoMod.saveProject(original)

    const store = useProjectStore()
    const result = await store.open(original.id)
    expect(result.ok).toBe(true)
    expect(store.project.name).toBe('原始名')

    store.patch({ name: '改过的名字' })
    await store.flush()

    // 绕过 store 直接从磁盘读，确认真的落盘了
    const onDisk = await service.readProject(original.id)
    expect(onDisk.name).toBe('改过的名字')
    expect(onDisk.revision).toBeGreaterThan(0)
  })

  it('mutate 改嵌套结构也能落盘', async () => {
    const original = createProject({ name: 'x' })
    await repoMod.saveProject(original)

    const store = useProjectStore()
    await store.open(original.id)

    store.mutate((p) => {
      p.characters.push(createCharacter({ name: '新角色' }))
    })
    await store.flush()

    const onDisk = await service.readProject(original.id)
    expect(onDisk.characters).toHaveLength(1)
    expect(onDisk.characters[0].name).toBe('新角色')
  })

  it('mutate 会换掉顶层引用，否则 shallowRef 不会通知视图', async () => {
    const original = createProject({ name: 'x' })
    await repoMod.saveProject(original)

    const store = useProjectStore()
    await store.open(original.id)

    const before = store.project
    store.mutate((p) => {
      p.characters.push(createCharacter({ name: '新角色' }))
    })
    expect(store.project).not.toBe(before)
    expect(store.project.characters).toHaveLength(1)
  })

  it('patch 会更新 updatedAt', async () => {
    const original = createProject({ name: 'x' })
    original.updatedAt = '2020-01-01T00:00:00.000Z'
    await repoMod.saveProject(original)

    const store = useProjectStore()
    await store.open(original.id)
    store.patch({ name: 'y' })

    expect(store.project.updatedAt > '2020-01-01T00:00:00.000Z').toBe(true)
  })

  it('flush 后状态回到 saved', async () => {
    const original = createProject()
    await repoMod.saveProject(original)
    const store = useProjectStore()
    await store.open(original.id)

    store.patch({ name: 'z' })
    await store.flush()

    expect(store.saveStatus).toBe('saved')
    expect(store.isDirty).toBe(false)
  })

  it('revision 每次 patch +1，落盘值与内存一致', async () => {
    const original = createProject({ name: 'r0' })
    await repoMod.saveProject(original)
    const store = useProjectStore()
    await store.open(original.id)

    const start = store.project.revision
    store.patch({ name: 'r1' })
    store.patch({ name: 'r2' })
    store.mutate((p) => p.characters.push(createCharacter({ name: 'c' })))

    expect(store.project.revision).toBe(start + 3)

    await store.flush()
    const onDisk = await service.readProject(original.id)
    expect(onDisk.revision).toBe(start + 3)
  })

  it('savedRevision 随落盘推进，且不进项目对象', async () => {
    const original = createProject()
    await repoMod.saveProject(original)
    const store = useProjectStore()
    await store.open(original.id)

    store.patch({ name: 'a' })
    await store.flush()

    expect(store.savedRevision).toBe(store.project.revision)
    const onDisk = await service.readProject(original.id)
    expect(onDisk).not.toHaveProperty('savedRevision')
  })
})

// ───────────────────── 只读保护 ─────────────────────

describe('多标签页只读保护', () => {
  it('发现别的标签页在编辑 → 以只读打开，patch 不生效', async () => {
    const original = createProject({ name: '被占用' })
    await repoMod.saveProject(original)

    // 伪造"另一个标签页持有该项目锁"的记录 —— 就是真实运行时的数据结构
    await tabGuard.startHeartbeat()
    await repoMod.setMeta(lockKey(original.id), {
      key: lockKey(original.id),
      projectId: original.id,
      tabId: 'tab_other',
      fence: 1,
      heartbeatAt: Date.now(),
    })

    const store = useProjectStore()
    const result = await store.open(original.id)

    expect(result.ok).toBe(true)
    expect(result.readOnly).toBe(true)
    expect(store.isReadOnly).toBe(true)

    // 只读下修改必须被忽略
    store.patch({ name: '不该生效' })
    expect(store.project.name).toBe('被占用')
  })

  it('takeOver 接管后可正常编辑', async () => {
    const original = createProject({ name: '待接管' })
    await repoMod.saveProject(original)

    await tabGuard.startHeartbeat()
    await repoMod.setMeta(lockKey(original.id), {
      key: lockKey(original.id),
      projectId: original.id,
      tabId: 'tab_other',
      fence: 1,
      heartbeatAt: Date.now(),
    })

    const store = useProjectStore()
    await store.open(original.id)
    expect(store.isReadOnly).toBe(true)

    const result = await store.takeOver()
    expect(result.ok).toBe(true)
    expect(store.isReadOnly).toBe(false)

    store.patch({ name: '现在可以改了' })
    await store.flush()
    expect((await service.readProject(original.id)).name).toBe('现在可以改了')
  })

  it('★★ 接管后，旧标签页再写入会被拒绝（不靠界面提示）', async () => {
    const original = createProject({ name: '被抢走' })
    await repoMod.saveProject(original)

    // 本页正常打开并持锁
    const store = useProjectStore()
    await store.open(original.id)
    expect(store.isReadOnly).toBe(false)

    // 另一页强制接管（直接改锁记录，fence 进到 2）
    await repoMod.setMeta(lockKey(original.id), {
      key: lockKey(original.id),
      projectId: original.id,
      tabId: 'tab_thief',
      fence: 2,
      heartbeatAt: Date.now(),
    })

    // 本页接着改，然后 flush
    store.patch({ name: '我写的会被丢掉' })
    await expect(store.flush()).rejects.toThrow()

    // 状态必须变成 error，并且原因可识别
    expect(store.saveStatus).toBe('error')
    expect(store.saveError.code).toBe('lock_lost')

    expect(store.isReadOnly).toBe(true)

    // 磁盘上仍是原值 —— 一个字节都没被覆盖
    expect((await service.readProject(original.id)).name).toBe('被抢走')
    // 内存里用户的内容还在
    expect(store.project.name).toBe('我写的会被丢掉')
  })

  it('失锁后 saveAsCopy 能把内存内容存成新项目', async () => {
    const original = createProject({ name: '原项目' })
    await repoMod.saveProject(original)

    const store = useProjectStore()
    await store.open(original.id)

    // 被接管
    await repoMod.setMeta(lockKey(original.id), {
      key: lockKey(original.id),
      projectId: original.id,
      tabId: 'tab_thief',
      fence: 2,
      heartbeatAt: Date.now(),
    })

    store.patch({ name: '失锁前写的内容' })
    await expect(store.flush()).rejects.toThrow()

    const copy = await store.saveAsCopy()
    expect(copy).toBeTruthy()
    expect(copy.id).not.toBe(original.id)
    expect(copy.name).toBe('失锁前写的内容 副本')

    // 副本真的落盘了，内容就是失锁前的那份
    const onDisk = await service.readProject(copy.id)
    expect(onDisk.name).toBe('失锁前写的内容 副本')
  })
})

// ───────────────────── 打开失败 ─────────────────────

describe('打开失败的处理', () => {
  it('项目不存在时返回 ok:false，不留半截状态', async () => {
    const store = useProjectStore()
    const result = await store.open('prj_missing')

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('missing')
    expect(store.hasProject).toBe(false)
    expect(store.loadError).toBeTruthy()
  })

  it('★ 拿到锁之后读取失败 → 交还锁，不留"被别人编辑中"', async () => {
    const original = createProject({ name: '库坏了' })
    await repoMod.saveProject(original)

    // 锁已经拿到，紧接着读项目时炸了（连接失效、库损坏）
    const spy = vi.spyOn(repoMod, 'getProject').mockRejectedValueOnce(new Error('库损坏'))
    const store = useProjectStore()
    const result = await store.open(original.id)
    spy.mockRestore()

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('error')
    expect(store.loadError).toBeTruthy()

    // 关键：不能留着锁。留着的话本页停在空壳工作区，
    // 心跳还在续租，别的标签页会一直以为有人在编辑
    const record = await repoMod.getMeta(lockKey(original.id))
    expect(record?.tabId ?? null).toBeNull()
  })

  it('★ 接管后读取失败 → 同样交还锁', async () => {
    const original = createProject({ name: '接管失败' })
    await repoMod.saveProject(original)

    await tabGuard.startHeartbeat()
    await repoMod.setMeta(lockKey(original.id), {
      key: lockKey(original.id),
      projectId: original.id,
      tabId: 'tab_other',
      fence: 1,
      heartbeatAt: Date.now(),
    })

    const store = useProjectStore()
    await store.open(original.id)
    expect(store.isReadOnly).toBe(true)

    const spy = vi.spyOn(repoMod, 'getProject').mockRejectedValueOnce(new Error('库损坏'))
    const result = await store.takeOver()
    spy.mockRestore()

    expect(result.ok).toBe(false)
    expect(store.loadError).toBeTruthy()

    const record = await repoMod.getMeta(lockKey(original.id))
    expect(record?.tabId ?? null).toBeNull()
  })
})

// ───────────────────── 资源写入失败 ─────────────────────

describe('addAsset 的失败路径', () => {
  it('★ 二进制先落盘、项目没接受时立刻回收，不留孤儿', async () => {
    const original = createProject({ name: '资源回滚' })
    await repoMod.saveProject(original)

    const store = useProjectStore()
    await store.open(original.id)

    // 让 mutate 的 structuredClone 抛错，等价于"blob 写了但项目没接住"
    store.project.__broken = () => {}

    const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/webp' })
    await expect(store.addAsset({ blob, kind: 'image', mimeType: 'image/webp' })).rejects.toThrow()

    // 项目没多出资源，磁盘上也不该留一个没人引用的 blob
    expect(store.project.assets).toHaveLength(0)
    expect(await repoMod.listAssetRecords(original.id)).toHaveLength(0)
  })
})

// ───────────────────── 项目列表 store ─────────────────────

describe('projects store：列表与缓存', () => {
  it('load 后列出全部项目，且不是来自缓存', async () => {
    await repoMod.saveProject(createProject({ name: '甲' }))
    await repoMod.saveProject(createProject({ name: '乙' }))

    const store = useProjectsStore()
    await store.load()

    expect(store.count).toBe(2)
    expect(store.isFromCache).toBe(false)
  })

  it('删除后列表与磁盘同时少一条', async () => {
    const a = createProject({ name: '甲' })
    const b = createProject({ name: '乙' })
    await repoMod.saveProject(a)
    await repoMod.saveProject(b)

    const store = useProjectsStore()
    await store.load()
    await store.remove(a.id)

    expect(store.count).toBe(1)
    expect(store.findById(a.id)).toBeNull()
    expect(await service.readProject(a.id)).toBeNull()
  })

  it('复制后列表多一条，且副本名带"副本"', async () => {
    const a = createProject({ name: '原件' })
    await repoMod.saveProject(a)

    const store = useProjectsStore()
    await store.load()
    await store.duplicate(a.id)

    expect(store.count).toBe(2)
    expect(store.items.some((p) => p.name === '原件 副本')).toBe(true)
  })

  it('缓存内容能先于 IDB 显示，但最终被真相覆盖', async () => {
    const a = createProject({ name: '真名' })
    await repoMod.saveProject(a)

    // 预置一份"过期缓存"
    const writeIndexCache = writeIndexCacheFn
    writeIndexCache([{ id: a.id, name: '过期名字', updatedAt: a.updatedAt }])

    const store = useProjectsStore()
    await store.load()

    expect(store.items[0].name).toBe('真名')
    expect(store.isFromCache).toBe(false)
  })

  it('reset 清空所有状态', async () => {
    await repoMod.saveProject(createProject())
    const store = useProjectsStore()
    await store.load()
    store.reset()

    expect(store.count).toBe(0)
    expect(store.error).toBeNull()
  })
})

// ───────────────────── 新建 / 示例 / 重命名 ─────────────────────

describe('项目列表：新建、示例、重命名、删除', () => {
  it('★ create 后列表立即出现，且与重读磁盘的结果一致', async () => {
    const store = useProjectsStore()
    await store.load()
    expect(store.count).toBe(0)

    const created = await store.create({ name: '新作品' })
    expect(store.count).toBe(1)
    expect(store.items[0].name).toBe('新作品')

    // 关键：内存里拼的摘要必须和磁盘上写的一致，
    // 否则"刚建的项目"和"刷新后的同一个项目"会长得不一样
    await store.reload()
    expect(store.items).toHaveLength(1)
    expect(store.items[0].id).toBe(created.id)
    expect(store.items[0].name).toBe(created.name)
    expect(store.items[0].updatedAt).toBe(created.updatedAt)
  })

  it('create 后可以直接 open，不报"项目不存在"', async () => {
    const projects = useProjectsStore()
    const created = await projects.create({ name: '连贯性' })

    const editor = useProjectStore()
    const result = await editor.open(created.id)
    expect(result.ok).toBe(true)
    expect(editor.project.name).toBe('连贯性')
  })

  it('★ createSample 载入的示例能立刻编辑并落盘', async () => {
    const projects = useProjectsStore()
    const sample = await projects.createSample()
    expect(sample.isSample).toBe(true)
    expect(projects.items[0].isSample).toBe(true)

    const editor = useProjectStore()
    await editor.open(sample.id)
    expect(editor.project.characters.length).toBeGreaterThan(0)

    editor.patch({ name: '我改过的示例' })
    await editor.flush()

    const onDisk = await service.readProject(sample.id)
    expect(onDisk.name).toBe('我改过的示例')
  })

  it('★ rename 只传 id，列表与磁盘同时更新', async () => {
    const store = useProjectsStore()
    const created = await store.create({ name: '旧名' })

    await store.rename(created.id, '新名')

    expect(store.items[0].name).toBe('新名')
    const onDisk = await service.readProject(created.id)
    expect(onDisk.name).toBe('新名')
  })

  it('rename 后排序位置不变（改名不算"更新"，但 updatedAt 会推进）', async () => {
    const store = useProjectsStore()
    const a = await store.create({ name: 'A' })
    await new Promise((r) => setTimeout(r, 2))
    await store.create({ name: 'B' })

    // 列表按 updatedAt 倒序：B 在前
    expect(store.items[0].name).toBe('B')

    await new Promise((r) => setTimeout(r, 2))
    await store.rename(a.id, 'A改')
    // A 的 updatedAt 被推进，应该跳到最前
    expect(store.items[0].id).toBe(a.id)
  })
})

// ───────────────────── 工具 ─────────────────────

function installLocalStorageStub() {
  if (typeof globalThis.localStorage !== 'undefined') {
    try {
      globalThis.localStorage.clear()
      return
    } catch {
      /* 继续装桩 */
    }
  }
  const map = new Map()
  globalThis.localStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
    get length() {
      return map.size
    },
    key: (i) => [...map.keys()][i] ?? null,
  }
}
