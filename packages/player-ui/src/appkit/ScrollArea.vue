

<script setup>
import { ref, watch, onMounted, onBeforeUnmount, nextTick, inject } from 'vue'

const props = defineProps({
  /** 是否在顶部/底部显示渐隐遮罩 */
  fade: { type: Boolean, default: true },
  /** 底部额外留白 px（有固定底栏时用） */
  paddingBottom: { type: Number, default: 0 },
  /** 顶部额外留白 px（有固定导航栏时用） */
  paddingTop: { type: Number, default: 0 },
  /**
   * 滚动位置记忆键，如 'kakaotalk:list'。
   * 同一屏被反复挂载（列表 ↔ 详情用 v-if 互斥）时，靠它把 scrollTop 还原回去。
   */
  scrollKey: { type: String, default: '' },
  /**
   * 初始定位锚点：一个 DOM 元素 id（如 'ig-post-xxx'）。
   * 挂载后（无 scrollKey 记忆时）把该元素滚到视口顶部，用于"从这条帖子开始看时间线"。
   * 优先 scrollKey 的滚动记忆：返回原地优先于锚点定位。
   */
  anchor: { type: String, default: '' },

  minScroll: { type: Number, default: 0 },
})

const emit = defineEmits(['scroll', 'reach-bottom'])

/** 由 PhoneSimulator 注入（create-runtime 里的滚动记忆）；缺失时退化为不记忆 */
const scrollMemory = inject('phoneScrollMemory', null)

const el = ref(null)
const atTop = ref(true)
const atBottom = ref(false)
/** minScroll 补的空白高度；随内容实际高度自纠（图片异步解码撑高后多余部分会退掉） */
const padHeight = ref(0)
let raf = 0
let bottomFired = false
let padRaf = 0

function measure() {
  const node = el.value
  if (!node) return
  applyMinScroll(node)
  const max = node.scrollHeight - node.clientHeight
  atTop.value = node.scrollTop <= 1
  // 内容不足一屏时，视作"已经到底"，否则底部渐隐会一直挂着
  atBottom.value = max <= 1 || node.scrollTop >= max - 1
  if (!atBottom.value) bottomFired = false
  emit('scroll', { scrollTop: node.scrollTop, scrollHeight: node.scrollHeight })
}

/**
 * 保证「至少能滚 minScroll px」：自然滚动量不够就在内容末尾补空白。
 * natural 要把当前已补的 pad 减掉（scrollHeight 含它），否则会越补越多；
 * 补完 scrollHeight 变了，下一帧重测一次让 at-top/at-bottom 用上最终值——
 * 两次之后数值稳定，不会循环。
 */
function applyMinScroll(node) {
  const want = Math.max(0, Math.round(props.minScroll))
  if (!want) {
    if (padHeight.value !== 0) padHeight.value = 0
    return
  }
  const natural = node.scrollHeight - padHeight.value - node.clientHeight
  const pad = Math.max(0, want - natural)
  if (pad !== padHeight.value) {
    padHeight.value = pad
    if (!padRaf) {
      padRaf = requestAnimationFrame(() => {
        padRaf = 0
        measure()
      })
    }
  }
}

/**
 * 还原上次的滚动位置。
 *
 * 为什么要等两帧：挂载时列表项已经渲染，但字体尚未排版完、图片也还没撑开
 * （作品端用的是 dataURL，解码是异步的）。第一帧读 scrollHeight 会偏小，
 * 赋值 scrollTop 会被浏览器夹到"当前最大值"，结果停在半路。
 * 双 rAF 之后再赋值，尺寸才是定稿的。
 */
async function restoreScroll() {
  if (!props.scrollKey || !scrollMemory) return
  const top = scrollMemory.recallScroll(props.scrollKey)
  if (!top) return
  await nextTick()
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const node = el.value
      if (!node) return
      node.scrollTop = top
      // 还原后重算渐隐与 at-top/at-bottom，否则顶部遮罩状态是旧的
      measure()
    })
  })
}

/**
 * 锚点定位：把 anchor 指向的元素滚到视口顶部。
 * 与 restoreScroll 同款双 rAF —— 图片（dataURL 异步解码）会把内容撑高，
 * 必须等尺寸定稿再读 offsetTop，否则会停在半路。
 */
async function anchorScroll() {
  if (!props.anchor) return
  // 有 scrollKey 记忆时优先还原记忆（返回原地），不做锚点定位
  if (props.scrollKey && scrollMemory && scrollMemory.recallScroll(props.scrollKey)) return
  await nextTick()
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const node = el.value
      const target = node?.querySelector?.(`#${CSS.escape(props.anchor)}`) ?? null
      if (!node || !target) return
      // 用 getBoundingClientRect 差值而非 offsetTop：offsetTop 相对 offsetParent，
      // 与 viewport 的 scrollTop 基准不一致，会算错。
      node.scrollTop += target.getBoundingClientRect().top - node.getBoundingClientRect().top
      measure()
    })
  })
}

function onScroll() {
  // 滚动事件高频，用 rAF 合并，避免每帧多次读取 layout 造成强制同步布局
  if (raf) return
  raf = requestAnimationFrame(() => {
    raf = 0
    measure()
    if (props.scrollKey && scrollMemory) {
      scrollMemory.rememberScroll(props.scrollKey, el.value?.scrollTop ?? 0)
    }
    if (atBottom.value && !bottomFired) {
      bottomFired = true
      emit('reach-bottom')
    }
  })
}

onMounted(() => {
  measure()
  el.value?.addEventListener('scroll', onScroll, { passive: true })
  void restoreScroll()
  void anchorScroll()
})

// minScroll 变化（比如父组件量出了新的吸顶目标量）也要重测；

watch(
  () => props.minScroll,
  () => {
    requestAnimationFrame(measure)
  },
)

onBeforeUnmount(() => {
  el.value?.removeEventListener('scroll', onScroll)
  if (raf) cancelAnimationFrame(raf)
  if (padRaf) cancelAnimationFrame(padRaf)
})

defineExpose({
  el,
  measure,
  scrollToTop: () => el.value?.scrollTo({ top: 0 }),
  scrollToBottom: () => {
    const node = el.value
    if (node) node.scrollTop = node.scrollHeight
  },
})
</script>

<template>
  <div
    class="pui-scroll"
    :class="{ 'pui-scroll--fade': fade }"
    :data-at-top="atTop ? 'true' : 'false'"
    :data-at-bottom="atBottom ? 'true' : 'false'"
    :style="{ '--pui-scroll-pt': `${paddingTop}px`, '--pui-scroll-pb': `${paddingBottom}px` }"
  >
    <div ref="el" class="pui-scroll__viewport">
      <slot />
      <!-- minScroll 补的空白：只在内容不够滚时出现 -->
      <div v-if="padHeight > 0" class="pui-scroll__pad" :style="{ height: `${padHeight}px` }" aria-hidden="true"></div>
    </div>
  </div>
</template>

<style>
.pui-scroll {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
}

.pui-scroll__viewport {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  padding-top: var(--pui-scroll-pt, 0px);
  padding-bottom: var(--pui-scroll-pb, 0px);
  scrollbar-width: none;
}

.pui-scroll__viewport::-webkit-scrollbar {
  width: 0;
  height: 0;
}

/*
 * 渐隐遮罩画在容器上而不是视口上：
 * 视口内是滚动内容，遮罩若跟着内容走就会被一起滚走。
 * 用一条 4 停靠点的渐变同时表达"顶部该不该淡"和"底部该不该淡"，
 * 两端都为 0 时渐变退化成纯色，等于没有遮罩。
 */
.pui-scroll--fade .pui-scroll__viewport {
  mask-image: linear-gradient(
    to bottom,
    transparent 0,
    #000 var(--pui-fade-top, 0px),
    #000 calc(100% - var(--pui-fade-bottom, 0px)),
    transparent 100%
  );
}

.pui-scroll--fade[data-at-top='false'] .pui-scroll__viewport {
  --pui-fade-top: 14px;
}

.pui-scroll--fade[data-at-bottom='false'] .pui-scroll__viewport {
  --pui-fade-bottom: 20px;
}
</style>
