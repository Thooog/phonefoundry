/**
 * 图片「裁剪」：按比例裁框 + 缩放 / 移动。
 *
 * 比例由调用方给：头像是 1:1（圆形预览），X 的主页背景图是 3:1（横幅）。
 * 数学层只认「框的宽高」，所以 1:1 与 3:1 走的是同一套换算，不存在两套裁剪逻辑。
 *
 * 分两层，界线是**能不能在 Node 里跑**：
 *   - 纯计算（贴合、边界夹紧、位移夹紧）→ 有单测；
 *   - 画布操作（烘焙编码）→ 只能在浏览器里跑，靠浏览器探针验。
 *
 * 坐标约定：**框不动，图动**。位移与放大量都是显示像素（图在框里被缩放后的像素），
 * 烘焙时再乘回源图比例。这样 UI 不需要知道原图多大，窗口缩放也不用重算位移。
 */

import { IMAGE_DEFAULTS } from '@phone-sim/shared'
import { computeTargetSize } from './image-format.js'
import { encodeCanvas, hasTransparentPixels } from './compress-image.js'

/** 自由比例裁剪框的最小边长（显示像素）—— 再小就拖不准了 */
export const MIN_CROP_EDGE = 32

/**
 * 把「裁剪框」的两种写法归一成宽高。
 * 传数字按正方形处理（头像 1:1 的老调用方式），传对象直接用其宽高。
 */
function boxDims(box) {
  if (typeof box === 'number') {
    const edge = Math.max(1, Number(box) || 1)
    return { width: edge, height: edge }
  }
  const width = Math.max(1, Number(box?.width) || 1)
  const height = Math.max(1, Number(box?.height) || width)
  return { width, height }
}

/**
 * 让图片「铺满」裁剪框的基准缩放比。
 * 取两个方向里更大的那个 —— 只要小的那个没铺满就会露出底色，裁剪绝不能出现空白。
 *
 * @param {number} width 源图宽
 * @param {number} height 源图高
 * @param {number|{width:number,height:number}} box 裁剪框显示尺寸
 *   （数字 = 正方形边长，兼容头像 1:1 的老调用；背景图这类比例传宽高）
 */
export function coverScale(width, height, box) {
  const w = Math.max(1, Number(width) || 1)
  const h = Math.max(1, Number(height) || 1)
  const target = boxDims(box)
  return Math.max(target.width / w, target.height / h)
}

/**
 * 位移夹紧：图比框大时不许露出底色（最多把边贴到框边）；
 * 图比框小时退化为居中（理论上 zoom ≥ 1 时不会发生）。
 */
export function clampOffset(offset, imageSize, box) {
  const target = boxDims(box)
  const halfX = Math.max(0, (imageSize.width - target.width) / 2)
  const halfY = Math.max(0, (imageSize.height - target.height) / 2)
  // `+ 0` 把 -0 归一成正 0：负零在断言/序列化里会露出来，视觉上没有区别
  return {
    x: Math.min(halfX, Math.max(-halfX, Number(offset?.x) || 0)) + 0,
    y: Math.min(halfY, Math.max(-halfY, Number(offset?.y) || 0)) + 0,
  }
}

/**
 * 把「框 + 缩放 + 位移」换算成源图上的裁切矩形（源图像素）。
 *
 * 反向关系：图在框里的尺寸 = 源尺寸 × scale，框中心对准图中心后再平移 offset。
 * 所以框左上角在源图上的位置就是 (源尺寸 − 框对应源尺寸) / 2 − offset / scale。
 *
 * @param {{width:number,height:number}} source 源图像素尺寸
 * @param {{box?:number|{width:number,height:number}, scale?:number, offset?:{x:number,y:number}}} view
 *   box 为显示像素的裁剪框尺寸，scale 为每源图 1px 对应的显示像素
 * @returns {{x:number,y:number,w:number,h:number}}
 */
export function cropRectOf(source, view = {}) {
  const target = boxDims(view.box)
  const scale = Number(view.scale) || 0
  if (!scale) return { x: 0, y: 0, w: source.width, h: source.height }
  const offset = view.offset ?? { x: 0, y: 0 }
  const w = Math.min(target.width / scale, source.width)
  const h = Math.min(target.height / scale, source.height)
  const maxX = Math.max(0, source.width - w)
  const maxY = Math.max(0, source.height - h)
  const x = Math.min(maxX, Math.max(0, (source.width - w) / 2 - offset.x / scale))
  const y = Math.min(maxY, Math.max(0, (source.height - h) / 2 - offset.y / scale))
  return { x, y, w, h }
}

/**
 * 把图片等比放进一个盒子（只缩不放）。
 * 小图放大只会变糊，预览里放大也没有意义。
 */
export function fitBox(width, height, maxWidth, maxHeight) {
  const w = Math.max(1, Math.round(Number(width) || 1))
  const h = Math.max(1, Math.round(Number(height) || 1))
  const scale = Math.min(maxWidth / w, maxHeight / h, 1)
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
    scale,
  }
}

/** 把裁剪框夹在画面内（尺寸超限先缩，再夹位置） */
export function clampCrop(box, bounds) {
  const w = Math.min(Math.max(box.w, 0), bounds.width)
  const h = Math.min(Math.max(box.h, 0), bounds.height)
  const x = Math.min(Math.max(box.x, 0), Math.max(0, bounds.width - w))
  const y = Math.min(Math.max(box.y, 0), Math.max(0, bounds.height - h))
  return { x, y, w, h }
}

/**
 * 换比例时重新贴合裁剪框：保持中心不变，宽高按新比例重算，最后夹紧。
 * ratio 为 null（自由）时只夹边界，不动形状。
 */
export function applyAspect(box, bounds, ratio) {
  if (!ratio) return clampCrop(box, bounds)

  // 先按宽度推高度；高度装不下就反过来按高度推宽度
  let w = Math.min(Math.max(box.w, MIN_CROP_EDGE), bounds.width)
  let h = w / ratio
  if (h > bounds.height) {
    h = bounds.height
    w = h * ratio
  }
  const cx = box.x + box.w / 2
  const cy = box.y + box.h / 2
  return clampCrop({ x: cx - w / 2, y: cy - h / 2, w, h }, bounds)
}

/**
 * 烘焙：把裁剪矩形变成一张可落盘的图。
 * 返回值与 prepareImage 同形状，好让调用方无缝换成这一步。
 *
 * @param {{
 *   source: ImageBitmap|HTMLCanvasElement, crop: {x,y,w,h},
 *   fileName?: string, originalByteSize?: number,
 *   maxEdge?: number, quality?: number, mime?: string
 * }} input
 */
export async function bakeEditedImage(input) {
  const source = input.source
  const crop = input.crop ?? { x: 0, y: 0, w: source.width, h: source.height }
  const maxEdge = input.maxEdge ?? IMAGE_DEFAULTS.MAX_EDGE

  const target = computeTargetSize(crop.w, crop.h, maxEdge)
  const canvas = document.createElement('canvas')
  canvas.width = target.width
  canvas.height = target.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建画布上下文。')

  ctx.drawImage(source, crop.x, crop.y, crop.w, crop.h, 0, 0, target.width, target.height)

  const encoded = await encodeCanvas(canvas, {
    mime: input.mime ?? IMAGE_DEFAULTS.MIME,
    quality: input.quality ?? IMAGE_DEFAULTS.QUALITY,
    sourceMayHaveAlpha: hasTransparentPixels(canvas),
  })

  return {
    blob: encoded.blob,
    mimeType: encoded.mimeType,
    width: target.width,
    height: target.height,
    hasAlpha: encoded.hasAlpha,
    fileName: input.fileName ?? '',
    originalByteSize: Number(input.originalByteSize) || 0,
    scaled: target.scaled,
    keptOriginal: false,
  }
}
