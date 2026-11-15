<!--
  空态。

  作品里"没有内容"是常态（用户刚建项目、删光了会话），
  这时候最忌讳的是留一片纯白 —— 看起来像渲染失败。
  给一个图标 + 一句解释性的话，让人知道"这里是空的，不是坏了"。
-->
<script setup>
defineProps({
  title: { type: String, default: '暂无内容' },
  description: { type: String, default: '' },
  /** 图标：'empty' | 'search' | 'chat' | 'lock' */
  icon: { type: String, default: 'empty' },
})
</script>

<template>
  <div class="pui-empty" data-testid="empty-state">
    <svg class="pui-empty__icon" viewBox="0 0 64 64" width="56" height="56" aria-hidden="true">
      <g
        v-if="icon === 'chat'"
        fill="none"
        stroke="currentColor"
        stroke-width="2.4"
        stroke-linejoin="round"
      >
        <path d="M12 16h40a4 4 0 014 4v22a4 4 0 01-4 4H30l-12 8v-8h-6a4 4 0 01-4-4V20a4 4 0 014-4z" />
      </g>
      <g
        v-else-if="icon === 'search'"
        fill="none"
        stroke="currentColor"
        stroke-width="2.4"
        stroke-linecap="round"
      >
        <circle cx="28" cy="28" r="14" />
        <path d="M38 38l10 10" />
      </g>
      <g
        v-else-if="icon === 'lock'"
        fill="none"
        stroke="currentColor"
        stroke-width="2.4"
        stroke-linejoin="round"
      >
        <rect x="16" y="28" width="32" height="24" rx="5" />
        <path d="M23 28v-6a9 9 0 0118 0v6" />
      </g>
      <g v-else fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round">
        <rect x="12" y="18" width="40" height="30" rx="4" />
        <path d="M12 30h40" />
      </g>
    </svg>

    <p class="pui-empty__title">{{ title }}</p>
    <p v-if="description" class="pui-empty__desc">{{ description }}</p>
    <slot />
  </div>
</template>

<style>
.pui-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--pui-space-2);
  padding: var(--pui-space-8) var(--pui-space-6);
  height: 100%;
  min-height: 240px;
  text-align: center;
  color: var(--pui-label-3);
}

.pui-empty__icon {
  color: var(--pui-label-3);
  opacity: 0.9;
  margin-bottom: var(--pui-space-1);
}

.pui-empty__title {
  margin: 0;
  font-size: var(--pui-font-body);
  font-weight: var(--pui-weight-medium);
  color: var(--pui-label-2);
}

.pui-empty__desc {
  margin: 0;
  font-size: var(--pui-font-footnote);
  color: var(--pui-label-3);
  max-width: 240px;
  line-height: var(--pui-leading-body);
}
</style>
