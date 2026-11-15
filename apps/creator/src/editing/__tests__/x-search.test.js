import { describe, expect, it } from 'vitest'
import { buildXSearchHistory, buildXTrends, createProject, formatXTrendCount, searchX, toWorkData } from '@phone-sim/shared'
import { addXSearchRow, moveXSearchRow, removeXSearchRow, updateXSearchRow } from '../x-search.js'

function setup() {
  const editor = {
    project: createProject(),
    mutations: 0,
    mutate(fn) { const draft = { ...this.project }; fn(draft); this.project = draft; this.mutations++ },
  }
  editor.project.characters = [{ id: 'person', name: '林夏' }]
  editor.project.platformAccounts = [{ id: 'account', characterId: 'person', platform: 'x', displayName: '夏', handle: 'summer' }]
  return editor
}

describe('X search content', () => {
  it('旧项目按空数组读取；新增、编辑、删除换引用且每次只写入一次', () => {
    const editor = setup()
    delete editor.project.appData.x.trends
    const oldBucket = editor.project.appData.x
    const row = addXSearchRow(editor, 'trends')
    expect(oldBucket.trends).toBeUndefined()
    expect(editor.mutations).toBe(1)
    const oldRows = editor.project.appData.x.trends
    expect(updateXSearchRow(editor, 'trends', row.id, { title: '夏天', postCount: 800, id: 'invalid' })).toBe(true)
    expect(oldRows[0].title).toBe('')
    expect(editor.project.appData.x.trends[0]).toMatchObject({ id: row.id, title: '夏天', postCount: 800 })
    expect(removeXSearchRow(editor, 'trends', row.id)).toBe(true)
    expect(editor.project.appData.x.trends).toEqual([])
    expect(editor.mutations).toBe(3)
  })

  it('空分类地区实时继承当前第一条，单独设置不被覆盖', () => {
    const editor = setup()
    const one = addXSearchRow(editor, 'trends'), two = addXSearchRow(editor, 'trends'), three = addXSearchRow(editor, 'trends')
    updateXSearchRow(editor, 'trends', one.id, { category: '音乐', region: '中国' })
    updateXSearchRow(editor, 'trends', two.id, { category: '电影', region: '日本' })
    expect(buildXTrends(editor.project)[2]).toMatchObject({ category: '音乐', region: '中国' })
    moveXSearchRow(editor, 'trends', two.id, 0)
    expect(buildXTrends(editor.project)[2]).toMatchObject({ category: '电影', region: '日本' })
    expect(buildXTrends(editor.project)[1]).toMatchObject({ category: '音乐', region: '中国' })
    removeXSearchRow(editor, 'trends', two.id)
    expect(buildXTrends(editor.project).find(row => row.id === three.id).region).toBe('中国')
  })

  it('帖子数支持整数、零与未填，拒绝负数、小数和非安全整数', () => {
    const editor = setup(), row = addXSearchRow(editor, 'trends')
    for (const value of [-1, 1.2, NaN, Infinity, '800', Number.MAX_SAFE_INTEGER + 1]) expect(updateXSearchRow(editor, 'trends', row.id, { postCount: value })).toBe(false)
    expect(editor.mutations).toBe(1)
    for (const value of [0, 800, 12000, null]) expect(updateXSearchRow(editor, 'trends', row.id, { postCount: value })).toBe(true)
    expect([0, 800, 12000, null, undefined].map(formatXTrendCount)).toEqual(['0 帖子', '800 帖子', '1.2万 帖子', '', ''])
  })

  it('预览与导出保留新集合；人物资料同源，已删除账号不显示失效入口', () => {
    const editor = setup(), trend = addXSearchRow(editor, 'trends'), history = addXSearchRow(editor, 'searchHistory')
    updateXSearchRow(editor, 'trends', trend.id, { title: '夏天', postCount: 12000 })
    updateXSearchRow(editor, 'searchHistory', history.id, { type: 'account', accountId: 'account' })
    const work = JSON.parse(JSON.stringify(toWorkData(editor.project)))
    expect(work.appData.x.trends[0].postCount).toBe(12000)
    expect(buildXSearchHistory(work)[0]).toMatchObject({ title: '夏', handle: 'summer', characterId: 'person' })
    work.platformAccounts[0].displayName = '新昵称'
    expect(buildXSearchHistory(work)[0].title).toBe('新昵称')
    work.platformAccounts = []
    expect(buildXSearchHistory(work)).toEqual([])
  })

  it('关键词和账号在作品内实际搜索；只读和无效排序不产生修改', () => {
    const editor = setup()
    editor.project.appData.x.posts = [{ id: 'post', authorCharacterId: 'person', authorAccountId: 'account', content: '夏天的海边', displayTime: '2026-01-01', metrics: {} }]
    expect(searchX(editor.project, '#夏天').posts.map(row => row.id)).toEqual(['post'])
    expect(searchX(editor.project, '@SUMMER').accounts[0].accountId).toBe('account')
    expect(searchX(editor.project, '不存在')).toEqual({ posts: [], accounts: [] })
    expect(searchX(editor.project, '#')).toEqual({ posts: [], accounts: [] })
    const row = addXSearchRow(editor, 'searchHistory')
    expect(moveXSearchRow(editor, 'searchHistory', row.id, 1)).toBe(false)
    expect(updateXSearchRow(editor, 'searchHistory', row.id, { accountId: 'missing' })).toBe(false)
    editor.readOnlyReason = '另一个窗口正在编辑'
    expect(addXSearchRow(editor, 'trends')).toBeNull()
    expect(updateXSearchRow(editor, 'searchHistory', row.id, { title: '只读' })).toBe(false)
    expect(editor.mutations).toBe(1)
  })
})
