<script setup>
import { reactive, computed } from 'vue'

const props = defineProps({
  /** 多张图时横向轮播 */
  mediaAssetIds: { type: Array, required: true },
  /** (assetId) => src */
  resolveSrc: { type: Function, required: true },
  /** 当前页码（受控） */
  page: { type: Number, default: 0 },
  testid: { type: String, default: 'ig-carousel' },
})

const emit = defineEmits(['change'])

const count = computed(() => props.mediaAssetIds.length)
const multi = computed(() => count.value > 1)

const drag = reactive({ active: false, startX: 0, offset: 0, moved: false })
/** 拖拽翻页后吞掉随之而来的 click，避免真实点击被算两次 */
let suppressClick = false

function onDown(e) {
  suppressClick = false
  if (!multi.value) return
  drag.active = true
  drag.startX = e.clientX
  drag.offset = 0
  drag.moved = false
  try {
    e.currentTarget.setPointerCapture?.(e.pointerId)
  } catch {
    /* 合成事件可能没有真实 pointer，捕获会抛，忽略即可 */
  }
}

function onMove(e) {
  if (!drag.active) return
  const dx = e.clientX - drag.startX
  if (Math.abs(dx) > 4) drag.moved = true
  const w = e.currentTarget.offsetWidth || 1
  // 只在当前页左右各自的邻页范围内拖，避免拉穿首尾
  let off = dx
  const min = -((count.value - 1 - props.page) * w)
  const max = props.page * w
  if (off < min) off = min
  if (off > max) off = max
  drag.offset = off
}

function onUp(e) {
  if (!drag.active) return
  const w = e.currentTarget.offsetWidth || 1
  const dx = drag.offset
  const threshold = Math.min(60, w * 0.2)
  let next = props.page
  if (dx <= -threshold) next = Math.min(count.value - 1, next + 1) // 左滑 → 下一页
  else if (dx >= threshold) next = Math.max(0, next - 1) // 右滑 → 上一页
  if (next !== props.page) {
    emit('change', next)
    if (drag.moved) suppressClick = true // 真实拖拽 → 吞掉随后的 click
  }
  drag.active = false
  drag.offset = 0
}

function onClick() {
  if (suppressClick) {
    suppressClick = false
    return
  }
  if (!multi.value) return
  emit('change', (props.page + 1) % count.value) // 轻点 → 下一页（循环）
}
</script>

<template>
  <div
    v-if="count"
    class="pui-ig__media"
    :data-testid="testid"
    :role="multi ? 'group' : undefined"
    @pointerdown="onDown"
    @pointermove="onMove"
    @pointerup="onUp"
    @pointercancel="onUp"
    @click="onClick"
  >
    <div
      class="pui-ig__media-strip"
      :style="
        drag.active
          ? { transform: `translateX(calc(${-page * 100}% + ${drag.offset}px))`, transition: 'none' }
          : { transform: `translateX(-${page * 100}%)` }
      "
    >
      <img
        v-for="(assetId, i) in mediaAssetIds"
        :key="i"
        class="pui-ig__media-img"
        :src="resolveSrc(assetId)"
        alt=""
        draggable="false"
      />
    </div>
    <span v-if="multi" class="pui-ig__media-count">{{ page + 1 }}/{{ count }}</span>
    <span v-if="multi" class="pui-ig__media-dots" aria-hidden="true">
      <i v-for="(_, i) in mediaAssetIds" :key="i" :class="{ 'pui-ig__media-dot--on': i === page }" />
    </span>
  </div>
</template>
