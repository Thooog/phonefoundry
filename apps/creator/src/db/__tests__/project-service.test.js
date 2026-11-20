

import { describe, it, expect, beforeEach } from 'vitest'
import * as service from '../project-service.js'
import * as repo from '../repository.js'
import {
  createProject,
  createCharacter,
  createAsset,
  createMessage,
  createComment,
  toWorkData,
  assertPlain,
  ID_PREFIX,
} from '@phone-sim/shared'
import { resetDatabase, makeBlob } from './support/fake-db.js'

beforeEach(async () => {
  await resetDatabase()
})

// ───────────────────── 造数据 ─────────────────────

/**
 * 造一个"带资源的项目"：
 * 一个角色（头像 avatarA）、一段聊天（带图 msgAsset）、一张壁纸 wallpaperA。
 * 同时把三张图写进 assets 表。
 */
async function seedProjectWithAssets(name = '原始项目') {
  const project = createProject({ name })
  const character = createCharacter({ name: '小林' })
  const avatarA = createAsset(project.id, { fileName: 'avatar-a.webp', byteSize: 128 })
  const msgAsset = createAsset(project.id, { fileName: 'photo.webp', byteSize: 256 })
  const wallpaperA = createAsset(project.id, { fileName: 'wall.webp', byteSize: 64 })

  character.avatarAssetId = avatarA.id
  project.characters = [character]
  project.assets = [avatarA, msgAsset, wallpaperA]
  project.workSettings.wallpaper = { ...project.workSettings.wallpaper, assetId: wallpaperA.id }
  project.appData.messages.messages = [
    createMessage('conv_1', { contentType: 'image', mediaAssetIds: [msgAsset.id] }),
  ]

  await repo.saveProject(project)
  await repo.putAssetBlobs([
    { assetId: avatarA.id, projectId: project.id, blob: makeBlob(128), mimeType: 'image/webp' },
    { assetId: msgAsset.id, projectId: project.id, blob: makeBlob(256), mimeType: 'image/webp' },
    { assetId: wallpaperA.id, projectId: project.id, blob: makeBlob(64), mimeType: 'image/webp' },
  ])

  return { project, character, avatarA, msgAsset, wallpaperA }
}

// ───────────────────── A-6 复制项目 ─────────────────────

describe('A-6 复制项目：资源深拷贝，互不影响', () => {
  it('副本换新 projectId / 新 assetId，名称加"副本"', async () => {
    const { project, avatarA, msgAsset, wallpaperA } = await seedProjectWithAssets()

    const copy = await service.duplicateProject(project.id)

    expect(copy.id).not.toBe(project.id)
    expect(copy.name).toBe('原始项目 副本')
    expect(copy.assets).toHaveLength(3)

    const oldIds = new Set([avatarA.id, msgAsset.id, wallpaperA.id])
    for (const asset of copy.assets) {
      expect(oldIds.has(asset.id)).toBe(false)
      expect(asset.id.startsWith(ID_PREFIX.ASSET)).toBe(true)
      // 归属必须指向副本，否则删除副本时清不掉
      expect(asset.projectId).toBe(copy.id)
    }
  })

  it('副本不会凭空补出 undefined 字段（否则副本永远导不出去）', async () => {
    const { project } = await seedProjectWithAssets()
    // 回复本来不带 mediaAssetIds —— 换 id 时不能给它补一个 undefined
    project.appData.x.replies = [createComment('post_1', { content: '回复' })]
    await repo.saveProject(project)

    const copy = await service.duplicateProject(project.id)

    expect('mediaAssetIds' in copy.appData.x.replies[0]).toBe(false)
    expect(() => assertPlain(toWorkData(copy))).not.toThrow()
  })

  it('打开旧项目时清掉历史遗留的 undefined 键', async () => {
    const { project } = await seedProjectWithAssets()
    // 老版本复制过的项目里，这条回复带着 `mediaAssetIds: undefined`
    project.appData.x.replies = [{ ...createComment('post_1'), mediaAssetIds: undefined }]
    await repo.saveProject(project)

    const loaded = await service.readProject(project.id)

    expect('mediaAssetIds' in loaded.appData.x.replies[0]).toBe(false)
    expect(() => assertPlain(toWorkData(loaded))).not.toThrow()
  })

  it('副本内所有引用都重写为新 assetId，不残留旧 id', async () => {
    const { project, avatarA, msgAsset, wallpaperA } = await seedProjectWithAssets()
    const copy = await service.duplicateProject(project.id)

    const newIds = new Set(copy.assets.map((a) => a.id))

    // 角色头像
    expect(newIds.has(copy.characters[0].avatarAssetId)).toBe(true)
    expect(copy.characters[0].avatarAssetId).not.toBe(avatarA.id)
    // 消息里的图
    expect(newIds.has(copy.appData.messages.messages[0].mediaAssetIds[0])).toBe(true)
    expect(copy.appData.messages.messages[0].mediaAssetIds[0]).not.toBe(msgAsset.id)
    // 壁纸
    expect(newIds.has(copy.workSettings.wallpaper.assetId)).toBe(true)
    expect(copy.workSettings.wallpaper.assetId).not.toBe(wallpaperA.id)
  })

  it('资源二进制也被复制，大小与原图一致', async () => {
    const { project } = await seedProjectWithAssets()
    const copy = await service.duplicateProject(project.id)

    const records = await repo.listAssetRecords(copy.id)
    expect(records).toHaveLength(3)
    for (const record of records) {
      expect(record.projectId).toBe(copy.id)
      expect(record.blob).toBeInstanceOf(Blob)
    }
    const total = records.reduce((s, r) => s + r.blob.size, 0)
    expect(total).toBe(128 + 256 + 64)
  })

  it('副本 revision 归零，isSample 清除，创建时间更新', async () => {
    const { project } = await seedProjectWithAssets()
    project.isSample = true
    project.revision = 42
    await repo.saveProject(project)

    const copy = await service.duplicateProject(project.id)
    expect(copy.revision).toBe(0)
    expect(copy.isSample).toBe(false)
    expect(copy.createdAt >= project.createdAt).toBe(true)
  })

  it('删除副本不影响原项目的资源', async () => {
    const { project } = await seedProjectWithAssets()
    const copy = await service.duplicateProject(project.id)

    await service.deleteProject(copy.id)

    expect(await repo.getProject(copy.id)).toBeUndefined()
    expect(await repo.listAssetRecords(copy.id)).toHaveLength(0)

    // 原项目毫发无伤
    const original = await repo.getProject(project.id)
    expect(original).toBeTruthy()
    expect(await repo.listAssetRecords(project.id)).toHaveLength(3)
  })

  it('删除原项目不影响副本的资源', async () => {
    const { project } = await seedProjectWithAssets()
    const copy = await service.duplicateProject(project.id)

    await service.deleteProject(project.id)

    expect(await repo.listAssetRecords(copy.id)).toHaveLength(3)
  })

  it('复制不存在的项目时抛出可读错误，不留下半成品', async () => {
    await expect(service.duplicateProject('prj_not_exist')).rejects.toThrow(/不存在/)
    expect(await service.listProjects()).toHaveLength(0)
  })
})

// ───────────────────── A-10 删除级联 ─────────────────────

describe('A-10 删除项目：项目 / 摘要 / 资源一起清', () => {
  it('三张表同时清空，并返回被删资源数', async () => {
    const { project } = await seedProjectWithAssets()

    const { removedAssets } = await service.deleteProject(project.id)

    expect(removedAssets).toBe(3)
    expect(await repo.getProject(project.id)).toBeUndefined()
    expect(await service.listProjects()).toHaveLength(0)
    expect(await repo.listAssetRecords(project.id)).toHaveLength(0)
  })

  it('删除不存在的项目不报错（幂等）', async () => {
    const { removedAssets } = await service.deleteProject('prj_ghost')
    expect(removedAssets).toBe(0)
  })

  it('删除当前最近打开的项目时，清掉 recentProjectId', async () => {
    const { project } = await seedProjectWithAssets()
    await service.setRecentProjectId(project.id)

    await service.deleteProject(project.id)

    expect(await service.getRecentProjectId()).toBeNull()
  })
})

// ───────────────────── A-9 索引 / 摘要一致性 ─────────────────────

describe('A-9 摘要表异常时的自愈能力', () => {
  it('摘要缺失时可被 ensureSummaryIntegrity 补回', async () => {
    const { project } = await seedProjectWithAssets('会被补回')

    // 模拟"早期版本只写了项目表，没写摘要表"
    await repo.removeProject(project.id)
    await repo.saveProjectOnly(project)

    // 先确认现在确实是断档状态
    expect(await service.listProjects()).toHaveLength(0)

    const result = await service.ensureSummaryIntegrity()
    expect(result).toEqual({ repaired: 1, projectCount: 1 })

    const list = await service.listProjects()
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('会被补回')
  })

  it('摘要完整时不重复修补', async () => {
    await seedProjectWithAssets('正常项目')
    const result = await service.ensureSummaryIntegrity()
    expect(result.repaired).toBe(0)
    expect(result.projectCount).toBe(1)
  })

  it('rebuildSummaries 能从项目表重建列表', async () => {
    await seedProjectWithAssets('甲')
    await seedProjectWithAssets('乙')
    const result = await service.rebuildSummaries()
    expect(result.rebuilt).toBe(2)
    expect(await service.listProjects()).toHaveLength(2)
  })

  it('列表按 updatedAt 倒序，且只读摘要表', async () => {
    const old = createProject({ name: '旧项目' })
    old.updatedAt = '2026-01-01T00:00:00.000Z'
    const fresh = createProject({ name: '新项目' })
    fresh.updatedAt = '2026-06-01T00:00:00.000Z'
    await repo.saveProject(old)
    await repo.saveProject(fresh)

    const list = await service.listProjects()
    expect(list.map((p) => p.name)).toEqual(['新项目', '旧项目'])
    // 摘要必须是轻量的，不能把整个项目塞进来
    expect(list[0].appData).toBeUndefined()
    expect(list[0].characters).toBeUndefined()
  })

  it('saveProject 后摘要立即反映新名字（同事务）', async () => {
    const { project } = await seedProjectWithAssets('旧名字')
    const renamed = await service.renameProject(project.id, '新名字')

    const list = await service.listProjects()
    expect(list[0].name).toBe('新名字')
    expect(list[0].revision).toBe(renamed.revision)
  })
})

// ───────────────────── 最近打开 ─────────────────────

describe('最近打开项目：脏数据自我保护', () => {
  it('resolveRecentProjectId 在项目被删后返回 null', async () => {
    const { project } = await seedProjectWithAssets()
    await service.setRecentProjectId(project.id)
    expect(await service.resolveRecentProjectId()).toBe(project.id)

    await service.deleteProject(project.id)
    expect(await service.resolveRecentProjectId()).toBeNull()
  })

  it('没有任何记录时返回 null', async () => {
    expect(await service.resolveRecentProjectId()).toBeNull()
  })
})

// ───────────────────── 重命名 ─────────────────────

describe('重命名', () => {
  it('空名字回落到"未命名作品"', async () => {
    const { project } = await seedProjectWithAssets()
    const updated = await service.renameProject(project.id, '   ')
    expect(updated.name).toBe('未命名作品')
  })

  it('重命名会递增 revision 并刷新 updatedAt', async () => {
    const { project } = await seedProjectWithAssets()
    const before = project.revision ?? 0
    const updated = await service.renameProject(project.id, '改名')
    expect(updated.revision).toBe(before + 1)
    expect(updated.updatedAt >= project.updatedAt).toBe(true)
  })

  it('★ 只传 id 就能改（UI 层手里只有 id，拿不到完整项目对象）', async () => {
    const { project } = await seedProjectWithAssets('原名')
    const updated = await service.renameProject(project.id, '按 id 改名')
    expect(updated.name).toBe('按 id 改名')

    // 落盘了，不只是返回值改了
    const reread = await service.readProject(project.id)
    expect(reread.name).toBe('按 id 改名')
  })

  it('名字超长时截断，不会让列表页撑破', async () => {
    const { project } = await seedProjectWithAssets()
    const updated = await service.renameProject(project.id, '长'.repeat(200))
    expect(updated.name.length).toBe(80)
  })

  it('重命名不存在的项目抛出可读错误', async () => {
    await expect(service.renameProject('prj_not_exist', '新名字')).rejects.toThrow(
      /不存在/,
    )
  })
})

// ───────────────────── 新建 ─────────────────────

describe('A-1 新建项目', () => {
  it('建出来的项目立即可读，且摘要已同步（同事务）', async () => {
    const project = await service.createProjectRecord({ name: '我的第一部' })

    expect(project.id).toMatch(/^prj_/)
    expect(project.name).toBe('我的第一部')
    expect(project.revision).toBe(0)
    expect(project.isSample).toBe(false)

    const reread = await service.readProject(project.id)
    expect(reread.name).toBe('我的第一部')

    const list = await service.listProjects()
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(project.id)
    expect(list[0].name).toBe('我的第一部')
  })

  it('空名字回落到"未命名作品"', async () => {
    const project = await service.createProjectRecord({})
    expect(project.name).toBe('未命名作品')
  })

  it('新建后自动成为最近打开的项目', async () => {
    const project = await service.createProjectRecord({ name: 'A' })
    expect(await service.resolveRecentProjectId()).toBe(project.id)
  })

  it('连续新建两个项目，列表两条且按更新时间倒序', async () => {
    await service.createProjectRecord({ name: '先建的' })
    await service.createProjectRecord({ name: '后建的' })

    const list = await service.listProjects()
    expect(list).toHaveLength(2)
    expect(list[0].name).toBe('后建的')
  })
})

// ───────────────────── 示例项目 ─────────────────────

describe('示例项目', () => {
  it('载入后包含中性占位人物、四平台账号及各应用展示', async () => {
    const project = await service.createSample()

    expect(project.isSample).toBe(true)
    expect(project.characters).toHaveLength(2)
    expect(project.platformAccounts).toHaveLength(8)
    expect(project.appData.kakaotalk.conversations).toHaveLength(1)
    expect(project.appData.kakaotalk.messages).toHaveLength(12)
    expect(project.appData.instagram.posts).toHaveLength(2)
    expect(project.appData.x.posts).toHaveLength(4)
    expect(project.appData.x.replies).toHaveLength(4)
  })

  it('★ 所有消息/帖子的作者引用都能在项目内解析到（无悬空 id）', async () => {
    const project = await service.createSample()
    const charIds = new Set(project.characters.map((c) => c.id))
    const accountIds = new Set(project.platformAccounts.map((a) => a.id))

    const messages = project.appData.kakaotalk.messages.filter(m => m.contentType !== 'system')
    for (const m of messages) {
      expect(charIds.has(m.senderCharacterId)).toBe(true)
      if (m.senderAccountId) expect(accountIds.has(m.senderAccountId)).toBe(true)
    }

    for (const p of project.appData.instagram.posts) {
      expect(charIds.has(p.authorCharacterId)).toBe(true)
      expect(accountIds.has(p.authorAccountId)).toBe(true)
    }

    const xPostIds = new Set(project.appData.x.posts.map((p) => p.id))
    const xReplyIds = new Set(project.appData.x.replies.map((r) => r.id))
    for (const p of project.appData.x.posts) {
      expect(charIds.has(p.authorCharacterId)).toBe(true)
      expect(accountIds.has(p.authorAccountId)).toBe(true)
    }
    for (const r of project.appData.x.replies) {
      expect(charIds.has(r.authorCharacterId)).toBe(true)
      if (r.authorAccountId) expect(accountIds.has(r.authorAccountId)).toBe(true)
      // 回复挂在帖子或另一条回复上都可以（对话可以继续往下接），
      // 但不能是悬空 id —— 那样详情页永远查不到它
      expect(xPostIds.has(r.parentId) || xReplyIds.has(r.parentId)).toBe(true)
    }
  })

  it('★ 同一角色在不同平台用不同资料（这本是示例要教的事）', async () => {
    const project = await service.createSample()
    const accountsOfFirst = project.platformAccounts.filter(
      (a) => a.characterId === project.characters[0].id,
    )
    expect(accountsOfFirst).toHaveLength(4)

    const kt = accountsOfFirst.find((a) => a.platform === 'kakaotalk')
    const ig = accountsOfFirst.find((a) => a.platform === 'instagram')
    const x = accountsOfFirst.find((a) => a.platform === 'x')
    expect(kt.displayName).not.toBe(ig.displayName)
    expect(ig.handle).toBe('demo_a')
    expect(x.handle).toBe('demo_a')
  })

  it('示例项目能被正常删除（不留残留）', async () => {
    const project = await service.createSample()
    await service.deleteProject(project.id)
    expect(await service.readProject(project.id)).toBeNull()
    expect(await service.listProjects()).toHaveLength(0)
  })

  it('示例项目与空项目可以共存', async () => {
    await service.createSample()
    await service.createProjectRecord({ name: '空项目' })
    const list = await service.listProjects()
    expect(list).toHaveLength(2)
    expect(list.filter((p) => p.isSample)).toHaveLength(1)
  })
})
