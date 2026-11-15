<script setup>

import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useProjectStore } from '../../stores/project.js'
import { useUiStore } from '../../stores/ui.js'
import AppButton from '../ui/AppButton.vue'

const editor = useProjectStore()
const ui = useUiStore()
const router = useRouter()

const visible = computed(() => editor.isReadOnly)

const mode = computed(() => (editor.readOnlyReason === 'lost_lock' ? 'lost' : 'locked'))

const title = computed(() =>
  mode.value === 'lost' ? '这一页已经停止保存' : '该项目正在另一个标签页编辑',
)

const message = computed(() =>
  mode.value === 'lost'
    ? '别的标签页接管了这个项目。你在这里的改动只留在内存里，不会再写入磁盘。可以把它另存为一个新项目，内容不会丢。'
    : '为了避免两边互相覆盖，这里暂时只能查看。如果那个标签页已经不用了，可以强制接管。',
)

async function takeover() {
  const ok = await ui.confirm({
    title: '强制接管这个项目？',
    message: '另一个标签页的未保存改动会丢失。接管后本页会从磁盘重新读取，以磁盘内容为准。',
    confirmText: '接管',
    tone: 'danger',
  })
  if (!ok) return

  const result = await editor.takeOver()
  if (!result?.ok) {
    ui.toast('接管失败，请刷新页面后重试。', { tone: 'error' })
    return
  }
  ui.toast('已接管，可以继续编辑。', { tone: 'success' })
}

async function saveAsCopy() {
  try {
    const copy = await editor.saveAsCopy()
    if (!copy) {
      ui.toast('没有可保存的内容。', { tone: 'error' })
      return
    }
    ui.toast(`已另存为新项目：${copy.name}`, { tone: 'success' })
    router.push({ name: 'overview', params: { projectId: copy.id } })
  } catch (err) {
    ui.toast(err?.message ?? '另存失败。', { tone: 'error' })
  }
}
</script>

<template>
  <div v-if="visible" class="ro-banner" :data-mode="mode" data-testid="readonly-banner">
    <div class="ro-banner__text">
      <strong class="ro-banner__title">{{ title }}</strong>
      <span class="ro-banner__message">{{ message }}</span>
    </div>
    <div class="ro-banner__actions">
      <AppButton
        v-if="mode === 'lost'"
        variant="primary"
        size="sm"
        data-testid="save-as-copy"
        @click="saveAsCopy"
      >
        另存为新项目
      </AppButton>
      <AppButton
        v-else
        size="sm"
        data-testid="takeover"
        @click="takeover"
      >
        强制接管
      </AppButton>
    </div>
  </div>
</template>

<style scoped>
.ro-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-4);
  padding: var(--sp-3) var(--sp-5);
  border-bottom: 1px solid var(--c-border);
  font-size: var(--fs-base);
}

.ro-banner[data-mode='locked'] {
  background: var(--c-warning-weak);
  color: var(--c-warning);
}

.ro-banner[data-mode='lost'] {
  background: var(--c-danger-weak);
  color: var(--c-danger);
}

.ro-banner__text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.ro-banner__title {
  font-weight: 600;
}

.ro-banner__message {
  color: var(--c-text-2);
  line-height: 1.5;
}

.ro-banner__actions {
  flex: none;
}
</style>
