/**
 * 资源引用的批量替换 —— 复制与导入时给每个资源换新 id。
 *
 * 这里刻意与 `@phone-sim/shared` 的 `asset-refs.js` 使用同一套字段登记语义。
 * 两边必须同步：shared 那边负责"读"，这边负责"写"。
 *
 * 为什么不让 shared 提供通用的递归替换：
 *   递归替换整棵对象树会误伤 —— 例如消息正文里恰好存了一个长得像 assetId 的字符串。
 *   只改已知字段，是最安全也最容易验证的做法。
 */

/** 把所有已知资源引用字段按 idMap 换新 */
export function rewriteAssetRefs(project, idMap) {
  const swap = (value) => {
    if (Array.isArray(value)) {
      return value.map((v) => (typeof v === 'string' && idMap.has(v) ? idMap.get(v) : v))
    }
    if (typeof value === 'string' && idMap.has(value)) return idMap.get(value)
    return value
  }

  // 项目顶层
  for (const c of project.characters ?? []) c.avatarAssetId = swap(c.avatarAssetId)
  for (const a of project.platformAccounts ?? []) {
    a.avatarAssetId = swap(a.avatarAssetId)
    a.bannerAssetId = swap(a.bannerAssetId)
  }

  // 各应用数据桶
  for (const bucket of Object.values(project.appData ?? {})) {
    for (const conv of bucket.conversations ?? []) conv.avatarAssetId = swap(conv.avatarAssetId)
    for (const m of bucket.messages ?? []) m.mediaAssetIds = swap(m.mediaAssetIds)
    for (const p of bucket.posts ?? []) p.mediaAssetIds = swap(p.mediaAssetIds)
    for (const list of [bucket.comments, bucket.replies]) {
      for (const c of list ?? []) c.mediaAssetIds = swap(c.mediaAssetIds)
    }
    for (const ct of bucket.contacts ?? []) ct.avatarAssetId = swap(ct.avatarAssetId)
    // 照片：单图引用 + 相簿封面的 1~4 张
    for (const ph of bucket.photos ?? []) ph.imageAssetId = swap(ph.imageAssetId)
    for (const al of bucket.albums ?? []) al.coverImageAssetIds = swap(al.coverImageAssetIds)
    // Instagram 故事：一条记录一帧
    for (const st of bucket.stories ?? []) st.imageAssetId = swap(st.imageAssetId)
  }

  // 壁纸
  if (project.workSettings?.wallpaper) {
    project.workSettings.wallpaper.assetId = swap(project.workSettings.wallpaper.assetId)
  }

  return project
}

/**
 * 资源自身字段：元信息表里的 originalAssetId 也要换。
 * 单独一个函数，因为它在 assets 数组内部、语义与"内容引用"不同。
 */
export function rewriteAssetInternalRefs(assets, idMap) {
  for (const asset of assets ?? []) {
    if (asset.originalAssetId && idMap.has(asset.originalAssetId)) {
      asset.originalAssetId = idMap.get(asset.originalAssetId)
    }
  }
  return assets
}
