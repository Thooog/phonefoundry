/**
 * 图片格式判定 —— 全是纯函数，可以在 Node 里直接跑测试。
 *
 * 为什么要把这几行从压缩流程里拆出来：
 *   压缩本身依赖 canvas / createImageBitmap，Node 里跑不起来；
 *   而"WebP 头里 alpha 标志在第几位"这种知识恰恰最容易写错、
 *   也最值得被测试盯住。混在一起就只能靠人眼看截图判断对不对。
 *
 * 这里只回答三个问题：
 *   1. 这个文件该怎么处理（保留原格式 / 走位图压缩 / 不支持）
 *   2. 压缩后应该多大（长边不超过 1600）
 *   3. 这段 WebP 字节里带不带 alpha 通道
 */

/**
 * VP8X chunk 第一字节的 bit map（WebP Container Spec）：
 *   |Rsv|I|L|E|X|A|R|
 *   I = ICC profile(0x20), L = Alpha(0x10), E = EXIF(0x08),
 *   X = XMP(0x04), A = Animation(0x02), R = 保留(0x01)
 */
const WEBP_ALPHA_FLAG = 0x10

/** 判断 assetId 是不是"不是资源表里的 asset"：内联 dataURL 或外链 */
const INLINE_URL = /^(data:|blob:|https?:|\/\/)/

/**
 * 内联 URL 不能当 assetId 查资源表 —— 它没有登记项，查也查不到。
 * @param {string|null|undefined} value
 * @returns {boolean}
 */
export function isInlineUrl(value) {
  return typeof value === 'string' && INLINE_URL.test(value)
}

/**
 * 决定一个文件的处理方式。
 *
 * GIF 必须原样保留：canvas 只画第一帧，重编码等于把动图变成静图，
 * 而"照片"里放一张动图是合理的用法。代价是它不参与压缩、体积不受控，
 * 所以在文件大小上单独提示。
 *
 * @param {File|Blob} file
 * @returns {'raster'|'gif'|'unsupported'}
 */
export function classifyImage(file) {
  const type = (file?.type ?? '').toLowerCase()
  if (type === 'image/gif') return 'gif'
  if (!type.startsWith('image/')) return 'unsupported'
  // SVG 走 canvas 会被按"默认 300×150"光栅化，尺寸完全不对；不如直接拒绝
  if (type === 'image/svg+xml') return 'unsupported'
  return 'raster'
}

/**
 * 按长边上限等比缩放。
 *
 * 只缩不放：一张 800px 的图长边小于 1600，放大只会变糊、没有好处。
 *
 * @param {number} width
 * @param {number} height
 * @param {number} maxEdge
 * @returns {{width: number, height: number, scaled: boolean}}
 */
export function computeTargetSize(width, height, maxEdge) {
  const w = Math.max(1, Math.round(Number(width) || 0))
  const h = Math.max(1, Math.round(Number(height) || 0))
  const longest = Math.max(w, h)

  if (!maxEdge || longest <= maxEdge) return { width: w, height: h, scaled: false }

  const scale = maxEdge / longest
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
    scaled: true,
  }
}

/**
 * 从 WebP 字节里读 alpha 标志。
 *
 * 三种容器布局都要认：
 *   VP8X（扩展格式，带 alpha/动画/ICC 时使用）—— 读 flags 字节
 *   VP8L（无损简单格式）—— alpha 藏在 bitstream 头的第 28 位
 *   VP8  （有损简单格式）—— 结构上没有 alpha 通道，直接 false
 *
 * @param {ArrayBuffer|Uint8Array} buffer
 * @returns {boolean|null} null = 不是 WebP，或结构认不出来
 */
export function readWebpAlpha(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  if (bytes.length < 20) return null
  if (readAscii(bytes, 0, 4) !== 'RIFF') return null
  if (readAscii(bytes, 8, 4) !== 'WEBP') return null

  let offset = 12
  // 逐个 chunk 往下走，chunk 之间按偶数对齐
  while (offset + 8 <= bytes.length) {
    const fourcc = readAscii(bytes, offset, 4)
    const size = readUint32LE(bytes, offset + 4)
    const dataStart = offset + 8

    if (fourcc === 'VP8X') {
      if (dataStart >= bytes.length) return null
      return (bytes[dataStart] & WEBP_ALPHA_FLAG) !== 0
    }

    if (fourcc === 'VP8L') {
      // byte0 = 0x2f 签名，随后 32 位：width-1(14) | height-1(14) | alpha(1) | version(3)
      if (dataStart + 5 > bytes.length) return null
      const bits = readUint32LE(bytes, dataStart + 1)
      return ((bits >>> 28) & 1) === 1
    }

    if (fourcc === 'VP8 ') return false

    const next = dataStart + size + (size % 2)
    // 长度字段不可信时必须有兜底，否则畸形文件会让这里死循环
    if (next <= offset) return null
    offset = next
  }

  return null
}

/**
 * 把 ISO 时间换算成更容易读的展示口径 —— 用于提示里说"这张图 1.2MB"。
 * @param {number} bytes
 * @returns {string}
 */
export function imageVolumeLabel(bytes) {
  const n = Number(bytes) || 0
  if (n < 1024) return `${n}B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}KB`
  return `${(n / 1024 / 1024).toFixed(1)}MB`
}

function readAscii(bytes, start, length) {
  let out = ''
  for (let i = 0; i < length; i += 1) {
    const code = bytes[start + i]
    if (code === undefined) return ''
    out += String.fromCharCode(code)
  }
  return out
}

function readUint32LE(bytes, start) {
  return (
    (bytes[start] | 0) |
    ((bytes[start + 1] | 0) << 8) |
    ((bytes[start + 2] | 0) << 16) |
    ((bytes[start + 3] | 0) << 24)
  ) >>> 0
}
