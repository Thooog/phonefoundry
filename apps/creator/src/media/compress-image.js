

import { IMAGE_DEFAULTS } from '@phone-sim/shared'
import { classifyImage, computeTargetSize, readWebpAlpha } from './image-format.js'

/** 探测"画布里到底有没有透明像素"时使用的采样边长 */
const ALPHA_PROBE_EDGE = 64

/**
 * 处理一个图片文件。
 *
 * @param {File} file
 * @param {{maxEdge?: number, quality?: number, mime?: string}} [options]
 * @returns {Promise<{
 *   blob: Blob, mimeType: string, width: number, height: number,
 *   hasAlpha: boolean, fileName: string, originalByteSize: number,
 *   scaled: boolean, keptOriginal: boolean
 * }>}
 */
export async function prepareImage(file, options = {}) {
  const maxEdge = options.maxEdge ?? IMAGE_DEFAULTS.MAX_EDGE
  const quality = options.quality ?? IMAGE_DEFAULTS.QUALITY
  const mime = options.mime ?? IMAGE_DEFAULTS.MIME

  const kind = classifyImage(file)
  if (kind === 'unsupported') {
    throw new Error(`不支持的文件类型：${file.type || file.name || '未知'}`)
  }

  // GIF：原样保留，只需要尺寸
  if (kind === 'gif') {
    const size = await measureImage(file)
    return {
      blob: file,
      mimeType: 'image/gif',
      width: size.width,
      height: size.height,
      hasAlpha: true,
      fileName: file.name ?? '',
      originalByteSize: file.size,
      scaled: false,
      keptOriginal: true,
    }
  }

  const bitmap = await decode(file)
  try {
    const target = computeTargetSize(bitmap.width, bitmap.height, maxEdge)
    const canvas = createCanvas(target.width, target.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('无法创建画布上下文。')
    // 不 fillRect 背景：留空才能保住透明像素
    ctx.drawImage(bitmap, 0, 0, target.width, target.height)

    const encoded = await encodeCanvas(canvas, {
      mime,
      quality,
      sourceMayHaveAlpha: mayHaveAlpha(file.type),
    })

    return {
      blob: encoded.blob,
      mimeType: encoded.mimeType,
      width: target.width,
      height: target.height,
      hasAlpha: encoded.hasAlpha,
      fileName: file.name ?? '',
      originalByteSize: file.size,
      scaled: target.scaled,
      keptOriginal: false,
    }
  } finally {
    bitmap.close?.()
  }
}

/**
 * 把一张画布编码成可落盘的 blob，必要时为透明通道回退。
 *
 * 单独抽出来是为了给「裁剪 / 调节」复用 —— 那边同样要把画布变成资源，
 * 透明 PNG 被压成白底的问题不分来源，回退逻辑不该抄第二遍。
 *
 * @param {HTMLCanvasElement} canvas
 * @param {{mime?: string, quality?: number, sourceMayHaveAlpha?: boolean}} [options]
 * @returns {Promise<{blob: Blob, mimeType: string, hasAlpha: boolean}>}
 */
export async function encodeCanvas(canvas, options = {}) {
  const mime = options.mime ?? IMAGE_DEFAULTS.MIME
  const quality = options.quality ?? IMAGE_DEFAULTS.QUALITY

  let blob = await toBlob(canvas, mime, quality)
  let hasAlpha = false

  if (options.sourceMayHaveAlpha) {
    const alphaFlag = readWebpAlpha(await blob.arrayBuffer())
    hasAlpha = alphaFlag === true

    // 编码器说"没有 alpha"，但画布上可能确实有 —— 只有后者成立才需要回退
    if (alphaFlag === false && hasTransparentPixels(canvas)) {
      blob = await toBlob(canvas, mime, 1)
      hasAlpha = readWebpAlpha(await blob.arrayBuffer()) === true
      if (!hasAlpha) {
        // 无损 WebP 也保不住，就退回 PNG —— 体积变大也比丢透明好
        blob = await toBlob(canvas, 'image/png')
        hasAlpha = true
      }
    }
  }

  return { blob, mimeType: blob.type || mime, hasAlpha }
}

/**
 * 读一张图的尺寸，不解码成可绘制的位图。
 * @param {Blob} file
 * @returns {Promise<{width: number, height: number}>}
 */
export async function measureImage(file) {
  const bitmap = await decode(file)
  try {
    return { width: bitmap.width, height: bitmap.height }
  } finally {
    bitmap.close?.()
  }
}

async function decode(file) {
  if (typeof createImageBitmap !== 'function') {
    throw new Error('当前浏览器不支持图片解码，请换用 Chrome / Edge / Firefox。')
  }
  try {
    return await createImageBitmap(file)
  } catch {
    throw new Error(`无法解码这张图片：${file.name || '未命名文件'}`)
  }
}

function createCanvas(width, height) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

function toBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error('图片编码失败。'))
      },
      type,
      quality,
    )
  })
}

/** 这些源格式才可能带透明通道；JPEG 和 GIF 走这边没有意义 */
function mayHaveAlpha(type) {
  const t = (type ?? '').toLowerCase()
  return t === 'image/png' || t === 'image/webp' || t === 'image/avif' || t === 'image/apng'
}

/**
 * 采样判断画布上是否真有透明像素。
 *
 * 导出给「裁剪 / 调节」用：裁剪后的画布要不要走 alpha 回退，
 * 取决于裁出来的这块区域到底有没有透明像素，而不是原文件的类型。
 *
 * 之所以只认 `alpha === 0`：把画布缩到 64×64 时，插值会让不透明图的
 * 边缘产生半透明像素（比如 250/255），拿 `< 255` 当条件会把所有图
 * 都误判成"需要 alpha"，于是每一张都白跑一次无损回退。
 *
 * @param {HTMLCanvasElement} canvas
 * @returns {boolean}
 */
export function hasTransparentPixels(canvas) {
  const probe = createCanvas(ALPHA_PROBE_EDGE, ALPHA_PROBE_EDGE)
  const ctx = probe.getContext('2d', { willReadFrequently: true })
  if (!ctx) return false
  ctx.drawImage(canvas, 0, 0, probe.width, probe.height)
  const { data } = ctx.getImageData(0, 0, probe.width, probe.height)
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] === 0) return true
  }
  return false
}
