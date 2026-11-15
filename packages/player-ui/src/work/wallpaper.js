

import { getWallpaperPreset } from '@phone-sim/shared'

const FALLBACK = 'linear-gradient(160deg, #2b3a67 0%, #6b4e71 55%, #d9a7a0 100%)'

/**
 * @param {object|null} workSettings
 * @param {(assetId: string) => (string|null)} [resolveAsset]
 * @returns {{ backgroundImage: string, isImage: boolean, accent: string|null }}
 *   accent：锁屏强调色。preset 壁纸直接给出；asset 壁纸为 null（由调用方 canvas 取主色）。
 */
export function resolveWallpaper(workSettings, resolveAsset) {
  const wallpaper = workSettings?.wallpaper ?? {}

  if (wallpaper.type === 'asset' && wallpaper.assetId) {
    let url = null
    try {
      url = typeof resolveAsset === 'function' ? resolveAsset(wallpaper.assetId) : null
    } catch {
      url = null
    }
    if (url) {
      // 用 JSON.stringify 给 url 加引号：dataURL 里可能有括号/分号，裸写会截断
      return { backgroundImage: `url(${JSON.stringify(url)})`, isImage: true, accent: null }
    }
  }

  const preset = getWallpaperPreset(wallpaper.presetId)
  return { backgroundImage: preset?.css ?? FALLBACK, isImage: false, accent: preset?.accent ?? null }
}
