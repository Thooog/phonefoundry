<!--
  分段控件。

  指示器用"绝对定位滑块 + transform"而不是给选中项加背景：
  切换时滑块是滑过去的（200ms），给项加背景会变成硬切，
  在手机这种小尺寸上差别非常明显。
-->
<script setup>
import { computed } from 'vue'

const props = defineProps({
  /** [{ value, label }] */
  options: { type: Array, required: true },
  modelValue: { type: String, default: '' },
  /** 'default' 浅灰底 | 'on-image' 深色半透明（放在图片上时用） */
  tone: { type: String, default: 'default' },
})

const emit = defineEmits(['update:modelValue'])

const activeIndex = computed(() => {
  const index = props.options.findIndex((o) => o.value === props.modelValue)
  return index < 0 ? 0 : index
})

const count = computed(() => Math.max(1, props.options.length))

function select(option) {
  if (option.value !== props.modelValue) emit('update:modelValue', option.value)
}
</script>

<template>
  <div class="pui-seg" :data-tone="tone" role="tablist">
    <span
      class="pui-seg__indicator"
      :style="{
        width: `calc((100% - 4px) / ${count})`,
        transform: `translateX(calc(${activeIndex} * 100%))`,
      }"
      aria-hidden="true"
    ></span>
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      role="tab"
      class="pui-seg__item"
      :aria-selected="option.value === modelValue"
      :data-active="option.value === modelValue ? 'true' : 'false'"
      @click="select(option)"
    >
      {{ option.label }}
    </button>
  </div>
</template>

<style>
.pui-seg {
  position: relative;
  display: flex;
  padding: 2px;
  border-radius: 9px;
  background: var(--pui-fill);
  isolation: isolate;
}

.pui-seg[data-tone='on-image'] {
  background: rgba(0, 0, 0, 0.28);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

.pui-seg__indicator {
  position: absolute;
  top: 2px;
  left: 2px;
  bottom: 2px;
  border-radius: 7px;
  background: var(--pui-bg);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12), 0 1px 1px rgba(0, 0, 0, 0.04);
  transition: transform var(--pui-dur-base) var(--pui-ease-out);
  z-index: 0;
}

.pui-seg[data-tone='on-image'] .pui-seg__indicator {
  background: rgba(255, 255, 255, 0.92);
}

.pui-seg__item {
  position: relative;
  z-index: 1;
  flex: 1 1 0;
  padding: 6px 4px;
  border: 0;
  background: transparent;
  color: var(--pui-label);
  font: inherit;
  font-size: var(--pui-font-footnote);
  font-weight: var(--pui-weight-medium);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: opacity var(--pui-dur-fast) var(--pui-ease-out);
}

.pui-seg__item[data-active='false'] {
  opacity: 0.62;
}
</style>
