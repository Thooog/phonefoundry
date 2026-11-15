<script setup>

import { computed } from 'vue'
import { useProjectStore } from '../../stores/project.js'
import { SAVE_STATUS } from '../../db/autosave.js'
import { useUiStore } from '../../stores/ui.js'

const editor = useProjectStore()
const ui = useUiStore()

const tone = computed(() => {
  if (editor.saveStatus === SAVE_STATUS.ERROR) return 'error'
  if (editor.saveStatus === SAVE_STATUS.SAVING) return 'busy'
  return 'ok'
})

const label = computed(() => {
  if (editor.saveStatus === SAVE_STATUS.ERROR) return '未保存'
  if (editor.saveStatus === SAVE_STATUS.SAVING) return '保存中'
  return '已保存'
})

const detail = computed(() => editor.saveError?.message ?? '')

const canRetry = computed(
  () => editor.saveStatus === SAVE_STATUS.ERROR && Boolean(editor.retrySave),
)

async function retry() {
  const ok = await editor.retrySave()
  ui.toast(ok ? '已重新保存。' : '仍然无法保存，请检查浏览器存储空间。', {
    tone: ok ? 'success' : 'error',
  })
}
</script>

<template>
  <div class="save-status" :data-tone="tone" :title="detail" data-testid="save-status">
    <span class="save-status__dot" aria-hidden="true"></span>
    <span class="save-status__label">{{ label }}</span>
    <button
      v-if="tone === 'error'"
      class="save-status__retry"
      type="button"
      data-testid="save-retry"
      @click="retry"
    >
      重试
    </button>
    <span v-if="canRetry === false && tone === 'error'" class="save-status__hint">
      见下方提示
    </span>
  </div>
</template>

<style scoped>
.save-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 var(--sp-2);
  border-radius: var(--radius-pill);
  font-size: var(--fs-sm);
  color: var(--c-text-3);
  white-space: nowrap;
}

.save-status__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--c-success);
  flex: none;
}

.save-status[data-tone='busy'] .save-status__dot {
  background: var(--c-warning);
  animation: save-pulse 1s var(--ease) infinite;
}

.save-status[data-tone='error'] {
  color: var(--c-danger);
  background: var(--c-danger-weak);
}

.save-status[data-tone='error'] .save-status__dot {
  background: var(--c-danger);
}

.save-status__retry {
  border: none;
  background: none;
  padding: 0 2px;
  color: var(--c-danger);
  font-size: var(--fs-sm);
  text-decoration: underline;
}

.save-status__hint {
  color: var(--c-danger);
  opacity: 0.75;
}

@keyframes save-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.3;
  }
}

@media (prefers-reduced-motion: reduce) {
  .save-status[data-tone='busy'] .save-status__dot {
    animation: none;
  }
}
</style>
