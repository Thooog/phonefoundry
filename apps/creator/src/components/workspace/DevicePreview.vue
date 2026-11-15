<script setup>
import { ref, watch } from 'vue'
import PhoneShell from '@phone-sim/player-ui/PhoneShell.vue'
import StatusBar from '@phone-sim/player-ui/kernel/StatusBar.vue'
import '@phone-sim/player-ui/styles/entry.css'

defineOptions({ inheritAttrs: false })
defineProps({ timeFormat: { type: String, default: undefined } })

const frame = ref(null)
const scale = ref(0.5)
watch(frame, (element, _, onCleanup) => {
  if (!element) return
  const deviceWidth = Number.parseFloat(getComputedStyle(element).getPropertyValue('--pui-device-w'))
  const observer = new ResizeObserver(([entry]) => {
    scale.value = Math.min(1, entry.contentRect.width / deviceWidth)
  })
  observer.observe(element)
  onCleanup(() => observer.disconnect())
})
</script>

<template>
  <div ref="frame">
    <PhoneShell v-bind="$attrs" class="device-preview" mode="device" :style="{ '--pui-shell-scale': scale }">
      <slot />
      <StatusBar tone="light" :time-format="timeFormat" />
    </PhoneShell>
  </div>
</template>

<style scoped>
.device-preview {
  height: auto;
  background: transparent;
  overflow: visible;
  line-height: normal;
  text-align: start;
}
/* 创作端预览不要外投影：保留机身三道 inset/描边，只去掉两道外阴影 */
.device-preview :deep(.pui-shell__device) {
  box-shadow:
    inset 0 0 0 2px rgba(0, 0, 0, 0.88),
    inset 0 0 1px 1px rgba(255, 255, 255, 0.16),
    0 0 0 1px rgba(0, 0, 0, 0.5);
}
</style>
