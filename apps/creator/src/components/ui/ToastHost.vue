<script setup>
/**
 * 轻提示容器 —— 由 uiStore.toast() 驱动。
 *
 * 定位在右下角而不是顶部居中：
 *   创作端的顶栏已经放了保存状态与预览按钮，顶部再弹东西会遮住"是否已保存"这个
 *   用户最需要随时看到的信息。右下角离主编辑区最远，最少打扰。
 *
 * amount 上限 3 条：再多就变成日志了，用户会直接无视。
 */

import { computed } from 'vue'
import { useUiStore } from '../../stores/ui.js'

const ui = useUiStore()

const visible = computed(() => ui.toasts.slice(-3))
</script>

<template>
  <Teleport to="body">
    <div class="ui-toasts" aria-live="polite" aria-atomic="false">
      <TransitionGroup name="toast">
        <div
          v-for="item in visible"
          :key="item.id"
          class="ui-toast"
          :data-tone="item.tone"
          role="status"
          @click="ui.dismissToast(item.id)"
        >
          {{ item.message }}
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.ui-toasts {
  position: fixed;
  right: var(--sp-5);
  bottom: var(--sp-5);
  z-index: 90;
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  max-width: 380px;
  pointer-events: none;
}

.ui-toast {
  pointer-events: auto;
  padding: 10px var(--sp-4);
  border-radius: var(--radius-md);
  border: 1px solid var(--c-border);
  background: var(--c-bg-raised);
  box-shadow: var(--shadow-md);
  font-size: var(--fs-base);
  line-height: 1.5;
  cursor: pointer;
}

.ui-toast[data-tone='success'] {
  border-color: var(--c-success);
  background: var(--c-success-weak);
  color: var(--c-success);
}

.ui-toast[data-tone='error'] {
  border-color: var(--c-danger);
  background: var(--c-danger-weak);
  color: var(--c-danger);
}

.toast-enter-active,
.toast-leave-active {
  transition:
    opacity var(--dur-base) var(--ease),
    transform var(--dur-base) var(--ease);
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(6px);
}
</style>
