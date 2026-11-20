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

  /**
   * 只在字段本来就有值时才写回。
   *
   * 直接 `obj[key] = swap(obj[key])` 对没有这个字段的记录（评论 / 回复就不带
   * mediaAssetIds）会**凭空补一个 `undefined`**。`undefined` 不是 JSON 值，
   * 一旦落进 WorkData，`assertPlain()` 会整份拒收 —— 表现为导出作品、导出备份
   * 都报「xxx 类型为 undefined，无法安全序列化」。复制 / 导入项目都会走这里，
   * 所以一条回复就能让副本永久导不出去。
   */
  const swapField = (obj, key) => {
    if (!obj || typeof obj !== 'object') return
    if (obj[key] === undefined) return
    obj[key] = swap(obj[key])
  }

  // 项目顶层
  for (const c of project.characters ?? []) swapField(c, 'avatarAssetId')
  for (const a of project.platformAccounts ?? []) {
    swapField(a, 'avatarAssetId')
    swapField(a, 'bannerAssetId')
  }

  // 各应用数据桶
  for (const bucket of Object.values(project.appData ?? {})) {
    for (const conv of bucket.conversations ?? []) swapField(conv, 'avatarAssetId')
    for (const m of bucket.messages ?? []) swapField(m, 'mediaAssetIds')
    for (const p of bucket.posts ?? []) swapField(p, 'mediaAssetIds')
    for (const list of [bucket.comments, bucket.replies]) {
      for (const c of list ?? []) swapField(c, 'mediaAssetIds')
    }
    for (const ct of bucket.contacts ?? []) swapField(ct, 'avatarAssetId')
    // 照片：单图引用 + 相簿封面的 1~4 张
    for (const ph of bucket.photos ?? []) swapField(ph, 'imageAssetId')
    for (const al of bucket.albums ?? []) swapField(al, 'coverImageAssetIds')
    // Instagram 故事：一条记录一帧
    for (const st of bucket.stories ?? []) swapField(st, 'imageAssetId')
  }

  // 壁纸
  if (project.workSettings?.wallpaper) swapField(project.workSettings.wallpaper, 'assetId')

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
