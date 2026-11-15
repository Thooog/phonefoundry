/**
 * 导入编排 —— 解析文件 → 换 id → 落盘。
 *
 * 一层薄封装，但值得单独存在：它决定了**失败时用户看到什么**。
 * 解析错误（认不出文件）、校验错误（结构不对）、写入错误（存储满了）
 * 是三种完全不同的处境，前两种该让用户换个文件，第三种该让他清空间。
 * 混在一个 try/catch 里就只能给一句"导入失败"，等于什么都没说。
 */

import { IMPORT_KIND, parseImportFile } from './parse-backup.js'
import * as service from '../db/project-service.js'

/**
 * @param {File} file
 * @returns {Promise<{
 *   project: object,
 *   kind: 'backup'|'bare-json',
 *   manifest: object|null,
 *   importedAssets: number,
 *   missingAssets: string[],
 *   warnings: string[],
 * }>}
 */
export async function importProjectFromFile(file) {
  // 1. 解析：失败原因直接透传（"这个压缩包里没有 project.json"比"导入失败"有用得多）
  const parsed = await parseImportFile(file)

  // 2. 落盘。名字加后缀，避免同一份包导两次看起来"没反应"
  const suffix =
    parsed.kind === IMPORT_KIND.BACKUP ? '（导入）' : '（导入 JSON）'
  const result = await service.importProjectRecord({
    project: parsed.project,
    blobs: parsed.blobs,
    nameSuffix: suffix,
  })

  return {
    project: result.project,
    kind: parsed.kind,
    manifest: parsed.manifest,
    importedAssets: result.importedAssets,
    // 包里声明了但没找到文件的图（备份包才有）
    missingAssets: parsed.missingAssets,
    warnings: result.warnings,
  }
}

/**
 * 导入结果的一句话总结，给 Toast 用。
 *
 * 分开说三件事，因为它们对用户的意义完全不同：
 *   图片数量 —— 决定作品看起来是否完整
 *   缺失资源 —— 需要用户知道"有图丢了"，而不是默默显示占位
 *   裸 JSON  —— 提醒他下次用 zip，否则每张图都会是占位
 *
 * @param {Awaited<ReturnType<typeof importProjectFromFile>>} result
 */
export function describeImport(result) {
  if (result.kind === IMPORT_KIND.BARE_JSON) {
    return '已导入项目数据。此文件不含图片，图片位置会显示占位；要完整恢复请用 .zip 备份包。'
  }
  if (result.missingAssets.length) {
    return `已导入，但有 ${result.missingAssets.length} 张图片在包里找不到，作品里会显示占位。`
  }
  if (result.importedAssets > 0) {
    return `已导入，包含 ${result.importedAssets} 张图片。`
  }
  return '已导入。'
}
