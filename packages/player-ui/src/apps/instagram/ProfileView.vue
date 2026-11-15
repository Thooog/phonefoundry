<!--
  个人主页视图 —— 自己的主页（底部 tab）与他人主页（运行时栈里的一屏）共用同一套骨架，
  只靠 profile.isOwner 决定按钮行与顶栏图标。

  为什么抽成独立组件：Instagram 主页既是常驻 tab（自己）又是可被压栈的一屏（他人），
  两份渲染点如果各写一遍这段 ~70 行的结构，迟早会漂移到不一致。这里只写一次。

  顶栏：自己 → 左「+」右「菜单」（无返回键，tab 之间直接切）；
        他人 → 左「返回」右「铃铛」（返回键由父级 pop 栈）。
-->
<script setup>
import { vFeedback } from '../x/feedback.js'
import { computed, ref } from 'vue'
import Avatar from '../../appkit/Avatar.vue'
import EmptyState from '../../appkit/EmptyState.vue'
import ScrollArea from '../../appkit/ScrollArea.vue'
import { useWorkData } from '../../kernel/create-runtime.js'

const props = defineProps({
  profile: { type: Object, required: true },
  /** 滚动记忆键（自己 = 'me'，他人 = characterId），避免两屏串位置 */
  scrollKey: { type: String, default: '' },
  /**
   * 是否显示返回键。默认按「是不是本人」判断（tab 版自己 = 无返回，tab 版他人 = 有返回）。
   * 栈里的自己主页要传 true：它已被压栈、底栏让位，必须有一个系统返回键，
   * 否则顶栏是 tab 版式（无返回）而页面已在栈里，用户会卡住。
   */
  showBack: { type: Boolean, default: undefined },
})
const emit = defineEmits(['open-post', 'open-story', 'open-follow', 'back', 'home'])

/** 是否显示返回键：显式传参优先，否则退回「非本人」的 tab 语义 */
const isBack = computed(() => (props.showBack !== undefined ? props.showBack : !props.profile.isOwner))

const { resolveAsset } = useWorkData()
function resolveSrc(assetId) {
  return assetId ? resolveAsset(assetId) ?? '' : ''
}

/** 主页 tab：帖子是实数据，Reels/标记没有对应模型，摆出来但不可点 */
const profileTab = ref('posts')
</script>

<template>
  <div class="pui-ig__profile-wrap">
    <header class="pui-ig__subbar">
      <button
        v-if="isBack"
        type="button"
        class="pui-ig__back"
        data-testid="nav-back"
        aria-label="返回"
        @click="emit('back')"
      >
        <svg viewBox="0 0 24 24"><path d="M14.5 5.5L8 12l6.5 6.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
      </button>
      <span v-else v-feedback="'新增'" class="pui-ig__topbar-icon">
        <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
      </span>
      <!-- 自己的主页（tab 版）：标题就是回桌面入口（与首页字标同规则）；
           栈里（有返回键）或他人主页：标题是纯文本，不可点 -->
      <button
        v-if="profile.isOwner && !isBack"
        type="button"
        class="pui-ig__subbar-title pui-ig__subbar-title--handle pui-ig__subbar-title--link"
        data-testid="ig-profile-logo"
        aria-label="回到桌面"
        @click="emit('home')"
      >
        {{ profile.handle || profile.name }}
      </button>
      <h1 v-else class="pui-ig__subbar-title pui-ig__subbar-title--handle">
        {{ profile.handle || profile.name }}
      </h1>
      <span v-feedback="'菜单'" class="pui-ig__topbar-icon">
        <svg v-if="!profile.isOwner || isBack" viewBox="0 0 24 24"><path d="M12 3.4c-3.6 0-6 2.7-6 6.2 0 3.6-1 5.1-1.8 6.1-.3.4 0 1 .5 1h14.6c.5 0 .8-.6.5-1-.8-1-1.8-2.5-1.8-6.1 0-3.5-2.4-6.2-6-6.2z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" /><path d="M9.8 19.6a2.3 2.3 0 004.4 0" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" /></svg>
        <svg v-else viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
      </span>
    </header>

    <ScrollArea :scroll-key="scrollKey" padding-bottom="8" :fade="false">
      <div class="pui-ig__profile">
        <div class="pui-ig__profile-statrow">
          <div class="pui-ig__profile-avatar">
            <span class="pui-ig__profile-avatar-ring" aria-hidden="true">
              <Avatar :asset-id="profile.avatarAssetId" :name="profile.name" :size="86" />
            </span>
            <span v-if="profile.isOwner" class="pui-ig__profile-avatar-add" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" /></svg>
            </span>
          </div>
          <div class="pui-ig__profile-info">
            <p class="pui-ig__profile-name">{{ profile.displayName || profile.name }}</p>
            <div class="pui-ig__profile-stats">
              <span class="pui-ig__profile-stat"><b>{{ profile.stats.posts }}</b>帖子</span>
              <!-- 粉丝 / 关注跳真实关系列表页；帖子数没有对应列表，保持纯展示 -->
              <button
                v-if="profile.stats.followers"
                type="button"
                class="pui-ig__profile-stat pui-ig__profile-stat--link"
                data-testid="ig-profile-followers"
                aria-label="查看粉丝列表"
                @click="emit('open-follow', 'followers')"
              >
                <b>{{ profile.stats.followers }}</b>粉丝
              </button>
              <button
                v-if="profile.stats.following"
                type="button"
                class="pui-ig__profile-stat pui-ig__profile-stat--link"
                data-testid="ig-profile-following"
                aria-label="查看关注列表"
                @click="emit('open-follow', 'following')"
              >
                <b>{{ profile.stats.following }}</b>关注
              </button>
            </div>
          </div>
        </div>

        <p v-if="profile.bio" class="pui-ig__profile-bio">{{ profile.bio }}</p>
        <p v-if="profile.link" class="pui-ig__profile-link">{{ profile.link }}</p>

        <!-- 按钮行：自己是编辑/分享，他人是已关注/发消息/加好友 -->
        <div class="pui-ig__profile-btns">
          <template v-if="profile.isOwner">
            <span v-feedback="'编辑个人资料'" class="pui-ig__profile-btn">编辑个人资料</span>
            <span v-feedback="'分享个人资料'" class="pui-ig__profile-btn">分享个人资料</span>
          </template>
          <template v-else>
            <span class="pui-ig__profile-btn pui-ig__profile-btn--primary">已关注</span>
            <span class="pui-ig__profile-btn">发消息</span>
            <span class="pui-ig__profile-btn pui-ig__profile-btn--icon" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
            </span>
          </template>
        </div>

        <div v-if="profile.isOwner" class="pui-ig__pstory" data-testid="ig-profile-story-row">
          <span v-feedback="'新增快拍'" class="pui-ig__tray-item">
            <span class="pui-ig__pstory-add">
              <svg viewBox="0 0 24 24"><path d="M12 4.5v15M4.5 12h15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" /></svg>
            </span>
            <span class="pui-ig__tray-name">新增</span>
          </span>
          <button
            v-for="group in profile.storyGroups"
            :key="group.key"
            type="button"
            class="pui-ig__tray-item"
            data-testid="ig-profile-story"
            :aria-label="`查看我的快拍（${group.frames.length} 帧）`"
            @click="emit('open-story', group.key)"
          >
            <span class="pui-ig__pstory-ring">
              <img
                v-if="group.frames[0]?.imageAssetId"
                class="pui-ig__pstory-img"
                :src="resolveSrc(group.frames[0].imageAssetId)"
                alt=""
              />
              <Avatar v-else :asset-id="profile.avatarAssetId" :name="profile.name" :size="59" />
            </span>
            <span class="pui-ig__tray-name">快拍</span>
          </button>
        </div>

        <!-- Highlights：数据模型里没有归档集合，整行不出现而不是摆空环 -->
        <div class="pui-ig__profile-tabs">
          <span class="pui-ig__profile-tab pui-ig__profile-tab--on">
            <svg viewBox="0 0 24 24" aria-label="帖子"><rect v-for="n in 9" :key="n" :x="3 + ((n - 1) % 3) * 6.5" :y="3 + Math.floor((n - 1) / 3) * 6.5" width="5" height="5" rx="1" fill="currentColor" /></svg>
          </span>
          <span v-feedback="'切换内容'" class="pui-ig__profile-tab">
            <svg viewBox="0 0 24 24" aria-label="Reels"><rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" stroke-width="2" /><path d="m10 7.5 7 4.5-7 4.5Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" /></svg>
          </span>
          <span v-feedback="'切换内容'" class="pui-ig__profile-tab">
            <svg viewBox="0 0 24 24" aria-label="人物标记"><path d="M8 4 10 2h4l2 2h2a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" /><circle cx="12" cy="10" r="3" fill="none" stroke="currentColor" stroke-width="2" /><path d="M6.5 20a5.5 5.5 0 0 1 11 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
          </span>
        </div>

        <div v-if="profileTab === 'posts'" class="pui-ig__grid" data-testid="ig-grid">
          <button
            v-for="cell in profile.grid"
            :key="cell.postId"
            type="button"
            class="pui-ig__cell"
            @click="emit('open-post', cell.postId)"
          >
            <img v-if="cell.coverAssetId" class="pui-ig__cell-img" :src="resolveSrc(cell.coverAssetId)" alt="" />
            <span v-else class="pui-ig__cell-img pui-ig__cell-img--text">{{ '文字帖' }}</span>
            <svg v-if="cell.mediaCount > 1" viewBox="0 0 24 24" class="pui-ig__cell-stack" aria-label="多图"><rect x="8" y="3.5" width="12" height="12" rx="2" fill="none" stroke="#fff" stroke-width="1.8" /><rect x="3.5" y="8" width="12" height="12" rx="2" fill="#1a1a1a" stroke="#fff" stroke-width="1.8" /></svg>
          </button>
        </div>
        <EmptyState
          v-if="profile.grid.length === 0"
          icon="chat"
          title="还没有帖子"
        />
      </div>
    </ScrollArea>
  </div>
</template>
