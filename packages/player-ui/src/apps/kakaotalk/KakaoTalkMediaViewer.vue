<script setup>
const props = defineProps({ controller: { type: Object, required: true } })
const { viewerItem, viewerSrcs, viewerIndex, viewerStamp, closeViewer, showViewerIndex, onViewerDown, onViewerMove, onViewerUp, thumbsEl, viewerStripStyle } = props.controller
</script>
<template>
  <Transition name="pui-kt-viewer">
    <div v-if="viewerItem" class="pui-kt__viewer" data-testid="kt-media-viewer">
      <!-- 舞台铺满整屏、图片按原比例居中：竖图自然顶到上下边缘，
             宽图（横幅截图）上下留黑 —— 两种都和真机一致。
             多图时整条 strip 横排，左右滑翻页（单图也走同一条 strip，只是不会动）。 -->
      <div
        class="pui-kt__viewer-stage"
        :data-multi="viewerSrcs.length > 1 ? 'true' : 'false'"
        @pointerdown="onViewerDown"
        @pointermove="onViewerMove"
        @pointerup="onViewerUp"
        @pointercancel="onViewerUp"
      >
        <div class="pui-kt__viewer-strip" :style="viewerStripStyle">
          <div v-for="(src, i) in viewerSrcs" :key="i" class="pui-kt__viewer-slide">
            <img
              class="pui-kt__viewer-image"
              :data-testid="i === viewerIndex ? 'kt-viewer-image' : `kt-viewer-slide-${i}`"
              :src="src"
              alt=""
              draggable="false"
            />
          </div>
        </div>
      </div>

      <header class="pui-kt__viewer-bar">
        <button
          type="button"
          class="pui-kt__viewer-back"
          data-testid="kt-viewer-close"
          aria-label="关闭图片"
          @click="closeViewer"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 5.5L8 12l6.5 6.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </button>
        <div class="pui-kt__viewer-meta">
          <span class="pui-kt__viewer-name" data-testid="kt-viewer-name">{{ viewerItem.authorName }}</span>
          <span class="pui-kt__viewer-stamp">{{ viewerStamp(viewerItem) }}</span>
        </div>

        <span class="pui-kt__viewer-grid" aria-hidden="true">
          <svg viewBox="0 0 24 24"><rect x="4" y="4" width="6" height="6" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.8" /><rect x="14" y="4" width="6" height="6" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.8" /><rect x="4" y="14" width="6" height="6" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.8" /><rect x="14" y="14" width="6" height="6" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.8" /></svg>
        </span>
      </header>

      <div class="pui-kt__viewer-foot">
        <!-- 多图才有多图的东西：单图不摆一条只有一张的缩略图条 -->
        <div v-if="viewerSrcs.length > 1" class="pui-kt__viewer-album">
          <div ref="thumbsEl" class="pui-kt__viewer-thumbs" data-testid="kt-viewer-thumbs">
            <button
              v-for="(src, i) in viewerSrcs"
              :key="i"
              type="button"
              class="pui-kt__viewer-thumb"
              :class="{ 'pui-kt__viewer-thumb--on': i === viewerIndex }"
              :data-testid="`kt-viewer-thumb-${i}`"
              :aria-label="`第 ${i + 1} 张`"
              @click="showViewerIndex(i)"
            >
              <img :src="src" alt="" />
            </button>
          </div>
          <p class="pui-kt__viewer-count" data-testid="kt-viewer-count">
            第 {{ viewerIndex + 1 }} 张，共 {{ viewerSrcs.length }} 张
          </p>
        </div>

        <!-- 工具条：下载 / 分享 / 删除 / 收藏 / 更多。作品端只读，纯装饰 -->
        <div class="pui-kt__viewer-tools" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M12 4v10M8.2 10.4L12 14.2l3.8-3.8" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" /><path d="M5 16v3.2h14V16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" /></svg>
          <svg viewBox="0 0 24 24"><path d="M12 15.5V4.2M8.2 7.6L12 4l3.8 3.6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" /><path d="M5 13.5v5.9h14v-5.9" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" /></svg>
          <svg viewBox="0 0 24 24"><path d="M6 7h12M9.5 7V5.2h5V7M7.6 7l.8 12.1h7.2L16.4 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
          <svg viewBox="0 0 24 24"><path d="M12 3.8l2.5 5.4 5.7.7-4.2 4 1.1 5.9L12 17l-5.1 2.8L8 13.9l-4.2-4 5.7-.7z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" /></svg>
          <svg viewBox="0 0 24 24"><circle cx="5.5" cy="12" r="1.7" fill="currentColor" /><circle cx="12" cy="12" r="1.7" fill="currentColor" /><circle cx="18.5" cy="12" r="1.7" fill="currentColor" /></svg>
        </div>
      </div>
    </div>
  </Transition>
</template>
<style>
.pui-kt__viewer {
  position: absolute;
  inset: 0;
  z-index: 30;
  display: flex;
  flex-direction: column;
  background: #000;
  color: #fff;
}

.pui-kt__viewer-stage {
  position: absolute;
  inset: 0;
  overflow: hidden;
  /* 横向手势归 JS（翻页），别让浏览器拿去当页面平移；查看器本身没有可滚动内容 */
  touch-action: none;
}

.pui-kt__viewer-stage[data-multi='true'] {
  cursor: grab;
}

.pui-kt__viewer-stage[data-multi='true']:active {
  cursor: grabbing;
}

/* strip 宽度就是屏宽（stage 里的块级 flex 容器），所以 -index * 100% 正好一屏一格 */
.pui-kt__viewer-strip {
  display: flex;
  height: 100%;
  transition: transform 280ms var(--pui-ease-out);
  will-change: transform;
}

.pui-kt__viewer-slide {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}

/* contain 而不是 cover：查看器是用来"看清楚"的，裁掉边缘就失去意义 */
.pui-kt__viewer-image {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  user-select: none;
  -webkit-user-drag: none;
}

.pui-kt__viewer-bar {
  position: relative;
  z-index: 1;
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: calc(var(--pui-statusbar-h) + 6px) 14px 10px;
  /* 顶栏压在图上的可读性保障：竖图顶到状态栏时文字不会糊在照片上 */
  background: linear-gradient(to bottom, rgba(0, 0, 0, 0.62), rgba(0, 0, 0, 0));
}

.pui-kt__viewer-back {
  flex: none;
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  margin-left: -6px;
  color: #fff;
  -webkit-tap-highlight-color: transparent;
}

.pui-kt__viewer-back svg {
  width: 24px;
  height: 24px;
}

.pui-kt__viewer-back:active {
  opacity: 0.55;
}

.pui-kt__viewer-meta {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.pui-kt__viewer-name {
  font-size: 1.0625rem;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: #fff;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pui-kt__viewer-stamp {
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.68);
  font-variant-numeric: tabular-nums;
}

.pui-kt__viewer-grid {
  flex: none;
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  color: #fff;
}

.pui-kt__viewer-grid svg {
  width: 22px;
  height: 22px;
}

.pui-kt__viewer-foot {
  position: relative;
  z-index: 1;
  margin-top: auto;
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 10px 0 calc(10px + var(--pui-homebar-h, 0px));
  background: linear-gradient(to top, rgba(0, 0, 0, 0.78), rgba(0, 0, 0, 0));
}

.pui-kt__viewer-album {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.pui-kt__viewer-thumbs {
  display: flex;
  gap: 6px;
  padding: 0 14px;
  overflow-x: auto;
  scrollbar-width: none;
}

.pui-kt__viewer-thumbs::-webkit-scrollbar {
  display: none;
}

.pui-kt__viewer-thumb {
  flex: none;
  width: 42px;
  height: 42px;
  padding: 0;
  border: 2px solid transparent;
  border-radius: 7px;
  overflow: hidden;
  background: #1c1c1e;
  -webkit-tap-highlight-color: transparent;
}

.pui-kt__viewer-thumb img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 5px;
}

.pui-kt__viewer-thumb--on {
  border-color: #f9e547;
}

.pui-kt__viewer-thumb:active {
  opacity: 0.7;
}

.pui-kt__viewer-count {
  margin: 0;
  padding: 0 14px;
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.72);
  font-variant-numeric: tabular-nums;
}

.pui-kt__viewer-tools {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px 22px 0;
  color: #fff;
}

.pui-kt__viewer-tools svg {
  width: 22px;
  height: 22px;
}

/* 浮层淡入淡出：比屏幕切换的位移更轻，避免"又开了一页"的错觉 */
.pui-kt-viewer-enter-active,
.pui-kt-viewer-leave-active {
  transition: opacity 160ms var(--pui-ease-out);
}

.pui-kt-viewer-enter-from,
.pui-kt-viewer-leave-to {
  opacity: 0;
}
</style>
