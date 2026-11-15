

import { ref, onMounted, onBeforeUnmount } from 'vue'

/*
 * 与 tokens.css 的 --pui-device-w/h 保持一致。
 * 必须写死在 JS 里：缩放比例要在排版前算出来，
 * 若改了 tokens，这里的常量必须同步（device - 2×bezel 要等于 390 × 844）。
 */
const DEVICE_W = 410
const DEVICE_H = 864
/** 小于此宽度视为移动端，直接铺满，不显示假刘海 */
const FILL_MAX_WIDTH = 640

const MIN_GUTTER = 12
const MAX_GUTTER = 48
const GUTTER_RATIO = 0.04
const NARROW_MIN_GUTTER = 10
const NARROW_MAX_GUTTER = 20

/**
 * @param {{ forcedMode?: 'auto'|'device'|'fill' }} [options]
 *        forcedMode 非 'auto' 时，mode 恒等于它，scale 仍按该形态算。
 */
export function useShellFit(options = {}) {
  const mode = ref('device')
  const scale = ref(1)
  /** 外部（作品设置）强制要求的形态；'auto' 表示交给视口判断 */
  const forced = ref(options.forcedMode ?? 'auto')

  function computeDeviceScale(vw, vh) {
    // 窄视口用更小的留白档位：430 是"410 机身 + 两侧各 10px"的分界，
    // 低于它时大屏那套 4% 曲线会直接把机身顶到边上
    const narrow = vw < 430
    const minGutter = narrow ? NARROW_MIN_GUTTER : MIN_GUTTER
    const maxGutter = narrow ? NARROW_MAX_GUTTER : MAX_GUTTER
    const gutter = Math.min(maxGutter, Math.max(minGutter, Math.min(vw, vh) * GUTTER_RATIO))
    const availW = Math.max(1, vw - gutter * 2)
    const availH = Math.max(1, vh - gutter * 2)
    // 取宽高两个方向的较小值：保证完整显示、不变形、且不放大
    const next = Math.min(availW / DEVICE_W, availH / DEVICE_H, 1)
    // 下限只防 0，不设 0.4：宁可极小也不能溢出裁切
    return Math.max(0.05, next)
  }

  function measure() {
    if (typeof window === 'undefined') return
    const vw = window.innerWidth
    const vh = window.innerHeight
    const isTouch = window.matchMedia?.('(pointer: coarse)').matches ?? false

    if (forced.value === 'fill') {
      mode.value = 'fill'
      scale.value = 1
      return
    }

    if (forced.value === 'device') {
      mode.value = 'device'
      scale.value = computeDeviceScale(vw, vh)
      return
    }

    if (vw < FILL_MAX_WIDTH || isTouch) {
      mode.value = 'fill'
      scale.value = 1
      return
    }

    mode.value = 'device'
    scale.value = computeDeviceScale(vw, vh)
  }

  /** 外部改了作品设置时调用；值没变就什么都不做，避免无谓的重排 */
  function setForcedMode(next) {
    const value = next === 'device' || next === 'fill' ? next : 'auto'
    if (forced.value === value) return
    forced.value = value
    measure()
  }

  let observer = null
  onMounted(() => {
    measure()
    window.addEventListener('resize', measure, { passive: true })
    window.addEventListener('orientationchange', measure, { passive: true })
    // 横竖屏切换时机在部分浏览器晚于 resize，补一次延迟测量
    observer = window.matchMedia?.('(pointer: coarse)')
    observer?.addEventListener?.('change', measure)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('resize', measure)
    window.removeEventListener('orientationchange', measure)
    observer?.removeEventListener?.('change', measure)
  })

  return { mode, scale, measure, setForcedMode }
}
