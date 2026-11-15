<script setup>
const props = defineProps({ controller: { type: Object, required: true } })
const { viewerItem, viewerSrcs, viewerIndex, viewerStamp, closeViewer, showViewerIndex, onViewerDown, onViewerMove, onViewerUp, thumbsEl, viewerStripStyle } = props.controller
</script>
<template>
  <Transition name="pui-msg-viewer">
    <div v-if="viewerItem" class="pui-msg__viewer" data-testid="msg-media-viewer">
      <!-- 舞台铺满整屏、图片按原比例居中（contain）：竖图顶到上下边缘，
             宽图上下留白 —— 两种都和真机一致。多图时整条 strip 横排，左右滑翻页。 -->
      <div
        class="pui-msg__viewer-stage"
        :data-multi="viewerSrcs.length > 1 ? 'true' : 'false'"
        @pointerdown="onViewerDown"
        @pointermove="onViewerMove"
        @pointerup="onViewerUp"
        @pointercancel="onViewerUp"
      >
        <div class="pui-msg__viewer-strip" :style="viewerStripStyle">
          <div v-for="(src, i) in viewerSrcs" :key="i" class="pui-msg__viewer-slide">
            <img
              class="pui-msg__viewer-image"
              :data-testid="i === viewerIndex ? 'msg-viewer-image' : `msg-viewer-slide-${i}`"
              :src="src"
              alt=""
              draggable="false"
            />
          </div>
        </div>
      </div>

      <header class="pui-msg__viewer-bar">
        <button
          type="button"
          class="pui-msg__viewer-back"
          data-testid="msg-viewer-close"
          aria-label="关闭图片"
          @click="closeViewer"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 5.5L8 12l6.5 6.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </button>
        <div class="pui-msg__viewer-meta">
          <span class="pui-msg__viewer-name" data-testid="msg-viewer-name">{{ viewerItem.authorName }}</span>
          <span class="pui-msg__viewer-stamp">{{ viewerStamp(viewerItem) }}</span>
        </div>
      </header>

      <div class="pui-msg__viewer-foot">
        <!-- 多图才有多图的东西：单图不摆一条只有一张的缩略图条 -->
        <div v-if="viewerSrcs.length > 1" class="pui-msg__viewer-album">
          <div ref="thumbsEl" class="pui-msg__viewer-thumbs" data-testid="msg-viewer-thumbs">
            <button
              v-for="(src, i) in viewerSrcs"
              :key="i"
              type="button"
              class="pui-msg__viewer-thumb"
              :class="{ 'pui-msg__viewer-thumb--on': i === viewerIndex }"
              :data-testid="`msg-viewer-thumb-${i}`"
              :aria-label="`第 ${i + 1} 张`"
              @click="showViewerIndex(i)"
            >
              <img :src="src" alt="" />
            </button>
          </div>
          <p class="pui-msg__viewer-count" data-testid="msg-viewer-count">
            第 {{ viewerIndex + 1 }} 张，共 {{ viewerSrcs.length }} 张
          </p>
        </div>
      </div>
    </div>
  </Transition>
</template>
<style>
.pui-msg__viewer {
  position: absolute;
  inset: 0;
  /* 必须压过信息自身的悬浮顶栏（--pui-z-navbar: 40）：否则点开大图后
     顶栏盖在上面，查看器自己的关闭键被遮、顶部还会误触会话「返回」。
     用模态覆盖级别（60），与 PasscodePad 同档。 */
  z-index: var(--pui-z-overlay);
  display: flex;
  flex-direction: column;
  background: #fff;
}

.pui-msg__viewer-stage {
  position: absolute;
  inset: 0;
  overflow: hidden;
  /* 横向手势归 JS（翻页），别让浏览器拿去当页面平移；查看器本身没有可滚动内容 */
  touch-action: none;
}

.pui-msg__viewer-stage[data-multi='true'] {
  cursor: grab;
}

.pui-msg__viewer-stage[data-multi='true']:active {
  cursor: grabbing;
}

/* strip 宽度就是屏宽（stage 里的块级 flex 容器），所以 -index * 100% 正好一屏一格 */
.pui-msg__viewer-strip {
  display: flex;
  height: 100%;
  will-change: transform;
}

.pui-msg__viewer-slide {
  flex: 0 0 100%;
  height: 100%;
  display: grid;
  place-items: center;
}

/* contain 而不是 cover：查看器是用来"看清楚"的，裁掉边缘就失去意义 */
.pui-msg__viewer-image {
  display: block;
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  user-select: none;
  -webkit-user-drag: none;
}

/* 顶栏白底深字，压在图上时有极淡的下分隔（区别于 KT 黑底渐变条） */
.pui-msg__viewer-bar {
  position: relative;
  z-index: 1;
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: calc(var(--pui-statusbar-h) + 8px) 14px 10px;
  background: #fff;
  border-bottom: 0.5px solid rgba(0, 0, 0, 0.08);
}

.pui-msg__viewer-back {
  flex: none;
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  margin-left: -6px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--pui-label);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.pui-msg__viewer-back svg {
  width: 24px;
  height: 24px;
}

.pui-msg__viewer-back:active {
  opacity: 0.5;
}

.pui-msg__viewer-meta {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.pui-msg__viewer-name {
  font-size: 1.0625rem;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--pui-label);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pui-msg__viewer-stamp {
  font-size: 0.75rem;
  color: var(--pui-label-2);
  font-variant-numeric: tabular-nums;
}

/* 底栏白底深字，缩略图条与计数都在这里 */
.pui-msg__viewer-foot {
  position: relative;
  z-index: 1;
  margin-top: auto;
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 10px 0 calc(10px + var(--pui-homebar-h, 0px));
  background: #fff;
  border-top: 0.5px solid rgba(0, 0, 0, 0.08);
}

.pui-msg__viewer-album {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.pui-msg__viewer-thumbs {
  display: flex;
  gap: 6px;
  padding: 0 14px;
  overflow-x: auto;
  scrollbar-width: none;
}

.pui-msg__viewer-thumbs::-webkit-scrollbar {
  display: none;
}

.pui-msg__viewer-thumb {
  flex: none;
  width: 42px;
  height: 42px;
  padding: 0;
  border: 2px solid transparent;
  border-radius: 7px;
  overflow: hidden;
  background: #ececec;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.pui-msg__viewer-thumb img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 5px;
}

/* 当前张用 iMessage 蓝描边（区别于 KakaoTalk 的黄色） */
.pui-msg__viewer-thumb--on {
  border-color: #0a84ff;
}

.pui-msg__viewer-thumb:active {
  opacity: 0.7;
}

.pui-msg__viewer-count {
  margin: 0;
  padding: 0 14px;
  font-size: 0.75rem;
  color: var(--pui-label-2);
  font-variant-numeric: tabular-nums;
}

/* 浮层淡入淡出：比屏幕切换更轻，避免"又开了一页"的错觉 */
.pui-msg-viewer-enter-active,
.pui-msg-viewer-leave-active {
  transition: opacity 160ms var(--pui-ease-out);
}

.pui-msg-viewer-enter-from,
.pui-msg-viewer-leave-to {
  opacity: 0;
}
</style>
