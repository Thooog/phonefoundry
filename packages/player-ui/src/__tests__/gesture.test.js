/**
 * 手势工具的单元测试 —— 只测纯函数（阻尼与速度采样）。
 *
 * 真实的 pointer 事件流不适合在 node 环境模拟（没有 capture、没有布局），
 * 那部分由 scripts/probe-system.mjs 在真 Chrome 里验证。
 */

import { describe, it, expect } from 'vitest'
import { createVelocityTracker, rubberband } from '../motion/gesture.js'

describe('rubberband', () => {
  it('零位移仍是零', () => {
    expect(rubberband(0, 800)).toBe(0)
  })

  it('保留方向符号', () => {
    expect(rubberband(100, 800)).toBeGreaterThan(0)
    expect(rubberband(-100, 800)).toBeLessThan(0)
  })

  it('永远拉不出超过容器尺寸的位移', () => {
    expect(rubberband(100000, 800)).toBeLessThan(800)
    expect(rubberband(-100000, 800)).toBeGreaterThan(-800)
  })

  it('越拉越沉：增量单调递减', () => {
    const d1 = rubberband(50, 800) - rubberband(40, 800)
    const d2 = rubberband(400, 800) - rubberband(390, 800)
    expect(d2).toBeLessThan(d1)
  })

  it('起点斜率等于阻尼系数（越界后一上手就变沉，不是 1:1）', () => {
    // f'(0) = c = 0.55：位移 1px 只走出约 0.55px
    expect(rubberband(1, 800)).toBeCloseTo(0.55, 2)
  })

  it('非法尺寸退化为 0，不返回 NaN', () => {
    expect(rubberband(100, 0)).toBe(0)
    expect(rubberband(NaN, 800)).toBe(0)
  })
})

describe('createVelocityTracker', () => {
  it('没有样本时速度为 0', () => {
    const t = createVelocityTracker()
    expect(t.velocity()).toEqual({ vx: 0, vy: 0 })
  })

  it('单点无法求速度', () => {
    const t = createVelocityTracker()
    t.push(0, 0, 0)
    expect(t.velocity()).toEqual({ vx: 0, vy: 0 })
  })

  it('向上滑动得到负的 vy（px/ms）', () => {
    const t = createVelocityTracker()
    t.push(0, 300, 100)
    t.push(0, 250, 150)
    t.push(0, 200, 200)
    expect(t.velocity().vy).toBeCloseTo(-1, 5)
  })

  it('同一时间戳不产生无穷大速度', () => {
    const t = createVelocityTracker()
    t.push(0, 0, 500)
    t.push(0, -200, 500)
    expect(t.velocity()).toEqual({ vx: 0, vy: 0 })
  })

  it('只保留窗口内样本：先慢后快时取的是"最后"的速度', () => {
    const t = createVelocityTracker(100)
    // 前 500ms 慢慢移动 50px（0.1 px/ms）
    for (let i = 0; i <= 5; i += 1) t.push(0, -i * 10, i * 100)
    // 最后 100ms 快速移动 80px（0.8 px/ms）
    t.push(0, -130, 580)
    t.push(0, -162, 600)
    expect(t.velocity().vy).toBeLessThan(-0.5)
  })
})
