/**
 * 常量与默认值。
 *
 * 凡"作品端与编辑端都要用同一个数字/字符串"的地方都放这里，
 * 避免两边各写一份导致行为不一致。
 */

import { createDefaultAppSettings } from '../work/app-settings.js'

export const SCHEMA_VERSION = 2

export const BACKUP_FORMAT = 'phone-simulator-project'
export const BACKUP_VERSION = 1

/** 作品三种导出形式的标识 */
export const EXPORT_FORMAT = Object.freeze({
  WORK_PACKAGE: 'work-package',
  STANDALONE_HTML: 'standalone-html',
  PROJECT_BACKUP: 'project-backup',
})

/** 体积提示档位（字节）。仅提示，不阻断。 */
export const SIZE_THRESHOLDS = Object.freeze({
  NOTICE: 2 * 1024 * 1024,
  WARN: 8 * 1024 * 1024,
  STRONG: 15 * 1024 * 1024,
  /** 独立 HTML 超过此值追加一次确认（防误操作，不是限制） */
  STANDALONE_CONFIRM: 25 * 1024 * 1024,
})

/** 图片处理默认参数 */
export const IMAGE_DEFAULTS = Object.freeze({
  MAX_EDGE: 1600,
  QUALITY: 0.82,
  MIME: 'image/webp',
})

/** 聊天时间分隔阈值：同一天不显示日期条 */
export const CHAT_DAY_GAP_MS = 24 * 60 * 60 * 1000

export const TIME_FORMAT = Object.freeze({
  H12: 'h12',
  H24: 'h24',
})

/**
 * 手机外框的呈现方式。
 *
 *   auto   —— 按屏幕宽度自适应（默认）：手机上铺满，宽屏上显示外框
 *   always —— 任何屏幕都显示手机外框
 *
 * 为什么不提供 never —— 这是一道分水岭：
 * 自适应本身就是"窄屏铺满"，再给一个 never 只会出现
 * "手机上永远带着一个框、还得横向滚动"这种生不如死的组合。
 */
export const FRAME_MODE = Object.freeze({
  AUTO: 'auto',
  ALWAYS: 'always',
})

export const DEFAULT_WORK_SETTINGS = Object.freeze({
  phoneName: '',
  ownerCharacterId: null,
  wallpaper: { type: 'preset', presetId: 'gradient-dusk', assetId: null },
  passcodeEnabled: false,
  passcode: '',
  passcodeLength: 4,
  timeFormat: TIME_FORMAT.H24,
  storyDate: null,
  appearance: { theme: 'light' },
  frameMode: FRAME_MODE.AUTO,
  autoFullscreen: false,
  // 「应用设定」：作品端照片的两把相簿锁 + 设置应用的 Wi-Fi 名
  appSettings: createDefaultAppSettings(),
})

export const WALLPAPER_PRESETS = [
  { id: 'gradient-dusk', label: '暮色', css: 'linear-gradient(160deg, #2b3a67 0%, #6b4e71 55%, #d9a7a0 100%)', accent: '#cdd6e0' },
  { id: 'gradient-mint', label: '薄荷', css: 'linear-gradient(160deg, #0f3443 0%, #34e89e 100%)', accent: '#c2e5da' },
  { id: 'gradient-sand', label: '沙丘', css: 'linear-gradient(160deg, #3e2723 0%, #a1887f 60%, #efebe9 100%)', accent: '#e3d5cd' },
  { id: 'gradient-ink', label: '墨', css: 'linear-gradient(160deg, #0b0b0f 0%, #2a2a35 60%, #4a4a57 100%)', accent: '#c9c9d2' },
]

export function getWallpaperPreset(presetId) {
  return WALLPAPER_PRESETS.find((w) => w.id === presetId) ?? null
}
