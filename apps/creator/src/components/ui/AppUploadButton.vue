<script setup>
/**
 * 选文件按钮。
 *
 * 为什么包一层而不是让每个页面自己写 <input type="file">：
 *   1. 原生 input 的外观改不动，各浏览器还不一样；
 *   2. 选完同一个文件再选一次不会触发 change —— 必须手动把 value 清空，
 *      这件事漏一次就会出现"点了没反应"的怪 bug，集中在这里处理掉。
 */
import { ref } from 'vue'
import AppButton from './AppButton.vue'

defineProps({
  accept: { type: String, default: 'image/*' },
  multiple: { type: Boolean, default: true },
  disabled: { type: Boolean, default: false },
  variant: { type: String, default: 'default' },
  size: { type: String, default: 'md' },
  testId: { type: String, default: 'upload-input' },
})

const emit = defineEmits(['files'])

const inputRef = ref(null)

function openPicker() {
  inputRef.value?.click()
}

function onChange(event) {
  const files = Array.from(event.target.files ?? [])
  // 先清空再 emit：不清空的话，选同一个文件第二次不会触发 change
  event.target.value = ''
  if (files.length) emit('files', files)
}
</script>

<template>
  <span class="ui-upload">
    <AppButton :variant="variant" :size="size" :disabled="disabled" @click="openPicker">
      <slot>选择文件</slot>
    </AppButton>
    <input
      ref="inputRef"
      class="ui-upload__input"
      type="file"
      :accept="accept"
      :multiple="multiple"
      :disabled="disabled"
      :data-testid="testId"
      @change="onChange"
    />
  </span>
</template>

<style scoped>
.ui-upload {
  display: inline-flex;
}

/* 收成 1px 透明盒而不是 display:none —— 部分浏览器会拒绝触发隐藏 input 的 click */
.ui-upload__input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}
</style>
