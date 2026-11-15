<script setup>
/**
 * 开关。
 *
 * 底层仍是原生 checkbox —— 键盘、读屏、表单语义全部免费拿到，
 * 只是把外观换成轨道 + 滑块。不用 <button role="switch"> 手搓，
 * 那样要自己补 aria-checked、空格键、focus 环，容易漏。
 */
const model = defineModel({ type: Boolean, default: false })

defineProps({
  id: { type: String, default: undefined },
  label: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
})
</script>

<template>
  <label class="ui-switch" :data-disabled="disabled">
    <input
      :id="id"
      v-model="model"
      class="ui-switch__input"
      type="checkbox"
      :disabled="disabled"
    />
    <span class="ui-switch__track" aria-hidden="true">
      <span class="ui-switch__thumb"></span>
    </span>
    <span v-if="label" class="ui-switch__label">{{ label }}</span>
  </label>
</template>

<style scoped>
.ui-switch {
  /* 必须自建定位上下文：
     __input 是 absolute 的视觉隐藏 checkbox，若这里不加 relative，
     它的包含块会一路逃到视口 —— 逃出 .ws__main 的 overflow 裁剪，
     把整个窗口撑出一段可滚动的空白（设置页滚到底"顶栏飞走"的元凶）。 */
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  cursor: pointer;
  user-select: none;
}

.ui-switch[data-disabled='true'] {
  cursor: not-allowed;
  opacity: 0.5;
}

.ui-switch__input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.ui-switch__track {
  position: relative;
  width: 34px;
  height: 20px;
  border-radius: var(--radius-pill);
  background: var(--c-border-strong);
  transition: background var(--dur-base) var(--ease);
  flex: none;
}

.ui-switch__thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--c-white);
  box-shadow: var(--shadow-sm);
  transition: transform var(--dur-base) var(--ease);
}

.ui-switch__input:checked + .ui-switch__track {
  background: var(--c-accent);
}

.ui-switch__input:checked + .ui-switch__track .ui-switch__thumb {
  transform: translateX(14px);
}

.ui-switch__input:focus-visible + .ui-switch__track {
  outline: 2px solid var(--c-accent);
  outline-offset: 2px;
}

.ui-switch__label {
  font-size: var(--fs-base);
  color: var(--c-text-2);
}
</style>
