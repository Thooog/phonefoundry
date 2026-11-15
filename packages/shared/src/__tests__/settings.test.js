

import { describe, it, expect } from 'vitest'
import { createProject, createCharacter, createPlatformAccount } from '../factory/index.js'
import { FRAME_MODE } from '../constants/defaults.js'
import { toWorkData } from '../work/to-work-data.js'
import {
  buildSettingsOwner,
  resolveShellMode,
  shouldAutoFullscreen,
  APPLE_ID_SUBTITLE,
} from '../select/settings.js'

/** 建一个"机主 = 林夏"的作品 */
function makeWork(setup) {
  const project = createProject()
  const me = createCharacter({ name: '林夏' })
  project.characters.push(me)
  project.workSettings.ownerCharacterId = me.id
  setup?.(project, me)
  return toWorkData(project)
}

describe('buildSettingsOwner', () => {
  it('副标题是 Apple ID 固定文案，与机主名下有哪些账号无关', () => {
    const withAccounts = makeWork((p, me) => {
      p.platformAccounts.push(
        createPlatformAccount(me.id, 'kakaotalk', { displayName: '林夏' }),
        createPlatformAccount(me.id, 'instagram', { displayName: '夏', handle: 'xiasummer' }),
      )
    })
    const card = buildSettingsOwner(withAccounts)
    expect(card.name).toBe('林夏')
    expect(card.subtitle).toBe('Apple ID、iCloud 等')

    // 没有任何账号也一样 —— 副标题是入口说明，不罗列平台账号
    expect(buildSettingsOwner(makeWork()).subtitle).toBe(APPLE_ID_SUBTITLE)
  })

  it('别人的账号不进机主卡片（副标题不变、头像兜底不看别人的账号）', () => {
    const work = makeWork((p) => {
      const other = createCharacter({ name: '周予安' })
      p.characters.push(other)
      p.platformAccounts.push(
        createPlatformAccount(other.id, 'instagram', { avatarAssetId: 'a_other' }),
      )
    })
    const card = buildSettingsOwner(work)
    expect(card.subtitle).toBe(APPLE_ID_SUBTITLE)
    expect(card.avatarAssetId).toBeNull()
  })

  it('没设机主时 hasOwner 为假，名字与副标题都是空的', () => {
    const project = createProject()
    const work = toWorkData(project)
    const card = buildSettingsOwner(work)
    expect(card.hasOwner).toBe(false)
    expect(card.name).toBe('')
    expect(card.subtitle).toBe('')
  })

  it('头像：角色头像优先，其次机主第一个有头像的账号', () => {
    const byRole = makeWork((p, me) => {
      me.avatarAssetId = 'a_role'
      p.platformAccounts.push(
        createPlatformAccount(me.id, 'instagram', { avatarAssetId: 'a_account' }),
      )
    })
    expect(buildSettingsOwner(byRole).avatarAssetId).toBe('a_role')

    const byAccount = makeWork((p, me) => {
      p.platformAccounts.push(
        createPlatformAccount(me.id, 'kakaotalk', { displayName: '林夏' }),
        createPlatformAccount(me.id, 'instagram', {
          displayName: '夏',
          handle: 'xiasummer',
          avatarAssetId: 'a_account',
        }),
      )
    })
    expect(buildSettingsOwner(byAccount).avatarAssetId).toBe('a_account')

    const none = makeWork()
    expect(buildSettingsOwner(none).avatarAssetId).toBeNull()
  })
})

/**
 * 呈现方式：要么按屏幕宽度自适应，要么永远带外框。
 * 这两个字段是后来加的，所以"旧项目没有它们"是最常见的情况，必须优先测。
 */
describe('resolveShellMode / shouldAutoFullscreen', () => {
  it('默认自适应 —— 外框跟着屏幕宽度走，不自动全屏', () => {
    const work = toWorkData(createProject())
    expect(work.workSettings.frameMode).toBe(FRAME_MODE.AUTO)
    expect(resolveShellMode(work.workSettings)).toBe('auto')
    expect(shouldAutoFullscreen(work.workSettings)).toBe(false)
  })

  it('只有 always 会翻译成 device；不认识的值一律退回自适应', () => {
    const project = createProject()
    project.workSettings.frameMode = FRAME_MODE.ALWAYS
    expect(resolveShellMode(toWorkData(project).workSettings)).toBe('device')

    project.workSettings.frameMode = '全屏幕！'
    expect(resolveShellMode(toWorkData(project).workSettings)).toBe('auto')
  })

  it('自动全屏跟着设置走，缺字段为假', () => {
    const project = createProject()
    project.workSettings.autoFullscreen = true
    expect(shouldAutoFullscreen(toWorkData(project).workSettings)).toBe(true)
    expect(shouldAutoFullscreen(null)).toBe(false)
    expect(shouldAutoFullscreen({})).toBe(false)
  })

  it('旧项目没有这两个字段时，作品数据也会补齐（自适应 + 不全屏）', () => {
    const project = createProject()
    delete project.workSettings.frameMode
    delete project.workSettings.autoFullscreen
    const work = toWorkData(project)
    expect(work.workSettings.frameMode).toBe(FRAME_MODE.AUTO)
    expect(work.workSettings.autoFullscreen).toBe(false)
  })
})
