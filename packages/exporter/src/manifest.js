

import { SCHEMA_VERSION } from '@phone-sim/shared'

/** 用来认亲的固定标识，任意修改都会让老备份导入失败 */
export const BACKUP_FORMAT = 'phone-simulator-project'

export const BACKUP_VERSION = 1

/** 生成这个包的软件标识 */
export const BACKUP_APP_ID = 'phone-simulator-creator'

/**
 * @param {object} params
 * @param {object} params.project      完整 Project（不裁剪）
 * @param {number} params.assetCount   实际写进 assets/ 的文件数
 * @param {string} params.appVersion   创作端版本号，用来定位"哪个版本导的"
 * @param {Date}   [params.now]
 * @returns {object}
 */
export function buildBackupManifest({ project, assetCount, appVersion, now = new Date() }) {
  return {
    format: BACKUP_FORMAT,
    backupVersion: BACKUP_VERSION,
    // 数据结构的版本，不是包的版本：导入端靠它判断要不要跑 migrateProject
    schemaVersion: Number(project?.schemaVersion) || SCHEMA_VERSION,
    app: BACKUP_APP_ID,
    appVersion: String(appVersion ?? ''),
    exportedAt: now.toISOString(),
    projectId: String(project?.id ?? ''),
    projectName: String(project?.name ?? ''),
    assetCount: Number(assetCount) || 0,
    counts: countProject(project),
  }
}

/**
 * 统计项目里有多少东西 —— 给导入确认框用。
 *
 * `apps` 只列非空的桶：一部只有聊天和照片的作品，不该在清单里
 * 出现七行「备忘录 0 条」，那只是噪音。
 *
 * @param {object} project
 * @returns {{ characters: number, platformAccounts: number, assets: number, apps: Record<string, number> }}
 */
export function countProject(project) {
  const apps = {}
  for (const [appId, bucket] of Object.entries(project?.appData ?? {})) {
    if (!bucket || typeof bucket !== 'object') continue
    let total = 0
    for (const value of Object.values(bucket)) {
      if (Array.isArray(value)) total += value.length
    }
    if (total > 0) apps[appId] = total
  }

  return {
    characters: Array.isArray(project?.characters) ? project.characters.length : 0,
    platformAccounts: Array.isArray(project?.platformAccounts)
      ? project.platformAccounts.length
      : 0,
    assets: Array.isArray(project?.assets) ? project.assets.length : 0,
    apps,
  }
}

export function isBackupManifest(value) {
  return Boolean(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      value.format === BACKUP_FORMAT &&
      typeof value.projectId === 'string',
  )
}
