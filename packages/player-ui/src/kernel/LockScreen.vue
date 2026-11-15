

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { formatClock } from '@phone-sim/shared'
import { attachDrag, rubberband, toSpringVelocity, TAP_SLOP } from '../motion/gesture.js'
import { animateSpring, shouldComplete, SPRING_PRESETS } from '../motion/spring.js'
import { useReducedMotion } from '../motion/reduced-motion.js'
import { useClock } from './use-clock.js'
import { resolveWallpaper } from '../work/wallpaper.js'
import { extractAccent } from '../work/wallpaper-accent.js'

const props = defineProps({
  workSettings: { type: Object, default: () => ({}) },
  resolveAsset: { type: Function, default: null },
  /**
   * 密码盘已打开（解锁请求被密码盘接管，锁屏没有真正消失）。
   * 此时锁屏必须复位到原位：上滑解锁会把内容推到 -height 并停在那里等卸载，
   * 但设了密码时锁屏并不卸载 —— 不复位的话，点取消后露出的锁屏内容还在屏幕外，
   * 而且此时任意一次点击的 offset 都已越过阈值，shouldComplete 会再判一次"完成"，
   * 密码盘会被反复弹出来（表现为"点取消回不去锁屏，要点好几下"）。
   */
  passcodeOpen: { type: Boolean, default: false },
})

const emit = defineEmits(['unlock'])

/** 越界拖动时的阻尼：越小越"拉不动" */
const RUBBER_CONSTANT = 0.5
/** 位移阈值占屏高比例：18% 大约是一次自然的短上滑 */
const COMPLETE_RATIO = 0.18

const root = ref(null)
const offset = ref(0)
const height = ref(700)
const dragging = ref(false)
const unlocking = ref(false)
const now = useClock()
const reduced = useReducedMotion()

let spring = null
let detach = null
/** 拖动超过 TAP_SLOP 后要吞掉尾随的 click，否则松手会被当成"点了提示"再解锁一次 */
let moved = false

const wallpaper = computed(() => resolveWallpaper(props.workSettings, props.resolveAsset))
const clock = computed(() => formatClock(now.value, props.workSettings?.timeFormat ?? 'h24'))
const progress = computed(() => Math.min(1, Math.max(0, -offset.value / Math.max(1, height.value))))

const accent = ref('')
const accentStyle = computed(() => (accent.value ? { '--pui-lock-accent': accent.value } : {}))

watch(
  [wallpaper, () => props.workSettings?.wallpaper],
  async ([wall, wp], _, onCleanup) => {
    if (!wall.isImage) {
      accent.value = wall.accent ?? ''
      return
    }
    // asset 壁纸：resolveAsset 在 wallpaper 里已经算过一次 url，但这里拿不到原始返回值，
    // 简单起见再解析一次（纯函数，成本可忽略）
    let url = null
    try {
      url = wp?.type === 'asset' && wp.assetId && props.resolveAsset ? props.resolveAsset(wp.assetId) : null
    } catch {
      url = null
    }
    let current = true
    onCleanup(() => { current = false })
    accent.value = ''
    const extracted = url ? await extractAccent(url) : null
    if (current) accent.value = extracted ?? ''
  },
  { immediate: true },
)

function onStart() {
  if (reduced.value) return
  spring?.stop()
  spring = null
  height.value = root.value?.clientHeight || 700
  dragging.value = true
  moved = false
  // 重新武装：unlocking 是"防止同一次手势重复触发解锁"的临时闩锁，
  // 必须在每次新手势开始时复位 —— 否则点取消回到锁屏后它一直为 true，
  // 导致下一次上滑 onStart 直接 early-return，锁屏彻底失去响应。
  unlocking.value = false
}

// 密码盘打开的瞬间（锁屏被它盖住，用户看不见）把位移归零：
// 取消密码后锁屏就是完整的原位状态，而不是"内容停在屏幕外"。
watch(
  () => props.passcodeOpen,
  (open) => {
    if (!open) return
    spring?.stop()
    spring = null
    dragging.value = false
    unlocking.value = false
    moved = false
    offset.value = 0
  },
)

function onMove({ dy }) {
  if (!dragging.value) return
  if (Math.abs(dy) > TAP_SLOP) moved = true
  if (dy <= 0) {
    // 上滑：严格 1:1，且不允许拖过一整屏
    offset.value = Math.max(dy, -height.value)
  } else {
    // 下拉：橡皮筋阻尼，手感"越拉越沉"，松手弹回
    offset.value = rubberband(dy, height.value, RUBBER_CONSTANT)
  }
}

function onEnd({ dy, vy }) {
  if (!dragging.value) return
  dragging.value = false
  if (reduced.value) {
    settle(Math.abs(dy) > 24 || vy < -0.3)
    return
  }
  const complete = shouldComplete({
    offset: offset.value,
    threshold: -height.value * COMPLETE_RATIO,
    // 下拉方向的速度不应该触发解锁
    velocityPxPerMs: Math.min(0, vy),
  })
  settle(complete, vy)
}

function onCancel() {
  if (!dragging.value) return
  dragging.value = false
  settle(false)
}

/** 松手后的收敛：目标是"解锁完成"或"回原位" */
function settle(complete, velocityPxPerMs = 0) {
  if (reduced.value) {
    if (complete) unlockNow()
    else offset.value = 0
    return
  }

  const target = complete ? -height.value : 0
  spring?.stop()
  spring = animateSpring({
    from: offset.value,
    to: target,
    velocity: toSpringVelocity(velocityPxPerMs),
    params: SPRING_PRESETS.sheet,
    onUpdate: (value) => {
      offset.value = value
    },
    onRest: () => {
      spring = null
      if (complete) unlockNow()
    },
  })
}

function unlockNow() {
  if (unlocking.value) return
  unlocking.value = true
  emit('unlock')
}

function onHintClick() {
  if (moved) {
    moved = false
    return
  }
  if (reduced.value) {
    unlockNow()
    return
  }
  // 非降级环境：走一次"完整上滑"的动画，避免瞬间消失
  height.value = root.value?.clientHeight || 700
  settle(true, -1.2)
}

onMounted(() => {
  detach = attachDrag(root.value, { onStart, onMove, onEnd, onCancel })
})

onBeforeUnmount(() => {
  detach?.()
  spring?.stop()
})
</script>

<template>
  <div
    ref="root"
    class="pui-lock"
    data-testid="lock-screen"
    :style="accentStyle"
    :data-dragging="dragging ? 'true' : 'false'"
    :data-offset="Math.round(offset)"
    :data-progress="progress.toFixed(3)"
    :data-unlocking="unlocking ? 'true' : 'false'"
    :data-reduced="reduced ? 'true' : 'false'"
  >
    <!-- 壁纸单独一层：轻微视差（内容上移时壁纸只缩一点），比整屏平移更有纵深 -->
    <div
      class="pui-lock__wall"
      :style="{
        backgroundImage: wallpaper.backgroundImage,
        backgroundSize: wallpaper.isImage ? 'cover' : undefined,
        transform: `scale(${1 + progress * 0.06})`,
      }"
    ></div>
    <div class="pui-lock__scrim" aria-hidden="true"></div>

    <div
      class="pui-lock__content"
      :style="{
        transform: `translate3d(0, ${offset}px, 0)`,
        opacity: String(1 - progress * 0.35),
      }"
    >
      <button
        type="button"
        class="pui-lock__hint"
        data-testid="lock-hint"
        @click="onHintClick"
      >
        {{ reduced ? '轻点解锁' : '向上轻扫以解锁' }}
      </button>
      <p class="pui-lock__clock" data-testid="lock-clock">{{ clock }}</p>
    </div>

    <button
      type="button"
      class="pui-lock__corner pui-lock__corner--left"
      data-testid="lock-torch"
      aria-label="手电筒"
      @pointerdown.stop
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M9.4 3.4h5.2q.6 0 .7.6v1.4l-1.7 2.2v8.5a2.7 2.7 0 0 1-2.7 2.7h-.8a2.7 2.7 0 0 1-2.7-2.7V7.6L6.7 5.4V4q0-.6.7-.6z"
          fill="currentColor"
        />
        <path d="M9.4 6.8h5.2" stroke="rgba(0,0,0,0.18)" stroke-width="0.9" />
      </svg>
    </button>
    <button
      type="button"
      class="pui-lock__corner pui-lock__corner--right"
      data-testid="lock-camera"
      aria-label="相机"
      @pointerdown.stop
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M8.4 6.1 9.2 4.5q.2-.4.7-.4h4.2q.5 0 .7.4l.8 1.6h2.7a2 2 0 0 1 2 2v8.7a2 2 0 0 1-2 2H5.7a2 2 0 0 1-2-2V8.1a2 2 0 0 1 2-2z"
          fill="currentColor"
        />
        <circle cx="12" cy="12.4" r="3.3" fill="none" stroke="rgba(0,0,0,0.22)" stroke-width="1.4" />
      </svg>
    </button>
  </div>
</template>

<style>
.pui-lock {
  position: absolute;
  inset: 0;
  overflow: hidden;
  /* 锁屏自己吃掉触摸，避免穿透到下层桌面触发图标 */
  touch-action: none;
  background: #101014;
  /* 提示语与时钟共用的强调色：preset 壁纸由 accent 字段提供，asset 壁纸 canvas 取主色，
   * 都拿不到时用这个中性蓝灰兜底 */
  --pui-lock-accent: rgba(71, 84, 97, 0.95);
}

.pui-lock__wall {
  position: absolute;
  inset: 0;
  background-position: center;
  background-size: cover;
  transform-origin: center 40%;
  will-change: transform;
}

.pui-lock__scrim {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    to bottom,
    rgba(255, 255, 255, 0.26) 0%,
    rgba(255, 255, 255, 0.15) 42%,
    rgba(255, 255, 255, 0.2) 100%
  );
  pointer-events: none;
}

.pui-lock__content {
  position: absolute;
  top: calc(var(--pui-statusbar-h) + 14px);
  left: 0;
  right: 0;
  text-align: center;
  color: rgba(0, 0, 0, 0.62);
  will-change: transform;
}

.pui-lock__hint {
  display: inline-block;
  margin: 0 0 2px;
  padding: 6px 16px;
  border: 0;
  background: transparent;

  color: var(--pui-lock-accent);
  font: inherit;

  font-size: 1.15rem;
  font-weight: var(--pui-weight-medium);
  letter-spacing: 0.02em;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.pui-lock__clock {
  margin: 0;
  font-size: 5.6rem;
  line-height: 1.04;
  font-weight: var(--pui-weight-semibold);
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
  color: var(--pui-lock-accent);
}

/* 左下/右下圆形按钮（浅灰半透明圆底 + 白色图标；
 * 尺寸与位置不变：直径 48px、距边 48px、底缘距屏底 48px） */
.pui-lock__corner {
  position: absolute;
  bottom: calc(var(--pui-homebar-h) + 14px);
  width: 48px;
  height: 48px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 50%;
  background: rgba(128, 136, 140, 0.56);
  -webkit-backdrop-filter: blur(4px);
  backdrop-filter: blur(4px);
  box-shadow: none;
  color: #fff;
  font: inherit;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition:
    transform 120ms var(--pui-ease-out),
    background-color 120ms linear;
  will-change: transform;
}

.pui-lock__corner svg {
  width: 20px;
  height: 20px;
}

.pui-lock__corner--left {
  left: 48px;
}

.pui-lock__corner--right {
  right: 48px;
}

/* 按压反馈：缩放 + 提亮（无实际功能） */
.pui-lock__corner:active {
  transform: scale(0.88);
  background: rgba(160, 168, 172, 0.68);
}
</style>
