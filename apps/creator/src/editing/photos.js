/**
 * 「照片」应用的编辑操作 —— 全部是纯函数，入参是一个 project store。
 *
 * 为什么不把这些写进 project store：
 *   那个 store 的职责是"把改动送进落盘链路"（patch / mutate / commit），
 *   它不该知道"照片要不要顺手从相簿里摘掉"这种业务规则。
 *   每个应用一个 editing/*.js，store 保持薄，规则好测也好抄。
 *
 * 一条贯穿全文件的约定：**只换引用，不原地改数组**。
 *   mutate() 里的 draft 是项目对象的顶层浅拷贝，嵌套数组仍是同一份。
 *   如果这里写 `bucket.photos.push(x)`，数组引用不变，而上层 shallowRef
 *   只会因为"顶层换了个新对象"而通知视图 —— 视图拿到同一个数组，
 *   v-for 有可能不刷新。全部走 filter / map / 展开，引用必然变化，不留这个隐患。
 */

import {
  createAlbum as createAlbumRecord,
  createPhoto,
  FAVORITES_ALBUM_ID,
  HIDDEN_ALBUM_ID,
  TRASH_ALBUM_ID,
} from '@phone-sim/shared'
import { isInlineUrl } from '../media/image-format.js'

/** 说明框的长度上限（编辑器输入框的 maxlength 与导入时的截断都取这个值） */
export const CAPTION_MAX_LENGTH = 80

/**
 * 地点上限。
 *
 * 它要放进作品端查看器的标题第一行，两行标题加起来不能撑爆顶栏，
 * 所以比说明更紧。40 个字足够写「学校 · 三号宿舍楼」这种粒度，
 * 再长用户在手机上本来也读不完。
 */
export const LOCATION_MAX_LENGTH = 40

/**
 * 创作端的「固定相簿」：把三个状态标记外化成普通相簿的管理形式。
 *
 * 它们不是 album 记录 —— 没有 photoIds、不落盘、不能改名或删除；成员完全由
 * photos[] 上的标记派生，点「加入 / 移出」实际是打 / 清标记。之所以放进相簿列表，
 * 是为了让作者能像整理普通相簿一样，在一处集中增删这三个状态。
 *
 * 成员口径照抄作品端 select/buildAlbums：删 > 藏 > 收藏，三者互不重叠。
 * id 直接复用 shared 的常量，两端不会各写一份字符串；flag 是唯一的数据真相，
 * UI 文案交给调用方，不放进这层。
 */
export const STATUS_ALBUMS = [
  { id: FAVORITES_ALBUM_ID, name: '个人收藏', flag: 'isFavorite' },
  { id: HIDDEN_ALBUM_ID, name: '已隐藏', flag: 'isHidden' },
  { id: TRASH_ALBUM_ID, name: '最近删除', flag: 'isInTrash' },
]

const STATUS_BY_ID = new Map(STATUS_ALBUMS.map((album) => [album.id, album]))

/** 相簿 id 是不是三本固定相簿之一 */
export const isStatusAlbum = (albumId) => STATUS_BY_ID.has(albumId)

/**
 * 固定相簿的成员。排序用时间倒序 —— 没有 photoIds 就没有"作者手排的顺序"，
 * 与作品端 buildAlbumPhotos 的时间倒序保持一致。
 */
function statusMembers(photos, status) {
  const visible = photos.filter((p) => !p.isInTrash && !p.isHidden)
  if (status.flag === 'isFavorite') return sortPhotosByTime(visible.filter((p) => p.isFavorite))
  if (status.flag === 'isHidden') {
    return sortPhotosByTime(photos.filter((p) => p.isHidden && !p.isInTrash))
  }
  return sortPhotosByTime(photos.filter((p) => p.isInTrash))
}

/**
 * 从文件名推一个默认说明：去掉目录，再去掉最后一段扩展名。
 *
 * 为什么只去最后一段：`my.holiday.2024.jpg` 里中间的点属于名字本身，
 * 只有最后那个才是扩展名。以点开头的文件（`.png`）没有扩展名可去，
 * 整串保留 —— 截成空串等于导入后连个提示都没有。
 *
 * @param {string} name
 * @param {number} [maxLength]
 * @returns {string}
 */
export function captionFromFileName(name, maxLength = CAPTION_MAX_LENGTH) {
  const base = String(name ?? '')
    .split(/[\\/]/)
    .pop()
  if (!base) return ''

  const dot = base.lastIndexOf('.')
  const stem = dot > 0 ? base.slice(0, dot) : base
  return stem.trim().slice(0, maxLength)
}

/**
 * 拿到照片桶，缺什么补什么。
 *
 * 不能假设桶一定存在：createProject 会建好八个桶，但导入的项目、
 * 或者早期手写的数据都可能只有一部分。
 */
function ensureBucket(project) {
  if (!project.appData || typeof project.appData !== 'object') project.appData = {}
  if (!project.appData.photos) project.appData.photos = { photos: [], albums: [] }

  const bucket = project.appData.photos
  if (!Array.isArray(bucket.photos)) bucket.photos = []
  if (!Array.isArray(bucket.albums)) bucket.albums = []
  return bucket
}

const nowIso = () => new Date().toISOString()

function timeOf(value) {
  const t = new Date(value ?? 0).getTime()
  return Number.isNaN(t) ? -Infinity : t
}

/**
 * 按拍摄时间倒序（新的在前）。
 *
 * 无效时间排到最后而不是当成 1970 —— 否则"日期没填"的照片会顶到第一位，
 * 而这恰恰是用户最不想先看到的一张。
 * @param {object[]} photos
 * @returns {object[]}
 */
export function sortPhotosByTime(photos) {
  return [...(photos ?? [])].sort((a, b) => timeOf(b.displayTime) - timeOf(a.displayTime))
}

export function addPhoto(editor, input) {
  const photo = createPhoto({
    imageAssetId: input.imageAssetId,
    caption: input.caption ?? '',
    displayTime: input.displayTime ?? nowIso(),
  })

  editor.mutate((draft) => {
    const bucket = ensureBucket(draft)
    bucket.photos = [...bucket.photos, photo]

    if (input.albumId) {
      bucket.albums = bucket.albums.map((album) =>
        album.id === input.albumId
          ? { ...album, photoIds: [...(album.photoIds ?? []), photo.id], updatedAt: nowIso() }
          : album,
      )
    }
  })

  return photo
}

/**
 * 改单条照片。只允许改"人写的字段"，id 与 imageAssetId 不动 ——
 * 换图应该走"删掉再重加"，那样资源回收的路径只有一条。
 *
 * @param {object} editor
 * @param {string} photoId
 * @param {{caption?: string, location?: string, displayTime?: string, isFavorite?: boolean, isHidden?: boolean, isInTrash?: boolean}} patch
 */
export function updatePhoto(editor, photoId, patch) {
  const allowed = pickEditable(patch)

  editor.mutate((draft) => {
    const bucket = ensureBucket(draft)
    bucket.photos = bucket.photos.map((photo) =>
      photo.id === photoId ? { ...photo, ...allowed, updatedAt: nowIso() } : photo,
    )
  })
}

/**
 * 一次改一批照片。
 *
 * 为什么不循环调用 updatePhoto：每次 mutate 都会触发一次落盘 commit、
 * revision +1。勾 10 张照片改地点就涨 10 次 revision，保存状态栏会连续闪
 * "保存中"，而用户只做了一件事。批量原语必须一次 mutate 改完。
 *
 * @param {object} editor
 * @param {string[]} photoIds
 * @param {{caption?: string, location?: string, displayTime?: string, isFavorite?: boolean, isHidden?: boolean, isInTrash?: boolean}} patch
 * @returns {number} 实际改到的条数
 */
export function updatePhotos(editor, photoIds, patch) {
  const ids = new Set(photoIds ?? [])
  if (ids.size === 0) return 0

  const allowed = pickEditable(patch)
  if (Object.keys(allowed).length === 0) return 0

  let changed = 0
  editor.mutate((draft) => {
    const bucket = ensureBucket(draft)
    bucket.photos = bucket.photos.map((photo) => {
      if (!ids.has(photo.id)) return photo
      changed += 1
      return { ...photo, ...allowed, updatedAt: nowIso() }
    })
  })
  return changed
}

/** updatePhoto / updatePhotos 共用的白名单 —— 两处口径必须一致，否则批量能改的字段单张改不了 */
function pickEditable(patch) {
  const allowed = {}
  if (patch.caption !== undefined) allowed.caption = patch.caption
  if (patch.location !== undefined) allowed.location = patch.location
  if (patch.displayTime !== undefined) allowed.displayTime = patch.displayTime
  if (patch.isFavorite !== undefined) allowed.isFavorite = Boolean(patch.isFavorite)
  if (patch.isHidden !== undefined) allowed.isHidden = Boolean(patch.isHidden)
  if (patch.isInTrash !== undefined) allowed.isInTrash = Boolean(patch.isInTrash)
  return allowed
}

/**
 * 删一条照片。批量删除的单条特例 —— 实现在 deletePhotos，
 * 这样"什么算孤儿"只有一处判断，两条路径不会各说各话。
 *
 * @param {object} editor
 * @param {string} photoId
 * @returns {string|null} 需要回收的 assetId
 */
export function deletePhoto(editor, photoId) {
  return deletePhotos(editor, [photoId])[0] ?? null
}

/**
 * 一次删一批照片（单张删除也走这里），并把它从所有相簿里摘掉。
 *
 * **不在这里删资源**，只把"可能变成孤儿"的 assetId 交回去。
 * 原因：这个函数是同步的（mutate 回调里不能 await），而删 blob 是异步的；
 * 混在一起会出现"记录没了、图还在"的中间态。调用方拿到返回值后
 * 调 editor.removeAssets() 补第二刀，顺序与 addAsset 正好相反。
 *
 * 孤儿判断放在**整批删完之后**统一做：同一张图可以被多条照片记录引用
 * （复制项目、或用户把同一张图加两次），逐张判会让"两张同时删掉、
 * 共用一张图"的情形误回收 —— 那正是批量删除最常见的样子。
 *
 * @param {object} editor
 * @param {string[]} photoIds
 * @returns {string[]} 需要回收的 assetId
 */
export function deletePhotos(editor, photoIds) {
  const ids = new Set(photoIds ?? [])
  if (ids.size === 0) return []

  const orphans = new Set()

  editor.mutate((draft) => {
    const bucket = ensureBucket(draft)
    const removed = bucket.photos.filter((p) => ids.has(p.id))
    if (removed.length === 0) return

    bucket.photos = bucket.photos.filter((p) => !ids.has(p.id))
    bucket.albums = bucket.albums.map((album) =>
      (album.photoIds ?? []).some((id) => ids.has(id))
        ? { ...album, photoIds: album.photoIds.filter((id) => !ids.has(id)), updatedAt: nowIso() }
        : album,
    )

    // 用"删完之后还剩谁"来判断，而不是逐张判 —— 同批里共用同一张图的不会误删
    const stillUsed = new Set(bucket.photos.map((p) => p.imageAssetId))
    for (const photo of removed) {
      const assetId = photo.imageAssetId
      // 内联 dataURL 与示例项目的外链不是资源表里的 asset，没有 blob 可删
      if (assetId && !stillUsed.has(assetId) && !isInlineUrl(assetId)) {
        orphans.add(assetId)
      }
    }
  })

  return [...orphans]
}

/**
 * 新建相簿。
 * @param {object} editor
 * @param {string} name
 * @returns {object|null} 名称为空时返回 null，不建无名相簿
 */
export function addAlbum(editor, name) {
  const trimmed = (name ?? '').trim()
  if (!trimmed) return null

  let created = null
  editor.mutate((draft) => {
    const bucket = ensureBucket(draft)
    const nextOrder = bucket.albums.reduce((max, a) => Math.max(max, a.orderIndex ?? 0), -1) + 1
    created = createAlbumRecord({ name: trimmed, orderIndex: nextOrder })
    bucket.albums = [...bucket.albums, created]
  })
  return created
}

export function renameAlbum(editor, albumId, name) {
  const trimmed = (name ?? '').trim()
  if (!trimmed) return

  editor.mutate((draft) => {
    const bucket = ensureBucket(draft)
    bucket.albums = bucket.albums.map((album) =>
      album.id === albumId ? { ...album, name: trimmed, updatedAt: nowIso() } : album,
    )
  })
}

/**
 * 删相簿不删照片 —— 成员关系只存在相簿这一侧（photoIds），
 * 扔掉相簿就等于扔掉一个数组，照片本身毫发无损。
 */
export function deleteAlbum(editor, albumId) {
  editor.mutate((draft) => {
    const bucket = ensureBucket(draft)
    bucket.albums = bucket.albums.filter((album) => album.id !== albumId)
  })
}

/** 把照片放进相簿（幂等：已经在里面就什么都不做） */
export function addPhotoToAlbum(editor, albumId, photoId) {
  editor.mutate((draft) => {
    const bucket = ensureBucket(draft)
    bucket.albums = bucket.albums.map((album) => {
      if (album.id !== albumId) return album
      const ids = album.photoIds ?? []
      if (ids.includes(photoId)) return album
      return { ...album, photoIds: [...ids, photoId], updatedAt: nowIso() }
    })
  })
}

/** 把照片移出相簿（照片本身保留在图库里） */
export function removePhotoFromAlbum(editor, albumId, photoId) {
  editor.mutate((draft) => {
    const bucket = ensureBucket(draft)
    bucket.albums = bucket.albums.map((album) =>
      album.id === albumId
        ? { ...album, photoIds: (album.photoIds ?? []).filter((id) => id !== photoId), updatedAt: nowIso() }
        : album,
    )
  })
}

/**
 * 相簿成员的统一写入口：视图不必知道展开的是普通相簿还是固定相簿。
 *
 * 普通相簿改 photoIds（走上面两个函数，行为一字未变）；固定相簿打 / 清标记，
 * 走 updatePhoto 的白名单，只产生一次 mutate、一次 revision。
 * 清标记永远可逆（点一下就能加回来），所以调用方不必为此弹确认框。
 *
 * @param {object} editor
 * @param {string} albumId
 * @param {string} photoId
 * @param {boolean} member true 加入 / false 移出
 */
export function setAlbumMember(editor, albumId, photoId, member) {
  const status = STATUS_BY_ID.get(albumId)
  if (!status) {
    if (member) addPhotoToAlbum(editor, albumId, photoId)
    else removePhotoFromAlbum(editor, albumId, photoId)
    return
  }
  updatePhoto(editor, photoId, { [status.flag]: Boolean(member) })
}

/**
 * 相簿成员。普通相簿按 photoIds 里的排列顺序返回（相簿顺序是作者有意排的，不要重排）；
 * 固定相簿由标记派生，按时间倒序返回。
 *
 * 回收站与已隐藏的照片都不算普通相簿的成员：它们在作品端已经从普通相簿里隐去，
 * 创作端的相簿视图必须跟作品端同口径。
 * 只是从这份视图里滤掉，photoIds 上的关系保留着 —— 恢复之后照片自动回到原相簿。
 *
 * @param {object} project
 * @param {string} albumId
 * @returns {object[]}
 */
export function albumMembers(project, albumId) {
  const bucket = project?.appData?.photos
  if (!bucket) return []
  const status = STATUS_BY_ID.get(albumId)
  if (status) return statusMembers(bucket.photos ?? [], status)
  const album = (bucket.albums ?? []).find((a) => a.id === albumId)
  if (!album) return []

  const byId = new Map(
    (bucket.photos ?? []).filter((p) => !p.isInTrash && !p.isHidden).map((p) => [p.id, p]),
  )
  return (album.photoIds ?? []).map((id) => byId.get(id)).filter(Boolean)
}

/**
 * 还不在这个相簿里的照片（用于"点一下加进去"的候选列表）。
 *
 * 回收站与已隐藏的照片都**不进候选**：「从图库添加」列的是还活着的图库照片，
 * 已经移进回收站或隐藏起来的不该被顺手加回相簿。不能指望 albumMembers 顺带排除 ——
 * 它把这些照片滤掉之后，这些照片反而会被判成"不在相簿里"。
 *
 * 固定相簿同样只从"既没删也没藏"的照片里挑候选：隐藏 / 最近删除的成员本来就不在
 * 这份可见集合里，而收藏夹的成员仍在，要额外把已收藏的剔掉，否则会重复加入。
 *
 * @param {object} project
 * @param {string} albumId
 * @returns {object[]}
 */
export function photosOutsideAlbum(project, albumId) {
  const status = STATUS_BY_ID.get(albumId)
  if (status) {
    const photos = project?.appData?.photos?.photos ?? []
    const visible = photos.filter((p) => !p.isInTrash && !p.isHidden)
    const candidates = status.flag === 'isFavorite'
      ? visible.filter((p) => !p.isFavorite)
      : visible
    return sortPhotosByTime(candidates)
  }
  const members = new Set(albumMembers(project, albumId).map((p) => p.id))
  return sortPhotosByTime(project?.appData?.photos?.photos).filter(
    (p) => !members.has(p.id) && !p.isInTrash && !p.isHidden,
  )
}
