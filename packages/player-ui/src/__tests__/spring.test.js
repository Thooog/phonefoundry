/**
 * 弹簧与动量投影的单元测试。
 *
 * 这些数字直接决定"上滑解锁像不像真的"，用测试锁住三条性质：
 *   1. 收敛 —— 给定目标必须停下，不能抖或漂移
 *   2. 速度继承 —— 松手时的速度必须真的带进动画
 *   3. 阈值判定 —— 快速轻扫也必须能解锁（只看位移会误判）
 */

import { describe, it, expect } from 'vitest'
import {
  SPRING_PRESETS,
  animateSpring,
  isAtRest,
  projectMomentum,
  shouldComplete,
  stepSpring,
} from '../motion/spring.js'

/** 用假时钟驱动 rAF，避免测试依赖真实帧率 */
function createFakeRaf(stepMs = 16) {
  let handle = 0
  const queue = new Map()
  const raf = (cb) => {
    handle += 1
    queue.set(handle, cb)
    return handle
  }
  const cancel = (h) => queue.delete(h)
  /** 推进一帧：把当前队列里的回调全部按时间戳执行 */
  function tick(timestamp) {
    const pending = [...queue.entries()]
    queue.clear()
    for (const [, cb] of pending) cb(timestamp)
  }
  function run(frames = 120) {
    let ts = 0
    for (let i = 0; i < frames; i += 1) {
      ts += stepMs
      tick(ts)
    }
    return ts
  }
  return { raf, cancel, tick, run, size: () => queue.size }
}

describe('stepSpring', () => {
  it('向目标收敛并最终静止', () => {
    const state = { value: 0, velocity: 0 }
    for (let i = 0; i < 600; i += 1) {
      stepSpring(state, -600, SPRING_PRESETS.sheet, 1 / 60)
      if (isAtRest(state, -600)) break
    }
    expect(isAtRest(state, -600)).toBe(true)
    expect(Math.abs(state.value - -600)).toBeLessThan(1)
  })

  it('初速度方向决定先冲过头（这才是弹簧，不是缓动）', () => {
    const state = { value: 0, velocity: -3000 }
    stepSpring(state, -600, SPRING_PRESETS.sheet, 1 / 60)
    expect(state.value).toBeLessThan(0)
  })

  it('dt 恒定时不会发散', () => {
    const state = { value: 0, velocity: 0 }
    for (let i = 0; i < 2000; i += 1) stepSpring(state, 100, SPRING_PRESETS.snap, 1 / 60)
    expect(Number.isFinite(state.value)).toBe(true)
    expect(Math.abs(state.value - 100)).toBeLessThan(1)
  })
})

describe('projectMomentum', () => {
  it('零速度没有动量', () => {
    expect(projectMomentum(0)).toBe(0)
  })

  it('方向与速度一致', () => {
    expect(projectMomentum(-1)).toBeLessThan(0)
    expect(projectMomentum(1)).toBeGreaterThan(0)
  })

  it('非法输入退化为 0，不返回 NaN', () => {
    expect(projectMomentum(NaN)).toBe(0)
    expect(projectMomentum(Infinity)).toBe(0)
  })

  it('大约 500px：1px/ms 的轻扫是一段可观的距离', () => {
    // (1 * 0.998) / 0.002 = 499
    expect(Math.round(projectMomentum(1))).toBe(499)
  })
})

describe('shouldComplete（是否解锁）', () => {
  const threshold = -150

  it('拖过阈值：解锁', () => {
    expect(shouldComplete({ offset: -160, threshold, velocityPxPerMs: 0 })).toBe(true)
  })

  it('位移不够但速度够快：解锁（轻扫）', () => {
    expect(shouldComplete({ offset: -30, threshold, velocityPxPerMs: -1.2 })).toBe(true)
  })

  it('位移不够、速度也慢：回弹', () => {
    expect(shouldComplete({ offset: -30, threshold, velocityPxPerMs: -0.2 })).toBe(false)
  })

  it('位移不够但动量投影能越过：解锁', () => {
    // 投影约 -499，加上 -20 已经远过 -150
    expect(shouldComplete({ offset: -20, threshold, velocityPxPerMs: -0.6 })).toBe(true)
  })

  it('下拉方向（正速度）不算解锁', () => {
    expect(shouldComplete({ offset: -30, threshold, velocityPxPerMs: 1.5 })).toBe(false)
  })
})

describe('animateSpring', () => {
  it('跑到目标并回调 onRest', () => {
    const { raf, cancel, run } = createFakeRaf()
    const seen = []
    let rested = null
    animateSpring({
      from: 0,
      to: -500,
      raf,
      cancel,
      onUpdate: (v) => seen.push(v),
      onRest: (v) => {
        rested = v
      },
    })
    run(200)
    expect(rested).toBe(-500)
    expect(seen.length).toBeGreaterThan(3)
    // 必须是单调向下的过程（没有反弹到正数）
    expect(seen.every((v) => v <= 0)).toBe(true)
  })

  it('速度继承：带初速度时前几帧就把位置带离起点', () => {
    const { raf, cancel, tick } = createFakeRaf()
    let last = 0
    animateSpring({
      from: 0,
      to: -500,
      velocity: -2000,
      raf,
      cancel,
      onUpdate: (v) => {
        last = v
      },
    })
    // 第一帧没有"上一帧时间戳"，只能用最小步长推进；从第二帧起才是真实帧间隔
    tick(16)
    tick(32)
    expect(last).toBeLessThan(-20)
  })

  it('可中断：stop 之后不再回调', () => {
    const { raf, cancel, run } = createFakeRaf()
    let count = 0
    const anim = animateSpring({
      from: 0,
      to: -500,
      raf,
      cancel,
      onUpdate: () => {
        count += 1
      },
    })
    run(3)
    anim.stop()
    const after = count
    run(10)
    expect(count).toBe(after)
  })

  it('reduced 降级：直接落位，不跑帧', () => {
    const { raf, cancel, size } = createFakeRaf()
    let rested = null
    animateSpring({
      from: 0,
      to: -500,
      reduced: true,
      raf,
      cancel,
      onRest: (v) => {
        rested = v
      },
    })
    expect(rested).toBe(-500)
    expect(size()).toBe(0)
  })
})
