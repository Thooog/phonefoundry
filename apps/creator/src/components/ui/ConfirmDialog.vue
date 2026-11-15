<script setup>

import { computed, watch, nextTick, ref } from 'vue'
import { useUiStore } from '../../stores/ui.js'
import AppButton from './AppButton.vue'

const ui = useUiStore()
const dialog = computed(() => ui.dialog)
const confirmBtn = ref(null)
const modal = ref(null)

/**
 * 标题上方的陶橘小标签只是版式锚点，不是信息载体：
 * 全站 30+ 处确认框（删除 / 清除 / 移除 / 草稿离开 / 接管）共用一个组件，
 * 任何更具体的文案都会对其中一批场景失准，所以只区分「草稿离开」这一类
 * —— 它的 confirmText 明确是「丢弃并离开」，语义不会冤枉别处。
 */
const eyebrow = computed(() =>
  dialog.value?.confirmText === '丢弃并离开' ? '未保存的更改' : '请确认',
)

/** 打开时把焦点放到取消上（破坏性操作不该默认聚焦"确定"） */
watch(dialog, async (next) => {
  if (!next) return
  await nextTick()
  // Use the top layer so confirmation also works inside a photo or profile dialog.
  if (modal.value && !modal.value.open) modal.value.showModal()
  // AppButton 是组件，ref 拿到的是组件实例，要取 $el 才能 focus
  const target = confirmBtn.value?.$el ?? confirmBtn.value
  target?.focus?.()
})

function onKeydown(event) {
  if (event.key === 'Escape' && dialog.value) {
    event.preventDefault()
    ui.settleDialog(false)
  }
}
</script>

<template>
  <Teleport to="body">
    <dialog
      v-if="dialog"
      ref="modal"
      class="ui-confirm"
      role="presentation"
      @keydown="onKeydown"
      @cancel.prevent="ui.settleDialog(false)"
      @click.self="ui.settleDialog(false)"
    >
      <div
        class="ui-confirm__panel"
        role="alertdialog"
        aria-modal="true"
        :aria-labelledby="'ui-confirm-title'"
      >
        <p class="ui-confirm__eyebrow">{{ eyebrow }}</p>
        <h2 id="ui-confirm-title" class="ui-confirm__title">{{ dialog.title }}</h2>
        <p v-if="dialog.message" class="ui-confirm__message">{{ dialog.message }}</p>
        <div class="ui-confirm__actions">
          <AppButton ref="confirmBtn" data-testid="confirm-cancel" @click="ui.settleDialog(false)">
            {{ dialog.cancelText }}
          </AppButton>
          <AppButton
            data-testid="confirm-ok"
            :variant="dialog.tone === 'danger' ? 'danger' : 'primary'"
            @click="ui.settleDialog(true)"
          >
            {{ dialog.confirmText }}
          </AppButton>
        </div>
      </div>
    </dialog>
  </Teleport>
</template>

<style scoped>

.ui-confirm {
  position: fixed;
  inset: 0;
  z-index: 100;
  width: 100%;
  height: 100%;
  max-width: none;
  max-height: none;
  margin: 0;
  border: 0;
  color: var(--c-text);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--sp-5);
  background: rgba(32, 35, 33, 0.22);
}

.ui-confirm::backdrop { background: transparent; }

/* 卡片与 msgpop / inspector-panel 同档：白纸 + 1px 细线 + 10px 圆角 + 轻阴影 */
.ui-confirm__panel {
  width: 100%;
  max-width: 400px;
  padding: 24px 24px 20px;
  border: 1px solid var(--c-border);
  border-radius: 10px;
  background: var(--c-white);
  box-shadow: var(--shadow-md);
}

.ui-confirm__eyebrow {
  margin: 0 0 10px;
  color: var(--c-detail-text);
  font-size: var(--fs-xs);
  letter-spacing: 0.1em;
}

.ui-confirm__title {
  margin: 0;
  font-family: var(--font-story, Georgia, 'Noto Serif SC', serif);
  font-size: 22px;
  font-weight: 600;
  line-height: 1.35;
  letter-spacing: 0;
}

.ui-confirm__message {
  margin-top: 8px;
  color: var(--c-text-2);
  font-size: var(--fs-sm);
  line-height: 1.65;
  white-space: pre-line;
}

.ui-confirm__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--sp-2);
  margin-top: 36px;
}

/* 按钮收口到创作端统一尺寸：34px / 6px / 13px。
   用 :deep 只作用于本弹窗内的 AppButton，不动全局组件。 */
.ui-confirm__actions :deep(.ui-btn) {
  min-height: 34px;
  padding: 0 14px;
  border-radius: 6px;
  font-size: var(--fs-sm);
}

/* danger 沿用 AppButton 语义（红字），补一圈浅描边让它仍是个按钮 */
.ui-confirm__actions :deep(.ui-btn[data-variant='danger']) {
  border-color: #e8d2d0;
  background: var(--c-white);
}

/* AppButton 窄屏会把可点高度提到 44px，这里的局部覆写特异性更高，
   必须显式跟回 44px，否则弹窗按钮反而缩成 34px。 */
@media (max-width: 767px) {
  .ui-confirm__actions :deep(.ui-btn) { min-height: 44px; }
}
</style>
