import { describe, it, expect } from 'vitest'

import {
  CUSTOM_SENDER_MAX_LENGTH,
  IMPORT_STEP_MS,
  addMessage,
  addConversation,
  parseConversationText,
  parseDateLine,
  resolveImportTimes,
  threadOf,
  updateConversation,
  updateMessage,
} from '../messages.js'

/**
 * 测试用的 editor 替身。mutate 只 +1 revision、把草稿换上去，
 * 与真实 project store 的行为保持一致。
 */
function createEditor(overrides = {}) {
  const editor = {
    project: {
      id: 'prj_test',
      characters: [],
      platformAccounts: [],
      assets: [],
      workSettings: { ownerCharacterId: null },
      appData: { messages: { conversations: [], messages: [] } },
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

/** 带角色的项目：林夏是手机所属人，周予安是对话的对方 */
function projectWithCast() {
  return {
    characters: [
      { id: 'chr_a', name: '林夏' },
      { id: 'chr_b', name: '周予安' },
    ],
    workSettings: { ownerCharacterId: 'chr_a' },
  }
}

/** 本地时区的某个固定时刻 —— 时间断言必须锁死基准，否则跨午夜用例会飘 */
const BASE = new Date(2026, 4, 20, 10, 0, 0, 0).getTime()

/** 把 ISO 转成本地 HH:mm:ss，便于肉眼核对 */
function clock(iso) {
  const d = new Date(iso)
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/* ───────────────── 粘贴文本的解析 ───────────────── */

describe('parseConversationText：行尾括号的两种含义', () => {
  const parse = (text) => parseConversationText(projectWithCast(), text)

  it('只写时刻的是发送时间，跟着正文一起拆出来', () => {
    const [line] = parse('林夏：你在家吗？（23:24）')
    expect(line.content).toBe('你在家吗？')
    expect(line.sentTime).toBe('23:24')
    expect(line.readAt).toBeNull()
  })

  it('没写时刻的行 sentTime 是 null，留给 resolveImportTimes 去推', () => {
    const [line] = parse('周予安：在的，怎么了')
    expect(line.sentTime).toBeNull()
    expect(line.content).toBe('在的，怎么了')
  })

  it('半角括号一样认', () => {
    const [line] = parse('林夏：你在家吗? (23:24)')
    expect(line.sentTime).toBe('23:24')
    expect(line.content).toBe('你在家吗?')
  })

  it('发送时刻与已读回执可以写在同行（各自解析，互不干扰）', () => {
    const [line] = parse('林夏：那我过来咯（23:30）（23:31 已读）')
    expect(line.content).toBe('那我过来咯')
    expect(line.sentTime).toBe('23:30')
    expect(line.readAt).not.toBeNull()
    expect(clock(line.readAt)).toBe('23:31:00')
  })

  it('补零：`9:5` 认作 09:05', () => {
    const [line] = parse('林夏：早（9:5）')
    expect(line.sentTime).toBe('09:05')
  })

  it('超出范围的时刻当没写，而不是落成一个 Invalid Date', () => {
    const [line] = parse('林夏：几点了（99:99）')
    expect(line.sentTime).toBeNull()
    expect(line.content).toBe('几点了（99:99）')
  })

  it('正文里的括号不会被误当成时刻尾缀吃掉', () => {
    const [line] = parse('林夏：你看（这个是重点）')
    expect(line.sentTime).toBeNull()
    expect(line.content).toBe('你看（这个是重点）')
  })

  it('不能识别的角色名仍然标记为未识别', () => {
    const [line] = parse('张三：在吗（23:24）')
    expect(line.characterId).toBeNull()
    expect(line.sentTime).toBe('23:24')
  })
})

/* ───────────────── 时间推导 ───────────────── */

describe('resolveImportTimes：顺着上下文推展品 ', () => {
  const lines = (text) => parseConversationText(projectWithCast(), text)

  it('没写时刻的行 = 上一条已写时刻的行 + 20s（用户要的那条规则）', () => {
    const parsed = lines('林夏：你在家吗？（23:24）\n周予安：在的，怎么了\n林夏：那我过来咯（23:30）')
    const times = resolveImportTimes(parsed, { base: BASE })

    expect(clock(times[0])).toBe('23:24:00')
    expect(clock(times[1])).toBe('23:24:20')
    expect(clock(times[2])).toBe('23:30:00')
  })

  it('连续多行没写时刻时依次 +20s，不是都锚在同一条上', () => {
    const parsed = lines('林夏：一（10:00）\n周予安：二\n周予安：三\n周予安：四')
    const times = resolveImportTimes(parsed, { base: BASE })

    expect(clock(times[1])).toBe('10:00:20')
    expect(clock(times[2])).toBe('10:00:40')
    expect(clock(times[3])).toBe('10:01:00')
  })

  it('聊过午夜时往后进一天（23:50 → 00:10 是第二天，不是倒流）', () => {
    const parsed = lines('林夏：还不睡？（23:50）\n周予安：睡不着\n林夏：那再聊会儿（00:10）')
    const times = resolveImportTimes(parsed, { base: BASE })

    expect(new Date(times[0]).getDate()).toBe(20)
    expect(clock(times[1])).toBe('23:50:20')
    expect(clock(times[2])).toBe('00:10:00')
    // 跨天后日期确实是 +1
    expect(new Date(times[2]).getDate()).toBe(21)
  })

  it('第一条就没写时刻时，从基准时刻起算', () => {
    const parsed = lines('林夏：一\n周予安：二')
    const times = resolveImportTimes(parsed, { base: BASE })

    expect(Date.parse(times[0])).toBe(BASE + IMPORT_STEP_MS)
    expect(Date.parse(times[1])).toBe(BASE + IMPORT_STEP_MS * 2)
  })

  it('返回值与行数等长，空输入返回空数组', () => {
    const parsed = lines('林夏：一（10:00）\n周予安：二')
    expect(resolveImportTimes(parsed, { base: BASE })).toHaveLength(2)
    expect(resolveImportTimes([], { base: BASE })).toEqual([])
    expect(resolveImportTimes(null, { base: BASE })).toEqual([])
  })

  it('同一时刻重复出现不打架（紧紧相等也算跨天推进）', () => {
    const parsed = lines('林夏：一（10:00）\n林夏：还是十点（10:00）')
    const times = resolveImportTimes(parsed, { base: BASE })
    expect(new Date(times[1]).getDate()).toBe(21)
  })

  it('stepMs 可注入，方便复用这套推导', () => {
    const parsed = lines('林夏：一（10:00）\n周予安：二')
    const times = resolveImportTimes(parsed, { base: BASE, stepMs: 1000 })
    expect(clock(times[1])).toBe('10:00:01')
  })
})

/* ───────────────── 日期行 ───────────────── */

describe('parseDateLine：单独一行的日期', () => {
  it('斜杠 / 短横线 / 点号 / 中文年月日都认，统一成 YYYY-MM-DD', () => {
    expect(parseDateLine('2026/6/30')).toBe('2026-06-30')
    expect(parseDateLine('2026-06-30')).toBe('2026-06-30')
    expect(parseDateLine('2026.6.30')).toBe('2026-06-30')
    expect(parseDateLine('2026年6月30日')).toBe('2026-06-30')
    expect(parseDateLine('  2026 / 7 / 1  ')).toBe('2026-07-01')
  })

  it('不存在的日期不算日期（JS 会把 2/31 静默顺延成 3/3）', () => {
    expect(parseDateLine('2026/2/31')).toBeNull()
    expect(parseDateLine('2026/13/1')).toBeNull()
    expect(parseDateLine('2026/0/10')).toBeNull()
  })

  it('只写月/日不认 —— 没有年份就得猜"今年"，导入不该有这种不确定性', () => {
    expect(parseDateLine('6/30')).toBeNull()
  })

  it('带冒号的是消息行，不是日期行', () => {
    expect(parseDateLine('林夏：2026/6/30')).toBeNull()
  })
})

describe('parseConversationText：日期行给后面的消息定日期', () => {
  const parse = (text) => parseConversationText(projectWithCast(), text)

  it('日期行本身不产出消息（否则会多一条"未识别"的垃圾）', () => {
    const parsed = parse('2026/6/30\n林夏：在吗（23:24）')
    expect(parsed).toHaveLength(1)
    expect(parsed[0].date).toBe('2026-06-30')
  })

  it('日期一直生效到下一个日期行', () => {
    const parsed = parse(
      '2026/6/30\n林夏：一（23:24）\n周予安：二\n2026/7/1\n林夏：三（23:30）',
    )
    expect(parsed.map((l) => l.date)).toEqual(['2026-06-30', '2026-06-30', '2026-07-01'])
    expect(parsed.map((l) => l.content)).toEqual(['一', '二', '三'])
  })

  it('没写日期行时 date 是 null，时间推导仍按"今天"走', () => {
    const [line] = parse('林夏：一（10:00）')
    expect(line.date).toBeNull()
  })
})

describe('resolveImportTimes：按日期行落位', () => {
  const lines = (text) => parseConversationText(projectWithCast(), text)

  it('用户给的例子：两条落在 6/30，第三条落在 7/1', () => {
    const parsed = lines(
      '2026/6/30\n林夏：你在家吗？（23:24）\n周予安：在的，怎么了\n2026/7/1\n林夏：那我过来咯（23:30）',
    )
    const times = resolveImportTimes(parsed, { base: BASE })
    const day = (iso) => {
      const d = new Date(iso)
      return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
    }

    expect(times.map(day)).toEqual(['2026/6/30', '2026/6/30', '2026/7/1'])
    expect(times.map(clock)).toEqual(['23:24:00', '23:24:20', '23:30:00'])
  })

  it('日期是权威：块内时刻变小也不顺延到下一天', () => {
    const parsed = lines('2026/7/1\n林夏：一（23:50）\n林夏：二（00:10）')
    const times = resolveImportTimes(parsed, { base: BASE })
    expect(new Date(times[1]).getDate()).toBe(1)
    expect(clock(times[1])).toBe('00:10:00')
  })

  it('日期块里没写时刻的行从当天零点起算，不会留在前一天', () => {
    const parsed = lines('2026/6/30\n林夏：一（23:24）\n2026/7/1\n周予安：二')
    const times = resolveImportTimes(parsed, { base: BASE })
    expect(new Date(times[1]).getDate()).toBe(1)
    expect(clock(times[1])).toBe('00:00:20')
  })

  it('日期行不受基准时刻影响（base 换成别的年份也一样）', () => {
    const parsed = lines('2026/6/30\n林夏：一（23:24）')
    const times = resolveImportTimes(parsed, { base: new Date(2030, 0, 1, 9, 0).getTime() })
    expect(new Date(times[0]).getFullYear()).toBe(2026)
    expect(clock(times[0])).toBe('23:24:00')
  })

  it('没有日期行时仍然自动跨天（老行为不受影响）', () => {
    const parsed = lines('林夏：一（23:50）\n林夏：二（00:10）')
    const times = resolveImportTimes(parsed, { base: BASE })
    expect(new Date(times[1]).getDate()).toBe(new Date(BASE).getDate() + 1)
  })
})

/* ───────────────── 新建消息的时间 ───────────────── */

describe('addMessage：新消息的时间贴着锚点，不用系统时间', () => {
  function conv(count = 0) {
    const messages = []
    for (let i = 0; i < count; i += 1) {
      messages.push({
        id: `msg_${i}`,
        conversationId: 'conv_1',
        senderCharacterId: 'chr_b',
        content: `旧 ${i}`,
        displayTime: new Date(BASE + i * 60 * 1000).toISOString(),
        contentType: 'text',
        readAt: null,
      })
    }
    return createEditor({
      characters: projectWithCast().characters,
      appData: { messages: { conversations: [{ id: 'conv_1', title: '', participantIds: ['chr_b'] }], messages } },
    })
  }

  it('afterId：新消息时间 = 锚点 + 1s', () => {
    const editor = conv(2)
    const created = addMessage(editor, 'conv_1', { afterId: 'msg_0' })
    expect(Date.parse(created.displayTime)).toBe(BASE + 1000)
  })

  it('beforeId：新消息时间 = 锚点 - 1s', () => {
    const editor = conv(2)
    const created = addMessage(editor, 'conv_1', { beforeId: 'msg_0' })
    expect(Date.parse(created.displayTime)).toBe(BASE - 1000)
  })

  it('不传锚点：接在会话最后一条之后 + 1s', () => {
    const editor = conv(2)
    const created = addMessage(editor, 'conv_1', {})
    expect(Date.parse(created.displayTime)).toBe(BASE + 60 * 1000 + 1000)
  })

  it('显式传 displayTime 时以传入值为准（导入场景不被覆盖）', () => {
    const editor = conv(1)
    const given = new Date(2026, 0, 1, 8, 30).toISOString()
    const created = addMessage(editor, 'conv_1', { displayTime: given })
    expect(created.displayTime).toBe(given)
  })

  it('锚点时间的脏值不会污染成 Invalid Date', () => {
    const editor = createEditor({
      appData: {
        messages: {
          conversations: [{ id: 'conv_1', participantIds: ['chr_b'] }],
          messages: [
            { id: 'msg_bad', conversationId: 'conv_1', displayTime: '不是时间', senderCharacterId: 'chr_b' },
          ],
        },
      },
    })
    const created = addMessage(editor, 'conv_1', { afterId: 'msg_bad' })
    expect(Number.isFinite(Date.parse(created.displayTime))).toBe(true)
  })

  it('物理顺序：after 插在锚点之后、before 插在锚点之前', () => {
    const editor = conv(2)
    const after = addMessage(editor, 'conv_1', { afterId: 'msg_0' })
    expect(threadOf(editor.project, 'conv_1').map((m) => m.id)).toEqual(['msg_0', after.id, 'msg_1'])
  })
})

/* ───────────────── 自定义发信人（营销广告、快递通知） ───────────────── */

describe('customParticipants：没有角色的发信人', () => {
  /** 一个只有自定义参与者的会话（广告短信的场景） */
  function adConv() {
    return createEditor({
      characters: projectWithCast().characters,
      appData: {
        messages: {
          conversations: [{ id: 'conv_1', title: '', participantIds: [], customParticipants: ['10657999'] }],
          messages: [],
        },
      },
    })
  }

  it('没有角色参与者时，新消息默认发送者 = 第一个自定义参与者', () => {
    const editor = adConv()
    const created = addMessage(editor, 'conv_1', {})
    expect(created.senderName).toBe('10657999')
    expect(created.senderCharacterId).toBeNull()
  })

  it('senderName 与 senderCharacterId 互斥：改消息时写哪个清哪个', () => {
    const editor = adConv()
    const ad = addMessage(editor, 'conv_1', { content: '【限时特惠】' })
    const switched = updateMessage(editor, ad.id, { senderCharacterId: 'chr_a' })
    expect(switched.senderCharacterId).toBe('chr_a')
    expect(switched.senderName).toBeNull()

    const back = updateMessage(editor, ad.id, { senderName: '10657999' })
    expect(back.senderName).toBe('10657999')
    expect(back.senderCharacterId).toBeNull()
  })

  it('收缩自定义参与者 → 对应 senderName 的消息被清掉，角色消息不受影响', () => {
    const editor = adConv()
    const ad = addMessage(editor, 'conv_1', {})
    // 再补一条角色消息
    const mine = addMessage(editor, 'conv_1', { senderCharacterId: 'chr_a', senderName: null })
    const result = updateConversation(editor, 'conv_1', { customParticipants: [] })
    expect(result.removedMessages).toBe(1)
    expect(threadOf(editor.project, 'conv_1').map((m) => m.id)).toEqual([mine.id])
    expect(ad.senderName).toBe('10657999')
  })

  it('收缩角色参与者不会误删 senderName 消息（senderCharacterId 是 null，旧规则会当孤儿）', () => {
    const editor = adConv()
    const ad = addMessage(editor, 'conv_1', {})
    updateConversation(editor, 'conv_1', { participantIds: [] })
    expect(threadOf(editor.project, 'conv_1').map((m) => m.id)).toContain(ad.id)
  })

  it('清洗：去空白、去空项、去重、限长', () => {
    const editor = createEditor()
    const longName = 'x'.repeat(CUSTOM_SENDER_MAX_LENGTH + 5)
    const created = addConversation(editor, {
      customParticipants: [' 10657999 ', '', '10657999', longName],
    })
    expect(created.customParticipants).toEqual(['10657999', 'x'.repeat(CUSTOM_SENDER_MAX_LENGTH)])
  })
})

/* ───────────────── 消息类型与图片 ───────────────── */

describe('contentType 与消息图片', () => {
  /** 一个角色会话 + 一条默认的文本消息 */
  function scene() {
    const editor = createEditor({
      characters: projectWithCast().characters,
      workSettings: projectWithCast().workSettings,
      appData: {
        messages: {
          conversations: [{ id: 'conv_1', participantIds: ['chr_b'], customParticipants: [] }],
          messages: [],
        },
      },
    })
    const message = addMessage(editor, 'conv_1', { senderCharacterId: 'chr_b', content: '文字' })
    return { editor, message }
  }

  it('新建消息默认仍是纯文本，没有媒体', () => {
    const { message } = scene()
    expect(message.contentType).toBe('text')
    expect(message.mediaAssetIds).toEqual([])
  })

  it('白名单只认 text / image，其它值回落 text（作品端不去猜类型）', () => {
    const { editor, message } = scene()
    expect(updateMessage(editor, message.id, { contentType: 'image' }).contentType).toBe('image')
    expect(updateMessage(editor, message.id, { contentType: 'video' }).contentType).toBe('text')
    // call 只属于 KakaoTalk（真机 iMessage 没有聊天内通话记录）：
    // 两个应用的白名单是刻意分开的，这里落回 text 防止有人"顺手统一"
    expect(updateMessage(editor, message.id, { contentType: 'call' }).contentType).toBe('text')
  })

  it('切到图片清正文；切回文本清媒体引用', () => {
    const { editor, message } = scene()

    const asImage = updateMessage(editor, message.id, {
      contentType: 'image',
      mediaAssetIds: ['ast_a'],
    })
    expect(asImage.content).toBe('')
    expect(asImage.mediaAssetIds).toEqual(['ast_a'])

    const asText = updateMessage(editor, message.id, { contentType: 'text' })
    expect(asText.mediaAssetIds).toEqual([])
  })

  it('同一次 patch 里显式给的正文不会被类型互斥覆盖', () => {
    const { editor, message } = scene()
    const updated = updateMessage(editor, message.id, { contentType: 'image', content: '配文' })
    expect(updated.content).toBe('配文')
  })

  it('媒体 id 只留字符串、去重、最多 9 张（九宫格）', () => {
    const { editor, message } = scene()
    const updated = updateMessage(editor, message.id, {
      contentType: 'image',
      mediaAssetIds: ['a', 'a', '', null, 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'],
    })
    expect(updated.mediaAssetIds).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'])
  })

  it('addMessage 能直接建出一条带图消息（导入之外的入口）', () => {
    const { editor } = scene()
    const created = addMessage(editor, 'conv_1', {
      senderCharacterId: 'chr_b',
      contentType: 'image',
      mediaAssetIds: ['ast_a', 'ast_b'],
    })
    expect(created.contentType).toBe('image')
    expect(created.mediaAssetIds).toEqual(['ast_a', 'ast_b'])
  })
})
