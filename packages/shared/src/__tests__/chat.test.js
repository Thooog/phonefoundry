/**
 * 聊天派生层的两条信息应用特有规则（KakaoTalk 与信息共用 chat.js，
 * 所以每个规则都要同时验证「信息生效、KakaoTalk 不生效」）：
 *
 * 1. 联系人备注绑定 —— 角色被存进通讯录时，信息里显示联系人的名字（备注），
 *    和真机 iMessage 一致；KakaoTalk 显示的是 KakaoTalk 昵称/角色名。
 * 2. 自定义参与者 —— 营销广告、快递通知这类发信人不是角色，
 *    以字符串参与会话，消息用 senderName 指向它。
 */

import { describe, it, expect } from 'vitest'
import { buildConversationList, buildThread, resolveAuthor } from '../select/chat.js'

/** 一个最小可用的 work 对象：林夏（chr_a）+ 周予安（chr_b，通讯录备注「老周」） */
function makeWork() {
  return {
    characters: [
      { id: 'chr_a', name: '林夏', avatarAssetId: null },
      { id: 'chr_b', name: '周予安', avatarAssetId: null },
    ],
    platformAccounts: [],
    workSettings: { ownerCharacterId: 'chr_a' },
    appData: {
      phone: {
        contacts: [{ id: 'ct_1', characterId: 'chr_b', name: '老周', phoneNumber: '139', note: '' }],
      },
      messages: {
        conversations: [
          { id: 'c_msg', title: '', participantIds: ['chr_b'], customParticipants: [] },
          { id: 'c_ad', title: '', participantIds: [], customParticipants: ['10657999'] },
        ],
        messages: [
          {
            id: 'm1', conversationId: 'c_msg', senderCharacterId: 'chr_b', senderAccountId: null,
            senderName: null, contentType: 'text', content: '在吗', displayTime: '2026-05-20T10:00:00',
            readAt: null, snapshot: null,
          },
          {
            id: 'm2', conversationId: 'c_ad', senderCharacterId: null, senderAccountId: null,
            senderName: '10657999', contentType: 'text', content: '【限时特惠】',
            displayTime: '2026-05-20T10:01:00', readAt: null, snapshot: null,
          },
        ],
      },
      kakaotalk: {
        conversations: [{ id: 'c_kt', title: '', participantIds: ['chr_b'], customParticipants: [] }],
        messages: [
          {
            id: 'k1', conversationId: 'c_kt', senderCharacterId: 'chr_b', senderAccountId: null,
            senderName: null, contentType: 'text', content: '안녕', displayTime: '2026-05-20T10:00:00',
            readAt: null, snapshot: null,
          },
        ],
      },
    },
  }
}

describe('联系人备注绑定：只对信息应用生效', () => {
  it('信息的会话标题用联系人备注名，不用角色本名', () => {
    const list = buildConversationList(makeWork(), 'messages', { ownerCharacterId: 'chr_a' })
    const conv = list.find((c) => c.id === 'c_msg')
    expect(conv.title).toBe('老周')
  })

  it('KakaoTalk 的会话标题仍是角色本名（它显示的是 KakaoTalk 侧的名字）', () => {
    const list = buildConversationList(makeWork(), 'kakaotalk', { ownerCharacterId: 'chr_a' })
    const conv = list.find((c) => c.id === 'c_kt')
    expect(conv.title).toBe('周予安')
  })

  it('信息时间线里的发送者名走联系人备注', () => {
    const thread = buildThread(makeWork(), 'c_msg', { ownerCharacterId: 'chr_a' })
    const msg = thread.find((t) => t.id === 'm1')
    expect(msg.authorName).toBe('老周')
  })

  it('KakaoTalk 时间线里的发送者名不走联系人备注', () => {
    const thread = buildThread(makeWork(), 'c_kt', { ownerCharacterId: 'chr_a' })
    const msg = thread.find((t) => t.id === 'k1')
    expect(msg.authorName).toBe('周予安')
  })

  it('联系人没写名字时退回角色本名（不渲染空白标题）', () => {
    const work = makeWork()
    work.appData.phone.contacts[0].name = '  '
    const list = buildConversationList(work, 'messages', { ownerCharacterId: 'chr_a' })
    expect(list.find((c) => c.id === 'c_msg').title).toBe('周予安')
  })
})

describe('会话标题/头像绑平台账号（顶栏与气泡名字一致）', () => {
  it('KakaoTalk 会话标题与头像用 KKT 账号昵称/账号头像，不用角色本名', () => {
    const work = makeWork()
    work.platformAccounts.push({
      id: 'acct_b', characterId: 'chr_b', platform: 'kakaotalk',
      displayName: '予安', avatarAssetId: 'ast_kt_avatar', handle: 'yongan_kk', bio: '',
    })
    const list = buildConversationList(work, 'kakaotalk', { ownerCharacterId: 'chr_a' })
    const conv = list.find((c) => c.id === 'c_kt')
    expect(conv.title).toBe('予安')
    expect(conv.avatarAssetId).toBe('ast_kt_avatar')
  })

  it('KakaoTalk 没配账号时回退角色本名（老数据不炸）', () => {
    const list = buildConversationList(makeWork(), 'kakaotalk', { ownerCharacterId: 'chr_a' })
    expect(list.find((c) => c.id === 'c_kt').title).toBe('周予安')
  })

  it('信息：联系人备注最优先；没入通讯录时用信息账号「显示名称」', () => {
    const work = makeWork()
    work.platformAccounts.push({
      id: 'acct_msg', characterId: 'chr_b', platform: 'messages',
      displayName: '周予安', avatarAssetId: null, phoneNumber: '139',
    })
    const withContact = buildConversationList(work, 'messages', { ownerCharacterId: 'chr_a' })
    expect(withContact.find((c) => c.id === 'c_msg').title).toBe('老周')

    work.appData.phone.contacts = []
    const withoutContact = buildConversationList(work, 'messages', { ownerCharacterId: 'chr_a' })
    expect(withoutContact.find((c) => c.id === 'c_msg').title).toBe('周予安')
  })

  it('账号只认本平台的：信息账号昵称不影响 KakaoTalk 标题', () => {
    const work = makeWork()
    work.platformAccounts.push({
      id: 'acct_msg', characterId: 'chr_b', platform: 'messages',
      displayName: '信息里的名字', avatarAssetId: null, phoneNumber: '139',
    })
    const list = buildConversationList(work, 'kakaotalk', { ownerCharacterId: 'chr_a' })
    expect(list.find((c) => c.id === 'c_kt').title).toBe('周予安')
  })
})

describe('自定义参与者：发信人不是角色', () => {
  it('会话标题拼上自定义参与者原文，并把列表带出去（群聊判定要用）', () => {
    const list = buildConversationList(makeWork(), 'messages', { ownerCharacterId: 'chr_a' })
    const ad = list.find((c) => c.id === 'c_ad')
    expect(ad.title).toBe('10657999')
    expect(ad.customParticipants).toEqual(['10657999'])
  })

  it('senderName 消息：作者就是原文，气泡在左侧（senderCharacterId 是 null）', () => {
    const thread = buildThread(makeWork(), 'c_ad', { ownerCharacterId: 'chr_a' })
    const msg = thread.find((t) => t.id === 'm2')
    expect(msg.authorName).toBe('10657999')
    expect(msg.side).toBe('left')
  })

  it('senderName 优先于角色的解析结果（名字用自定义、头像仍可挂角色）', () => {
    const work = makeWork()
    work.characters[1].avatarAssetId = 'ast_avatar'
    const author = resolveAuthor(work, { characterId: 'chr_b', accountId: null, snapshot: null, senderName: '10657999' })
    expect(author.name).toBe('10657999')
    expect(author.avatarAssetId).toBe('ast_avatar')
  })

  it('角色参与者与自定义参与者混排时，标题按「角色备注名、原文」的顺序拼接', () => {
    const work = makeWork()
    work.appData.messages.conversations[0].customParticipants = ['10657999']
    const list = buildConversationList(work, 'messages', { ownerCharacterId: 'chr_a' })
    expect(list.find((c) => c.id === 'c_msg').title).toBe('老周、10657999')
  })
})

describe('消息图片：派生层只透传，不做裁剪', () => {
  function workWithImage() {
    const work = makeWork()
    work.appData.messages.messages.push({
      id: 'm3',
      conversationId: 'c_msg',
      senderCharacterId: 'chr_a',
      senderAccountId: null,
      senderName: null,
      contentType: 'image',
      content: '',
      mediaAssetIds: ['ast_1', 'ast_2'],
      displayTime: '2026-05-20T10:02:00',
      readAt: null,
      snapshot: null,
    })
    return work
  }

  it('buildThread 原样带出 contentType 与全部 mediaAssetIds（多图不截断）', () => {
    const thread = buildThread(workWithImage(), 'c_msg', { ownerCharacterId: 'chr_a' })
    const msg = thread.find((t) => t.id === 'm3')
    expect(msg.contentType).toBe('image')
    expect(msg.mediaAssetIds).toEqual(['ast_1', 'ast_2'])
    expect(msg.side).toBe('right')
  })

  it('会话列表的预览文案对图片消息仍是「[图片]」', () => {
    const list = buildConversationList(workWithImage(), 'messages', { ownerCharacterId: 'chr_a' })
    expect(list.find((c) => c.id === 'c_msg').preview).toBe('[图片]')
  })
})

describe('系统消息：不分左右、不进气泡', () => {
  /** 在 KakaoTalk 会话里插一条系统消息，夹在两条同人消息之间 */
  function workWithSystem() {
    const work = makeWork()
    work.appData.kakaotalk.messages.push(
      {
        id: 'k2', conversationId: 'c_kt', senderCharacterId: 'chr_b', senderAccountId: null,
        senderName: null, contentType: 'text', content: '那先这样',
        displayTime: '2026-05-20T10:02:00', readAt: null, snapshot: null,
      },
      {
        id: 'k3', conversationId: 'c_kt', senderCharacterId: null, senderAccountId: null,
        senderName: null, contentType: 'system', content: '林夏 邀请 陈默 加入群聊',
        displayTime: '2026-05-20T10:03:00', readAt: null, snapshot: null,
      },
      {
        id: 'k4', conversationId: 'c_kt', senderCharacterId: 'chr_b', senderAccountId: null,
        senderName: null, contentType: 'text', content: '欢迎',
        displayTime: '2026-05-20T10:04:00', readAt: null, snapshot: null,
      },
    )
    return work
  }

  it('系统消息派生为 kind:"system"，带正文但不带左右与作者', () => {
    const thread = buildThread(workWithSystem(), 'c_kt', { ownerCharacterId: 'chr_a' })
    const sys = thread.find((t) => t.id === 'k3')
    expect(sys.kind).toBe('system')
    expect(sys.content).toBe('林夏 邀请 陈默 加入群聊')
    // side / authorName 是气泡才有的东西：系统提示套上任何一个都会长成"某人说的话"
    expect(sys.side).toBeUndefined()
    expect(sys.authorName).toBeUndefined()
  })

  it('系统消息前后的消息仍是 message，一个都不少', () => {
    const thread = buildThread(workWithSystem(), 'c_kt', { ownerCharacterId: 'chr_a' })
    const ids = thread.filter((t) => t.kind === 'message').map((t) => t.id)
    expect(ids).toEqual(['k1', 'k2', 'k4'])
  })

  it('系统消息排进时间线但不打乱顺序', () => {
    const thread = buildThread(workWithSystem(), 'c_kt', { ownerCharacterId: 'chr_a' })
    const order = thread.map((t) => t.id).filter((id) => id.startsWith('k'))
    expect(order).toEqual(['k1', 'k2', 'k3', 'k4'])
  })
})

describe('语音与贴图：派生层照样只透传', () => {
  function workWithTypes() {
    const work = makeWork()
    work.appData.kakaotalk.messages.push(
      {
        id: 'v1', conversationId: 'c_kt', senderCharacterId: 'chr_b', senderAccountId: null,
        senderName: null, contentType: 'voice', content: '', mediaAssetIds: [], durationSec: 7,
        transcript: '你怎么回事啊？',
        displayTime: '2026-05-20T10:05:00', readAt: null, snapshot: null,
      },
      {
        id: 's1', conversationId: 'c_kt', senderCharacterId: null, senderAccountId: null,
        senderName: null, contentType: 'sticker', content: '', mediaAssetIds: ['ast_st'],
        displayTime: '2026-05-20T10:06:00', readAt: null, snapshot: null,
      },
    )
    return work
  }

  it('时长透传到时间线；文本消息的时长是 null（形状稳定，渲染端不用先判类型）', () => {
    const thread = buildThread(workWithTypes(), 'c_kt', { ownerCharacterId: 'chr_a' })
    expect(thread.find((t) => t.id === 'v1').durationSec).toBe(7)
    expect(thread.find((t) => t.id === 'k1').durationSec).toBeNull()
  })

  it('时长是脏值时落成 null —— 渲染端才能干净地退回默认长度', () => {
    const work = workWithTypes()
    work.appData.kakaotalk.messages.at(-2).durationSec = 'abc'
    const thread = buildThread(work, 'c_kt', { ownerCharacterId: 'chr_a' })
    expect(thread.find((t) => t.id === 'v1').durationSec).toBeNull()
  })

  it('转写透传到时间线；没有转写的消息拿到空串（空串 = 不画「转」按钮）', () => {
    const thread = buildThread(workWithTypes(), 'c_kt', { ownerCharacterId: 'chr_a' })
    expect(thread.find((t) => t.id === 'v1').transcript).toBe('你怎么回事啊？')
    expect(thread.find((t) => t.id === 'k1').transcript).toBe('')
    expect(thread.find((t) => t.id === 's1').transcript).toBe('')
  })

  it('转写不是字符串时落成空串 —— 不让渲染端把数字/对象塞进气泡', () => {
    const work = workWithTypes()
    work.appData.kakaotalk.messages.at(-2).transcript = 42
    const thread = buildThread(work, 'c_kt', { ownerCharacterId: 'chr_a' })
    expect(thread.find((t) => t.id === 'v1').transcript).toBe('')
  })

  it('会话列表预览是 [语音] / [贴图]，而不是一行空白', () => {
    const voiceOnly = workWithTypes()
    voiceOnly.appData.kakaotalk.messages = voiceOnly.appData.kakaotalk.messages.filter((m) => m.id !== 's1')
    expect(buildConversationList(voiceOnly, 'kakaotalk', { ownerCharacterId: 'chr_a' })[0].preview).toBe('[语音]')

    expect(buildConversationList(workWithTypes(), 'kakaotalk', { ownerCharacterId: 'chr_a' })[0].preview).toBe(
      '[贴图]',
    )
  })
})

describe('通话：子维度透传与预览占位', () => {
  function workWithCall() {
    const work = makeWork()
    work.appData.kakaotalk.messages.push(
      {
        id: 'c1', conversationId: 'c_kt', senderCharacterId: 'chr_b', senderAccountId: null,
        senderName: null, contentType: 'call', content: '', mediaAssetIds: [],
        callKind: 'video', callStatus: 'completed', durationSec: 323,
        displayTime: '2026-05-20T10:07:00', readAt: null, snapshot: null,
      },
      {
        id: 'c2', conversationId: 'c_kt', senderCharacterId: 'chr_a', senderAccountId: null,
        senderName: null, contentType: 'call', content: '', mediaAssetIds: [],
        callKind: 'voice', callStatus: 'missed', durationSec: null,
        displayTime: '2026-05-20T10:08:00', readAt: null, snapshot: null,
      },
    )
    return work
  }

  it('子维度透传到时间线；文本消息拿到 null（形状稳定，渲染端不用先判类型）', () => {
    const thread = buildThread(workWithCall(), 'c_kt', { ownerCharacterId: 'chr_a' })
    const c1 = thread.find((t) => t.id === 'c1')
    const c2 = thread.find((t) => t.id === 'c2')
    expect(c1.callKind).toBe('video')
    expect(c1.callStatus).toBe('completed')
    expect(c2.callStatus).toBe('missed')
    expect(thread.find((t) => t.id === 'k1').callKind).toBeNull()
    expect(thread.find((t) => t.id === 'k1').callStatus).toBeNull()
  })

  it('子维度是脏值时落成 null —— 渲染端才能干净地回落到默认形态', () => {
    const work = workWithCall()
    work.appData.kakaotalk.messages[1].callKind = 'fax'
    work.appData.kakaotalk.messages[1].callStatus = 42
    const thread = buildThread(work, 'c_kt', { ownerCharacterId: 'chr_a' })
    expect(thread.find((t) => t.id === 'c1').callKind).toBeNull()
    expect(thread.find((t) => t.id === 'c1').callStatus).toBeNull()
  })

  it('会话列表预览是 [视频通话] / [语音通话]', () => {
    const list = buildConversationList(workWithCall(), 'kakaotalk', { ownerCharacterId: 'chr_a' })
    expect(list[0].preview).toBe('[语音通话]')
  })

  it('同类消息没有 callKind 时预览回落 [语音通话]', () => {
    const work = workWithCall()
    delete work.appData.kakaotalk.messages[1].callKind
    const list = buildConversationList(work, 'kakaotalk', { ownerCharacterId: 'chr_a' })
    expect(list[0].preview).toBe('[语音通话]')
  })
})
