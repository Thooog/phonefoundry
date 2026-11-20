<script setup>
import { useChatImport } from '../../../composables/use-chat-import.js'
/**
 * 「信息（iMessage）」编辑页 —— 会话 + 消息 + 粘贴导入对话。
 *
 * 会话与消息是两层的：先有会话（谁和谁聊），会话里才有一条条消息。
 * 消息气泡的左右侧（右=手机所属人、左=对方）在作品端按所属人判定，
 * 所以这里会话只填「对方」，不填「我」—— 谁是「我」由作品设置的
 * 手机所属人决定，随时可切换（见 editing/messages.js 文件头）。
 *
 * 导入对话：用户按固定模板粘贴一段文本，一次生成一个会话 + 全部消息。
 * 模板（每行一条，空行跳过），发送者直接写角色名（不写「我」—— 所属人也是角色，
 * 写名字即可，「我」在不同所属人下指代会漂移）：
 *   林夏：你在家吗？（23:24）
 *   周予安：在的，怎么了
 *   林夏：那我过来咯（23:30）（23:31 已读）
 * 两种括号：只写时刻的「（23:24）」是这条的发送时间；带「已读」的「（23:31 已读）」
 * 是回执，只对手机所属人发的那行有意义（挂在其他角色行后会被忽略）。
 * 没写时刻的行不必担心 —— 它顺着上一条往后推 20 秒（见 editing/messages.js）。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

import AppButton from '../../ui/AppButton.vue'
import AppUploadButton from '../../ui/AppUploadButton.vue'
import { useProjectStore } from '../../../stores/project.js'
import { useUiStore } from '../../../stores/ui.js'
import { useAssetUrls } from '../../../composables/use-asset-urls.js'
import { prepareImage } from '../../../media/compress-image.js'
import { orphanAssetIds } from '../../../editing/assets.js'
import { fromDateTimeLocal, formatTimeShift, toDateTimeLocal } from '../../../utils/time.js'
import { scrollToEnd } from '../../../utils/scroll-to-end.js'
import {
  MESSAGE_CONTENT_MAX_LENGTH,
  MESSAGE_MEDIA_MAX,
  MESSAGE_TYPES,
  addConversation,
  addMessage,
  conversationsOf,
  countMessagesOf,
  deleteConversation,
  deleteMessage,
  parseConversationText,
  resolveImportTimes,
  retimeMessage,
  threadOf,
  updateConversation,
  updateMessage,
} from '../../../editing/messages.js'

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
 * 角色下拉的选项：角色 + 它在信息上的 handle。
 * 只显示角色名的话，用户选完不知道作品里显示什么 —— 带 @handle 提前说清楚
 * （与 X / Instagram 编辑器同一规则）。
 */
const characterOptions = computed(() =>
  characters.value.map((ch) => {
    const account = (project.value?.platformAccounts ?? []).find(
      (a) => a && a.characterId === ch.id && a.platform === 'messages',
    )
    // 角色被存进通讯录时，信息应用里显示的是联系人备注名（作品端 chat.js 绑定）。
    // 这里带出来给参与者 chip 做提示 —— 编辑器里看到的应该就是读者会看到的。
    const contact = (project.value?.appData?.phone?.contacts ?? []).find((c) => c.characterId === ch.id)
    return { id: ch.id, name: ch.name, handle: account?.handle ?? '', contactName: contact?.name ?? '' }
  }),
)

/** 下拉选项文案：名字 @handle */
function labelOf(ch) {
  return ch.handle ? `${ch.name} @${ch.handle}` : ch.name
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

/* ── 参与方面板：默认收起，点标题左边的人图标展开 ── */

/** 展开着参与方条带的会话 id 集合（与「展开消息」是两件事，互不影响） */
const peopleOpen = ref(new Set())

function togglePeople(convId) {
  const next = new Set(peopleOpen.value)
  if (next.has(convId)) next.delete(convId)
  else next.add(convId)
  peopleOpen.value = next
}

/** 参与方人数 = 角色 + 自定义发信人；收起时靠它常显，不丢「几个人」 */
function peopleCountOf(conv) {
  return new Set([owner.value?.id, ...(conv.participantIds ?? [])].filter(Boolean)).size + (conv.customParticipants ?? []).length
}

/**
 * 人图标的 title。所属人那一行已从卡头删掉（它是作品级设置，不随会话变），
 * 但「谁是我」这条线索不能凭空消失 —— 挂在悬停提示里，不占版面。
 */
function memberSummary(conv) {
  const ids = [...new Set([owner.value?.id, ...(conv.participantIds ?? [])].filter(Boolean))]
  return [...ids.map(id => `${chipLabelOf(id)}${chipNoteOf(id) ? `（${chipNoteOf(id)}）` : ''}`), ...(conv.customParticipants ?? [])].join('、')
}

function peopleTitle(conv) {
  return `参与方 ${peopleCountOf(conv)} 人 · 所属人 ${owner.value?.name ?? '未设置'}`
}

/* ── 添加参与方：一个入口 + 弹层（找角色 / 直接创建自定义发信人） ── */

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

/** 弹层里的候选角色：按搜索词过滤（本名 / handle / 联系人备注任一命中） */
function popCandidates(conv) {
  const q = addQuery.value.trim().toLowerCase()
  const list = addableParticipants(conv)
  if (!q) return list
  return list.filter((ch) =>
    [ch.name, ch.handle, ch.contactName].some((v) => String(v ?? '').toLowerCase().includes(q)),
  )
}

/** 搜索词能否直接建成自定义发信人（撞已有角色名 / 已加过的名字就不给建） */
function customNameError(conv, name) {
  if (!name) return ''
  if (characterOptions.value.some((ch) => ch.name === name)) return `已经有同名角色「${name}」`
  if ((conv.customParticipants ?? []).includes(name)) return `「${name}」已经在会话里了`
  return ''
}

function addCustomParticipant(conv, event) {
  const input = event.target.closest('.msgconv__panel')?.querySelector('.msgconv__custominput')
  const value = (input?.value ?? '').trim()
  if (!value) return
  const error = customNameError(conv, value)
  if (error) {
    ui.toast(error, { tone: 'info' })
    return
  }
  if (input) input.value = ''
  const names = [...(conv.customParticipants ?? []), value]
  const result = updateConversation(editor, conv.id, { customParticipants: names })
  if (result.removedMessages > 0) {
    ui.toast(`已移除 ${result.removedMessages} 条该发信人的消息`, { tone: 'info' })
  }
}

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

/* ── 自定义参与者（营销广告、快递通知这类没有角色的发信人） ── */

async function removeCustomParticipant(conv, name) {
  if (readOnly.value) return
  const count = threadOf(project.value, conv.id).filter(message => message.senderName === name).length
  if (!(await ui.confirm({ title: `移除「${name}」？`, message: `将从当前会话移除该发信人${count ? `，并删除其发送的 ${count} 条消息` : ''}。这个操作无法撤销。`, confirmText: '移除', tone: 'danger' }))) return
  const names = (conv.customParticipants ?? []).filter((n) => n !== name)
  const result = updateConversation(editor, conv.id, { customParticipants: names })
  if (result.removedMessages > 0) {
    ui.toast(`已移除 ${result.removedMessages} 条该发信人的消息`, { tone: 'info' })
  }
}

function titlePlaceholder(conv) {
  const names = [
    ...participantsOf(conv).map((ch) => ch.contactName || ch.name),
    ...(conv.customParticipants ?? []),
  ].filter(Boolean)
  if (!names.length) return '会话标题'
  if (names.length <= 2) return names.join('、')
  return `${names.slice(0, 2).join('、')} 等 ${names.length} 人`
}

function chipLabelOf(pid) {
  return labelOf(
    characterOptions.value.find((ch) => ch.id === pid) ?? { id: pid, name: '未知角色', handle: '' },
  )
}

/** chip 上的括号备注（联系人备注 ≠ 角色名时才显示） */
function chipNoteOf(pid) {
  const note = contactNameOf(pid)
  const name = characterOptions.value.find((ch) => ch.id === pid)?.name ?? ''
  return note && note !== name ? note : ''
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

/**
 * 消息发送者下拉 = 本会话角色参与者 + 所属人 + 自定义参与者。
 * 角色项的 value 是角色 id；自定义项的 value 就是原文。两者在下拉里混排，
 * commitSender 靠「是不是角色 id」区分 —— 自定义名撞角色 id 的概率可以忽略，
 * 真撞了也是角色优先（改名比删消息便宜）。
 */
function senderOptions(conv) {
  const list = participantsOf(conv).map((ch) => ({ kind: 'character', ...ch }))
  if (owner.value) {
    const own = characterOptions.value.find((ch) => ch.id === owner.value.id)
    if (own && !list.some((ch) => ch.id === own.id)) list.unshift({ kind: 'character', ...own })
  }
  for (const name of conv.customParticipants ?? []) {
    list.push({ kind: 'custom', id: name, name, handle: '' })
  }
  return list.map(sender => ({ ...sender, avatarUrl: sender.kind === 'character' ? avatarUrlOf({ senderCharacterId: sender.id }) : null }))
}

/** 这条消息当前在发送者下拉里该选中谁：角色 id 或自定义名，都没有就是空 */
function senderValueOf(message) {
  return message.senderCharacterId ?? message.senderName ?? ''
}

function hasSendableSender(conv) {
  return senderOptions(conv).length > 0
}

/** 角色关联的联系人备注名（没关联联系人返回空串） */
function contactNameOf(characterId) {
  return characterOptions.value.find((ch) => ch.id === characterId)?.contactName ?? ''
}

/**
 * 在某条消息的前/后插一条：新消息的 displayTime 贴着锚点时间 ±1 秒
 * （见 editing/messages.js 的 addMessage），物理位置则由数组顺序决定。
 *
 * 「在后面新增」是往对话末尾接一句，滚到最新一条；「在前面新增」那条落在对话中间，
 * 贴底会把人甩出很远，所以只保证新条目露出来。
 */
function createMessageRelative(conv, message, where) {
  if (readOnly.value) return
  const payload = where === 'after' ? { afterId: message.id } : { beforeId: message.id }
  const created = addMessage(editor, conv.id, payload)
  if (!created) return
  selectMessage(created.id)
  if (where === 'after') { revealLatest(conv.id); return }
  requestAnimationFrame(() => {
    document.querySelector(`[data-msg-id="${created.id}"]`)?.scrollIntoView({
      block: 'nearest',
      behavior: 'smooth',
    })
  })
}

/** 把某个会话的时间线滚到最新一条 */
function scrollToLatest(convId) {
  scrollToEnd(document.querySelector(`[data-conv-id="${convId}"] .message-timeline`))
}

/**
 * 等新节点进 DOM、高度定下来再滚 —— 只等一帧的话，消息里的图片还没撑开，
 * scrollHeight 偏小，滚完会停在倒数第二条附近。
 */
async function revealLatest(convId) {
  await nextTick()
  requestAnimationFrame(() => requestAnimationFrame(() => scrollToLatest(convId)))
}

/**
 * 改发送者。value 是角色 id 就写角色（senderName 清空），
 * 否则当作自定义发信人（senderCharacterId 清空）—— 互斥在 editing 层兜底，
 * 这里两个都显式传，是为了让「换人」这条规则在界面上只有一处入口。
 */
function commitSender(conv, message, event) {
  const value = event.target.value
  const isCharacter = characterOptions.value.some((ch) => ch.id === value)
  if (!value) {
    updateMessage(editor, message.id, { senderCharacterId: null, senderName: null })
  } else if (isCharacter) {
    updateMessage(editor, message.id, { senderCharacterId: value, senderName: null })
  } else {
    updateMessage(editor, message.id, { senderCharacterId: null, senderName: value })
  }
}

function commitContent(message, event) {
  updateMessage(editor, message.id, { content: event.target.value })
}

/**
 * 改发送时间：这条改到目标时刻，**它后面的消息一起平移同样的差值**。
 *
 * 只改一条会把整段对话的先后关系搅乱（后面的消息时间还停在原处，看起来像
 * 时间倒流），所以按「修一条 = 整段往后/往前挪」处理，相对间隔保持不变。
 */
function commitTime(message, event) {
  const iso = fromDateTimeLocal(event.target.value)
  if (!iso) return
  const { deltaMs, shifted } = retimeMessage(editor, message.conversationId, message.id, iso)
  if (shifted) ui.toast(`后面 ${shifted} 条消息也一起${deltaMs > 0 ? '往后' : '往前'}挪了 ${formatTimeShift(deltaMs)}`)
}

/** 新消息的时间默认取会话最后一条的时刻；空会话留空，由编辑层取当前时刻 */
function composerTime(conv) {
  const list = threadOf(project.value, conv.id)
  return list.length ? toDateTimeLocal(list[list.length - 1].displayTime) : ''
}

function commitRead(message, event) {
  // 勾上「已读」= 给对方一个已读时刻；取消 = 未读（readAt 置 null）
  updateMessage(editor, message.id, { readAt: event.target.checked ? new Date().toISOString() : null })
}

function commitReadTime(message, event) {
  const iso = fromDateTimeLocal(event.target.value)
  if (!iso) return
  updateMessage(editor, message.id, { readAt: iso })
}

async function removeMessage(message) {
  if (readOnly.value) return
  if (!(await ui.confirm({ title: '删除这条消息？', message: '这条消息及其图片、语音等内容将从会话中删除，无法撤销。', confirmText: '删除', tone: 'danger' }))) return
  deleteMessage(editor, message.id)
  ui.toast('已删除这条消息')
  await reclaimAssets()
}

/* ── 消息图片 ───────────────────────────────── */

/** 类型下拉的显示名。选项从编辑层的 MESSAGE_TYPES 生成，避免界面与白名单漂移 */
const MESSAGE_TYPE_LABELS = { text: '文本', image: '图片' }

const uploadingId = ref(null)

/** 全项目的消息图片地址表 + 角色头像：缩略图与消息条目头像共用（与 XEditor 同一套 useAssetUrls） */
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

/** 消息条目左侧头像：角色有图就取图，没图（或自定义发信人）用首字占位 */
function avatarUrlOf(message) {
  const character = (project.value?.characters ?? []).find(
    (c) => c.id === message.senderCharacterId,
  )
  return urlOf(character?.avatarAssetId)
}

function initialOf(message) {
  return String(senderLabelOf(message)).trim().slice(0, 1) || '?'
}

/** 发送者的显示名：角色取本名，自定义发信人取原文（头像 title 与首字占位都用它） */
function senderLabelOf(message) {
  if (message.senderCharacterId) {
    return (
      characterOptions.value.find((ch) => ch.id === message.senderCharacterId)?.name ?? '未知角色'
    )
  }
  return message.senderName ?? '未指定'
}

/**
 * 回收没人引用的图片。
 *
 * 必须做全项目扫描：同一张图可能被两条消息（甚至帖子）共用，
 * 只按当前消息算会误删。判定放在 editing/assets.js，与帖子共用同一份规则。
 */
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
  const room = MESSAGE_MEDIA_MAX - current.length
  if (room <= 0) {
    ui.toast(`一条消息最多 ${MESSAGE_MEDIA_MAX} 张图`)
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
    if (skipped) parts.push(`${skipped} 张超出 ${MESSAGE_MEDIA_MAX} 张上限`)
    ui.toast(parts.join('，'), { tone: 'success' })
  } catch (err) {
    // 先落进 assets 的图没人引用，要回收，否则会留在导出包里
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
 * 切回文本要**先清引用再回收**：顺序反了资源仍被这条消息引用着，
 * orphanAssetIds 找不到它，就永远清不掉。
 */
async function commitType(message, event) {
  if (readOnly.value) return
  const type = event.target.value
  if (type === message.contentType) return
  if (type === 'image') {
    updateMessage(editor, message.id, { contentType: 'image' })
    return
  }
  updateMessage(editor, message.id, { contentType: 'text', mediaAssetIds: [] })
  await reclaimAssets()
}

/** 这条消息是否是「我」（手机所属人）发的 —— 只有我方消息才显示已读回执 */
function isOwnMessage(message) {
  return owner.value && message.senderCharacterId === owner.value.id
}

/* ── 导入对话 ───────────────────────────────── */

const IMPORT_TEMPLATE = '2026/6/30\nA：这是一条消息。（23:24）\nB：这是一条回复\n2026/7/1\nA：这是一条消息。（23:30)'
const { importOpen, importText, importPreview, openImport, closeImport, runParse, importStats, importTimeMap, doImport } = useChatImport({ editor, ui, project, owner, readOnly, parseConversationText, resolveImportTimes, addConversation, addMessage, updateMessage, readReceipts: true })

import { watch as watchSelection } from 'vue'
import RecordWorkspace from '../../../components/workspace/RecordWorkspace.vue'
import { nextRecordSelection } from '../../../composables/record-selection.js'
import { useRecordSelection } from '../../../composables/use-record-selection.js'
const { selectedRecordId, visibleRecords } = useRecordSelection(conversations)
const recordItems = computed(() => conversations.value.map(record => {
  const thread = threadOf(project.value, record.id)
  const last = thread.at(-1)
  const title = record.title || titlePlaceholder(record)
  return { id: record.id, title, avatar: urlOf(record.avatarAssetId), initial: title.trim().slice(0, 1) || '人', count: thread.length,
    subtitle: last?.content || (last ? MESSAGE_TYPE_LABELS[last.contentType] : '还没有消息'),
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
/** 进会话就落在最近一条上：长对话不该每次都从第一句开始翻 */
watchSelection(selectedRecordId, id => { if (id) revealLatest(id) }, { immediate: true })
const { draftFor, submitting, submit } = useMessageDrafts(conversations, {
  readOnly: () => readOnly.value, select: selectMessage, error: message => ui.toast(message, { tone: 'error' }),
  afterSubmit: (id, conv) => revealLatest(conv.id),
  forConversation: (conv, draft) => {
    const custom = senderOptions(conv).some(sender => sender.id === draft.sender && sender.kind === 'custom')
    const payload = { content: draft.content, contentType: draft.type, ...(draft.sender ? { senderCharacterId: custom ? null : draft.sender, senderName: custom ? draft.sender : null } : {}), ...(draft.time ? { displayTime: fromDateTimeLocal(draft.time) } : {}), durationSec: draft.duration, transcript: draft.transcript }
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
  <section class="msged chat-editor" :class="{ 'chat-editor--empty': !conversations.length }" data-testid="messages-editor">
    <RecordWorkspace v-model="selectedRecordId" title="会话" :records="recordItems" heading="信息">
      <template #count><span>{{ conversations.length ? conversations.length + ' 个对话' : '' }}</span></template>
      <template #empty><p class="chat-list-empty">暂无会话</p></template>
      <template #actions>
        <button type="button" class="reference-new" aria-label="新建会话" :disabled="readOnly" data-testid="msg-conv-add" @click="createConversation"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M12 3v18M3 12h18" /></svg></button>
      </template>
      <template #record="{ record }">
        <span class="reference-record-avatar" data-testid="conversation-avatar" aria-hidden="true"><img v-if="record.avatar" :src="record.avatar" alt="" /><span v-else>{{ record.initial }}</span></span>
        <span class="reference-record-body"><span class="reference-record-title"><strong>{{ record.title }}</strong><span class="reference-record-count">{{ record.count }}条</span></span><span class="reference-record-excerpt">{{ record.subtitle }}</span></span>
      </template><template #default="{ back }">
        <div v-if="!conversations.length" class="chat-empty" data-testid="msg-empty">
          <p>还没有会话。新建一个会话，开始写下第一句。</p>
          <div class="chat-empty__actions">
            <AppButton :disabled="readOnly" data-testid="msg-empty-create" @click="createConversation">新建会话</AppButton>
            <AppButton :disabled="readOnly" data-testid="msg-import-open" @click="openImport">导入对话</AppButton>
          </div>
          <p v-if="!characters.length" class="chat-setup-note">可使用名称或号码作为自定义发信人，也可<RouterLink :to="{ name: 'characters', params: { projectId: project.id } }">添加人物</RouterLink>。</p>
          <p v-else-if="!owner" class="chat-setup-note" data-testid="msg-no-owner">还未指定手机主人，<RouterLink :to="{ name: 'settings', params: { projectId: project.id } }">前往手机设定</RouterLink>。</p>
        </div>
        <ul v-else class="msged__list" data-testid="msg-conv-list">
          <li
            v-for="conv in visibleRecords"
            :key="conv.id"
            class="msgconv"
            :data-conv-id="conv.id"
            data-testid="msg-conv-row"
          >
            <div class="chat-workbench">
              <section class="chat-canvas">
                <header class="msgconv__head">
                  <div class="msgconv__heading">
                    <button type="button" class="reference-conversation-back" aria-label="返回会话列表" @click="back"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg></button><input class="msgconv__title" type="text" :value="conv.title" :maxlength="40" :disabled="readOnly" :placeholder="titlePlaceholder(conv)" aria-label="会话名称" data-testid="msg-conv-title" @change="commitTitle(conv, $event)" />
                    <p class="msgconv__members">{{ memberSummary(conv) }} · {{ threadOf(project, conv.id).length }} 条消息</p>
                  </div>
                  <div class="msgconv__tools">
                    <button type="button" class="msgconv__people" :aria-expanded="peopleOpen.has(conv.id)" :title="peopleTitle(conv)" data-testid="msg-conv-people" @click="togglePeople(conv.id)">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="9" cy="7" r="3" /><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 4a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 4v2" /></svg>
                      <span>成员管理</span>
                    </button>
                    <details class="msgconv__more" @keydown.esc.stop.prevent="$event.currentTarget.open=false">
                      <summary aria-label="更多会话操作"><svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="4" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="20" cy="12" r="1.5" /></svg></summary>
                      <div class="msgconv__menu" @click="$event.target.closest('button') && ($event.currentTarget.parentElement.open = false)">
                        <button type="button" :aria-pressed="Boolean(conv.pinned)" :disabled="readOnly" data-testid="msg-conv-pinned" @click="commitPinned(conv,!conv.pinned)">{{ conv.pinned ? '取消置顶' : '置顶会话' }}</button>
                        <button type="button" :disabled="readOnly" data-testid="msg-import-open" @click="openImport">导入对话</button>
                        <button type="button" class="msgconv__menu-danger" :disabled="readOnly" data-testid="msg-conv-remove" @click="removeConversation(conv)">删除会话</button>
                      </div>
                    </details>
                  </div>
                </header>

                <!-- 参与方条带：默认收起，点人图标才出。不套灰框，chips 直接落在卡片上 -->
                <div v-show="peopleOpen.has(conv.id)" class="msgconv__panel" data-testid="msg-conv-panel">
                  <span
                    v-for="pid in conv.participantIds ?? []"
                    :key="pid"
                    class="msgconv__chip"
                    data-testid="msg-conv-chip"
                  >
                    {{ chipLabelOf(pid) }}<span v-if="chipNoteOf(pid)" class="msgconv__chipnote" data-testid="msg-conv-chip-note">（{{ chipNoteOf(pid) }}）</span>
                    <button
                      type="button"
                      class="msgconv__chip-x"
                      :disabled="readOnly"
                      aria-label="移除参与者"
                      data-testid="msg-conv-chip-x"
                      @click="removeParticipant(conv, pid)"
                    >×</button>
                  </span>
                  <span
                    v-for="name in conv.customParticipants ?? []"
                    :key="name"
                    class="msgconv__chip msgconv__chip--custom"
                    data-testid="msg-conv-custom-chip"
                  >
                    {{ name }}
                    <button
                      type="button"
                      class="msgconv__chip-x"
                      :disabled="readOnly"
                      aria-label="移除自定义发信人"
                      data-testid="msg-conv-custom-chip-x"
                      @click="removeCustomParticipant(conv, name)"
                    >×</button>
                  </span>
                  <button
                    type="button"
                    class="msgconv__add"
                    :disabled="readOnly"
                    data-testid="msg-conv-add-participant"
                    @click="openAdd(conv, $event)"
                  >
                    ＋ 添加角色
                  </button>

                  <div class="reference-custom-sender">
                    <input
                      class="msgconv__custominput"
                      type="text"
                      :maxlength="30"
                      :disabled="readOnly"
                      placeholder="名称或号码"
                      aria-label="添加自定义发信人"
                      data-testid="msg-conv-custom-input"
                      @keydown.enter.prevent="addCustomParticipant(conv, $event)"
                    />
                    <button
                      type="button"
                      class="msgconv__customadd"
                      :disabled="readOnly"
                      data-testid="msg-conv-custom-add" aria-label="添加自定义发信人" title="添加自定义发信人（Enter）"
                      @click="addCustomParticipant(conv, $event)"
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 10-5 5 5 5M4 15h11a4 4 0 0 0 4-4V4" /></svg>
                    </button>
                  </div>
                </div>

                <!-- 消息时间线 -->
                <div class="msgconv__thread" data-testid="msg-thread">
                  <div v-if="!threadOf(project, conv.id).length" class="msgconv__threadempty chat-thread-empty">
                    <p>还没有消息。在下方选择发送者，写下第一句。</p>
                    <p v-if="!characters.length" class="chat-setup-note">可在成员管理中添加名称或号码，也可<RouterLink :to="{ name: 'characters', params: { projectId: project.id } }">添加人物</RouterLink>。</p>
                    <p v-else-if="!owner" class="chat-setup-note" data-testid="msg-no-owner">还未指定手机主人，<RouterLink :to="{ name: 'settings', params: { projectId: project.id } }">前往手机设定</RouterLink>。</p>
                  </div>

                  <MessageTimeline v-else appearance="chat" :messages="threadOf(project,conv.id)" :selected="selectedMessageId" :sender="senderLabelOf" :avatar="avatarUrlOf" :media="urlOf" :own="isOwnMessage" :read-only="readOnly" test-prefix="msg" @select="selectMessage" @edit="openMessageProperties" @before="createMessageRelative(conv,$event,'before')" @after="createMessageRelative(conv,$event,'after')" @remove="removeMessage" />

                  <MessageComposer v-show="desktopInspector || !inspectorOpen" appearance="chat" :default-sender-id="conv.participantIds?.[0] || conv.customParticipants?.[0] || ''" :conversation="conv.title || titlePlaceholder(conv)" :draft="draftFor(conv.id)" :default-time="composerTime(conv)" :senders="senderOptions(conv)" :types="composerTypes" :disabled="readOnly || !hasSendableSender(conv)" :busy="submitting" @submit="submit(conv)" />
                </div>
              </section><InspectorPanel v-model="inspectorOpen" title="消息属性">
                <ol class="message-properties">
                  <li
                    v-for="message in selectedMessages(conv)"
                    :key="message.id"
                    class="msgitem"
                    :data-msg-id="message.id"
                    :data-side="isOwnMessage(message) ? 'right' : 'left'"
                  >
                    <div class="msgitem__head">
                      <!-- 头像：角色有图就取图，没图 / 自定义发信人用首字占位 -->
                      <span class="msgitem__ava" :title="senderLabelOf(message)" aria-hidden="true">
                        <img v-if="avatarUrlOf(message)" :src="avatarUrlOf(message)" alt="" />
                        <template v-else>{{ initialOf(message) }}</template>
                      </span>

                      <label class="message-property"><span>发送者</span><select
                        class="msgitem__sender"
                        :value="senderValueOf(message)"
                        :disabled="readOnly || !hasSendableSender(conv)"
                        aria-label="发送者"
                        data-testid="msg-message-sender"
                        @change="commitSender(conv, message, $event)"
                      >
                        <option value="">未指定</option>
                        <option v-for="opt in senderOptions(conv)" :key="opt.id" :value="opt.id">
                          {{ opt.kind === 'custom' ? opt.name : labelOf(opt) }}
                        </option>
                      </select></label>

                      <!-- 时间 + 类型包成一组：折行时它们一起走，不会把「类型」单独甩到第二行 -->
                      <span class="msgitem__meta">
                        <label class="message-property"><span>发送时间</span><input
                          class="msgitem__time"
                          type="datetime-local"
                          :value="toDateTimeLocal(message.displayTime)"
                          :disabled="readOnly"
                          aria-label="发送时间"
                          data-testid="msg-message-time"
                          @change="commitTime(message, $event)"
                        /></label>

                        <label class="message-property"><span>消息类型</span><select
                          class="msgitem__type"
                          :value="message.contentType"
                          :disabled="readOnly"
                          aria-label="消息类型"
                          data-testid="msg-message-type"
                          @change="commitType(message, $event)"
                        >
                          <option v-for="type in MESSAGE_TYPES" :key="type" :value="type">
                            {{ MESSAGE_TYPE_LABELS[type] ?? type }}
                          </option>
                        </select></label>
                      </span>
                    </div>

                    <!-- 图片消息：缩略图行（封面角标 + 排序 + 删除）+ 上传；文本消息保留正文框 -->
                    <div v-if="message.contentType === 'image'" class="msgitem__media">
                      <div
                        v-for="(assetId, i) in message.mediaAssetIds ?? []"
                        :key="assetId"
                        class="msgitem__thumb"
                        :data-asset-id="assetId"
                      >
                        <img v-if="urlOf(assetId)" :src="urlOf(assetId)" alt="" />
                        <span v-else class="msgitem__thumb-missing">图片丢失</span>
                        <span class="msgitem__thumb-cover">封面</span>
                        <div class="msgitem__thumb-ops">
                          <button
                            type="button"
                            class="msgitem__thumbbtn"
                            :disabled="readOnly || i === 0"
                            :aria-label="`第 ${i + 1} 张左移`"
                            data-testid="msg-message-image-left"
                            @click="moveImage(message, i, -1)"
                          >
                            ←
                          </button>
                          <button
                            type="button"
                            class="msgitem__thumbbtn"
                            :disabled="readOnly || i === (message.mediaAssetIds ?? []).length - 1"
                            :aria-label="`第 ${i + 1} 张右移`"
                            data-testid="msg-message-image-right"
                            @click="moveImage(message, i, 1)"
                          >
                            →
                          </button>
                          <button
                            type="button"
                            class="msgitem__thumbbtn"
                            :disabled="readOnly"
                            :aria-label="`移除第 ${i + 1} 张`"
                            data-testid="msg-message-image-remove"
                            @click="removeImage(message, assetId)"
                          >
                            ×
                          </button>
                        </div>
                      </div>

                      <AppUploadButton
                        size="sm"
                        :multiple="true"
                        :disabled="readOnly || uploadingId === message.id || (message.mediaAssetIds ?? []).length >= MESSAGE_MEDIA_MAX"
                        accept="image/*"
                        test-id="msg-message-image"
                        @files="addImages(message, $event)"
                      >
                        {{
                          uploadingId === message.id
                            ? '处理中…'
                            : (message.mediaAssetIds ?? []).length >= MESSAGE_MEDIA_MAX
                              ? `已满 ${MESSAGE_MEDIA_MAX} 张`
                              : '添加图片'
                        }}
                      </AppUploadButton>
                      <span class="msgitem__mediahint">最多 {{ MESSAGE_MEDIA_MAX }} 张，第一张是封面</span>
                    </div>

                    <label v-if="message.contentType !== 'image'" class="message-property"><span>消息内容</span><textarea
                      class="msgitem__content"
                      :value="message.content"
                      :maxlength="MESSAGE_CONTENT_MAX_LENGTH"
                      :disabled="readOnly"
                      rows="3"
                      placeholder="消息内容"
                      data-testid="msg-message-content"
                      @change="commitContent(message, $event)"
                    ></textarea></label>

                    <!-- 已读回执：只对我方（所属人）消息有意义 -->
                    <div v-if="isOwnMessage(message)" class="msgitem__read" data-testid="msg-message-read">
                      <label class="msgitem__readcheck">
                        <input
                          type="checkbox"
                          :checked="Boolean(message.readAt)"
                          :disabled="readOnly"
                          data-testid="msg-message-readtoggle"
                          @change="commitRead(message, $event)"
                        />
                        对方已读
                      </label>
                      <label class="message-property"><span>已读时间</span><input
                        v-if="message.readAt"
                        class="msgitem__readtime"
                        type="datetime-local"
                        :value="toDateTimeLocal(message.readAt)"
                        :disabled="readOnly"
                        aria-label="已读时间"
                        data-testid="msg-message-readtime"
                        @change="commitReadTime(message, $event)"
                      /></label>
                    </div>
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
      在卡内绝对定位会被裁掉；定位按「＋ 添加」按钮的 rect 算，再在视口里夹紧。
    -->
    <Teleport to="body">
      <div
        v-if="addConvId && currentAddConv"
        class="msgpop"
        :style="addStyle"
        data-testid="msg-conv-addpop"
      >
        <input
          v-model="addQuery"
          class="msgpop__search"
          type="text"
          maxlength="30"
          placeholder="搜索角色"
          aria-label="搜索角色"
          data-testid="msg-conv-search"
        />
        <button
          v-for="ch in popCandidates(currentAddConv)"
          :key="ch.id"
          type="button"
          class="msgpop__opt"
          :data-value="ch.id"
          data-testid="msg-conv-add-option"
          @click="addParticipant(currentAddConv, ch.id)"
        >
          <span>{{ ch.name }}</span>
          <span class="msgpop__note">{{ ch.contactName }}</span>
        </button>
        <p
          v-if="!popCandidates(currentAddConv).length"
          class="msgpop__empty"
          data-testid="msg-conv-add-empty"
        >
          没有可添加的角色。自定义发信人（营销广告、快递通知）用条带里的输入框直接填。
        </p>
      </div>
    </Teleport>

    <!-- 导入对话框 -->
    <div v-if="importOpen" class="msgimport" data-testid="msg-import">
      <div class="msgimport__panel">
        <header class="msgimport__head">
          <h2 class="msgimport__title">导入对话</h2>
          <button type="button" class="msgimport__close" data-testid="msg-import-close" @click="closeImport">
            ×
          </button>
        </header>

        <p class="msgimport__hint">
          每行一条「角色名：内容」，空行跳过。<br />
          日期单独一行写（<code>YYYY/MM/DD</code>），后续消息归到这一天。<br />
          行尾「（hh:mm）」设置发送时刻；不写则比上一条晚 20 秒。<br />
          「（hh:mm 已读）」可标记已读时间，只用于手机所属人的消息。
        </p>

        <pre class="msgimport__sample">{{ IMPORT_TEMPLATE }}</pre>

        <textarea
          class="msgimport__input"
          :value="importText"
          rows="8"
          placeholder="在这里粘贴对话…"
          data-testid="msg-import-input"
          @input="importText = $event.target.value"
        ></textarea>

        <div class="msgimport__actions">
          <AppButton size="sm" data-testid="msg-import-parse" @click="runParse">解析预览</AppButton>
          <AppButton
            size="sm"
            variant="primary"
            :disabled="!importPreview || !importStats.matched"
            data-testid="msg-import-confirm"
            @click="doImport"
          >
            导入
          </AppButton>
        </div>

        <div v-if="importPreview" class="msgimport__preview" data-testid="msg-import-preview">
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
                data-testid="msg-import-day"
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
                <span v-if="line.readAt" class="msgimport__lineread">已读 {{ toDateTimeLocal(line.readAt).slice(11) }}</span>
              </li>
            </template>
          </ul>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped src="./MessagesEditor.css"></style>