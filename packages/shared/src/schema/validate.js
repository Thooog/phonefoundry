

import { APPS } from '../constants/apps.js'
import { SchemaError } from './errors.js'
import { collectAssetRefs } from '../select/asset-refs.js'

const APP_BUCKETS = APPS.map((a) => a.id)

/**
 * @param {unknown} project
 * @returns {{ ok: boolean, errors: string[], warnings: string[] }}
 */
export function validateProject(project) {
  const errors = []
  const warnings = []

  if (!project || typeof project !== 'object' || Array.isArray(project)) {
    return { ok: false, errors: ['项目数据不是对象。'], warnings }
  }

  if (typeof project.name !== 'string') {
    warnings.push('缺少作品名称，将使用「未命名作品」。')
  }
  if (!Array.isArray(project.characters)) {
    errors.push('缺少角色列表（characters）。')
  }
  if (!Array.isArray(project.platformAccounts)) {
    errors.push('缺少平台账号列表（platformAccounts）。')
  }
  if (!Array.isArray(project.assets)) {
    errors.push('缺少资源列表（assets）。')
  }
  if (!project.appData || typeof project.appData !== 'object' || Array.isArray(project.appData)) {
    errors.push('缺少应用数据（appData）。')
  }

  if (errors.length > 0) {
    return { ok: false, errors, warnings }
  }

  for (const key of ['characters', 'platformAccounts', 'assets']) {
    if (project[key].some(item => !item || typeof item !== 'object' || Array.isArray(item))) {
      errors.push(`${key} 包含无效记录。`)
    }
  }

  // 逐应用检查桶结构
  for (const appId of APP_BUCKETS) {
    const bucket = project.appData[appId]
    if (Array.isArray(bucket)) { errors.push(`「${appId}」应为对象。`); continue }
    if (!bucket || typeof bucket !== 'object') {
      warnings.push(`「${appId}」的数据为空，将按空内容处理。`)
      continue
    }
    for (const [key, value] of Object.entries(bucket)) {
      if (!Array.isArray(value)) {
        errors.push(`「${appId}.${key}」应为数组，请修复后重新导入。`)
      } else if (value.some(item => !item || typeof item !== 'object' || Array.isArray(item))) {
        errors.push(`「${appId}.${key}」包含无效记录。`)
      }
    }
  }

  if (errors.length) return { ok: false, errors, warnings }

  // 关联完整性（只提示不拦，读取端有快照兜底）
  const characterIds = new Set(project.characters.map((c) => c.id))
  for (const account of project.platformAccounts) {
    if (account.characterId && !characterIds.has(account.characterId)) {
      warnings.push(`账号「${account.displayName || account.id}」所属角色已不存在。`)
    }
  }

  const ownerId = project.workSettings?.ownerCharacterId
  if (ownerId && !characterIds.has(ownerId)) {
    warnings.push('手机所属人已不存在，作品将隐藏依赖本人身份的内容。')
  }

  // 资源引用的完整性
  const assetIds = new Set(project.assets.map((a) => a.id))
  const refs = collectAssetRefs(project)
  const missing = [...refs].filter((id) => !assetIds.has(id))
  if (missing.length > 0) {
    // 只提示不拦：图片缺失时读取端降级为占位，不该让整个项目打不开
    warnings.push(`有 ${missing.length} 个资源引用找不到对应文件，将显示为占位。`)
  }

  // 资源归属：缺 projectId 一律补成当前项目（兼容旧数据），不视为错误
  for (const asset of project.assets) {
    if (!asset.projectId) {
      warnings.push(`资源「${asset.fileName || asset.id}」缺少归属项目，导入后将归入当前项目。`)
      break
    }
  }

  return { ok: errors.length === 0, errors, warnings }
}

/** 校验失败时抛出，供导入流程直接使用 */
export function assertProject(project) {
  const result = validateProject(project)
  if (!result.ok) {
    throw new SchemaError(`项目数据不完整：${result.errors.join(' ')}`)
  }
  return result
}
