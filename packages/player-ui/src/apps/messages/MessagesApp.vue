<!--
  信息（iMessage 版式）。

  与 KakaoTalk 共用**数据层**却不共用**界面层**，这是有意的：
  buildConversationList(work, appId) / buildThread(work, convId) 本来就接受应用 id，
  派生逻辑早在 select/chat.js 里共用了（见该文件头注释「KakaoTalk / 信息共用」）。
  但两端的版式差异远大于表面相似度：

    KakaoTalk          信息
    Friends/Chats 双 tab   单列表 + 搜索栏
    黄色气泡 / 灰蓝底      蓝灰气泡 / 白底
    每行都留头像槽         1:1 会话不留头像（多人会话才显示发送者）
    气泡旁逐条时间         只在间隔超过 10 分钟时插一条居中时间

  硬抽一个"聊天骨架"意味着这些差异全变成条件分支，两个应用都变难读，
  而收益只是省掉一段本就不同的模板。所以这里各写一份 —— 重复的是版式，
  不是逻辑；逻辑在 select 层只有一份。

  只读应用：搜索与输入条都能真操作，但只作用于当前视图 —— 作品是"已被读到的一段时间"，
  没有编辑 / 新建 / 发送的数据写入口，所以编辑、筛选、视频、加号只给点按反馈，不跳页。
-->
<script setup>
import MessagesMediaViewer from './MessagesMediaViewer.vue'
import { useMessageViewer } from '../shared/use-message-viewer.js'
import { computed, nextTick, ref, watch } from 'vue'
import { buildConversationList, buildThread, buildContacts, TIME_FORMAT } from '@phone-sim/shared'
import ScrollArea from '../../appkit/ScrollArea.vue'
import Avatar from '../../appkit/Avatar.vue'
import EmptyState from '../../appkit/EmptyState.vue'
import ContactDetailView from '../shared/ContactDetailView.vue'
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
 * 图集列数：2 / 4 张两列（4 张刚好排成正方形），其余三列 —— 9 张正好是 3×3 九宫格。
 * 与 KakaoTalk 保持同一套规则，换应用不该换出另一种排法。
 */
function albumCols(n) {
  if (n <= 1) return 1
  return n === 2 || n === 4 ? 2 : 3
}

/** 超过这个间隔就补一条居中时间，对齐真机：连续对答不逐条打时间戳 */
const TIME_GAP_MS = 10 * 60 * 1000

const work = computed(() => getWork())
const settings = computed(() => work.value?.workSettings ?? {})
const timeFormat = computed(() => settings.value.timeFormat ?? TIME_FORMAT.H24)
const storyDate = computed(() => settings.value.storyDate ?? null)
const ownerCharacterId = computed(() => settings.value.ownerCharacterId ?? null)

const screen = computed(() => runtime.currentScreen.value)
const isDetail = computed(() => screen.value?.name === 'chat')

const conversations = computed(() => {
  if (!work.value) return []
  return buildConversationList(work.value, 'messages', {
    timeFormat: timeFormat.value,
    storyDate: storyDate.value,
    ownerCharacterId: ownerCharacterId.value,
  })
})

const { pinged, pingDown, pingUp, ping } = useTapFeedback()

/* ── 列表搜索：真的会过滤 ──
 * 匹配会话标题、预览、自定义参与者名，以及该会话里每条消息的正文。
 * 只搜列表上看得见的字是不够的：聊天里说过的话搜不到，用户只会认为搜索坏了。
 * 不做模糊/拼音猜测 —— 命中就留下，没命中如实给空态。 */
const searchQuery = ref('')
const searchInput = ref(null)
const searchKeyword = computed(() => searchQuery.value.trim().toLowerCase())

function conversationMatches(conv, q) {
  const head = [conv.title, conv.preview, ...(conv.customParticipants ?? [])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  if (head.includes(q)) return true
  if (!work.value) return false
  // 正文不在列表视图模型里，按需现算；会话数量小，且 computed 会缓存结果
  return buildThread(work.value, conv.id, {
    ownerCharacterId: ownerCharacterId.value,
    storyDate: storyDate.value,
  }).some((item) => String(item.content ?? '').toLowerCase().includes(q))
}

const visibleConversations = computed(() => {
  const q = searchKeyword.value
  return q ? conversations.value.filter((conv) => conversationMatches(conv, q)) : conversations.value
})

function clearSearch() {
  searchQuery.value = ''
  nextTick(() => searchInput.value?.focus())
}

/** 输入条：能打字，但作品是只读的"已被读到的一段时间"，不写回数据、不发送 */
const draft = ref('')

const thread = computed(() => {
  if (!isDetail.value || !work.value) return []
  return buildThread(work.value, screen.value.params, {
    ownerCharacterId: ownerCharacterId.value,
    storyDate: storyDate.value,
  })
})

const activeConv = computed(() => conversations.value.find((c) => c.id === screen.value?.params) ?? null)

/* ── 联系人页（点聊天页头像/昵称打开） ──
 * 版式与电话的联系人详情是同一个组件（apps/shared/ContactDetailView.vue），
 * 但它长在信息应用的导航栈里，不是"跳去电话 app"。
 * 「信息」钮回到聊天（上一层就是会话）；「呼叫」跳电话应用直接拨出。 */
const contacts = computed(() => (work.value ? buildContacts(work.value) : []))
const isContactScreen = computed(() => screen.value?.name === 'contact')
const activeMsgContact = computed(
  () => (isContactScreen.value ? contacts.value.find((c) => c.id === screen.value?.params) ?? null : null),
)

/** 当前会话对应的联系人：1:1 会话且对方在通讯录里才有点开的意义（群聊没有"这一个人"） */
const chatContact = computed(() => {
  if (!isDetail.value) return null
  const conv = conversations.value.find((c) => c.id === screen.value?.params)
  if (!conv || conv.participantIds.length !== 2) return null
  return contacts.value.find((c) => c.characterId && conv.participantIds.includes(c.characterId)) ?? null
})

function openContactFromChat() {
  if (chatContact.value) runtime.push('contact', chatContact.value.id)
}

/**
 * 顶栏身份区版式分流：会话「对方」是自定义发信人（手填名字 / 号码，不是人物）时，
 * 没有头像资产、也查不到通讯录联系人，头像 + 胶囊 + 箭头就成了一个点了没反应的假入口。
 * 这类会话按真机对非联系人的处理，只留一行居中的加粗名字。
 * 混合会话（有人物 + 自定义发信人）仍按有人物处理，保留头像胶囊。
 */
const isCustomPeer = computed(() => {
  const conv = activeConv.value
  if (!conv || !work.value) return false
  const hasCharacterPeer = (conv.participantIds ?? []).some(
    (id) => id !== ownerCharacterId.value && work.value.characters.some((c) => c.id === id),
  )
  return !hasCharacterPeer && (conv.customParticipants?.length ?? 0) > 0
})

/** 联系人页「返回 / 信息」：上一层就是聊天页 */
function msgContactBack() {
  runtime.pop()
}

function msgContactCall() {
  const c = activeMsgContact.value
  if (!c?.phoneNumber) return
  runtime.borrowApp('phone', 'call', { number: c.phoneNumber, name: c.name })
}

const activeTitle = computed(() => activeConv.value?.title ?? '信息')

/** 多人会话才显示发送者头像与名字；单人会话里"是谁说的"由左右位置表达就够了。
 * 自定义参与者（营销广告、快递通知）也算人头 —— 会话里除了所属人有两个发信方就该显示名字。 */
const isGroup = computed(() => {
  const conv = activeConv.value
  if (!conv) return false
  return (conv.participantIds?.length ?? 0) + (conv.customParticipants?.length ?? 0) > 2
})

/** 详情页顶栏的小头像：会话没有专属头像时退回第一位参与者 */
const peerAvatarId = computed(() => activeConv.value?.avatarAssetId ?? null)

/** 贴底是聊天应用的基本预期 */
const scroller = ref(null)

async function scrollToBottom() {
  await nextTick()
  scroller.value?.scrollToBottom()
}

watch(isDetail, (open) => {
  if (open) {
    // 搜索是一次性查找：进会话就收起结果，返回列表看到完整会话列表；
    // 输入草稿同理，不带到另一个会话去。
    searchQuery.value = ''
    draft.value = ''
    void scrollToBottom()
  }
})

// 只在自己发的新消息让条数变化时贴底。单纯改文案不能把用户正在看的位置顶走

watch(
  () => thread.value.length,
  () => {
    if (isDetail.value) void scrollToBottom()
  },
)

/**
 * 上一条消息。中间可能夹着日期分隔，所以要往前跳过非消息项。
 * 返回 null 表示这是当天的第一条。
 */
function prevMessage(index) {
  for (let i = index - 1; i >= 0; i -= 1) {
    if (thread.value[i].kind === 'message') return thread.value[i]
  }
  return null
}

/**
 * 是否在当前位置插一条居中时间。
 *
 * 跨天不插：那天的日期分隔刚刚显示过，紧接着再打一个时刻是重复信息。
 */
function showTimeGap(index) {
  const item = thread.value[index]
  if (!item || item.kind !== 'message') return false
  const prev = prevMessage(index)
  if (!prev) return false
  const a = new Date(prev.displayTime).getTime()
  const b = new Date(item.displayTime).getTime()
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false
  const sameDay =
    new Date(a).toDateString() === new Date(b).toDateString()
  if (!sameDay) return false
  return b - a >= TIME_GAP_MS
}

/** 连续同一个人发言时只留一个头像，避免整列重复的同一张脸 */
function avatarFor(item, index) {
  const prev = thread.value[index - 1]
  if (!prev || prev.kind !== 'message') return true
  return prev.authorName !== item.authorName
}

const lastRightId = computed(() => {
  for (let i = thread.value.length - 1; i >= 0; i -= 1) {
    const item = thread.value[i]
    if (item.kind === 'message' && item.side === 'right') return item.id
  }
  return null
})

function openChat(conv) {
  runtime.push('chat', conv.id)
}

function goBack() {
  runtime.pop()
}

/**
 * 回桌面：点顶部大标题「信息」。
 *
 * 真机没有"退出应用"的界面元素，而作品端没有 home 指示条手势，
 * 根屏会变成死胡同。借用标题是最不打扰版式的位置 —— 它就在左上角，
 * 天然像"回到上一层"。（KakaoTalk / X / 电话 / 照片同一条约定）
 */
function goHome() {
  runtime.goHome()
}

const viewerController = useMessageViewer({ thread, imageSrcs, runtime, timeFormat, tone: 'dark' })
const { openViewer } = viewerController

</script>

<template>
  <div class="pui-msg" data-testid="messages-app">
    <Transition :name="`pui-screen-${runtime.state.transition === 'pop' ? 'pop' : 'push'}`">
      <!-- ══ 联系人页：与电话的联系人详情同一组件，长在信息的导航栈里 ══ -->
      <section
        v-if="isContactScreen"
        key="contact"
        class="pui-msg__screen"
        data-testid="msg-contact-screen"
      >
        <ContactDetailView
          v-if="activeMsgContact"
          :contact="activeMsgContact"
          scroll-key="messages:contact"
          :real-call="Boolean(activeMsgContact.phoneNumber)"
          real-message
          @back="msgContactBack"
          @message="msgContactBack"
          @call="msgContactCall"
        />

        <EmptyState
          v-else
          title="联系人不存在"
          description="它可能已经被删除，返回聊天看看。"
        />
      </section>

      <!-- ══ 列表 ══ -->
      <section v-else-if="!isDetail" key="list" class="pui-msg__screen" data-testid="msg-list-screen">
        <header class="pui-msg__masthead">
          <!-- 左：编辑（真机是 Edit 文字，作品里只读，用铅笔图标占位） -->
          <button
            type="button"
            class="pui-msg__tool"
            :class="{ 'pui-msg__tool--ping': pinged === 'edit' }"
            data-testid="msg-list-edit"
            aria-label="编辑"
            @pointerdown="pingDown('edit')"
            @pointerup="pingUp"
            @pointercancel="pingUp"
            @pointerleave="pingUp"
            @click="ping('edit')"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M15.6 4.4l4 4L9.4 18.6l-4.6 1 1-4.6z"
                fill="none"
                stroke="currentColor"
                stroke-width="1.7"
                stroke-linejoin="round"
              />
              <path d="M13.4 6.6l4 4" fill="none" stroke="currentColor" stroke-width="1.7" />
            </svg>
          </button>

          <!--
            标题居中，同时是"回桌面"入口。
            大标题降级成小标题后顶部就没别的地方可点了，标题本身成了唯一合理的出口。
          -->
          <button
            type="button"
            class="pui-msg__mast-title"
            data-testid="msg-list-title"
            aria-label="信息，回到桌面"
            @click="goHome"
          >
            信息
          </button>

          <button
            type="button"
            class="pui-msg__tool"
            :class="{ 'pui-msg__tool--ping': pinged === 'filter' }"
            data-testid="msg-list-filter"
            aria-label="筛选"
            @pointerdown="pingDown('filter')"
            @pointerup="pingUp"
            @pointercancel="pingUp"
            @pointerleave="pingUp"
            @click="ping('filter')"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M4 7h16M4 12h16M4 17h11"
                fill="none"
                stroke="currentColor"
                stroke-width="1.9"
                stroke-linecap="round"
              />
            </svg>
          </button>
        </header>

        <div class="pui-msg__search">
          <svg viewBox="0 0 24 24" class="pui-msg__search-glyph" aria-hidden="true">
            <circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="1.9" />
            <path d="M15.5 15.5L20.5 20.5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" />
          </svg>
          <input
            ref="searchInput"
            v-model="searchQuery"
            class="pui-msg__search-input"
            data-testid="msg-search-input"
            type="search"
            placeholder="搜索"
            aria-label="搜索会话与消息"
            autocomplete="off"
          />
          <!-- 用 v-show 不用 v-if：mouseup 时按钮若已被移除，紧接的 click 会丢失 -->
          <button
            v-show="searchQuery"
            type="button"
            class="pui-msg__search-clear"
            data-testid="msg-search-clear"
            aria-label="清空搜索"
            @click="clearSearch"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="9" fill="currentColor" />
              <path
                d="M8.8 8.8l6.4 6.4M15.2 8.8l-6.4 6.4"
                fill="none"
                stroke="#fff"
                stroke-width="1.9"
                stroke-linecap="round"
              />
            </svg>
          </button>
          <svg viewBox="0 0 24 24" class="pui-msg__search-mic" aria-hidden="true">
            <rect x="9.4" y="3.2" width="5.2" height="9.6" rx="2.6" fill="none" stroke="currentColor" stroke-width="1.7" />
            <path
              d="M6.2 11a5.8 5.8 0 0011.6 0"
              fill="none"
              stroke="currentColor"
              stroke-width="1.7"
              stroke-linecap="round"
            />
            <path d="M12 16.8v3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
          </svg>
        </div>

        <ScrollArea scroll-key="messages:list" padding-bottom="12">
          <ul v-if="visibleConversations.length" class="pui-msg__list">
            <li v-for="conv in visibleConversations" :key="conv.id">
              <button
                type="button"
                class="pui-msg__cell"
                data-testid="msg-conversation-item"
                @click="openChat(conv)"
              >
                <Avatar :asset-id="conv.avatarAssetId" :name="conv.title" :size="48" />
                <span class="pui-msg__cell-main">
                  <span class="pui-msg__cell-name">{{ conv.title }}</span>
                  <span class="pui-msg__cell-preview">{{ conv.preview }}</span>
                </span>
                <span class="pui-msg__cell-meta">
                  <span class="pui-msg__cell-time">{{ conv.timeLabel }}</span>
                  <svg viewBox="0 0 24 24" class="pui-msg__chevron" aria-hidden="true">
                    <path
                      d="M9 5.5L15.5 12L9 18.5"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
                </span>
              </button>
            </li>
          </ul>

          <EmptyState
            v-else-if="searchKeyword"
            icon="search"
            title="没有找到相关会话"
            :description="`没有匹配「${searchQuery.trim()}」的会话或消息，换个词试试。`"
          />

          <EmptyState
            v-else
            icon="chat"
            title="还没有信息"
          />
        </ScrollArea>
      </section>

      <!-- ══ 详情 ══ -->
      <section
        v-else
        :key="`msg:${screen?.params}`"
        class="pui-msg__screen pui-msg__screen--thread"
        data-testid="msg-thread-screen"
      >
        <!--
          顶栏是**悬浮**的：绝对定位在消息区之上，配半透明白 + 模糊。
          消息向上滚时会从它背后虚化穿过（真机的导航栏就是这个行为），
          代价是滚动区要自己留出顶部空白，见下面的 thread-spacer。
        -->
        <header class="pui-msg__chatbar">
          <button type="button" class="pui-msg__back" data-testid="nav-back" aria-label="返回" @click="goBack">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M14.5 6L9 12l5.5 6"
                fill="none"
                stroke="currentColor"
                stroke-width="2.2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>

          <component
            :is="chatContact ? 'button' : 'div'"
            v-if="!isCustomPeer"
            class="pui-msg__peer"
            :type="chatContact ? 'button' : undefined"
            :data-testid="chatContact ? 'msg-peer' : undefined"
            :aria-hidden="chatContact ? undefined : 'true'"
            :aria-label="chatContact ? '查看联系人' : undefined"
            @click="chatContact && openContactFromChat()"
          >
            <Avatar :asset-id="peerAvatarId" :name="activeTitle" :size="46" />
            <span class="pui-msg__peer-pill">
              <span class="pui-msg__peer-name">{{ activeTitle }}</span>
              <svg viewBox="0 0 24 24" class="pui-msg__peer-chevron">
                <path
                  d="M9.5 6L15 12l-5.5 6"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.4"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </span>
          </component>
          <span v-else class="pui-msg__peer-title" data-testid="msg-peer-title">{{ activeTitle }}</span>

          <button
            type="button"
            class="pui-msg__call"
            :class="{ 'pui-msg__call--ping': pinged === 'video' }"
            data-testid="msg-chat-video"
            aria-label="视频通话"
            @pointerdown="pingDown('video')"
            @pointerup="pingUp"
            @pointercancel="pingUp"
            @pointerleave="pingUp"
            @click="ping('video')"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="2.6" y="6.4" width="13" height="11.2" rx="3.4" fill="none" stroke="currentColor" stroke-width="1.8" />
              <path
                d="M15.6 12.6l4.4 2.6c.5.3 1.1-.05 1.1-.6V9.4c0-.55-.6-.9-1.1-.6l-4.4 2.6z"
                fill="currentColor"
              />
            </svg>
          </button>
        </header>

        <ScrollArea ref="scroller" padding-bottom="14" data-testid="msg-thread-scroll">
          <!-- 给悬浮顶栏让位：这块空白随内容一起滚走，滚过之后消息才穿到顶栏背后 -->
          <div class="pui-msg__thread-spacer" aria-hidden="true"></div>
          <template v-for="(item, index) in thread" :key="item.id">
            <p v-if="item.kind === 'divider'" class="pui-msg__divider">
              <span>{{ item.label }}</span>
            </p>

            <!-- 系统消息：居中一行灰字。iMessage 的群提示是纯文字、没有胶囊底，
                 和信息应用整体的白底风格也更搭（KakaoTalk 那边才是灰胶囊） -->
            <p
              v-else-if="item.kind === 'system'"
              class="pui-msg__system"
              data-testid="msg-system"
            >
              {{ item.content }}
            </p>

            <template v-else>
              <p v-if="showTimeGap(index)" class="pui-msg__timegap">{{ item.timeLabel }}</p>

              <div class="pui-msg__row" :data-side="item.side">
                <span v-if="isGroup && item.side !== 'right'" class="pui-msg__avatar-slot">
                  <Avatar
                    v-if="avatarFor(item, index)"
                    :asset-id="item.avatarAssetId"
                    :name="item.authorName"
                    :size="28"
                  />
                </span>

                <div class="pui-msg__bubble-wrap">
                  <span v-if="isGroup && item.side !== 'right'" class="pui-msg__author">
                    {{ item.authorName }}
                  </span>
                  <div
                    class="pui-msg__bubble"
                    :data-type="item.contentType"
                    data-testid="msg-bubble"
                  >
                    <template v-if="item.contentType === 'image'">
                      <!-- 资源丢了也留一句话，别给读者一个破图框 -->
                      <span v-if="!imageSrcs(item).length" class="pui-msg__image-hint">[图片]</span>
                      <div
                        v-else
                        class="pui-msg__images"
                        :data-count="imageSrcs(item).length"
                        :data-cols="albumCols(imageSrcs(item).length)"
                      >
                        <!-- 每张图各装进一个正方形圆角格子里：格子定形状，图只负责填满（cover 裁切）。
                             点开进全屏查看器：单图直接看大图，多图可左右翻（下方缩略图条） -->
                        <button
                          v-for="(src, i) in imageSrcs(item)"
                          :key="i"
                          type="button"
                          class="pui-msg__tile"
                          :data-testid="`msg-image-${i}`"
                          aria-label="查看图片"
                          @click="openViewer(item, i)"
                        >
                          <img class="pui-msg__image" :src="src" alt="" />
                        </button>
                      </div>
                    </template>
                    <template v-else>{{ item.content }}</template>
                  </div>
                </div>
              </div>

              <!-- 已读回执：只挂在我方最后一条下面，用的是已读时刻 -->
              <p
                v-if="item.id === lastRightId && item.readLabel"
                class="pui-msg__read"
                data-testid="msg-read"
              >
                {{ item.readLabel }}
              </p>
            </template>
          </template>

          <EmptyState
            v-if="!thread.length"
            icon="chat"
            title="这条信息还没有内容"
          />
        </ScrollArea>

        <div class="pui-msg__composer">
          <button
            type="button"
            class="pui-msg__composer-plus"
            :class="{ 'pui-msg__composer-plus--ping': pinged === 'plus' }"
            data-testid="msg-composer-plus"
            aria-label="添加内容"
            @pointerdown="pingDown('plus')"
            @pointerup="pingUp"
            @pointercancel="pingUp"
            @pointerleave="pingUp"
            @click="ping('plus')"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 5.5v13M5.5 12h13" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
            </svg>
          </button>

          <!-- 真机是一个填色胶囊，麦克风长在胶囊内部右端，不是独立按钮 -->
          <span class="pui-msg__composer-field">
            <input
              v-model="draft"
              class="pui-msg__composer-input"
              data-testid="msg-composer-input"
              type="text"
              placeholder="信息"
              aria-label="信息输入框"
              autocomplete="off"
              @keydown.enter.prevent
            />
            <svg viewBox="0 0 24 24" class="pui-msg__composer-mic" aria-hidden="true">
              <rect x="9.4" y="3.6" width="5.2" height="9.6" rx="2.6" fill="none" stroke="currentColor" stroke-width="1.7" />
              <path
                d="M6.2 11.4a5.8 5.8 0 0011.6 0"
                fill="none"
                stroke="currentColor"
                stroke-width="1.7"
                stroke-linecap="round"
              />
              <path d="M12 17.2v3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
            </svg>
          </span>
        </div>
      </section>
    </Transition>

    <!-- ══ 图片详情查看器：盖在会话屏上的白底浮层（iOS 照片 / 信息风格） ══
         单图 = 直接看大图；多图 = 底部一排缩略图切换 + 「第 N 张，共 M 张」。
         与 KakaoTalk 同一套交互，只是配色反过来：白底深字而非黑底白字。 -->
    <MessagesMediaViewer :controller="viewerController" />
  </div>
</template>

<style src="./MessagesApp.css"></style>
