

/** 常用参数组。数值是"手感调出来的"，不是物理常数，改动请配着手感一起验。 */
export const SPRING_PRESETS = Object.freeze({
  /** 面板 / 锁屏：略软，收尾有一点点回弹 */
  sheet: { stiffness: 260, damping: 30, mass: 1 },
  /** 通用吸附：干净利落，几乎不过冲 */
  snap: { stiffness: 420, damping: 36, mass: 1 },
  /** 快速跟手（小控件缩放回弹） */
  fast: { stiffness: 600, damping: 40, mass: 1 },
})

/** 每帧最大步长（秒）。掉到 30fps 以下时按 30fps 推进，避免数值发散 */
const MAX_DT = 1 / 30
/** 最小步长：同一帧内多次调用时不至于除零 */
const MIN_DT = 1 / 240

/** 进入静止的距离阈值（px） */
export const REST_DISTANCE = 0.5
/** 进入静止的速度阈值（px/s） */
export const REST_VELOCITY = 1

export const MS_TO_S = 1000

/**
 * 推进一帧。直接改传入的 state（{ value, velocity }），避免每帧分配对象。
 * @param {{value:number, velocity:number}} state
 * @param {number} target
 * @param {{stiffness:number, damping:number, mass:number}} params
 * @param {number} dt 秒
 */
export function stepSpring(state, target, params, dt) {
  const mass = params.mass > 0 ? params.mass : 1
  const force = -params.stiffness * (state.value - target) - params.damping * state.velocity
  state.velocity += (force / mass) * dt
  state.value += state.velocity * dt
  return state
}

/** 是否已经收敛（距离与速度同时足够小） */
export function isAtRest(state, target) {
  return Math.abs(state.value - target) < REST_DISTANCE && Math.abs(state.velocity) < REST_VELOCITY
}

/**
 * 动量投影：以当前速度松手，不考虑阻尼时还能滑多远。
 * 用来判断"快速轻扫"是否足以越过阈值 —— 只看位移会把轻扫判成失败。
 *
 * @param {number} velocityPxPerMs 速度（px/ms）
 * @param {number} decelerationRate 每毫秒衰减系数，Apple 用 0.998
 * @returns {number} 投影距离（px，带符号）
 */
export function projectMomentum(velocityPxPerMs, decelerationRate = 0.998) {
  if (!Number.isFinite(velocityPxPerMs)) return 0
  const rate = Math.min(0.9999, Math.max(0.9, decelerationRate))
  return (velocityPxPerMs * rate) / (1 - rate)
}

/**
 * 驱动一次弹簧收敛。
 *
 * @param {object} options
 * @param {number} options.from 起点
 * @param {number} options.to 目标
 * @param {number} [options.velocity] 初速度（px/s，正方向与位置一致）
 * @param {object} [options.params] SPRING_PRESETS 之一
 * @param {(value:number)=>void} [options.onUpdate]
 * @param {(value:number)=>void} [options.onRest]
 * @param {boolean} [options.reduced] 降级：不跑动画，直接落位并回调
 * @param {(cb:Function)=>number} [options.raf] 便于单测注入
 * @param {(handle:number)=>void} [options.cancel]
 * @returns {{ stop: () => void, readonly value: number, readonly velocity: number }}
 */
export function animateSpring({
  from,
  to,
  velocity = 0,
  params = SPRING_PRESETS.sheet,
  onUpdate,
  onRest,
  reduced = false,
  raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : null,
  cancel = typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : null,
}) {
  if (reduced || typeof raf !== 'function') {
    onUpdate?.(to)
    onRest?.(to)
    return {
      stop() {},
      get value() {
        return to
      },
      get velocity() {
        return 0
      },
    }
  }

  const state = { value: from, velocity }
  let stopped = false
  let handle = 0
  let lastTs = 0

  function frame(ts) {
    if (stopped) return
    if (!lastTs) lastTs = ts
    // 夹住步长：首帧 from==挂载时刻，dt 会是 0，用 MIN_DT 兜住
    const dt = Math.min(MAX_DT, Math.max(MIN_DT, (ts - lastTs) / 1000))
    lastTs = ts

    stepSpring(state, to, params, dt)
    if (isAtRest(state, to)) {
      state.value = to
      state.velocity = 0
      onUpdate?.(to)
      onRest?.(to)
      return
    }
    onUpdate?.(state.value)
    handle = raf(frame)
  }

  handle = raf(frame)

  return {
    stop() {
      stopped = true
      if (typeof cancel === 'function') cancel(handle)
    },
    get value() {
      return state.value
    },
    get velocity() {
      return state.velocity
    },
  }
}

export function shouldComplete({ offset, threshold, velocityPxPerMs, velocityThreshold = 0.5 }) {
  if (offset <= threshold) return true
  if (velocityPxPerMs <= -velocityThreshold) return true
  const projected = offset + projectMomentum(velocityPxPerMs)
  return projected <= threshold
}
