

<script setup>
import { useInstagramComments } from './use-instagram-comments.js'
import { useInstagramFollows } from './use-instagram-follows.js'
import { computed, reactive, ref } from 'vue'
import {
  buildFeed,
  buildPostDetail,
  buildProfile,
  buildStoryTray,
  TIME_FORMAT,
} from '@phone-sim/shared'
import ScrollArea from '../../appkit/ScrollArea.vue'
import Avatar from '../../appkit/Avatar.vue'
import EmptyState from '../../appkit/EmptyState.vue'
import ProfileView from './ProfileView.vue'
import CarouselMedia from './CarouselMedia.vue'
import HashtagText from '../x/XPostText.vue'
import InstagramSearch from './InstagramSearch.vue'
import { vFeedback } from '../x/feedback.js'
import { usePhoneRuntime, useWorkData } from '../../kernel/create-runtime.js'

const runtime = usePhoneRuntime()
const { getWork, resolveAsset } = useWorkData()

/** 模板里多处要 <img src>，包一层保持调用点可读 */
function resolveSrc(assetId) {
  return assetId ? resolveAsset(assetId) ?? '' : ''
}

const work = computed(() => getWork())
const settings = computed(() => work.value?.workSettings ?? {})
const timeFormat = computed(() => settings.value.timeFormat ?? TIME_FORMAT.H24)
const storyDate = computed(() => settings.value.storyDate ?? null)
const ownerCharacterId = computed(() => settings.value.ownerCharacterId ?? null)

/* ── 底部 tab：home / reels / profile（自己）─── 常驻、直接切、无推拉 ── */
const activeTab = ref('home')
function setTab(tab) {
  activeTab.value = tab
}

/* 运行时栈里只剩三类「屏」：帖子详情、主页（自己或他人，带返回键的一屏）、关注关系列表 */
const isSearch = computed(() => runtime.currentScreen.value?.name === 'search')
const sessionSearchHistory = ref([])
const searchHistory = computed(() => [...sessionSearchHistory.value, ...(work.value?.appData?.instagram?.searchHistory ?? [])].filter((row, index, rows) => rows.findIndex(other => other.type === row.type && (row.type === 'account' ? other.accountId === row.accountId : other.title === row.title)) === index))
function rememberSearch(title) { sessionSearchHistory.value = [{ id: 'recent:' + title, type: 'keyword', title }, ...sessionSearchHistory.value.filter(row => row.title !== title)] }
function searchHashtag(query) { runtime.push('search', { query }) }
const isPost = computed(() => runtime.currentScreen.value?.name === 'post')
const isProfileScreen = computed(() => runtime.currentScreen.value?.name === 'profile')
const isFollowScreen = computed(() => runtime.currentScreen.value?.name === 'follow')
/** 任一栈屏打开时，底栏与 tab 内容都让位给浮层 */
const hasOverlay = computed(() => isPost.value || isProfileScreen.value || isFollowScreen.value || isSearch.value)

const activePostId = computed(() =>
  isPost.value ? runtime.currentScreen.value?.params ?? null : null,
)
const profileTargetId = computed(() =>
  isProfileScreen.value ? runtime.currentScreen.value?.params ?? null : null,
)

function openPost(postId) {
  if (postId) runtime.push('post', postId)
}
function openProfile(characterId) {
  if (characterId) runtime.push('profile', characterId)
}
function goBack() {
  runtime.pop()
}
/** 回桌面：点顶栏字标。与 X 同一条规则（居中且无其它语义的位置当出口） */
function goHome() {
  runtime.goHome()
}

/* ── 首页 feed ────────────────────────────────────── */
const feed = computed(() => {
  if (!work.value) return []
  return buildFeed(work.value, 'instagram', {
    timeFormat: timeFormat.value,
    storyDate: storyDate.value,
  })
})

/**
 * 多图轮播的当前页码：按帖子 id 存在本地 Map。
 * 不放进屏参数 —— 从详情页返回后轮播应停在原页，而栈参数做不到"回来还在"。
 */
const carouselIndex = reactive(new Map())
function pageOf(post) {
  return carouselIndex.get(post.id) ?? 0
}
function setPage(post, i) {
  carouselIndex.set(post.id, i)
}

/* ── Story 托盘与查看器 ───────────────────────────── */
/** 本场播放中已点开的帧 id。只存在于内存，不写回作品数据（作品是只读的） */
const watchedFrames = reactive(new Set())

const storyTray = computed(() => {
  if (!work.value) return []
  return buildStoryTray(work.value, {
    timeFormat: timeFormat.value,
    storyDate: storyDate.value,
    seenFrameIds: [...watchedFrames],
    ownerCharacterId: ownerCharacterId.value,
  })
})

/** 正在播放的组与帧下标；null = 查看器关闭 */
const playing = ref(null)
const playIndex = ref(0)

/**
 * 托盘首格永远是「你的快拍」（自己的头像 + 黑色加号，无彩色环，真机如此）。
 * 带环的组只放别人：自己的故事若存在，从这个加号格进，不在环列表里重复出现。
 */
const ringTray = computed(() => storyTray.value.filter((g) => !g.isOwner))
const ownStoryGroup = computed(() => storyTray.value.find((g) => g.isOwner) ?? null)
function openOwnStory() {
  if (ownStoryGroup.value) openStory(ownStoryGroup.value)
}

const playingGroup = computed(() =>
  playing.value ? storyTray.value.find((g) => g.key === playing.value) ?? null : null,
)
const playingFrame = computed(() => playingGroup.value?.frames[playIndex.value] ?? null)

function openStory(group) {
  playing.value = group.key
  playIndex.value = group.startIndex
  watchedFrames.add(group.frames[group.startIndex].id)
}

function closeStory() {
  storyDrag.active = false
  storyDrag.dx = 0
  playing.value = null
}

/** 点右半屏下一帧、左半屏上一帧；组播完自动关（真机播完下一个人，这里组就是终点） */
function nextFrame() {
  const group = playingGroup.value
  if (!group) return
  if (playIndex.value + 1 >= group.frames.length) {
    playing.value = null
    return
  }
  playIndex.value += 1
  watchedFrames.add(group.frames[playIndex.value].id)
}

function prevFrame() {
  if (playIndex.value > 0) playIndex.value -= 1
}

const storyDrag = reactive({ active: false, startX: 0, dx: 0, moved: false, guardUntil: 0 })

function onStageDown(e) {
  storyDrag.active = true
  storyDrag.startX = e.clientX
  storyDrag.dx = 0
  storyDrag.moved = false
  try {
    e.currentTarget.setPointerCapture?.(e.pointerId)
  } catch {
    /* 合成事件可能没有真实 pointer，捕获会抛，忽略即可 */
  }
}

function onStageMove(e) {
  if (!storyDrag.active) return
  const dx = e.clientX - storyDrag.startX
  if (Math.abs(dx) > 4) storyDrag.moved = true
  storyDrag.dx = dx
}

function onStageUp(e) {
  if (!storyDrag.active) return
  storyDrag.active = false
  const w = e.currentTarget.offsetWidth || 1
  const threshold = Math.min(60, w * 0.2)
  if (storyDrag.dx <= -threshold) {
    if (storyDrag.moved) storyDrag.guardUntil = Date.now() + 250
    nextFrame() // 左滑 → 下一帧（末帧再滑 = 组播完自动关，与轻点同语义）
  } else if (storyDrag.dx >= threshold) {
    if (storyDrag.moved) storyDrag.guardUntil = Date.now() + 250
    prevFrame() // 右滑 → 上一帧
  }
  storyDrag.dx = 0
}

/** 半屏点击区的 click：拖拽刚翻过帧的短窗口内必须哑火 */
function tapPrev() {
  if (Date.now() < storyDrag.guardUntil) return
  prevFrame()
}

function tapNext() {
  if (Date.now() < storyDrag.guardUntil) return
  nextFrame()
}

/* ── 帖子详情：作者时间线 ──────────────────────────── */

const detail = computed(() => {
  if (!isPost.value || !work.value || !activePostId.value) return null
  return buildPostDetail(work.value, 'instagram', activePostId.value, {
    timeFormat: timeFormat.value,
    storyDate: storyDate.value,
  })
})
/** 作者时间线（锚点帖子的作者）。detail 为 null 时退空数组，模板安全 */
const timeline = computed(() => {
  if (!detail.value || !work.value) return []
  return buildProfile(work.value, {
    characterId: detail.value.authorCharacterId,
    ownerCharacterId: ownerCharacterId.value,
    timeFormat: timeFormat.value,
    storyDate: storyDate.value,
  })?.posts ?? []
})

/* ── 个人主页：自己（tab）/ 他人（栈）共用 ProfileView ── */
/* 快拍行也要已读语义（未看彩环/全看灰环），所以两个 buildProfile 都带 seenFrameIds */
const ownProfile = computed(() => {
  if (!work.value || !ownerCharacterId.value) return null
  return buildProfile(work.value, {
    characterId: ownerCharacterId.value,
    ownerCharacterId: ownerCharacterId.value,
    timeFormat: timeFormat.value,
    storyDate: storyDate.value,
    seenFrameIds: [...watchedFrames],
  })
})
const profileTarget = computed(() => {
  if (!isProfileScreen.value || !work.value) return null
  return buildProfile(work.value, {
    characterId: profileTargetId.value,
    ownerCharacterId: ownerCharacterId.value,
    timeFormat: timeFormat.value,
    storyDate: storyDate.value,
    seenFrameIds: [...watchedFrames],
  })
})

/** 主页快拍环 → 打开同一个 Story 查看器（托盘里能找到这组，因为分组规则同源） */
function openProfileStory(groupKey) {
  const group = storyTray.value.find((g) => g.key === groupKey)
  if (group) openStory(group)
}

/* ── 关注关系列表页（粉丝 / 正在关注）────────────────
   主页统计里的"粉丝 / 关注"点进来。列表是真实关系（buildFollowGraph），
   统计数字仍是作者手填的展示值 —— 两件事，互不推导。 */
const { openFollowScreen, followScreenTab, followSearch, followScreenRows, followScreenHandle, followScreenEmpty } = useInstagramFollows({ runtime, work, isFollowScreen, isProfileScreen, profileTargetId, ownerCharacterId })

const likedPosts = reactive(new Set())
function toggleLike(postId) {
  if (likedPosts.has(postId)) likedPosts.delete(postId)
  else likedPosts.add(postId)
}
function igCount(value) {
  const n = Number(value) || 0
  return n >= 10000 ? `${(n / 10000).toFixed(1).replace(/\.0$/, '')}万` : n.toLocaleString('en-US')
}
function likeLabel(post) {
  const n = (Number(post.rawMetrics.likes) || 0) + (likedPosts.has(post.id) ? 1 : 0)
  return igCount(n)
}

/**
 * 详情页头行头像 → 进作者主页。
 * 若当前栈里上一屏已经是该作者的主页（从主页九宫格点进来的场景），
 * 直接 pop 回去而不是再压一层同名页面（避免重复主页堆积）。
 */
function openAuthorProfile(post) {
  const stack = runtime.state.stack
  const prev = stack[stack.length - 2]
  if (prev && prev.name === 'profile' && prev.params === post.authorCharacterId) {
    runtime.pop()
    return
  }
  openProfile(post.authorCharacterId)
}

/** 评论入口文案：N > 0 显示「查看全部 N 条评论」，否则灰色「还没有评论」 */
function commentLinkLabel(post) {
  const n = Number(post.rawMetrics.replies) || 0
  return n > 0 ? `查看全部 ${n} 条评论` : '还没有评论'
}

/* ── 评论浮层：底部弹层 ── 从帖子卡/详情的评论按钮打开；
   评论复用 buildPostDetail 的派生（跨帖隔离规则同源），按 threadId 分组成「顶层 + 回复」 */
const { expandedThreads, commentsOpen, commentsDetail, commentThreads, openComments, closeComments, toggleThread } = useInstagramComments({ work, timeFormat, storyDate })

/* ── Reels ────────────────────────────────────────── */
/**
 * Reels 的"视频"在本轮是占位：作品数据层没有视频帧概念，
 * 用 9:16 渐变 SVG 当画面，右侧操作列与作者行的版式先立起来。
 */
const reelsOwner = computed(() => {
  if (!work.value || !ownerCharacterId.value) return null
  return work.value.characters?.find((c) => c.id === ownerCharacterId.value) ?? null
})
const reelsOwnerAccount = computed(() => {
  if (!work.value || !ownerCharacterId.value) return null
  return (
    work.value.platformAccounts?.find(
      (a) => a.characterId === ownerCharacterId.value && a.platform === 'instagram',
    ) ?? null
  )
})
</script>

<template>
  <div class="pui-ig" data-testid="ig-app">
    <InstagramSearch v-if="isSearch" :key="runtime.currentScreen.value?.params?.query" :initial-query="runtime.currentScreen.value?.params?.query || ''" :posts="feed" :history="searchHistory" :accounts="work?.platformAccounts?.filter(a => a.platform === 'instagram') ?? []" :resolve-src="resolveSrc" @submit="rememberSearch" @back="goBack" @open-post="openPost" @open-account="openProfile" />

    <!-- 帖子详情（栈屏）：被点帖子的作者时间线，可上下翻动看该作者全部帖子 -->
    <div v-if="isPost && detail" class="pui-ig__overlay" data-testid="ig-post-screen">
      <header class="pui-ig__subbar">
        <button type="button" class="pui-ig__back" data-testid="nav-back" aria-label="返回" @click="goBack">
          <svg viewBox="0 0 24 24"><path d="M14.5 5.5L8 12l6.5 6.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </button>
        <h1 class="pui-ig__subbar-title">帖子</h1>
        <span class="pui-ig__subbar-spacer" />
      </header>

      <ScrollArea :scroll-key="`ig:post:${activePostId}`" :anchor="`ig-post-${activePostId}`" padding-bottom="8" :fade="false">
        <ul class="pui-ig__feed">
          <li
            v-for="post in timeline"
            :key="post.id"
            class="pui-ig__card"
            :data-testid="`ig-post-${post.id}`"
          >
            <!-- 头行：头像（进作者主页）+ handle + 时间 -->
            <div class="pui-ig__card-head">
              <button
                type="button"
                class="pui-ig__card-avatar"
                :aria-label="`${post.authorName} 的主页`"
                @click="openAuthorProfile(post)"
              >
                <Avatar :asset-id="post.authorAvatarAssetId" :name="post.authorName" :size="32" />
              </button>
              <span class="pui-ig__card-handle">{{ post.authorHandle || post.authorName }}</span>
              <span class="pui-ig__card-time">{{ post.timeLabel }}</span>
            </div>

            <CarouselMedia
              v-if="post.mediaAssetIds.length"
              :media-asset-ids="post.mediaAssetIds"
              :resolve-src="resolveSrc"
              :page="pageOf(post)"
              testid="ig-detail-media"
              @change="(i) => setPage(post, i)"
            />

            <!-- 动作行：与首页卡同构（点赞本地态可点 / 评论开弹层 / 转发分享收藏装饰） -->
            <div class="pui-ig__actions">
              <button
                type="button"
                class="pui-ig__actbtn"
                :class="{ 'pui-ig__actbtn--on': likedPosts.has(post.id) }"
                data-testid="ig-detail-like"
                :aria-label="likedPosts.has(post.id) ? '取消赞' : '赞'"
                @click="toggleLike(post.id)"
              >
                <svg v-if="likedPosts.has(post.id)" viewBox="0 0 24 24" class="pui-ig__act"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" fill="#ff3040" /></svg>
                <svg v-else viewBox="0 0 24 24" class="pui-ig__act"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" /></svg>
                <span v-if="Number(post.rawMetrics.likes) > 0 || likedPosts.has(post.id)" class="pui-ig__actnum">{{ likeLabel(post) }}</span>
              </button>
              <button type="button" class="pui-ig__actbtn" data-testid="ig-detail-comment" aria-label="评论" @click="openComments(post.id)">
                <svg viewBox="0 0 24 24" class="pui-ig__act"><path d="M21 12a9 9 0 1 0-4.1 7.55L22 21l-1.45-5.1A8.9 8.9 0 0 0 21 12Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" /></svg>
                <span v-if="Number(post.rawMetrics.replies) > 0" class="pui-ig__actnum">{{ igCount(post.rawMetrics.replies) }}</span>
              </button>
              <span v-feedback="'帖子操作'" class="pui-ig__actbtn">
                <svg viewBox="0 0 24 24" class="pui-ig__act"><path d="m15 2 5 5-5 5M20 7H8a5 5 0 0 0-5 5m6 10-5-5 5-5M4 17h12a5 5 0 0 0 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
                <span v-if="Number(post.rawMetrics.reposts) > 0" class="pui-ig__actnum">{{ igCount(post.rawMetrics.reposts) }}</span>
              </span>
              <span v-feedback="'帖子操作'" class="pui-ig__actbtn">
                <svg viewBox="0 0 24 24" class="pui-ig__act"><path d="M21 3 3.5 9.6a.9.9 0 0 0 0 1.7l6.7 2.5 2.5 6.7a.9.9 0 0 0 1.7 0L21 3Zm-10.8 10.8L21 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" /></svg>
              </span>
              <span v-feedback="'收藏'" class="pui-ig__actbtn pui-ig__actbtn--save">
                <svg viewBox="0 0 24 24" class="pui-ig__act"><path d="M5 3h14v18l-7-5-7 5Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" /></svg>
              </span>
            </div>

            <p class="pui-ig__caption">
              <span class="pui-ig__caption-author">{{ post.authorHandle || post.authorName }}</span>
              <HashtagText v-if="post.content" :text="post.content" :accounts="work?.platformAccounts?.filter(a => a.platform === 'instagram' && a.characterId) ?? []" @search="searchHashtag" @open-account="openProfile" />
            </p>

            <!-- 评论不内联：与首页一致，只留「查看全部 N 条评论」入口，点开底部弹层 -->
            <button
              type="button"
              class="pui-ig__commentlink"
              data-testid="ig-detail-commentlink"
              @click="openComments(post.id)"
            >
              {{ commentLinkLabel(post) }}
            </button>
          </li>
        </ul>
      </ScrollArea>
    </div>

    <!-- 主页（栈屏）：自己或他人都压栈，带返回键 + 纯标题 -->
    <div v-if="isProfileScreen && profileTarget" class="pui-ig__overlay" data-testid="ig-profile-screen">
      <ProfileView
        :profile="profileTarget"
        :scroll-key="`ig:profile:${profileTargetId}`"
        show-back
        @open-post="openPost"
        @open-story="openProfileStory"
        @open-follow="openFollowScreen"
        @back="goBack"
      />
    </div>

    <!-- 关注关系列表（栈屏）：主页统计"粉丝/关注"点进来，真实关系 + 搜索过滤 -->
    <div v-if="isFollowScreen" class="pui-ig__overlay" data-testid="ig-follow-screen">
      <header class="pui-ig__subbar">
        <button type="button" class="pui-ig__back" data-testid="nav-back" aria-label="返回" @click="goBack">
          <svg viewBox="0 0 24 24"><path d="M14.5 5.5L8 12l6.5 6.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </button>
        <h1 class="pui-ig__subbar-title pui-ig__subbar-title--handle">{{ followScreenHandle }}</h1>
        <span class="pui-ig__subbar-spacer" />
      </header>

      <label class="pui-ig__followsearch">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.6" cy="10.6" r="6.4" fill="none" stroke="currentColor" stroke-width="1.8" /><path d="M15.4 15.4L20.4 20.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
        <input
          v-model="followSearch"
          type="text"
          placeholder="搜索"
          data-testid="ig-follow-search"
        />
        <button v-if="followSearch" type="button" class="pui-ig__followsearch-clear" aria-label="清空搜索" @click="followSearch = ''">
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="currentColor" /><path d="M9 9l6 6M15 9l-6 6" stroke="#fff" stroke-width="1.8" stroke-linecap="round" /></svg>
        </button>
      </label>

      <nav class="pui-ig__followtabs" aria-label="关注关系">
        <button
          type="button"
          class="pui-ig__followtab"
          :class="{ 'pui-ig__followtab--on': followScreenTab === 'followers' }"
          data-testid="ig-followtab-followers"
          @click="followScreenTab = 'followers'"
        >
          粉丝
        </button>
        <button
          type="button"
          class="pui-ig__followtab"
          :class="{ 'pui-ig__followtab--on': followScreenTab === 'following' }"
          data-testid="ig-followtab-following"
          @click="followScreenTab = 'following'"
        >
          正在关注
        </button>
      </nav>

      <ScrollArea scroll-key="ig:follow" padding-bottom="8" :fade="false">
        <ul v-if="followScreenRows.length" class="pui-ig__followlist">
          <li
            v-for="row in followScreenRows"
            :key="row.characterId"
            class="pui-ig__followrow"
            data-testid="ig-follow-row"
          >
            <button type="button" class="pui-ig__tray-ring" :aria-label="'查看' + row.name + '的主页'" @click="openProfile(row.characterId)">
              <Avatar :asset-id="row.avatarAssetId" :name="row.name" :size="44" />
            </button>
            <button type="button" class="pui-ig__followrow-id" @click="openProfile(row.characterId)">
              <span class="pui-ig__followrow-handle">{{ row.handle || row.name }}</span>
              <span class="pui-ig__followrow-name">{{ row.name }}</span>
            </button>
            <!-- 消息入口 -->
            <span class="pui-ig__followrow-msg" aria-hidden="true">发消息</span>
          </li>
        </ul>
        <p v-else-if="followSearch" class="pui-ig__follow-none">没有找到“{{ followSearch }}”相关的结果</p>
        <EmptyState
          v-else
          icon="chat"
          :title="followScreenEmpty.title"
          :description="followScreenEmpty.description"
        />
      </ScrollArea>
    </div>

    <!-- ══ 首页 tab ══ -->
    <section v-show="!hasOverlay && activeTab === 'home'" class="pui-ig__pane" data-testid="ig-home-screen">
      <header class="pui-ig__topbar">
        <span v-feedback="'新增'" class="pui-ig__topbar-icon">
          <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
        </span>

        <button
          type="button"
          class="pui-ig__wordmark"
          data-testid="ig-home-logo"
          aria-label="Instagram，回到桌面"
          @click="goHome"
        >
          Instagram
        </button>

        <span class="pui-ig__topbar-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M12 20.4c-4.9-3.4-8.4-6.3-8.4-10a4.6 4.6 0 018.4-2.6 4.6 4.6 0 018.4 2.6c0 3.7-3.5 6.6-8.4 10z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" /></svg>
        </span>
      </header>

      <!-- Stories 托盘：横滑行，但整体随 feed 一起竖滚（真机如此），与帖子之间无分隔线。
           ScrollArea 只能竖滚，横滑行用裸 div（同照片应用先例）。 -->
      <ScrollArea scroll-key="ig:home" padding-bottom="8" :fade="false">
        <div class="pui-ig__tray" data-testid="ig-story-tray">
          <button
            type="button"
            class="pui-ig__tray-item pui-ig__tray-item--own"
            data-testid="ig-story-own"
            aria-label="你的快拍"
            @click="openOwnStory"
          >
            <span class="pui-ig__tray-ownwrap">
              <Avatar
                :asset-id="reelsOwnerAccount?.avatarAssetId || reelsOwner?.avatarAssetId"
                :name="reelsOwnerAccount?.displayName || reelsOwner?.name || '我'"
                :size="62"
              />
              <i class="pui-ig__tray-plus" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M12 5.5v13M5.5 12h13" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" /></svg>
              </i>
            </span>
            <span class="pui-ig__tray-name">你的快拍</span>
          </button>

          <button
            v-for="group in ringTray"
            :key="group.key"
            type="button"
            class="pui-ig__tray-item"
            :class="{ 'pui-ig__tray-item--seen': group.unseenCount === 0 }"
            data-testid="ig-story-item"
            :aria-label="`查看 ${group.author.name} 的快拍`"
            @click="openStory(group)"
          >
            <span class="pui-ig__tray-ring">
              <Avatar :asset-id="group.author.avatarAssetId" :name="group.author.name" :size="62" />
            </span>
            <span class="pui-ig__tray-name">{{ group.author.name }}</span>
          </button>
        </div>

        <ul v-if="feed.length" class="pui-ig__feed">
          <li v-for="post in feed" :key="post.id" class="pui-ig__card" data-testid="ig-post-card">
            <!-- 头行：头像（进作者主页）+ handle + 更多 -->
            <div class="pui-ig__card-head">
              <button
                type="button"
                class="pui-ig__card-avatar"
                :aria-label="`${post.authorName} 的主页`"
                @click="openProfile(post.authorCharacterId)"
              >
                <Avatar :asset-id="post.authorAvatarAssetId" :name="post.authorName" :size="32" />
              </button>
              <span class="pui-ig__card-handle">{{ post.authorHandle || post.authorName }}</span>
              <span class="pui-ig__card-time">{{ post.timeLabel }}</span>
              <span class="pui-ig__card-more" aria-hidden="true">
                <svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.6" fill="currentColor" /><circle cx="12" cy="12" r="1.6" fill="currentColor" /><circle cx="19" cy="12" r="1.6" fill="currentColor" /></svg>
              </span>
            </div>

            <!-- 图片区：多图时支持左右滑动翻页 + 轻点翻页 + 页码圆点 + 右上角 1/2 角标 -->
            <CarouselMedia
              v-if="post.mediaAssetIds.length"
              :media-asset-ids="post.mediaAssetIds"
              :resolve-src="resolveSrc"
              :page="pageOf(post)"
              testid="ig-post-media"
              @change="(i) => setPage(post, i)"
            />

            <!-- 动作行：点赞（本地态，可点）/ 评论（开评论浮层）/ 转发 / 分享 / 收藏（最右）。
                 转发、分享、收藏没有对应的交互模型，按惯例摆出不可点；
                 分享在数据层没有计数字段，不编造数字。计数有值才显示。 -->
            <div class="pui-ig__actions">
              <button
                type="button"
                class="pui-ig__actbtn"
                :class="{ 'pui-ig__actbtn--on': likedPosts.has(post.id) }"
                data-testid="ig-card-like"
                :aria-label="likedPosts.has(post.id) ? '取消赞' : '赞'"
                @click="toggleLike(post.id)"
              >
                <svg v-if="likedPosts.has(post.id)" viewBox="0 0 24 24" class="pui-ig__act"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" fill="#ff3040" /></svg>
                <svg v-else viewBox="0 0 24 24" class="pui-ig__act"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" /></svg>
                <span v-if="Number(post.rawMetrics.likes) > 0 || likedPosts.has(post.id)" class="pui-ig__actnum">{{ likeLabel(post) }}</span>
              </button>
              <button type="button" class="pui-ig__actbtn" data-testid="ig-card-comment" aria-label="评论" @click="openComments(post.id)">
                <svg viewBox="0 0 24 24" class="pui-ig__act"><path d="M21 12a9 9 0 1 0-4.1 7.55L22 21l-1.45-5.1A8.9 8.9 0 0 0 21 12Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" /></svg>
                <span v-if="Number(post.rawMetrics.replies) > 0" class="pui-ig__actnum">{{ igCount(post.rawMetrics.replies) }}</span>
              </button>
              <span v-feedback="'帖子操作'" class="pui-ig__actbtn">
                <svg viewBox="0 0 24 24" class="pui-ig__act"><path d="m15 2 5 5-5 5M20 7H8a5 5 0 0 0-5 5m6 10-5-5 5-5M4 17h12a5 5 0 0 0 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
                <span v-if="Number(post.rawMetrics.reposts) > 0" class="pui-ig__actnum">{{ igCount(post.rawMetrics.reposts) }}</span>
              </span>
              <span v-feedback="'帖子操作'" class="pui-ig__actbtn">
                <svg viewBox="0 0 24 24" class="pui-ig__act"><path d="M21 3 3.5 9.6a.9.9 0 0 0 0 1.7l6.7 2.5 2.5 6.7a.9.9 0 0 0 1.7 0L21 3Zm-10.8 10.8L21 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" /></svg>
              </span>
              <span v-feedback="'收藏'" class="pui-ig__actbtn pui-ig__actbtn--save">
                <svg viewBox="0 0 24 24" class="pui-ig__act"><path d="M5 3h14v18l-7-5-7 5Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" /></svg>
              </span>
            </div>

            <!-- 正文：首页不跳详情（详情只能从主页九宫格进），纯展示 -->
            <p class="pui-ig__caption">
              <span class="pui-ig__caption-author">{{ post.authorHandle || post.authorName }}</span>
              <HashtagText v-if="post.content" :text="post.content" :accounts="work?.platformAccounts?.filter(a => a.platform === 'instagram' && a.characterId) ?? []" @search="searchHashtag" @open-account="openProfile" />
            </p>
          </li>
        </ul>
        <EmptyState
          v-else
          icon="chat"
          title="动态还是空的"
        />
      </ScrollArea>
    </section>

    <!-- ══ Reels tab ══ -->
    <section v-show="!hasOverlay && activeTab === 'reels'" class="pui-ig__pane pui-ig__pane--dark" data-testid="ig-reels-screen">
      <header class="pui-ig__reels-top">
        <span class="pui-ig__reels-spacer" aria-hidden="true" />
        <button
          type="button"
          class="pui-ig__reels-title"
          data-testid="ig-reels-logo"
          aria-label="Reels，回到桌面"
          @click="goHome"
        >
          Reels
        </button>
        <span class="pui-ig__topbar-icon pui-ig__topbar-icon--light" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M6 7h12M6 12h12M6 17h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
        </span>
      </header>

      <div class="pui-ig__reels-stage">
        <div class="pui-ig__reels-video" aria-hidden="true">
          <svg viewBox="0 0 24 24" class="pui-ig__reels-play"><path d="M8 5.5v13l11-6.5z" fill="rgba(255,255,255,0.9)" /></svg>
        </div>

        <div class="pui-ig__reels-side" aria-hidden="true">
          <span class="pui-ig__reels-side-item"><svg viewBox="0 0 24 24"><path d="M12 20.4c-4.9-3.4-8.4-6.3-8.4-10a4.6 4.6 0 018.4-2.6 4.6 4.6 0 018.4 2.6c0 3.7-3.5 6.6-8.4 10z" fill="#fff" /></svg><i>1.2万</i></span>
          <span class="pui-ig__reels-side-item"><svg viewBox="0 0 24 24"><path d="M20 12.5a7.3 7.3 0 01-7.3 7.3c-1.3 0-2.6-.3-3.6-.9L4 20l1.1-5.1a7.3 7.3 0 117.6-9.6A7.3 7.3 0 0120 12.5z" fill="#fff" /></svg><i>386</i></span>
          <span class="pui-ig__reels-side-item"><svg viewBox="0 0 24 24"><path d="M21 3.6L3.4 10.8c-.5.2-.5.9 0 1.1l6.4 2.3 2.3 6.4c.2.5.9.5 1.1 0z" fill="#fff" /></svg><i>分享</i></span>
        </div>

        <div class="pui-ig__reels-author">
          <Avatar :asset-id="reelsOwnerAccount?.avatarAssetId || reelsOwner?.avatarAssetId" :name="reelsOwnerAccount?.displayName || reelsOwner?.name || '我'" :size="30" />
          <span class="pui-ig__reels-handle">{{ reelsOwnerAccount?.handle || reelsOwner?.name || '我' }}</span>
          <span class="pui-ig__reels-follow">关注</span>
        </div>
      </div>
    </section>

    <!-- ══ 自己的主页 tab ══ -->
    <section v-show="!hasOverlay && activeTab === 'profile'" class="pui-ig__pane" data-testid="ig-profile-screen">
      <ProfileView
        v-if="ownProfile"
        :profile="ownProfile"
        scroll-key="ig:profile:me"
        @open-post="openPost"
        @open-story="openProfileStory"
        @open-follow="openFollowScreen"
        @back="goBack"
        @home="goHome"
      />
    </section>

    <!-- Story 查看器：首页浮层，盖住包括底栏在内的一切 -->
    <Transition name="pui-ig-fade">
      <div
        v-if="playingGroup && playingFrame"
        class="pui-ig__viewer"
        data-testid="ig-story-screen"
      >
        <!-- 满屏模糊背景：同一张图 cover 铺满 + 大半径高斯模糊，放大抵消模糊边缘的虚边 -->
        <img class="pui-ig__stage-bg" :src="resolveSrc(playingFrame.imageAssetId)" alt="" draggable="false" aria-hidden="true" />
        <div class="pui-ig__stage-veil" aria-hidden="true" />

        <div
          class="pui-ig__stage"
          @pointerdown="onStageDown"
          @pointermove="onStageMove"
          @pointerup="onStageUp"
          @pointercancel="onStageUp"
        >
          <div class="pui-ig__progress" aria-hidden="true">
            <i
              v-for="(f, i) in playingGroup.frames"
              :key="f.id"
              :class="{ 'pui-ig__progress-seg--on': i <= playIndex }"
            />
          </div>

          <div class="pui-ig__viewer-head">
            <Avatar :asset-id="playingGroup.author.avatarAssetId" :name="playingGroup.author.name" :size="32" />
            <span class="pui-ig__viewer-name">{{ playingGroup.author.handle || playingGroup.author.name }}</span>
            <span class="pui-ig__viewer-time">{{ playingFrame.timeLabel }}</span>
          </div>

          <button type="button" class="pui-ig__stage-hit pui-ig__stage-hit--prev" aria-label="上一帧" @click="tapPrev" />
          <figure
            class="pui-ig__stage-card"
            :style="storyDrag.active && storyDrag.dx ? { transform: `translateX(${storyDrag.dx}px)`, transition: 'none' } : undefined"
          >
            <img class="pui-ig__stage-img" :src="resolveSrc(playingFrame.imageAssetId)" alt="" draggable="false" />
          </figure>
          <figcaption v-if="playingFrame.caption" class="pui-ig__stage-caption">
            {{ playingFrame.caption }}
          </figcaption>
          <button type="button" class="pui-ig__stage-hit pui-ig__stage-hit--next" aria-label="下一帧" @click="tapNext" />

          <div class="pui-ig__viewer-foot" aria-hidden="true">
            <span class="pui-ig__viewer-reply">发消息</span>
            <svg viewBox="0 0 24 24" class="pui-ig__viewer-act"><path d="M12 20.4c-4.9-3.4-8.4-6.3-8.4-10a4.6 4.6 0 018.4-2.6 4.6 4.6 0 018.4 2.6c0 3.7-3.5 6.6-8.4 10z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" /></svg>
            <svg viewBox="0 0 24 24" class="pui-ig__viewer-act"><path d="M21 3.6L3.4 10.8c-.5.2-.5.9 0 1.1l6.4 2.3 2.3 6.4c.2.5.9.5 1.1 0z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" /></svg>
          </div>

          <button type="button" class="pui-ig__viewer-close" data-testid="ig-story-close" aria-label="关闭" @pointerdown.stop @click.stop="closeStory">
            <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
          </button>
        </div>
      </div>
    </Transition>

    <!-- 评论浮层：底部弹层（点帖子卡评论按钮展开）。点暗区或把手收起；
         内容复用 buildPostDetail 的评论派生，与详情页同一条跨帖隔离规则 -->
    <Transition name="pui-ig-sheet">
      <div
        v-if="commentsOpen && commentsDetail"
        class="pui-ig__sheet-dim"
        data-testid="ig-comments-screen"
        @click.self="closeComments"
      >
        <div class="pui-ig__sheet">
          <button type="button" class="pui-ig__sheet-grab" data-testid="ig-comments-close" aria-label="收起评论" @click="closeComments" />
          <h2 class="pui-ig__sheet-title">评论</h2>

          <div class="pui-ig__sheet-scroll">
            <ul v-if="commentThreads.length" class="pui-ig__sheet-list">
              <li v-for="t in commentThreads" :key="t.top.id" class="pui-ig__sheet-item" data-testid="ig-comment-item">
                <Avatar :asset-id="t.top.authorAvatarAssetId" :name="t.top.authorName" :size="32" />
                <div class="pui-ig__sheet-body">
                  <p class="pui-ig__sheet-meta">
                    <span class="pui-ig__sheet-author">{{ t.top.authorHandle || t.top.authorName }}</span>
                    <span class="pui-ig__sheet-time">{{ t.top.timeLabel }}</span>
                  </p>
                  <p class="pui-ig__sheet-text">{{ t.top.content }}</p>
                  <p class="pui-ig__sheet-ops" aria-hidden="true"><span>回复</span></p>
                  <button
                    v-if="t.replies.length"
                    type="button"
                    class="pui-ig__sheet-more"
                    data-testid="ig-comment-toggle"
                    @click="toggleThread(t.top.threadId)"
                  >
                    {{ expandedThreads.has(t.top.threadId) ? '收起回复' : `查看另外 ${t.replies.length} 条回复` }}
                  </button>
                  <ul v-if="expandedThreads.has(t.top.threadId)" class="pui-ig__sheet-replies">
                    <li v-for="r in t.replies" :key="r.id" class="pui-ig__sheet-item pui-ig__sheet-item--reply" data-testid="ig-comment-reply">
                      <Avatar :asset-id="r.authorAvatarAssetId" :name="r.authorName" :size="26" />
                      <div class="pui-ig__sheet-body">
                        <p class="pui-ig__sheet-meta">
                          <span class="pui-ig__sheet-author">{{ r.authorHandle || r.authorName }}</span>
                          <span class="pui-ig__sheet-time">{{ r.timeLabel }}</span>
                        </p>
                        <p class="pui-ig__sheet-text">{{ r.content }}</p>
                      </div>
                      <span class="pui-ig__sheet-like" aria-hidden="true">
                        <svg viewBox="0 0 24 24"><path d="M12 20.4c-4.9-3.4-8.4-6.3-8.4-10a4.6 4.6 0 018.4-2.6 4.6 4.6 0 018.4 2.6c0 3.7-3.5 6.6-8.4 10z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" /></svg>
                      </span>
                    </li>
                  </ul>
                </div>
                <span class="pui-ig__sheet-like" aria-hidden="true">
                  <svg viewBox="0 0 24 24"><path d="M12 20.4c-4.9-3.4-8.4-6.3-8.4-10a4.6 4.6 0 018.4-2.6 4.6 4.6 0 018.4 2.6c0 3.7-3.5 6.6-8.4 10z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" /></svg>
                </span>
              </li>
            </ul>
            <p v-else class="pui-ig__sheet-empty">还没有评论</p>
          </div>

          <div class="pui-ig__sheet-foot" aria-hidden="true">
            <div class="pui-ig__sheet-input">
              <Avatar :asset-id="null" name="我" :size="28" />
              <span class="pui-ig__commentbar-field">我来说两句…</span>
              <svg viewBox="0 0 24 24" class="pui-ig__sheet-inputicon"><rect x="3.5" y="5.5" width="17" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="1.7" /><circle cx="9" cy="10" r="1.5" fill="currentColor" /><path d="M5.5 16.5l4-4 3 3 2.5-2.5 3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" /></svg>
              <svg viewBox="0 0 24 24" class="pui-ig__sheet-inputicon"><rect x="4" y="4" width="16" height="16" rx="4" fill="none" stroke="currentColor" stroke-width="1.7" /><path d="M8.5 14.5l2.5-3 2 2.2 1.5-1.7 2 2.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" /><text x="12" y="11" text-anchor="middle" font-size="6" fill="currentColor">GIF</text></svg>
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <nav
      v-show="!hasOverlay"
      class="pui-ig__tabbar"
      :class="{ 'pui-ig__tabbar--dark': activeTab === 'reels' }"
      aria-label="主导航"
    >
      <button
        type="button"
        class="pui-ig__tab"
        :class="{ 'pui-ig__tab--on': activeTab === 'home' }"
        data-testid="ig-tab-home"
        aria-label="首页"
        @click="setTab('home')"
      >
        <svg viewBox="0 0 24 24"><path d="M4 10.4L12 4l8 6.4V20a1 1 0 01-1 1h-4.6v-6H9.6v6H5a1 1 0 01-1-1z" fill="currentColor" /></svg>
      </button>
      <button
        v-feedback="'Reels'"
        type="button"
        class="pui-ig__tab"
        :class="{ 'pui-ig__tab--on': activeTab === 'reels' }"
        data-testid="ig-tab-reels"
        aria-label="Reels"
      >
        <svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" stroke-width="2" /><path d="m10 7.5 7 4.5-7 4.5Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" /></svg>
      </button>
      <span class="pui-ig__tab" data-testid="ig-tab-dm" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M21 3 3.5 9.6a.9.9 0 0 0 0 1.7l6.7 2.5 2.5 6.7a.9.9 0 0 0 1.7 0L21 3Zm-10.8 10.8L21 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" /></svg>
      </span>
      <span class="pui-ig__tab" data-testid="ig-tab-search" role="button" tabindex="0" @click="searchHashtag('')" @keydown.enter="searchHashtag('')">
        <svg viewBox="0 0 24 24"><circle cx="10.6" cy="10.6" r="6.4" fill="none" stroke="currentColor" stroke-width="1.8" /><path d="M15.4 15.4L20.4 20.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
      </span>
      <button
        type="button"
        class="pui-ig__tab"
        :class="{ 'pui-ig__tab--on': activeTab === 'profile' }"
        data-testid="ig-tab-profile"
        aria-label="个人主页"
        @click="setTab('profile')"
      >
        <span class="pui-ig__tab-avatar">
          <Avatar
            :asset-id="reelsOwnerAccount?.avatarAssetId || reelsOwner?.avatarAssetId"
            :name="reelsOwnerAccount?.displayName || reelsOwner?.name || '我'"
            :size="26"
          />
        </span>
      </button>
    </nav>
  </div>
</template>

<style src="./InstagramApp.css"></style>
