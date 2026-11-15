import { describe, expect, it } from 'vitest'
import {
  APPS, DECORATIVE_APPS, canRemoveHomeItem, createCharacter, createProject, hasAppContent,
  hasHomeRestoreCapacity, importHomeApps, normalizeHomeLayout, removeHomeItem,
  resolveHomeLayout, toWorkData,
} from '../index.js'

function emptyWork() {
  const work = createProject({ characters: [createCharacter()] })
  work.platformAccounts = []
  work.appData = {}
  return work
}

function save(work, result) {
  expect(result.error).toBeUndefined()
  work.workSettings.homeLayout = result
}

describe('desktop app package', () => {
  it('keeps decoration separate from content apps and imports all decorative apps without duplicates', () => {
    const work = emptyWork()
    expect(DECORATIVE_APPS).toHaveLength(12)
    expect(DECORATIVE_APPS.map(app => app.name)).toContain('相机')
    expect(DECORATIVE_APPS.map(app => app.name)).toContain('文件')
    expect(APPS).toHaveLength(8)
    expect(resolveHomeLayout(work).items).toHaveLength(8)
    save(work, importHomeApps(work, DECORATIVE_APPS.map(app => app.id)))
    expect(resolveHomeLayout(work).items).toHaveLength(20)
    expect(importHomeApps(work, DECORATIVE_APPS.map(app => app.id))).toEqual(work.workSettings.homeLayout)
    expect(Object.keys(toWorkData(work).appData)).toHaveLength(8)
  })

  it('counts records and valid platform accounts but not general characters or orphan accounts', () => {
    const work = emptyWork()
    for (const app of APPS) expect(hasAppContent(work, app.id)).toBe(app.id === 'settings')
    work.appData.photos = { albums: [{ id: 'album' }] }
    expect(hasAppContent(work, 'photos')).toBe(true)
    work.platformAccounts = [{ platform: 'instagram', characterId: 'missing' }]
    expect(hasAppContent(work, 'instagram')).toBe(false)
    work.platformAccounts = [{ platform: 'messages', characterId: work.characters[0].id }]
    expect(hasAppContent(work, 'phone')).toBe(true)
    expect(hasAppContent(work, 'messages')).toBe(true)
    expect(hasAppContent(work, 'deco-camera')).toBe(false)
  })

  it('protects populated apps and settings, and persists empty app removal through work export', () => {
    const work = emptyWork()
    expect(removeHomeItem(work, 'settings').error).toBeTruthy()
    work.appData.notes = { notes: [{ id: 'note', text: '内容' }] }
    expect(removeHomeItem(work, 'notes').error).toBeTruthy()
    expect(canRemoveHomeItem(work, resolveHomeLayout(work).items.find(item => item.id === 'notes'))).toBe(false)
    save(work, removeHomeItem(work, 'phone'))
    const exported = toWorkData(work)
    expect(resolveHomeLayout(exported).items.some(item => item.id === 'phone')).toBe(false)
    expect(exported.workSettings.homeLayout.removedItems[0]).toMatchObject({ id: 'phone', area: 'dock', slot: 0 })
    save(work, importHomeApps(work, ['phone']))
    expect(resolveHomeLayout(work).items.find(item => item.id === 'phone')).toMatchObject({ area: 'dock', slot: 0 })
    expect(work.workSettings.homeLayout.removedItems).toBeUndefined()
  })

  it('restores content apps automatically, using a free cell when their old position is occupied', () => {
    const work = emptyWork()
    save(work, removeHomeItem(work, 'photos'))
    save(work, importHomeApps(work, ['deco-camera']))
    expect(work.workSettings.homeLayout.items.find(item => item.id === 'deco-camera').slot).toBe(0)
    work.appData.photos = { photos: [{ id: 'photo' }] }
    const restored = resolveHomeLayout(work)
    expect(restored.items.find(item => item.id === 'photos')).toMatchObject({ area: 'grid', slot: 4 })
    expect(restored.removedItems).toBeUndefined()
    save(work, restored)
    work.appData.photos.photos = []
    expect(resolveHomeLayout(work).items.some(item => item.id === 'photos')).toBe(true)
  })

  it('preserves decoration and HTML icons across remove, export, reload and restore', () => {
    const work = emptyWork()
    save(work, importHomeApps(work, ['deco-files']))
    const html = { id: 'html_custom', kind: 'html-app', name: '图标', html: '<b>作品</b>', area: 'grid', slot: 5 }
    work.workSettings.homeLayout.items.push(html)
    save(work, removeHomeItem(work, 'deco-files'))
    save(work, removeHomeItem(work, html.id))
    const exported = toWorkData(work)
    expect(exported.workSettings.homeLayout.removedItems).toContainEqual(html)
    const restored = importHomeApps(JSON.parse(JSON.stringify(exported)), ['deco-files', html.id])
    expect(restored.items).toContainEqual(html)
    expect(restored.items.some(item => item.id === 'deco-files')).toBe(true)
    expect(restored.removedItems).toBeUndefined()
  })

  it('rejects a batch atomically and reserves capacity for removed built-in apps', () => {
    const work = emptyWork()
    save(work, removeHomeItem(work, 'phone'))
    const items = work.workSettings.homeLayout.items
    for (let slot = 4; slot < 28; slot++) items.push({ id: `html_${slot}`, kind: 'html-app', name: '图标', html: '<b>x</b>', area: 'grid', slot })
    expect(hasHomeRestoreCapacity(work, items)).toBe(true)
    const before = JSON.stringify(work)
    expect(importHomeApps(work, ['deco-camera', 'deco-files']).error).toBeTruthy()
    expect(JSON.stringify(work)).toBe(before)
    expect(importHomeApps(work, ['phone']).items).toHaveLength(32)
  })

  it('normalizes removed items independently of occupied cells and rejects duplicates or protected settings', () => {
    const item = { id: 'photos', kind: 'app', area: 'grid', slot: 0 }
    expect(normalizeHomeLayout({ items: [], removedItems: [item] })).toEqual({ items: [], removedItems: [item] })
    expect(normalizeHomeLayout({ items: [item], removedItems: [item, { ...item, id: 'settings' }] })).toEqual({ items: [item] })
    expect(normalizeHomeLayout({ items: [], removedItems: [{ ...item, id: 'unknown' }] })).toBeNull()
  })
})


