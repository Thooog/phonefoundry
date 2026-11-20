import { createChatOperations } from './chat-operations.js'
/**
 * 「信息（iMessage）」应用的编辑操作 —— 会话 + 消息，纯函数，入参是 project store。
 *
 * 与其他 editing/*.js 同一套约定（见 photos.js 文件头）：
 *   · 只换引用，不原地改数组
 *   · 一次操作一次 mutate，revision 只涨一次
 *   · 可写字段走白名单，id 与 createdAt 不给改
 *
 * 三处刻意的设计：
 *
 * 1. **会话参与者只存「对方」，不存「手机所属人」。**
 *    消息气泡的左右侧（右侧 = 所属人、左侧 = 对方）由 workSettings.ownerCharacterId
 *    在作品端判定，而所属人是**可随时切换**的。如果把某个人写死成「我」塞进
 *    participantIds，切换所属人之后所有会话的左右都会乱。所以这里 participantIds
 *    只装对话的对方，谁是「我」永远从作品设置读。
 *
 * 2. **消息发送者只能从「本会话参与者」里选** —— 角色，或自定义参与者。
 *    否则会出现「这条消息的发件人根本不在这个对话里」的脏数据。
 *    作品端 buildThread 只按 senderCharacterId 解析名字，不校验他是否在 participantIds
 *    里 —— 那是读取端的宽松，编辑端要在这里把好关。
 *    自定义参与者（customParticipants）是给「发信人根本不是角色」的场景准备的：
 *    营销广告、快递通知。消息用 senderName 指向其中一项，senderCharacterId 留空。
 *
 * 3. **改参与者要清掉「已不在会话里的发送者」的消息。**
 *    同 deleteContact 连带删通话的语义：参与者从会话里移除后，
 *    他名下的消息就成了孤儿（作品端会渲染出一个"这人不在对话里"的怪异气泡）。
 *    两类参与者各查各的：收缩角色参与者只清角色消息，收缩自定义参与者只清 senderName 消息，
 *    互不误伤 —— senderName 消息的 senderCharacterId 是 null，旧规则会把它当孤儿误删。
 */
import { createConversation, createMessage } from '@phone-sim/shared'

const APP = 'messages'
const { nearAnchor, ensureBucket, conversationsOf, threadOf, deleteConversation, countMessagesOf, deleteMessage, retimeMessage } = createChatOperations(APP)
export { conversationsOf, threadOf, deleteConversation, countMessagesOf, deleteMessage, retimeMessage }

/** 标题上限。会话列表是单行，太长会被截断 */
export const CONVERSATION_TITLE_MAX_LENGTH = 40

/** 单条消息正文上限。iMessage 一条消息通常就一两句，太长会撑爆气泡 */
export const MESSAGE_CONTENT_MAX_LENGTH = 2000

/** 自定义参与者/发送者的长度上限。它要么是个号码要么是个短名号，30 字足够 */
export const CUSTOM_SENDER_MAX_LENGTH = 30

/** 一个会话最多几个自定义参与者。真会话不会这么多，防的是粘贴事故 */
export const CUSTOM_SENDER_MAX_COUNT = 8

/**
 * 消息类型白名单（信息应用）。
 *
 * 作品端按 contentType 选择气泡内容（文字 / 图片），所以这里必须是**封闭集合**：
 * 不认识的类型一律回落 text，而不是原样写进去让作品端去猜。
 *
 * 信息应用只有文本与图片两种。语音 / 贴图 / 系统消息是 KakaoTalk 的形态，
 * 各自的类型集合在 `kakaotalk.js` 的 `KT_MESSAGE_TYPES` 里 —— 两个应用共用
 * 「类型转移时清什么」的规则（见 typeCleanupFor），但**允许的类型各管各的**：
 * 把 voice 写进信息应用，作品端既没有语音条也没有兜底，只会渲染出一个空气泡。
 */
export const MESSAGE_TYPES = ['text', 'image']

/**
 * 用媒体的消息类型。「贴图」也是媒体 —— 它就是一张透明背景的图，
 * 区别只在渲染时不出气泡、不留内边距（见 KakaoTalk 作品端）。
 */
export const MEDIA_MESSAGE_TYPES = ['image', 'sticker']

/**
 * 用正文的消息类型。
 *
 * 图片 / 贴图 / 语音的正文恒为空：一条消息只有一种内容载体，
 * 让「文字 + 图」共存会做出一句配图的怪异气泡（iMessage 也不是这个语义）。
 * 系统消息反过来 —— 它只有正文，没有媒体也没有发送者。
 */
export const PROSE_MESSAGE_TYPES = ['text', 'system']

/**
 * 语音时长上限（秒）。10 分钟：再长就不像"按住说一条"了。
 * 下限取 1 秒（见 normalizeDuration），0 秒的语音条画不出波形。
 */
export const MESSAGE_DURATION_MAX = 600

/**
 * 时长清洗：非法值 → null（表示未填），小数取整，越界夹到 [1, 600]。
 *
 * 返回 null 而不是 0 是有意的：0 在界面上是一条画不出波形的语音条，
 * null 让渲染端退到默认长度，看得出"这条还没填时长"。
 */
export function normalizeDuration(value) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return Math.min(Math.max(Math.round(n), 1), MESSAGE_DURATION_MAX)
}

/**
 * 通话时长清洗。与语音共用 durationSec，但**不设上限**。
 *
 * 语音条的 600 秒来自「按住说一条」的物理上限；通话是另一回事 ——
 * 打着电话聊两小时很正常，拿语音的上限去夹会把真实时长截成 10 分钟。
 * 下限仍是 1 秒（0 秒的通话记录没有意义），非法值 → null（未填）。
 */
export function normalizeCallDuration(value) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return Math.max(Math.round(n), 1)
}

/**
 * 类型转移时要清掉什么。
 *
 * 按「目标类型带不带这种载体」判定，而不是按 from→to 枚举 ——
 * 5 种类型两两组合是 20 条转移，枚举法必然漏。
 *
 * `clearTranscript` 与 `clearDuration` 是同一类规则：转写依附在语音上，
 * 切成别的类型就没有载体了；留着它，再次切回语音时会冒出一段
 * 谁也不记得什么时候写的文字。
 *
 * 例外：时长被语音与通话**共用**（通话气泡尾部打的也是它），
 * voice ↔ call 互切不清时长 —— 用户只是换个说法，把 323 秒清掉反而是丢数据。
 *
 * @param {string} target 目标 contentType
 * @returns {{clearMedia: boolean, clearContent: boolean, clearDuration: boolean,
 *           clearTranscript: boolean, clearCall: boolean}}
 */
export function typeCleanupFor(target) {
  return {
    clearMedia: !MEDIA_MESSAGE_TYPES.includes(target),
    clearContent: !PROSE_MESSAGE_TYPES.includes(target),
    clearDuration: target !== 'voice' && target !== 'call',
    clearTranscript: target !== 'voice',
    clearCall: target !== 'call',
  }
}

/**
 * 一条消息最多带几张图。
 *
 * 9 张 = 九宫格：聊天里一次发一个相册，作品端正好排成 3×3 的正方形。
 * 再多就没有形状了（10 张会留一个孤零零的第四行），所以到 9 封顶。
 * 注意：这个上限只约束**结构**，图片能不能展示开是版式的事，
 * 由作品端按张数选列数（2 / 4 张两列，其余三列）。
 */
export const MESSAGE_MEDIA_MAX = 9

const nowIso = () => new Date().toISOString()

/** 相邻两条消息之间的最小时间间隔（毫秒）。新消息时间贴着锚点，只挪这一点点。 */

/** 拿到信息桶，缺什么补什么（导入的项目可能只有一部分桶） */

/* ── 会话 ─────────────────────────────────────── */

const CONVERSATION_EDITABLE = ['title', 'participantIds', 'customParticipants', 'pinned']

/**
 * 自定义参与者入参清洗：去空白、去空项、去重、限长限数。
 * 它是自由文本，不清洗的话同一个号码能加两遍，或塞进来一行粘贴的长文。
 */
function normalizeCustomParticipants(value) {
  const list = Array.isArray(value) ? value : []
  const seen = new Set()
  const clean = []
  for (const item of list) {
    const name = String(item ?? '').trim().slice(0, CUSTOM_SENDER_MAX_LENGTH)
    if (!name || seen.has(name)) continue
    seen.add(name)
    clean.push(name)
    if (clean.length >= CUSTOM_SENDER_MAX_COUNT) break
  }
  return clean
}

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
 * 编辑端只看顺序与内容，不传 ownerCharacterId（见文件头第 1 点）。
 *
 * @param {object} project
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
    customParticipants: normalizeCustomParticipants(input.customParticipants),
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
 * 改 participantIds 时，把「已不在会话里的发送者」的消息一并清掉（见文件头第 3 点）。
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
  if (clean.customParticipants !== undefined) {
    clean.customParticipants = normalizeCustomParticipants(clean.customParticipants)
  }

  let updated = null
  let removedMessages = 0
  editor.mutate((draft) => {
    const bucket = ensureBucket(draft)
    bucket.conversations = bucket.conversations.map((conv) => {
      if (conv.id !== conversationId) return conv
      updated = { ...conv, ...clean, updatedAt: nowIso() }
      return updated
    })

    const ownerId = draft.workSettings?.ownerCharacterId ?? null

    // 角色参与者收缩 → 清掉已不在会话里的**角色**消息。
    // 所属人（全局身份，不在 participantIds 里）发的消息永远保留；
    // 自定义发送者（senderName）的消息 senderCharacterId 为 null，本来就走 !senderCharacterId
    // 分支保留，不受这里影响。
    if (clean.participantIds !== undefined) {
      const allowed = new Set(clean.participantIds)
      const kept = bucket.messages.filter((m) => {
        if (m.conversationId !== conversationId) return true
        if (m.senderName) return true
        return allowed.has(m.senderCharacterId) || !m.senderCharacterId || m.senderCharacterId === ownerId
      })
      removedMessages += bucket.messages.length - kept.length
      bucket.messages = kept
    }

    // 自定义参与者收缩 → 清掉 senderName 已不在列表里的消息。
    // 角色消息（senderName 为空）不受影响；所属人如果被写成了自定义发送者，保留。
    // 注意 ownerId 可能是 null（还没设置所属人），必须显式判空 ——
    // 否则 null === null 会把「没有角色发送者」的自定义消息误当成所属人的。
    if (clean.customParticipants !== undefined) {
      const allowed = new Set(clean.customParticipants)
      const kept = bucket.messages.filter((m) => {
        if (m.conversationId !== conversationId) return true
        if (!m.senderName) return true
        return allowed.has(m.senderName) || (ownerId !== null && m.senderCharacterId === ownerId)
      })
      removedMessages += bucket.messages.length - kept.length
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

const MESSAGE_EDITABLE = [
  'senderCharacterId',
  'senderName',
  'content',
  'contentType',
  'mediaAssetIds',
  'displayTime',
  'readAt',
]

/**
 * 消息媒体清洗：只留字符串 id、去重、截断到上限。
 * 资源 id 是不透明的，这里只做结构校验 —— 是否存在由回收逻辑兜底。
 * 导出给 kakaotalk.js 复用，避免两个应用的消息媒体规则漂移。
 */
export function normalizeMessageMediaIds(value) {
  const list = Array.isArray(value) ? value : []
  const out = []
  for (const id of list) {
    if (typeof id !== 'string' || !id || out.includes(id)) continue
    out.push(id)
    if (out.length >= MESSAGE_MEDIA_MAX) break
  }
  return out
}

/** senderName 清洗：空串当 null（作品端按「没有自定义发送者」处理） */
function normalizeSenderName(value) {
  const name = String(value ?? '').trim().slice(0, CUSTOM_SENDER_MAX_LENGTH)
  return name || null
}

function pickMessageEditable(patch) {
  const clean = {}
  for (const key of MESSAGE_EDITABLE) {
    if (patch?.[key] !== undefined) clean[key] = patch[key]
  }
  return clean
}

export function addMessage(editor, conversationId, input = {}) {
  const project = editor.project
  const bucket = project?.appData?.[APP] ?? {}
  const conversation = (bucket.conversations ?? []).find((c) => c.id === conversationId)
  if (!conversation) return null

  // 发送者：显式传入 > 默认取第一个角色参与者 > 第一个自定义参与者 > 留空
  let sender = input.senderCharacterId ?? null
  let senderName = normalizeSenderName(input.senderName)
  if (input.senderCharacterId === undefined && input.senderName === undefined) {
    const firstCharacter = conversation.participantIds?.[0] ?? null
    if (firstCharacter) {
      sender = firstCharacter
    } else {
      senderName = normalizeSenderName(conversation.customParticipants?.[0])
    }
  }
  if (senderName) sender = null

  // 决定 displayTime：显式传入 > 锚点时间 ±STEP > 末尾最后一条 +STEP > 当前时刻
  const all = bucket.messages ?? []
  const thread = all.filter((m) => m.conversationId === conversationId)
  let displayTime = input.displayTime
  if (!displayTime) {
    if (input.afterId || input.beforeId) {
      const anchor = thread.find((m) => m.id === input.afterId || m.id === input.beforeId)
      const dir = input.afterId ? 1 : -1
      displayTime = nearAnchor(anchor?.displayTime, dir)
    } else if (thread.length) {
      const last = thread[thread.length - 1]
      displayTime = nearAnchor(last.displayTime, 1)
    }
  }

  const message = createMessage(conversationId, {
    senderCharacterId: sender,
    senderName,
    content: String(input.content ?? '').slice(0, MESSAGE_CONTENT_MAX_LENGTH),
    ...(displayTime ? { displayTime } : {}),
    // 新建默认还是纯文本；带图消息由「消息类型」切过去，这里只是把入口留好
    ...(input.contentType && MESSAGE_TYPES.includes(input.contentType)
      ? { contentType: input.contentType }
      : {}),
    ...(input.mediaAssetIds ? { mediaAssetIds: normalizeMessageMediaIds(input.mediaAssetIds) } : {}),
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
 * senderCharacterId 传 null 是有效修改（解除发送者）。readAt 传 null 表示「未读」，
 * 传 ISO 表示「对方在这个时刻已读」。senderName 与 senderCharacterId 互斥：
 * 传 senderName（非空）时自动解除角色发送者，传 senderCharacterId（非空）时清掉 senderName。
 *
 * contentType 与 content / mediaAssetIds 互斥，但只在**类型发生转移**时互斥：
 * text → image 清正文，image → text 清媒体；同一次 patch 里显式给了目标字段则以显式值为准。
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
  if (clean.mediaAssetIds !== undefined) clean.mediaAssetIds = normalizeMessageMediaIds(clean.mediaAssetIds)
  if (clean.contentType !== undefined) {
    // 白名单：不认识的类型回落 text，绝不把脏值写进去让作品端去猜
    clean.contentType = MESSAGE_TYPES.includes(clean.contentType) ? clean.contentType : 'text'

    /*
     * 类型互斥按**转移**判定，不是按终态判定：
     *   · 切到不带媒体的类型（文本 / 语音 / 系统）→ 清掉媒体引用
     *   · 切到不带正文的类型（图片 / 贴图 / 语音）→ 清掉正文
     *   · 切离语音 → 清掉时长（0:03 挂在一条文本消息上没有任何意义）
     * 三件事都**在同一个 patch 里显式给了目标字段时不覆盖** ——
     * 否则「同时传 contentType:'image' 和 content」会被自己清空，调用方看着像丢数据。
     */
    const previous = (editor.project?.appData?.[APP]?.messages ?? []).find((m) => m.id === messageId)
    const from = previous?.contentType ?? 'text'
    if (from !== clean.contentType) {
      const { clearMedia, clearContent, clearDuration } = typeCleanupFor(clean.contentType)
      if (clearContent && clean.content === undefined) clean.content = ''
      if (clearMedia && clean.mediaAssetIds === undefined) clean.mediaAssetIds = []
      if (clearDuration && clean.durationSec === undefined) clean.durationSec = null
    }
  }
  if (clean.senderName !== undefined) {
    clean.senderName = normalizeSenderName(clean.senderName)
    // 互斥只在一侧触发：传 senderName 就解除角色；清空 senderName 不动角色
    if (clean.senderName) clean.senderCharacterId = null
  }
  if (clean.senderCharacterId) clean.senderName = null

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

/* ── 导入对话 ─────────────────────────────────── */

/**
 * 粘贴导入的「文本 -> 结构」层已经搬到 `editing/chat-import.js` —— KakaoTalk 用的是同一套
 * 模板语法（角色名：内容 + 行尾时刻 + 未标注行 +20 秒），一套语法不能有两份实现。
 *
 * 这里 **原样转发**，让 messages.js 对外的名字一个都不少。这样做的目的不只是省事：
 * 一旦有人删掉这行转发，editing/__tests__/messages.test.js 那 21 条会立刻变红 ——
 * 转发线断掉这件事是被单测钉住的。
 *
 * KakaoTalk 侧直接 `import { parseConversationText } from './chat-import.js'`。
 *
 * 两种尾缀的**采用**仍由各自决定：信息的作品端读 readAt（自己发出的消息显示「XX 已读」），
 * KakaoTalk 的作品端根本不读，所以 KakaoTalk 编辑器不写这个字段 ——
 * 但不影响这里统一解析：解析是语法层的事，用不用是应用语义层的事。
 *
 * @see ./chat-import.js
 */
export {
  IMPORT_STEP_MS,
  parseConversationText,
  parseDateLine,
  resolveImportTimes,
} from './chat-import.js'
