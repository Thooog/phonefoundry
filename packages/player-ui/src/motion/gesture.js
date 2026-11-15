

import { MS_TO_S } from './spring.js'

/** 速度采样窗口（毫秒） */
const VELOCITY_WINDOW_MS = 100
/** 判定为"没有移动"的距离（px），用于区分点击与拖动 */
export const TAP_SLOP = 4

/**
 * 速度追踪器。
 * `timeStamp` 用事件自带的时间戳，而不是 Date.now()：
 * 事件时间戳与 rAF 同源，混用两个时钟会让速度出现负值或尖刺。
 */
export function createVelocityTracker(windowMs = VELOCITY_WINDOW_MS) {
  /** @type {Array<{x:number,y:number,t:number}>} */
  let samples = []

  function reset() {
    samples = []
  }

  function push(x, y, t) {
    samples.push({ x, y, t })
    // 丢掉窗口外的样本，但至少保留两点（否则算不出速度）
    while (samples.length > 2 && t - samples[0].t > windowMs) samples.shift()
  }

  /** @returns {{ vx: number, vy: number }} px/ms */
  function velocity() {
    if (samples.length < 2) return { vx: 0, vy: 0 }
    const first = samples[0]
    const last = samples[samples.length - 1]
    const dt = last.t - first.t
    // dt 为 0 说明两个事件在同一毫秒（合成事件/高频鼠标），此时速度不可信
    if (dt <= 0) return { vx: 0, vy: 0 }
    return { vx: (last.x - first.x) / dt, vy: (last.y - first.y) / dt }
  }

  return { reset, push, velocity }
}

/**
 * iOS 风格的橡皮筋阻尼：越拉越沉。
 *
 * 公式来自 UIScrollView 的经典推导：f(x) = (1 - 1/(x·c/d + 1))·d
 * 性质：
 *   - 起点斜率恰好等于 c（≈0.55），所以拖过界后一开始就"变沉"，不会 1:1 跑掉；
 *   - 之后斜率单调递减，位移永远逼近但不超过 d —— 比 `x * 0.5` 自然得多。
 *
 * @param {number} offset 已经越界的位移（带符号）
 * @param {number} dimension 容器的对应尺寸（px）
 * @param {number} [constant] 阻尼系数 c，越大越硬
 */
export function rubberband(offset, dimension, constant = 0.55) {
  if (!Number.isFinite(offset) || !Number.isFinite(dimension) || dimension <= 0) return 0
  const sign = offset < 0 ? -1 : 1
  const abs = Math.abs(offset)
  return sign * (1 - 1 / ((abs * constant) / dimension + 1)) * dimension
}

/**
 * 在元素上挂一次拖拽。
 *
 * 回调里拿到的是**相对起点的位移**（dx/dy），不是绝对坐标 ——
 * 组件不需要自己减一次起点，避免各写一遍写错。
 *
 * @param {HTMLElement|null} el
 * @param {{
 *   onStart?: (info: {x:number,y:number,event:PointerEvent}) => void,
 *   onMove?: (info: {dx:number,dy:number,event:PointerEvent}) => void,
 *   onEnd?: (info: {dx:number,dy:number,vx:number,vy:number,event:PointerEvent}) => void,
 *   onCancel?: (info: {dx:number,dy:number,event:PointerEvent}) => void,
 * }} handlers
 * @returns {() => void} 解绑函数（务必在 onBeforeUnmount 调用）
 */
export function attachDrag(el, handlers = {}) {
  if (!el) return () => {}

  let active = false
  let pointerId = null
  let startX = 0
  let startY = 0
  let lastDx = 0
  let lastDy = 0
  const tracker = createVelocityTracker()

  function onPointerDown(event) {
    // 只响应主键（鼠标左键 / 单指）。右键、中键不参与拖拽。
    if (event.button !== undefined && event.button !== 0) return
    if (active) return
    active = true
    pointerId = event.pointerId
    startX = event.clientX
    startY = event.clientY
    lastDx = 0
    lastDy = 0
    tracker.reset()
    tracker.push(event.clientX, event.clientY, event.timeStamp)
    try {
      el.setPointerCapture?.(pointerId)
    } catch {
      // 某些环境（合成事件）不支持 capture，退化为普通监听即可
    }
    handlers.onStart?.({ x: event.clientX, y: event.clientY, event })
  }

  function onPointerMove(event) {
    if (!active || event.pointerId !== pointerId) return
    lastDx = event.clientX - startX
    lastDy = event.clientY - startY
    tracker.push(event.clientX, event.clientY, event.timeStamp)
    handlers.onMove?.({ dx: lastDx, dy: lastDy, event })
  }

  function finish(event) {
    if (!active || event.pointerId !== pointerId) return
    active = false
    try {
      el.releasePointerCapture?.(pointerId)
    } catch {
      // 同上，忽略
    }
    const { vx, vy } = tracker.velocity()
    handlers.onEnd?.({ dx: lastDx, dy: lastDy, vx, vy, event })
  }

  function cancel(event) {
    if (!active) return
    active = false
    handlers.onCancel?.({ dx: lastDx, dy: lastDy, event })
  }

  el.addEventListener('pointerdown', onPointerDown)
  el.addEventListener('pointermove', onPointerMove)
  el.addEventListener('pointerup', finish)
  el.addEventListener('pointercancel', cancel)

  return () => {
    el.removeEventListener('pointerdown', onPointerDown)
    el.removeEventListener('pointermove', onPointerMove)
    el.removeEventListener('pointerup', finish)
    el.removeEventListener('pointercancel', cancel)
  }
}

/** px/ms → px/s，弹簧的入口一律用这个换算，别在各处手写 ×1000 */
export function toSpringVelocity(velocityPxPerMs) {
  return velocityPxPerMs * MS_TO_S
}
