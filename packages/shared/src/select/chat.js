/**
 * 会话与消息的只读派生（KakaoTalk / 信息共用）。
 */

import { formatListTime, formatDayDivider, formatDayDividerStamp, dayRelation } from '../time/format.js'

/**
 * 解析一条内容所属人的显示信息。
 * 优先级：自定义发送者名 → 实时角色/账号 → 内容自带 snapshot → 占位
 */
export function resolveAuthor(work, { characterId, accountId, snapshot, senderName }) {
  // senderName（自定义发信人）是编辑端显式写的显示名，优先级最高。
  // 头像仍可从角色取 —— 允许「名字用自定义、头像挂角色」的组合。
  if (senderName) {
    const character = characterId ? work.characters.find((c) => c.id === characterId) : null
    return {
      characterId: character?.id ?? null,
      name: senderName,
      handle: '',
      avatarAssetId: character?.avatarAssetId ?? null,
      isDeleted: false,
    }
  }

  const character = characterId ? work.characters.find((c) => c.id === characterId) : null
  const account = accountId ? work.platformAccounts.find((a) => a.id === accountId) : null

  if (character || account) {
    return {
      characterId: character?.id ?? null,
      name: account?.displayName || character?.name || snapshot?.displayName || '未知',
      handle: account?.handle ?? '',
      avatarAssetId: account?.avatarAssetId || character?.avatarAssetId || snapshot?.avatarAssetId || null,
      isDeleted: false,
    }
  }

  if (snapshot) {
    return {
      characterId: null,
      name: snapshot.displayName || '已删除用户',
      handle: snapshot.handle ?? '',
      avatarAssetId: snapshot.avatarAssetId ?? null,
      isDeleted: true,
    }
  }

  return { characterId: null, name: '已删除用户', handle: '', avatarAssetId: null, isDeleted: true }
}

export function chatIdentityOf(work, appId, characterId) {
  const character = characterId ? work.characters.find((c) => c.id === characterId) : null
  if (!character) return null
  const account = (work.platformAccounts ?? []).find(
    (a) => a.characterId === characterId && a.platform === appId,
  )
  let name = character.name
  if (appId === 'messages') {
    name = contactNameOf(work, characterId) ?? account?.displayName ?? character.name
  } else if (appId === 'kakaotalk') {
    name = account?.displayName ?? character.name
  }
  return {
    name,
    avatarAssetId: account?.avatarAssetId || character.avatarAssetId || null,
  }
}

/** 角色在通讯录里的备注名；没入通讯录或备注空白返回 null（调用方自行回退） */
function contactNameOf(work, characterId) {
  if (!characterId) return null
  const contact = (work.appData?.phone?.contacts ?? []).find((c) => c.characterId === characterId)
  const name = String(contact?.name ?? '').trim()
  return name || null
}

/** 会话内最后一条消息（按数组物理顺序）；无消息返回 null */
function lastMessageOf(messages) {
  if (messages.length === 0) return null
  return messages[messages.length - 1]
}

/**
 * 会话列表。
 *
 * ownerCharacterId 只影响"会话在列表里叫什么、挂谁的头像"：
 * 单人会话的标题应当是**对方**的名字，而不是「我、对方」这种拼接，
 * 头像也不该是自己的。没传 owner 时退回"拼所有参与者"的旧行为 ——
 * 编辑器侧不需要传，它只关心顺序与计数。
 *
 * @returns {Array<{
 *   id, title, avatarAssetId, participantIds, pinned,
 *   preview, timeLabel, messageCount
 * }>}
 */
export function buildConversationList(work, appId, { timeFormat = 'h24', storyDate = null, ownerCharacterId = null } = {}) {
  const bucket = work.appData?.[appId] ?? {}
  const conversations = bucket.conversations ?? []
  const messages = bucket.messages ?? []

  const byConv = new Map()
  for (const m of messages) {
    if (!byConv.has(m.conversationId)) byConv.set(m.conversationId, [])
    byConv.get(m.conversationId).push(m)
  }

  return conversations
    .map((conv) => {
      const list = byConv.get(conv.id) ?? []
      const last = lastMessageOf(list)
      const participants = (conv.participantIds ?? [])
        .map((id) => work.characters.find((c) => c.id === id))
        .filter(Boolean)
      // 「对方」= 参与者里去掉所属人。自己给自己发的会话会得到空数组，
      // 此时退回全部参与者，标题至少能显示自己的名字而不是"未命名会话"。
      const others = ownerCharacterId
        ? participants.filter((p) => p.id !== ownerCharacterId)
        : participants
      const shown = others.length ? others : participants
      // 标题与头像绑平台账号的对外身份（信息=联系人备注、KakaoTalk=KKT 昵称），

      const identities = shown.map((p) => chatIdentityOf(work, appId, p.id))
      const names = identities.map((x) => x?.name ?? '').filter(Boolean)
      // 自定义参与者（营销广告、快递通知）直接用原文当显示名
      const customNames = (conv.customParticipants ?? []).map((n) => String(n)).filter(Boolean)
      const titleParts = [...names, ...customNames]
      return {
        id: conv.id,
        title: conv.title || titleParts.join('、') || '未命名会话',
        avatarAssetId: conv.avatarAssetId ?? identities[0]?.avatarAssetId ?? null,
        participantIds: conv.participantIds ?? [],
        customParticipants: customNames,
        pinned: Boolean(conv.pinned),
        preview: last ? buildPreviewText(last) : '暂无消息',
        timeLabel: last ? formatListTime(last.displayTime, { storyDate, timeFormat }) : '',
        sortKey: last?.displayTime ?? conv.sortKey ?? '',
        messageCount: list.length,
      }
    })
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      return String(b.sortKey).localeCompare(String(a.sortKey))
    })
}

/**
 * 会话列表的预览文案。
 *
 * 媒体类消息（图片 / 贴图 / 语音 / 通话）给一句占位而不是空串：列表里一行空白
 * 会让人以为最后一条是脏数据。系统消息没有发送者，但它的正文正是
 * 「谁邀请了谁」这类信息，直接显示原文比占位更有用。
 */
function buildPreviewText(message) {
  const type = message.contentType ?? 'text'
  if (type === 'image') return '[图片]'
  if (type === 'sticker') return '[贴图]'
  if (type === 'voice') return '[语音]'
  if (type === 'call') return message.callKind === 'video' ? '[视频通话]' : '[语音通话]'
  const text = String(message.content ?? '').replace(/\s+/g, ' ').trim()
  return text.length > 40 ? `${text.slice(0, 40)}…` : text || '（空消息）'
}

/**
 * 会话详情的时间线。
 * 返回混合数组：{ kind: 'divider', label } | { kind: 'message', ... }
 */
export function buildThread(work, conversationId, { ownerCharacterId = null, storyDate = null } = {}) {
  const appId = findConversationApp(work, conversationId)
  if (!appId) return []
  // 消息先后由数组物理顺序决定（displayTime 只决定气泡显示几点几分，不参与排序）
  const messages = (work.appData?.[appId]?.messages ?? []).filter(
    (m) => m.conversationId === conversationId,
  )

  const timeline = []
  let lastDayKey = null

  for (const m of messages) {
    const date = m.displayTime ? new Date(m.displayTime) : null
    const dayKey = date ? `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}` : 'unknown'

    if (dayKey !== lastDayKey && date) {
      timeline.push({
        kind: 'divider',
        id: `d_${dayKey}`,
        label: formatDayDividerStamp(date, storyDate),

        date,
      })
      lastDayKey = dayKey
    }

    /*
     * 系统消息（「A 邀请 B 加入群聊」这类）不进左右气泡：真机是居中的一行灰字。
     * 在这一层就分流成 kind:'system'，而不是让渲染端拿着 side / avatar 去特判 ——
     * 它本来就没有发送者，也没有"谁在左边"这回事。
     */
    if (m.contentType === 'system') {
      timeline.push({
        kind: 'system',
        id: m.id,
        content: String(m.content ?? ''),
        displayTime: m.displayTime,
      })
      continue
    }

    const author = resolveAuthor(work, {
      characterId: m.senderCharacterId,
      accountId: m.senderAccountId,
      snapshot: m.snapshot,
      senderName: m.senderName,
    })
    // 联系人备注绑定只对信息应用生效（KakaoTalk 走账号昵称，见 resolveAuthor）。

    if (appId === 'messages' && !m.senderName && author.characterId) {
      author.name = contactNameOf(work, author.characterId) ?? author.name
    }

    timeline.push({
      kind: 'message',
      id: m.id,
      side: ownerCharacterId && m.senderCharacterId === ownerCharacterId ? 'right' : 'left',
      authorName: author.name,
      avatarAssetId: author.avatarAssetId,
      avatarHidden: !author.avatarAssetId,
      contentType: m.contentType,
      content: m.content,
      mediaAssetIds: m.mediaAssetIds ?? [],
      /**
       * 语音时长（秒）。只有 contentType==='voice' 时有意义，
       * 但这里对所有消息都透传 null —— 让渲染端拿到稳定形状，
       * 不用先判类型再决定这个字段存不存在。
       */
      durationSec: Number.isFinite(m.durationSec) ? m.durationSec : null,
      /**
       * 语音转写。与 durationSec 同一个处理方式：对所有消息透传，
       * 非 voice 消息恒为空串 —— 渲染端不用先判类型再决定字段存不存在。
       * 空串是「没填」，作品端据此不画「转」按钮。
       */
      transcript: typeof m.transcript === 'string' ? m.transcript : '',
      /**
       * 通话子维度。与 durationSec 同一个处理方式：对所有消息透传，
       * 非 call 消息恒为 null —— 渲染端拿到稳定形状，不用先判类型再决定字段存不存在。
       */
      callKind: m.callKind === 'voice' || m.callKind === 'video' ? m.callKind : null,
      callStatus: m.callStatus === 'completed' || m.callStatus === 'missed' ? m.callStatus : null,
      timeLabel: date ? formatDayDivider(date, storyDate) && formatHourMinute(date) : '',
      displayTime: m.displayTime,
      /**
       * 「20:42 已读」，给聊天页挂在我方消息下方用。
       * 打的是**已读时刻**而不是发送时刻 —— 两者常常不同，
       * 而"隔了多久才看"正是这个字段存在的理由。
       */
      readLabel: buildReadLabel(m.readAt),
    })
  }

  return timeline
}

function formatHourMinute(date) {
  return `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`
}

/**
 * 已读回执文案。没填 readAt（或填了脏值）一律返回空串，
 * 让读取端"不渲染"而不是渲染一句「已读」却不知道什么时候读的。
 */
function buildReadLabel(readAt) {
  if (!readAt) return ''
  const date = new Date(readAt)
  if (!Number.isFinite(date.getTime())) return ''
  return `${formatHourMinute(date)} 已读`
}

function findConversationApp(work, conversationId) {
  for (const [appId, bucket] of Object.entries(work.appData ?? {})) {
    if ((bucket.conversations ?? []).some((c) => c.id === conversationId)) return appId
  }
  return null
}

/** 供编辑端使用：统计某角色被多少条内容引用 */
export function countCharacterUsage(sourceProject, characterId) {
  let messages = 0
  let posts = 0
  let comments = 0
  let videos = 0
  let events = 0

  for (const bucket of Object.values(sourceProject.appData ?? {})) {
    for (const m of bucket.messages ?? []) if (m.senderCharacterId === characterId) messages += 1
    for (const p of bucket.posts ?? []) if (p.authorCharacterId === characterId) posts += 1
    for (const c of [...(bucket.comments ?? []), ...(bucket.replies ?? [])]) {
      if (c.authorCharacterId === characterId) comments += 1
    }
    for (const v of bucket.videos ?? []) if (v.channelCharacterId === characterId) videos += 1
    for (const e of bucket.events ?? []) if ((e.participantIds ?? []).includes(characterId)) events += 1
  }

  const conversations = countConversations(sourceProject, characterId)

  return {
    messages,
    posts,
    comments,
    videos,
    events,
    conversations,
    total: messages + posts + comments + videos + events + conversations,
  }
}

function countConversations(sourceProject, characterId) {
  let n = 0
  for (const bucket of Object.values(sourceProject.appData ?? {})) {
    for (const c of bucket.conversations ?? []) {
      if ((c.participantIds ?? []).includes(characterId)) n += 1
    }
  }
  return n
}

export { dayRelation }
