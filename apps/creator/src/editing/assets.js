/**
 * 资源回收的共用判定。
 *
 * 照片、帖子、消息都会在「删掉内容」之后留下没人引用的资源 ——
 * 元信息还在 assets 里、二进制还在库里，作品体积却不会降。
 * 调用方拿到这份清单后用 `editor.removeAssets` 一次性回收
 * （那是 store 里的一笔事务，比逐条删快得多）。
 *
 * 必须做**全项目扫描**（`findOrphanAssets` 遍历 asset-refs 的引用字段表），
 * 不能只算「这条帖子 / 这条消息还剩几张」：同一张图可能被两条内容共用，
 * 按当前内容算会把别人还在用的图删掉。
 *
 * 放在 editing/assets.js 而不是某个应用模块里：这条规则只能有一份，
 * 否则消息的判定和帖子的判定迟早漂移。
 */
import { findOrphanAssets } from '@phone-sim/shared'

/**
 * @param {object} project
 * @returns {string[]} 已无人引用的 assetId
 */
export function orphanAssetIds(project) {
  return findOrphanAssets(project).map((asset) => asset.id)
}
