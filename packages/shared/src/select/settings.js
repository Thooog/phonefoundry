

import { FRAME_MODE } from '../constants/defaults.js'

/** 机主卡片副标题：Apple ID 入口说明（真机原句还列了「媒体与购买项目」，这里简掉） */
export const APPLE_ID_SUBTITLE = 'Apple ID、iCloud 等'

/**
 * @param {object} work WorkData
 * @returns {{hasOwner: boolean, name: string, subtitle: string, avatarAssetId: string|null}}
 */
export function buildSettingsOwner(work) {
  const ownerId = work?.workSettings?.ownerCharacterId ?? null
  const owner = (work?.characters ?? []).find((c) => c && c.id === ownerId) ?? null
  const accounts = (work?.platformAccounts ?? []).filter(
    (a) => a && a.characterId && a.characterId === ownerId,
  )

  return {
    hasOwner: Boolean(owner),
    name: owner?.name ?? '',
    // 角色没头像时，用机主第一个有头像的平台账号 —— 那也是"这个人的脸"
    avatarAssetId:
      owner?.avatarAssetId ?? accounts.find((a) => a.avatarAssetId)?.avatarAssetId ?? null,
    subtitle: owner ? APPLE_ID_SUBTITLE : '',
  }
}

/*
 * ── 呈现方式 ──
 *
 * 把"作品的设置"翻译成"渲染器要的参数"，而且只翻译一次。
 * PhoneSimulator 的 shellMode 是渲染层的三态（device / fill / auto），
 * 作品的开关只有"自适应 / 始终外框"两种取值。让作品端各写一串三元表达式的话，
 * 迟早出现"创作端预览铺满、导出却是外框"这种只靠肉眼才发现的漂移。
 */

/**
 * @param {object|null|undefined} workSettings
 * @returns {'device'|'auto'} 交给 PhoneSimulator 的 shellMode
 */
export function resolveShellMode(workSettings) {
  return workSettings?.frameMode === FRAME_MODE.ALWAYS ? 'device' : 'auto'
}

/**
 * 导出的作品打开后要不要自动进全屏。
 *
 * 预览（iframe）不走这条路 —— 判断在作品端的自动全屏模块里，那里更清楚自己在不在框里。
 * @param {object|null|undefined} workSettings
 * @returns {boolean}
 */
export function shouldAutoFullscreen(workSettings) {
  return Boolean(workSettings?.autoFullscreen)
}
