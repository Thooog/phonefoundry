

import { describe, it, expect } from 'vitest'
import {
  createProject,
  createCharacter,
  createMessage,
  createConversation,
  createPlatformAccount,
  createContact,
  createCallRecord,
  createPost,
  createComment,
  createStory,
} from '../factory/index.js'
import { toWorkData, assertPlain } from '../work/to-work-data.js'
import { validateProject } from '../schema/validate.js'
import { migrateProject } from '../migrate/index.js'
import {
  parseStoryDate,
  formatClock,
  formatDayDivider,
  formatDayDividerStamp,
  dayRelation,
  formatDuration,
  formatPhotoWeekdayTime,
  formatXDetailTime,
  storyToday,
  toDateKey,
} from '../time/format.js'
import { formatXCount } from '../select/feed.js'

describe('toWorkData', () => {
  it('输出可通过 JSON 往返而不变', () => {
    const project = createProject({ name: '测试作品' })
    const work = toWorkData(project)
    const roundTrip = JSON.parse(JSON.stringify(work))
    expect(roundTrip).toEqual(work)
  })

  it('不含编辑态字段', () => {
    const project = createProject()
    project.characters.push(
      createCharacter({ name: '小林', uiCollapsed: true, draft: '草稿' }),
    )
    const work = toWorkData(project)
    const c = work.characters[0]
    expect(c).not.toHaveProperty('uiCollapsed')
    expect(c).not.toHaveProperty('draft')
    expect(c.name).toBe('小林')
  })

  it('信息 / 电话账号的号码要带进作品数据', () => {
    const project = createProject()
    const ch = createCharacter({ name: '林夏' })
    project.characters.push(ch)
    project.platformAccounts.push(
      createPlatformAccount(ch.id, 'messages', { phoneNumber: '138 0013 8000' }),
    )
    const account = toWorkData(project).platformAccounts[0]
    expect(account.phoneNumber).toBe('138 0013 8000')
  })

  it('标题优先取手机名', () => {
    const project = createProject({ name: '项目名' })
    project.workSettings.phoneName = '小林の手机'
    expect(toWorkData(project).title).toBe('小林の手机')
  })

  it('标题回退到项目名', () => {
    const project = createProject({ name: '项目名' })
    expect(toWorkData(project).title).toBe('项目名')
  })

  it('关闭密码时不携带密码串', () => {
    const project = createProject()
    project.workSettings.passcodeEnabled = false
    project.workSettings.passcode = '1234'
    expect(toWorkData(project).workSettings.passcode).toBe('')
  })

  it('八个应用的数据桶都存在', () => {
    const work = toWorkData(createProject())
    const keys = Object.keys(work.appData)
    expect(keys).toContain('photos')
    expect(keys).toContain('kakaotalk')
    expect(keys).toContain('notes')
    expect(keys).toContain('settings')
    expect(keys).toHaveLength(8)
  })
})

describe('assertPlain', () => {
  it('普通对象通过', () => {
    expect(() => assertPlain({ a: 1, b: [1, 2] })).not.toThrow()
  })

  it('函数会被拒绝', () => {
    expect(() => assertPlain({ fn: () => {} })).toThrow(/函数/)
  })

  it('类实例会被拒绝', () => {
    class Foo {}
    expect(() => assertPlain({ foo: new Foo() })).toThrow(/非纯对象/)
  })
})

describe('toWorkData：值为 undefined 的键不进作品数据', () => {
  it('评论/回复没有 mediaAssetIds 字段时不会带上 undefined（回归）', () => {
    const project = createProject()
    // 旧版本复制 / 导入项目会给每条回复补一个 `mediaAssetIds: undefined`，
    // 这份数据以前能存进 IndexedDB，却导不出去 —— assertPlain 整份拒收
    project.appData.x.replies = [{ ...createComment('post_1'), mediaAssetIds: undefined }]

    const work = toWorkData(project)
    const reply = work.appData.x.replies[0]

    expect(Object.prototype.hasOwnProperty.call(reply, 'mediaAssetIds')).toBe(false)
    expect(() => assertPlain(work)).not.toThrow()
    // 其余字段一个都不能丢
    expect(reply.content).toBe('')
    expect(reply.parentId).toBe('post_1')
  })
})

describe('validateProject', () => {
  it('合法项目通过', () => {
    const result = validateProject(createProject())
    expect(result.ok).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('缺角色列表时报错', () => {
    const project = createProject()
    delete project.characters
    const result = validateProject(project)
    expect(result.ok).toBe(false)
    expect(result.errors.join('')).toContain('角色列表')
  })

  it('所属人不存在时给出警告而不是错误', () => {
    const project = createProject()
    project.workSettings.ownerCharacterId = 'char_not_exist'
    const result = validateProject(project)
    expect(result.ok).toBe(true)
    expect(result.warnings.join('')).toContain('所属人')
  })
})

describe('migrateProject', () => {
  it('当前版本原样返回', () => {
    const project = createProject()
    expect(migrateProject(project)).toBe(project)
  })

  it('缺版本号时报可读错误', () => {
    expect(() => migrateProject({ name: 'x' })).toThrow(/version/i)
  })

  it('版本过高时拒绝而不是静默清空', () => {
    expect(() => migrateProject({ schemaVersion: 99 })).toThrow(/高于/)
  })

  it('非对象输入报错', () => {
    expect(() => migrateProject(null)).toThrow(/空或格式不正确/)
  })

  it('缺少中间版本的迁移规则时报错（不跳级）', () => {
    // 目标是 v3，但只提供了 1→2，没有 2→3
    const project = { schemaVersion: 1 }
    const migrations = { 1: (p) => ({ ...p, schemaVersion: 2 }) }
    expect(() => migrateProject(project, { targetVersion: 3, migrations })).toThrow(/缺少从 v2 到 v3/)
  })

  it('迁移函数忘了改版本号时报错', () => {
    const project = { schemaVersion: 1 }
    const migrations = { 1: (p) => ({ ...p, added: true }) } // 忘了 schemaVersion: 2
    expect(() => migrateProject(project, { targetVersion: 2, migrations })).toThrow(/未正确更新版本号/)
  })
})

// ───────────────────── 迁移框架（机制验证，不含真实业务迁移） ─────────────────────

describe('迁移框架：逐级升级链路本身是通的', () => {
  /**
   * 说明为什么测这个：
   *   这一段测的是**迁移框架的机械正确性**，与具体业务迁移无关：
   *   注入假迁移，看它能否真的逐级升到位。
   *   第一个真实迁移（v1→v2 合并 phone 账号）已在上面单独验证。
   */
  it('跨两个版本时逐级执行，且每级都拿到上一级的产物', () => {
    const steps = []
    const migrations = {
      1: (p) => {
        steps.push('1→2')
        return { ...p, schemaVersion: 2, fieldB: (p.fieldA ?? 0) + 1 }
      },
      2: (p) => {
        steps.push('2→3')
        return { ...p, schemaVersion: 3, fieldC: (p.fieldB ?? 0) + 1 }
      },
    }
    const result = migrateProject({ schemaVersion: 1, fieldA: 10 }, { targetVersion: 3, migrations })

    expect(steps).toEqual(['1→2', '2→3'])
    expect(result.schemaVersion).toBe(3)
    // 后一级确实接收了前一级的产物，而不是各自基于原始输入
    expect(result.fieldB).toBe(11)
    expect(result.fieldC).toBe(12)
  })

  it('迁移函数不得修改入参（纯函数要求）', () => {
    const original = { schemaVersion: 1, fieldA: 1 }
    const migrations = { 1: (p) => ({ ...p, schemaVersion: 2 }) }
    migrateProject(original, { targetVersion: 2, migrations })
    expect(original.schemaVersion).toBe(1)
  })

  it('顺序升级不会把已是最新的数据再升一遍', () => {
    const project = { schemaVersion: 3 }
    const migrations = {
      1: () => {
        throw new Error('不该被调用')
      },
      2: () => {
        throw new Error('不该被调用')
      },
    }
    expect(migrateProject(project, { targetVersion: 3, migrations })).toBe(project)
  })

  it('生产路径：不传 options 时使用内置 SCHEMA_VERSION 与内置迁移表', () => {
    // 当前内置版本为 2，v1 数据自动升级、v3 数据被拒
    expect(migrateProject({ schemaVersion: 1 })).toBeTruthy()
    expect(migrateProject({ schemaVersion: 2 })).toBeTruthy()
    expect(() => migrateProject({ schemaVersion: 3 })).toThrow(/高于/)
  })

  it('v1→v2：独立 phone 账号并入同角色 messages 账号（信息侧优先，空位补齐）', () => {
    const project = {
      schemaVersion: 1,
      platformAccounts: [
        { id: 'acc_1', characterId: 'chr_a', platform: 'messages', displayName: '夏夏', avatarAssetId: null, phoneNumber: '' },
        // 同角色的电话账号：displayName 让位信息侧，号码 / 备注是空位要补进去
        { id: 'acc_2', characterId: 'chr_a', platform: 'phone', displayName: '林夏', phoneNumber: '139 1111 1111', note: '表姐' },
        // 只有电话账号的角色：整体改挂 messages，字段原样保留
        { id: 'acc_3', characterId: 'chr_b', platform: 'phone', displayName: '予安' },
      ],
    }
    const result = migrateProject(project)

    expect(result.schemaVersion).toBe(2)
    expect(result.platformAccounts).toHaveLength(2)
    expect(result.platformAccounts.every((a) => a.platform === 'messages')).toBe(true)
    const merged = result.platformAccounts.find((a) => a.id === 'acc_1')
    expect(merged.displayName).toBe('夏夏')
    expect(merged.phoneNumber).toBe('139 1111 1111')
    expect(merged.note).toBe('表姐')
    expect(result.platformAccounts.find((a) => a.id === 'acc_3').platform).toBe('messages')
    // 纯函数：入参里的旧数据不动
    expect(project.platformAccounts.find((a) => a.id === 'acc_2').platform).toBe('phone')
  })
})

describe('storyDate 时间语义', () => {
  it('解析合法日期', () => {
    const d = parseStoryDate('2026-05-03')
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(4)
    expect(d.getDate()).toBe(3)
  })

  it('拒绝不存在的日期', () => {
    expect(parseStoryDate('2026-02-31')).toBeNull()
    expect(parseStoryDate('2026-13-01')).toBeNull()
    expect(parseStoryDate('')).toBeNull()
    expect(parseStoryDate(null)).toBeNull()
  })

  it('storyDate 缺失时回退真实今天', () => {
    const today = storyToday(null)
    expect(toDateKey(today)).toBe(toDateKey(new Date()))
  })

  it('storyDate 决定"今天"，而不是真实今天', () => {
    const storyDate = '2026-05-03'
    const d = parseStoryDate(storyDate)
    expect(dayRelation(d, storyDate)).toBe('today')
    expect(formatDayDivider(d, storyDate)).toBe('今天')
  })

  it('相对 storyDate 的前一天是"昨天"', () => {
    const storyDate = '2026-05-03'
    const prev = new Date(2026, 4, 2)
    expect(formatDayDivider(prev, storyDate)).toBe('昨天')
  })

  it('跨年日期带年份', () => {
    const storyDate = '2026-05-03'
    const old = new Date(2025, 11, 25)
    expect(formatDayDivider(old, storyDate)).toBe('2025年12月25日')
  })
})

describe('formatDayDividerStamp：日期与时刻合成一句', () => {
  const storyDate = '2026-05-03'

  it('今天 / 昨天只给相对词（时刻由消息间的提示补）', () => {
    expect(formatDayDividerStamp(new Date(2026, 4, 3, 9, 5), storyDate)).toBe('今天')
    expect(formatDayDividerStamp(new Date(2026, 4, 2, 15, 17), storyDate)).toBe('昨天')
  })

  it('同年更早：月日 + 时刻，不写年份', () => {
    expect(formatDayDividerStamp(new Date(2026, 3, 18, 15, 17), storyDate)).toBe('4月18日 15:17')
  })

  it('跨年：年份、月日与时刻都在同一行', () => {
    expect(formatDayDividerStamp(new Date(2025, 11, 25, 8, 3), storyDate)).toBe('2025年12月25日 8:03')
  })
})

describe('formatClock', () => {
  it('24 小时制补零', () => {
    expect(formatClock(new Date(2026, 0, 1, 9, 5), 'h24')).toBe('09:05')
  })

  it('12 小时制不带 AM/PM 且 0 点显示 12', () => {
    expect(formatClock(new Date(2026, 0, 1, 0, 30), 'h12')).toBe('12:30')
    expect(formatClock(new Date(2026, 0, 1, 13, 7), 'h12')).toBe('1:07')
  })
})

describe('formatDuration', () => {
  it('秒转 mm:ss', () => {
    expect(formatDuration(210)).toBe('3:30')
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(65)).toBe('1:05')
  })

  it('非法值回退 0:00', () => {
    expect(formatDuration(null)).toBe('0:00')
    expect(formatDuration(-5)).toBe('0:00')
  })
})

describe('formatPhotoWeekdayTime', () => {
  it('输出「星期几 时:分」', () => {
    expect(formatPhotoWeekdayTime(new Date(2026, 9, 28, 13, 39, 0), { timeFormat: 'h24' })).toBe(
      '星期三 13:39',
    )
    expect(formatPhotoWeekdayTime(new Date(2026, 9, 28, 13, 39, 0), { timeFormat: 'h12' })).toBe(
      '星期三 1:39',
    )
  })

  it('接收 ISO 字符串', () => {
    const iso = new Date(2026, 6, 14, 20, 30, 0).toISOString()
    expect(formatPhotoWeekdayTime(iso, { timeFormat: 'h24' })).toBe('星期二 20:30')
  })

  it('不带年份与月日 —— 主图已经说明拍的是什么', () => {
    expect(formatPhotoWeekdayTime(new Date(2026, 0, 1, 9, 5, 0))).toBe('星期四 09:05')
  })

  it('非法时间返回空串', () => {
    expect(formatPhotoWeekdayTime('')).toBe('')
    expect(formatPhotoWeekdayTime(null)).toBe('')
    expect(formatPhotoWeekdayTime('不是时间')).toBe('')
  })
})

describe('聊天会话派生', () => {
  it('会话列表按最后消息时间倒序', () => {
    const project = createProject()
    const convA = createConversation('kakaotalk', { title: 'A' })
    const convB = createConversation('kakaotalk', { title: 'B' })
    project.appData.kakaotalk.conversations.push(convA, convB)
    project.appData.kakaotalk.messages.push(
      createMessage(convA.id, { content: '早', displayTime: '2026-05-01T08:00:00.000Z' }),
      createMessage(convB.id, { content: '晚', displayTime: '2026-05-02T08:00:00.000Z' }),
    )
    const work = toWorkData(project)
    const list = buildConversationListSafe(work, 'kakaotalk')
    expect(list[0].title).toBe('B')
    expect(list[1].title).toBe('A')
  })

  it('未知应用返回空列表而不是报错', () => {
    const work = toWorkData(createProject())
    expect(buildConversationListSafe(work, 'not_an_app')).toEqual([])
  })

  it('会话无消息时预览显示暂无消息', () => {
    const project = createProject()
    const conv = createConversation('messages', { title: '空会话' })
    project.appData.messages.conversations.push(conv)
    const list = buildConversationListSafe(toWorkData(project), 'messages')
    expect(list[0].preview).toBe('暂无消息')
    expect(list[0].timeLabel).toBe('')
  })

  it('单人会话的标题取对方名字，不把我自己拼进去', () => {
    const project = createProject()
    const me = createCharacter({ name: '林夏', avatarAssetId: 'asset_me' })
    const peer = createCharacter({ name: '周予安', avatarAssetId: 'asset_peer' })
    project.characters.push(me, peer)
    const conv = createConversation('messages', { participantIds: [me.id, peer.id] })
    project.appData.messages.conversations.push(conv)

    const work = toWorkData(project)
    const withOwner = buildConversationListSafe(work, 'messages', { ownerCharacterId: me.id })
    expect(withOwner[0].title).toBe('周予安')
    // 头像也不能是自己的
    expect(withOwner[0].avatarAssetId).toBe('asset_peer')

    // 不传所属人时退回"拼所有参与者"——编辑端不关心名字，不能因此崩
    const withoutOwner = buildConversationListSafe(work, 'messages')
    expect(withoutOwner[0].title).toBe('林夏、周予安')
  })

  it('多人会话保留所有参与者名字，只去掉我', () => {
    const project = createProject()
    const me = createCharacter({ name: '林夏' })
    const a = createCharacter({ name: '周予安' })
    const b = createCharacter({ name: '陈默' })
    project.characters.push(me, a, b)
    const conv = createConversation('messages', { participantIds: [me.id, a.id, b.id] })
    project.appData.messages.conversations.push(conv)

    const list = buildConversationListSafe(toWorkData(project), 'messages', {
      ownerCharacterId: me.id,
    })
    expect(list[0].title).toBe('周予安、陈默')
  })

  it('显式标题优先于参与者拼接', () => {
    const project = createProject()
    const me = createCharacter({ name: '林夏' })
    const peer = createCharacter({ name: '周予安' })
    project.characters.push(me, peer)
    const conv = createConversation('messages', {
      title: '摄影社',
      participantIds: [me.id, peer.id],
    })
    project.appData.messages.conversations.push(conv)

    const list = buildConversationListSafe(toWorkData(project), 'messages', {
      ownerCharacterId: me.id,
    })
    expect(list[0].title).toBe('摄影社')
  })
})

// 延迟导入避免循环依赖困扰
import { buildConversationList as buildConversationListSafe } from '../select/chat.js'
import { buildThread as buildThreadSafe } from '../select/chat.js'

describe('已读回执', () => {
  /** 造一条"我发的"消息，readAt 原样透传；时间不带时区后缀，避免断言随机器时区漂移 */
  function seedThread(readAt) {
    const project = createProject()
    const me = createCharacter({ name: '林夏' })
    const peer = createCharacter({ name: '周予安' })
    project.characters.push(me, peer)
    const conv = createConversation('messages', { participantIds: [me.id, peer.id] })
    project.appData.messages.conversations.push(conv)
    project.appData.messages.messages.push(
      createMessage(conv.id, {
        senderCharacterId: me.id,
        content: '我到了',
        displayTime: '2026-05-02T12:00:00',
        readAt,
      }),
    )
    const work = toWorkData(project)
    return buildThreadSafe(work, conv.id, { ownerCharacterId: me.id })
  }

  const firstMessage = (thread) => thread.find((item) => item.kind === 'message')

  it('填了 readAt 就派生「已读时刻 已读」', () => {
    const thread = seedThread('2026-05-02T12:07:00')
    expect(firstMessage(thread).readLabel).toBe('12:07 已读')
  })

  it('没填 readAt 时 readLabel 是空串，读取端据此不渲染', () => {
    const thread = seedThread(null)
    expect(firstMessage(thread).readLabel).toBe('')
  })

  it('readAt 是脏值时同样留空，不显示 Invalid Date', () => {
    const thread = seedThread('不是时间')
    expect(firstMessage(thread).readLabel).toBe('')
  })
})

describe('电话通讯录派生', () => {
  it('显式联系人直接出现，并带出关联角色', () => {
    const project = createProject()
    const ch = createCharacter({ name: '林夏' })
    project.characters.push(ch)
    project.appData.phone.contacts.push(
      createContact({ characterId: ch.id, name: '林夏', phoneNumber: '138 0000 0000' }),
    )

    const list = buildContactsSafe(toWorkData(project))
    expect(list).toHaveLength(1)
    expect(list[0].characterId).toBe(ch.id)
    expect(list[0].phoneNumber).toBe('138 0000 0000')
  })

  it('角色只有信息 / 电话账号时自动派生联系人', () => {
    const project = createProject()
    const ch = createCharacter({ name: '周予安' })
    project.characters.push(ch)
    project.platformAccounts.push(
      createPlatformAccount(ch.id, 'messages', { displayName: '予安', phoneNumber: '139 1111 1111' }),
    )

    const list = buildContactsSafe(toWorkData(project))
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('予安')
    expect(list[0].characterId).toBe(ch.id)
  })

  it('同一角色既有显式联系人又有账号时只出现一次', () => {
    const project = createProject()
    const ch = createCharacter({ name: '周予安' })
    project.characters.push(ch)
    project.platformAccounts.push(
      createPlatformAccount(ch.id, 'messages', { displayName: '予安' }),
    )
    project.appData.phone.contacts.push(
      createContact({ characterId: ch.id, name: '周予安' }),
    )

    const list = buildContactsSafe(toWorkData(project))
    expect(list).toHaveLength(1)
    // 显式录入的名字优先（用户手填的覆盖账号昵称）
    expect(list[0].name).toBe('周予安')
  })

  it('按拼音首字母分组：中文取拼音、英文取首字母，组序 A→Z 再 #', () => {
    const groups = groupContactsByInitialSafe([
      { name: '周予安' },
      { name: '陈默' },
      { name: 'amy' },
      { name: '王阿姨' },
      { name: '3M' },
    ])
    const letters = groups.map((g) => g.letter)
    expect(letters).toEqual(['A', 'C', 'W', 'Z', '#'])
    // 中英文同组：amy 和艾叶青都在 A
    const groupA = groupContactsByInitialSafe([
      { name: 'amy' },
      { name: '艾叶青' },
    ])
    expect(groupA).toHaveLength(1)
    expect(groupA[0].items).toHaveLength(2)
  })

  it('拼音首字母：多音姓氏按姓氏读音，非汉字归 #', () => {
    expect(initialOfSafe('周予安')).toBe('Z')
    expect(initialOfSafe('王阿姨')).toBe('W')
    expect(initialOfSafe('妈妈')).toBe('M')
    // 姓氏读 zēng / shàn，不是字典音 céng / dān
    expect(initialOfSafe('曾小贤')).toBe('Z')
    expect(initialOfSafe('单雄信')).toBe('S')
    expect(initialOfSafe('kate')).toBe('K')
    expect(initialOfSafe('3M')).toBe('#')
    expect(initialOfSafe('')).toBe('#')
  })

  it('通话记录能解析派生联系人的名字，未接来电不显示时长', () => {
    const project = createProject()
    const ch = createCharacter({ name: '周予安' })
    project.characters.push(ch)
    const account = createPlatformAccount(ch.id, 'messages', { displayName: '予安' })
    project.platformAccounts.push(account)
    project.appData.phone.calls.push(
      createCallRecord(account.id, { type: 'missed', displayTime: '2026-05-02T10:00:00.000Z' }),
    )

    const rows = buildCallLogSafe(toWorkData(project), { storyDate: '2026-05-03' })
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('予安')
    expect(rows[0].typeLabel).toBe('未接来电')
    expect(rows[0].durationLabel).toBe('')
  })

  it('通话记录带上号码（最近通话要显示呼出/呼入的号码）', () => {
    const project = createProject()
    project.appData.phone.contacts.push(
      createContact({ name: '陈默', phoneNumber: '137 0013 7000' }),
    )
    const contact = project.appData.phone.contacts[0]
    project.appData.phone.calls.push(
      createCallRecord(contact.id, { type: 'outgoing', displayTime: '2026-05-02T10:00:00.000Z' }),
    )

    const rows = buildCallLogSafe(toWorkData(project), { storyDate: '2026-05-03' })
    expect(rows[0].phoneNumber).toBe('137 0013 7000')
    // 回拨要用同一个号码，不能从通话记录里取（那条是空串）
    expect(rows[0].dialNumber).toBe('137 0013 7000')
  })

  it('不在通讯录的号码：号码本身当标题，副标题留给「来电/未接来电」', () => {
    const project = createProject()
    project.appData.phone.calls.push(
      createCallRecord(null, {
        phoneNumber: '13800138000',
        type: 'missed',
        displayTime: '2026-05-02T10:00:00.000Z',
      }),
    )

    const rows = buildCallLogSafe(toWorkData(project), { storyDate: '2026-05-03' })
    expect(rows[0].name).toBe('138 0013 8000')
    expect(rows[0].stranger).toBe(true)
    // 号码已经在标题上了，副标题再写一遍会重复；但回拨仍要拿得到它
    expect(rows[0].phoneNumber).toBe('')
    expect(rows[0].dialNumber).toBe('13800138000')
    expect(rows[0].typeLabel).toBe('未接来电')
  })

  it('既没联系人也没号码才算「未知号码」', () => {
    const project = createProject()
    project.appData.phone.calls.push(
      createCallRecord(null, { type: 'incoming', displayTime: '2026-05-02T10:00:00.000Z' }),
    )

    const rows = buildCallLogSafe(toWorkData(project), { storyDate: '2026-05-03' })
    expect(rows[0].name).toBe('未知号码')
    expect(rows[0].stranger).toBe(true)
    // 无号可拨：界面据此不接回拨
    expect(rows[0].dialNumber).toBe('')
  })

  it('联系人还在时，号码字段永远以联系人为准（不理 call.phoneNumber）', () => {
    const project = createProject()
    project.appData.phone.contacts.push(
      createContact({ name: '陈默', phoneNumber: '137 0013 7000' }),
    )
    const contact = project.appData.phone.contacts[0]
    project.appData.phone.calls.push(
      createCallRecord(contact.id, {
        // 脏数据：两个归属同时存在时，通讯录优先
        phoneNumber: '13900139000',
        displayTime: '2026-05-02T10:00:00.000Z',
      }),
    )

    const rows = buildCallLogSafe(toWorkData(project), { storyDate: '2026-05-03' })
    expect(rows[0].name).toBe('陈默')
    expect(rows[0].stranger).toBe(false)
    expect(rows[0].phoneNumber).toBe('137 0013 7000')
    expect(rows[0].dialNumber).toBe('137 0013 7000')
  })

  it('回拨号码也能从角色账号派生的联系人身上取到', () => {
    const project = createProject()
    const ch = createCharacter({ name: '周予安' })
    project.characters.push(ch)
    const account = createPlatformAccount(ch.id, 'messages', {
      phoneNumber: '139 0013 9000',
    })
    project.platformAccounts.push(account)
    project.appData.phone.calls.push(
      createCallRecord(account.id, { type: 'incoming', displayTime: '2026-05-02T10:00:00.000Z' }),
    )

    const rows = buildCallLogSafe(toWorkData(project), { storyDate: '2026-05-03' })
    expect(rows[0].name).toBe('周予安')
    expect(rows[0].dialNumber).toBe('139 0013 9000')
  })
})

describe('拨号键盘', () => {
  it('输入按 3+4+4 分组显示（国内号码的 iOS 写法）', () => {
    expect(formatDialNumberSafe('1')).toBe('1')
    expect(formatDialNumberSafe('1897')).toBe('189 7')
    expect(formatDialNumberSafe('13900139000')).toBe('139 0013 9000')
  })

  it('非数字字符被丢掉，空输入不炸', () => {
    expect(formatDialNumberSafe('12-3')).toBe('123')
    expect(formatDialNumberSafe('')).toBe('')
    expect(formatDialNumberSafe(null)).toBe('')
  })

  it('输到 4 位以上才按号码反查联系人', () => {
    const contacts = [{ id: 'c1', name: '陈默', phoneNumber: '137 0013 7000' }]
    expect(matchContactByDigitsSafe(contacts, '137')).toBeNull()
    expect(matchContactByDigitsSafe(contacts, '7000')?.name).toBe('陈默')
    // 完整号码也能认（带不带空格都一样）
    expect(matchContactByDigitsSafe(contacts, '13700137000')?.name).toBe('陈默')
    expect(matchContactByDigitsSafe([], '7000')).toBeNull()
  })
})

describe('我的名片（buildMyCard）', () => {
  it('机主信息全部来自「信息·电话」账号，且字段形状与联系人一致', () => {
    const project = createProject()
    const ch = createCharacter({ name: '林夏', avatarAssetId: 'a_char' })
    project.characters.push(ch)
    project.workSettings.ownerCharacterId = ch.id
    project.platformAccounts.push(
      createPlatformAccount(ch.id, 'messages', {
        displayName: '夏夏',
        avatarAssetId: 'a_account',
        phoneNumber: '138 0013 8000',
        email: 'xia@example.com',
        note: '本机号码',
      }),
    )

    const card = buildMyCardSafe(toWorkData(project))
    expect(card).toMatchObject({
      hasOwner: true,
      characterId: ch.id,
      name: '夏夏',
      avatarAssetId: 'a_account',
      phoneNumber: '138 0013 8000',
      email: 'xia@example.com',
      note: '本机号码',
    })
    // 派生是只读的：列表里那条机主派生联系人仍是 buildContacts 自己的形状，不受名片影响
    const listed = buildContactsSafe(toWorkData(project))
    expect(listed.find((c) => c.characterId === ch.id)?.phoneNumber).toBe('138 0013 8000')
    expect(card).not.toHaveProperty('id') // 名片不是列表行，没有联系人 id
  })

  it('没设机主时给占位，且不把「无归属联系人」误当成机主', () => {
    const project = createProject()
    project.appData.phone.contacts.push(
      createContact({ name: '房东', phoneNumber: '135 0013 5000' }),
    )
    const card = buildMyCardSafe(toWorkData(project))
    expect(card).toEqual({
      hasOwner: false,
      characterId: null,
      name: '我的名片',
      avatarAssetId: null,
      phoneNumber: '',
      email: '',
      note: '',
    })
  })

  it('只有角色没账号时退到角色姓名与头像', () => {
    const project = createProject()
    const ch = createCharacter({ name: '林夏', avatarAssetId: 'a_face' })
    project.characters.push(ch)
    project.workSettings.ownerCharacterId = ch.id

    const card = buildMyCardSafe(toWorkData(project))
    expect(card.name).toBe('林夏')
    expect(card.avatarAssetId).toBe('a_face')
    expect(card.phoneNumber).toBe('')
  })

  it('机主也被录进通讯录时，用那条记录补账号里空着的号码与备注', () => {
    const project = createProject()
    const ch = createCharacter({ name: '林夏' })
    project.characters.push(ch)
    project.workSettings.ownerCharacterId = ch.id
    project.platformAccounts.push(
      createPlatformAccount(ch.id, 'messages', { displayName: '林夏' }),
    )
    project.appData.phone.contacts.push(
      createContact({ characterId: ch.id, name: '林夏', phoneNumber: '139 0000 0000', note: '我' }),
    )

    const card = buildMyCardSafe(toWorkData(project))
    expect(card.name).toBe('林夏')
    expect(card.phoneNumber).toBe('139 0000 0000')
    expect(card.note).toBe('我')
  })
})

import {
  buildContacts as buildContactsSafe,
  buildMyCard as buildMyCardSafe,
  groupContactsByInitial as groupContactsByInitialSafe,
  initialOf as initialOfSafe,
  buildCallLog as buildCallLogSafe,
  formatDialNumber as formatDialNumberSafe,
  matchContactByDigits as matchContactByDigitsSafe,
} from '../select/phone.js'

import { buildPostDetail as buildPostDetailSafe } from '../select/feed.js'
import { buildStoryTray as buildStoryTraySafe } from '../select/instagram.js'

describe('X 详情 meta 行的时间与计数口径', () => {
  it('formatXDetailTime 永远给全日期（年份两位 + 逗号），不做今天/昨天折算', () => {
    // 无 storyDate：直接按绝对日期出
    expect(formatXDetailTime('2026-11-13T09:42:00.000Z')).toMatch(/^26年11月1[34]日, \d{2}:\d{2}$/)
    // UTC 17:42 → 北京时间次日，年份/日期都要按本地时区算
    expect(formatXDetailTime('2025-03-01T17:42:00.000Z', { timeFormat: 'h24' })).toBe(
      '25年3月2日, 01:42',
    )
  })

  it('formatXCount 用 K/M 口径（真机 X 中文版不本地化单位），IG 的 formatCount 保持「万」', () => {
    expect(formatXCount(0)).toBe('0')
    expect(formatXCount(980)).toBe('980')
    expect(formatXCount(1900)).toBe('1.9K')
    expect(formatXCount(18000)).toBe('18K')
    expect(formatXCount(196000)).toBe('196K')
    expect(formatXCount(999949)).toBe('999.9K')
    expect(formatXCount(999950)).toBe('1M')
    expect(formatXCount(2500000)).toBe('2.5M')
  })
})

describe('帖子详情：回复按对话排列', () => {
  function workWithReplies() {
    const project = createProject()
    const ch = createCharacter({ name: '林夏' })
    project.characters.push(ch)
    const post = createPost('x', {
      authorCharacterId: ch.id,
      displayTime: '2026-05-01T10:00:00.000Z',
      content: '正文',
    })
    project.appData.x.posts.push(post)

    const r1 = createComment(post.id, {
      authorCharacterId: ch.id,
      displayTime: '2026-05-01T10:01:00.000Z',
      content: 'A',
    })
    const r2 = createComment(r1.id, {
      authorCharacterId: ch.id,
      displayTime: '2026-05-01T10:02:00.000Z',
      content: 'A2',
    })
    const r3 = createComment(post.id, {
      authorCharacterId: ch.id,
      displayTime: '2026-05-01T10:03:00.000Z',
      content: 'B',
    })
    project.appData.x.replies.push(r1, r2, r3)
    return { work: toWorkData(project), postId: post.id, rootReplyId: r1.id }
  }

  it('回复的回复跟在父回复后面，并标成同一条对话', () => {
    const { work, postId, rootReplyId } = workWithReplies()
    const detail = buildPostDetailSafe(work, 'x', postId, { storyDate: '2026-05-02' })

    expect(detail.comments.map((c) => c.content)).toEqual(['A', 'A2', 'B'])
    // 只有顶层回复开新对话 —— 详情页据此决定哪里画分隔线
    expect(detail.comments.map((c) => c.threadStart)).toEqual([true, false, true])
    // 对话的最后一条不画竖线
    expect(detail.comments.map((c) => c.threadEnd)).toEqual([false, true, true])
    expect(detail.comments[1].threadId).toBe(rootReplyId)
  })

  it('每条回复带上作者角色 ID（详情页点头像进作者主页要用）', () => {
    const { work, postId } = workWithReplies()
    const detail = buildPostDetailSafe(work, 'x', postId, { storyDate: '2026-05-02' })

    const characterId = work.characters[0].id
    expect(detail.comments.map((c) => c.authorCharacterId)).toEqual([
      characterId,
      characterId,
      characterId,
    ])
  })

  it('父级被删掉的回复照样出现，不会静默消失', () => {
    const project = createProject()
    const ch = createCharacter({ name: '林夏' })
    project.characters.push(ch)
    const post = createPost('x', { authorCharacterId: ch.id, content: '正文' })
    project.appData.x.posts.push(post)
    project.appData.x.replies.push(
      createComment('不存在的父级', { authorCharacterId: ch.id, content: '孤儿回复' }),
    )

    const detail = buildPostDetailSafe(toWorkData(project), 'x', post.id)
    expect(detail.comments).toHaveLength(1)
    expect(detail.comments[0].content).toBe('孤儿回复')
    expect(detail.comments[0].threadStart).toBe(true)
    expect(detail.comments[0].threadEnd).toBe(true)
  })

  it('别的帖子的评论不会串门：详情页只显示本帖的（Instagram 两篇帖子暴露过）', () => {
    const project = createProject()
    const ch = createCharacter({ name: '林夏' })
    project.characters.push(ch)
    const p1 = createPost('instagram', { authorCharacterId: ch.id, content: '帖子一' })
    const p2 = createPost('instagram', { authorCharacterId: ch.id, content: '帖子二' })
    project.appData.instagram.posts.push(p1, p2)
    project.appData.instagram.comments.push(
      createComment(p1.id, { authorCharacterId: ch.id, content: '一楼的评论' }),
      createComment(p2.id, { authorCharacterId: ch.id, content: '二楼的评论' }),
    )
    const work = toWorkData(project)

    expect(buildPostDetailSafe(work, 'instagram', p1.id).comments.map((c) => c.content)).toEqual([
      '一楼的评论',
    ])
    expect(buildPostDetailSafe(work, 'instagram', p2.id).comments.map((c) => c.content)).toEqual([
      '二楼的评论',
    ])
  })
})

describe('Instagram 故事托盘', () => {
  function workWithStories() {
    const project = createProject()
    const ch = createCharacter({ name: '林夏' })
    const other = createCharacter({ name: '周予安' })
    project.characters.push(ch, other)
    project.appData.instagram.stories.push(
      createStory({
        authorCharacterId: ch.id,
        imageAssetId: 'ast_a1',
        displayTime: '2026-05-01T10:00:00.000Z',
      }),
      createStory({
        authorCharacterId: ch.id,
        imageAssetId: 'ast_a2',
        displayTime: '2026-05-01T09:00:00.000Z',
      }),
      createStory({
        authorCharacterId: other.id,
        imageAssetId: 'ast_b1',
        displayTime: '2026-05-01T08:00:00.000Z',
        seen: true,
      }),
    )
    return { project, ch, other }
  }

  it('同一个人的多帧合成一组，组内按时间正序（播放顺序）', () => {
    const { project } = workWithStories()
    const tray = buildStoryTraySafe(toWorkData(project), { storyDate: '2026-05-02' })

    const me = tray.find((g) => g.author.name === '林夏')
    expect(tray).toHaveLength(2)
    expect(me.frames.map((f) => f.imageAssetId)).toEqual(['ast_a2', 'ast_a1'])
  })

  it('没有图的帧不进托盘（否则播放器里是一张破图）', () => {
    const { project, ch } = workWithStories()
    // 创作端允许先建帧再补图，这些半成品帧不能在作品里露出来
    project.appData.instagram.stories.push(
      createStory({ authorCharacterId: ch.id, imageAssetId: null, caption: '还没配图' }),
    )
    const tray = buildStoryTraySafe(toWorkData(project), { storyDate: '2026-05-02' })

    const me = tray.find((g) => g.author.name === '林夏')
    expect(me.frames).toHaveLength(2)
    expect(me.frames.every((f) => Boolean(f.imageAssetId))).toBe(true)
  })

  it('没有作者的帧不进托盘', () => {
    const { project } = workWithStories()
    project.appData.instagram.stories.push(
      createStory({ imageAssetId: 'ast_orphan', caption: '没有作者' }),
    )
    const tray = buildStoryTraySafe(toWorkData(project), { storyDate: '2026-05-02' })

    expect(tray).toHaveLength(2)
    expect(tray.every((g) => g.author.name)).toBe(true)
  })

  it('有未看帧的组排在前面，即便另一组更新', () => {
    const { project } = workWithStories()
    // 把「全看过」的那组时间调到最新：未看优先要能压过时间顺序
    const other = project.appData.instagram.stories[2]
    other.displayTime = '2026-05-01T23:00:00.000Z'

    const tray = buildStoryTraySafe(toWorkData(project), { storyDate: '2026-05-02' })
    expect(tray[0].author.name).toBe('林夏')
    expect(tray[0].unseenCount).toBe(2)
    expect(tray[1].unseenCount).toBe(0)
  })
})
