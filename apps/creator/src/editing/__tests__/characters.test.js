import { describe, it, expect } from 'vitest'

import {
  addCharacter,
  addPlatformAccount,
  availablePlatforms,
  removeCharacter,
  removePlatformAccount,
  updateCharacter,
  updatePlatformAccount,
} from '../characters.js'

/**
 * 测试用的 editor 替身。与真实 project store 同一套行为：
 * mutate 把 draft 换上去，调用方不直接改数据。
 * 与其它 editing/*.test.js 保持一致，便于互相参照。
 */
function createEditor(overrides = {}) {
  const editor = {
    project: {
      id: 'prj_test',
      characters: [],
      platformAccounts: [],
      assets: [],
      workSettings: { ownerCharacterId: null },
      appData: {},
      ...overrides,
    },
    mutations: 0,
    mutate(fn) {
      editor.mutations += 1
      const draft = structuredClone(editor.project)
      fn(draft)
      editor.project = draft
    },
  }
  return editor
}

describe('角色与账号：可用平台', () => {
  it('没有账号时四个平台全部可选', () => {
    const editor = createEditor({ characters: [{ id: 'chr_a', name: '林夏' }] })
    expect(availablePlatforms(editor.project, 'chr_a')).toEqual([
      'kakaotalk',
      'instagram',
      'x',
      'messages',
    ])
  })

  it('已配置的平台不再出现在可选列表里', () => {
    const editor = createEditor({
      characters: [{ id: 'chr_a', name: '林夏' }],
      platformAccounts: [
        { id: 'acc_1', characterId: 'chr_a', platform: 'x' },
        { id: 'acc_2', characterId: 'chr_a', platform: 'messages' },
      ],
    })
    expect(availablePlatforms(editor.project, 'chr_a')).toEqual([
      'kakaotalk',
      'instagram',
    ])
  })

  it('只统计该角色的账号，别人的账号不影响（周予安有 IG，林夏仍有 IG 可选）', () => {
    const editor = createEditor({
      characters: [
        { id: 'chr_a', name: '林夏' },
        { id: 'chr_b', name: '周予安' },
      ],
      platformAccounts: [{ id: 'acc_1', characterId: 'chr_b', platform: 'instagram' }],
    })
    expect(availablePlatforms(editor.project, 'chr_a')).toContain('instagram')
    expect(availablePlatforms(editor.project, 'chr_b')).not.toContain('instagram')
  })
})

describe('角色：增改删', () => {
  it('新建角色带出厂默认值，名字留空', () => {
    const editor = createEditor()
    const character = addCharacter(editor)

    expect(editor.project.characters).toHaveLength(1)
    expect(character.name).toBe('')
    expect(character.avatarAssetId).toBeNull()
    expect(character.id).toMatch(/^char_/)
    expect(editor.mutations).toBe(1)
  })

  it('可以带初始值新建（视图里新建后要能填进列表）', () => {
    const editor = createEditor()
    const character = addCharacter(editor, { name: '林夏' })
    expect(character.name).toBe('林夏')
  })

  it('白名单内的字段可以改，且改动会刷新 updatedAt', () => {
    const editor = createEditor()
    const character = addCharacter(editor, { name: '林夏' })
    const before = character.updatedAt

    updateCharacter(editor, character.id, { name: '林夏夏', description: '主角' })
    updateCharacter(editor, character.id, { avatarAssetId: 'ast_1' })

    const updated = editor.project.characters[0]
    expect(updated.name).toBe('林夏夏')
    expect(updated.description).toBe('主角')
    expect(updated.avatarAssetId).toBe('ast_1')
    expect(updated.updatedAt >= before).toBe(true)
  })

  it('白名单外的字段写不进去（id / platform 不能被改坏）', () => {
    const editor = createEditor()
    const character = addCharacter(editor, { name: '林夏' })

    expect(updateCharacter(editor, character.id, { id: 'hacked' })).toBe(false)
    expect(updateCharacter(editor, character.id, { platform: 'hacked' })).toBe(false)
    expect(editor.project.characters[0].id).toBe(character.id)
  })

  it('改不存在的角色返回 false，不报错', () => {
    const editor = createEditor()
    expect(updateCharacter(editor, 'chr_missing', { name: '谁' })).toBe(false)
  })

  it('删除角色时级联删掉它的全部账号', () => {
    const editor = createEditor({
      characters: [
        { id: 'chr_a', name: '林夏' },
        { id: 'chr_b', name: '周予安' },
      ],
      platformAccounts: [
        { id: 'acc_1', characterId: 'chr_a', platform: 'x' },
        { id: 'acc_2', characterId: 'chr_a', platform: 'instagram' },
        { id: 'acc_3', characterId: 'chr_b', platform: 'x' },
      ],
    })

    const result = removeCharacter(editor, 'chr_a')

    expect(result.removedAccounts).toBe(2)
    expect(editor.project.characters.map((c) => c.id)).toEqual(['chr_b'])
    // 别人的账号必须原封不动
    expect(editor.project.platformAccounts.map((a) => a.id)).toEqual(['acc_3'])
  })

  it('删的是所属人时兜底把 owner 置空，不留悬空引用（正常流程应先在视图里拦截）', () => {
    const editor = createEditor({
      characters: [{ id: 'chr_a', name: '林夏' }],
      workSettings: { ownerCharacterId: 'chr_a' },
    })

    removeCharacter(editor, 'chr_a')

    expect(editor.project.workSettings.ownerCharacterId).toBeNull()
  })
})

describe('平台账号：增改删', () => {
  function seed() {
    return createEditor({ characters: [{ id: 'chr_a', name: '林夏' }] })
  }

  it('新建账号归属正确角色与平台，昵称默认空', () => {
    const editor = seed()
    const account = addPlatformAccount(editor, 'chr_a', 'kakaotalk')

    expect(account.characterId).toBe('chr_a')
    expect(account.platform).toBe('kakaotalk')
    expect(account.displayName).toBe('')
    expect(account.id).toMatch(/^acct_/)
  })

  it('一个角色一个平台一个账号：重复添加返回已有的那条，不新增', () => {
    const editor = seed()
    const first = addPlatformAccount(editor, 'chr_a', 'x', { displayName: '夏' })
    const second = addPlatformAccount(editor, 'chr_a', 'x', { displayName: '又来一次' })

    expect(second.id).toBe(first.id)
    expect(editor.project.platformAccounts).toHaveLength(1)
    expect(editor.project.platformAccounts[0].displayName).toBe('夏')
  })

  it('改账号字段：只认该平台 schema 声明的键', () => {
    const editor = seed()
    const account = addPlatformAccount(editor, 'chr_a', 'kakaotalk')

    const changed = updatePlatformAccount(editor, account.id, {
      displayName: '여름',
      handle: 'summer',
      bio: '今天也很热',
    })

    expect(changed).toBe(true)
    const saved = editor.project.platformAccounts[0]
    expect(saved.displayName).toBe('여름')
    expect(saved.handle).toBe('summer')
    expect(saved.bio).toBe('今天也很热')
  })

  it('不属于该平台 schema 的字段会被忽略（KakaoTalk 没有号码）', () => {
    const editor = seed()
    const account = addPlatformAccount(editor, 'chr_a', 'kakaotalk')

    expect(updatePlatformAccount(editor, account.id, { phoneNumber: '1380000' })).toBe(false)
    expect(editor.project.platformAccounts[0].phoneNumber).toBeUndefined()
  })

  it('身份类字段改不动：characterId / platform / id 保持原值', () => {
    const editor = seed()
    const account = addPlatformAccount(editor, 'chr_a', 'x')

    updatePlatformAccount(editor, account.id, {
      characterId: 'chr_b',
      platform: 'instagram',
      id: 'hacked',
    })

    const saved = editor.project.platformAccounts[0]
    expect(saved.characterId).toBe('chr_a')
    expect(saved.platform).toBe('x')
    expect(saved.id).toBe(account.id)
  })

  it('改不存在的账号返回 false', () => {
    const editor = seed()
    expect(updatePlatformAccount(editor, 'acc_missing', { displayName: '谁' })).toBe(false)
  })

  it('删账号只删这一条，角色的其它平台账号不动', () => {
    const editor = seed()
    const x = addPlatformAccount(editor, 'chr_a', 'x')
    const ig = addPlatformAccount(editor, 'chr_a', 'instagram')

    expect(removePlatformAccount(editor, x.id)).toBe(true)
    expect(editor.project.platformAccounts.map((a) => a.id)).toEqual([ig.id])
  })

  it('删不存在的账号返回 false', () => {
    const editor = seed()
    expect(removePlatformAccount(editor, 'acc_missing')).toBe(false)
  })
})
