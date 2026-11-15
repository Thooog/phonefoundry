<script setup>
import { useChatImport } from '../../../composables/use-chat-import.js'
/**
 * 「KakaoTalk」编辑页 —— 会话 + 消息 + 粘贴导入对话。
 *
 * 与「信息」编辑器是同源的兄弟（apps/creator/src/components/apps/messages/MessagesEditor.vue）：
 * 两个应用的会话/消息模型完全一样，作品端共用同一套派生函数。这里刻意保持独立一份
 * 而不是抽成带 props 的通用组件 —— 项目和 X / Instagram 编辑器就是这么做的
 * （两个独立组件，只在 editing 层共用 posts.js）。理由也一样：两个应用的 UI 已经在分化，
 * 抽抽象方法会让两边都变得难改。
 *
 * **这个应用与「信息」的三处不同**，决定了下面每一处增删改：
 *
 *   1. **发送者要连带写 KakaoTalk 账号**。作品端的作者名解析里，平台账号昵称优先于
 *      角色本名 —— 群聊里显示的是「유안」而不是「周予安」。所以每条消息除了发送者本身，
 *      还要写 senderAccountId。负责联动的是 editing/kakaotalk.js，这里只负责展示：
 *      发送者下拉带的就是账号昵称，用户选完能直接看到作品里会显示什么。
 *   2. **没有已读回执**。KakaoTalk 的作品端根本不读 readAt，写上也是看不见的脏数据。
 *      数据层（白名单）已经堵死，这里对应的界面也一并删干净 —— 不放一个没用的开关。
 *   3. **消息类型比「信息」多三种**：语音、贴图、系统消息。类型集合来自
 *      editing/kakaotalk.js 的 KT_MESSAGE_TYPES，界面下拉直接遍历它 ——
 *      加类型时只改编辑层那一处，这里自动跟上，不会出现「白名单有、下拉没有」的漂移。
 *      每种类型对应一块专属编辑区（图片/贴图给缩略图行、语音给时长、系统消息只给正文）。
 *
 * 粘贴导入用的模板语法与「信息」完全一致（行尾时刻 + 未标注行 +20 秒），
 * 解析层在 editing/chat-import.js，两个聊天应用共用一份。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import AppButton from '../../ui/AppButton.vue'
import AppUploadButton from '../../ui/AppUploadButton.vue'
import { useProjectStore } from '../../../stores/project.js'
import { useUiStore } from '../../../stores/ui.js'
import { useAssetUrls } from '../../../composables/use-asset-urls.js'
import { prepareImage } from '../../../media/compress-image.js'
import { orphanAssetIds } from '../../../editing/assets.js'
import { fromDateTimeLocal, toDateTimeLocal } from '../../../utils/time.js'
import { parseConversationText, resolveImportTimes } from '../../../editing/chat-import.js'
import { MESSAGE_DURATION_MAX, MESSAGE_MEDIA_MAX } from '../../../editing/messages.js'
import {
  CALL_KINDS,
  CALL_STATUSES,
  KT_MESSAGE_TYPES,
  MESSAGE_CONTENT_MAX_LENGTH,
  MESSAGE_TRANSCRIPT_MAX_LENGTH,
  STICKER_MEDIA_MAX,
  addConversation,
  addMessage,
  conversationsOf,
  countMessagesOf,
  deleteConversation,
  deleteMessage,
  threadOf,
  updateConversation,
  updateMessage,
} from '../../../editing/kakaotalk.js'

const editor = useProjectStore()
const ui = useUiStore()

const readOnly = computed(() => Boolean(editor.readOnlyReason))
const project = computed(() => editor.project)

const conversations = computed(() => conversationsOf(project.value))

/** 当前手机所属人（作品设置里可切换）。编辑端只读展示，不在这里改 */
const owner = computed(() => {
  const id = project.value?.workSettings?.ownerCharacterId ?? null
  return (project.value?.characters ?? []).find((c) => c.id === id) ?? null
})

const characters = computed(() =>
  [...(project.value?.characters ?? [])].sort((a, b) =>
    String(a.name ?? '').localeCompare(String(b.name ?? ''), 'zh-Hans-CN'),
  ),
)

/**
 * 角色下拉的选项：角色 + 它在 KakaoTalk 上的账号昵称。
 *
 * 这是本应用与「信息」编辑器最关键的一处界面差异。「信息」那边带的是 @handle，
 * 因为 iMessage 不读账号；KakaoTalk 读，而且**昵称优先于本名** —— 所以这里显示
 * 昵称，让用户在选发送者的那一刻就看见作品里会出现什么字。
 */
const characterOptions = computed(() =>
  characters.value.map((ch) => {
    const account = (project.value?.platformAccounts ?? []).find(
      (a) => a && a.characterId === ch.id && a.platform === 'kakaotalk',
    )
    return { id: ch.id, name: ch.name, nickname: account?.displayName ?? '' }
  }),
)

/** 下拉选项文案：本名（昵称）—— 没有账号时只显示本名 */
function labelOf(ch) {
  return ch.nickname ? `${ch.name}（${ch.nickname}）` : ch.name
}

/** 会话参与者下拉 = 全部角色（不含所属人；所属人由全局决定，不放进会话） */
const participantOptions = computed(() =>
  characterOptions.value.filter((ch) => ch.id !== (owner.value?.id ?? null)),
)

/* ── 会话 ───────────────────────────────────── */

function createConversation() {
  if (readOnly.value) return
  const conversation = addConversation(editor, {})
  requestAnimationFrame(() => {
    document.querySelector(`[data-conv-id="${conversation.id}"]`)?.scrollIntoView({
      block: 'nearest',
      behavior: 'smooth',
    })
  })
}

function commitTitle(conv, event) {
  updateConversation(editor, conv.id, { title: event.target.value })
}

function commitPinned(conv, next) {
  updateConversation(editor, conv.id, { pinned: Boolean(next) })
}

/** 该会话还能添加的对方 = 全部候选 − 已选 */
function addableParticipants(conv) {
  const chosen = new Set(conv.participantIds ?? [])
  return participantOptions.value.filter((ch) => !chosen.has(ch.id))
}

/* ── 参与方：人数角标 + 常显条带 + 添加弹层（与信息编辑器同一套） ── */

/** Members include the owner once, even if older projects also list them as participants. */
function peopleCountOf(conv) {
  return senderOptions(conv).length
}

/**
 * 人图标的 title。所属人那一行已从卡头删掉（它是作品级设置，不随会话变），
 * 但「谁是我」这条线索不能凭空消失 —— 挂在悬停提示里，不占版面。
 */
function peopleTitle(conv) {
  return `参与方 ${peopleCountOf(conv)} 人 · 所属人 ${owner.value?.name ?? '未设置'}`
}

/** 展开着参与方条带的会话 id 集合（与「展开消息」是两件事，互不影响） */
const peopleOpen = ref(new Set())

function togglePeople(convId) {
  const next = new Set(peopleOpen.value)
  if (next.has(convId)) next.delete(convId)
  else next.add(convId)
  peopleOpen.value = next
}

/** 标题占位符：空标题时直接演出读者会看到的名字（作品里显示的是昵称） */
function titlePlaceholder(conv) {
  const names = participantsOf(conv)
    .map((ch) => ch.nickname || ch.name)
    .filter(Boolean)
  if (!names.length) return '会话标题'
  if (names.length <= 2) return names.join('、')
  return `${names.slice(0, 2).join('、')} 等 ${names.length} 人`
}

/** chip 文案 = 本名（昵称） */
function chipLabelOf(pid) {
  const ch = characterOptions.value.find((item) => item.id === pid)
  return labelOf(ch ?? { id: pid, name: '未知角色', nickname: '' })
}

/** 正在给哪个会话开弹层；null = 没开 */
const addConvId = ref(null)
const addQuery = ref('')
/** 触发按钮的 rect（fixed 定位用） */
const addAnchor = ref(null)
const ADD_WIDTH = 246

/** 弹层定位：贴着「＋ 添加」下方，并在视口里夹紧（窄屏靠右时不会被切） */
const addStyle = computed(() => {
  const a = addAnchor.value
  if (!a) return {}
  const height = 272
  const top = Math.min(a.bottom + 6, Math.max(8, window.innerHeight - height - 8))
  const left = Math.min(Math.max(8, a.left), Math.max(8, window.innerWidth - ADD_WIDTH - 8))
  return { left: `${left}px`, top: `${Math.max(8, top)}px` }
})

function openAdd(conv, event) {
  if (readOnly.value) return
  if (addConvId.value === conv.id) {
    closeAdd()
    return
  }
  addQuery.value = ''
  addAnchor.value = event.currentTarget.getBoundingClientRect()
  addConvId.value = conv.id
}

function closeAdd() {
  addConvId.value = null
  addQuery.value = ''
}

/** 弹层里的候选角色：按搜索词过滤（本名 / 昵称任一命中） */
function popCandidates(conv) {
  const q = addQuery.value.trim().toLowerCase()
  const list = addableParticipants(conv)
  if (!q) return list
  return list.filter((ch) =>
    [ch.name, ch.nickname].some((v) => String(v ?? '').toLowerCase().includes(q)),
  )
}

/** 弹层当前对应的会话（会话被删掉时自动变成 null，弹层随之收起） */
const currentAddConv = computed(
  () => conversations.value.find((conv) => conv.id === addConvId.value) ?? null,
)

/* ── 弹层的关闭：点外面 / Esc / 页面滚动或改窗口大小 ── */

function onDocPointerDown(event) {
  for (const menu of document.querySelectorAll('.msged .msgconv__more[open]')) {
    if (!menu.contains(event.target)) menu.open = false
  }
  if (!addConvId.value) return
  if (event.target instanceof Element && event.target.closest('.msgpop, .msgconv__add')) return
  closeAdd()
}

function onDocKeydown(event) {
  if (event.key === 'Escape') closeAdd()
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocPointerDown, true)
  document.addEventListener('keydown', onDocKeydown)
  window.addEventListener('scroll', closeAdd, true)
  window.addEventListener('resize', closeAdd)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointerDown, true)
  document.removeEventListener('keydown', onDocKeydown)
  window.removeEventListener('scroll', closeAdd, true)
  window.removeEventListener('resize', closeAdd)
})

function addParticipant(conv, characterId) {
  if (!characterId) return
  const ids = [...(conv.participantIds ?? []), characterId]
  const result = updateConversation(editor, conv.id, { participantIds: ids })
  closeAdd()
  if (result.removedMessages > 0) {
    ui.toast(`已移除 ${result.removedMessages} 条不属于当前参与者的消息`, { tone: 'info' })
  }
}

async function removeParticipant(conv, characterId) {
  if (readOnly.value) return
  const count = threadOf(project.value, conv.id).filter(message => message.senderCharacterId === characterId && characterId !== project.value.workSettings?.ownerCharacterId).length
  if (!(await ui.confirm({ title: '移除这位成员？', message: `将从当前会话移除这位成员${count ? `，并删除其发送的 ${count} 条消息` : ''}。人物资料仍会保留。`, confirmText: '移除', tone: 'danger' }))) return
  const ids = (conv.participantIds ?? []).filter((id) => id !== characterId)
  const result = updateConversation(editor, conv.id, { participantIds: ids })
  if (result.removedMessages > 0) {
    ui.toast(`已移除 ${result.removedMessages} 条该角色的消息`, { tone: 'info' })
  }
}

async function removeConversation(conv) {
  if (readOnly.value) return
  const count = countMessagesOf(project.value, conv.id)
  const ok = await ui.confirm({
    title: '删掉这个会话？',
    message: count
      ? `它下面还有 ${count} 条消息，会一起删掉。这个操作无法撤销。`
      : '这个操作无法撤销。',
    confirmText: '删除',
    tone: 'danger',
  })
  if (!ok) return
  const result = deleteConversation(editor, conv.id)
  ui.toast(result.removedMessages ? `已删除会话与 ${result.removedMessages} 条消息` : '已删除会话')
}

/* ── 消息 ───────────────────────────────────── */

function participantsOf(conv) {
  return characterOptions.value.filter((ch) => (conv.participantIds ?? []).includes(ch.id))
}

/** 消息发送者下拉 = 本会话参与者 + 所属人（谁是右侧气泡由所属人决定，不靠文案标注） */
function senderOptions(conv) {
  const list = participantsOf(conv)
  if (owner.value) {
    const own = characterOptions.value.find((ch) => ch.id === owner.value.id)
    if (own && !list.some((ch) => ch.id === own.id)) list.unshift(own)
  }
  return list.map(ch => ({ ...ch, avatarUrl: urlOf(project.value?.characters?.find(character => character.id === ch.id)?.avatarAssetId) }))
}

/**
 * 在某条消息的前/后插一条：新消息的 displayTime 贴着锚点时间 ±1 秒，
 * 物理位置则由数组顺序决定（见 editing/kakaotalk.js 的 addMessage）。
 */
function createMessageRelative(conv, message, where) {
  if (readOnly.value) return
  const payload = where === 'after' ? { afterId: message.id } : { beforeId: message.id }
  const created = addMessage(editor, conv.id, payload)
  if (!created) return
  selectMessage(created.id)
  requestAnimationFrame(() => {
    document.querySelector(`[data-msg-id="${created.id}"]`)?.scrollIntoView({
      block: 'nearest',
      behavior: 'smooth',
    })
  })
}

/**
 * 改发送者。
 *
 * 这里只传 senderCharacterId —— senderAccountId 由编辑层联动写入
 * （updateMessage 会照着新发送者重新解析他的 KakaoTalk 账号）。
 * 界面层不插手这件事，是为了让「换人就要换账号」这条规则只有一处实现：
 * 记牢这点，别在组件里补一个 senderAccountId 参数把它拆成两份。
 */
function commitSender(message, event) {
  updateMessage(editor, message.id, { senderCharacterId: event.target.value || null })
}

function commitContent(message, event) {
  updateMessage(editor, message.id, { content: event.target.value })
}

function commitTime(message, event) {
  const iso = fromDateTimeLocal(event.target.value)
  if (!iso) return
  updateMessage(editor, message.id, { displayTime: iso })
}

async function removeMessage(message) {
  if (readOnly.value) return
  if (!(await ui.confirm({ title: '删除这条消息？', message: '这条消息及其图片、语音等内容将从会话中删除，无法撤销。', confirmText: '删除', tone: 'danger' }))) return
  deleteMessage(editor, message.id)
  ui.toast('已删除这条消息')
  await reclaimAssets()
}

/* ── 消息图片 ───────────────────────────────── */

/**
 * 类型下拉的显示名。选项从编辑层的 KT_MESSAGE_TYPES 生成，避免界面与白名单漂移。
 * 少一个 key 时下拉会退化成显示英文原值（见模板的 `?? type`），
 * 所以这里漏写不会崩，但一眼能看出来。
 */
const MESSAGE_TYPE_LABELS = {
  text: '文本',
  image: '图片',
  voice: '语音',
  sticker: '贴图',
  system: '系统消息',
  call: '通话',
}

/** 通话子维度的显示名。下拉只给两个维度各两项（见 CALL_KINDS / CALL_STATUSES） */
const CALL_KIND_LABELS = { voice: '语音通话', video: '视频通话' }
const CALL_STATUS_LABELS = { completed: '已接通', missed: '未接通' }

/** 带媒体的类型：它们共用图片上传那块（贴图只是限 1 张、文案不同） */
function hasMedia(message) {
  return message.contentType === 'image' || message.contentType === 'sticker'
}

/** 带正文的类型：图片和语音的正文恒为空，框都不该出现 */
function hasProse(message) {
  return message.contentType === 'text' || message.contentType === 'system'
}

/** 这条消息最多能放几个媒体：贴图只有一个，图片到九宫格 */
function mediaLimitOf(message) {
  return message.contentType === 'sticker' ? STICKER_MEDIA_MAX : MESSAGE_MEDIA_MAX
}

/** 时长显示：秒 → 0:03 / 12:05，与作品端语音条同一套写法 */
function durationLabel(sec) {
  const n = Number(sec)
  if (!Number.isFinite(n) || n <= 0) return '0:00'
  const m = Math.floor(n / 60)
  return `${m}:${String(Math.round(n % 60)).padStart(2, '0')}`
}

const uploadingId = ref(null)

/** 全项目的消息图片地址表 + 角色头像：缩略图与消息条目头像共用（与信息编辑器同一套） */
const { urls } = useAssetUrls(editor, () => [
  ...conversations.value.map(conversation => conversation.avatarAssetId),
  ...conversations.value.flatMap((conv) =>
    threadOf(project.value, conv.id).flatMap((item) => item.mediaAssetIds ?? []),
  ),
  ...(project.value?.characters ?? []).map((c) => c.avatarAssetId),
])

function urlOf(assetId) {
  return assetId ? (urls.value.get(assetId) ?? null) : null
}

/** 消息条目左侧头像：角色有图就取图，没图用首字占位 */
function avatarUrlOf(message) {
  const character = (project.value?.characters ?? []).find(
    (c) => c.id === message.senderCharacterId,
  )
  return urlOf(character?.avatarAssetId)
}

/** 发送者本名（头像 title 与首字占位都用它） */
function senderNameOf(message) {
  if (message.senderCharacterId) {
    return characterOptions.value.find((ch) => ch.id === message.senderCharacterId)?.name ?? '未知角色'
  }
  return '未指定'
}

function initialOf(message) {
  return String(senderNameOf(message)).trim().slice(0, 1) || '?'
}

/** 回收没人引用的图片（判定见 editing/assets.js，与帖子共用同一份规则） */
async function reclaimAssets() {
  const ids = orphanAssetIds(editor.project)
  if (ids.length === 0) return
  await editor.removeAssets(ids)
}

async function addImages(message, files) {
  if (readOnly.value || uploadingId.value) return
  const picked = Array.from(files ?? []).filter(Boolean)
  if (!picked.length) return

  const current = message.mediaAssetIds ?? []
  const limit = mediaLimitOf(message)
  const room = limit - current.length
  if (room <= 0) {
    ui.toast(limit === 1 ? '一个贴图只用 1 张' : `一条消息最多 ${limit} 张图`)
    return
  }

  const take = picked.slice(0, room)
  const skipped = picked.length - take.length
  uploadingId.value = message.id
  const added = []
  try {
    for (const file of take) {
      const prepared = await prepareImage(file)
      const meta = await editor.addAsset(prepared)
      added.push(meta.id)
    }
    updateMessage(editor, message.id, { mediaAssetIds: [...current, ...added] })

    const parts = [`已添加 ${added.length} 张`]
    if (skipped) parts.push(`${skipped} 张超出 ${limit} 张上限`)
    ui.toast(parts.join('，'), { tone: 'success' })
  } catch (err) {
    if (added.length) await reclaimAssets()
    ui.toast(err?.message ?? '这些图没能加上。', { tone: 'error' })
  } finally {
    uploadingId.value = null
  }
}

async function removeImage(message, assetId, ask = true) {
  if (readOnly.value) return
  if (ask && !(await ui.confirm({ title: '移除这张图片？', message: '图片将从这条消息中移除。其他内容中的图片不受影响。', confirmText: '移除', tone: 'danger' }))) return
  const next = (message.mediaAssetIds ?? []).filter((id) => id !== assetId)
  updateMessage(editor, message.id, { mediaAssetIds: next })
  await reclaimAssets()
}

/** 调序：第一张是封面，顺序是编辑决定的 */
function moveImage(message, index, delta) {
  if (readOnly.value) return
  const ids = [...(message.mediaAssetIds ?? [])]
  const to = index + delta
  if (to < 0 || to >= ids.length) return
  ;[ids[index], ids[to]] = [ids[to], ids[index]]
  updateMessage(editor, message.id, { mediaAssetIds: ids })
}

/**
 * 切换消息类型。
 *
 * 清什么由编辑层决定（见 kakaotalk.js 的 typeCleanupFor），这里不重复一份规则 ——
 * 「切到语音要清图片」「切到贴图要清正文」如果在界面上各写一遍，迟早跟白名单不一致。
 * 但**回收必须在清完引用之后**做：资源还被这条消息引用着时永远清不掉。
 */
async function commitType(message, event) {
  if (readOnly.value) return
  const type = event.target.value
  if (type === message.contentType) return
  updateMessage(editor, message.id, { contentType: type })
  await reclaimAssets()
}

/** 语音时长。输入框给的是秒，编辑层负责取整并夹到 1~600；清空 = 未填（null） */
function commitDuration(message, event) {
  updateMessage(editor, message.id, { durationSec: event.target.value })
}

/**
 * 语音转写。留空就是「没有转写」—— 作品端据此不画「转」按钮，
 * 所以这里不需要额外的开关，清空输入框即可撤掉。
 */
function commitTranscript(message, event) {
  updateMessage(editor, message.id, { transcript: event.target.value })
}

/* 通话的两个子维度。清空时长是编辑层的事（切「未接通」时自动清），
   这里只传维度本身 —— 与 senderAccountId 同一个分工原则：规则只有一处实现 */
function commitCallKind(message, event) {
  updateMessage(editor, message.id, { callKind: event.target.value })
}

function commitCallStatus(message, event) {
  updateMessage(editor, message.id, { callStatus: event.target.value })
}

/** 这条消息是否是「我」（手机所属人）发的 —— 只用来标记气泡在哪一侧 */
function isOwnMessage(message) {
  return owner.value && message.senderCharacterId === owner.value.id
}

/* ── 导入对话 ───────────────────────────────── */

const IMPORT_TEMPLATE = '2026/6/30\nA：这是一条消息。（23:24）\nB：这是一条回复\n2026/7/1\nA：这是一条消息。（23:30)'
const { importOpen, importText, importPreview, openImport, closeImport, runParse, importStats, importTimeMap, doImport } = useChatImport({ editor, ui, project, owner, readOnly, parseConversationText, resolveImportTimes, addConversation, addMessage, updateMessage, readReceipts: false })

import { watch as watchSelection } from 'vue'
import RecordWorkspace from '../../../components/workspace/RecordWorkspace.vue'
import { nextRecordSelection } from '../../../composables/record-selection.js'
import { useRecordSelection } from '../../../composables/use-record-selection.js'
const { selectedRecordId, visibleRecords } = useRecordSelection(conversations)

/** 会话列表副标题。通话消息比类型标签更具体一步：直接给「语音/视频通话」 */
function subtitleOf(message) {
  if (!message) return ''
  if (message.contentType === 'call') return message.callKind === 'video' ? '[视频通话]' : '[语音通话]'
  return MESSAGE_TYPE_LABELS[message.contentType]
}

const recordItems = computed(() => conversations.value.map(record => {
  const thread = threadOf(project.value, record.id)
  const last = thread.at(-1)
  const title = record.title || titlePlaceholder(record)
  return { id: record.id, title, avatar: urlOf(record.avatarAssetId), initial: title.trim().slice(0, 1) || '人', count: thread.length,
    subtitle: last?.content || subtitleOf(last) || '还没有消息',
    search: thread.map(message => message.content).join(' ') }
}))

import MessageTimeline from '../../workspace/MessageTimeline.vue'
import { useMediaQuery } from '../../../composables/use-media-query.js'
const desktopInspector = useMediaQuery('(min-width: 1440px)')
import InspectorPanel from '../../workspace/InspectorPanel.vue'
import MessageComposer from '../../workspace/MessageComposer.vue'
import { useMessageDrafts } from '../../../composables/use-message-drafts.js'
const selectedMessageId = ref(null)
const inspectorOpen = ref(false)
const composerTypes = MESSAGE_TYPE_LABELS
function selectedMessages(conv) { return threadOf(project.value, conv.id).filter(message => message.id === selectedMessageId.value) }
function selectMessage(id) { selectedMessageId.value = id; inspectorOpen.value = false }
function openMessageProperties(id) { selectedMessageId.value = id; inspectorOpen.value = true }
watchSelection(() => [selectedRecordId.value, threadOf(project.value, selectedRecordId.value).map(message => message.id)], ([, ids], previous) => { selectedMessageId.value = nextRecordSelection(ids, previous?.[1] ?? [], selectedMessageId.value) }, { immediate: false })
const { draftFor, submitting, submit } = useMessageDrafts(conversations, {
  readOnly: () => readOnly.value, select: selectMessage, error: message => ui.toast(message, { tone: 'error' }),
  forConversation: (conv, draft) => {
    const custom = senderOptions(conv).some(sender => sender.id === draft.sender && sender.kind === 'custom')
    /* 载体字段按目标类型各带各的：语音带时长+转写；通话带两个子维度，
       时长只在「已接通」时传（未接通传了也是编辑层会清掉的脏数据） */
    const carrier = draft.type === 'voice'
      ? { durationSec: draft.duration, transcript: draft.transcript }
      : draft.type === 'call'
        ? { callKind: draft.callKind, callStatus: draft.callStatus, ...(draft.callStatus !== 'missed' ? { durationSec: draft.duration } : {}) }
        : {}
    const payload = { content: draft.content, contentType: draft.type, ...(draft.sender ? { senderCharacterId: custom ? null : draft.sender, senderName: custom ? draft.sender : null } : {}), ...(draft.time ? { displayTime: fromDateTimeLocal(draft.time) } : {}), ...carrier }
    return {
      find: id => threadOf(project.value, conv.id).find(message => message.id === id),
      create: () => addMessage(editor, conv.id, payload), update: async id => { updateMessage(editor, id, payload); await reclaimAssets() },
      clearMedia: async message => { for(const id of [...(message.mediaAssetIds ?? [])]) await removeImage(threadOf(project.value,conv.id).find(record=>record.id===message.id),id,false) },
      upload: async (message, files) => { const before=threadOf(project.value,conv.id).find(record=>record.id===message.id)?.mediaAssetIds?.length ?? 0; await addImages(message,files); return (threadOf(project.value,conv.id).find(record=>record.id===message.id)?.mediaAssetIds?.length ?? 0)>before },
      flush: () => editor.flush(),
    }
  },
})
</script>

<template>
  <section class="msged chat-editor" :class="{ 'chat-editor--empty': !conversations.length }" data-testid="kakao-editor">
    <RecordWorkspace v-model="selectedRecordId" title="会话" :records="recordItems" heading="KakaoTalk">
      <template #count><span>{{ conversations.length ? conversations.length + ' 个对话' : '' }}</span></template>
      <template #empty><p class="chat-list-empty">暂无会话</p></template>
      <template #actions>
        <button type="button" class="reference-new" aria-label="新建会话" :disabled="readOnly" data-testid="kakao-conv-add" @click="createConversation"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M12 3v18M3 12h18" /></svg></button>
      </template>
      <template #record="{ record }">
        <span class="reference-record-avatar" data-testid="conversation-avatar" aria-hidden="true"><img v-if="record.avatar" :src="record.avatar" alt="" /><span v-else>{{ record.initial }}</span></span>
        <span class="reference-record-body"><span class="reference-record-title"><strong>{{ record.title }}</strong><span class="reference-record-count">{{ record.count }}条</span></span><span class="reference-record-excerpt">{{ record.subtitle }}</span></span>
      </template><template #default="{ back }">
        <div v-if="!conversations.length" class="chat-empty" data-testid="kakao-empty">
          <p>还没有会话。新建一个会话，开始写下第一句。</p>
          <div class="chat-empty__actions">
            <AppButton :disabled="readOnly" data-testid="kakao-empty-create" @click="createConversation">新建会话</AppButton>
            <AppButton :disabled="readOnly" data-testid="kakao-import-open" @click="openImport">导入对话</AppButton>
          </div>
          <p v-if="!characters.length" class="chat-setup-note">还没有人物，先<RouterLink :to="{ name: 'characters', params: { projectId: project.id } }">添加人物</RouterLink>，再为消息选择发送者。</p>
          <p v-else-if="!owner" class="chat-setup-note" data-testid="kakao-no-owner">还未指定手机主人，<RouterLink :to="{ name: 'settings', params: { projectId: project.id } }">前往手机设定</RouterLink>。</p>
        </div>
        <ul v-else class="msged__list" data-testid="kakao-conv-list">
          <li
            v-for="conv in visibleRecords"
            :key="conv.id"
            class="msgconv"
            :data-conv-id="conv.id"
            data-testid="kakao-conv-row"
          >
            <div class="chat-workbench">
              <section class="chat-canvas">
                <header class="msgconv__head">
                  <div class="msgconv__heading">
                    <button type="button" class="reference-conversation-back" aria-label="返回会话列表" @click="back"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg></button><input class="msgconv__title" type="text" :value="conv.title" :maxlength="40" :disabled="readOnly" :placeholder="titlePlaceholder(conv)" aria-label="会话名称" data-testid="kakao-conv-title" @change="commitTitle(conv, $event)" />
                    <p class="msgconv__members">{{ [...new Set([owner?.id, ...(conv.participantIds ?? [])].filter(Boolean))].map(id => characterOptions.find(member => member.id === id)?.name || '未知角色').join('、') }} · {{ threadOf(project, conv.id).length }} 条消息</p>
                  </div>
                  <div class="msgconv__tools">
                    <button type="button" class="msgconv__people" :aria-expanded="peopleOpen.has(conv.id)" :title="peopleTitle(conv)" data-testid="kakao-conv-people" @click="togglePeople(conv.id)">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="9" cy="7" r="3" /><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 4a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 4v2" /></svg>
                      <span>成员管理</span>
                    </button>
                    <details class="msgconv__more" @keydown.esc.stop.prevent="$event.currentTarget.open=false">
                      <summary aria-label="更多会话操作"><svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="4" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="20" cy="12" r="1.5" /></svg></summary>
                      <div class="msgconv__menu" @click="$event.target.closest('button') && ($event.currentTarget.parentElement.open = false)">
                        <button type="button" :aria-pressed="Boolean(conv.pinned)" :disabled="readOnly" data-testid="kakao-conv-pinned" @click="commitPinned(conv,!conv.pinned)">{{ conv.pinned ? '取消置顶' : '置顶会话' }}</button>
                        <button type="button" :disabled="readOnly" data-testid="kakao-import-open" @click="openImport">导入对话</button>
                        <button type="button" class="msgconv__menu-danger" :disabled="readOnly" data-testid="kakao-conv-remove" @click="removeConversation(conv)">删除会话</button>
                      </div>
                    </details>
                  </div>
                </header>

                <!-- 参与方条带：默认收起，点人图标才出。不套灰框，chips 直接落在卡片上 -->
                <div v-show="peopleOpen.has(conv.id)" class="msgconv__panel" data-testid="kakao-conv-panel">
                  <span
                    v-for="pid in conv.participantIds ?? []"
                    :key="pid"
                    class="msgconv__chip"
                    data-testid="kakao-conv-chip"
                  >
                    {{ chipLabelOf(pid) }}
                    <button
                      type="button"
                      class="msgconv__chip-x"
                      :disabled="readOnly"
                      aria-label="移除参与者"
                      data-testid="kakao-conv-chip-x"
                      @click="removeParticipant(conv, pid)"
                    >×</button>
                  </span>
                  <button
                    type="button"
                    class="msgconv__add"
                    :disabled="readOnly"
                    data-testid="kakao-conv-add-participant"
                    @click="openAdd(conv, $event)"
                  >
                    ＋ 添加角色
                  </button>
                </div>

                <!-- 消息时间线 -->
                <div class="msgconv__thread" data-testid="kakao-thread">
                  <div v-if="!threadOf(project, conv.id).length" class="msgconv__threadempty chat-thread-empty">
                    <p>还没有消息。在下方选择发送者，写下第一句。</p>
                    <p v-if="!characters.length" class="chat-setup-note">先<RouterLink :to="{ name: 'characters', params: { projectId: project.id } }">添加人物</RouterLink>，再为消息选择发送者。</p>
                    <p v-else-if="!owner" class="chat-setup-note" data-testid="kakao-no-owner">还未指定手机主人，<RouterLink :to="{ name: 'settings', params: { projectId: project.id } }">前往手机设定</RouterLink>。</p>
                  </div>

                  <MessageTimeline v-else appearance="chat" :messages="threadOf(project,conv.id)" :selected="selectedMessageId" :sender="senderNameOf" :avatar="avatarUrlOf" :media="urlOf" :own="isOwnMessage" :show-read="false" :read-only="readOnly" test-prefix="kakao" @select="selectMessage" @edit="openMessageProperties" @before="createMessageRelative(conv,$event,'before')" @after="createMessageRelative(conv,$event,'after')" @remove="removeMessage" />

                  <MessageComposer v-show="desktopInspector || !inspectorOpen" appearance="chat" :default-sender-id="conv.participantIds?.[0] || ''" :conversation="conv.title || titlePlaceholder(conv)" :draft="draftFor(conv.id)" :senders="senderOptions(conv)" :types="composerTypes" :disabled="readOnly || !senderOptions(conv).length" :busy="submitting" @submit="submit(conv)" />
                </div>
              </section><InspectorPanel v-model="inspectorOpen" title="消息属性">
                <ol class="message-properties">
                  <li
                    v-for="message in selectedMessages(conv)"
                    :key="message.id"
                    class="ktitem"
                    :data-msg-id="message.id"
                    :data-side="isOwnMessage(message) ? 'right' : 'left'"
                  >
                    <div class="ktitem__head">
                      <!-- 头像：角色有图就取图，没图用首字占位 -->
                      <span class="ktitem__ava" :title="senderNameOf(message)" aria-hidden="true">
                        <img v-if="avatarUrlOf(message)" :src="avatarUrlOf(message)" alt="" />
                        <template v-else>{{ initialOf(message) }}</template>
                      </span>

                      <label class="message-property"><span>发送者</span><select
                        class="ktitem__sender"
                        :value="message.senderCharacterId ?? ''"
                        :disabled="readOnly || message.contentType === 'system' || !senderOptions(conv).length"
                        aria-label="发送者"
                        data-testid="kakao-message-sender"
                        @change="commitSender(message, $event)"
                      >
                        <option value="">未指定</option>
                        <option v-for="ch in senderOptions(conv)" :key="ch.id" :value="ch.id">
                          {{ labelOf(ch) }}
                        </option>
                      </select></label>

                      <!-- 时间 + 类型包成一组：折行时它们一起走，不会把「类型」单独甩到第二行 -->
                      <span class="ktitem__meta">
                        <label class="message-property"><span>发送时间</span><input
                          class="ktitem__time"
                          type="datetime-local"
                          :value="toDateTimeLocal(message.displayTime)"
                          :disabled="readOnly"
                          aria-label="发送时间"
                          data-testid="kakao-message-time"
                          @change="commitTime(message, $event)"
                        /></label>

                        <label class="message-property"><span>消息类型</span><select
                          class="ktitem__type"
                          :value="message.contentType"
                          :disabled="readOnly"
                          aria-label="消息类型"
                          data-testid="kakao-message-type"
                          @change="commitType(message, $event)"
                        >
                          <option v-for="type in KT_MESSAGE_TYPES" :key="type" :value="type">
                            {{ MESSAGE_TYPE_LABELS[type] ?? type }}
                          </option>
                        </select></label>
                      </span>

                      <span v-if="message.contentType === 'system'" class="ktitem__hint" data-testid="kakao-message-syshint">
                        系统消息无发送者
                      </span>
                    </div>

                    <!-- 带媒体的类型（图片 / 贴图）：缩略图行（封面角标 + 排序 + 删除）+ 上传 -->
                    <div v-if="hasMedia(message)" class="ktitem__media" :data-type="message.contentType">
                      <div
                        v-for="(assetId, i) in message.mediaAssetIds ?? []"
                        :key="assetId"
                        class="ktitem__thumb"
                        :data-asset-id="assetId"
                      >
                        <img v-if="urlOf(assetId)" :src="urlOf(assetId)" alt="" />
                        <span v-else class="ktitem__thumb-missing">图片丢失</span>
                        <!-- 贴图只有一张，"封面"这个说法没有意义 -->
                        <span v-if="message.contentType === 'image'" class="ktitem__thumb-cover">封面</span>
                        <div class="ktitem__thumb-ops">
                          <button
                            type="button"
                            class="ktitem__thumbbtn"
                            :disabled="readOnly || i === 0"
                            :aria-label="`第 ${i + 1} 张左移`"
                            data-testid="kakao-message-image-left"
                            @click="moveImage(message, i, -1)"
                          >
                            ←
                          </button>
                          <button
                            type="button"
                            class="ktitem__thumbbtn"
                            :disabled="readOnly || i === (message.mediaAssetIds ?? []).length - 1"
                            :aria-label="`第 ${i + 1} 张右移`"
                            data-testid="kakao-message-image-right"
                            @click="moveImage(message, i, 1)"
                          >
                            →
                          </button>
                          <button
                            type="button"
                            class="ktitem__thumbbtn"
                            :disabled="readOnly"
                            :aria-label="`移除第 ${i + 1} 张`"
                            data-testid="kakao-message-image-remove"
                            @click="removeImage(message, assetId)"
                          >
                            ×
                          </button>
                        </div>
                      </div>

                      <AppUploadButton
                        size="sm"
                        :multiple="message.contentType !== 'sticker'"
                        :disabled="readOnly || uploadingId === message.id || (message.mediaAssetIds ?? []).length >= mediaLimitOf(message)"
                        accept="image/*"
                        test-id="kakao-message-image"
                        @files="addImages(message, $event)"
                      >
                        {{
                          uploadingId === message.id
                            ? '处理中…'
                            : (message.mediaAssetIds ?? []).length >= mediaLimitOf(message)
                              ? (message.contentType === 'sticker' ? '已选贴图' : `已满 ${mediaLimitOf(message)} 张`)
                              : (message.contentType === 'sticker' ? '选择贴图' : '添加图片')
                        }}
                      </AppUploadButton>
                      <span class="ktitem__mediahint">
                        {{
                          message.contentType === 'sticker'
                            ? '一个贴图只用 1 张，建议透明背景 PNG'
                            : `最多 ${MESSAGE_MEDIA_MAX} 张，第一张是封面`
                        }}
                      </span>
                    </div>

                    <!-- 语音：时长是唯一可编辑的东西。作品端按它画波形长度和 0:03 的标签，不真播放 -->
                    <div v-if="message.contentType === 'voice'" class="ktitem__voice" data-testid="kakao-message-voice">
                      <div class="ktitem__voicelabel">
                        <label class="message-property"><span>语音时长（秒）</span><input
                          class="ktitem__voiceinput"
                          type="number"
                          min="1"
                          :max="MESSAGE_DURATION_MAX"
                          step="1"
                          :value="message.durationSec ?? ''"
                          :disabled="readOnly"
                          aria-label="语音时长（秒）"
                          data-testid="kakao-message-duration"
                          @change="commitDuration(message, $event)"
                        /></label>
                      </div>
                      <span class="ktitem__voicepreview">{{ durationLabel(message.durationSec) }}</span>
                      <span class="ktitem__mediahint">作品里是一条带波形的语音条，不真播放</span>

                      <!-- 转写：填了作品端才有「转」按钮，留空就是一条纯语音 -->
                      <label class="message-property"><span>语音转写（选填）</span><textarea
                        class="ktitem__content ktitem__transcript"
                        :value="message.transcript ?? ''"
                        :maxlength="MESSAGE_TRANSCRIPT_MAX_LENGTH"
                        :disabled="readOnly"
                        rows="2"
                        placeholder="转文字内容（选填）—— 填了作品里这条语音旁会出现「转」按钮"
                        data-testid="kakao-message-transcript"
                        @change="commitTranscript(message, $event)"
                      ></textarea></label>
                      <span class="ktitem__mediahint" data-testid="kakao-message-transcript-hint">
                        {{
                          message.transcript
                            ? '已填：作品里点「转」显示这段文字，再点收起'
                            : '留空：作品里没有「转」按钮'
                        }}
                      </span>
                    </div>

                    <!-- 通话：类型/结果/时长三件。未接通没有时长可打（作品端打红字标注），
                         输入框禁用并清空 —— 编辑层会在切到「未接通」时把 durationSec 一并清掉 -->
                    <div v-else-if="message.contentType === 'call'" class="ktitem__voice" data-testid="kakao-message-call">
                      <div class="ktitem__voicelabel">
                        <label class="message-property"><span>通话类型</span><select
                          class="ktitem__type"
                          :value="message.callKind ?? 'voice'"
                          :disabled="readOnly"
                          aria-label="通话类型"
                          data-testid="kakao-message-call-kind"
                          @change="commitCallKind(message, $event)"
                        >
                          <option v-for="kind in CALL_KINDS" :key="kind" :value="kind">{{ CALL_KIND_LABELS[kind] }}</option>
                        </select></label>
                        <label class="message-property"><span>通话结果</span><select
                          class="ktitem__type"
                          :value="message.callStatus ?? 'completed'"
                          :disabled="readOnly"
                          aria-label="通话结果"
                          data-testid="kakao-message-call-status"
                          @change="commitCallStatus(message, $event)"
                        >
                          <option v-for="status in CALL_STATUSES" :key="status" :value="status">{{ CALL_STATUS_LABELS[status] }}</option>
                        </select></label>
                      </div>
                      <div class="ktitem__voicelabel">
                        <label class="message-property"><span>通话时长（秒）</span><input
                          class="ktitem__voiceinput"
                          type="number"
                          min="1"
                          :max="MESSAGE_DURATION_MAX"
                          step="1"
                          :value="message.callStatus === 'missed' ? '' : (message.durationSec ?? '')"
                          :disabled="readOnly || message.callStatus === 'missed'"
                          aria-label="通话时长（秒）"
                          data-testid="kakao-message-call-duration"
                          @change="commitDuration(message, $event)"
                        /></label>
                      </div>
                      <span v-if="message.callStatus !== 'missed'" class="ktitem__voicepreview">{{ durationLabel(message.durationSec) }}</span>
                      <span class="ktitem__mediahint">已接通：气泡尾部打灰色时长；未接通：按气泡所在侧自动显示「已取消 / 未接听」红字</span>
                    </div>

                    <label v-if="hasProse(message)" class="message-property"><span>消息内容</span><textarea
                      class="ktitem__content"
                      :value="message.content"
                      :maxlength="MESSAGE_CONTENT_MAX_LENGTH"
                      :disabled="readOnly"
                      rows="2"
                      :placeholder="message.contentType === 'system' ? '例如：林夏 邀请 周予安 加入群聊' : '消息内容'"
                      data-testid="kakao-message-content"
                      @change="commitContent(message, $event)"
                    ></textarea></label>
                  </li>
                </ol><p v-if="!selectedMessages(conv).length" class="message-properties__empty">选择一条消息编辑属性。</p>
              </InspectorPanel>
            </div>
          </li>
        </ul>
      </template>
    </RecordWorkspace>

    <!--
      添加参与方的弹层。必须 Teleport 到 body：.msgconv 是 overflow:hidden，
      在卡内绝对定位会被裁掉；定位按「＋ 角色」按钮的 rect 算，再在视口里夹紧。
    -->
    <Teleport to="body">
      <div
        v-if="addConvId && currentAddConv"
        class="msgpop"
        :style="addStyle"
        data-testid="kakao-conv-addpop"
      >
        <input
          v-model="addQuery"
          class="msgpop__search"
          type="text"
          maxlength="30"
          placeholder="搜索角色"
          aria-label="搜索角色"
          data-testid="kakao-conv-search"
        />
        <button
          v-for="ch in popCandidates(currentAddConv)"
          :key="ch.id"
          type="button"
          class="msgpop__opt"
          :data-value="ch.id"
          data-testid="kakao-conv-add-option"
          @click="addParticipant(currentAddConv, ch.id)"
        >
          <span>{{ ch.name }}</span>
          <span class="msgpop__note">{{ ch.nickname }}</span>
        </button>
        <p
          v-if="!popCandidates(currentAddConv).length"
          class="msgpop__empty"
          data-testid="kakao-conv-add-empty"
        >
          没有可添加的角色。先去「角色与账号」建一个。
        </p>
      </div>
    </Teleport>

    <!-- 导入对话框 -->
    <div v-if="importOpen" class="msgimport" data-testid="kakao-import">
      <div class="msgimport__panel">
        <header class="msgimport__head">
          <h2 class="msgimport__title">导入对话</h2>
          <button type="button" class="msgimport__close" data-testid="kakao-import-close" @click="closeImport">
            ×
          </button>
        </header>

        <p class="msgimport__hint">
          每行一条「角色名：内容」，空行跳过。<br />
          日期单独一行写（<code>YYYY/MM/DD</code>），后续消息归到这一天。<br />
          行尾「（hh:mm）」设置发送时刻；不写则比上一条晚 20 秒。
        </p>

        <pre class="msgimport__sample">{{ IMPORT_TEMPLATE }}</pre>

        <textarea
          class="msgimport__input"
          :value="importText"
          rows="8"
          placeholder="在这里粘贴对话…"
          data-testid="kakao-import-input"
          @input="importText = $event.target.value"
        ></textarea>

        <div class="msgimport__actions">
          <AppButton size="sm" data-testid="kakao-import-parse" @click="runParse">解析预览</AppButton>
          <AppButton
            size="sm"
            variant="primary"
            :disabled="!importPreview || !importStats.matched"
            data-testid="kakao-import-confirm"
            @click="doImport"
          >
            导入
          </AppButton>
        </div>

        <div v-if="importPreview" class="msgimport__preview" data-testid="kakao-import-preview">
          <p class="msgimport__stats">
            共 {{ importStats.total }} 行，识别 {{ importStats.matched }} 行
            <template v-if="importStats.unmatched">
              ，<span class="msgimport__unmatched">{{ importStats.unmatched }} 行未识别（不会导入）</span>
            </template>
          </p>
          <ul class="msgimport__list">
            <template v-for="(line, i) in importPreview" :key="i">
              <!-- 日期分隔：只在换天时插一行。跨天的对话只看 HH:mm 会像时间倒流 -->
              <li
                v-if="importTimeMap.get(line)?.showDate"
                class="msgimport__day"
                data-testid="kakao-import-day"
              >
                {{ importTimeMap.get(line).dateLabel }}
              </li>
              <li
                class="msgimport__line"
                :data-kind="line.speakerKind"
                :data-unmatched="line.characterId == null"
              >
                <span class="msgimport__linename">{{ line.speakerName }}</span>
                <span class="msgimport__linecontent">{{ line.content }}</span>
                <span v-if="importTimeMap.get(line)?.label" class="msgimport__linetime">
                  {{ importTimeMap.get(line).explicit ? '' : '+20s ' }}{{ importTimeMap.get(line).label }}
                </span>
              </li>
            </template>
          </ul>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped src="./KakaoTalkEditor.css"></style>
