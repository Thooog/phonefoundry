/**
 * 导入测试 —— 备份包往返、裸 JSON、错误分支。
 *
 * 最关键的一条是「往返」：导出 → 导入 → 逐字段比对。
 * 单元测试里各测各的，很容易出现"导出写的是 A、导入读的是 B"而两边测试都绿。
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createSampleProject } from '@phone-sim/shared'
import { buildZip, exportProjectBackup } from '@exporter'

import * as repo from '../../db/repository.js'
import { importProjectRecord } from '../../db/project-service.js'
import { importProjectFromFile, describeImport } from '../import-backup.js'
import { IMPORT_KIND, parseBackupZip, parseBareJson } from '../parse-backup.js'
import { resetDatabase } from '../../db/__tests__/support/fake-db.js'

beforeEach(async () => {
  await resetDatabase()
})

/** 造一个有 1 张图、被角色头像引用的项目 */
function projectWithImage(name = '雨夜') {
  const project = createSampleProject()
  project.name = name
  project.assets = [{ id: 'img_a', kind: 'image', mimeType: 'image/webp' }]
  project.characters[0].avatarAssetId = 'img_a'
  return project
}

function imageBytes() {
  return new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4])
}

function asFile(bytes, name) {
  return new File([bytes], name)
}

// ───────────────────── 解析层 ─────────────────────

describe('parseBackupZip', () => {
  it('损坏的资源列表在解析边界被拒绝', () => {
    const project = { ...createSampleProject(), assets: {} }
    expect(() => parseBackupZip(buildZip([{ path: 'project.json', text: JSON.stringify(project) }]))).toThrow('缺少资源列表')
    expect(() => parseBareJson(new TextEncoder().encode(JSON.stringify(project)))).toThrow('缺少资源列表')
  })
  it('restores a desktop layout and its HTML through a project backup', async () => {
    const project = createSampleProject()
    const homeLayout = { items: [
      { id: 'phone', kind: 'app', area: 'grid', slot: 3 },
      { id: 'home_custom', kind: 'html-app', area: 'dock', slot: 0, name: '徽章', html: '<strong>徽章</strong>' },
    ] }
    project.workSettings.homeLayout = homeLayout
    const backup = await exportProjectBackup({ project })
    const imported = await importProjectFromFile(asFile(backup.bytes, backup.fileName))
    expect(imported.project.workSettings.homeLayout).toEqual(homeLayout)
  })

  it('从备份包里取出项目与图片二进制', async () => {
    const backup = await exportProjectBackup({
      project: projectWithImage(),
      assets: new Map([['img_a', imageBytes()]]),
    })

    const parsed = parseBackupZip(backup.bytes)
    expect(parsed.kind).toBe(IMPORT_KIND.BACKUP)
    expect(parsed.project.name).toBe('雨夜')
    expect(parsed.manifest.projectName).toBe('雨夜')
    expect(parsed.blobs.size).toBe(1)
    expect(parsed.missingAssets).toEqual([])
  })

  it('导出记录的文件名对不上时，按 assetId 前缀兜底找到图', async () => {
    // 模拟"实际是 png 但元信息写成 jpg"的情况：把文件名和 mimeType 都改坏
    const project = projectWithImage()
    project.assets[0].mimeType = 'image/jpeg'
    const backup = await exportProjectBackup({
      project,
      assets: new Map([['img_a', imageBytes()]]),
    })

    const { buildZip, readZip } = await import('@exporter')
    const entries = [...readZip(backup.bytes)].map(([path, data]) =>
      path.endsWith('.jpg')
        ? { path: path.replace(/\.jpg$/, '.png'), bytes: data, binary: true }
        : { path, text: new TextDecoder().decode(data) },
    )
    const parsed = parseBackupZip(buildZip(entries))

    expect(parsed.blobs.size).toBe(1)
    expect(parsed.blobs.get('img_a').type).toBe('image/jpeg')
  })

  it('作品包（没有 project.json）给出"这是给读者的包"的明确提示', async () => {
    const { exportWorkPackage } = await import('@exporter')
    const packed = await exportWorkPackage({
      project: projectWithImage(),
      assets: new Map(),
      player: { js: 'x', css: '' },
    })

    expect(() => parseBackupZip(packed.bytes)).toThrow(/项目备份包/)
  })
})

describe('parseBareJson', () => {
  it('接受直接是项目对象的 JSON', () => {
    const parsed = parseBareJson(new TextEncoder().encode(JSON.stringify(projectWithImage())))
    expect(parsed.kind).toBe(IMPORT_KIND.BARE_JSON)
    expect(parsed.blobs.size).toBe(0)
    // 裸 JSON 没有图，所有资源都算"缺"
    expect(parsed.missingAssets).toEqual(['img_a'])
  })

  it('也接受 { project: {...} } 包了一层的写法', () => {
    const payload = { project: projectWithImage() }
    const parsed = parseBareJson(new TextEncoder().encode(JSON.stringify(payload)))
    expect(parsed.project.characters.length).toBeGreaterThan(0)
  })

  it('单飞的 manifest.json 会被拦住，而不是当项目导进来', async () => {
    const backup = await exportProjectBackup({ project: projectWithImage() })
    const { readZip } = await import('@exporter')
    const manifestBytes = readZip(backup.bytes).get('manifest.json')

    expect(() => parseBareJson(manifestBytes)).toThrow(/manifest/)
  })

  it('不是 JSON 也不像项目时报可读的错', () => {
    expect(() => parseBareJson(new TextEncoder().encode('不是 json'))).toThrow(/JSON/)
    expect(() => parseBareJson(new TextEncoder().encode('{"a":1}'))).toThrow(/角色/)
  })
})

// ───────────────────── 导入落盘 ─────────────────────

describe('importProjectRecord', () => {
  it('换掉项目 id 与全部资源 id，并重写引用', async () => {
    const source = projectWithImage()
    const { project, importedAssets } = await importProjectRecord({
      project: source,
      blobs: new Map([['img_a', new Blob([imageBytes()], { type: 'image/webp' })]]),
    })

    expect(project.id).not.toBe(source.id)
    expect(importedAssets).toBe(1)

    const oldAssetId = source.assets[0].id
    const newAsset = project.assets[0]
    expect(newAsset.id).not.toBe(oldAssetId)
    expect(newAsset.projectId).toBe(project.id)
    // 引用必须指向新 id，否则图还在但没人引用它 —— 表现为"图全丢了"
    expect(project.characters[0].avatarAssetId).toBe(newAsset.id)
  })

  it('名字加后缀，同一份包导两次得到两个项目', async () => {
    const source = projectWithImage('雨夜')
    const blobs = new Map([['img_a', new Blob([imageBytes()], { type: 'image/webp' })]])

    const first = await importProjectRecord({ project: source, blobs })
    const second = await importProjectRecord({ project: source, blobs })

    expect(first.project.name).toBe('雨夜（导入）')
    expect(second.project.name).toBe('雨夜（导入）')
    // 关键：不是同名覆盖，而是两条独立记录
    expect(first.project.id).not.toBe(second.project.id)

    const ids = await repo.listAllProjectIds()
    expect(ids).toHaveLength(2)
  })

  it('图片二进制真的写进了资源表', async () => {
    const source = projectWithImage()
    const { project } = await importProjectRecord({
      project: source,
      blobs: new Map([['img_a', new Blob([imageBytes()], { type: 'image/webp' })]]),
    })

    const blob = await repo.getAssetBlob(project.assets[0].id)
    expect(blob).toBeTruthy()
    expect(blob.type).toBe('image/webp')
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(imageBytes())
  })

  it('结构不可用时拒绝，不写半个项目进去', async () => {
    await expect(
      importProjectRecord({ project: { name: '坏数据' } }),
    ).rejects.toThrow(/不像是有效的项目数据/)

    expect(await repo.listAllProjectIds()).toHaveLength(0)
  })

  it('导入的项目不再是"示例"（否则会被当成只读示例处理）', async () => {
    const source = createSampleProject()
    const { project } = await importProjectRecord({ project: source })
    expect(project.isSample).toBe(false)
  })
})

// ───────────────────── 端到端往返 ─────────────────────

describe('导出 → 导入 往返', () => {
  it('项目字段与图片逐项还原', async () => {
    const source = projectWithImage('往返测试')
    source.appData.kakaotalk.conversations[0].draft = '半句话也要留住'

    const backup = await exportProjectBackup({
      project: source,
      assets: new Map([['img_a', imageBytes()]]),
    })

    const result = await importProjectFromFile(asFile(backup.bytes, backup.fileName))

    expect(result.kind).toBe(IMPORT_KIND.BACKUP)
    expect(result.importedAssets).toBe(1)
    expect(result.missingAssets).toEqual([])

    const restored = await repo.getProject(result.project.id)
    expect(restored.name).toBe('往返测试（导入）')
    // 编辑态字段必须活着 —— 这正是备份包与作品包的核心区别
    expect(restored.appData.kakaotalk.conversations[0].draft).toBe('半句话也要留住')
    expect(restored.characters.length).toBe(source.characters.length)
    expect(restored.appData.kakaotalk.messages.length).toBe(
      source.appData.kakaotalk.messages.length,
    )

    const blob = await repo.getAssetBlob(restored.assets[0].id)
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(imageBytes())
  })

  it('裸 JSON 导入成功但明说缺图', async () => {
    const source = projectWithImage('只有数据')
    const file = asFile(
      new TextEncoder().encode(JSON.stringify(source)),
      'project.json',
    )

    const result = await importProjectFromFile(file)
    expect(result.kind).toBe(IMPORT_KIND.BARE_JSON)
    expect(result.missingAssets).toEqual(['img_a'])
    expect(describeImport(result)).toContain('不含图片')
  })
})

describe('describeImport', () => {
  it('三种结果说三种话', () => {
    expect(
      describeImport({ kind: IMPORT_KIND.BACKUP, importedAssets: 3, missingAssets: [] }),
    ).toBe('已导入，包含 3 张图片。')
    expect(
      describeImport({ kind: IMPORT_KIND.BACKUP, importedAssets: 1, missingAssets: ['a', 'b'] }),
    ).toContain('2 张图片在包里找不到')
    expect(
      describeImport({ kind: IMPORT_KIND.BARE_JSON, importedAssets: 0, missingAssets: ['a'] }),
    ).toContain('不含图片')
  })
})
