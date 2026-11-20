import { describe, it, expect } from 'vitest'

import {
  MESSAGE_TRANSCRIPT_MAX_LENGTH,
  addConversation,
  addMessage,
  conversationsOf,
  countMessagesOf,
  deleteConversation,
  deleteMessage,
  resolveSenderAccount,
  threadOf,
  updateConversation,
  updateMessage,
} from '../kakaotalk.js'
// 时长清洗是 messages.js 的纯函数（两个聊天应用共用），单独测它的边界值
import { normalizeDuration } from '../messages.js'

/**
 * 测试用的 editor 替身。与真实 project store 同一套行为：
 * mutate 把 draft 换上去、 revision +1，组件不直接改数据。
 */
function createEditor(overrides = {}) {
  const editor = {
    project: {
      id: 'prj_test',
      characters: [],
      platformAccounts: [],
      assets: [],
      workSettings: { ownerCharacterId: null },
      appData: { kakaotalk: { conversations: [], messages: [] } },
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

/**
 * 林夏 = 手机所属人（右侧气泡），周予安 = 对话对方。
 * 两人在 KakaoTalk 上都有账号，且昵称与角色本名不同 —— 这正是 senderAccountId
 * 存在的意义：群聊里显示的是账号昵称，不是角色本名。
 */
const CAST = {
  characters: [
    { id: 'chr_a', name: '林夏' },
    { id: 'chr_b', name: '周予安' },
    { id: 'chr_c', name: '陈默' },
  ],
  platformAccounts: [
    { id: 'acc_kt_a', characterId: 'chr_a', platform: 'kakaotalk', displayName: '여름' },
    { id: 'acc_kt_b', characterId: 'chr_b', platform: 'kakaotalk', displayName: '유안' },
  ],
  workSettings: { ownerCharacterId: 'chr_a' },
}

/** 本地时区的固定基准时刻 —— 时间断言必须锁死基准 */
const BASE = new Date(2026, 4, 20, 10, 0, 0, 0).getTime()

/** 带两个角色的主演阵容 + 一个会话，participantIds 只装对方 */
function scene(count = 0) {
  const messages = []
  for (let i = 0; i < count; i += 1) {
    messages.push({
      id: `msg_${i}`,
      conversationId: 'conv_1',
      senderCharacterId: 'chr_b',
      senderAccountId: 'acc_kt_b',
      content: `旧 ${i}`,
      displayTime: new Date(BASE + i * 60 * 1000).toISOString(),
      contentType: 'text',
      readAt: null,
    })
  }
  return createEditor({
    ...CAST,
    appData: {
      kakaotalk: {
        conversations: [{ id: 'conv_1', title: '', participantIds: ['chr_b'], pinned: false }],
        messages,
      },
    },
  })
}

/* ───────────────── 平台账号：KakaoTalk 独有的是这些 ───────────────── */

describe('senderAccountId：群里显示的是 KakaoTalk 昵称，不是角色本名', () => {
  it('resolveSenderAccount 找到的就是该角色的 kakaotalk 账号', () => {
    const project = { platformAccounts: CAST.platformAccounts }
    expect(resolveSenderAccount(project, 'chr_b')).toBe('acc_kt_b')
    expect(resolveSenderAccount(project, 'chr_a')).toBe('acc_kt_a')
  })

  it('角色没建 KakaoTalk 账号时返回 null（作品端会回退显示角色名，不算错）', () => {
    const project = { platformAccounts: CAST.platformAccounts }
    expect(resolveSenderAccount(project, 'chr_c')).toBeNull()
  })

  it('别的应用的账号不会被认 —— 同模型的信息也建了账号也不能串用', () => {
    const project = {
      platformAccounts: [{ id: 'acc_msg', characterId: 'chr_b', platform: 'messages', displayName: '予安' }],
    }
    expect(resolveSenderAccount(project, 'chr_b')).toBeNull()
  })

  it('角色 id 为空时也返回 null，不做无意义的遍历', () => {
    expect(resolveSenderAccount({ platformAccounts: CAST.platformAccounts }, null)).toBeNull()
    expect(resolveSenderAccount({ platformAccounts: CAST.platformAccounts }, '')).toBeNull()
  })

  it('★ 新建消息走默认发送者时也要带上账号（最容易漏的入口）', () => {
    const editor = scene()
    const created = addMessage(editor, 'conv_1', {})
    expect(created.senderCharacterId).toBe('chr_b')
    expect(created.senderAccountId).toBe('acc_kt_b')
  })

  it('显式指定发送者时同样带上他的账号', () => {
    const editor = scene()
    const created = addMessage(editor, 'conv_1', { senderCharacterId: 'chr_a' })
    expect(created.senderCharacterId).toBe('chr_a')
    expect(created.senderAccountId).toBe('acc_kt_a')
  })

  it('改发送者时账号跟着换 —— 否则昵称还挂着上一个人', () => {
    const editor = scene(1)
    const updated = updateMessage(editor, 'msg_0', { senderCharacterId: 'chr_a' })
    expect(updated.senderCharacterId).toBe('chr_a')
    expect(updated.senderAccountId).toBe('acc_kt_a')
  })

  it('解除发送者时账号一并清空，不留一条指向别人的账号码', () => {
    const editor = scene(1)
    const updated = updateMessage(editor, 'msg_0', { senderCharacterId: null })
    expect(updated.senderCharacterId).toBeNull()
    expect(updated.senderAccountId).toBeNull()
  })

  it('没有 KakaoTalk 账号的角色：角色写上去了，账号留空', () => {
    const editor = scene()
    const created = addMessage(editor, 'conv_1', { senderCharacterId: 'chr_c' })
    expect(created.senderCharacterId).toBe('chr_c')
    expect(created.senderAccountId).toBeNull()
  })
})

/* ───────────────── 不渲染的字段不给开口子 ───────────────── */

describe('readAt：KakaoTalk 作品端不渲染，白名单直接堵死', () => {
  it('新建时传 readAt 落不进数据', () => {
    const editor = scene()
    const created = addMessage(editor, 'conv_1', { readAt: new Date(BASE).toISOString() })
    expect(created.readAt).toBeNull()
  })

  it('改消息时传 readAt 连 mutation 都不会发生（返回 null，revision 不白涨）', () => {
    const editor = scene(1)
    const updated = updateMessage(editor, 'msg_0', { readAt: new Date(BASE).toISOString() })

    // 返回 null = 「没有任何有效改动」。比「写进去了但值是 null」强得多：
    // 白名单外的字段连一次 revision 都不消耗。
    expect(updated).toBeNull()
    expect(editor.mutations).toBe(0)
    expect(threadOf(editor.project, 'conv_1')[0].readAt).toBeNull()
  })

  it('有效字段与 readAt 混着传：有效的照写，readAt 被丢掉', () => {
    const editor = scene(1)
    const updated = updateMessage(editor, 'msg_0', { content: '改了', readAt: new Date(BASE).toISOString() })
    expect(updated.content).toBe('改了')
    expect(updated.readAt).toBeNull()
  })

  it('contentType 白名单认这五种，其余回落 text', () => {
    const editor = scene(1)
    expect(updateMessage(editor, 'msg_0', { contentType: 'image' }).contentType).toBe('image')
    expect(updateMessage(editor, 'msg_0', { contentType: 'voice' }).contentType).toBe('voice')
    expect(updateMessage(editor, 'msg_0', { contentType: 'sticker' }).contentType).toBe('sticker')
    expect(updateMessage(editor, 'msg_0', { contentType: 'system' }).contentType).toBe('system')

    expect(updateMessage(editor, 'msg_0', { contentType: 'video' }).contentType).toBe('text')
  })

  it('切到图片会清掉正文；切回文本会清掉媒体引用', () => {
    const editor = scene(1)
    updateMessage(editor, 'msg_0', { content: '一句话' })

    const asImage = updateMessage(editor, 'msg_0', {
      contentType: 'image',
      mediaAssetIds: ['ast_a', 'ast_b'],
    })
    expect(asImage.content).toBe('')
    expect(asImage.mediaAssetIds).toEqual(['ast_a', 'ast_b'])

    const asText = updateMessage(editor, 'msg_0', { contentType: 'text' })
    expect(asText.mediaAssetIds).toEqual([])
  })

  it('媒体 id 只留字符串、去重、最多 9 张（九宫格）', () => {
    const editor = scene(1)
    const updated = updateMessage(editor, 'msg_0', {
      contentType: 'image',
      mediaAssetIds: ['a', 'a', '', null, 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'],
    })
    expect(updated.mediaAssetIds).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'])
  })

  it('同一次 patch 里显式给的正文不会被类型互斥覆盖', () => {
    const editor = scene(1)
    const updated = updateMessage(editor, 'msg_0', { contentType: 'image', content: '配文' })
    expect(updated.content).toBe('配文')
  })

  it('id / conversationId 不在白名单里：整次请求落空，数据一个字节没动', () => {
    const editor = scene(1)
    const before = threadOf(editor.project, 'conv_1')[0]
    const updated = updateMessage(editor, 'msg_0', { id: 'hacked', conversationId: 'other' })

    expect(updated).toBeNull()
    expect(editor.mutations).toBe(0)
    expect(threadOf(editor.project, 'conv_1')[0]).toEqual(before)
  })
})

/* ───────────────── 会话与消息的常规行为 ───────────────── */

describe('会话与消息', () => {
  it('会话列表按 sortKey 倒序（新的在前）', () => {
    const editor = createEditor({
      appData: {
        kakaotalk: {
          conversations: [
            { id: 'c1', sortKey: '2026-05-01T10:00:00.000Z' },
            { id: 'c2', sortKey: '2026-05-02T10:00:00.000Z' },
          ],
          messages: [],
        },
      },
    })
    expect(conversationsOf(editor.project).map((c) => c.id)).toEqual(['c2', 'c1'])
  })

  it('会话不存在时 addMessage 返回 null，不写脏数据', () => {
    const editor = scene()
    expect(addMessage(editor, 'conv_nope', {})).toBeNull()
    expect(editor.project.appData.kakaotalk.messages).toHaveLength(0)
    expect(editor.mutations).toBe(0)
  })

  it('新消息默认发送者 = 会话里第一个参与者（对方）', () => {
    const editor = scene()
    expect(addMessage(editor, 'conv_1', {}).senderCharacterId).toBe('chr_b')
  })

  it('threadOf 按数组物理顺序返回，不重新排序', () => {
    const editor = scene(3)
    expect(threadOf(editor.project, 'conv_1').map((m) => m.id)).toEqual(['msg_0', 'msg_1', 'msg_2'])
  })

  it('afterId 插在锚点之后，beforeId 插在锚点之前', () => {
    const editor = scene(2)
    const after = addMessage(editor, 'conv_1', { afterId: 'msg_0' })
    expect(threadOf(editor.project, 'conv_1').map((m) => m.id)).toEqual(['msg_0', after.id, 'msg_1'])

    const editor2 = scene(2)
    const before = addMessage(editor2, 'conv_1', { beforeId: 'msg_0' })
    expect(threadOf(editor2.project, 'conv_1').map((m) => m.id)).toEqual([before.id, 'msg_0', 'msg_1'])
  })

  it('新消息时间贴着锚点 / 末尾，不用系统当前时间', () => {
    const editor = scene(2)
    expect(Date.parse(addMessage(editor, 'conv_1', { afterId: 'msg_0' }).displayTime)).toBe(BASE + 1000)

    const editor2 = scene(2)
    expect(Date.parse(addMessage(editor2, 'conv_1', {}).displayTime)).toBe(BASE + 60 * 1000 + 1000)
  })

  it('改参与者清掉已不在会话里的发送者的消息，但保留所属人的', () => {
    const editor = createEditor({
      ...CAST,
      appData: {
        kakaotalk: {
          conversations: [{ id: 'conv_1', participantIds: ['chr_b', 'chr_c'], title: '' }],
          messages: [
            { id: 'm1', conversationId: 'conv_1', senderCharacterId: 'chr_c', senderAccountId: null },
            { id: 'm2', conversationId: 'conv_1', senderCharacterId: 'chr_a', senderAccountId: 'acc_kt_a' },
            { id: 'm3', conversationId: 'conv_1', senderCharacterId: 'chr_b', senderAccountId: 'acc_kt_b' },
            { id: 'm4', conversationId: 'conv_2', senderCharacterId: 'chr_c', senderAccountId: null },
          ],
        },
      },
    })

    const result = updateConversation(editor, 'conv_1', { participantIds: ['chr_b'] })
    const ids = editor.project.appData.kakaotalk.messages.map((m) => m.id)

    expect(result.removedMessages).toBe(1)
    // 陈默（被移除的参与者）的消息没了；所属人 + 保留的参与者 + 别的会话都不受影响
    expect(ids).toEqual(['m2', 'm3', 'm4'])
  })

  it('删会话连带删掉它下面的消息', () => {
    const editor = scene(3)
    expect(countMessagesOf(editor.project, 'conv_1')).toBe(3)
    const result = deleteConversation(editor, 'conv_1')
    expect(result.removed).toBe(true)
    expect(result.removedMessages).toBe(3)
    expect(editor.project.appData.kakaotalk.messages).toHaveLength(0)
  })

  it('删一条消息只删那一条', () => {
    const editor = scene(3)
    expect(deleteMessage(editor, 'msg_1')).toBe(true)
    expect(threadOf(editor.project, 'conv_1').map((m) => m.id)).toEqual(['msg_0', 'msg_2'])
  })

  it('一次操作只涨一次 revision', () => {
    const editor = scene()
    addConversation(editor, {})
    expect(editor.mutations).toBe(1)
  })
})

describe('语音：时长是唯一的内容', () => {
  it('新建语音消息带上时长', () => {
    const editor = scene()
    const msg = addMessage(editor, 'conv_1', { contentType: 'voice', durationSec: 7 })
    expect(msg.contentType).toBe('voice')
    expect(msg.durationSec).toBe(7)
  })

  it('时长取整并夹到 1~600 秒，非法值落成 null（不是 0）', () => {
    expect(normalizeDuration(3.6)).toBe(4)
    expect(normalizeDuration(0)).toBe(1)
    expect(normalizeDuration(9999)).toBe(600)
    expect(normalizeDuration('12')).toBe(12)
    expect(normalizeDuration('abc')).toBeNull()
    expect(normalizeDuration('')).toBeNull()
    expect(normalizeDuration(null)).toBeNull()
  })

  it('切到语音会清掉正文与媒体 —— 一条语音只承载声音', () => {
    const editor = scene(1)
    updateMessage(editor, 'msg_0', { contentType: 'image', mediaAssetIds: ['ast_a'] })
    const asVoice = updateMessage(editor, 'msg_0', { contentType: 'voice' })
    expect(asVoice.content).toBe('')
    expect(asVoice.mediaAssetIds).toEqual([])
  })

  it('切离语音把时长清成 null —— 0:03 挂在一条文本消息上没有意义', () => {
    const editor = scene(1)
    updateMessage(editor, 'msg_0', { contentType: 'voice', durationSec: 9 })
    const asText = updateMessage(editor, 'msg_0', { contentType: 'text', content: '回来了' })
    expect(asText.durationSec).toBeNull()
    expect(asText.content).toBe('回来了')
  })
})

describe('转文字：转写只跟着语音走', () => {
  it('新建语音可以带转写，文本消息带转写会被忽略', () => {
    const editor = scene()
    const withSub = addMessage(editor, 'conv_1', {
      contentType: 'voice',
      durationSec: 5,
      transcript: '你怎么回事啊？',
    })
    expect(withSub.transcript).toBe('你怎么回事啊？')

    // 文本消息写转写是脏数据：作品端只按内容载体渲染，这段字永远看不见
    const asText = addMessage(editor, 'conv_1', { contentType: 'text', transcript: '多余的' })
    expect(asText.transcript).toBe('')
  })

  it('转写去首尾空白、超长截断到上限', () => {
    const editor = scene()
    const msg = addMessage(editor, 'conv_1', { contentType: 'voice', transcript: '  一段话  ' })
    expect(msg.transcript).toBe('一段话')

    const long = 'a'.repeat(MESSAGE_TRANSCRIPT_MAX_LENGTH + 50)
    const clipped = addMessage(editor, 'conv_1', { contentType: 'voice', transcript: long })
    expect(clipped.transcript).toHaveLength(MESSAGE_TRANSCRIPT_MAX_LENGTH)
  })

  it('清空输入框 = 撤掉转写（空串，作品端据此不画「转」按钮）', () => {
    const editor = scene()
    const msg = addMessage(editor, 'conv_1', { contentType: 'voice', transcript: '原文' })
    const cleared = updateMessage(editor, msg.id, { transcript: '   ' })
    expect(cleared.transcript).toBe('')
  })

  it('切离语音会把转写一并清空 —— 转写依附在语音上', () => {
    const editor = scene()
    const msg = addMessage(editor, 'conv_1', { contentType: 'voice', transcript: '原文' })
    const asText = updateMessage(editor, msg.id, { contentType: 'text', content: '算了' })
    expect(asText.transcript).toBe('')
  })
})

describe('贴图：一个表情只用一张图', () => {
  it('贴图最多留 1 张，多选会被截断', () => {
    const editor = scene(1)
    const updated = updateMessage(editor, 'msg_0', {
      contentType: 'sticker',
      mediaAssetIds: ['a', 'b', 'c'],
    })
    expect(updated.mediaAssetIds).toEqual(['a'])
  })

  it('贴图不占正文：切过去清掉正文，切回图片上限回到 9 张', () => {
    const editor = scene(1)
    updateMessage(editor, 'msg_0', { content: '一句话' })

    const asSticker = updateMessage(editor, 'msg_0', { contentType: 'sticker' })
    expect(asSticker.content).toBe('')

    const asImage = updateMessage(editor, 'msg_0', {
      contentType: 'image',
      mediaAssetIds: ['a', 'b', 'c', 'd', 'e'],
    })
    expect(asImage.mediaAssetIds).toEqual(['a', 'b', 'c', 'd', 'e'])
  })
})

describe('系统消息：没有发送者，只有正文', () => {
  it('新建系统消息不挂发送者，账号也一并留空', () => {
    const editor = scene()
    const msg = addMessage(editor, 'conv_1', { contentType: 'system', content: '林夏 邀请 陈默 加入群聊' })
    expect(msg.senderCharacterId).toBeNull()
    expect(msg.senderAccountId).toBeNull()
    expect(msg.content).toBe('林夏 邀请 陈默 加入群聊')
  })

  it('切到系统消息会清掉已有的发送者与媒体', () => {
    const editor = scene(1)
    const updated = updateMessage(editor, 'msg_0', { contentType: 'system', content: '陈默 退出群聊' })
    expect(updated.senderCharacterId).toBeNull()
    expect(updated.senderAccountId).toBeNull()
    expect(updated.mediaAssetIds).toEqual([])
  })

  it('切离系统消息不自动补发送者 —— 那条灰字本来就没指定是谁，猜一个填上去反而错', () => {
    const editor = scene(1)
    updateMessage(editor, 'msg_0', { contentType: 'system', content: '陈默 退出群聊' })
    const asText = updateMessage(editor, 'msg_0', { contentType: 'text', content: '人呢' })
    expect(asText.senderCharacterId).toBeNull()
  })

  it('同一次 patch 里显式给的发送者不会被系统消息规则覆盖', () => {
    const editor = scene(1)
    const updated = updateMessage(editor, 'msg_0', {
      contentType: 'system',
      senderCharacterId: 'chr_c',
      content: '陈默 修改了群公告',
    })
    expect(updated.senderCharacterId).toBe('chr_c')
  })
})

/* ───────────────── 通话（语音/视频） ─────────────────
 *
 * call 是单类型 + 两个子维度（callKind / callStatus），时长复用语音的
 * durationSec —— 「同一载体两种类型」是刻意的设计，测试要钉住它的边界：
 * 互切不清时长、非通话消息写子维度是脏数据、未接通没有时长。
 */

describe('通话：子维度白名单与时长共用', () => {
  it('新建通话默认语音 + 已接通，时长随传入值清洗', () => {
    const editor = scene()
    const msg = addMessage(editor, 'conv_1', { contentType: 'call', durationSec: 323 })
    expect(msg.contentType).toBe('call')
    expect(msg.callKind).toBe('voice')
    expect(msg.callStatus).toBe('completed')
    expect(msg.durationSec).toBe(323)
  })

  it('显式传视频 + 未接通：子维度照写，时长不落库（未接通没有时长可打）', () => {
    const editor = scene()
    const msg = addMessage(editor, 'conv_1', {
      contentType: 'call',
      callKind: 'video',
      callStatus: 'missed',
      durationSec: 20,
    })
    expect(msg.callKind).toBe('video')
    expect(msg.callStatus).toBe('missed')
    expect(msg.durationSec).toBeNull()
  })

  it('子维度脏值回落默认，而不是写进去让作品端去猜', () => {
    const editor = scene()
    const msg = addMessage(editor, 'conv_1', { contentType: 'call', callKind: 'fax', callStatus: 'dropped' })
    expect(msg.callKind).toBe('voice')
    expect(msg.callStatus).toBe('completed')
  })

  it('非通话消息写子维度会被强制清掉 —— 看不见的字段不落库', () => {
    const editor = scene(1)
    const updated = updateMessage(editor, 'msg_0', { callKind: 'video', callStatus: 'completed' })
    expect(updated.callKind).toBeNull()
    expect(updated.callStatus).toBeNull()
  })

  it('切结果为「未接通」时自动清掉时长', () => {
    const editor = scene()
    const msg = addMessage(editor, 'conv_1', { contentType: 'call', durationSec: 45 })
    const updated = updateMessage(editor, msg.id, { callStatus: 'missed' })
    expect(updated.callStatus).toBe('missed')
    expect(updated.durationSec).toBeNull()
  })

  it('voice ↔ call 互切保留时长（共用载体），但各自的专属字段跟着类型走', () => {
    const editor = scene()
    const voice = addMessage(editor, 'conv_1', { contentType: 'voice', durationSec: 9, transcript: '原文' })
    const asCall = updateMessage(editor, voice.id, { contentType: 'call' })
    expect(asCall.durationSec).toBe(9)
    expect(asCall.transcript).toBe('')
    expect(asCall.callKind).toBe('voice')
    expect(asCall.callStatus).toBe('completed')

    const editor2 = scene()
    const call = editor2
      ? addMessage(editor2, 'conv_1', { contentType: 'call', callKind: 'video', callStatus: 'completed', durationSec: 15 })
      : null
    const asVoice = updateMessage(editor2, call.id, { contentType: 'voice', transcript: '转写' })
    expect(asVoice.durationSec).toBe(15)
    expect(asVoice.transcript).toBe('转写')
    expect(asVoice.callKind).toBeNull()
    expect(asVoice.callStatus).toBeNull()
  })

  it('切到别的类型（文本）连时长带子维度一起清', () => {
    const editor = scene()
    const call = addMessage(editor, 'conv_1', { contentType: 'call', durationSec: 30 })
    const asText = updateMessage(editor, call.id, { contentType: 'text', content: '不打了' })
    expect(asText.durationSec).toBeNull()
    expect(asText.callKind).toBeNull()
    expect(asText.callStatus).toBeNull()
  })

  it('contentType 白名单认六种（call 在内），未知值仍回落 text', () => {
    const editor = scene(1)
    expect(updateMessage(editor, 'msg_0', { contentType: 'call' }).contentType).toBe('call')
    expect(updateMessage(editor, 'msg_0', { contentType: 'videocall' }).contentType).toBe('text')
  })

  /* 通话时长不设上限：600 秒是「按住说一条」的语音上限，不是打电话的上限 */
  it('通话时长不按语音上限截断：两小时照写', () => {
    const editor = scene()
    const msg = addMessage(editor, 'conv_1', { contentType: 'call', callKind: 'video', durationSec: 7200 })
    expect(msg.durationSec).toBe(7200)
    expect(updateMessage(editor, msg.id, { durationSec: 4 * 3600 + 65 }).durationSec).toBe(4 * 3600 + 65)
  })

  it('通话时长仍取整、下限 1 秒，非法值落成 null', () => {
    const editor = scene()
    const msg = addMessage(editor, 'conv_1', { contentType: 'call', durationSec: 90.6 })
    expect(msg.durationSec).toBe(91)
    expect(updateMessage(editor, msg.id, { durationSec: 0 }).durationSec).toBe(1)
    expect(updateMessage(editor, msg.id, { durationSec: 'abc' }).durationSec).toBeNull()
  })

  it('长通话切成语音不改写已有时长（互切不清时长的老规则优先，不静默截断）', () => {
    const editor = scene()
    const call = addMessage(editor, 'conv_1', { contentType: 'call', durationSec: 7200 })
    // 只有**显式**改时长时才按目标类型的规则清洗；类型互切只搬载体，不动数值
    expect(updateMessage(editor, call.id, { contentType: 'voice' }).durationSec).toBe(7200)
    expect(updateMessage(editor, call.id, { durationSec: 7200 }).durationSec).toBe(600)
  })
})
