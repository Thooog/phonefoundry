/**
 * 关注关系网测试 —— buildFollowGraph（X / Instagram 共用）。
 *
 * 核心口径：
 *   · following 读自账号 extraFields.followList（角色 ID 数组）；
 *   · followers 全部由反向遍历得出，不落盘；
 *   · 已删除角色不出现在任何列表里；
 *   · 手填的粉丝数 / 关注数与列表互不干涉（这里不测展示，schema 注释已写明）。
 */

import { describe, it, expect } from 'vitest'
import { createProject, createCharacter, createPlatformAccount } from '../factory/index.js'
import { toWorkData } from '../work/to-work-data.js'
import { buildFollowGraph, followCharacterIds } from '../select/social.js'

function makeWork(setup) {
  const project = createProject()
  setup?.(project)
  return toWorkData(project)
}

describe('followCharacterIds', () => {
  it('只收字符串 ID，脏数据当没填', () => {
    expect(followCharacterIds({ extraFields: { followList: ['c1', 2, null, 'c2'] } })).toEqual(['c1', 'c2'])
    expect(followCharacterIds({ extraFields: { followList: 'c1' } })).toEqual([])
    expect(followCharacterIds({})).toEqual([])
    expect(followCharacterIds(null)).toEqual([])
  })
})

describe('buildFollowGraph', () => {
  it('following 来自 followList，并解析出账号的显示名与 handle', () => {
    const work = makeWork((p) => {
      const a = createCharacter({ name: '林夏' })
      const b = createCharacter({ name: '周予安' })
      p.characters.push(a, b)
      p.platformAccounts.push(
        createPlatformAccount(a.id, 'x', { displayName: '夏', handle: 'xiasummer' }),
        createPlatformAccount(b.id, 'x', { displayName: '予安', handle: 'yuan' }),
      )
      const accA = p.platformAccounts[0]
      accA.extraFields = { ...accA.extraFields, followList: [b.id] }
    })
    const graph = buildFollowGraph(work, 'x', { characterId: work.characters[0].id })
    expect(graph.following).toHaveLength(1)
    expect(graph.following[0]).toMatchObject({
      characterId: work.characters[1].id,
      name: '予安',
      handle: 'yuan',
    })
    expect(graph.followers).toHaveLength(0)
  })

  it('followers 是反向遍历：谁的 followList 里有我，谁就是我的粉丝', () => {
    const work = makeWork((p) => {
      const a = createCharacter({ name: '林夏' })
      const b = createCharacter({ name: '周予安' })
      const c = createCharacter({ name: '陈默' })
      p.characters.push(a, b, c)
      p.platformAccounts.push(
        createPlatformAccount(a.id, 'instagram', { displayName: '夏', handle: 'xiasummer' }),
        createPlatformAccount(b.id, 'instagram', { handle: 'yuan' }),
        createPlatformAccount(c.id, 'instagram', { handle: 'mo' }),
      )
      p.platformAccounts[1].extraFields = { followList: [a.id] }
      p.platformAccounts[2].extraFields = { followList: [a.id, b.id] }
    })
    const graph = buildFollowGraph(work, 'instagram', { characterId: work.characters[0].id })
    expect(graph.following).toHaveLength(0)
    expect(graph.followers.map((r) => r.name).sort()).toEqual(['周予安', '陈默'])
  })

  it('关注与粉丝互不包含自己；平台隔离 —— X 的关注不进 IG 列表', () => {
    const work = makeWork((p) => {
      const a = createCharacter({ name: '林夏' })
      const b = createCharacter({ name: '周予安' })
      p.characters.push(a, b)
      p.platformAccounts.push(
        createPlatformAccount(a.id, 'x', { handle: 'xiasummer' }),
        createPlatformAccount(b.id, 'x', { handle: 'yuan' }),
        createPlatformAccount(a.id, 'instagram', { handle: 'xiasummer' }),
      )
      // b 只在 X 上关注 a；IG 上 b 没有关注关系
      p.platformAccounts[1].extraFields = { followList: [a.id] }
    })
    const xGraph = buildFollowGraph(work, 'x', { characterId: work.characters[0].id })
    expect(xGraph.followers.map((r) => r.characterId)).toEqual([work.characters[1].id])
    const igGraph = buildFollowGraph(work, 'instagram', { characterId: work.characters[0].id })
    expect(igGraph.followers).toHaveLength(0)
  })

  it('指向已删除角色的 followList 条目被丢弃，不出现"未知"行', () => {
    const work = makeWork((p) => {
      const a = createCharacter({ name: '林夏' })
      p.characters.push(a)
      p.platformAccounts.push(createPlatformAccount(a.id, 'x', { handle: 'xiasummer' }))
      p.platformAccounts[0].extraFields = { followList: ['ghost-id', a.id] }
    })
    const graph = buildFollowGraph(work, 'x', { characterId: work.characters[0].id })
    expect(graph.following).toHaveLength(0)
  })

  it('账号不存在时返回空图，不抛错', () => {
    const work = makeWork()
    expect(buildFollowGraph(work, 'x', { accountId: 'nope' })).toEqual({ following: [], followers: [] })
    expect(buildFollowGraph(work, 'x', {})).toEqual({ following: [], followers: [] })
    expect(buildFollowGraph(null, 'x', {})).toEqual({ following: [], followers: [] })
  })

  it('followList 里写了自己也过滤掉', () => {
    const work = makeWork((p) => {
      const a = createCharacter({ name: '林夏' })
      p.characters.push(a)
      p.platformAccounts.push(createPlatformAccount(a.id, 'x', { handle: 'xiasummer' }))
      p.platformAccounts[0].extraFields = { followList: [a.id] }
    })
    const graph = buildFollowGraph(work, 'x', { characterId: work.characters[0].id })
    expect(graph.following).toHaveLength(0)
    expect(graph.followers).toHaveLength(0)
  })
})
