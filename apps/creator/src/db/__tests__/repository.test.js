

import { describe, it, expect, beforeEach } from 'vitest'
import {
  createProject,
  createCharacter,
  createConversation,
  createMessage,
  createPost,
  createAsset,
} from '@phone-sim/shared'

import * as repo from '../repository.js'
import { resetDatabase, makeBlob } from './support/fake-db.js'

beforeEach(async () => {
  await resetDatabase()
})

// ───────────────────── A-1 项目保存与恢复 ─────────────────────

describe('A-1 项目保存与恢复', () => {
  it('角色 / 会话 / 消息 / 帖子保存后能完整读回', async () => {
    const project = createProject({ name: '测试作品' })
    const alice = createCharacter({ name: '小林' })
    const bob = createCharacter({ name: '阿杰' })
    project.characters.push(alice, bob)

    const conv = createConversation('kakaotalk', {
      title: '周末',
      participantIds: [alice.id, bob.id],
    })
    project.appData.kakaotalk.conversations.push(conv)
    project.appData.kakaotalk.messages.push(
      createMessage(conv.id, {
        senderCharacterId: alice.id,
        content: '在吗',
        displayTime: '2026-05-01T10:00:00.000Z',
      }),
      createMessage(conv.id, {
        senderCharacterId: bob.id,
        content: '在',
        displayTime: '2026-05-01T10:01:00.000Z',
      }),
    )
    project.appData.instagram.posts.push(
      createPost('instagram', {
        authorCharacterId: alice.id,
        content: '今天的天空',
        metrics: { likes: 12, reposts: 1, replies: 3, views: 40 },
      }),
    )

    await repo.saveProject(project)

    const loaded = await repo.getProject(project.id)
    expect(loaded).toBeTruthy()
    expect(loaded.name).toBe('测试作品')
    expect(loaded.characters).toHaveLength(2)
    expect(loaded.characters[0].name).toBe('小林')
    expect(loaded.appData.kakaotalk.messages).toHaveLength(2)
    expect(loaded.appData.kakaotalk.messages[1].content).toBe('在')
    expect(loaded.appData.instagram.posts[0].metrics.likes).toBe(12)
    // 深度相等：确保没有字段在往返中丢失
    expect(loaded).toEqual(project)
  })

  it('读取不存在的项目返回 undefined 而不是抛错', async () => {
    expect(await repo.getProject('prj_not_exist')).toBeUndefined()
  })
})

// ───────────────────── A-2 图片保存与恢复 ─────────────────────

describe('A-2 图片保存与恢复', () => {
  it('写入的 Blob 能按 assetId 取回，且是真的 Blob 而非临时 URL', async () => {
    const project = createProject()
    const asset = createAsset(project.id, { fileName: 'avatar.webp', byteSize: 256 })
    project.assets.push(asset)
    project.characters.push(createCharacter({ name: '小林', avatarAssetId: asset.id }))

    const blob = makeBlob(256)
    await repo.writeProjectWithAssets(project, [
      { assetId: asset.id, projectId: project.id, blob },
    ])

    const loaded = await repo.getAssetBlob(asset.id)
    expect(loaded).toBeInstanceOf(Blob)
    expect(loaded.size).toBe(256)
    if (typeof loaded.text === 'function') {
      expect(await loaded.text()).toBe('a'.repeat(256))
    }
  })

  it('批量读取只返回存在的资源，缺失的静默跳过', async () => {
    const project = createProject()
    await repo.putAssetBlob({ assetId: 'ast_a', projectId: project.id, blob: makeBlob(10) })
    await repo.putAssetBlob({ assetId: 'ast_b', projectId: project.id, blob: makeBlob(20) })

    const map = await repo.getAssetBlobs(['ast_a', 'ast_b', 'ast_missing'])
    expect(map.size).toBe(2)
    expect(map.get('ast_a').size).toBe(10)
    expect(map.has('ast_missing')).toBe(false)
  })

  it('资源缺失时返回 null，不抛错（读取端据此降级占位）', async () => {
    expect(await repo.getAssetBlob('ast_not_exist')).toBeNull()
  })

  it('sumAssetBytes 统计出该项目的资源总体积', async () => {
    const project = createProject()
    await repo.putAssetBlob({ assetId: 'ast_1', projectId: project.id, blob: makeBlob(100) })
    await repo.putAssetBlob({ assetId: 'ast_2', projectId: project.id, blob: makeBlob(200) })
    expect(await repo.sumAssetBytes(project.id)).toBe(300)
  })
})

// ───────────────────── A-7 项目删除的隔离性 ─────────────────────

describe('A-7 项目删除不残留、不误删', () => {
  it('删除项目会清掉自己的资源', async () => {
    const project = createProject()
    const asset = createAsset(project.id)
    project.assets.push(asset)

    await repo.writeProjectWithAssets(project, [
      { assetId: asset.id, projectId: project.id, blob: makeBlob(64) },
    ])

    // repository 层直接返回删除的资源数量；包成对象是 service 层的事
    const removedAssets = await repo.removeProject(project.id)
    expect(removedAssets).toBe(1)
    expect(await repo.getProject(project.id)).toBeUndefined()
    expect(await repo.getAssetBlob(asset.id)).toBeNull()
    expect(await repo.listSummaries()).toHaveLength(0)
  })

  it('删除项目 A 不影响项目 B 的资源', async () => {
    const a = createProject({ name: 'A' })
    const b = createProject({ name: 'B' })
    const assetA = createAsset(a.id)
    const assetB = createAsset(b.id)

    await repo.writeProjectWithAssets(a, [
      { assetId: assetA.id, projectId: a.id, blob: makeBlob(10, 'a') },
    ])
    await repo.writeProjectWithAssets(b, [
      { assetId: assetB.id, projectId: b.id, blob: makeBlob(20, 'b') },
    ])

    await repo.removeProject(a.id)

    // B 的数据与资源必须完好
    expect(await repo.getProject(b.id)).toBeTruthy()
    const blobB = await repo.getAssetBlob(assetB.id)
    expect(blobB).toBeInstanceOf(Blob)
    expect(blobB.size).toBe(20)
    expect(await repo.listSummaries()).toHaveLength(1)
  })

  it('删除后项目不再出现在摘要列表里', async () => {
    const p = createProject({ name: '将删除' })
    await repo.saveProject(p)
    expect(await repo.listSummaries()).toHaveLength(1)
    await repo.removeProject(p.id)
    expect(await repo.listSummaries()).toHaveLength(0)
  })
})

// ───────────────────── A-9 摘要一致性 ─────────────────────

describe('A-9 摘要与项目同事务', () => {
  it('保存项目后摘要立即存在且字段正确', async () => {
    const project = createProject({ name: '摘要测试' })
    const owner = createCharacter({ name: '小林', avatarAssetId: 'ast_owner' })
    project.characters.push(owner)
    project.workSettings.ownerCharacterId = owner.id

    await repo.saveProject(project)

    const summaries = await repo.listSummaries()
    expect(summaries).toHaveLength(1)
    expect(summaries[0].id).toBe(project.id)
    expect(summaries[0].name).toBe('摘要测试')
    // 封面优先取所属人头像
    expect(summaries[0].coverAssetId).toBe('ast_owner')
  })

  it('改名后摘要同步更新', async () => {
    const project = createProject({ name: '旧名' })
    await repo.saveProject(project)
    await repo.saveProject({ ...project, name: '新名' })
    const summaries = await repo.listSummaries()
    expect(summaries[0].name).toBe('新名')
  })

  it('listAllProjectIds 只返回主键，不读项目体', async () => {
    const p1 = createProject()
    const p2 = createProject()
    await repo.saveProject(p1)
    await repo.saveProject(p2)
    const ids = await repo.listAllProjectIds()
    expect(ids.sort()).toEqual([p1.id, p2.id].sort())
  })
})

// ───────────────────── meta ─────────────────────

describe('meta 存储', () => {
  it('读写删', async () => {
    expect(await repo.getMeta('k')).toBeNull()
    await repo.setMeta('k', { a: 1 })
    expect(await repo.getMeta('k')).toEqual({ a: 1 })
    await repo.deleteMeta('k')
    expect(await repo.getMeta('k')).toBeNull()
  })
})
