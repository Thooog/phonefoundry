

<script setup>
import KakaoTalkMediaViewer from './KakaoTalkMediaViewer.vue'
import { useMessageViewer } from '../shared/use-message-viewer.js'
import { computed, nextTick, ref, watch } from 'vue'
import {
  buildConversationList,
  buildThread,
  chatIdentityOf,
  dayRelation,
  formatClock,
  TIME_FORMAT,
} from '@phone-sim/shared'
import ScrollArea from '../../appkit/ScrollArea.vue'
import Avatar from '../../appkit/Avatar.vue'
import EmptyState from '../../appkit/EmptyState.vue'
import { usePhoneRuntime, useWorkData } from '../../kernel/create-runtime.js'
import { useTapFeedback } from '../../kernel/use-tap-feedback.js'

const runtime = usePhoneRuntime()
const { getWork, resolveAsset } = useWorkData()

/** 消息图片：把 assetId 解析成可直接放进 <img> 的地址；取不到返回空串 */
function resolveSrc(assetId) {
  if (!assetId) return ''
  try {
    return resolveAsset(assetId) || ''
  } catch {
    return ''
  }
}

/** 一条图片消息里所有能解析出来的图；全都取不到时模板回落成「[图片]」占位 */
function imageSrcs(item) {
  return (item.mediaAssetIds ?? []).map(resolveSrc).filter(Boolean)
}

/**
 * 图集列数。
 *
 * 张数决定形状，而不是让格子去适应容器：2 张两列、4 张两列（刚好排成正方形），
 * 其余（3 张 / 5~9 张）三列 —— 9 张正好是 3×3 的九宫格。
 * 用 data-cols 交给 CSS，是因为 tile 的尺寸由网格 1fr 算出来，
 * 只改列数就能保证每格都是正方形，不用为每个张数各写一套宽高。
 */
function albumCols(n) {
  if (n <= 1) return 1
  return n === 2 || n === 4 ? 2 : 3
}

/* ── 语音消息 ──
 *
 * 语音条是「纯外观」：作品端是只读的，没有音频源也没有播放状态，
 * 按下播放不会发生任何事，所以整条不做成按钮（假按钮比不响应更糟）。
 */

/** 时长文字：秒 → 0:03 / 1:15。未填给 0:00，气泡里留空反而像坏了 */
function durationText(sec) {
  const n = Number(sec)
  if (!Number.isFinite(n) || n <= 0) return '0:00'
  const m = Math.floor(n / 60)
  return `${m}:${String(Math.round(n % 60)).padStart(2, '0')}`
}

function voiceWidth(sec) {
  const n = Number(sec)
  if (!Number.isFinite(n) || n <= 0) return 132
  return Math.min(116 + n * 2.6, 208)
}

/**
 * 波形柱高序列（0~1）。
 *
 * 用**固定序列**而不是 Math.random()：随机的话每次重渲染波形都会变，
 * 同一条语音在两帧截图里长得不一样 —— 探针没法断言，肉眼也能看出在跳。
 * 按消息 id 做一个小偏移，让两条语音的波形不是同一个样子。
 */
const WAVE = [
  0.35, 0.62, 0.44, 0.82, 0.55, 0.96, 0.7, 0.46, 1, 0.6, 0.38, 0.78, 0.5, 0.88, 0.58, 0.42,
  0.66, 0.48,
]

function waveOf(item) {
  const seed = String(item?.id ?? '')
    .split('')
    .reduce((sum, ch) => sum + ch.charCodeAt(0), 0)
  return WAVE.map((_, i) => WAVE[(i + seed) % WAVE.length])
}

/* ── 通话消息 ──
 *
 * 与语音同一条设计原则：**纯外观** —— 作品是只读的，按下不会真的拨出去，
 * 所以整条不做成按钮。气泡里的图标、文案、时长/标注都来自编辑端写好的字段。
 */

/** 气泡主文案：语音通话 / 视频通话（callKind 脏值已在派生层回落 null，再兜一层） */
function callLabel(item) {
  return item.callKind === 'video' ? '视频通话' : '语音通话'
}

/** 未接通才用红字标注；已接通走灰色的时长（复用语音的 durationText） */
function callMissed(item) {
  return item.callStatus === 'missed'
}

/**
 * 尾部标注。
 *
 * 未接通的文案**按气泡所在侧自动定**：发起方看到「已取消」，接听方看到「未接听」——
 * 一条通话记录两侧读者读到的话本来就不同，编辑端不用替他们二选一。
 * 已接通时尾部是时长，与语音条同一套写法。
 */
function callFootnote(item) {
  if (callMissed(item)) return item.side === 'right' ? '已取消' : '未接听'
  return durationText(item.durationSec)
}

/* ── 语音转文字 ──
 *
 * 「转」按钮 + 展开出来的那段文字，都是**读者本地的阅读状态**：
 * 不进数据、不影响导出，也不和剧情时间轴发生关系 —— 同一条语音
 * 读者点开看了一遍，不等于编剧把转写写进了作品。
 *
 * 用 Set 存已展开的消息 id，每次增删都换一个新 Set：
 * Vue 3 能追踪 Set 的增删，但换新引用最不容易踩"改了却没触发渲染"的坑。
 */
const openTranscripts = ref(new Set())

function transcriptOpen(item) {
  return openTranscripts.value.has(item.id)
}

function toggleTranscript(item) {
  const next = new Set(openTranscripts.value)
  if (next.has(item.id)) next.delete(item.id)
  else next.add(item.id)
  openTranscripts.value = next
}

const WEEKDAY_ZH = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']

function formatFullDate(date) {
  if (!date) return ''
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${WEEKDAY_ZH[date.getDay()]}`
}

const work = computed(() => getWork())
const settings = computed(() => work.value?.workSettings ?? {})
const timeFormat = computed(() => settings.value.timeFormat ?? TIME_FORMAT.H24)
const storyDate = computed(() => settings.value.storyDate ?? null)
const ownerCharacterId = computed(() => settings.value.ownerCharacterId ?? null)

const screen = computed(() => runtime.currentScreen.value)
const isDetail = computed(() => screen.value?.name === 'chat')
const isSearch = computed(() => screen.value?.name === 'search')

/**
 * 屏幕过渡方向。搜索屏是「原地覆盖」的（真机没有横向滑入滑出），
 * 而列表/会话详情仍是 push/pop 对称滑入。
 * 记上一屏名是为了在「退出搜索」时也能认出来 —— 那时当前屏已经变回列表了。
 * 名字 pui-screen-static 在 CSS 里**故意不定义任何规则**：Vue 检测不到过渡，
 * 于是直接换屏，不会残留一帧的 translateX。
 */
const prevScreenName = ref('')
watch(screen, (_now, prev) => {
  prevScreenName.value = prev?.name ?? ''
}, { flush: 'sync' })

const screenTransitionName = computed(() => {
  const now = screen.value?.name ?? ''
  if (now === 'search' || prevScreenName.value === 'search') return 'pui-screen-static'
  return `pui-screen-${runtime.state.transition === 'pop' ? 'pop' : 'push'}`
})

const conversations = computed(() => {
  if (!work.value) return []
  return buildConversationList(work.value, 'kakaotalk', {
    timeFormat: timeFormat.value,
    storyDate: storyDate.value,
    ownerCharacterId: ownerCharacterId.value,
  })
})

const thread = computed(() => {
  if (!isDetail.value || !work.value) return []
  return buildThread(work.value, screen.value.params, {
    ownerCharacterId: ownerCharacterId.value,
    storyDate: storyDate.value,
  })
})

// 查看器覆盖会话屏而不压导航栈；须在 thread 与 timeFormat 初始化后创建。
const viewerController = useMessageViewer({ thread, imageSrcs, runtime, timeFormat, tone: 'light' })
const { viewer, closeViewer, openViewer } = viewerController

const activeTitle = computed(() => {
  if (!isDetail.value) return '聊天'
  const conv = conversations.value.find((c) => c.id === screen.value.params)
  return conv?.title ?? '聊天'
})

/** 「我的资料」行显示所属人（名字/头像绑自己的 KKT 账号，与好友列表一致） */
const owner = computed(() => {
  if (!work.value || !ownerCharacterId.value) return null
  const c = work.value.characters?.find((ch) => ch.id === ownerCharacterId.value) ?? null
  if (!c) return null
  const identity = chatIdentityOf(work.value, 'kakaotalk', c.id)
  return identity ? { ...c, name: identity.name, avatarAssetId: identity.avatarAssetId } : c
})

const activeTab = ref('friends')

const { pinged, pingDown, pingUp, ping } = useTapFeedback()

/** 输入条：只是让人能真的打字（内容不进作品数据、不发送） */
const composerText = ref('')

/**
 * 好友列表只读取所属人 KKT 账号明确选择的人物，未配置时为空。
 * 名字/头像绑 KKT 账号昵称 —— 真机好友列表显示的就是 KKT 资料名，
 * 和聊天室顶栏、气泡里的名字保持一致，而不是一边昵称一边本名。
 */
const friends = computed(() => {
  const list = work.value?.characters ?? []
  const account = work.value?.platformAccounts?.find(a => a.platform === 'kakaotalk' && a.characterId === ownerCharacterId.value)
  const ids = Array.isArray(account?.extraFields?.friendList) ? account.extraFields.friendList : []
  const shown = list.filter(c => c.id !== ownerCharacterId.value && ids.includes(c.id))
  return shown.map((c) => {
    const identity = chatIdentityOf(work.value, 'kakaotalk', c.id)
    return identity ? { ...c, name: identity.name, avatarAssetId: identity.avatarAssetId } : c
  })
})

/** 好友 → 会话映射：角色是某会话的参与者，点好友即可直达该会话详情 */
const convByCharacter = computed(() => {
  const map = new Map()
  for (const conv of conversations.value) {
    for (const pid of conv.participantIds ?? []) {
      if (!map.has(pid)) map.set(pid, conv.id)
    }
  }
  return map
})

function openFriend(friend) {
  const convId = convByCharacter.value.get(friend.id)
  if (convId) runtime.push('chat', convId)
}

function isSelfChat(conv) {
  const ids = conv.participantIds ?? []
  return Boolean(ownerCharacterId.value) && ids.length === 1 && ids[0] === ownerCharacterId.value
}

const collapsed = ref({ plus: false, contacts: false })

function toggleGroup(key) {
  collapsed.value = { ...collapsed.value, [key]: !collapsed.value[key] }
}

/** 新消息到达或进入详情时要贴底，这是聊天应用的基本预期 */
const scroller = ref(null)

async function scrollToBottom() {
  await nextTick()
  scroller.value?.scrollToBottom()
}

watch(isDetail, (open) => {
  if (open) void scrollToBottom()
  // 离开会话时把查看器一起收掉，否则浮层会盖在列表屏上；
  // 状态栏字色也要交还，不然列表屏会是白字黑底
  else if (viewer.value) closeViewer()
})

// 预览里编辑一条消息也会走到这里：只在"条数变了"时贴底，

watch(
  () => thread.value.length,
  () => {
    if (isDetail.value) void scrollToBottom()
  },
)

function openChat(conv) {
  runtime.push('chat', conv.id)
}

function goBack() {
  runtime.pop()
}

/**
 * 回桌面：点顶部大标题（Friends / Chats）触发。
 *
 * 为什么挂在标题上而不是加一个 home 按钮：真机没有"退出应用"的界面元素，
 * 而我们的作品端没有 home 指示条的触控手势，根屏会变成死胡同。
 * 借用标题是最不打扰版式的位置 —— 它本来就在屏幕左上角、天然像"回到上一层"。
 */
function goHome() {
  runtime.goHome()
}

const searchInput = ref(null)
const searchQuery = ref('')
const searchAutoSave = ref(true)
const searchHistory = ref([])

/** 搜索屏：Chats / Friends 两个顶栏入口共用同一个**合并搜索** ——
 *  好友按昵称、对话按标题 + 全文（不只最后一条预览），结果里两者一起出现。 */

function openSearch() {

  searchQuery.value = ''
  runtime.push('search')
}

/** 进屏自动聚焦输入框，键盘准备好才是搜索页的第一印象 */
watch(isSearch, async (on) => {
  if (!on) return
  await nextTick()
  searchInput.value?.focus()
})

function rememberSearchTerm() {
  const term = searchQuery.value.trim()
  if (!term || !searchAutoSave.value) return
  searchHistory.value = [term, ...searchHistory.value.filter((t) => t !== term)].slice(0, 10)
}

function removeSearchTerm(term) {
  searchHistory.value = searchHistory.value.filter((t) => t !== term)
}

function clearSearchQuery() {
  searchQuery.value = ''
  nextTick(() => searchInput.value?.focus())
}

function openSearchResult(item) {
  rememberSearchTerm()
  if (item.kind === 'friend') {
    openFriend(item.item)
    return
  }
  runtime.push('chat', item.item.id)
}

/**
 * 每个会话的「可搜索正文」：标题 + 全部文字消息内容（小写用于匹配），
 * 并保留原始消息文本用于截取命中片段。
 * 只算一次（依赖 conversations / work，不随关键词变化），关键词变化时直接复用。
 */
const conversationSearchText = computed(() => {
  const map = new Map()
  if (!work.value) return map
  for (const conv of conversations.value) {
    const items = buildThread(work.value, conv.id, {
      ownerCharacterId: ownerCharacterId.value,
      storyDate: storyDate.value,
    })
    const texts = items
      .filter((t) => t.kind === 'message' && t.contentType === 'text')
      .map((t) => String(t.content ?? ''))
    map.set(conv.id, {
      title: conv.title.toLowerCase(),
      body: texts.join(' ').toLowerCase(),
      messages: texts,
    })
  }
  return map
})

/**
 * 结果副行文案：标题命中时用最后一条消息预览（保持原有行为）；
 * 正文命中时截取命中消息的片段（命中段居中，前后留省略号），让搜索结果
 * 显示的是"真正命中那一句"，而不是毫不相干的最后一条。
 */
function searchPreview(conv) {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return conv.preview
  const entry = conversationSearchText.value.get(conv.id)
  if (!entry) return conv.preview
  if (entry.title.includes(q)) return conv.preview
  for (const msg of entry.messages) {
    const idx = msg.toLowerCase().indexOf(q)
    if (idx !== -1) {
      const start = Math.max(0, idx - 12)
      let slice = msg.slice(start, start + 40)
      if (start > 0) slice = '…' + slice
      if (start + 40 < msg.length) slice = slice + '…'
      return slice
    }
  }
  return conv.preview
}

/** 合并搜索：好友（昵称）+ 对话（标题 + 全文）一起命中，结果带 kind 区分渲染与点击。 */
const searchResults = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return []
  const out = []
  for (const f of friends.value) {
    if (f.name.toLowerCase().includes(q)) out.push({ kind: 'friend', item: f })
  }
  for (const conv of conversations.value) {
    const entry = conversationSearchText.value.get(conv.id)
    if (!entry) continue
    if (entry.title.includes(q) || entry.body.includes(q)) {
      // 命中条数：同一会话里有多少条消息命中关键词（标题命中但正文没命中时记为 0，
      // 结果行就不显示条数，避免出现"0 条"的怪数字）。
      const matches = entry.messages.reduce(
        (n, m) => (m.toLowerCase().includes(q) ? n + 1 : n),
        0,
      )
      out.push({ kind: 'chat', item: conv, snippet: searchPreview(conv), count: matches })
    }
  }
  return out
})

/** 结果行的主标题：聊天=会话标题，好友=昵称（同一套高亮逻辑） */
function searchName(item) {
  return item.kind === 'friend' ? item.item.name : item.item.title
}

/** 标题按命中切分：命中段标蓝，其余保持原色 */
function highlightParts(title, query) {
  const text = String(title ?? '')
  const needle = query.trim().toLowerCase()
  if (!needle) return [{ text, hit: false }]
  const lower = text.toLowerCase()
  const parts = []
  let cursor = 0
  while (cursor < text.length) {
    const idx = lower.indexOf(needle, cursor)
    if (idx === -1) {
      parts.push({ text: text.slice(cursor), hit: false })
      break
    }
    if (idx > cursor) parts.push({ text: text.slice(cursor, idx), hit: false })
    parts.push({ text: text.slice(idx, idx + needle.length), hit: true })
    cursor = idx + needle.length
  }
  return parts
}

function searchStamp(conv) {
  const date = conv.sortKey ? new Date(conv.sortKey) : null
  if (!date || Number.isNaN(date.getTime())) return ''
  const relation = dayRelation(date, storyDate.value)
  if (relation === 'today') return formatClock(date, timeFormat.value)
  if (relation === 'yesterday') return '昨天'
  if (relation === 'thisYear') return `${date.getMonth() + 1}月${date.getDate()}日`
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}

/**
 * 同一发送者连发的消息算**一组**：组内只在第一条显示头像、只在最后一条显示时间。
 *
 * 真机的做法 —— 连发三四条只看到一个头像，时间和「未读」一起落在组的末尾。
 * 判断只看「同侧 + 同作者」，不掺时间戳：同一分钟连发是常态，掺进去等于没分组；
 * 反过来两条恰好同分钟但被对方插话，也会被 side 拆开，不会误并。
 */
function sameSender(a, b) {
  if (!a || !b || a.kind !== 'message' || b.kind !== 'message') return false
  return a.side === b.side && a.authorName === b.authorName
}

/** 组的第一条：头像挂这里（只有对方消息会画） */
function isGroupStart(item, index) {
  return !sameSender(thread.value[index - 1], item)
}

/** 组的最后一条：时间挂这里 */
function isGroupEnd(item, index) {
  return !sameSender(item, thread.value[index + 1])
}

</script>

<template>
  <div class="pui-kt" data-testid="kakaotalk-app">
    <Transition :name="screenTransitionName">
      <!-- 列表：底部 tab 切换 Friends / Chats（通话与更多为装饰图标，无入口） -->
      <section v-if="!isDetail && !isSearch" key="list" class="pui-kt__screen pui-kt__screen--list" data-testid="kt-list-screen">
        <template v-if="activeTab === 'friends'">
          <header class="pui-kt__masthead">
            <button
              type="button"
              class="pui-kt__mast-title"
              data-testid="kt-list-title"
              aria-label="Friends，回到桌面"
              @click="goHome"
            >
              Friends
            </button>
            <div class="pui-kt__masthead-icons">
              <!-- 放大镜是真实入口：进好友搜索屏（Chats 页那颗搜会话，这里是搜好友） -->
              <button
                type="button"
                class="pui-kt__mast-icon"
                data-testid="kt-search-open-friend"
                aria-label="搜索"
                @click="openSearch"
              >
                <svg viewBox="0 0 24 24" class="pui-kt__glyph"><g transform="translate(12 12) scale(1.05) translate(-12 -12)"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="1.74" /><path d="M15.5 15.5L20.5 20.5" stroke="currentColor" stroke-width="1.74" stroke-linecap="round" /></g></svg>
              </button>
              <!-- 加好友（装饰入口：作品里没有好友管理页，点击只给一次按压反馈）。
                   整组放大 1.20 倍（开口人形墨迹 18.1×15.7 → 21.7×18.8 units，与齿轮视觉齐平），
                   缩放组内 stroke 换算回 2.0px 渲染值 -->
              <button
                type="button"
                class="pui-kt__mast-icon"
                :class="{ 'pui-kt__mast-icon--ping': pinged === 'addFriend' }"
                data-testid="kt-friend-add"
                aria-label="添加好友"
                @pointerdown="pingDown('addFriend')"
                @pointerup="pingUp"
                @pointercancel="pingUp"
                @pointerleave="pingUp"
                @click="ping('addFriend')"
              >
                <svg viewBox="0 0 24 24" class="pui-kt__glyph"><g transform="translate(11.75 12.05) scale(1.2) translate(-11.75 -12.05)"><circle cx="9" cy="8.5" r="3.4" fill="none" stroke="currentColor" stroke-width="1.74" /><path d="M3.5 19c.7-3.2 2.9-5 5.5-5s4.8 1.8 5.5 5" fill="none" stroke="currentColor" stroke-width="1.74" stroke-linecap="round" /><path d="M17 6.5v6M20 9.5h-6" stroke="currentColor" stroke-width="1.74" stroke-linecap="round" /></g></svg>
              </button>
              <!-- 设置（同上：没有设置页，只给按压反馈） -->
              <button
                type="button"
                class="pui-kt__mast-icon"
                :class="{ 'pui-kt__mast-icon--ping': pinged === 'settings' }"
                data-testid="kt-settings-friend"
                aria-label="设置"
                @pointerdown="pingDown('settings')"
                @pointerup="pingUp"
                @pointercancel="pingUp"
                @pointerleave="pingUp"
                @click="ping('settings')"
              >
                <svg viewBox="0 0 24 24" class="pui-kt__glyph"><path d="M10.33 2.55L13.67 2.55L14.72 5.44L17.51 4.14L19.86 6.49L18.56 9.28L21.45 10.33L21.45 13.67L18.56 14.72L19.86 17.51L17.51 19.86L14.72 18.56L13.67 21.45L10.33 21.45L9.28 18.56L6.49 19.86L4.14 17.51L5.44 14.72L2.55 13.67L2.55 10.33L5.44 9.28L4.14 6.49L6.49 4.14L9.28 5.44Z" fill="none" stroke="currentColor" stroke-width="2.09" stroke-linejoin="round" /><circle cx="12" cy="12" r="2.6" fill="none" stroke="currentColor" stroke-width="2.09" /></svg>
              </button>
            </div>
          </header>

          <ScrollArea scroll-key="kakaotalk:friends" padding-bottom="12">
            <!-- 我的资料行：整行可点（点亮整行浅灰底），右侧 Profile + 单独给反馈
                 —— 作品没有资料编辑页，两者都只给按压效果、不跳屏 -->
            <button
              v-if="owner"
              type="button"
              class="pui-kt__me"
              :class="{ 'pui-kt__me--ping': pinged === 'me' }"
              data-testid="kt-me-row"
              @pointerdown="pingDown('me')"
              @pointerup="pingUp"
              @pointercancel="pingUp"
              @pointerleave="pingUp"
              @click="ping('me')"
            >
              <Avatar :asset-id="owner.avatarAssetId" :name="owner.name || '我'" :size="54" />
              <span class="pui-kt__me-name">{{ owner.name || '我' }}</span>
              <!-- button 里不能再嵌 button，pill 用 span + .stop：点它只亮 pill，不连带整行 -->
              <span
                class="pui-kt__me-pill"
                :class="{ 'pui-kt__me-pill--ping': pinged === 'mePill' }"
                data-testid="kt-me-pill"
                @pointerdown.stop="pingDown('mePill')"
                @pointerup.stop="pingUp"
                @pointercancel.stop="pingUp"
                @pointerleave.stop="pingUp"
                @click.stop="ping('mePill')"
              >Profile +</span>
            </button>

            <!-- Plus Friend 分组（装饰行，无入口） -->
            <button type="button" class="pui-kt__section" @click="toggleGroup('plus')">
              <span>Plus Friend</span>
              <svg
                viewBox="0 0 24 24"
                class="pui-kt__section-arrow"
                :class="{ 'pui-kt__section-arrow--closed': collapsed.plus }"
                aria-hidden="true"
              ><path d="M6 14.5L12 8.5L18 14.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
            </button>
            <div v-show="!collapsed.plus" class="pui-kt__room pui-kt__room--static" aria-hidden="true">
              <span class="pui-kt__plus-avatar">Ch</span>
              <span class="pui-kt__room-name">Plus Friend</span>
              <svg viewBox="0 0 24 24" class="pui-kt__room-chevron"><path d="M9 5.5L15.5 12L9 18.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
            </div>

            <!-- 通讯录好友分组：真实角色数据 -->
            <button type="button" class="pui-kt__section" @click="toggleGroup('contacts')">
              <span>通讯录好友 {{ friends.length }}</span>
              <svg
                viewBox="0 0 24 24"
                class="pui-kt__section-arrow"
                :class="{ 'pui-kt__section-arrow--closed': collapsed.contacts }"
                aria-hidden="true"
              ><path d="M6 14.5L12 8.5L18 14.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
            </button>
            <div v-show="!collapsed.contacts">
              <div class="pui-kt__room pui-kt__room--static pui-kt__room--invite" aria-hidden="true">
                <span class="pui-kt__invite-icon">
                  <svg viewBox="0 0 24 24"><path d="M4 6.5h16v11H4z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" /><path d="M4.5 7l7.5 5.6L19.5 7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" /></svg>
                </span>
                <span class="pui-kt__room-name">邀请好友加入KakaoTalk</span>
                <svg viewBox="0 0 24 24" class="pui-kt__room-chevron"><path d="M9 5.5L15.5 12L9 18.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
              </div>

              <ul v-if="friends.length" class="pui-kt__rooms">
                <li v-for="friend in friends" :key="friend.id">
                  <button
                    type="button"
                    class="pui-kt__room"
                    data-testid="kt-friend-item"
                    @click="openFriend(friend)"
                  >
                    <Avatar class="pui-kt__room-avatar" :asset-id="friend.avatarAssetId" :name="friend.name" :size="46" shape="squircle" />
                    <span class="pui-kt__room-name">{{ friend.name }}</span>
                  </button>
                </li>
              </ul>

              <EmptyState
                v-else
                icon="chat"
                title="还没有好友"
              />
            </div>
          </ScrollArea>
        </template>

        <template v-else>
          <header class="pui-kt__masthead">
            <button
              type="button"
              class="pui-kt__mast-title"
              data-testid="kt-list-title"
              aria-label="Chats，回到桌面"
              @click="goHome"
            >
              Chats
            </button>
            <div class="pui-kt__masthead-icons">
              <!-- 放大镜是真实入口：进聊天室搜索屏（Friends 页的仍是装饰） -->
              <button
                type="button"
                class="pui-kt__mast-icon"
                data-testid="kt-search-open"
                aria-label="搜索"
                @click="openSearch"
              >
                <svg viewBox="0 0 24 24" class="pui-kt__glyph"><g transform="translate(12 12) scale(1.05) translate(-12 -12)"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="1.74" /><path d="M15.5 15.5L20.5 20.5" stroke="currentColor" stroke-width="1.74" stroke-linecap="round" /></g></svg>
              </button>
              <!-- 新建聊天 / 开放聊天 / 设置：作品里都没有对应页面，
                   收在同一组里只为共享 16px 间距；点一下给按压反馈 -->
              <span class="pui-kt__masthead-deco">

                <button
                  type="button"
                  class="pui-kt__mast-icon"
                  :class="{ 'pui-kt__mast-icon--ping': pinged === 'chatNew' }"
                  data-testid="kt-chat-new"
                  aria-label="新建聊天"
                  @pointerdown="pingDown('chatNew')"
                  @pointerup="pingUp"
                  @pointercancel="pingUp"
                  @pointerleave="pingUp"
                  @click="ping('chatNew')"
                >
                  <svg viewBox="-2.9 -4.1 50.6 47" class="pui-kt__glyph"><path d="M35.6834 6.94709C28.2211 0.446768 10.1447 -1.55078 2.68311 12.9483C-0.341538 24.4473 7.65815 30.4473 7.65815 30.4473L9.14483 31.4526C9.14483 31.4526 8.94483 39.5526 10.1448 39.9526C11.3448 40.3526 15.3503 36.6139 17.1836 34.9473C23.1836 35.4473 29.1837 35.1473 33.1837 31.9473M31.6582 19.4473H38.1582M38.1582 19.4473H45.1581M38.1582 19.4473V12.9483M38.1582 19.4473V26.4473" fill="none" stroke="currentColor" stroke-width="4.4" stroke-linecap="round" /></svg>
                </button>

                <button
                  type="button"
                  class="pui-kt__mast-icon"
                  :class="{ 'pui-kt__mast-icon--ping': pinged === 'chatOpen' }"
                  data-testid="kt-chat-open"
                  aria-label="开放聊天"
                  @pointerdown="pingDown('chatOpen')"
                  @pointerup="pingUp"
                  @pointercancel="pingUp"
                  @pointerleave="pingUp"
                  @click="ping('chatOpen')"
                >
                  <svg viewBox="-0.6 -0.6 53.7 40.2" class="pui-kt__glyph pui-kt__glyph--wide"><path d="M11.0215 11.4902C12.8548 7.98824 17.5069 2.01109 26.0215 2.00002C32.0215 1.99222 37.5215 3.99967 41.0215 6.99967M41.0215 26.9902L39.0215 29.4902C39.3548 31.3203 39.8215 35.1824 39.0215 35.9902C38.2215 36.7981 34.0215 33.9935 32.0215 32.4902C29.9044 32.9968 25.0054 33.5078 22.3459 31.5M39.0215 16.9902H45.0215M45.0215 16.9902H50.5215M45.0215 16.9902V11.4902M45.0215 16.9902V23.4878" fill="none" stroke="currentColor" stroke-width="4.13" stroke-linecap="round" /><path d="M22.3459 31.5C19.6863 32.9124 16.6197 33.5113 14.0048 33.5113H12.5048C10.6714 34.678 8.02148 37.5 7.02148 37C6.22148 36.6 7.02148 31.5 7.02148 31.5C7.02148 31.5 5.75294 30.7115 5.50499 30.5113C1.52438 28.0079 2.02184 24.498 2.02184 22.498C2.40665 15.9547 7.08919 12.4902 11.0215 11.4902C12.3876 11.1428 14.2574 11 15.5215 11C25.0215 11 29.5215 18.4902 28.5244 23.4878C27.7521 27.3584 25.3002 29.9311 22.3459 31.5Z" fill="#fff" stroke="currentColor" stroke-width="4.13" stroke-linecap="round" /></svg>
                </button>
                <button
                  type="button"
                  class="pui-kt__mast-icon"
                  :class="{ 'pui-kt__mast-icon--ping': pinged === 'settingsChat' }"
                  data-testid="kt-settings-chat"
                  aria-label="设置"
                  @pointerdown="pingDown('settingsChat')"
                  @pointerup="pingUp"
                  @pointercancel="pingUp"
                  @pointerleave="pingUp"
                  @click="ping('settingsChat')"
                >
                  <svg viewBox="0 0 24 24" class="pui-kt__glyph"><path d="M10.33 2.55L13.67 2.55L14.72 5.44L17.51 4.14L19.86 6.49L18.56 9.28L21.45 10.33L21.45 13.67L18.56 14.72L19.86 17.51L17.51 19.86L14.72 18.56L13.67 21.45L10.33 21.45L9.28 18.56L6.49 19.86L4.14 17.51L5.44 14.72L2.55 13.67L2.55 10.33L5.44 9.28L4.14 6.49L6.49 4.14L9.28 5.44Z" fill="none" stroke="currentColor" stroke-width="2.09" stroke-linejoin="round" /><circle cx="12" cy="12" r="2.6" fill="none" stroke="currentColor" stroke-width="2.09" /></svg>
                </button>
              </span>
            </div>
          </header>

          <!-- 筛选 chips：没有未读数据，所以不做真正的过滤（选中态始终是「全部」），
               未读 / 排序点一下只给按压反馈，避免看起来像坏了 -->
          <div class="pui-kt__chips">
            <button type="button" class="pui-kt__chip pui-kt__chip--on" tabindex="-1">全部</button>
            <button
              type="button"
              class="pui-kt__chip"
              :class="{ 'pui-kt__chip--ping': pinged === 'unread' }"
              data-testid="kt-chip-unread"
              @pointerdown="pingDown('unread')"
              @pointerup="pingUp"
              @pointercancel="pingUp"
              @pointerleave="pingUp"
              @click="ping('unread')"
            >
              未读
            </button>
            <button
              type="button"
              class="pui-kt__chip pui-kt__chip--icon"
              :class="{ 'pui-kt__chip--ping': pinged === 'sort' }"
              data-testid="kt-chip-sort"
              aria-label="排序"
              @pointerdown="pingDown('sort')"
              @pointerup="pingUp"
              @pointercancel="pingUp"
              @pointerleave="pingUp"
              @click="ping('sort')"
            >
              <svg viewBox="0 0 24 24"><path d="M4.5 7h11M4.5 12h8M4.5 17h5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /><path d="M17.5 13.5v6M14.5 16.5h6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
            </button>
          </div>

          <ScrollArea scroll-key="kakaotalk:chats" padding-bottom="12">
            <ul v-if="conversations.length" class="pui-kt__rooms">
              <li v-for="conv in conversations" :key="conv.id">
                <button
                  type="button"
                  class="pui-kt__room"
                  data-testid="kt-conversation-item"
                  @click="openChat(conv)"
                >
                  <Avatar class="pui-kt__room-avatar" :asset-id="conv.avatarAssetId" :name="conv.title" :size="48" shape="squircle" />
                  <span class="pui-kt__room-main">
                    <span class="pui-kt__room-name">
                      {{ conv.title }}
                      <i v-if="isSelfChat(conv)" class="pui-kt__me-badge">me</i>
                    </span>
                    <span class="pui-kt__room-preview">{{ conv.preview }}</span>
                  </span>
                  <span class="pui-kt__room-time">{{ conv.timeLabel }}</span>
                </button>
              </li>
            </ul>

            <EmptyState
              v-else
              icon="chat"
              title="还没有对话"
            />
          </ScrollArea>
        </template>

        <!-- 底部 tab：好友/聊天可切换；通话/更多仅装饰 -->
        <nav class="pui-kt__tabs">
          <button
            type="button"
            class="pui-kt__tab"
            :class="{ 'pui-kt__tab--on': activeTab === 'friends' }"
            data-testid="kt-tab-friends"
            aria-label="好友"
            @click="activeTab = 'friends'"
          >
            <svg viewBox="0 0 24 24"><circle cx="12" cy="7" r="5.6" fill="currentColor" /><path d="M2.6 21.4c.4-4.9 4.3-7.7 9.4-7.7s9 2.8 9.4 7.7z" fill="currentColor" /></svg>
          </button>
          <button
            type="button"
            class="pui-kt__tab"
            :class="{ 'pui-kt__tab--on': activeTab === 'chats' }"
            data-testid="kt-tab-chats"
            aria-label="聊天"
            @click="activeTab = 'chats'"
          >
            <!-- 设计图里气泡是四颗 tab 中最大的一颗（墨迹 22.5px@432）：
                 原路径只占 17.2×16.2 viewBox 单位，包一层 1.19 放大到 20.5×19.3，
                 与人像/听筒墨迹齐平 -->
            <svg viewBox="0 0 24 24"><g transform="translate(12 11.9) scale(1.19) translate(-12 -11.9)"><path d="M12 3.8c5 0 8.6 3.2 8.6 7.4S17 18.6 12 18.6c-1 0-2-.1-2.9-.4L5 20l1.2-3.3C4.3 15.4 3.4 13.5 3.4 11.2 3.4 7 7 3.8 12 3.8z" fill="currentColor" /></g></svg>
          </button>
          <!-- 通话 tab（装饰）：实心听筒。
               形状沿用 symbols/AppIcons.vue 里定稿的 Font Awesome 6 solid 听筒；
               与其余三颗 tab（人像/气泡/省略号）一致走 fill=currentColor 实心填充。
               512 坐标系按 0.03844 缩进 24 viewBox（墨迹约 19.7×19.6，与原线描版外沿等大，
               人像 18.8 宽 / 气泡 20.5 宽 之间）并居中。 -->
          <!-- 通话（装饰 tab：作品里没有通话页，点击只给按压反馈、不动 activeTab） -->
          <button
            type="button"
            class="pui-kt__tab"
            :class="{ 'pui-kt__tab--ping': pinged === 'calls' }"
            data-testid="kt-tab-calls"
            aria-label="通话"
            @pointerdown="pingDown('calls')"
            @pointerup="pingUp"
            @pointercancel="pingUp"
            @pointerleave="pingUp"
            @click="ping('calls')"
          >
            <svg viewBox="0 0 24 24">
              <g transform="translate(2.16 2.16) scale(0.03844)">
                <path
                  d="M164.9 24.6c-7.7-18.6-28-28.5-47.4-23.2l-88 24C12.1 30.2 0 46 0 64C0 311.4 200.6 512 448 512c18 0 33.8-12.1 38.6-29.5l24-88c5.3-19.4-4.6-39.7-23.2-47.4l-96-40c-16.3-6.8-35.2-2.1-46.3 11.6L304.7 368C234.3 334.7 177.3 277.7 144 207.3L193.3 167c13.7-11.2 18.4-30 11.6-46.3l-40-96z"
                  fill="currentColor"
                />
              </g>
            </svg>
          </button>
          <!-- 更多（同上：装饰 tab） -->
          <button
            type="button"
            class="pui-kt__tab"
            :class="{ 'pui-kt__tab--ping': pinged === 'more' }"
            data-testid="kt-tab-more"
            aria-label="更多"
            @pointerdown="pingDown('more')"
            @pointerup="pingUp"
            @pointercancel="pingUp"
            @pointerleave="pingUp"
            @click="ping('more')"
          >
            <svg viewBox="0 0 24 24"><g transform="translate(12 12) scale(1.4) translate(-12 -12)"><circle cx="5.5" cy="12" r="1.7" fill="currentColor" /><circle cx="12" cy="12" r="1.7" fill="currentColor" /><circle cx="18.5" cy="12" r="1.7" fill="currentColor" /></g></svg>
          </button>
        </nav>
      </section>

      <section v-else-if="isSearch" key="search" class="pui-kt__screen pui-kt__screen--search" data-testid="kt-search-screen">
        <header class="pui-kt__search-head">
          <div class="pui-kt__search-bar">
            <button
              type="button"
              class="pui-kt__search-back"
              data-testid="kt-search-back"
              aria-label="返回"
              @click="goBack"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 12H5.5M11.5 5.5L5 12l6.5 6.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
            </button>
            <input
              ref="searchInput"
              v-model="searchQuery"
              class="pui-kt__search-input"
              type="text"
              placeholder="Search"
              autocomplete="off"
              data-testid="kt-search-input"
              @keydown.enter="rememberSearchTerm"
            />
            <!-- 有关键词：深灰圆底 ×（清除）；空关键词：扫码框（装饰） -->
            <button
              v-if="searchQuery"
              type="button"
              class="pui-kt__search-clear"
              data-testid="kt-search-clear"
              aria-label="清除"
              @click="clearSearchQuery"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 7.5l9 9M16.5 7.5l-9 9" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" /></svg>
            </button>
            <span v-else class="pui-kt__search-scan" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M4 8.2V6.5A2.5 2.5 0 0 1 6.5 4h1.7M15.8 4h1.7A2.5 2.5 0 0 1 20 6.5v1.7M20 15.8v1.7a2.5 2.5 0 0 1-2.5 2.5h-1.7M8.2 20H6.5A2.5 2.5 0 0 1 4 17.5v-1.7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /><path d="M4 12h16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
            </span>
          </div>
        </header>

        <ScrollArea scroll-key="kakaotalk:search" padding-bottom="12">
          <!-- 近期搜索 -->
          <div v-if="!searchQuery && searchHistory.length" class="pui-kt__search-card" data-testid="kt-search-recent">
            <div class="pui-kt__search-card-head">
              <span class="pui-kt__search-card-title">近期搜索</span>
              <span class="pui-kt__search-actions">
                <button type="button" class="pui-kt__search-action" data-testid="kt-search-clear-all" @click="searchHistory = []">全部删除</button>
                <i class="pui-kt__search-vline" aria-hidden="true" />
                <button type="button" class="pui-kt__search-action" data-testid="kt-search-autosave" @click="searchAutoSave = !searchAutoSave">
                  {{ searchAutoSave ? '关闭自动保存' : '开启自动保存' }}
                </button>
              </span>
            </div>
            <div class="pui-kt__search-terms">
              <span v-for="term in searchHistory" :key="term" class="pui-kt__search-term">
                <button type="button" class="pui-kt__search-term-label" @click="searchQuery = term">{{ term }}</button>
                <button type="button" class="pui-kt__search-term-x" :aria-label="`删除 ${term}`" @click="removeSearchTerm(term)">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" /></svg>
                </button>
              </span>
            </div>
          </div>

          <template v-else-if="searchQuery">
            <!-- 筛选 chips：日期/好友/聊天室都没有下拉面板，点一下只给按压反馈 -->
            <div class="pui-kt__search-card pui-kt__search-filters">
              <button
                type="button"
                class="pui-kt__search-filter"
                :class="{ 'pui-kt__search-filter--ping': pinged === 'filterDate' }"
                data-testid="kt-search-filter-date"
                @pointerdown="pingDown('filterDate')"
                @pointerup="pingUp"
                @pointercancel="pingUp"
                @pointerleave="pingUp"
                @click="ping('filterDate')"
              >
                日期
                <svg viewBox="0 0 24 24"><path d="M7 10l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
              </button>
              <button
                type="button"
                class="pui-kt__search-filter"
                :class="{ 'pui-kt__search-filter--ping': pinged === 'filterFriend' }"
                data-testid="kt-search-filter-friend"
                @pointerdown="pingDown('filterFriend')"
                @pointerup="pingUp"
                @pointercancel="pingUp"
                @pointerleave="pingUp"
                @click="ping('filterFriend')"
              >
                好友
                <svg viewBox="0 0 24 24"><path d="M7 10l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
              </button>
              <button
                type="button"
                class="pui-kt__search-filter"
                :class="{ 'pui-kt__search-filter--ping': pinged === 'filterRoom' }"
                data-testid="kt-search-filter-room"
                @pointerdown="pingDown('filterRoom')"
                @pointerup="pingUp"
                @pointercancel="pingUp"
                @pointerleave="pingUp"
                @click="ping('filterRoom')"
              >
                聊天室
                <svg viewBox="0 0 24 24"><path d="M7 10l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
              </button>
            </div>

            <!-- 命中的结果：好友（头像+名字）与对话（头像+标题+正文片段）合并显示 -->
            <div v-if="searchResults.length" class="pui-kt__search-card pui-kt__search-results" data-testid="kt-search-results">
              <button
                v-for="item in searchResults"
                :key="item.kind + ':' + item.item.id"
                type="button"
                class="pui-kt__search-hit"
                data-testid="kt-search-hit"
                :data-mode="item.kind"
                @click="openSearchResult(item)"
              >
                <Avatar class="pui-kt__room-avatar" :asset-id="item.item.avatarAssetId" :name="searchName(item)" :size="46" shape="squircle" />
                <span class="pui-kt__search-hit-body">
                  <span class="pui-kt__search-hit-main">
                    <!-- 设计图口径：命中的消息正文在上，房间名/对方昵称在下 -->
                    <span v-if="item.kind === 'chat'" class="pui-kt__search-hit-preview">
                      <template v-for="(part, i) in highlightParts(item.snippet, searchQuery)" :key="i">
                        <span v-if="part.hit" class="pui-kt__search-hit-hl">{{ part.text }}</span>
                        <template v-else>{{ part.text }}</template>
                      </template>
                    </span>
                    <span class="pui-kt__search-hit-name">
                      <span
                        v-for="(part, i) in highlightParts(searchName(item), searchQuery)"
                        :key="i"
                        :class="{ 'pui-kt__search-hit-hl': part.hit }"
                      >{{ part.text }}</span>
                    </span>
                  </span>
                  <span v-if="item.kind === 'chat'" class="pui-kt__search-hit-side">
                    <span class="pui-kt__search-hit-time">{{ searchStamp(item.item) }}</span>
                    <span v-if="item.count > 0" class="pui-kt__search-hit-count" data-testid="kt-search-hit-count">{{ item.count }}条</span>
                  </span>
                </span>
              </button>
            </div>

            <div v-else class="pui-kt__search-card pui-kt__search-empty" data-testid="kt-search-empty">
              无搜索结果
            </div>
          </template>
        </ScrollArea>
      </section>

      <section v-else :key="`chat:${screen?.params}`" class="pui-kt__screen pui-kt__screen--chat" data-testid="kt-thread-screen">
        <header class="pui-kt__chatbar">
          <button type="button" class="pui-kt__back" data-testid="nav-back" aria-label="返回" @click="goBack">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 5.5L8 12l6.5 6.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
          </button>
          <h1 class="pui-kt__chatbar-title">{{ activeTitle }}</h1>
          <!-- 会话内搜索 / 云端备份 / 菜单：作品里都没有二级页，只给按压反馈 -->
          <div class="pui-kt__chatbar-icons">
            <button
              type="button"
              class="pui-kt__mast-icon"
              :class="{ 'pui-kt__mast-icon--ping': pinged === 'threadSearch' }"
              data-testid="kt-thread-search"
              aria-label="聊天室搜索"
              @pointerdown="pingDown('threadSearch')"
              @pointerup="pingUp"
              @pointercancel="pingUp"
              @pointerleave="pingUp"
              @click="ping('threadSearch')"
            >
              <svg viewBox="0 0 24 24" class="pui-kt__glyph"><g transform="translate(12 12) scale(1.05) translate(-12 -12)"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="1.74" /><path d="M15.5 15.5L20.5 20.5" stroke="currentColor" stroke-width="1.74" stroke-linecap="round" /></g></svg>
            </button>
            <button
              type="button"
              class="pui-kt__mast-icon"
              :class="{ 'pui-kt__mast-icon--ping': pinged === 'threadCloud' }"
              data-testid="kt-thread-cloud"
              aria-label="聊天备份"
              @pointerdown="pingDown('threadCloud')"
              @pointerup="pingUp"
              @pointercancel="pingUp"
              @pointerleave="pingUp"
              @click="ping('threadCloud')"
            >
              <svg viewBox="0 0 24 24" class="pui-kt__glyph"><path d="M7 17a4.5 4.5 0 01-.4-9A5.5 5.5 0 0117.4 9.6 3.8 3.8 0 0117 17z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" /></svg>
            </button>
            <button
              type="button"
              class="pui-kt__mast-icon"
              :class="{ 'pui-kt__mast-icon--ping': pinged === 'threadMenu' }"
              data-testid="kt-thread-menu"
              aria-label="菜单"
              @pointerdown="pingDown('threadMenu')"
              @pointerup="pingUp"
              @pointercancel="pingUp"
              @pointerleave="pingUp"
              @click="ping('threadMenu')"
            >
              <svg viewBox="0 0 24 24" class="pui-kt__glyph"><path d="M4.5 7h15M4.5 12h15M4.5 17h15" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" /></svg>
            </button>
          </div>
        </header>

        <ScrollArea ref="scroller" padding-bottom="16" data-testid="kt-thread-scroll">
          <template v-for="(item, index) in thread" :key="item.id">
            <p v-if="item.kind === 'divider'" class="pui-kt__divider">
              <span class="pui-kt__divider-pill">
                {{ formatFullDate(item.date) }}
                <svg viewBox="0 0 24 24" class="pui-kt__divider-caret" aria-hidden="true">
                  <path d="M9 5.5L15.5 12L9 18.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </span>
            </p>

            <!-- 系统消息：没有发送者、没有气泡，居中的一行灰字（真机就是这样）。
                 它会把前后同一人的连发拆成两组 —— sameSender 只认同 kind:'message'，
                 这正好是想要的效果：一条"某某被移出群聊"插进来，本来就不该并进连发 -->
            <p
              v-else-if="item.kind === 'system'"
              class="pui-kt__system"
              data-testid="kt-system"
            >
              {{ item.content }}
            </p>

            <div
              v-else
              class="pui-kt__row"
              :data-side="item.side"
              :data-group="isGroupStart(item, index) ? 'start' : 'cont'"
            >
              <!-- 只有对方消息才有头像位。我方不显示头像，这一格就**不渲染** ——
                   留着空占位会让右侧凭空多出 34px 的空白，气泡贴不到边 -->
              <span v-if="item.side !== 'right'" class="pui-kt__avatar-slot">
                <Avatar
                  v-if="isGroupStart(item, index)"
                  :asset-id="item.avatarAssetId"
                  :name="item.authorName"
                  :size="34"
                />
              </span>

              <div
                class="pui-kt__bubble-wrap"
                :class="{
                  'pui-kt__bubble-wrap--media':
                    item.contentType === 'image' || item.contentType === 'sticker',
                }"
              >
                <!-- 昵称挂在**气泡上方**，与气泡左对齐，只在组首出现一次 ——
                     同一个人连发五条就写五遍名字，消息列表会被刷成通讯录。
                     行高锁到 34px（与头像同高），是为了让头像整块落在气泡上方，
                     而不是与气泡上部并排 -->
                <span
                  v-if="item.side !== 'right' && isGroupStart(item, index) && item.authorName"
                  class="pui-kt__author"
                  data-testid="kt-author-name"
                >
                  {{ item.authorName }}
                </span>
                <div class="pui-kt__bubble-line">
                  <div class="pui-kt__bubble" :data-type="item.contentType" data-testid="kt-bubble">
                    <template v-if="item.contentType === 'image'">
                      <!-- 资源丢了也留一句话，别给读者一个破图框 -->
                      <span v-if="!imageSrcs(item).length" class="pui-kt__image-hint">[图片]</span>
                      <div
                        v-else
                        class="pui-kt__images"
                        :data-count="imageSrcs(item).length"
                        :data-cols="albumCols(imageSrcs(item).length)"
                      >
                        <!-- 每张图各装进一个正方形圆角格子里：格子定形状，图只负责填满（cover 裁切）。
                             点开进全屏查看器：单图直接看大图，多图可左右翻（下方缩略图条） -->
                        <button
                          v-for="(src, i) in imageSrcs(item)"
                          :key="i"
                          type="button"
                          class="pui-kt__tile"
                          :data-testid="`kt-image-${i}`"
                          aria-label="查看图片"
                          @click="openViewer(item, i)"
                        >
                          <img class="pui-kt__image" :src="src" alt="" />
                        </button>
                      </div>
                    </template>

                    <!-- 贴图：一张透明背景的图。不套气泡、不裁圆角、也不压成方形 ——
                         表情的轮廓就是它的形状，垫白底或裁圆角都会做出一层"假相框" -->
                    <template v-else-if="item.contentType === 'sticker'">
                      <span v-if="!imageSrcs(item).length" class="pui-kt__image-hint">[贴图]</span>
                      <button
                        v-else
                        type="button"
                        class="pui-kt__sticker"
                        data-testid="kt-sticker"
                        aria-label="查看贴图"
                        @click="openViewer(item, 0)"
                      >
                        <img :src="imageSrcs(item)[0]" alt="" />
                      </button>
                    </template>

                    <!-- 语音：播放三角 + 波形 + 时长，纯外观 —— 作品是只读的，按下不放任何声音，
                         所以整条不是按钮（假按钮比不响应更糟） -->
                    <span
                      v-else-if="item.contentType === 'voice'"
                      class="pui-kt__voice"
                      :style="{ width: `${voiceWidth(item.durationSec)}px` }"
                      data-testid="kt-voice"
                    >
                      <span class="pui-kt__voice-play" aria-hidden="true">
                        <svg viewBox="0 0 24 24"><path d="M8.2 5.4l10 6.6-10 6.6z" fill="currentColor" /></svg>
                      </span>
                      <span class="pui-kt__voice-wave" aria-hidden="true">
                        <i v-for="(h, i) in waveOf(item)" :key="i" :style="{ height: `${h * 100}%` }" />
                      </span>
                      <span class="pui-kt__voice-time" data-testid="kt-voice-time">
                        {{ durationText(item.durationSec) }}
                      </span>
                    </span>

                    <!-- 通话：图标 + 「语音/视频通话」+ 尾部标注。
                         已接通 = 灰色时长（与语音同一套写法）；未接通 = 红字，
                         文案按气泡所在侧自动定（发起方=已取消、接听方=未接听）。
                         与语音一样是纯外观：作品只读，按下不会真的拨出 -->
                    <span
                      v-else-if="item.contentType === 'call'"
                      class="pui-kt__call"
                      :data-missed="callMissed(item) ? 'true' : 'false'"
                      data-testid="kt-call"
                    >
                      <svg
                        v-if="item.callKind === 'video'"
                        class="pui-kt__call-icon"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <rect x="3.2" y="6.8" width="12.2" height="10.4" rx="2.6" fill="none" stroke="currentColor" stroke-width="1.8" />
                        <path d="M15.6 10.9l5.2-3v8.2l-5.2-3z" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" />
                      </svg>
                      <svg v-else class="pui-kt__call-icon" viewBox="0 0 24 24" aria-hidden="true">
                        <!-- 听筒：Feather 的 phone 标准轮廓路径（描边款，和视频图标同一风格）。
                             最早那版是手搓贝塞尔，转角控制点没算好，渲染出来是一坨歪的
                             （用户截图反馈过）；描边风格是用户点名要保留的，别换成实心 -->
                        <path
                          d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="1.8"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        />
                      </svg>
                      <span class="pui-kt__call-label">{{ callLabel(item) }}</span>
                      <span class="pui-kt__call-note" data-testid="kt-call-note">{{ callFootnote(item) }}</span>
                    </span>

                    <template v-else>{{ item.content }}</template>
                  </div>

                  <button
                    v-if="item.contentType === 'voice' && item.transcript"
                    type="button"
                    class="pui-kt__transcribe"
                    :class="{ 'pui-kt__transcribe--on': transcriptOpen(item) }"
                    :aria-pressed="transcriptOpen(item) ? 'true' : 'false'"
                    aria-label="转文字"
                    data-testid="kt-voice-transcript-toggle"
                    @click="toggleTranscript(item)"
                  >
                    <svg
                      class="pui-kt__transcribe-ring"
                      viewBox="0 0 44 44"
                      fill="none"
                      aria-hidden="true"
                    >
                      <path
                        d="M39.22 12.85A19.5 19.5 0 1 1 29.3 3.92"
                        stroke="currentColor"
                        stroke-width="1.7"
                        stroke-linecap="round"
                      />
                      <polygon points="32.45,5.2 27.72,5.43 29.22,1.73" fill="currentColor" />
                    </svg>
                    <span class="pui-kt__transcribe-text">转</span>
                  </button>
                </div>

                <div
                  v-if="item.contentType === 'voice' && item.transcript && transcriptOpen(item)"
                  class="pui-kt__bubble pui-kt__bubble--transcript"
                  data-testid="kt-voice-transcript"
                >
                  {{ item.transcript }}
                </div>
              </div>

              <!-- 时间只在组的末尾出现一次 -->
              <span v-if="isGroupEnd(item, index)" class="pui-kt__time">{{ item.timeLabel }}</span>
            </div>
          </template>

          <EmptyState
            v-if="!thread.length"
            icon="chat"
            title="这个会话还没有消息"
          />
        </ScrollArea>

        <!-- 底部输入条：输入框可以真的打字（内容只活在本组件里，不发送、不进作品数据）；
             ＋ / 表情 / 语音没有对应面板，点一下给按压反馈 -->
        <div class="pui-kt__composer">
          <button
            type="button"
            class="pui-kt__composer-plus"
            :class="{ 'pui-kt__composer-plus--ping': pinged === 'composerPlus' }"
            data-testid="kt-composer-plus"
            aria-label="添加附件"
            @pointerdown="pingDown('composerPlus')"
            @pointerup="pingUp"
            @pointercancel="pingUp"
            @pointerleave="pingUp"
            @click="ping('composerPlus')"
          >
            <svg viewBox="0 0 24 24"><path d="M12 5.5v13M5.5 12h13" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
          </button>
          <input
            v-model="composerText"
            class="pui-kt__composer-field"
            type="text"
            placeholder="输入一条信息"
            autocomplete="off"
            data-testid="kt-composer-input"
          />
          <button
            type="button"
            class="pui-kt__composer-emoji"
            :class="{ 'pui-kt__composer-icon--ping': pinged === 'composerEmoji' }"
            data-testid="kt-composer-emoji"
            aria-label="表情"
            @pointerdown="pingDown('composerEmoji')"
            @pointerup="pingUp"
            @pointercancel="pingUp"
            @pointerleave="pingUp"
            @click="ping('composerEmoji')"
          >
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.7" /><circle cx="9.2" cy="10" r="1.2" fill="currentColor" /><circle cx="14.8" cy="10" r="1.2" fill="currentColor" /><path d="M8.5 14.2c.9 1.2 2.1 1.8 3.5 1.8s2.6-.6 3.5-1.8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" /></svg>
          </button>
          <button
            type="button"
            class="pui-kt__composer-voice"
            :class="{ 'pui-kt__composer-icon--ping': pinged === 'composerVoice' }"
            data-testid="kt-composer-voice"
            aria-label="语音"
            @pointerdown="pingDown('composerVoice')"
            @pointerup="pingUp"
            @pointercancel="pingUp"
            @pointerleave="pingUp"
            @click="ping('composerVoice')"
          >
            <svg viewBox="0 0 24 24"><path d="M4 10v4M8 7v10M12 4.5v15M16 7v10M20 10v4" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" /></svg>
          </button>
        </div>
      </section>
    </Transition>

    <!-- ══ 图片详情查看器：盖在会话屏上的黑底浮层 ══
         单图 = 直接看大图；多图 = 底部一排缩略图切换，并给出「第 N 张，共 M 张」。 -->
    <KakaoTalkMediaViewer :controller="viewerController" />
  </div>
</template>

<style src="./KakaoTalkApp.css"></style>
