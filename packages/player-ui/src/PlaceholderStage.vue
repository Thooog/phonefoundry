/**
 * 占位屏 —— M0 阶段用于验证外壳与构建管线。
 *
 * M3 会被真正的 LockScreen / HomeScreen 取代，此文件届时删除。
 * 故意不依赖任何数据，保证"零数据也能渲染出一个手机"，
 * 这是 M0-9（file:// 直开）能通过的前提。
 */

<script setup>
import { computed } from 'vue'
import { formatClock } from '@phone-sim/shared'

const props = defineProps({
  mode: { type: String, default: 'device' },
})

const clock = computed(() => formatClock(new Date(), 'h24'))
const dateLine = computed(() => {
  const d = new Date()
  const week = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][d.getDay()]
  return `${d.getMonth() + 1}月${d.getDate()}日 ${week}`
})
</script>

<template>
  <div class="stage-placeholder" :data-mode="props.mode">
    <div class="stage-placeholder__bg"></div>
    <div class="stage-placeholder__lock">
      <p class="stage-placeholder__date">{{ dateLine }}</p>
      <p class="stage-placeholder__clock">{{ clock }}</p>
      <p class="stage-placeholder__hint">M0 骨架 · 手机外壳已就绪</p>
    </div>
  </div>
</template>

<style scoped>
.stage-placeholder {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  color: #fff;
}

.stage-placeholder__bg {
  position: absolute;
  inset: 0;
  background: linear-gradient(160deg, #2b3a67 0%, #6b4e71 55%, #d9a7a0 100%);
}

.stage-placeholder__lock {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 96px;
  text-align: center;
}

.stage-placeholder__date {
  font-size: var(--pui-font-subhead);
  letter-spacing: var(--pui-tracking-body);
  opacity: 0.9;
}

.stage-placeholder__clock {
  margin-top: 6px;
  font-size: 4.5rem;
  font-weight: var(--pui-weight-medium);
  line-height: 1;
  letter-spacing: var(--pui-tracking-large);
  font-variant-numeric: tabular-nums;
}

.stage-placeholder__hint {
  margin-top: auto;
  margin-bottom: 56px;
  font-size: var(--pui-font-footnote);
  letter-spacing: var(--pui-tracking-caption);
  opacity: 0.72;
}
</style>
