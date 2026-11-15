

<script setup>
import { useProfileCollapse } from './use-profile-collapse.js'
import { computed, ref, watch, nextTick, onBeforeUnmount, provide } from 'vue'
import {
  buildFeed,
  resolveAuthor,
  buildXTrends,
  buildFollowGraph,
  buildPostDetail,
  followCharacterIds,
  formatListTime,
  TIME_FORMAT,
} from '@phone-sim/shared'
import ScrollArea from '../../appkit/ScrollArea.vue'
import Avatar from '../../appkit/Avatar.vue'
import EmptyState from '../../appkit/EmptyState.vue'
import XPostItem from './XPostItem.vue'
import { createLocalActions } from './local-actions.js'
const localActions = createLocalActions()
provide('x-local-actions', localActions)
import XPostText from './XPostText.vue'
import { vFeedback } from './feedback.js'
import XPostMedia from './XPostMedia.vue'
import XSearchScreens from './XSearchScreens.vue'
import { usePhoneRuntime, useWorkData } from '../../kernel/create-runtime.js'

const runtime = usePhoneRuntime()
const { getWork, resolveAsset } = useWorkData()

function resolveMedia(id) {
  try {
    return resolveAsset(id) || ''
  } catch {
    return ''
  }
}

const work = computed(() => getWork())
const settings = computed(() => work.value?.workSettings ?? {})
const timeFormat = computed(() => settings.value.timeFormat ?? TIME_FORMAT.H24)
const storyDate = computed(() => settings.value.storyDate ?? null)
const ownerCharacterId = computed(() => settings.value.ownerCharacterId ?? null)

/* ── 导航 ─────────────────────────────────────────── */
const screen = computed(() => runtime.currentScreen.value)
const screenName = computed(() => screen.value?.name ?? 'root')
const isHome = computed(() => screenName.value === 'root')
const isSearchScreen = computed(() => ['explore', 'search', 'results'].includes(screenName.value))
const replyDrafts = ref({})
const searchState = ref({ query: '', local: [], hidden: [] })
const instantTabSwitch = ref(false)
function openSearchTab() {
  instantTabSwitch.value = true
  if (buildXTrends(work.value).some(row => row.title.trim())) runtime.push('explore')
  else {
    searchState.value = { ...searchState.value, query: '' }
    runtime.push('search')
  }
  requestAnimationFrame(() => { instantTabSwitch.value = false })
}
function goHomeFromTab() {
  instantTabSwitch.value = true
  runtime.pop()
  requestAnimationFrame(() => { instantTabSwitch.value = false })
}
function startSearch(query = '') {
  searchState.value = { ...searchState.value, query }
  runtime.push(query ? 'results' : 'search')
}
const isPost = computed(() => screenName.value === 'post')
const isMedia = computed(() => screenName.value === 'media')
const direction = computed(() => (runtime.state.transition === 'pop' ? 'pop' : 'push'))

const activePostId = computed(() => isMedia.value ? screen.value?.params?.postId : isPost.value ? screen.value?.params ?? null : null)

function openProfile(characterId) {
  const id = typeof characterId === 'string' && characterId ? characterId : null
  if (!id) return
  if (isProfile.value && profileCharacterId.value === id) return
  runtime.push('profile', { characterId: id })
}

/** 顶栏头像：永远是我的主页（不是某个作者） */
function openMyProfile() {
  openProfile(ownerCharacterId.value)
}

function openPost(item) {
  const id = item?.parentId || item?.id
  if (id) runtime.push('post', id)
}
function openImage({ item, index }) {
  const postId = item?.parentId || item?.id
  if (postId) runtime.push('media', { postId, index })
}

function goBack() {
  runtime.pop()
}

/**
 * 回桌面：点顶部中间的 X logo 触发。
 *
 * 真机没有"退出应用"的界面元素，而作品端没有 home 指示条触控手势，
 * 根屏会变成死胡同。X 的顶栏 logo 是唯一居中、且点它"没有别的语义"的位置，
 * 借它当出口不会和真实的头像/加关注入口抢手感。
 */
function goHome() {
  runtime.goHome()
}

/* ── 首页时间线 ───────────────────────────────────── */
const feed = computed(() => {
  if (!work.value) return []
  return buildFeed(work.value, 'x', {
    timeFormat: timeFormat.value,
    storyDate: storyDate.value,
    ownerCharacterId: ownerCharacterId.value,
  })
})

/** 「正在关注」里的人：手机所属账号在人物配置里勾选的关注账号（extraFields.followList） */
const ownerFollowingIds = computed(() => {
  if (!work.value || !ownerAccount.value) return new Set()
  return new Set(
    buildFollowGraph(work.value, 'x', { accountId: ownerAccount.value.id }).following.map(
      (r) => r.characterId,
    ),
  )
})

const homeTab = ref('for-you')
const visibleFeed = computed(() => {
  const homeFeed = feed.value.filter(p => p.showInHome !== false)
  if (homeTab.value !== 'following') return homeFeed
  const selfId = ownerCharacterId.value
  const ids = ownerFollowingIds.value
  return homeFeed.filter(
    (p) => Boolean(p.authorCharacterId) && (p.authorCharacterId === selfId || ids.has(p.authorCharacterId)),
  )
})

/* ── 帖子详情 ─────────────────────────────────────── */
const authoredDetail = computed(() => {
  if ((!isPost.value && !isMedia.value) || !work.value || !activePostId.value) return null
  return buildPostDetail(work.value, 'x', activePostId.value, {
    timeFormat: timeFormat.value,
    ownerCharacterId: ownerCharacterId.value,
    storyDate: storyDate.value,
  })
})

const detail = computed(() => {
  const post = localActions.present(authoredDetail.value)
  return post ? { ...post, comments: post.comments.map(reply => localActions.present(reply)) } : null
})
function toggleDetail(flag) { if (authoredDetail.value) localActions.toggle(authoredDetail.value, flag) }

/**
 * 某个人的关注状态（详情页徽标、别人的主页按钮行共用）：
 *   self      就是我自己 → 不显示关注按钮
 *   mutual    互相关注（我关注了对方，对方也关注了我）
 *   following 关注中（我关注了对方）
 *   none      显示「关注」
 * 关系网只存「关注」这一个方向（followList），两个方向各查一遍就能拼出全部状态；
 * 对方没有 X 账号时关系无从查起，按未关注处理。
 */
function followStateOf(characterId) {
  if (!characterId) return 'none'
  if (ownerCharacterId.value && characterId === ownerCharacterId.value) return 'self'
  if (!work.value || !ownerAccount.value) return 'none'
  const target = work.value.platformAccounts?.find(
    (a) => a.platform === 'x' && a.characterId === characterId,
  )
  const iFollow = followCharacterIds(ownerAccount.value).includes(characterId)
  const followsMe = target
    ? followCharacterIds(target).includes(ownerAccount.value.characterId)
    : false
  if (iFollow && followsMe) return 'mutual'
  if (iFollow) return 'following'
  return 'none'
}

const authorFollowState = computed(() =>
  detail.value ? followStateOf(detail.value.authorCharacterId) : null,
)

const profileFollowState = computed(() => followStateOf(profileCharacterId.value))

const detailFoot = ref(null)
const footHeight = ref(0)
let footObserver = null

watch(
  () => [activePostId.value, isMedia.value],
  async () => {
    await nextTick()
    footObserver?.disconnect()
    footObserver = null
    if (!detailFoot.value) return
    footObserver = new ResizeObserver((entries) => {
      const h = entries?.[0]?.contentRect?.height
      if (typeof h === 'number') footHeight.value = h
    })
    footObserver.observe(detailFoot.value)
  },
  { immediate: true, flush: 'post' },
)

onBeforeUnmount(() => {
  footObserver?.disconnect()

})

/** 点媒体区可以收起底部信息区（再看全图），再点一次放回来 */
const footVisible = ref(true)

function toggleFoot() {
  footVisible.value = !footVisible.value
}

/* 换一条帖子就恢复显示，别把上一条的「收起」状态带过来 */
watch([activePostId, isMedia], () => {
  footVisible.value = true
})

/* ── 个人主页 ─────────────────────────────────────── */
const owner = computed(() => {
  if (!work.value || !ownerCharacterId.value) return null
  return work.value.characters?.find((c) => c.id === ownerCharacterId.value) ?? null
})

const ownerAccount = computed(() => {
  if (!work.value || !ownerCharacterId.value) return null
  return (
    work.value.platformAccounts?.find(
      (a) => a.characterId === ownerCharacterId.value && a.platform === 'x',
    ) ?? null
  )
})

const ownerName = computed(() => ownerAccount.value?.displayName || owner.value?.name || '我')

/**
 * 主页是谁：栈参数带 characterId 就是点进来的那个人，没带就是「我」。
 * 自己的主页与别人的主页共用同一屏，只靠 isOwnProfile 分按钮行（同 IG 的 ProfileView）。
 */
const isProfile = computed(() => screenName.value === 'profile')

const profileCharacterId = computed(() => {
  if (!isProfile.value) return ownerCharacterId.value
  const params = screen.value?.params
  const id = typeof params === 'string' ? params : params?.characterId
  return id || ownerCharacterId.value
})

const profileCharacter = computed(() => {
  if (!work.value || !profileCharacterId.value) return null
  return work.value.characters?.find((c) => c.id === profileCharacterId.value) ?? null
})

/** 这个人的 X 账号；没建账号的角色只有人物名，主页仍能打开（真机不会，但数据能少不能假） */
const profileAccount = computed(() => {
  if (!work.value || !profileCharacterId.value) return null
  return (
    work.value.platformAccounts?.find(
      (a) => a.characterId === profileCharacterId.value && a.platform === 'x',
    ) ?? null
  )
})

const isOwnProfile = computed(
  () => Boolean(profileCharacterId.value) && profileCharacterId.value === ownerCharacterId.value,
)

const profileName = computed(
  () => profileAccount.value?.displayName || profileCharacter.value?.name || '未知用户',
)
const profileHandle = computed(() => profileAccount.value?.handle ?? '')
const profileBio = computed(() => profileAccount.value?.bio ?? '')
const profileExtra = computed(() => profileAccount.value?.extraFields ?? {})
const profileAvatarAssetId = computed(
  () => profileAccount.value?.avatarAssetId || profileCharacter.value?.avatarAssetId || null,
)

const profileBannerUrl = computed(() => {
  const id = profileAccount.value?.bannerAssetId
  return id ? resolveMedia(id) : ''
})

const profileLocation = computed(() => String(profileExtra.value.location ?? '').trim())

/** joinedAt 存 'YYYY-MM'；其它写法原样显示，不猜格式 */
const profileJoinedLabel = computed(() => {
  const raw = String(profileExtra.value.joinedAt ?? '').trim()
  if (!raw) return ''
  const m = /^(\d{4})-(\d{1,2})$/.exec(raw)
  return m ? `加入于 ${m[1]}年${Number(m[2])}月` : `加入于 ${raw}`
})

/** 关注数/粉丝数没有就整行不出现（0 和"没填"是两件事） */
const profileCounts = computed(() => {
  const following = profileExtra.value.following
  const followers = profileExtra.value.followers
  if (following == null && followers == null) return null
  return {
    following: Number(following || 0).toLocaleString('zh-CN'),
    followers: Number(followers || 0).toLocaleString('zh-CN'),
  }
})

/**
 * 主页铺了背景图时，状态栏要转白字：照片上半部压了暗角，白字才读得出来；
 * 没背景图（灰渐变、浅色）仍交给自动判断。离开主页 / 离开 X 都还回 auto，
 * 否则首页那条白底就会被配成白字。
 */
watch(
  [isProfile, profileBannerUrl],
  () => {
    runtime.setStatusTone(isProfile.value && profileBannerUrl.value ? 'light' : 'auto')
  },
  { immediate: true },
)

/* ── 关注关系列表页（关注者 / 正在关注）────────────────
   主页统计里的两个数字点进来。列表是真实关系（buildFollowGraph），
   统计数字仍是作者手填的展示值 —— 两者是两件事，互不推导。 */
const isFollow = computed(() => screenName.value === 'follow')

/** 从谁的主页点进来的，就看谁的关注关系（自己 / 别人都一样） */
function openFollow(tab) {
  const characterId = isProfile.value ? profileCharacterId.value : ownerCharacterId.value
  runtime.push('follow', {
    tab: tab === 'following' ? 'following' : 'followers',
    characterId: characterId ?? null,
  })
}

const followTab = ref('followers')
/** 从栈参数恢复 tab：参数在压栈瞬间定死，进屏后用本页 tab 自由切换 */
watch(
  () => (isFollow.value ? screen.value?.params?.tab : null),
  (tab) => {
    if (tab) followTab.value = tab === 'following' ? 'following' : 'followers'
  },
  { immediate: true },
)

/** 列表页讲的是谁：栈参数带了 characterId 就用它，否则是我的 */
const followCharacterId = computed(() => {
  if (!isFollow.value) return ownerCharacterId.value
  const id = screen.value?.params?.characterId
  return id || ownerCharacterId.value
})

const followOwnerName = computed(() => {
  if (followCharacterId.value === ownerCharacterId.value) return ownerName.value
  const character = work.value?.characters?.find((c) => c.id === followCharacterId.value)
  const account = work.value?.platformAccounts?.find(
    (a) => a.characterId === followCharacterId.value && a.platform === 'x',
  )
  return account?.displayName || character?.name || '未知用户'
})

const followOwnerHandle = computed(() => {
  const account = work.value?.platformAccounts?.find(
    (a) => a.characterId === followCharacterId.value && a.platform === 'x',
  )
  return account?.handle ?? ''
})

const followGraph = computed(() => {
  if (!isFollow.value || !work.value || !followCharacterId.value) {
    return { following: [], followers: [] }
  }
  return buildFollowGraph(work.value, 'x', { characterId: followCharacterId.value })
})
const followRows = computed(() =>
  followTab.value === 'following' ? followGraph.value.following : followGraph.value.followers,
)
const followEmpty = computed(() =>
  followTab.value === 'following'
    ? { title: '还没有关注任何人', description: '' }
    : { title: '还没有关注者', description: '' },
)

/** 主页「帖子」：feed 里属于这个人的那些（自己的、别人的同一套规则） */
const profilePosts = computed(() =>
  profileCharacterId.value
    ? feed.value.filter((p) => p.authorCharacterId === profileCharacterId.value || p.xRepostByCharacterIds?.includes(profileCharacterId.value))
    : [],
)

/** 回复页以「被回复内容 → 当前用户回复」展示上下文。 */
const profileReplies = computed(() => {
  if (!work.value || !profileCharacterId.value) return []
  const posts = work.value.appData?.x?.posts ?? []
  const replies = work.value.appData?.x?.replies ?? []
  const byId = new Map([...posts, ...replies].map(row => [row.id, row]))
  function rootId(row) {
    const seen = new Set()
    while (row && !seen.has(row.id)) {
      if (posts.some(post => post.id === row.id)) return row.id
      seen.add(row.id)
      row = byId.get(row.parentId)
    }
    return null
  }
  function replyItem(row, postId) {
    const author = resolveAuthor(work.value, { characterId: row.authorCharacterId, accountId: row.authorAccountId, snapshot: row.snapshot })
    return {
      id: row.id,
      authorCharacterId: author.characterId,
      authorName: author.name,
      authorHandle: author.handle,
      authorAvatarAssetId: author.avatarAssetId,
      content: row.content ?? '',
      timeLabel: formatListTime(row.displayTime, { storyDate: storyDate.value, timeFormat: timeFormat.value }),
      parentId: postId,
      metrics: null,
    }
  }
  return replies
    .filter(row => row.authorCharacterId === profileCharacterId.value)
    .sort((a, b) => String(b.displayTime).localeCompare(String(a.displayTime)))
    .flatMap(row => {
      const postId = rootId(row)
      if (!postId) return []
      const parent = byId.get(row.parentId)
      const context = feed.value.find(post => post.id === parent?.id) ?? (parent ? replyItem(parent, postId) : null)
      return [{ ...replyItem(row, postId), replyContext: context }]
    })
})

const PROFILE_TABS = [
  { id: 'posts', label: '帖子', icon: 'list' },
  { id: 'replies', label: '回复', icon: 'reply' },
  { id: 'media', label: '媒体', icon: 'media' },
  { id: 'likes', label: '喜欢', icon: 'heart' },
]

const profileTab = ref('posts')

const profileItems = computed(() => {
  if (profileTab.value === 'posts') return profilePosts.value
  if (profileTab.value === 'replies') return profileReplies.value
  if (profileTab.value === 'media') {
    return profilePosts.value.filter((p) => (p.mediaAssetIds ?? []).length > 0)
  }
  if (profileTab.value === 'likes') return feed.value.filter(p => p.xLikeByCharacterIds?.includes(profileCharacterId.value))
  return []
})

const profileEmpty = computed(() => {
  if (profileTab.value === 'likes') {
    return { title: '还没有喜欢的内容', description: '' }
  }
  if (profileTab.value === 'media') {
    return { title: '还没有媒体', description: '带图片的帖子会出现在这里。' }
  }
  if (profileTab.value === 'replies') {
    return { title: '还没有回复', description: '' }
  }
  return { title: '还没有帖子', description: '' }
})

/** 顶栏收起后显示在名字下面的那行 —— 真机口径是「主页全部帖子」 */
const profilePostCountLabel = computed(() => `${profilePosts.value.length} 个帖子`)

const { profileScroller, profileTabs, headerCollapsed, profileMinScroll, avatarGone, updateProfileCollapse } = useProfileCollapse({ isProfile, profileCharacterId, profileTab })
</script>

<template>
  <div class="pui-x" data-testid="x-app">
    <Transition :name="instantTabSwitch ? '' : `pui-x-screen-${direction}`">
      <!-- ══ 首页时间线 ══ -->
      <section v-if="isHome" key="home" class="pui-x__screen" data-testid="x-home-screen">
        <header class="pui-x__topbar">
          <button
            type="button"
            class="pui-x__avatar-btn"
            data-testid="x-avatar-btn"
            aria-label="个人主页"
            @click="openMyProfile"
          >
            <Avatar :asset-id="owner?.avatarAssetId" :name="ownerName" :size="30" />
          </button>

          <button
            type="button"
            class="pui-x__logo-btn"
            data-testid="x-home-logo"
            aria-label="X，回到桌面"
            @click="goHome"
          >
            <svg class="pui-x__logo" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M18.24 2.25h3.31l-7.23 8.26 8.5 11.24h-6.66l-5.21-6.82-5.97 6.82H1.67l7.73-8.84L1.25 2.25h6.83l4.71 6.23zm-1.16 17.52h1.83L7.08 4.13H5.12z" fill="currentColor" />
            </svg>
          </button>

          <span v-feedback="'添加好友'" class="pui-x__topbar-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><circle cx="9.5" cy="8.5" r="3.6" fill="none" stroke="currentColor" stroke-width="1.8" /><path d="M3.6 19.2c.7-3.3 3-5.1 5.9-5.1 1.2 0 2.3.3 3.2.9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /><path d="M18 8.4v6M15 11.4h6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
          </span>
        </header>

        <nav class="pui-x__hometabs">
          <button
            type="button"
            class="pui-x__hometab"
            :class="{ 'pui-x__hometab--on': homeTab === 'for-you' }"
            data-testid="x-hometab-for-you"
            @click="homeTab = 'for-you'"
          >
            为你推荐
            <svg viewBox="0 0 24 24" class="pui-x__chev" aria-hidden="true"><path d="M7 10l5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" /></svg>
          </button>
          <button
            type="button"
            class="pui-x__hometab"
            :class="{ 'pui-x__hometab--on': homeTab === 'following' }"
            data-testid="x-hometab-following"
            @click="homeTab = 'following'"
          >
            正在关注
          </button>
          <span v-feedback="'添加'" class="pui-x__hometab pui-x__hometab--add" aria-hidden="true">
            添加
            <svg viewBox="0 0 24 24" class="pui-x__chev"><path d="M12 6v12M6 12h12" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" /></svg>
          </span>
        </nav>

        <!-- :fade="false" —— 关掉滚动区上下渐隐遮罩。
             首页是「图片/媒体出血到边缘」的信息流，遮罩（顶 14px / 底 20px）
             会盖在图上变成两条白色渐变，既不是真机行为也压掉了底部作者行的字。
             与 Instagram 首页同一处理。 -->
        <ScrollArea scroll-key="x:home" padding-bottom="8" :fade="false">
          <ul v-if="visibleFeed.length" class="pui-x__feed">
            <li v-for="post in visibleFeed" :key="post.id">
              <XPostItem
                :item="post"
                @open="openPost" @search="startSearch"
                @open-image="openImage"
                @open-author="openProfile"
              />
            </li>
          </ul>
          <EmptyState
            v-else
            icon="chat"
            :title="homeTab === 'following' ? '关注的人还没发帖' : '时间线还是空的'"
          />
        </ScrollArea>

        <span v-feedback="'发帖'" class="pui-x__fab" data-testid="x-fab" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" /></svg>
        </span>

        <nav class="pui-x__tabbar" aria-label="主导航">
          <span class="pui-x__tabbar-btn pui-x__tabbar-btn--on" data-testid="x-tab-home" aria-label="首页">
            <svg viewBox="0 0 24 24"><path d="M21.591 7.146L12.52 1.157c-.316-.21-.724-.21-1.04 0l-9.071 5.99c-.26.173-.409.456-.409.757v13.183c0 .502.418.913.929.913H9.14c.51 0 .929-.41.929-.913v-7.075h3.909v7.075c0 .502.417.913.928.913h6.165c.511 0 .929-.41.929-.913V7.904c0-.301-.158-.584-.409-.758z" fill="currentColor" /></svg>
          </span>
          <button type="button" class="pui-x__tabbar-btn" data-testid="x-tab-search" aria-label="搜索" @click="openSearchTab">
            <svg viewBox="0 0 24 24"><path d="M10.25 3.75c-3.59 0-6.5 2.91-6.5 6.5s2.91 6.5 6.5 6.5c1.795 0 3.419-.726 4.596-1.904 1.178-1.177 1.904-2.801 1.904-4.596 0-3.59-2.91-6.5-6.5-6.5zm-8.5 6.5c0-4.694 3.806-8.5 8.5-8.5s8.5 3.806 8.5 8.5c0 1.986-.682 3.815-1.824 5.262l4.781 4.781-1.414 1.414-4.781-4.781c-1.447 1.142-3.276 1.824-5.262 1.824-4.694 0-8.5-3.806-8.5-8.5z" fill="currentColor" /></svg>
          </button>
          <span v-feedback="'通知'" class="pui-x__tabbar-btn" data-testid="x-tab-notif" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M19.993 9.042C19.48 5.017 16.054 2 11.996 2s-7.49 3.021-7.999 7.051L2.866 18H7.1c.463 2.282 2.481 4 4.9 4s4.437-1.718 4.9-4h4.236l-1.143-8.958zM12 20c-1.306 0-2.417-.835-2.829-2h5.658c-.412 1.165-1.523 2-2.829 2zm-6.866-4l.847-6.698C6.364 6.272 8.941 4 11.996 4s5.627 2.268 6.013 5.295L18.864 16H5.134z" fill="currentColor" /></svg>
          </span>
          <span v-feedback="'私信'" class="pui-x__tabbar-btn" data-testid="x-tab-dm" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M1.751 10c0-4.42 3.584-8 8.005-8h4.366c4.49 0 8.129 3.64 8.129 8.13 0 2.96-1.607 5.68-4.196 7.11l-8.054 4.46v-3.69h-.067c-4.49.1-8.183-3.51-8.183-8.01zm8.005-6c-3.317 0-6.005 2.69-6.005 6 0 3.37 2.77 6.08 6.138 6.01l.351-.01h1.761v2.3l5.087-2.81c1.951-1.08 3.163-3.13 3.163-5.36 0-3.39-2.744-6.13-6.129-6.13H9.756z" fill="currentColor" /></svg>
          </span>
        </nav>
      </section>

      <XSearchScreens v-else-if="isSearchScreen" v-model="searchState" :mode="screenName" :work="work" :owner="owner" :owner-name="ownerName" @search="query => { searchState.query = query; runtime.push('search') }" @results="startSearch" @back="goBack" @home="goHomeFromTab" @open-author="openProfile" @open-post="openPost" @open-image="openImage" />

      <!-- ══ 帖子详情 ══ -->
      <section
        v-else-if="isPost || isMedia"
        :key="`${screenName}:${activePostId}`"
        class="pui-x__screen"
        :class="{ 'pui-x__screen--dark': detail && isMedia }"
        :data-testid="isMedia ? 'x-media-screen' : 'x-post-screen'"
      >
        <!-- ══ 独立深色媒体查看器 ══
             三段布局：顶栏 / 媒体舞台（弹性占满剩余空间，图片居中）/ 信息区贴底。
             媒体吸附翻页（一屏一张）在 XPostMedia 的 stage 形态里。 -->
        <div
          v-if="detail && isMedia"
          class="pui-xd"
          :class="{ 'pui-xd--bare': !footVisible }"
          :style="{ '--xm-foot-h': `${footHeight}px` }"
        >
          <header class="pui-xd__bar">
            <button type="button" class="pui-xd__back" data-testid="nav-back" aria-label="返回" @click="goBack">
              <svg viewBox="0 0 24 24"><path d="M14.5 5.5L8 12l6.5 6.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
            </button>
            <span v-feedback="'更多'" class="pui-xd__menu" aria-hidden="true">
              <svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.8" fill="currentColor" /><circle cx="12" cy="12" r="1.8" fill="currentColor" /><circle cx="19" cy="12" r="1.8" fill="currentColor" /></svg>
            </span>
          </header>

          <!-- 点媒体区收起/放回底部信息区（XPostMedia 会在拖动后吞掉 click，
               所以「滑一下」不会被当成「点一下」） -->
          <div class="pui-xd__stage" @click="toggleFoot">
            <XPostMedia
              :media-asset-ids="detail.mediaAssetIds"
              :resolve-src="resolveMedia"
              :bordered="false"
              :dark="true"
              :initial-index="screen.params.index"
              testid="x-detail-media"
            />
          </div>

          <div
            ref="detailFoot"
            class="pui-xd__foot"
            :class="{ 'pui-xd__foot--hidden': !footVisible }"
          >
            <div class="pui-xd__author">
              <Avatar
                :asset-id="detail.authorAvatarAssetId"
                :name="detail.authorName"
                :size="44"
                data-testid="x-detail-avatar"
                @click="openProfile(detail.authorCharacterId)"
              />
              <div class="pui-xd__id">
                <span class="pui-xd__name" data-testid="x-detail-name" @click="openProfile(detail.authorCharacterId)">{{ detail.authorName }}</span>
                <span v-if="detail.authorHandle" class="pui-xd__handle" @click="openProfile(detail.authorCharacterId)">@{{ detail.authorHandle }}</span>
              </div>
              <span v-if="authorFollowState === 'none'" v-feedback="'关注'" class="pui-xd__follow">关注</span>
              <span v-else-if="authorFollowState === 'following'" v-feedback="'关注状态'" class="pui-xd__follow pui-xd__follow--muted">关注中</span>
              <span v-else-if="authorFollowState === 'mutual'" v-feedback="'关注状态'" class="pui-xd__follow pui-xd__follow--muted">互相关注</span>
            </div>

            <div v-if="detail.content" class="pui-xd__text" aria-label="帖子正文" @click="openPost(detail)"><XPostText :text="detail.content" :accounts="work?.platformAccounts?.filter(a => a.platform === 'x' && a.characterId) ?? []" @search="startSearch" @open-account="openProfile" /></div>

            <div class="pui-xd__actions">
              <span v-feedback="'回复'" class="pui-xd__pill">
                <svg viewBox="0 0 24 24"><path d="M1.751 10c0-4.42 3.584-8 8.005-8h4.366c4.49 0 8.129 3.64 8.129 8.13 0 2.96-1.607 5.68-4.196 7.11l-8.054 4.46v-3.69h-.067c-4.49.1-8.183-3.51-8.183-8.01zm8.005-6c-3.317 0-6.005 2.69-6.005 6 0 3.37 2.77 6.08 6.138 6.01l.351-.01h1.761v2.3l5.087-2.81c1.951-1.08 3.163-3.13 3.163-5.36 0-3.39-2.744-6.13-6.129-6.13H9.756z" fill="currentColor" /></svg>
                <template v-if="detail.metrics?.replies && detail.metrics.replies !== '0'">{{ detail.metrics.replies }}</template>
              </span>
              <span v-feedback="'转帖'" class="pui-xd__pill" :class="{ 'is-reposted': detail.repostedByOwner }" @click.stop="toggleDetail('repostedByOwner')">
                <svg viewBox="0 0 24 24"><path d="M4.5 3.88l4.432 4.14-1.364 1.46L5.5 7.55V16c0 1.1.896 2 2 2H13v2H7.5c-2.209 0-4-1.79-4-4V7.55L1.432 9.48.068 8.02 4.5 3.88zM16.5 6H11V4h5.5c2.209 0 4 1.79 4 4v8.45l2.068-1.93 1.364 1.46-4.432 4.14-4.432-4.14 1.364-1.46 2.068 1.93V8c0-1.1-.896-2-2-2z" fill="currentColor" /></svg>
                <template v-if="detail.metrics?.reposts && detail.metrics.reposts !== '0'">{{ detail.metrics.reposts }}</template>
              </span>
              <span v-feedback="'点赞'" class="pui-xd__pill" :class="{ 'is-liked': detail.likedByOwner }" @click.stop="toggleDetail('likedByOwner')">
                <svg viewBox="0 0 24 24"><path :d="detail.likedByOwner ? 'M12 21s-9-5.3-9-12a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 6.7-9 12-9 12Z' : 'M16.697 5.5c-1.222-.06-2.679.51-3.89 2.16l-.805 1.09-.806-1.09C9.984 6.01 8.526 5.44 7.304 5.5c-1.243.07-2.349.78-2.91 1.91-.552 1.12-.633 2.78.479 4.82 1.074 1.97 3.257 4.27 7.129 6.61 3.87-2.34 6.052-4.64 7.126-6.61 1.111-2.04 1.03-3.7.477-4.82-.561-1.13-1.666-1.84-2.908-1.91zm4.187 7.69c-1.351 2.48-4.001 5.12-8.379 7.67l-.503.3-.504-.3c-4.379-2.55-7.029-5.19-8.382-7.67-1.36-2.5-1.41-4.86-.514-6.67.887-1.79 2.647-2.91 4.601-3.01 1.651-.09 3.368.56 4.798 2.01 1.429-1.45 3.146-2.1 4.796-2.01 1.954.1 3.714 1.22 4.601 3.01.896 1.81.846 4.17-.514 6.67z'" fill="currentColor" /></svg>
                <template v-if="detail.metrics?.likes && detail.metrics.likes !== '0'">{{ detail.metrics.likes }}</template>
              </span>
              <span v-feedback="'收藏'" class="pui-xd__pill" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M4 4.5C4 3.12 5.119 2 6.5 2h11C18.881 2 20 3.12 20 4.5v18.44l-8-5.71-8 5.71V4.5zM6.5 4c-.276 0-.5.22-.5.5v14.56l6-4.29 6 4.29V4.5c0-.28-.224-.5-.5-.5h-11z" fill="currentColor" /></svg>
              </span>
              <span v-feedback="'分享'" class="pui-xd__pill" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M12 2.59l5.7 5.7-1.41 1.42L13 6.41V16h-2V6.41l-3.3 3.3-1.41-1.42L12 2.59zM21 15l-.02 3.51c0 1.38-1.12 2.49-2.5 2.49H5.5C4.11 21 3 19.88 3 18.5V15h2v3.5c0 .28.22.5.5.5h12.98c.28 0 .5-.22.5-.5L19 15h2z" fill="currentColor" /></svg>
              </span>
            </div>

            <div class="pui-xd__replybar">
              <Avatar :asset-id="owner?.avatarAssetId" :name="ownerName" :size="28" />
              <input v-model="replyDrafts[activePostId]" class="pui-xd__replybar-text" type="text" placeholder="发布你的回复" aria-label="发布你的回复" @keydown.enter.prevent />
              <svg v-feedback="'添加图片'" viewBox="0 0 24 24"><rect x="3.5" y="5.5" width="17" height="13" rx="2.6" fill="none" stroke="currentColor" stroke-width="1.7" /><circle cx="9" cy="10.5" r="1.5" fill="currentColor" /><path d="M4.5 17l4.6-4 3.4 2.6 2.7-2 4.3 3.4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" /></svg>
              <span v-feedback="'添加 GIF'" class="pui-x__gif">GIF</span>
              <svg v-feedback="'展开回复框'" viewBox="0 0 24 24"><path d="M9 4.5H5.5A1 1 0 004.5 5.5V9M15 4.5h3.5a1 1 0 011 1V9M9 19.5H5.5a1 1 0 01-1-1V15M15 19.5h3.5a1 1 0 001-1V15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
            </div>
          </div>
        </div>

        <!-- ══ 普通帖子详情（含带图帖与回复） ══ -->
        <template v-else>
          <header class="pui-x__subbar">
            <button type="button" class="pui-x__back" data-testid="nav-back" aria-label="返回" @click="goBack">
              <svg viewBox="0 0 24 24"><path d="M14.5 5.5L8 12l6.5 6.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
            </button>
            <h1 class="pui-x__subbar-title">发帖</h1>
            <span class="pui-x__subbar-spacer"></span>
          </header>

          <ScrollArea
            v-if="detail"
            :scroll-key="`x:post:${activePostId}`"
            padding-bottom="8"
            :fade="false"
          >
            <article class="pui-x__detail">
              <div class="pui-x__detail-head">
                <Avatar
                  :asset-id="detail.authorAvatarAssetId"
                  :name="detail.authorName"
                  :size="44"
                  data-testid="x-detail-avatar"
                  @click="openProfile(detail.authorCharacterId)"
                />
                <div class="pui-x__detail-id">
                  <span class="pui-x__name" data-testid="x-detail-name" @click="openProfile(detail.authorCharacterId)">{{ detail.authorName }}</span>
                  <span v-if="detail.authorHandle" class="pui-x__handle" @click="openProfile(detail.authorCharacterId)">@{{ detail.authorHandle }}</span>
                </div>
                <span v-if="authorFollowState === 'none'" v-feedback="'关注'" class="pui-x__follow">关注</span>
                <span v-else-if="authorFollowState === 'following'" v-feedback="'关注状态'" class="pui-x__follow pui-x__follow--muted">关注中</span>
                <span v-else-if="authorFollowState === 'mutual'" v-feedback="'关注状态'" class="pui-x__follow pui-x__follow--muted">互相关注</span>
              </div>

              <p class="pui-x__detail-text"><XPostText :text="detail.content" :accounts="work?.platformAccounts?.filter(a => a.platform === 'x' && a.characterId) ?? []" @search="startSearch" @open-account="openProfile" /></p>

              <XPostMedia v-if="detail.mediaAssetIds?.length" class="pui-x__detail-media" :media-asset-ids="detail.mediaAssetIds" :resolve-src="resolveMedia" :bordered="false" testid="x-post-detail-media" @open-image="openImage({ item: detail, index: $event })" />

              <p class="pui-x__detail-meta">
                {{ detail.timeLabel }}
                <template v-if="detail.metrics?.views && detail.metrics.views !== '0'">
                  · <strong class="pui-x__detail-views">{{ detail.metrics.views }}</strong> 查看次数
                </template>
              </p>

              <div class="pui-x__actions">
                <span v-feedback="'回复'" class="pui-x__act">
                  <svg viewBox="0 0 24 24"><path d="M1.751 10c0-4.42 3.584-8 8.005-8h4.366c4.49 0 8.129 3.64 8.129 8.13 0 2.96-1.607 5.68-4.196 7.11l-8.054 4.46v-3.69h-.067c-4.49.1-8.183-3.51-8.183-8.01zm8.005-6c-3.317 0-6.005 2.69-6.005 6 0 3.37 2.77 6.08 6.138 6.01l.351-.01h1.761v2.3l5.087-2.81c1.951-1.08 3.163-3.13 3.163-5.36 0-3.39-2.744-6.13-6.129-6.13H9.756z" fill="currentColor" /></svg>
                  <template v-if="detail.metrics?.replies && detail.metrics.replies !== '0'">{{ detail.metrics.replies }}</template>
                </span>
                <span v-feedback="'转帖'" class="pui-x__act" :class="{ 'is-reposted': detail.repostedByOwner }" @click.stop="toggleDetail('repostedByOwner')">
                  <svg viewBox="0 0 24 24"><path d="M4.5 3.88l4.432 4.14-1.364 1.46L5.5 7.55V16c0 1.1.896 2 2 2H13v2H7.5c-2.209 0-4-1.79-4-4V7.55L1.432 9.48.068 8.02 4.5 3.88zM16.5 6H11V4h5.5c2.209 0 4 1.79 4 4v8.45l2.068-1.93 1.364 1.46-4.432 4.14-4.432-4.14 1.364-1.46 2.068 1.93V8c0-1.1-.896-2-2-2z" fill="currentColor" /></svg>
                  <template v-if="detail.metrics?.reposts && detail.metrics.reposts !== '0'">{{ detail.metrics.reposts }}</template>
                </span>
                <span v-feedback="'点赞'" class="pui-x__act" :class="{ 'is-liked': detail.likedByOwner }" @click.stop="toggleDetail('likedByOwner')">
                  <svg viewBox="0 0 24 24"><path :d="detail.likedByOwner ? 'M12 21s-9-5.3-9-12a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 6.7-9 12-9 12Z' : 'M16.697 5.5c-1.222-.06-2.679.51-3.89 2.16l-.805 1.09-.806-1.09C9.984 6.01 8.526 5.44 7.304 5.5c-1.243.07-2.349.78-2.91 1.91-.552 1.12-.633 2.78.479 4.82 1.074 1.97 3.257 4.27 7.129 6.61 3.87-2.34 6.052-4.64 7.126-6.61 1.111-2.04 1.03-3.7.477-4.82-.561-1.13-1.666-1.84-2.908-1.91zm4.187 7.69c-1.351 2.48-4.001 5.12-8.379 7.67l-.503.3-.504-.3c-4.379-2.55-7.029-5.19-8.382-7.67-1.36-2.5-1.41-4.86-.514-6.67.887-1.79 2.647-2.91 4.601-3.01 1.651-.09 3.368.56 4.798 2.01 1.429-1.45 3.146-2.1 4.796-2.01 1.954.1 3.714 1.22 4.601 3.01.896 1.81.846 4.17-.514 6.67z'" fill="currentColor" /></svg>
                  <template v-if="detail.metrics?.likes && detail.metrics.likes !== '0'">{{ detail.metrics.likes }}</template>
                </span>
                <span v-feedback="'收藏'" class="pui-x__act">
                  <svg viewBox="0 0 24 24"><path d="M4 4.5C4 3.12 5.119 2 6.5 2h11C18.881 2 20 3.12 20 4.5v18.44l-8-5.71-8 5.71V4.5zM6.5 4c-.276 0-.5.22-.5.5v14.56l6-4.29 6 4.29V4.5c0-.28-.224-.5-.5-.5h-11z" fill="currentColor" /></svg>
                </span>
                <span v-feedback="'分享'" class="pui-x__act">
                  <svg viewBox="0 0 24 24"><path d="M12 2.59l5.7 5.7-1.41 1.42L13 6.41V16h-2V6.41l-3.3 3.3-1.41-1.42L12 2.59zM21 15l-.02 3.51c0 1.38-1.12 2.49-2.5 2.49H5.5C4.11 21 3 19.88 3 18.5V15h2v3.5c0 .28.22.5.5.5h12.98c.28 0 .5-.22.5-.5L19 15h2z" fill="currentColor" /></svg>
                </span>
              </div>
            </article>

            <div class="pui-x__related">
              <span v-feedback="'相关'" class="pui-x__related-left">
                相关
                <svg viewBox="0 0 24 24" class="pui-x__chev" aria-hidden="true"><path d="M7 10l5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" /></svg>
              </span>
              <span v-feedback="'查看引用'" class="pui-x__related-right">
                查看引用
                <svg viewBox="0 0 24 24" class="pui-x__chev-r" aria-hidden="true"><path d="M10 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" /></svg>
              </span>
            </div>

            <ul v-if="detail.comments.length" class="pui-x__replies">
              <li
                v-for="reply in detail.comments"
                :key="reply.id"
                class="pui-x__reply"
                :class="{
                  'pui-x__reply--end': reply.threadEnd,
                  'pui-x__reply--up': !reply.threadStart,
                  'pui-x__reply--down': !reply.threadEnd,
                }"
                data-testid="x-reply-item"
              >
                <Avatar
                  :asset-id="reply.authorAvatarAssetId"
                  :name="reply.authorName"
                  :size="40"
                  @click="openProfile(reply.authorCharacterId)"
                />
                <div class="pui-x__reply-body">
                  <div class="pui-x__reply-head">
                    <span class="pui-x__name" @click="openProfile(reply.authorCharacterId)">{{ reply.authorName }}</span>
                    <span v-if="reply.authorHandle" class="pui-x__handle" @click="openProfile(reply.authorCharacterId)">@{{ reply.authorHandle }}</span>
                    <span class="pui-x__meta">· {{ reply.timeLabel }}</span>
                  </div>
                  <p class="pui-x__reply-text">{{ reply.content }}</p>
                  <div class="pui-x__actions pui-x__actions--sm">
                    <span class="pui-x__act">
                      <svg viewBox="0 0 24 24"><path d="M1.751 10c0-4.42 3.584-8 8.005-8h4.366c4.49 0 8.129 3.64 8.129 8.13 0 2.96-1.607 5.68-4.196 7.11l-8.054 4.46v-3.69h-.067c-4.49.1-8.183-3.51-8.183-8.01zm8.005-6c-3.317 0-6.005 2.69-6.005 6 0 3.37 2.77 6.08 6.138 6.01l.351-.01h1.761v2.3l5.087-2.81c1.951-1.08 3.163-3.13 3.163-5.36 0-3.39-2.744-6.13-6.129-6.13H9.756z" fill="currentColor" /></svg>
                    </span>
                    <span class="pui-x__act" :class="{ 'is-reposted': reply.repostedByOwner }" @click.stop="localActions.toggle(reply, 'repostedByOwner')">
                      <svg viewBox="0 0 24 24"><path d="M4.5 3.88l4.432 4.14-1.364 1.46L5.5 7.55V16c0 1.1.896 2 2 2H13v2H7.5c-2.209 0-4-1.79-4-4V7.55L1.432 9.48.068 8.02 4.5 3.88zM16.5 6H11V4h5.5c2.209 0 4 1.79 4 4v8.45l2.068-1.93 1.364 1.46-4.432 4.14-4.432-4.14 1.364-1.46 2.068 1.93V8c0-1.1-.896-2-2-2z" fill="currentColor" /></svg>
                    </span>
                    <span class="pui-x__act" :class="{ 'is-liked': reply.likedByOwner }" @click.stop="localActions.toggle(reply, 'likedByOwner')">
                      <svg viewBox="0 0 24 24"><path :d="reply.likedByOwner ? 'M12 21s-9-5.3-9-12a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 6.7-9 12-9 12Z' : 'M16.697 5.5c-1.222-.06-2.679.51-3.89 2.16l-.805 1.09-.806-1.09C9.984 6.01 8.526 5.44 7.304 5.5c-1.243.07-2.349.78-2.91 1.91-.552 1.12-.633 2.78.479 4.82 1.074 1.97 3.257 4.27 7.129 6.61 3.87-2.34 6.052-4.64 7.126-6.61 1.111-2.04 1.03-3.7.477-4.82-.561-1.13-1.666-1.84-2.908-1.91zm4.187 7.69c-1.351 2.48-4.001 5.12-8.379 7.67l-.503.3-.504-.3c-4.379-2.55-7.029-5.19-8.382-7.67-1.36-2.5-1.41-4.86-.514-6.67.887-1.79 2.647-2.91 4.601-3.01 1.651-.09 3.368.56 4.798 2.01 1.429-1.45 3.146-2.1 4.796-2.01 1.954.1 3.714 1.22 4.601 3.01.896 1.81.846 4.17-.514 6.67z'" fill="currentColor" /></svg>
                    </span>
                    <span class="pui-x__act">
                      <svg viewBox="0 0 24 24"><path d="M8.75 21V3h2v18h-2zM18 21V8.5h2V21h-2zM4 21l.004-10h2L6 21H4zm9.248 0v-7h2v7h-2z" fill="currentColor" /></svg>
                    </span>
                    <span class="pui-x__act">
                      <svg viewBox="0 0 24 24"><path d="M4 4.5C4 3.12 5.119 2 6.5 2h11C18.881 2 20 3.12 20 4.5v18.44l-8-5.71-8 5.71V4.5zM6.5 4c-.276 0-.5.22-.5.5v14.56l6-4.29 6 4.29V4.5c0-.28-.224-.5-.5-.5h-11z" fill="currentColor" /></svg>
                    </span>
                    <span class="pui-x__act">
                      <svg viewBox="0 0 24 24"><path d="M12 2.59l5.7 5.7-1.41 1.42L13 6.41V16h-2V6.41l-3.3 3.3-1.41-1.42L12 2.59zM21 15l-.02 3.51c0 1.38-1.12 2.49-2.5 2.49H5.5C4.11 21 3 19.88 3 18.5V15h2v3.5c0 .28.22.5.5.5h12.98c.28 0 .5-.22.5-.5L19 15h2z" fill="currentColor" /></svg>
                    </span>
                  </div>
                </div>
              </li>
            </ul>

            <EmptyState
              v-else
              icon="chat"
              title="还没有回复"
            />

            <!-- 底部悬浮回复条占位：最后一条回复滚到底时不被输入框压住 -->
            <div class="pui-x__detail-spacer" aria-hidden="true"></div>
          </ScrollArea>

          <ScrollArea v-else padding-bottom="8" :fade="false">
            <EmptyState icon="chat" title="帖子不存在" description="它可能已经被删除了。" />
          </ScrollArea>

          <!-- 底部渐变：从屏幕底端开始向上渐隐，滚动内容从它后面穿过淡出 -->
          <div class="pui-x__detail-fade" aria-hidden="true"></div>

          <!-- 底部回复条（悬浮在渐变之上；作品只读，保留外观） -->
          <div class="pui-x__replybar">
            <Avatar :asset-id="owner?.avatarAssetId" :name="ownerName" :size="28" />
            <input v-model="replyDrafts[activePostId]" class="pui-x__replybar-text" type="text" placeholder="发布你的回复" aria-label="发布你的回复" @keydown.enter.prevent />
            <svg v-feedback="'添加图片'" viewBox="0 0 24 24"><rect x="3.5" y="5.5" width="17" height="13" rx="2.6" fill="none" stroke="currentColor" stroke-width="1.7" /><circle cx="9" cy="10.5" r="1.5" fill="currentColor" /><path d="M4.5 17l4.6-4 3.4 2.6 2.7-2 4.3 3.4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" /></svg>
            <span v-feedback="'添加 GIF'" class="pui-x__gif">GIF</span>
            <svg v-feedback="'展开回复框'" viewBox="0 0 24 24"><path d="M9 4.5H5.5A1 1 0 004.5 5.5V9M15 4.5h3.5a1 1 0 011 1V9M9 19.5H5.5a1 1 0 01-1-1V15M15 19.5h3.5a1 1 0 001-1V15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
          </div>
        </template>
      </section>

      <!-- ══ 关注关系列表（主页统计数字点进来）══ -->
      <section v-else-if="isFollow" key="follow" class="pui-x__screen" data-testid="x-follow-screen">
        <header class="pui-x__subbar">
          <button type="button" class="pui-x__back" data-testid="nav-back" aria-label="返回" @click="goBack">
            <svg viewBox="0 0 24 24"><path d="M14.5 5.5L8 12l6.5 6.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
          </button>
          <h1 class="pui-x__subbar-title">{{ followOwnerHandle ? `@${followOwnerHandle}` : followOwnerName }}</h1>
          <span class="pui-x__subbar-spacer"></span>
        </header>

        <nav class="pui-x__followtabs" aria-label="关注关系">
          <button
            type="button"
            class="pui-x__followtab"
            :class="{ 'pui-x__followtab--on': followTab === 'followers' }"
            data-testid="x-followtab-followers"
            @click="followTab = 'followers'"
          >
            关注者
          </button>
          <button
            type="button"
            class="pui-x__followtab"
            :class="{ 'pui-x__followtab--on': followTab === 'following' }"
            data-testid="x-followtab-following"
            @click="followTab = 'following'"
          >
            正在关注
          </button>
        </nav>

        <ScrollArea scroll-key="x:follow" padding-bottom="8">
          <ul v-if="followRows.length" class="pui-x__followlist">
            <li
              v-for="row in followRows"
              :key="row.characterId"
              class="pui-x__followrow"
              data-testid="x-follow-row"
            >
              <button type="button" class="pui-x__follow-avatar-link" :aria-label="'查看' + row.name + '的主页'" @click="openProfile(row.characterId)"><Avatar :asset-id="row.avatarAssetId" :name="row.name" :size="44" /></button>
              <button type="button" class="pui-x__followrow-id pui-x__follow-name-link" :aria-label="'查看' + row.name + '的主页'" @click="openProfile(row.characterId)">
                <span class="pui-x__name">{{ row.name }}</span>
                <span v-if="row.handle" class="pui-x__handle">@{{ row.handle }}</span>
              </button>
            </li>
          </ul>
          <EmptyState
            v-else
            icon="chat"
            :title="followEmpty.title"
            :description="followEmpty.description"
          />
        </ScrollArea>
      </section>

      <!-- ══ 个人主页（自己的 / 别人的共用一屏，靠 isOwnProfile 分按钮行） ══ -->
      <section
        v-else
        key="profile"
        class="pui-x__screen pui-x__screen--profile"
        data-testid="x-profile-screen"
        :data-profile-owner="isOwnProfile ? 'true' : 'false'"
        :data-header-collapsed="headerCollapsed ? 'true' : 'false'"
      >
        <!-- ══ 固定顶栏 ══
             没上滑时只有三颗透明底的圆形按钮浮在横幅上（横幅从它下面穿过去）；
             上滑把资料块整块滚走之后，铺一层「个人背景的模糊副本」+ 名字/帖子数，
             回到真机那种「滚动后顶部还剩一条半透明标题栏」的样子。
             底透明 = pointer-events: none，别让它挡住横幅上的点按。 -->
        <header
          class="pui-x__ptop"
          :data-collapsed="headerCollapsed ? 'true' : 'false'"
          :data-has-banner="profileBannerUrl ? 'true' : 'false'"
        >
          <span class="pui-x__ptop-bg" aria-hidden="true">
            <img v-if="profileBannerUrl" class="pui-x__ptop-blur" :src="profileBannerUrl" alt="" />
            <span class="pui-x__ptop-scrim"></span>
          </span>

          <div class="pui-x__ptop-row">
            <button type="button" class="pui-x__round" data-testid="nav-back" aria-label="返回" @click="goBack">
              <svg viewBox="0 0 24 24"><path d="M14.5 5.5L8 12l6.5 6.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
            </button>

            <div class="pui-x__ptop-id">
              <span class="pui-x__ptop-name" data-testid="x-profile-topbar-name">{{ profileName }}</span>
              <span class="pui-x__ptop-sub" data-testid="x-profile-topbar-count">{{ profilePostCountLabel }}</span>
            </div>

            <div class="pui-x__ptop-actions">
              <span v-feedback="'搜索用户帖子'" class="pui-x__round">
                <svg viewBox="0 0 24 24"><path d="M10.25 3.75c-3.59 0-6.5 2.91-6.5 6.5s2.91 6.5 6.5 6.5c1.795 0 3.419-.726 4.596-1.904 1.178-1.177 1.904-2.801 1.904-4.596 0-3.59-2.91-6.5-6.5-6.5zm-8.5 6.5c0-4.694 3.806-8.5 8.5-8.5s8.5 3.806 8.5 8.5c0 1.986-.682 3.815-1.824 5.262l4.781 4.781-1.414 1.414-4.781-4.781c-1.447 1.142-3.276 1.824-5.262 1.824-4.694 0-8.5-3.806-8.5-8.5z" fill="currentColor" /></svg>
              </span>
              <span v-feedback="'更多'" class="pui-x__round">
                <svg viewBox="0 0 24 24"><circle cx="6" cy="12" r="1.7" fill="currentColor" /><circle cx="12" cy="12" r="1.7" fill="currentColor" /><circle cx="18" cy="12" r="1.7" fill="currentColor" /></svg>
              </span>
              <!-- 收起后不放「关注」胶囊：真机上滑只是把资料块整块顶出去，
                   顶栏只留返回 / 名字 / 搜索 / 更多；关注按钮仍只在资料块里 -->
            </div>
          </div>
        </header>

        <!-- 横幅 / 头像 / 资料 / tab 条 / 时间线全在同一个滚动区里：
             上滑时资料块跟着手指走，tab 条黏在顶栏下沿（sticky）。
             内容不够一屏（回复/媒体没几条）时，min-scroll 保底：资料块照样
             能整块顶出去、tab 吸住，空白留在时间线下面，不卡在半路。 -->
        <ScrollArea
          ref="profileScroller"
          :scroll-key="`x:profile:${profileTab}`"
          padding-bottom="8"
          :fade="false"
          :min-scroll="profileMinScroll"
          @scroll="updateProfileCollapse"
        >
          <div class="pui-x__banner" :data-has-banner="profileBannerUrl ? 'true' : 'false'">
            <img
              v-if="profileBannerUrl"
              class="pui-x__banner-img"
              :src="profileBannerUrl"
              alt=""
              data-testid="x-profile-banner"
            />
            <span v-if="profileBannerUrl" class="pui-x__banner-scrim" aria-hidden="true"></span>
          </div>

          <!-- 一开始上滑，头像就缩小 + 渐隐（不是等资料块整块滚走才消失） -->
          <div
            class="pui-x__profile-avatar-row"
            :data-avatar-gone="avatarGone ? 'true' : 'false'"
            data-testid="x-profile-avatar-row"
          >
            <Avatar :asset-id="profileAvatarAssetId" :name="profileName" :size="82" />
          </div>

          <div class="pui-x__profile-info">
            <h1 class="pui-x__profile-name" data-testid="x-profile-name">{{ profileName }}</h1>
            <p v-if="profileHandle" class="pui-x__profile-handle">@{{ profileHandle }}</p>
            <p v-if="profileBio" class="pui-x__profile-bio">{{ profileBio }}</p>

            <p v-if="profileLocation || profileJoinedLabel" class="pui-x__profile-meta">
              <span v-if="profileLocation" class="pui-x__meta-item">
                <svg viewBox="0 0 24 24"><path d="M12 21c4-3.6 6-7.1 6-10a6 6 0 10-12 0c0 2.9 2 6.4 6 10z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" /><circle cx="12" cy="10.8" r="2.2" fill="none" stroke="currentColor" stroke-width="1.7" /></svg>
                {{ profileLocation }}
              </span>
              <span v-if="profileJoinedLabel" class="pui-x__meta-item">
                <svg viewBox="0 0 24 24"><rect x="3.8" y="5.5" width="16.4" height="14" rx="2.6" fill="none" stroke="currentColor" stroke-width="1.7" /><path d="M8 3.5v4M16 3.5v4M3.8 10h16.4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" /></svg>
                {{ profileJoinedLabel }}
              </span>
            </p>

            <p v-if="profileCounts" class="pui-x__profile-counts">
              <button type="button" class="pui-x__countbtn" data-testid="x-profile-following-count" aria-label="查看正在关注列表" @click="openFollow('following')"><b>{{ profileCounts.following }}</b> 正在关注</button>
              <button type="button" class="pui-x__countbtn" data-testid="x-profile-followers-count" aria-label="查看关注者列表" @click="openFollow('followers')"><b>{{ profileCounts.followers }}</b> 关注者</button>
            </p>

            <div v-if="isOwnProfile" class="pui-x__profile-buttons">
              <span v-feedback="'分享个人主页'" class="pui-x__profile-btn" data-testid="x-profile-share">分享</span>
              <span v-feedback="'编辑个人资料'" class="pui-x__profile-btn pui-x__profile-btn--primary" data-testid="x-profile-edit">编辑个人资料</span>
            </div>
            <div v-else class="pui-x__profile-buttons">
              <span
                v-if="profileFollowState === 'none'"
                class="pui-x__profile-btn pui-x__profile-btn--primary"
                data-testid="x-profile-follow"
              >关注</span>
              <span v-else class="pui-x__profile-btn" data-testid="x-profile-follow">关注中</span>
              <span class="pui-x__profile-btn" data-testid="x-profile-message">发消息</span>
            </div>
          </div>

          <nav ref="profileTabs" class="pui-x__profile-tabs" aria-label="主页内容">
            <button
              v-for="tab in PROFILE_TABS"
              :key="tab.id"
              type="button"
              class="pui-x__ptab"
              :class="{ 'pui-x__ptab--on': profileTab === tab.id }"
              :data-testid="`x-tab-${tab.id}`"
              :aria-label="tab.label"
              @click="profileTab = tab.id"
            >
              <svg v-if="tab.icon === 'list'" viewBox="0 0 24 24"><path d="M5 6.5h14M5 11.5h14M5 16.5h9" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" /></svg>
              <svg v-else-if="tab.icon === 'reply'" viewBox="0 0 24 24"><path d="M12 3.8A8.5 7.45 0 0 0 6.6 17L5.4 20l4.2-1.6A8.5 7.45 0 0 0 20.5 11.25A8.5 7.45 0 0 0 12 3.8z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" /></svg>
              <svg v-else-if="tab.icon === 'media'" viewBox="0 0 24 24"><rect x="3.5" y="5.5" width="17" height="13" rx="2.6" fill="none" stroke="currentColor" stroke-width="1.7" /><path d="M4.5 17l4.6-4 3.4 2.6 2.7-2 4.3 3.4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" /></svg>
              <svg v-else viewBox="0 0 24 24"><path d="M12 20.4c-.6 0-1.1-.2-1.5-.6l-6-5.6C2.4 12.3 2.5 9 4.6 7.2c1.8-1.5 4.4-1.1 5.8.7L12 9.4l1.6-1.5c1.4-1.8 4-2.2 5.8-.7 2.1 1.8 2.2 5.1.1 7l-6 5.6c-.4.4-.9.6-1.5.6z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" /></svg>
            </button>
          </nav>

          <ul v-if="profileItems.length" class="pui-x__feed">
            <li v-for="item in profileItems" :key="item.id" :class="{ 'pui-x__reply-pair': profileTab === 'replies' }">
              <XPostItem v-if="profileTab === 'replies' && item.replyContext" class="pui-x__reply-context" :item="item.replyContext" @open="openPost" @search="startSearch" @open-image="openImage" @open-author="openProfile" />
              <XPostItem
                :item="item"
                :show-repost="item.xRepostByCharacterIds?.includes(profileCharacterId) && profileTab === 'posts'"
                :repost-character-id="profileCharacterId"
                :repost-name="profileName"
                :owner-character-id="ownerCharacterId"
                @open="openPost" @search="startSearch"
                @open-image="openImage"
                @open-author="openProfile"
              />
            </li>
          </ul>
          <EmptyState
            v-else
            icon="chat"
            :title="profileEmpty.title"
            :description="profileEmpty.description"
          />
        </ScrollArea>

        <span v-feedback="'发帖'" class="pui-x__fab pui-x__fab--profile" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" /></svg>
        </span>
      </section>
    </Transition>
  </div>
</template>

<style src="./XApp.css"></style>
