import { createChatOperations } from './chat-operations.js'

import { createConversation, createMessage } from '@phone-sim/shared'
import {
  MESSAGE_MEDIA_MAX,
  normalizeDuration,
  normalizeMessageMediaIds,
  typeCleanupFor,
} from './messages.js'

const APP = 'kakaotalk'
const { nearAnchor, ensureBucket, conversationsOf, threadOf, deleteConversation, countMessagesOf, deleteMessage } = createChatOperations(APP)
export { conversationsOf, threadOf, deleteConversation, countMessagesOf, deleteMessage }

/**
 * KakaoTalk 能发哪几种消息。
 *
 * 比信息应用多四种，都是这个应用里真实存在、且作品端有对应渲染的形态：
 *   · voice   语音 —— 波形 + 时长，不真播放（作品是只读的，也没有音频源）
 *   · sticker 贴图 —— 一张透明背景的图，不出气泡、不留内边距
 *   · system  系统消息 —— 居中一行灰字，没有发送者
 *   · call    通话 —— 图标 + 「语音/视频通话」+ 时长或未接通标注
 *
 * 仍然要求是**封闭集合**：不认识的值一律回落 text，而不是写进去让作品端去猜。
 * 加类型时三处必须同时改：这里、作品端 KakaoTalkApp 的渲染分支、编辑器的类型下拉
 * （下拉直接遍历这个数组，所以第三处是自动的）。
 */
export const KT_MESSAGE_TYPES = ['text', 'image', 'voice', 'sticker', 'system', 'call']

/**
 * 通话消息的两个子维度。只对 contentType==='call' 有意义，别的类型恒为 null。
 *
 *   · callKind   语音 / 视频 —— 决定气泡里的图标和文案
 *   · callStatus 已接通 / 未接通 —— 已接通尾部打时长；未接通不带时长，
 *     文案由作品端按气泡所在侧自动定（发起方=「已取消」、接听方=「未接听」），
 *     编辑端不用替用户二选一 —— 一条「未接通」记录左右两侧看到的话本来就不同。
 */
export const CALL_KINDS = ['voice', 'video']
export const CALL_STATUSES = ['completed', 'missed']

/** 贴图只用一张 —— 真机一次发一个表情，多张就不是贴图了 */
export const STICKER_MEDIA_MAX = 1

/** 标题上限。会话列表是单行，太长会被截断 */
export const CONVERSATION_TITLE_MAX_LENGTH = 40

/** 单条消息正文上限 */
export const MESSAGE_CONTENT_MAX_LENGTH = 2000

/**
 * 语音转写的长度上限。
 *
 * 比正文短得多：一条语音的转写通常就一两句，500 字已经远超一个气泡能显示的量。
 * 上限的作用是防粘贴事故（把整篇文章粘进转写框），不是限制表达。
 */
export const MESSAGE_TRANSCRIPT_MAX_LENGTH = 500

/**
 * 转写清洗：去首尾空白、限长。
 * 空串是合法的「没有转写」—— 不返回 null，省得渲染端要判两种空值。
 */
function normalizeTranscript(value) {
  return String(value ?? '')
    .trim()
    .slice(0, MESSAGE_TRANSCRIPT_MAX_LENGTH)
}

const nowIso = () => new Date().toISOString()

/** 相邻两条消息之间的最小时间间隔（毫秒）。新建时贴着参照消息，只挪这一点点。 */

/** 拿到 KakaoTalk 桶，缺什么补什么（导入的项目可能只有一部分桶） */

/* ── 会话 ─────────────────────────────────────── */

const CONVERSATION_EDITABLE = ['title', 'participantIds', 'pinned']

function pickConversationEditable(patch) {
  const clean = {}
  for (const key of CONVERSATION_EDITABLE) {
    if (patch?.[key] !== undefined) clean[key] = patch[key]
  }
  return clean
}

/**
 * 会话列表，按 sortKey 倒序（新的在前）。
 * 与作品端 buildConversationList 的顺序一致：置顶的在前，其余按最后消息时间倒序。
 *
 * @param {object} project
 */

/**
 * 某会话的消息时间线，**按数组物理顺序**（= 播放顺序）。
 *
 * @param {object} project
 * @param {string} conversationId
 */

/**
 * 新建会话。默认 participantIds 为空 —— 用户先建会话，再加对方。
 *
 * @param {object} editor
 * @param {{title?: string, participantIds?: string[], pinned?: boolean}} [input]
 * @returns {object} 新建的会话记录
 */
export function addConversation(editor, input = {}) {
  const conversation = createConversation(APP, {
    title: String(input.title ?? '').slice(0, CONVERSATION_TITLE_MAX_LENGTH),
    participantIds: [...(input.participantIds ?? [])],
    pinned: Boolean(input.pinned),
  })

  editor.mutate((draft) => {
    const bucket = ensureBucket(draft)
    bucket.conversations = [...bucket.conversations, conversation]
  })

  return conversation
}

/**
 * 改会话。
 *
 * 改 participantIds 时要把「已不在会话里的发送者」的消息一并清掉 ——
 * 同 deleteContact 连带删通话的语义：参与者从会话里移除后，他名下的消息就成了
 * 孤儿，作品端会渲染出一个「这人不在对话里」的怪异气泡。
 *
 * 判定**只看 senderCharacterId**：账号是同一个人的别名，人不在这会话里了账号也跟着失效，
 * 不需要把 senderAccountId 也拉进判定条件。
 *
 * @param {object} editor
 * @param {string} conversationId
 * @param {object} patch
 * @returns {{updated: object|null, removedMessages: number}}
 */
export function updateConversation(editor, conversationId, patch) {
  const clean = pickConversationEditable(patch)
  if (Object.keys(clean).length === 0) return { updated: null, removedMessages: 0 }

  if (clean.title !== undefined) clean.title = String(clean.title).slice(0, CONVERSATION_TITLE_MAX_LENGTH)
  if (clean.participantIds !== undefined) clean.participantIds = [...clean.participantIds]

  let updated = null
  let removedMessages = 0
  editor.mutate((draft) => {
    const bucket = ensureBucket(draft)
    bucket.conversations = bucket.conversations.map((conv) => {
      if (conv.id !== conversationId) return conv
      updated = { ...conv, ...clean, updatedAt: nowIso() }
      return updated
    })

    if (clean.participantIds !== undefined) {
      const allowed = new Set(clean.participantIds)
      const ownerId = draft.workSettings?.ownerCharacterId ?? null
      const kept = bucket.messages.filter((m) => {
        if (m.conversationId !== conversationId) return true
        return allowed.has(m.senderCharacterId) || !m.senderCharacterId || m.senderCharacterId === ownerId
      })
      removedMessages = bucket.messages.length - kept.length
      bucket.messages = kept
    }
  })

  return { updated, removedMessages }
}

/**
 * 删会话，连带删掉挂在它名下的所有消息。
 *
 * @param {object} editor
 * @param {string} conversationId
 * @returns {{removed: boolean, removedMessages: number}}
 */

/** 该会话下有多少条消息 —— 删除确认框要说清楚会连带删掉多少。 */

/* ── 消息 ─────────────────────────────────────── */

/**
 * 可写字段。**刻意没有 readAt** —— KakaoTalk 的作品端不渲染已读回执，
 * 允许写入只会产出看不见的脏数据（对比 messages.js，它那边读这个字段）。
 */
const MESSAGE_EDITABLE = [
  'senderCharacterId',
  'senderAccountId',
  'content',
  'contentType',
  'mediaAssetIds',
  'durationSec',
  'transcript',
  'callKind',
  'callStatus',
  'displayTime',
]

function pickMessageEditable(patch) {
  const clean = {}
  for (const key of MESSAGE_EDITABLE) {
    if (patch?.[key] !== undefined) clean[key] = patch[key]
  }
  return clean
}

/**
 * 角色 → 它在 KakaoTalk 的账号 id。
 *
 * 这是「为什么要独立于 messages.js」的核心：作品端的作者名解析里，
 * `senderAccountId` 对应的平台昵称优先于角色名。同一个人在 KakaoTalk 里叫的
 * 名字和角色本名经常不一样（群聊里尤其明显），不写这个 id 就永远显示本名。
 *
 * 没有账号时返回 null —— 作品端会顺势回退到角色名，不算错，所以不做报错。
 *
 * @param {object} project
 * @param {string|null} characterId
 * @returns {string|null}
 */
export function resolveSenderAccount(project, characterId) {
  if (!characterId) return null
  const account = (project?.platformAccounts ?? []).find(
    (a) => a.characterId === characterId && a.platform === APP,
  )
  return account?.id ?? null
}

/**
 * 新建消息。
 *
 * 默认发送者 = 会话里第一个参与者（对方），没有参与者则留空（UI 会提示先加参与者）。
 * 一场对话通常由对方先开口，所以默认是对方而不是所属人。
 *
 * **senderAccountId 在这条路径同样要写**（不只是改发送者时）—— 用默认发送者新建出来的
 * 消息如果不带账号，用户什么都没做就已经丢了昵称，这是最容易漏的一个入口。
 *
 * displayTime 规则（与 messages.js 同一做法）：
 *   · 传 afterId → 时间 = 锚点时间 + 1s；传 beforeId → 锚点时间 − 1s。
 *   · 都不传（追加末尾）→ 会话最后一条时间 + 1s；会话为空才退回当前时刻。
 * 只差 1 秒是为了避免与参照消息时间完全相同导致渲染端抖动，同时肉眼上看不出来。
 * 显式传 displayTime（如导入）时以传入值为准。
 *
 * @param {object} editor
 * @param {string} conversationId
 * @param {{senderCharacterId?: string|null, content?: string,
 *          contentType?: 'text'|'image'|'voice'|'sticker'|'system'|'call',
 *          mediaAssetIds?: string[], durationSec?: number, transcript?: string,
 *          callKind?: 'voice'|'video', callStatus?: 'completed'|'missed',
 *          displayTime?: string, afterId?: string, beforeId?: string}} [input]
 * @returns {object|null} 新建的消息；会话不存在时返回 null
 */
export function addMessage(editor, conversationId, input = {}) {
  const project = editor.project
  const bucket = project?.appData?.[APP] ?? {}
  const conversation = (bucket.conversations ?? []).find((c) => c.id === conversationId)
  if (!conversation) return null

  // 类型先定下来：它决定这条消息要不要发送者（系统消息没有）
  const type = KT_MESSAGE_TYPES.includes(input.contentType) ? input.contentType : 'text'
  /*
   * 系统消息不挂发送者。真机那行灰字说的是「A 邀请 B 加入群聊」——
   * 主语和宾语都在正文里，不是"某人发出的一条消息"。
   * 如果照默认逻辑填上对方，作品端会看到一个带作者的系统提示，
   * 而且分组逻辑还会把前后两条连发拆开（见 sameSender）。
   */
  const isSystem = type === 'system'
  const sender = isSystem ? null : (input.senderCharacterId ?? conversation.participantIds?.[0] ?? null)
  const senderAccount = isSystem ? null : (input.senderAccountId ?? resolveSenderAccount(project, sender))

  // 决定 displayTime：显式传入 > 锚点时间 ±STEP > 末尾最后一条 +STEP > 当前时刻
  const thread = (bucket.messages ?? []).filter((m) => m.conversationId === conversationId)
  let displayTime = input.displayTime
  if (!displayTime) {
    if (input.afterId || input.beforeId) {
      const anchor = thread.find((m) => m.id === input.afterId || m.id === input.beforeId)
      displayTime = nearAnchor(anchor?.displayTime, input.afterId ? 1 : -1)
    } else if (thread.length) {
      displayTime = nearAnchor(thread[thread.length - 1].displayTime, 1)
    }
  }

  const message = createMessage(conversationId, {
    senderCharacterId: sender,
    senderAccountId: senderAccount,
    contentType: type,
    content: String(input.content ?? '').slice(0, MESSAGE_CONTENT_MAX_LENGTH),
    ...(displayTime ? { displayTime } : {}),
    ...(input.mediaAssetIds ? { mediaAssetIds: normalizeMessageMediaIds(input.mediaAssetIds) } : {}),
    // 时长与转写只对语音有意义，别的类型写进去是看不见的脏数据
    ...(type === 'voice'
      ? { durationSec: normalizeDuration(input.durationSec), transcript: normalizeTranscript(input.transcript) }
      : {}),
    // 通话只带自己的两个子维度；时长仅「已接通」有意义 —— 未接通的通话没有时长可打
    ...(type === 'call'
      ? (() => {
          const kind = CALL_KINDS.includes(input.callKind) ? input.callKind : 'voice'
          const status = CALL_STATUSES.includes(input.callStatus) ? input.callStatus : 'completed'
          return {
            callKind: kind,
            callStatus: status,
            ...(status === 'completed' ? { durationSec: normalizeDuration(input.durationSec) } : {}),
          }
        })()
      : {}),
  })

  editor.mutate((draft) => {
    const draftBucket = ensureBucket(draft)
    // 物理位置决定先后：默认追加到末尾；传 afterId/beforeId 时插到锚点前/后。
    const list = draftBucket.messages
    if (input.afterId || input.beforeId) {
      const idx = list.findIndex((m) => m.id === input.afterId || m.id === input.beforeId)
      const insertAt = idx === -1 ? list.length : input.afterId ? idx + 1 : idx
      draftBucket.messages = [...list.slice(0, insertAt), message, ...list.slice(insertAt)]
    } else {
      draftBucket.messages = [...list, message]
    }
  })

  return message
}

/**
 * 改消息。
 *
 * senderCharacterId 传 null 是有效修改（解除发送者）。**改了发送者会自动同步他的
 * KakaoTalk 账号** —— 否则用户看到的昵称还是上一个人的，属于典型的脏数据。
 *
 * readAt 在白名单之外：即使传进来也会被丢掉。
 *
 * @param {object} editor
 * @param {string} messageId
 * @param {object} patch
 * @returns {object|null}
 */
export function updateMessage(editor, messageId, patch) {
  const clean = pickMessageEditable(patch)
  if (Object.keys(clean).length === 0) return null

  if (clean.content !== undefined) clean.content = String(clean.content).slice(0, MESSAGE_CONTENT_MAX_LENGTH)
  if (clean.durationSec !== undefined) clean.durationSec = normalizeDuration(clean.durationSec)
  if (clean.transcript !== undefined) clean.transcript = normalizeTranscript(clean.transcript)

  // 白名单：不认识的类型回落 text（与 messages.js 同一条规则）
  if (clean.contentType !== undefined) {
    clean.contentType = KT_MESSAGE_TYPES.includes(clean.contentType) ? clean.contentType : 'text'
  }

  const previous = (editor.project?.appData?.[APP]?.messages ?? []).find((m) => m.id === messageId)
  /*
   * 媒体上限看**目标类型**：贴图只留 1 张（多张就不是一个表情了），其余最多 9 张。
   * 用 patch 里的新类型，没有就退到这条消息当前的类型 —— 只加图不改类型的 patch
   * 传进来时 contentType 是 undefined，按 9 张判才对。
   */
  const targetType = clean.contentType ?? previous?.contentType ?? 'text'

  /*
   * 通话子维度按**目标类型**处理，与媒体上限同一逻辑：
   *   · 目标是 call → 白名单清洗（脏值回落默认）；「未接通」顺手清时长，
   *     但同一次 patch 里显式给了时长则以显式值为准。
   *   · 目标不是 call → 传了也是看不见的脏数据，强制清掉。
   */
  if (targetType === 'call') {
    if (clean.callKind !== undefined) clean.callKind = CALL_KINDS.includes(clean.callKind) ? clean.callKind : 'voice'
    if (clean.callStatus !== undefined) {
      clean.callStatus = CALL_STATUSES.includes(clean.callStatus) ? clean.callStatus : 'completed'
      if (clean.callStatus === 'missed' && clean.durationSec === undefined) clean.durationSec = null
    }
  } else if (clean.callKind !== undefined || clean.callStatus !== undefined) {
    clean.callKind = null
    clean.callStatus = null
  }

  if (clean.mediaAssetIds !== undefined) {
    const limit = targetType === 'sticker' ? STICKER_MEDIA_MAX : MESSAGE_MEDIA_MAX
    clean.mediaAssetIds = normalizeMessageMediaIds(clean.mediaAssetIds).slice(0, limit)
  }

  if (clean.contentType !== undefined) {
    // 类型互斥按「转移」判定，且尊重同一次 patch 里的显式值（见 messages.js 的详细注释）
    const from = previous?.contentType ?? 'text'
    if (from !== clean.contentType) {
      const { clearMedia, clearContent, clearDuration, clearTranscript, clearCall } = typeCleanupFor(clean.contentType)
      if (clearContent && clean.content === undefined) clean.content = ''
      if (clearMedia && clean.mediaAssetIds === undefined) clean.mediaAssetIds = []
      if (clearDuration && clean.durationSec === undefined) clean.durationSec = null
      if (clearTranscript && clean.transcript === undefined) clean.transcript = ''
      // 通话子维度只依附在通话上；voice ↔ call 互切不清时长（两者共用载体）
      if (clearCall && clean.callKind === undefined) clean.callKind = null
      if (clearCall && clean.callStatus === undefined) clean.callStatus = null
      // 切到通话时补上默认子维度（与 addMessage 同一默认：语音 + 已接通），
      // 让「切类型」和「新建」产出一致的数据形状，而不是 null 要渲染端再兜一层
      if (clean.contentType === 'call') {
        if (clean.callKind === undefined) clean.callKind = 'voice'
        if (clean.callStatus === undefined) clean.callStatus = 'completed'
      }
    }

    /*
     * 切到系统消息：发送者语义上不存在（正文里已经写了「A 邀请 B」），一并清掉。
     * 切离系统消息时**不自动恢复**发送者 —— 那条灰字本来就没指定是谁，
     * 猜一个填上去反而错，留给用户在下拉里选。
     */
    if (clean.contentType === 'system' && clean.senderCharacterId === undefined) {
      clean.senderCharacterId = null
      clean.senderAccountId = null
    }
  }

  // 换发送者 → 账号跟着换；解除发送者 → 账号一并清空
  if (clean.senderCharacterId !== undefined && clean.senderAccountId === undefined) {
    clean.senderAccountId = resolveSenderAccount(editor.project, clean.senderCharacterId)
  }

  let updated = null
  editor.mutate((draft) => {
    const bucket = ensureBucket(draft)
    bucket.messages = bucket.messages.map((m) => {
      if (m.id !== messageId) return m
      updated = { ...m, ...clean, updatedAt: nowIso() }
      return updated
    })
  })

  return updated
}

/**
 * 删一条消息。
 * @param {object} editor
 * @param {string} messageId
 * @returns {boolean}
 */
