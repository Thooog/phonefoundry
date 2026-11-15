<!--
  一条 X 帖子（时间线 / 个人主页共用）。

  为什么单独拆出来：首页与个人主页的行长得一模一样，抄两份迟早会漂移
  （改一处忘另一处）。这里只负责"一条帖子怎么画"，点击交给父级决定去哪。

  metrics 可能为 null（个人主页的回复列表没有互动数据）——此时只画图标不画数字，
  不编造计数。这是本项目的一条硬规则：没有数据就不显示，而不是补 0。
-->
<script setup>
import { computed, ref, inject } from 'vue'
import Avatar from '../../appkit/Avatar.vue'
import { useWorkData } from '../../kernel/create-runtime.js'
import XPostMedia from './XPostMedia.vue'
import XPostText from './XPostText.vue'
import { vFeedback } from './feedback.js'

const props = defineProps({
  item: { type: Object, required: true },
  repostCharacterId: { type: String, default: null },
  repostName: { type: String, default: '' },
  showRepost: { type: Boolean, default: false },
  ownerCharacterId: { type: String, default: null },
})

const localActions = inject('x-local-actions', null)
const item = computed(() => localActions?.present(props.item) ?? props.item)
const emit = defineEmits(['open', 'open-image', 'open-author', 'search'])

const { resolveAsset, getWork } = useWorkData()
const accounts = computed(() => (getWork()?.platformAccounts ?? []).filter((account) => account.platform === 'x' && account.characterId))

/** 头像 / 名字条 → 这个人的主页；点卡片其它地方才是打开帖子（真机分工） */
function openAuthor() {
  if (props.item.authorCharacterId) emit('open-author', props.item.authorCharacterId)
}

const mediaIds = computed(() => props.item.mediaAssetIds ?? [])

/** 多图滑动带当前停在第几页（XPostMedia 上报）。不在第 0 页时头像缩小给图让位。 */
const mediaPage = ref(0)

function resolveMedia(id) {
  try {
    return resolveAsset(id) || ''
  } catch {
    return ''
  }
}

/** 计数为 "0" 时不显示数字（真机也是把 0 藏起来的） */
function countOf(value) {
  if (value == null) return ''
  const text = String(value)
  return text === '0' ? '' : text
}
</script>

<template>
  <article class="pui-xp" data-testid="x-post-item" @click="$emit('open', item)">
    <div v-if="showRepost && repostCharacterId" class="pui-xp__activity" @click.stop="$emit('open-author', repostCharacterId)">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 3.88l4.432 4.14-1.364 1.46L5.5 7.55V16c0 1.1.896 2 2 2H13v2H7.5c-2.209 0-4-1.79-4-4V7.55L1.432 9.48.068 8.02 4.5 3.88zM16.5 6H11V4h5.5c2.209 0 4 1.79 4 4v8.45l2.068-1.93 1.364 1.46-4.432 4.14-4.432-4.14 1.364-1.46 2.068 1.93V8c0-1.1-.896-2-2-2z" fill="currentColor" stroke="none" /></svg>

      {{ repostCharacterId === ownerCharacterId ? '你' : repostName }} 已转帖
    </div>
    <Avatar
      :asset-id="item.authorAvatarAssetId"
      :name="item.authorName"
      :size="mediaPage > 0 ? 28 : 40"
      data-testid="x-post-avatar"
      @click.stop="openAuthor"
    />

    <div class="pui-xp__body">
      <div class="pui-xp__head">
        <span class="pui-xp__name" data-testid="x-post-name" @click.stop="openAuthor">{{ item.authorName }}</span>
        <span v-if="item.authorHandle" class="pui-xp__handle" data-testid="x-post-handle" @click.stop="openAuthor">@{{ item.authorHandle }}</span>
        <span v-if="item.timeLabel" class="pui-xp__time">· {{ item.timeLabel }}</span>
        <span class="pui-xp__grow"></span>
        <span class="pui-xp__dots" aria-hidden="true">
          <svg viewBox="0 0 24 24"><circle cx="6" cy="12" r="1.6" fill="currentColor" /><circle cx="12" cy="12" r="1.6" fill="currentColor" /><circle cx="18" cy="12" r="1.6" fill="currentColor" /></svg>
        </span>
      </div>

      <!-- 个人主页「回复」tab：带上被回复帖子的摘要，否则看不懂在回谁 -->
      <p v-if="item.parentPreview" class="pui-xp__context">回复：{{ item.parentPreview }}</p>

      <p v-if="item.content" class="pui-xp__text"><XPostText v-if="!item.parentId" :text="item.content" :accounts="accounts" @search="emit('search',$event)" @open-account="emit('open-author',$event)" /><template v-else>{{ item.content }}</template></p>

      <!--
        多图：整宽滑动带 —— 负 margin 冲出正文列（左 67 = 卡片padding16 + 头像40 + gap11，
        右 16 = 卡片padding），带子顶到卡片左右边缘，整条都能按住拖；
        inset 变量让第一张图仍与正文左对齐。单图维持原样（正文列内的圆角卡片）。
      -->
      <div
        v-if="mediaIds.length"
        class="pui-xp__mediaband"
        :class="{ 'pui-xp__mediaband--bleed': mediaIds.length > 1 }"
      >
        <XPostMedia
          :media-asset-ids="mediaIds"
          :resolve-src="resolveMedia"
          :bordered="true"
          testid="x-post-media"
          @open-image="$emit('open-image', { item, index: $event })"
          @page="mediaPage = $event"
        />
      </div>

      <div class="pui-xp__actions">
        <span v-feedback="'回复'" class="pui-xp__act">
          <svg viewBox="0 0 24 24"><path d="M1.751 10c0-4.42 3.584-8 8.005-8h4.366c4.49 0 8.129 3.64 8.129 8.13 0 2.96-1.607 5.68-4.196 7.11l-8.054 4.46v-3.69h-.067c-4.49.1-8.183-3.51-8.183-8.01zm8.005-6c-3.317 0-6.005 2.69-6.005 6 0 3.37 2.77 6.08 6.138 6.01l.351-.01h1.761v2.3l5.087-2.81c1.951-1.08 3.163-3.13 3.163-5.36 0-3.39-2.744-6.13-6.129-6.13H9.756z" fill="currentColor" /></svg>
          <span v-if="countOf(item.metrics?.replies)" class="pui-xp__count" :title="countOf(item.metrics.replies)">{{ countOf(item.metrics.replies) }}</span>
        </span>

        <span v-feedback="'转帖'" class="pui-xp__act pui-xp__act--repost" :class="{ 'is-reposted': item.repostedByOwner }" @click.stop="localActions?.toggle(props.item, 'repostedByOwner')">
          <svg viewBox="0 0 24 24"><path d="M4.5 3.88l4.432 4.14-1.364 1.46L5.5 7.55V16c0 1.1.896 2 2 2H13v2H7.5c-2.209 0-4-1.79-4-4V7.55L1.432 9.48.068 8.02 4.5 3.88zM16.5 6H11V4h5.5c2.209 0 4 1.79 4 4v8.45l2.068-1.93 1.364 1.46-4.432 4.14-4.432-4.14 1.364-1.46 2.068 1.93V8c0-1.1-.896-2-2-2z" fill="currentColor" /></svg>
          <span v-if="countOf(item.metrics?.reposts)" class="pui-xp__count" :title="countOf(item.metrics.reposts)">{{ countOf(item.metrics.reposts) }}</span>
        </span>

        <span v-feedback="'点赞'" class="pui-xp__act pui-xp__act--like" :class="{ 'is-liked': item.likedByOwner }" @click.stop="localActions?.toggle(props.item, 'likedByOwner')">
          <svg viewBox="0 0 24 24"><path :d="item.likedByOwner ? 'M12 21s-9-5.3-9-12a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 6.7-9 12-9 12Z' : 'M16.697 5.5c-1.222-.06-2.679.51-3.89 2.16l-.805 1.09-.806-1.09C9.984 6.01 8.526 5.44 7.304 5.5c-1.243.07-2.349.78-2.91 1.91-.552 1.12-.633 2.78.479 4.82 1.074 1.97 3.257 4.27 7.129 6.61 3.87-2.34 6.052-4.64 7.126-6.61 1.111-2.04 1.03-3.7.477-4.82-.561-1.13-1.666-1.84-2.908-1.91zm4.187 7.69c-1.351 2.48-4.001 5.12-8.379 7.67l-.503.3-.504-.3c-4.379-2.55-7.029-5.19-8.382-7.67-1.36-2.5-1.41-4.86-.514-6.67.887-1.79 2.647-2.91 4.601-3.01 1.651-.09 3.368.56 4.798 2.01 1.429-1.45 3.146-2.1 4.796-2.01 1.954.1 3.714 1.22 4.601 3.01.896 1.81.846 4.17-.514 6.67z'" fill="currentColor" /></svg>
          <span v-if="countOf(item.metrics?.likes)" class="pui-xp__count" :title="countOf(item.metrics.likes)">{{ countOf(item.metrics.likes) }}</span>
        </span>

        <span v-feedback="'查看浏览数据'" class="pui-xp__act">
          <svg viewBox="0 0 24 24"><path d="M8.75 21V3h2v18h-2zM18 21V8.5h2V21h-2zM4 21l.004-10h2L6 21H4zm9.248 0v-7h2v7h-2z" fill="currentColor" /></svg>
          <span v-if="countOf(item.metrics?.views)" class="pui-xp__count" :title="countOf(item.metrics.views)">{{ countOf(item.metrics.views) }}</span>
        </span>

        <span v-feedback="'收藏'" class="pui-xp__act">
          <svg viewBox="0 0 24 24"><path d="M4 4.5C4 3.12 5.119 2 6.5 2h11C18.881 2 20 3.12 20 4.5v18.44l-8-5.71-8 5.71V4.5zM6.5 4c-.276 0-.5.22-.5.5v14.56l6-4.29 6 4.29V4.5c0-.28-.224-.5-.5-.5h-11z" fill="currentColor" /></svg>
        </span>

        <span v-feedback="'分享'" class="pui-xp__act">
          <svg viewBox="0 0 24 24"><path d="M12 2.59l5.7 5.7-1.41 1.42L13 6.41V16h-2V6.41l-3.3 3.3-1.41-1.42L12 2.59zM21 15l-.02 3.51c0 1.38-1.12 2.49-2.5 2.49H5.5C4.11 21 3 19.88 3 18.5V15h2v3.5c0 .28.22.5.5.5h12.98c.28 0 .5-.22.5-.5L19 15h2z" fill="currentColor" /></svg>
        </span>
      </div>
    </div>
  </article>
</template>

<style>
.pui-xp {
  display: flex;
  flex-wrap: wrap;
  gap: 11px;
  padding: 12px 16px;
  border-bottom: 1px solid #eff3f4;
  background: #fff;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.pui-xp__activity{display:flex;align-items:center;gap:8px;flex-basis:100%;padding-left:25px;color:#536471;font-size:13px;line-height:1.4;font-weight:600}
.pui-xp__activity svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.pui-xp:active {
  background: #f7f9f9;
}

/* 翻动多图带时头像缩小（40→28）：flex 顶对齐，锚点在上方不动，底部抬起
   给滑到左缘的图片让出空间；松手停稳后由 XPostMedia 的静默计时器弹回 */
.pui-xp > .pui-avatar {
  transition: width 0.16s ease, height 0.16s ease;
}

.pui-xp__body {
  display: flex;
  flex: 1 1 0%;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.pui-xp__head {
  display: flex;
  align-items: baseline;
  gap: 5px;
  min-width: 0;

  transform: translateY(1px);
}

.pui-xp__name {
  flex: 0 1 auto;
  font-size: 0.9375rem;
  font-weight: 700;
  color: #0f1419;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pui-xp__handle {
  flex: 0 1 auto;
  font-size: 0.9375rem;
  color: #536471;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pui-xp__time {
  flex: none;
  font-size: 0.9375rem;
  color: #536471;
  white-space: nowrap;
}

.pui-xp__grow {
  flex: 1 1 auto;
}

.pui-xp__dots {
  flex: none;
  display: inline-flex;
  color: #536471;
}

.pui-xp__dots svg {
  width: 17px;
  height: 17px;
}

.pui-xp__context {
  margin: 4px 0 0;
  font-size: 0.8125rem;
  color: #536471;
}

.pui-xp__text {
  margin: 2px 0 0;
  font-size: 0.9375rem;
  line-height: 1.38;
  color: #0f1419;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

/* 多图滑动带：冲出正文列，顶到卡片左右边缘（几何值与 .pui-xp 的 padding/gap 对应） */
.pui-xp__mediaband--bleed {
  --xm-inset-l: 67px;
  --xm-inset-r: 16px;
  margin: 4px -16px 0 -67px;
}

.pui-xp__actions {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr)) 28px 28px;
  align-items: center;
  gap: 2px;
  margin-top: 10px;
  margin-left: -3px;
}

.pui-xp__act {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  gap: 3px;
  padding: 3px;
  border-radius: 999px;
  color: #536471;
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
}

.pui-xp__count{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.pui-xp__act:nth-last-child(-n+2){justify-content:center}
.pui-xp__act svg {
  flex: none;
  width: 18px;
  height: 18px;
}

.pui-xp__act--repost {
  /* 真机上转帖/点赞在按下时变色；这里只保留静态色，按压反馈交给整行的 :active */
  color: #536471;
}
.pui-xp__act--like.is-liked{color:#f91880}
.pui-xp__act--like.is-liked svg path{fill:currentColor;stroke:currentColor}
.pui-xp__act--repost.is-reposted{color:#00ba7c}
.pui-xp__act:is(:active,.x-feedback--pressed){opacity:.5}
.pui-xp:has(.pui-xp__act:is(:active,.x-feedback--pressed)){background:#fff}
</style>
