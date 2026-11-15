

import { collectAssetRefs, toWorkData } from '@phone-sim/shared'
import {
  estimateExportSizes,
  buildCharacterProject,
  exportCharacters,
  exportProjectBackup,
  exportStandaloneHtml,
  exportWorkPackage,
} from '@exporter'
import * as repo from '../db/repository.js'
import { loadPlayerBundle } from './load-player-bundle.js'
import { downloadBytes } from './download.js'

/**
 * 创作端版本号，由 vite.config.js 的 define 注入。
 *
 * `typeof` 保护是必要的：单测跑在 vitest 里，没有经过 vite 的 define 替换，
 * 直接写 `__APP_VERSION__` 会变成"未定义变量"而抛 ReferenceError。
 * 而 `typeof 未声明变量` 在 JS 里是安全的 —— 它返回 'undefined' 而不抛。
 */
// eslint-disable-next-line no-undef -- 由 vite define 注入，见上
const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : ''

/** 导出形态，与导出面板的选项一一对应 */
export const EXPORT_KINDS = Object.freeze({
  WORK_PACKAGE: 'work-package',
  STANDALONE_HTML: 'standalone-html',
  PROJECT_BACKUP: 'project-backup',
  CHARACTERS: 'characters',
})

/**
 * 导出作品包（ZIP：index.html + assets/）。
 * @param {object} project SourceProject
 */
export async function exportProjectAsWorkPackage(project) {
  if (!project) throw new Error('没有打开的作品。')

  const player = await loadPlayerBundle()
  const assets = await loadReferencedAssets(project)

  const result = await exportWorkPackage({ project, assets, player })
  downloadBytes(result.bytes, result.fileName)

  // bytes 有一两百 KB，没必要让它跟着返回值在内存里多活一会儿
  return summarize(result)
}

/**
 * 导出独立 HTML（单文件，图片 base64 内联）。
 *
 * 体积会比作品包大约 1/3 —— 这不是实现选择，是 base64 的定义。
 * 用户往往正是为了"一个文件发到手机上直接打开"才选它，所以不拦，
 * 只在面板上把预估体积摆出来。
 *
 * @param {object} project
 */
export async function exportProjectAsStandaloneHtml(project) {
  if (!project) throw new Error('没有打开的作品。')

  const player = await loadPlayerBundle()
  const assets = await loadReferencedAssets(project)

  const result = await exportStandaloneHtml({ project, assets, player })
  downloadBytes(result.bytes, result.fileName)

  return summarize(result)
}

/**
 * 导出项目备份包（manifest.json + project.json + assets/）。
 *
 * 资源取**全部**而不是只取被引用的：备份是回滚点，
 * 用户换掉一张图之后后悔了，那张旧图必须还在包里。
 * 这一点与作品包相反，注释写在 exporter 的 exportProjectBackup 里。
 *
 * @param {object} project
 * @param {string} [appVersion]
 */
export async function exportProjectAsBackup(project, appVersion = APP_VERSION) {
  if (!project) throw new Error('没有打开的作品。')

  const assets = await loadAllAssets(project)
  const result = await exportProjectBackup({ project, assets, appVersion })
  downloadBytes(result.bytes, result.fileName)

  return summarize(result)
}

/**
 * 按形态分发。面板只调这一个，避免 switch 散在组件里。
 *
 * @param {string} kind  EXPORT_KINDS 之一
 * @param {object} project
 */
export async function exportProject(kind, project) {
  switch (kind) {
    case EXPORT_KINDS.WORK_PACKAGE:
      return exportProjectAsWorkPackage(project)
    case EXPORT_KINDS.STANDALONE_HTML:
      return exportProjectAsStandaloneHtml(project)
    case EXPORT_KINDS.PROJECT_BACKUP:
      return exportProjectAsBackup(project)
    case EXPORT_KINDS.CHARACTERS: {
      const template = buildCharacterProject(project)
      const assets = await loadAllAssets(template)
      const result = await exportCharacters({ project, assets, appVersion: APP_VERSION })
      downloadBytes(result.bytes, result.fileName)
      return summarize(result)
    }
    default:
      throw new Error(`不认识的导出形态：${kind}`)
  }
}

/**
 * 导出前的体积预估（所有形态一次算完，面板打开时调一次）。
 *
 * 用 `asset.byteSize` 而不是去读二进制：
 * 资源元信息里就有入库时压缩后的字节数，读它是同步的、零 IO。
 * 真要读几十张图才能给出预估，面板会卡在"计算中"上，体验比没有预估更差。
 *
 * @param {object} project
 * @param {{ js: string, css: string }} player
 */
export function estimateSizes(project, player) {
  const assetBytes = (project?.assets ?? []).reduce(
    (sum, asset) => sum + (Number(asset?.byteSize) || 0),
    0,
  )
  // 作品端会剥掉编辑态字段，两个形态的文本大小并不相同，所以两条都传真的
  const work = project ? toWorkData(project) : {}
  const template = project ? buildCharacterProject(project) : {}
  const characterAssetBytes = (template.assets ?? []).reduce((sum, asset) => sum + (Number(asset.byteSize) || 0), 0)
  return {
    ...estimateExportSizes({ work, project: project ?? {}, player, assetBytes }),
    characters: estimateExportSizes({ project: template, assetBytes: characterAssetBytes }).projectBackup,
  }
}

async function loadReferencedAssets(project) {
  return repo.getAssetBlobs([...collectAssetRefs(project)])
}

/** 备份用：资源表里列出的全部资源 */
async function loadAllAssets(project) {
  return repo.getAssetBlobs((project?.assets ?? []).map((a) => a?.id).filter(Boolean))
}

/** 把导出器的返回压成 UI 需要的几个字段 */
function summarize(result) {
  return {
    format: result.format,
    fileName: result.fileName,
    size: result.size,
    assetCount: result.assetCount,
    assetBytes: result.assetBytes,
    missing: result.missing,
    hint: result.hint,
    tier: result.tier,
  }
}
