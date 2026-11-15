import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createAsset, createCharacter, createPlatformAccount, createProject, createSampleProject } from '@phone-sim/shared'
import { buildCharacterProject, exportCharacters, readZip } from '@exporter'
import { estimateSizes, exportProjectAsBackup } from '../export-work-package.js'
import { importProjectFromFile } from '../../import/import-backup.js'
import { parseBackupZip } from '../../import/parse-backup.js'
import * as repo from '../../db/repository.js'
import { resetDatabase } from '../../db/__tests__/support/fake-db.js'

beforeEach(resetDatabase)

function fixture() {
  const project = createSampleProject({ name: '夏天' })
  const character = project.characters[0]
  const avatar = createAsset(project.id, { byteSize: 4 })
  const banner = createAsset(project.id, { byteSize: 5 })
  const original = createAsset(project.id, { byteSize: 6 })
  const unrelated = createAsset(project.id, { byteSize: 100000 })
  avatar.originalAssetId = original.id
  character.avatarAssetId = avatar.id
  const account = createPlatformAccount(character.id, 'x', {
    displayName: '小夏', handle: '@summer', bio: '人物简介',
    avatarAssetId: avatar.id, bannerAssetId: banner.id,
    extraFields: { location: '上海', followers: 123 },
  })
  project.platformAccounts.push(account, createPlatformAccount('deleted-character', 'x'))
  project.assets = [avatar, banner, original, unrelated]
  project.workSettings.wallpaper.assetId = unrelated.id
  const assets = new Map(project.assets.map((asset) => [asset.id, new Uint8Array(asset.byteSize).fill(7)]))
  return { project, account, assets, avatar, banner, original, unrelated }
}

describe('人物导出', () => {
  it('资源存储读取失败时中止导出，不将故障伪装为缺图备份', async () => {
    const read = vi.spyOn(repo, 'getAssetBlobs').mockRejectedValue(new Error('资源存储读取失败'))
    try {
      await expect(exportProjectAsBackup(fixture().project)).rejects.toThrow('资源存储读取失败')
    } finally {
      read.mockRestore()
    }
  })
  it('保留全部人物和对应账号配置，仅打包其图片，不修改源项目', async () => {
    const { project, assets, account, avatar, banner, original, unrelated } = fixture()
    const before = structuredClone(project)
    const result = await exportCharacters({ project, assets, now: new Date('2026-11-15T00:00:00Z') })
    const parsed = parseBackupZip(result.bytes)
    expect(result.format).toBe('characters')
    expect(result.fileName).toBe('夏天_人物包_20261115.zip')
    expect(parsed.project.characters).toEqual(project.characters)
    expect(parsed.project.platformAccounts).toContainEqual(account)
    expect(parsed.project.platformAccounts.every((a) => project.characters.some((c) => c.id === a.characterId))).toBe(true)
    expect(parsed.project.appData).toEqual(createProject().appData)
    expect(parsed.project.workSettings).toEqual(createProject().workSettings)
    expect(parsed.project.assets.map((a) => a.id).sort()).toEqual([avatar.id, banner.id, original.id].sort())
    expect(Object.keys(readZip(result.bytes)).some((path) => path.includes(unrelated.id))).toBe(false)
    expect(result.missing).toEqual([])
    expect(project).toEqual(before)
    parsed.project.platformAccounts[0].extraFields.changed = true
    expect(project).toEqual(before)
  })

  it('通过现有导入入口恢复人物、账号头像、横幅与原图引用', async () => {
    const { project, assets, account } = fixture()
    const result = await exportCharacters({ project, assets })
    const imported = await importProjectFromFile(new Blob([result.bytes]))
    expect(imported.warnings).toEqual([])
    expect(imported.missingAssets).toEqual([])
    expect(imported.importedAssets).toBe(3)
    expect(imported.project.id).not.toBe(project.id)
    const restored = imported.project.platformAccounts.find((a) => a.id === account.id)
    expect(restored.extraFields).toEqual(account.extraFields)
    expect(restored.bannerAssetId).not.toBe(account.bannerAssetId)
    for (const id of [restored.avatarAssetId, restored.bannerAssetId]) {
      expect(await repo.getAssetBlob(id)).toBeTruthy()
    }
    const avatar = imported.project.assets.find((a) => a.id === restored.avatarAssetId)
    expect(await repo.getAssetBlob(avatar.originalAssetId)).toBeTruthy()
  })

  it('没有人物时拒绝导出，缺失头像或资源文件时报告缺失', async () => {
    await expect(exportCharacters({ project: createProject() })).rejects.toThrow('还没有人物')
    const project = createProject({ characters: [createCharacter({ avatarAssetId: 'missing-avatar' })] })
    expect((await exportCharacters({ project })).missing).toEqual(['missing-avatar'])
    const fixtureData = fixture()
    fixtureData.assets.delete(fixtureData.banner.id)
    expect((await exportCharacters(fixtureData)).missing).toEqual([fixtureData.banner.id])
  })

  it('人物包预估不计入剧情图片，也无需作品端产物', () => {
    const { project, unrelated } = fixture()
    const first = estimateSizes(project).characters
    unrelated.byteSize *= 10
    expect(estimateSizes(project).characters).toBe(first)
    expect(first).toBeGreaterThan(0)
    const template = buildCharacterProject(project)
    expect(template.assets.every((asset) => asset.projectId === template.id)).toBe(true)
  })
})
