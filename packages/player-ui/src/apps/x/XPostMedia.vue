

<script setup>
import { ref, computed, watch, onMounted, nextTick } from 'vue'

const props = defineProps({
  /** mediaAssetIds 数组 */
  mediaAssetIds: { type: Array, required: true },
  /** (assetId) => src */
  resolveSrc: { type: Function, required: true },
  /** 单图是否仍包一层圆角容器（feed 单图的旧规矩；多图与详情页不适用） */
  bordered: { type: Boolean, default: true },
  /** 详情查看器形态（黑底、信箱式居中、下方圆点） */
  dark: { type: Boolean, default: false },
  initialIndex: { type: Number, default: 0 },
  testid: { type: String, default: 'x-media' },
})
const emit = defineEmits(['open-image', 'page'])

const ids = computed(() => props.mediaAssetIds ?? [])
const count = computed(() => ids.value.length)
const multi = computed(() => count.value > 1)

const scroller = ref(null)
const page = ref(0)

/*
 * feed 多图滑动带当前停在第几页 —— 给调用方（XPostItem）用来决定作者头像的尺寸：
 * 整宽滑动带的图一旦翻走会钻到头像列下方，头像（40px 高）底部比图顶还低，
 * 视觉上「头像压着图」。所以页码 > 0 期间调用方把头像缩小让位，回到第 0 页恢复。
 * dark（详情查看器）的圆点也复用同一个 page，不额外上报。
 */

/** 页码变化就上报（初始 0 不用报，调用方默认就是第 0 页的形态） */
watch(page, (value) => emit('page', value))

/** 拖拽后吞掉 click，避免滑一下被当成点进详情 */
let suppressClick = false
/** 鼠标拖拽进行中（仅 mouse；触屏走原生滚动） */
const dragging = ref(false)
let downX = 0
let downScrollLeft = 0
let moved = false

function onDown(e) {
  suppressClick = false
  moved = false
  downX = e.clientX
  /* 触屏交给原生滚动；鼠标自己实现 drag-to-scroll */
  if (multi.value && e.pointerType === 'mouse' && scroller.value) {
    dragging.value = true
    downScrollLeft = scroller.value.scrollLeft
  }
}

function onMove(e) {
  if (Math.abs(e.clientX - downX) > 4) moved = true
  if (dragging.value && scroller.value) {
    if (moved && !scroller.value.hasPointerCapture(e.pointerId)) scroller.value.setPointerCapture(e.pointerId)
    scroller.value.scrollLeft = downScrollLeft - (e.clientX - downX)
  }
}

function onUp() {
  if (moved) suppressClick = true
  if (!dragging.value) return
  dragging.value = false
  /* 详情形态（吸附翻页）：鼠标拖拽松手后平滑吸附到最近一张；
     触屏由 CSS scroll-snap mandatory 原生处理，不经过这里。 */
  const el = scroller.value
  if (!el || !props.dark || !multi.value) return
  let target = el.scrollLeft
  let bestDist = Infinity
  for (let i = 0; i < count.value; i++) {
    const slide = el.children?.[i]
    if (!slide) continue
    const left = slide.offsetLeft - el.offsetLeft
    const d = Math.abs(left - el.scrollLeft)
    if (d < bestDist) {
      bestDist = d
      target = left
    }
  }
  el.scrollTo({ left: target, behavior: 'smooth' })
}

function onClick(e) {
  if (suppressClick) {
    suppressClick = false
    e.stopPropagation()
    return
  }
  if (props.dark) return
  const image = e.target.closest?.('[data-image-index]')
  if (!image) return
  e.stopPropagation()
  emit('open-image', Number(image.dataset.imageIndex))
}

onMounted(async () => {
  await nextTick()
  if (!props.dark || !scroller.value) return
  const index = Math.max(0, Math.min(count.value - 1, props.initialIndex))
  const slide = scroller.value.children[index]
  if (slide) scroller.value.scrollLeft = slide.offsetLeft - scroller.value.offsetLeft
  page.value = index
})

function onScroll() {
  const el = scroller.value
  if (!el || !multi.value) return
  const max = el.scrollWidth - el.clientWidth
  if (max <= 0) {
    if (page.value !== 0) page.value = 0
    return
  }
  const best = Math.round((el.scrollLeft / max) * (count.value - 1))
  if (best !== page.value) page.value = best
}
</script>

<template>
  <div
    v-if="count"
    class="pui-xm"
    :class="{ 'pui-xm--bordered': bordered && !multi && !dark, 'pui-xm--dark': dark }"
  >
    <div
      ref="scroller"
      class="pui-xm__track"
      :class="[
        dark ? 'pui-xm__track--stage' : { 'pui-xm__track--scroll': multi },
        { 'pui-xm__track--drag': dragging },
      ]"
      :data-testid="testid"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onUp"
      @scroll.passive="onScroll"
      @click="onClick"
    >
      <div
        v-for="(assetId, i) in ids"
        :key="i"
        class="pui-xm__slide"
        :class="{ 'pui-xm__slide--multi': !dark && multi }"
      >
        <img class="pui-xm__img" :src="resolveSrc(assetId)" :data-image-index="i" :role="dark ? undefined : 'button'" :tabindex="dark ? undefined : 0" :aria-label="dark ? undefined : `查看第${i + 1}张图片`" alt="" draggable="false" @keydown.enter.prevent="!dark && emit('open-image', i)" @keydown.space.prevent="!dark && emit('open-image', i)" />
      </div>
    </div>

    <span v-if="dark && multi" class="pui-xm__dots" aria-hidden="true">
      <i
        v-for="(_, i) in ids"
        :key="i"
        class="pui-xm__dot"
        :class="{ 'pui-xm__dot--on': i === page }"
      />
    </span>
  </div>
</template>

<style>
.pui-xm {
  margin-top: 8px;
}

.pui-xm--bordered {
  border: 1px solid #eff3f4;
  border-radius: 16px;
  overflow: hidden;
}

.pui-xm__track {
  display: flex;
}

/* ── feed 多图：整宽滑动带 ──
   带子横向自由滚动（不吸附，停在哪都行）；左右 inset 由调用方注入
   （XPostItem 传「正文列缩进」，让第一张图与正文对齐、带子顶到卡片边），
   留白上也能按住拖；圆角长在每张 slide 自己身上，外层不套容器。 */
.pui-xm__track--scroll {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
  column-gap: 4px;
  cursor: grab;
  padding: 4px var(--xm-inset-r, 14px) 4px var(--xm-inset-l, 14px);
}

.pui-xm__track--scroll::-webkit-scrollbar {
  display: none;
}

/* 鼠标拖拽中 */
.pui-xm__track--drag {
  cursor: grabbing;
  user-select: none;
}

.pui-xm__slide {
  flex: 1 1 auto;
}

.pui-xm__slide--multi {
  flex: 0 0 auto;
  height: 224px;
  border-radius: 16px;
  overflow: hidden;
  background: #f7f9f9;
}

.pui-xm__img {
  display: block;
  width: 100%;
  height: auto;
}

.pui-xm__slide--multi .pui-xm__img {
  width: auto;
  height: 100%;
}

/* ── 详情查看器：黑底信箱式舞台 ──
   组件纵向填满 .pui-xd__stage：track 弹性占满、图片按原始比例居中
   （不裁切、无圆角、四周留黑）；多图吸附翻页（一屏一张）。 */
.pui-xm--dark {
  position: relative;
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  min-height: 0;
  margin-top: 0;
}

.pui-xm__track--stage {
  flex: 1 1 auto;
  min-height: 0;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
  scroll-snap-type: x mandatory;
  cursor: grab;
}

.pui-xm__track--stage::-webkit-scrollbar {
  display: none;
}

/* 鼠标拖拽中：关掉 snap（否则 scrollLeft 会被拉回吸附点），松手由脚本归位 */
.pui-xm__track--stage.pui-xm__track--drag {
  scroll-snap-type: none;
  cursor: grabbing;
  user-select: none;
}

.pui-xm--dark .pui-xm__slide {
  flex: 0 0 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-width: 0;
  scroll-snap-align: center;
}

.pui-xm--dark .pui-xm__img {
  /* 不改图片尺寸：按原始比例显示，只有超出屏幕时才被 max-width/max-height 收住。
     大图因此自然撑满屏宽 → 左右贴屏幕边缘；小图不做放大。 */
  width: auto;
  height: auto;
  max-width: 100%;
  max-height: 100%;
  background: #000;
}

/* 圆点：舞台铺满整屏后，它要停在底部信息区上方；信息区被点击隐藏时落到底部 */
.pui-xm__dots {
  position: absolute;
  right: 0;
  bottom: var(--xm-dots-bottom, var(--xm-foot-h, 200px));
  left: 0;
  display: flex;
  justify-content: center;
  gap: 6px;
  padding: 14px 0 4px;
}

.pui-xm__dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #3e4144;
}

.pui-xm__dot--on {
  background: #fff;
}
</style>
