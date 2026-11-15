import { describe, expect, it } from 'vitest'
import { APPS, ACCOUNT_PLATFORMS, collectAssetRefs, createSampleProject, toWorkData, validateProject } from '../index.js'
import { homeItemCells, normalizeHomeLayout, resolveHomeLayout } from '../work/home-layout.js'

describe('中性功能示例', () => {
  it('使用无身份与关系的占位人物，并为所有已支持平台配置账号', () => {
    const project = createSampleProject()
    expect(validateProject(project)).toMatchObject({ ok: true, warnings: [] })
    expect(project.characters.map(c => c.name)).toEqual(['演示人物 A', '演示人物 B'])
    expect(project.workSettings.ownerCharacterId).toBe(project.characters[0].id)
    for (const character of project.characters) {
      const accounts = project.platformAccounts.filter(a => a.characterId === character.id)
      expect(accounts.map(a => a.platform).sort()).toEqual([...ACCOUNT_PLATFORMS].sort())
      expect(accounts.filter(a => a.extraFields.followList).every(a => a.extraFields.followList.length === 0)).toBe(true)
    }
    expect(JSON.stringify(project)).not.toMatch(/林夏|周予安|室友|同班|大学生|夏天的两个女孩/)
  })

  it('每个已注册内容集合都有可展示的样本，且作者、会话和回复引用完整', () => {
    const project = createSampleProject()
    const characters = new Set(project.characters.map(c => c.id))
    const accounts = new Set(project.platformAccounts.map(a => a.id))
    for (const app of APPS) {
      const bucket = project.appData[app.id]
      for (const collection of app.collections) expect(bucket[collection].length, `${app.id}.${collection}`).toBeGreaterThan(0)
      const conversations = new Set((bucket.conversations ?? []).map(c => c.id))
      const parents = new Set([...(bucket.posts ?? []), ...(bucket.comments ?? []), ...(bucket.replies ?? [])].map(p => p.id))
      for (const rows of Object.values(bucket)) for (const row of rows) {
        if (row.authorCharacterId) expect(characters.has(row.authorCharacterId)).toBe(true)
        if (row.authorAccountId) expect(accounts.has(row.authorAccountId)).toBe(true)
        if (row.senderCharacterId) expect(characters.has(row.senderCharacterId)).toBe(true)
        if (row.conversationId) expect(conversations.has(row.conversationId)).toBe(true)
        if (row.parentId) expect(parents.has(row.parentId)).toBe(true)
      }
    }
    expect(project.assets).toEqual([])
    expect([...collectAssetRefs(project)]).toEqual([])
    expect(() => JSON.stringify(toWorkData(project))).not.toThrow()
  })

  it('覆盖消息形态、已读、多图、评论线程、故事、搜索及照片特殊状态', () => {
    const { appData } = createSampleProject()
    expect(new Set(appData.kakaotalk.messages.map(m => m.contentType))).toEqual(new Set(['text', 'image', 'sticker', 'voice', 'call', 'system']))
    const calls = appData.kakaotalk.messages.filter(m => m.contentType === 'call')
    expect(new Set(calls.map(m => `${m.callKind}/${m.callStatus}`))).toEqual(new Set(['voice/completed', 'voice/missed', 'video/completed', 'video/missed']))
    expect(appData.kakaotalk.messages.some(m => m.transcript)).toBe(true)
    expect(appData.messages.messages.some(m => m.readAt)).toBe(true)
    expect(appData.messages.messages.some(m => m.senderName)).toBe(true)
    for (const id of ['instagram', 'x']) {
      expect(appData[id].posts.some(p => p.mediaAssetIds.length > 1)).toBe(true)
      expect(appData[id].searchHistory.some(row => row.type === 'account')).toBe(true)
      const comments = appData[id][id === 'x' ? 'replies' : 'comments']
      expect(comments.some(c => comments.some(parent => parent.id === c.parentId))).toBe(true)
    }
    expect(appData.instagram.stories.some(s => s.seen)).toBe(true)
    expect(appData.instagram.stories.some(s => !s.seen)).toBe(true)
    expect(appData.x.posts.some(p => p.showInHome === false)).toBe(true)
    for (const flag of ['isFavorite', 'isHidden', 'isInTrash']) expect(appData.photos.photos.some(p => p[flag])).toBe(true)
    expect(new Set(appData.phone.calls.map(c => c.type))).toEqual(new Set(['incoming', 'outgoing', 'missed']))
  })

  it('所有桌面展示项保留到作品中且不重叠、不挤掉内置应用', () => {
    const project = createSampleProject()
    const layout = project.workSettings.homeLayout
    expect(normalizeHomeLayout(layout)).toEqual(layout)
    expect(toWorkData(project).workSettings.homeLayout).toEqual(layout)
    expect(resolveHomeLayout(project).items).toHaveLength(layout.items.length)
    const cells = new Set()
    for (const item of layout.items) for (const cell of homeItemCells(item)) {
      const key = `${item.area}/${cell}`
      expect(cells.has(key)).toBe(false)
      cells.add(key)
    }
    expect(layout.items.filter(i => i.kind === 'preset').map(i => i.presetId).sort()).toEqual(['clock', 'date', 'note', 'weather'])
    expect(layout.items.filter(i => i.kind === 'app').map(i => i.id).sort()).toEqual(APPS.map(a => a.id).sort())
    for (const kind of ['html-app', 'html-widget', 'decorative-app']) expect(layout.items.some(i => i.kind === kind)).toBe(true)
  })

  it('默认不设密码，并提供导览；重复创建互不影响，仍支持顶层覆盖', () => {
    const first = createSampleProject()
    expect(first.workSettings.passcodeEnabled).toBe(false)
    expect(Object.values(first.workSettings.appSettings.photoLocks).every(lock => !lock.enabled)).toBe(true)
    expect(first.appData.notes.notes.some(n => n.content.startsWith('功能导览'))).toBe(true)
    expect(first.appData.notes.notes.some(n => n.content.includes('1234'))).toBe(true)
    const second = createSampleProject({ name: '自定义名称' })
    first.platformAccounts[1].extraFields.followList.push(first.characters[1].id)
    expect(second.platformAccounts[1].extraFields.followList).toEqual([])
    expect(second.id).not.toBe(first.id)
    expect(second.name).toBe('自定义名称')
  })
})
