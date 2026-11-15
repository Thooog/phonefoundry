/**
 * 照片（相册）只读派生。
 *
 * 与其他应用的区别：这里的"内容"是二进制，派生层却只处理文本。
 *   `imageAssetId` 原样透出，**不在这里把它换成 url** —— select 层是纯函数、
 *   不允许知道 assets 表或 DOM。真正解析 url 的是读取端注入的 resolveAsset。
 *   这条边界一旦破，作品端就无法在 Node 里被测试，导出时也会多一条隐式依赖。
 *
 * 另一个约定：**照片永远属于图库，相簿只是它的一个视图**。
 *   album.photoIds 指向照片，照片上没有 albumIds；因此"这张照片在哪个相簿里"
 *   必须由相簿侧反查，删相簿不会伤到照片。
 */

import { formatMonthTitle, formatPhotoStamp } from '../time/format.js'

/** 内置「个人收藏」相簿的保留 id：它不是一个真实的专辑记录 */
export const FAVORITES_ALBUM_ID = '__favorites__'

/**
 * 内置「最近删除」的保留 id：同样不建 album 记录，但与收藏不同，它始终存在。
 *
 * 显示名叫「最近删除」（iOS 照片的叫法），内部仍按"回收站"理解：
 * 它接住的是被打了 isInTrash 软删除标记的照片。常量名保留 TRASH_ALBUM_ID，
 * 是因为它说的是数据结构（一个桶），而"最近删除"只是这个桶的招牌。
 */
export const TRASH_ALBUM_ID = '__trash__'

/**
 * 内置「已隐藏」的保留 id：与收藏、回收站同一套做法，不建 album 记录。
 *
 * 显示名「已隐藏」（iOS 照片的叫法），内部按"被打了 isHidden 标记的视图"理解。
 * 隐藏的照片不进图库、不进个人收藏、不进用户相簿、也不进回收站 —— 它只在
 * 这条「已隐藏」入口里看得见，与 iOS 把隐藏照片挪出主时间线的行为一致。
 */
export const HIDDEN_ALBUM_ID = '__hidden__'

/** 相簿封面最多拼几张（2×2 拼贴） */
const COVER_LIMIT = 4

function rawPhotos(work) {
  const list = work?.appData?.photos?.photos
  return Array.isArray(list) ? list : []
}

function rawAlbums(work) {
  const list = work?.appData?.photos?.albums
  return Array.isArray(list) ? list : []
}

/** 无效时间排到最后，而不是当成 1970 —— 否则"日期没填"的照片会顶到最上面 */
function timeOf(value) {
  const t = new Date(value ?? 0).getTime()
  return Number.isNaN(t) ? -Infinity : t
}

function byTimeDesc(a, b) {
  return timeOf(b.displayTime) - timeOf(a.displayTime)
}

/** 'YYYY-MM'；无法解析时返回 'unknown' */
function monthKeyOf(iso) {
  const t = timeOf(iso)
  if (!Number.isFinite(t)) return 'unknown'
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function toView(photo, { timeFormat } = {}) {
  return {
    id: photo.id,
    imageAssetId: photo.imageAssetId ?? null,
    caption: photo.caption ?? '',
    location: photo.location ?? '',
    isFavorite: Boolean(photo.isFavorite),
    isInTrash: Boolean(photo.isInTrash),
    isHidden: Boolean(photo.isHidden),
    displayTime: photo.displayTime ?? null,
    stampLabel: formatPhotoStamp(photo.displayTime, { timeFormat }),
    monthKey: monthKeyOf(photo.displayTime),
  }
}

/**
 * 图库：按拍摄月份分组的网格。
 *
 * @param {object|null} work WorkData
 * @param {{ storyDate?: string|null, timeFormat?: string }} [options]
 * @returns {{ total: number, groups: Array<{ key: string, title: string, items: object[] }> }}
 */
export function buildPhotoGallery(work, options = {}) {
  // 回收站里的照片不属于图库：读者已经把它「删掉」了，只在回收站相簿里看得见。
  // 隐藏的照片同理：被读者"藏"起来了，主时间线不该再露脸，只在「已隐藏」里看得见。
  // 两种都是软标记，记录本身还在，所以这里必须显式过滤，不能靠"删记录"。
  const photos = rawPhotos(work)
    .filter((photo) => !photo.isInTrash && !photo.isHidden)
    .sort(byTimeDesc)
  const groups = []
  const index = new Map()

  for (const photo of photos) {
    const view = toView(photo, options)
    let group = index.get(view.monthKey)
    if (!group) {
      group = {
        key: view.monthKey,
        title:
          view.monthKey === 'unknown'
            ? '日期未知'
            : formatMonthTitle(photo.displayTime, { storyDate: options.storyDate }),
        items: [],
      }
      index.set(view.monthKey, group)
      groups.push(group)
    }
    group.items.push(view)
  }

  return { total: photos.length, groups }
}

/**
 * 相簿列表：内置「个人收藏」在最前（有收藏才出现），其后是用户建的相簿
 * （按 orderIndex），内置「最近删除」永远排在最后。
 *
 * 四条口径：
 *   1. 最近删除里的照片只是被标记，记录还在。图库、用户相簿、个人收藏都当它不存在，
 *      否则"删掉"的照片还在各处露脸，这个入口就名不副实。
 *   2. 已隐藏里的照片同样只是被标记，记录还在。隐藏与删除是两套独立的"挪出主时间线"
 *      的动作，互不重叠：一张照片既不会同时被删又被藏，藏起来的照片也只在「已隐藏」里看。
 *   3. 个人收藏沿用原规则：一张收藏都没有时不出现。
 *   4. 最近删除与已隐藏都是**入口**：即使为空也常驻末位，读者不必先做动作才能找到。
 *      作品端不把它们排进相簿网格，而是放在网格末尾的「更多项目」里 ——
 *      它们不是"一本相簿"，是两条去往不同区域的路。
 *
 * 只统计**真实存在**的照片：相簿里指向已删除照片的 id 直接不算数，
 * 否则卡片上会写着 "5 张"、点进去只有 3 张。
 */
export function buildAlbums(work) {
  const photos = rawPhotos(work)
  // 图库 / 收藏 / 用户相簿只认"既没删也没藏"的照片；删与藏都在各自的专门入口里看。
  const visible = photos.filter((p) => !p.isInTrash && !p.isHidden)
  const byId = new Map(visible.map((p) => [p.id, p]))
  const trashed = photos.filter((p) => p.isInTrash).sort(byTimeDesc)
  const hidden = photos.filter((p) => p.isHidden && !p.isInTrash).sort(byTimeDesc)

  const albums = []

  const favorites = visible.filter((p) => p.isFavorite).sort(byTimeDesc)
  if (favorites.length > 0) {
    albums.push({
      id: FAVORITES_ALBUM_ID,
      name: '个人收藏',
      builtin: true,
      count: favorites.length,
      coverImageAssetIds: favorites.slice(0, COVER_LIMIT).map((p) => p.imageAssetId ?? null),
      orderIndex: -1,
    })
  }

  for (const album of [...rawAlbums(work)].sort(
    (a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0),
  )) {
    const members = (album.photoIds ?? []).map((id) => byId.get(id)).filter(Boolean)
    albums.push({
      id: album.id,
      name: album.name || '未命名相簿',
      builtin: false,
      count: members.length,
      coverImageAssetIds: members.slice(0, COVER_LIMIT).map((p) => p.imageAssetId ?? null),
      orderIndex: album.orderIndex ?? 0,
    })
  }

  albums.push({
    id: HIDDEN_ALBUM_ID,
    name: '已隐藏',
    builtin: true,
    count: hidden.length,
    coverImageAssetIds: hidden.slice(0, COVER_LIMIT).map((p) => p.imageAssetId ?? null),
    // 内置相簿不参与 orderIndex 排序，这个值只表达"它比任何用户相簿都靠后"
    orderIndex: Number.MAX_SAFE_INTEGER,
  })

  albums.push({
    id: TRASH_ALBUM_ID,
    name: '最近删除',
    builtin: true,
    count: trashed.length,
    coverImageAssetIds: trashed.slice(0, COVER_LIMIT).map((p) => p.imageAssetId ?? null),
    // 内置相簿不参与 orderIndex 排序，这个值只表达"它比任何用户相簿都靠后"
    orderIndex: Number.MAX_SAFE_INTEGER,
  })

  return albums
}

/**
 * 相簿内的照片（保持相簿里的排列顺序；「个人收藏」与「回收站」按时间倒序）。
 *
 * @returns {object[]} 视图模型数组；相簿不存在时返回空数组
 */
export function buildAlbumPhotos(work, albumId, options = {}) {
  if (!albumId) return []
  const photos = rawPhotos(work)

  if (albumId === FAVORITES_ALBUM_ID) {
    return photos
      .filter((p) => !p.isInTrash && !p.isHidden && p.isFavorite)
      .sort(byTimeDesc)
      .map((p) => toView(p, options))
  }

  if (albumId === HIDDEN_ALBUM_ID) {
    return photos
      .filter((p) => p.isHidden && !p.isInTrash)
      .sort(byTimeDesc)
      .map((p) => toView(p, options))
  }

  if (albumId === TRASH_ALBUM_ID) {
    return photos
      .filter((p) => p.isInTrash)
      .sort(byTimeDesc)
      .map((p) => toView(p, options))
  }

  const album = rawAlbums(work).find((a) => a.id === albumId)
  if (!album) return []

  // 与图库 / 收藏保持一致：被隐藏的照片不进用户相簿，只在「已隐藏」里看得见。
  const byId = new Map(
    photos.filter((p) => !p.isInTrash && !p.isHidden).map((p) => [p.id, p]),
  )
  return (album.photoIds ?? [])
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((p) => toView(p, options))
}
