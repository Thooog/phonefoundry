<!--
  应用内导航栏。

  必须处理的两件事：
  1. **给状态栏留位**。状态栏是全局浮层（时间/信号/电量），导航栏若不内缩 54px，
     标题就会被时间压住 —— 这是"看起来像网页而不像手机"最常见的破绽。
  2. **返回按钮用文字而不只是箭头**。iOS 的返回是「‹ 上一级标题」，
     纯箭头在长标题下会让人不确定退到哪。
-->
<script setup>
import { computed } from 'vue'

const props = defineProps({
  title: { type: String, default: '' },
  /** 返回按钮文字；为空时只显示箭头 */
  backLabel: { type: String, default: '' },
  /** 是否显示返回按钮 */
  showBack: { type: Boolean, default: true },
  /** 大标题模式（列表页首屏用，滚动中收进导航栏） */
  large: { type: Boolean, default: false },

  scrollTop: { type: Number, default: 0 },
  /** 'light' 用于深色导航栏 */
  tone: { type: String, default: 'default' },
})

/**
 * 大标题完全收起所需的滚动距离。
 * iOS 上大约是"大标题高度 + 一点余量"，取 52px 手感接近；
 * 太小会让标题一闪就没，太大则收起动作落后于手指。
 */
const LARGE_COLLAPSE_RANGE = 52
/** 大标题块的原始高度 = 34px × 1.12 行高 + 16px 内边距 */
const LARGE_BLOCK_H = 46

const progress = computed(() => {
  if (!props.large) return 0
  const p = props.scrollTop / LARGE_COLLAPSE_RANGE
  return p < 0 ? 0 : p > 1 ? 1 : p
})

const largeStyle = computed(() => ({
  height: `${Math.max(0, (1 - progress.value) * LARGE_BLOCK_H)}px`,
  opacity: String(1 - progress.value),
  // 轻微上移，让文字"缩进"导航栏而不是原地淡掉
  transform: `translateY(${(-4 * progress.value).toFixed(2)}px)`,
}))

/**
 * 小标题：只在大标题模式且已经开始收起时出现。
 * 用 opacity 而不是 v-if —— 中途插入节点会触发重排，滚动中重排必然掉帧。
 */
const titleStyle = computed(() => ({
  opacity: props.large ? String(progress.value) : '1',
}))

defineEmits(['back', 'title-click'])
</script>

<template>
  <header class="pui-navbar" :data-tone="tone" :data-large="large ? 'true' : 'false'">
    <div class="pui-navbar__bar">
      <div class="pui-navbar__side pui-navbar__side--left">
        <button
          v-if="showBack"
          type="button"
          class="pui-navbar__back"
          data-testid="nav-back"
          @click="$emit('back')"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path
              d="M15 5l-7 7 7 7"
              fill="none"
              stroke="currentColor"
              stroke-width="2.2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          <span v-if="backLabel" class="pui-navbar__back-label">{{ backLabel }}</span>
        </button>
        <slot name="left" />
      </div>

      <!--
        大标题模式下中间的小标题默认不可见（opacity 0），随滚动淡入。
        两个标题同时显示会让顶部多出一行重复文字，一眼就不像原生；
        但用 v-if / display 切换会在滚动中重排，所以统一交给 opacity 处理。
      -->
      <h1
        class="pui-navbar__title"
        :style="titleStyle"
        :aria-hidden="large && progress < 0.5 ? 'true' : 'false'"
        @click="$emit('title-click')"
      >
        {{ title }}
      </h1>

      <div class="pui-navbar__side pui-navbar__side--right">
        <slot name="right" />
      </div>
    </div>

    <div v-if="large && title" class="pui-navbar__large" :style="largeStyle" aria-hidden="true">
      <span class="pui-navbar__large-text">{{ title }}</span>
    </div>
  </header>
</template>

<style>
.pui-navbar {
  position: relative;
  z-index: var(--pui-z-navbar);
  flex: 0 0 auto;
  padding-top: var(--pui-statusbar-h);
  background: var(--pui-material-regular);
  backdrop-filter: blur(var(--pui-blur-regular));
  -webkit-backdrop-filter: blur(var(--pui-blur-regular));
  border-bottom: 0.5px solid var(--pui-separator);
}

.pui-navbar[data-tone='light'] {
  background: rgba(0, 0, 0, 0.28);
  color: #fff;
  border-bottom-color: rgba(255, 255, 255, 0.18);
}

.pui-navbar__bar {
  position: relative;
  height: 44px;
  display: flex;
  align-items: center;
  padding: 0 var(--pui-space-2);
  gap: var(--pui-space-2);
}

.pui-navbar__side {
  display: flex;
  align-items: center;
  gap: var(--pui-space-2);
  min-width: 64px;
}

.pui-navbar__side--right {
  justify-content: flex-end;
}

.pui-navbar__title {
  flex: 1 1 auto;
  /* min-width:0 让省略号生效：flex 项默认 min-width:auto，长标题会顶开布局 */
  min-width: 0;
  margin: 0;
  font-size: var(--pui-font-headline);
  font-weight: var(--pui-weight-semibold);
  letter-spacing: var(--pui-tracking-body);
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pui-navbar__back {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 6px 4px 6px 0;
  border: 0;
  background: transparent;
  color: var(--pui-blue);
  font: inherit;
  font-size: var(--pui-font-body);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.pui-navbar[data-tone='light'] .pui-navbar__back {
  color: #fff;
}

.pui-navbar__back:active {
  opacity: 0.5;
}

.pui-navbar__back-label {
  max-width: 90px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pui-navbar__large {
  overflow: hidden;
  will-change: height, opacity;
}

.pui-navbar__large-text {
  display: block;
  padding: 0 var(--pui-space-4) var(--pui-space-2);
  font-size: var(--pui-font-large-title);
  font-weight: var(--pui-weight-bold);
  letter-spacing: var(--pui-tracking-large);
  line-height: var(--pui-leading-large);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
