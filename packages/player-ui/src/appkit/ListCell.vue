<!--
  列表行 —— 聊天列表、联系人、设置项共用。

  为什么不用 ul/li：这一行要同时容纳 4 个可选槽位（左图、主副标题、右侧文字、右侧控件），
  用语义列表会逼出一堆 style 覆盖。这里就是一个可点击的 flex 行，语义交给外层。

  按压缩放放在 CSS :active 而不是 JS：
  这类高频交互用 JS 改 transform 会与滚动抢主线程，:active 由合成器处理，零成本。
-->
<script setup>
defineProps({
  /** 主标题 */
  title: { type: String, default: '' },
  /** 副标题（消息预览 / 个性签名） */
  subtitle: { type: String, default: '' },
  /** 右侧次要文字（时间、数量） */
  meta: { type: String, default: '' },
  /** 是否显示右箭头 */
  chevron: { type: Boolean, default: false },
  /** 是否可点击（false 时无按压反馈、无 cursor） */
  interactive: { type: Boolean, default: true },
  /** 分隔线缩进：与左图对齐（iOS 默认） */
  inset: { type: Boolean, default: true },
  /** 紧凑模式：行高更小，用于设置页 */
  dense: { type: Boolean, default: false },
})

defineEmits(['click'])
</script>

<template>
  <component
    :is="interactive ? 'button' : 'div'"
    :type="interactive ? 'button' : undefined"
    class="pui-cell"
    :class="{ 'pui-cell--inset': inset, 'pui-cell--dense': dense }"
    :data-interactive="interactive ? 'true' : 'false'"
    @click="interactive && $emit('click', $event)"
  >
    <span v-if="$slots.leading" class="pui-cell__leading">
      <slot name="leading" />
    </span>

    <span class="pui-cell__body">
      <span class="pui-cell__title">{{ title }}<slot name="title" /></span>
      <span v-if="subtitle || $slots.subtitle" class="pui-cell__subtitle">
        <slot name="subtitle">{{ subtitle }}</slot>
      </span>
    </span>

    <span v-if="meta || $slots.meta" class="pui-cell__meta">
      <slot name="meta">{{ meta }}</slot>
    </span>

    <span v-if="$slots.trailing" class="pui-cell__trailing">
      <slot name="trailing" />
    </span>

    <svg
      v-if="chevron"
      class="pui-cell__chevron"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
    >
      <path
        d="M9 5l7 7-7 7"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  </component>
</template>

<style>
.pui-cell {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--pui-space-3);
  width: 100%;
  min-height: 60px;
  padding: 10px var(--pui-space-4);
  margin: 0;
  border: 0;
  background: transparent;
  color: var(--pui-label);
  font: inherit;
  text-align: left;
  -webkit-tap-highlight-color: transparent;
}

.pui-cell--dense {
  min-height: 44px;
  padding-top: 6px;
  padding-bottom: 6px;
}

.pui-cell[data-interactive='true'] {
  cursor: pointer;
  transition: background-color var(--pui-dur-fast) var(--pui-ease-out);
}

/* 按压反馈用背景而不是缩放：列表行缩放在滚动中会显得抖 */
.pui-cell[data-interactive='true']:active {
  background: var(--pui-fill);
}

/* 分隔线：用伪元素而非 border，便于左缩进与"最后一行不画" */
.pui-cell::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 0.5px;
  background: var(--pui-separator);
}

.pui-cell--inset::after {
  left: var(--pui-cell-inset, 68px);
}

.pui-cell:last-child::after {
  display: none;
}

.pui-cell__leading {
  display: inline-flex;
  flex: 0 0 auto;
}

.pui-cell__body {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.pui-cell__title {
  font-size: var(--pui-font-body);
  font-weight: var(--pui-weight-medium);
  letter-spacing: var(--pui-tracking-body);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pui-cell__subtitle {
  font-size: var(--pui-font-footnote);
  color: var(--pui-label-2);
  letter-spacing: var(--pui-tracking-caption);
  /* 预览文字最多两行，再多就截断 —— 高度抖动比信息不全更干扰浏览 */
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.pui-cell__meta {
  flex: 0 0 auto;
  align-self: flex-start;
  margin-top: 2px;
  font-size: var(--pui-font-caption1);
  color: var(--pui-label-2);
  font-variant-numeric: tabular-nums;
}

.pui-cell__trailing {
  display: inline-flex;
  flex: 0 0 auto;
  color: var(--pui-label-3);
}

.pui-cell__chevron {
  flex: 0 0 auto;
  color: var(--pui-label-3);
}
</style>
