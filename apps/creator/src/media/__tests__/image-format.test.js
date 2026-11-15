import { describe, it, expect } from 'vitest'
import { classifyImage, computeTargetSize, isInlineUrl, readWebpAlpha } from '../image-format.js'

/* ── 构造 WebP 字节的工具 ─────────────────────────── */

function ascii(target, offset, text) {
  for (let i = 0; i < text.length; i += 1) target[offset + i] = text.charCodeAt(i)
}

function uint32le(target, offset, value) {
  target[offset] = value & 0xff
  target[offset + 1] = (value >> 8) & 0xff
  target[offset + 2] = (value >> 16) & 0xff
  target[offset + 3] = (value >> 24) & 0xff
}

/** 按 RIFF 容器拼装：chunks = [[fourcc, Uint8Array], ...] */
function riff(chunks) {
  const parts = []
  for (const [fourcc, payload] of chunks) {
    const head = new Uint8Array(8)
    ascii(head, 0, fourcc)
    uint32le(head, 4, payload.length)
    parts.push(head, payload)
    if (payload.length % 2 === 1) parts.push(new Uint8Array(1))
  }

  const bodyLength = parts.reduce((sum, p) => sum + p.length, 0)
  const out = new Uint8Array(12 + bodyLength)
  ascii(out, 0, 'RIFF')
  uint32le(out, 4, 4 + bodyLength)
  ascii(out, 8, 'WEBP')

  let offset = 12
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function vp8xPayload({ alpha }) {
  const payload = new Uint8Array(10)
  payload[0] = alpha ? 0x10 : 0x00
  // 画布尺寸字段（3 字节宽 + 3 字节高，均为减一后的值）不是被测目标，留 0 即可
  return payload
}

function vp8lPayload({ alpha }) {
  const payload = new Uint8Array(9)
  payload[0] = 0x2f
  // width-1(14) | height-1(14) | alpha(1) | version(3)
  const bits = ((alpha ? 1 : 0) << 28) | (31 << 14) | 31
  uint32le(payload, 1, bits >>> 0)
  return payload
}

/* ── readWebpAlpha ────────────────────────────── */

describe('readWebpAlpha', () => {
  it('VP8X 带 alpha 标志时为 true', () => {
    expect(readWebpAlpha(riff([['VP8X', vp8xPayload({ alpha: true })]]))).toBe(true)
  })

  it('VP8X 不带 alpha 标志时为 false', () => {
    expect(readWebpAlpha(riff([['VP8X', vp8xPayload({ alpha: false })]]))).toBe(false)
  })

  it('真实文件里 VP8X 常跟随 ALPH 与 VP8，仍能从第一个 chunk 读到标志', () => {
    const bytes = riff([
      ['VP8X', vp8xPayload({ alpha: true })],
      ['ALPH', new Uint8Array([0x00, 0x01, 0x02, 0x03])],
      ['VP8 ', new Uint8Array(10)],
    ])
    expect(readWebpAlpha(bytes)).toBe(true)
  })

  it('VP8X 不在首位时也能找到（chunk 顺序不保证）', () => {
    const bytes = riff([
      ['ALPH', new Uint8Array([0x00, 0x00])],
      ['VP8X', vp8xPayload({ alpha: true })],
    ])
    expect(readWebpAlpha(bytes)).toBe(true)
  })

  it('VP8L 的 alpha 位在 bitstream 头第 28 位', () => {
    expect(readWebpAlpha(riff([['VP8L', vp8lPayload({ alpha: true })]]))).toBe(true)
    expect(readWebpAlpha(riff([['VP8L', vp8lPayload({ alpha: false })]]))).toBe(false)
  })

  it('简单有损格式 VP8 结构上就没有 alpha 通道', () => {
    expect(readWebpAlpha(riff([['VP8 ', new Uint8Array(10)]]))).toBe(false)
  })

  it('不是 WebP 的文件返回 null', () => {
    const png = new Uint8Array(32)
    ascii(png, 0, 'PNG')
    expect(readWebpAlpha(png)).toBeNull()
  })

  it('长度不足或 chunk 尺寸畸形时返回 null，不死循环', () => {
    expect(readWebpAlpha(new Uint8Array(4))).toBeNull()

    const broken = new Uint8Array(24)
    ascii(broken, 0, 'RIFF')
    ascii(broken, 8, 'WEBP')
    ascii(broken, 12, 'JUNK')
    uint32le(broken, 16, 0)
    expect(readWebpAlpha(broken)).toBeNull()
  })

  it('接受 ArrayBuffer 与 Uint8Array 两种入参', () => {
    const bytes = riff([['VP8X', vp8xPayload({ alpha: true })]])
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    expect(readWebpAlpha(buffer)).toBe(true)
    expect(readWebpAlpha(bytes)).toBe(true)
  })
})

/* ── computeTargetSize ────────────────────────── */

describe('computeTargetSize', () => {
  it('横图按长边缩到上限，比例不变', () => {
    expect(computeTargetSize(3200, 2400, 1600)).toEqual({
      width: 1600,
      height: 1200,
      scaled: true,
    })
  })

  it('竖图按高边缩，避免把手机截图拉成扁的', () => {
    expect(computeTargetSize(1000, 4000, 1600)).toEqual({
      width: 400,
      height: 1600,
      scaled: true,
    })
  })

  it('本来就小于上限的图不放大', () => {
    expect(computeTargetSize(800, 600, 1600)).toEqual({
      width: 800,
      height: 600,
      scaled: false,
    })
  })

  it('恰好等于上限时不缩放', () => {
    expect(computeTargetSize(1600, 1600, 1600).scaled).toBe(false)
  })

  it('极端窄条也不会缩出 0 像素', () => {
    const size = computeTargetSize(1, 5000, 1600)
    expect(size.height).toBe(1600)
    expect(size.width).toBe(1)
  })

  it('尺寸缺失时退化成 1×1 而不是 NaN', () => {
    expect(computeTargetSize(undefined, null, 1600)).toEqual({
      width: 1,
      height: 1,
      scaled: false,
    })
  })
})

/* ── classifyImage ────────────────────────────── */

describe('classifyImage', () => {
  it('普通位图走压缩', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp', 'image/avif']) {
      expect(classifyImage({ type })).toBe('raster')
    }
  })

  it('GIF 必须原样保留，重编码会丢帧', () => {
    expect(classifyImage({ type: 'image/gif' })).toBe('gif')
  })

  it('SVG 不支持：canvas 会按 300×150 光栅化，尺寸完全不对', () => {
    expect(classifyImage({ type: 'image/svg+xml' })).toBe('unsupported')
  })

  it('非图片文件直接拒绝', () => {
    expect(classifyImage({ type: 'application/pdf' })).toBe('unsupported')
    expect(classifyImage({ type: '' })).toBe('unsupported')
  })
})

/* ── isInlineUrl ──────────────────────────────── */

describe('isInlineUrl', () => {
  it('内联与外链不查资源表', () => {
    expect(isInlineUrl('data:image/png;base64,AAAA')).toBe(true)
    expect(isInlineUrl('blob:http://localhost/abc')).toBe(true)
    expect(isInlineUrl('https://example.com/a.png')).toBe(true)
  })

  it('真正的 assetId 要走资源表', () => {
    expect(isInlineUrl('ast_1a2b3c')).toBe(false)
    expect(isInlineUrl('')).toBe(false)
    expect(isInlineUrl(null)).toBe(false)
  })
})
