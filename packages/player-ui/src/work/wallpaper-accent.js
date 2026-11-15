/**
 * 壁纸强调色提取（canvas 主色分析）。
 *
 * 用途：用户上传的图片壁纸没有手工指定的 accent，锁屏的提示语/时钟
 * 需要从壁纸里取一个"色相呼应且可读"的强调色。
 *
 * 策略：
 *  1. 缩到 32×32 采样整图平均色作为主色（平均会偏灰，保留原色相、
 *     饱和度夹在 0.1~0.45 之间：太灰没有"呼应感"，太艳会喧宾夺主）；
 *  2. 顶部 1/3（时钟所在区域）平均亮度决定明度方向：
 *     背景亮 → 压暗强调色（L=0.32），背景暗 → 提亮（L=0.76）；
 *  3. 任何异常（解码失败、跨域污染、透明图）都 resolve(null)，
 *     调用方回退到默认强调色，绝不让锁屏字消失。
 */

/** RGB([0-255]³) → [h(0-360), s(0-1), l(0-1)] */
function rgbToHsl(r, g, b) {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6
  else if (max === gn) h = ((bn - rn) / d + 2) / 6
  else h = ((rn - gn) / d + 4) / 6
  return [h * 360, s, l]
}

/** [h(0-360), s(0-1), l(0-1)] → '#rrggbb' */
function hslToHex(h, s, l) {
  const hue = ((h % 360) + 360) % 360 / 360
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const channel = (t) => {
    let tt = t
    if (tt < 0) tt += 1
    if (tt > 1) tt -= 1
    if (tt < 1 / 6) return p + (q - p) * 6 * tt
    if (tt < 1 / 2) return q
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6
    return p
  }
  const toHex = (v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')
  return `#${toHex(channel(hue + 1 / 3))}${toHex(channel(hue))}${toHex(channel(hue - 1 / 3))}`
}

/**
 * 从图片提取强调色。
 * @param {string} url 图片地址（dataURL 或同源相对路径）
 * @returns {Promise<string|null>} '#rrggbb'；失败 resolve(null)
 */
export function extractAccent(url) {
  return new Promise((resolve) => {
    if (!url || typeof Image === 'undefined') {
      resolve(null)
      return
    }
    const img = new Image()
    img.onload = () => {
      try {
        const S = 32
        const canvas = document.createElement('canvas')
        canvas.width = S
        canvas.height = S
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        ctx.drawImage(img, 0, 0, S, S)
        const { data } = ctx.getImageData(0, 0, S, S)

        let r = 0
        let g = 0
        let b = 0
        let count = 0
        let topLum = 0
        let topCount = 0

        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 128) continue
          r += data[i]
          g += data[i + 1]
          b += data[i + 2]
          count += 1
          // 顶部 1/3 是时钟区域，用它的亮度判断"背景偏亮还是偏暗"
          const y = Math.floor(i / 4 / S)
          if (y < S / 3) {
            topLum += (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255
            topCount += 1
          }
        }

        if (count === 0 || topCount === 0) {
          resolve(null)
          return
        }

        const [h, s] = rgbToHsl(r / count, g / count, b / count)
        const bgLum = topLum / topCount
        const sat = Math.min(Math.max(s, 0.1), 0.45)
        const light = bgLum > 0.55 ? 0.32 : 0.76
        resolve(hslToHex(h, sat, light))
      } catch {
        // canvas 被跨域内容污染等场景：静默回退
        resolve(null)
      }
    }
    img.onerror = () => resolve(null)
    img.src = url
  })
}
