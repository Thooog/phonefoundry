import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createProject, prepareProject } from '@phone-sim/shared'
import { useProjectStore } from '../project.js'
import * as repo from '../../db/repository.js'
import * as guard from '../../db/tab-guard.js'
import { lockKey } from '../../db/lock-logic.js'
import { resetDatabase } from '../../db/__tests__/support/fake-db.js'

let store
beforeEach(async () => {
  guard.__resetForTest()
  await resetDatabase()
  setActivePinia(createPinia())
  const project = createProject({ name: 'original' })
  await repo.saveProject(project)
  store = useProjectStore()
  await store.open(project.id)
})
afterEach(async () => { await store.close({ discard: true }); guard.__resetForTest() })
async function loseLock() {
  await repo.updateMeta(lockKey(store.projectId), value => ({ write: true, value: { ...value, tabId: 'other', fence: value.fence + 1 } }))
}
describe('persistence safety', () => {
  it('failed deletion retains the disk snapshot and blob; takeover can still read both', async () => {
    const asset = await store.addAsset({ blob: new Blob(['image']) })
    store.mutate(p => { p.workSettings.wallpaper = { type: 'image', assetId: asset.id } })
    await store.flush()
    await loseLock()
    store.mutate(p => { p.workSettings.wallpaper.assetId = null })
    await expect(store.removeAsset(asset.id)).rejects.toThrow()
    expect((await repo.getProject(store.projectId)).workSettings.wallpaper.assetId).toBe(asset.id)
    expect(await repo.getAssetBlob(asset.id)).not.toBeNull()
  })
  it('successful deletion commits metadata and binary removal together', async () => {
    const asset = await store.addAsset({ blob: new Blob(['image']) })
    await store.flush()
    await store.removeAsset(asset.id)
    expect((await repo.getProject(store.projectId)).assets).toEqual([])
    expect(await repo.getAssetBlob(asset.id)).toBeNull()
  })
  it('also reclaims an asset removed before its first autosave', async () => {
    const asset = await store.addAsset({ blob: new Blob(['temporary']) })
    await store.removeAsset(asset.id)
    expect(await repo.getAssetBlob(asset.id)).toBeNull()
  })
  it('failed close preserves unsaved edits and the error', async () => {
    store.patch({ name: 'unsaved' })
    await loseLock()
    await expect(store.close()).rejects.toThrow()
    expect(store.project.name).toBe('unsaved')
    expect(store.saveStatus).toBe('error')
    expect((await repo.getProject(store.projectId)).name).toBe('original')
  })
  it('a throwing mutation cannot change the project or revision', () => {
    const before = structuredClone(store.project)
    expect(() => store.mutate(p => { p.characters.push({ id: 'partial' }); throw new Error('failed') })).toThrow('failed')
    expect(store.project).toEqual(before)
    expect(store.isDirty).toBe(false)
  })
  it('normalizes legacy X actors without mutating the supplied project', () => {
    const source = createProject()
    source.appData.x.posts.push({ id: 'legacy', xPostType: 'repost', xActorCharacterId: 'actor' })
    const prepared = prepareProject(source).project.appData.x.posts[0]
    expect(prepared).toMatchObject({ xPostTypes: ['repost'], xRepostByCharacterIds: ['actor'], xLikeByCharacterIds: [] })
    expect(prepared.xPostType).toBeUndefined()
    expect(source.appData.x.posts[0].xPostType).toBe('repost')
  })
  it('rejects future versions and malformed collections before persistence', () => {
    expect(() => prepareProject(createProject({ schemaVersion: 999 }))).toThrow()
    const malformed = createProject()
    malformed.appData.messages.messages = {}
    expect(() => prepareProject(malformed)).toThrow('应为数组')
  })
})
