/**
 * 裁剪的纯计算（1:1 方框 + 缩放 / 移动）。
 *
 * 只测不碰 canvas 的那部分 —— 画布相关的（bakeEditedImage）Node 里跑不了，
 * 由浏览器探针兜。位移夹紧与裁切矩形的换算最容易被改坏，又恰好是纯函数，
 * 所以放在这里盯住。
 */

import { describe, it, expect } from 'vitest'
import { coverScale, clampOffset, cropRectOf } from '../image-edit.js'

const SQUARE = { width: 400, height: 400 }
const WIDE = { width: 400, height: 300 }
const TALL = { width: 300, height: 400 }

describe('coverScale：图片铺满方框', () => {
  it('横图按宽度铺满（高度溢出可移动）', () => {
    expect(coverScale(400, 200, 100)).toBeCloseTo(0.5, 5)
  })

  it('竖图按高度铺满', () => {
    expect(coverScale(200, 400, 100)).toBeCloseTo(0.5, 5)
  })

  it('正方形刚好贴合', () => {
    expect(coverScale(400, 400, 100)).toBeCloseTo(0.25, 5)
  })

  it('任何比例下铺满后都不会留出底色', () => {
    for (const src of [WIDE, TALL, SQUARE, { width: 4000, height: 100 }]) {
      const s = coverScale(src.width, src.height, 320)
      expect(src.width * s).toBeGreaterThanOrEqual(320 - 0.001)
      expect(src.height * s).toBeGreaterThanOrEqual(320 - 0.001)
    }
  })

  it('非法尺寸不返回 0 / NaN', () => {
    expect(coverScale(0, 0, 100)).toBe(100)
    expect(Number.isFinite(coverScale('abc', 200, 100))).toBe(true)
  })
})

describe('clampOffset：位移不露出底色', () => {
  it('横图水平方向可动，纵向锁死', () => {
    const image = { width: 533, height: 400 } // 400×300 铺进 400 框
    expect(clampOffset({ x: 999, y: 999 }, image, 400)).toEqual({ x: 66.5, y: 0 })
    expect(clampOffset({ x: -999, y: -999 }, image, 400)).toEqual({ x: -66.5, y: 0 })
  })

  it('竖图纵向可动，横向锁死', () => {
    const image = { width: 400, height: 533 }
    expect(clampOffset({ x: 999, y: 999 }, image, 400)).toEqual({ x: 0, y: 66.5 })
  })

  it('正方形图两个方向都不动', () => {
    expect(clampOffset({ x: 50, y: -50 }, { width: 400, height: 400 }, 400)).toEqual({
      x: 0,
      y: 0,
    })
  })

  it('图比框小（缩放被压到 < 1 的兜底）时退化为居中', () => {
    expect(clampOffset({ x: 30, y: 30 }, { width: 100, height: 100 }, 400)).toEqual({
      x: 0,
      y: 0,
    })
  })
})

describe('cropRectOf：预览位移 → 源图裁切矩形', () => {
  it('不缩放不位移时取居中的正方形（横图上下溢出）', () => {
    // 400×300 铺进 300 框：scale = 1，图宽 400 > 框，只能纵向取 300
    const rect = cropRectOf(WIDE, { box: 300, scale: 1 })
    expect(rect.w).toBeCloseTo(300, 5)
    expect(rect.h).toBeCloseTo(300, 5)
    expect(rect.x).toBeCloseTo(50, 5)
    expect(rect.y).toBeCloseTo(0, 5)
  })

  it('竖图横向取中', () => {
    const rect = cropRectOf(TALL, { box: 300, scale: 1 })
    expect(rect.w).toBeCloseTo(300, 5)
    expect(rect.x).toBeCloseTo(0, 5)
    expect(rect.y).toBeCloseTo(50, 5)
  })

  it('向右拖动图片 → 裁切矩形向左移动（图往右走，取景框相对往左）', () => {
    // 400×300 铺进 100 框：scale=0.5，图宽 200，水平可动 ±50
    const rect = cropRectOf(WIDE, { box: 100, scale: 0.5, offset: { x: 40, y: 0 } })
    expect(rect.w).toBeCloseTo(200, 5)
    // 偏移了 40/0.5 = 80 源图像素：中心 100 → 20
    expect(rect.x).toBeCloseTo(20, 5)
    expect(rect.x + rect.w).toBeLessThanOrEqual(WIDE.width + 0.001)
  })

  it('位移超出可动范围时被夹在图内（不会裁到画布外）', () => {
    const rect = cropRectOf(TALL, { box: 100, scale: 0.5, offset: { x: 9999, y: 9999 } })
    expect(rect.x).toBeGreaterThanOrEqual(-0.001)
    expect(rect.y).toBeGreaterThanOrEqual(-0.001)
    expect(rect.x + rect.w).toBeLessThanOrEqual(TALL.width + 0.001)
    expect(rect.y + rect.h).toBeLessThanOrEqual(TALL.height + 0.001)
  })

  it('scale 为 0（图还没加载）时退回整图，不产生 NaN', () => {
    expect(cropRectOf(WIDE, { box: 150, scale: 0 })).toEqual({
      x: 0,
      y: 0,
      w: 400,
      h: 300,
    })
  })
})

/**
 * 主页背景图走的是同一套函数，只是框从「正方形」换成「3:1 的宽高」。
 * 这几条把"传对象"这条新路径钉住：数字入参是正方形（头像老路径），
 * 对象入参按宽高各算各的，两条路径不能互相串味。
 */
describe('非 1:1 裁剪框（X 主页背景图 3:1）', () => {
  it('coverScale 按宽高分别铺满：竖图填满 3:1 横幅时按高度缩放', () => {
    // 400×400 铺进 300×100：宽要 0.75、高要 0.25，取大者 0.75
    expect(coverScale(400, 400, { width: 300, height: 100 })).toBeCloseTo(0.75, 5)

    expect(coverScale(400, 400, 300)).toBeCloseTo(0.75, 5)
  })

  it('clampOffset 横向锁死、纵向可动（3:1 框里图是「高出一截」）', () => {
    // 图显示 300×300、框 300×100：横向刚好贴合没得动，纵向多出 200 → 可动 ±100
    expect(
      clampOffset({ x: 40, y: 80 }, { width: 300, height: 300 }, { width: 300, height: 100 }),
    ).toEqual({ x: 0, y: 80 })
    // 纵向也给 999 时被夹到 +100
    expect(
      clampOffset({ x: 0, y: 999 }, { width: 300, height: 300 }, { width: 300, height: 100 }),
    ).toEqual({ x: 0, y: 100 })
  })

  it('cropRectOf 裁出 3:1 的矩形而不是正方形', () => {
    // 1200×800 铺进 300×100：scale = 0.25，裁切框 = 1200×400
    const rect = cropRectOf({ width: 1200, height: 800 }, { box: { width: 300, height: 100 }, scale: 0.25 })
    expect(rect.w).toBeCloseTo(1200, 5)
    expect(rect.h).toBeCloseTo(400, 5)
    expect(rect.x).toBeCloseTo(0, 5)
    expect(rect.y).toBeCloseTo(200, 5)
  })

  it('cropRectOf 在 3:1 框里纵向拖动时被夹在图片内', () => {
    // 1200×800 显示成 300×200、框 300×100 → 纵向只多出 50 显示像素，
    // 位移给 100 会被夹到 50，正好顶到图片上沿（取景框上移到底）
    const rect = cropRectOf(
      { width: 1200, height: 800 },
      { box: { width: 300, height: 100 }, scale: 0.25, offset: { x: 0, y: 100 } },
    )
    expect(rect.y).toBeCloseTo(0, 5)
    expect(rect.y + rect.h).toBeLessThanOrEqual(800)
  })
})
