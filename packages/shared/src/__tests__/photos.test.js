/**
 * 照片派生测试。
 *
 * 重点不在"能不能跑"，而在三条容易被写错的语义：
 *   1. 图库永远是时间倒序 —— 无论创作者按什么顺序录入；
 *   2. 相簿保持相簿自己的顺序 —— 相簿是"编排"，不是"查询结果"；
 *   3. 指向已删除照片的 id 不算数 —— 否则卡片数字与点进去的数量对不上。
 */

import { describe, it, expect } from 'vitest'
import { createProject, createPhoto, createAlbum } from '../factory/index.js'
import {
  buildPhotoGallery,
  buildAlbums,
  buildAlbumPhotos,
  FAVORITES_ALBUM_ID,
  TRASH_ALBUM_ID,
  HIDDEN_ALBUM_ID,
} from '../select/photos.js'

function makeWork(photos, albums = []) {
  const project = createProject()
  project.appData.photos = { photos, albums }
  return { appData: project.appData }
}

const DAY = 24 * 60 * 60 * 1000
const base = Date.parse('2026-10-28T12:00:00.000Z')
const daysAgo = (n) => new Date(base - n * DAY).toISOString()

describe('buildPhotoGallery', () => {
  it('按时间倒序，且同月的照片合成一组', () => {
    const work = makeWork([
      createPhoto({ id: 'p_old', displayTime: daysAgo(40) }),
      createPhoto({ id: 'p_new', displayTime: daysAgo(1) }),
      createPhoto({ id: 'p_mid', displayTime: daysAgo(20) }),
    ])

    const gallery = buildPhotoGallery(work, { storyDate: '2026-10-28' })
    expect(gallery.total).toBe(3)
    // 9 月 / 10 月 两组，10 月在先
    expect(gallery.groups.map((g) => g.key)).toEqual(['2026-10', '2026-09'])
    expect(gallery.groups[0].items.map((p) => p.id)).toEqual(['p_new', 'p_mid'])
    expect(gallery.groups[1].items.map((p) => p.id)).toEqual(['p_old'])
  })

  it('与 storyDate 同年时标题省略年份', () => {
    const work = makeWork([createPhoto({ displayTime: daysAgo(1) })])
    const gallery = buildPhotoGallery(work, { storyDate: '2026-10-28' })
    expect(gallery.groups[0].title).toBe('10月')
  })

  it('跨年时标题带年份', () => {
    const work = makeWork([createPhoto({ displayTime: '2024-03-02T09:00:00.000Z' })])
    const gallery = buildPhotoGallery(work, { storyDate: '2026-10-28' })
    expect(gallery.groups[0].title).toBe('2024年3月')
  })

  it('时间非法的照片进「日期未知」，且排在最后', () => {
    const work = makeWork([
      createPhoto({ id: 'p_bad', displayTime: '' }),
      createPhoto({ id: 'p_ok', displayTime: daysAgo(2) }),
    ])
    const gallery = buildPhotoGallery(work, { storyDate: '2026-10-28' })
    expect(gallery.groups.map((g) => g.key)).toEqual(['2026-10', 'unknown'])
    expect(gallery.groups[1].title).toBe('日期未知')
    expect(gallery.groups[1].items[0].id).toBe('p_bad')
    expect(gallery.groups[1].items[0].stampLabel).toBe('')
  })

  it('没有照片时返回空分组而不是 null', () => {
    const gallery = buildPhotoGallery(makeWork([]), {})
    expect(gallery.total).toBe(0)
    expect(gallery.groups).toEqual([])
  })

  it('不修改入参顺序', () => {
    const photos = [
      createPhoto({ id: 'a', displayTime: daysAgo(10) }),
      createPhoto({ id: 'b', displayTime: daysAgo(1) }),
    ]
    buildPhotoGallery(makeWork(photos), {})
    expect(photos.map((p) => p.id)).toEqual(['a', 'b'])
  })
})

describe('buildAlbums', () => {
  it('没有收藏时不出现「个人收藏」，但「最近删除」仍常驻末位', () => {
    const work = makeWork([createPhoto()], [createAlbum({ name: '夏天' })])
    expect(buildAlbums(work).map((a) => a.name)).toEqual(['夏天', '已隐藏', '最近删除'])
  })

  it('有收藏时「个人收藏」排第一，且带上拼贴封面', () => {
    const work = makeWork(
      [
        createPhoto({ imageAssetId: 'a1', isFavorite: true, displayTime: daysAgo(3) }),
        createPhoto({ imageAssetId: 'a2', isFavorite: true, displayTime: daysAgo(1) }),
        createPhoto({ imageAssetId: 'a3' }),
      ],
      [],
    )
    const [fav] = buildAlbums(work)
    expect(fav.id).toBe(FAVORITES_ALBUM_ID)
    expect(fav.name).toBe('个人收藏')
    expect(fav.builtin).toBe(true)
    expect(fav.count).toBe(2)
    // 收藏按时间倒序，最新的一张在最前
    expect(fav.coverImageAssetIds).toEqual(['a2', 'a1'])
  })

  it('相簿只统计仍然存在的照片', () => {
    const work = makeWork(
      [createPhoto({ id: 'p1' })],
      [createAlbum({ id: 'al1', name: '夏天', photoIds: ['p1', 'p_deleted', 'p_ghost'] })],
    )
    const [album] = buildAlbums(work)
    expect(album.count).toBe(1)
    expect(album.coverImageAssetIds).toEqual([null])
  })

  it('封面最多 4 张', () => {
    const photos = Array.from({ length: 7 }, (_, i) => createPhoto({ id: `p${i}` }))
    const work = makeWork(
      photos,
      [createAlbum({ name: '多', photoIds: photos.map((p) => p.id) })],
    )
    expect(buildAlbums(work)[0].coverImageAssetIds).toHaveLength(4)
  })

  it('按 orderIndex 排序', () => {
    const work = makeWork(
      [],
      [
        createAlbum({ name: '后', orderIndex: 2 }),
        createAlbum({ name: '前', orderIndex: 0 }),
      ],
    )
    expect(buildAlbums(work).map((a) => a.name)).toEqual(['前', '后', '已隐藏', '最近删除'])
  })

  it('收藏在最前、用户相簿居中、最近删除在最后', () => {
    const work = makeWork(
      [
        createPhoto({ id: 'fav', isFavorite: true }),
        createPhoto({ id: 'trashed', isInTrash: true }),
        createPhoto({ id: 'normal' }),
      ],
      [createAlbum({ name: '夏天' })],
    )
    expect(buildAlbums(work).map((a) => a.name)).toEqual(['个人收藏', '夏天', '已隐藏', '最近删除'])
  })

  it('最近删除即使为空也常驻，且不带封面', () => {
    const work = makeWork([createPhoto()])
    const list = buildAlbums(work)
    const trash = list.at(-1)
    // 常驻的内置入口有两条（已隐藏、最近删除），所以长度为 2
    expect(list).toHaveLength(2)
    expect(trash.id).toBe(TRASH_ALBUM_ID)
    expect(trash.name).toBe('最近删除')
    expect(trash.builtin).toBe(true)
    expect(trash.count).toBe(0)
    expect(trash.coverImageAssetIds).toEqual([])
  })

  it('回收站照片按时间倒序组封面，最多 4 张', () => {
    const work = makeWork(
      [1, 2, 3, 4, 5].map((i) =>
        createPhoto({ imageAssetId: `a${i}`, isInTrash: true, displayTime: daysAgo(i) }),
      ),
    )
    const trash = buildAlbums(work).find((a) => a.id === TRASH_ALBUM_ID)
    expect(trash.count).toBe(5)
    expect(trash.coverImageAssetIds).toEqual(['a1', 'a2', 'a3', 'a4'])
  })

  it('回收站照片不进图库、用户相簿与个人收藏', () => {
    const work = makeWork(
      [
        createPhoto({
          id: 'gone',
          isInTrash: true,
          isFavorite: true,
          imageAssetId: 'a_gone',
          displayTime: daysAgo(1),
        }),
        createPhoto({ id: 'alive', imageAssetId: 'a_alive', displayTime: daysAgo(2) }),
      ],
      [createAlbum({ id: 'al1', name: '夏天', photoIds: ['gone', 'alive'] })],
    )

    expect(buildPhotoGallery(work).total).toBe(1)
    expect(buildAlbumPhotos(work, 'al1').map((p) => p.id)).toEqual(['alive'])
    expect(buildAlbums(work).find((a) => a.name === '夏天').count).toBe(1)
    // 被收藏的照片一旦进了回收站，收藏相簿也不该再留它
    expect(buildAlbums(work).some((a) => a.name === '个人收藏')).toBe(false)
    expect(buildAlbumPhotos(work, FAVORITES_ALBUM_ID)).toEqual([])
  })

  it('已隐藏即使为空也常驻，且排在最近删除之前', () => {
    const work = makeWork([createPhoto()])
    const list = buildAlbums(work)
    const hidden = list.find((a) => a.id === HIDDEN_ALBUM_ID)
    const trash = list.find((a) => a.id === TRASH_ALBUM_ID)
    expect(list.map((a) => a.name)).toEqual(['已隐藏', '最近删除'])
    expect(hidden.builtin).toBe(true)
    expect(hidden.count).toBe(0)
    expect(hidden.coverImageAssetIds).toEqual([])

    expect(list.indexOf(hidden)).toBeLessThan(list.indexOf(trash))
  })

  it('已隐藏照片不进图库、用户相簿与个人收藏', () => {
    const work = makeWork(
      [
        createPhoto({
          id: 'gone',
          isHidden: true,
          isFavorite: true,
          imageAssetId: 'a_gone',
          displayTime: daysAgo(1),
        }),
        createPhoto({ id: 'alive', imageAssetId: 'a_alive', displayTime: daysAgo(2) }),
      ],
      [createAlbum({ id: 'al1', name: '夏天', photoIds: ['gone', 'alive'] })],
    )

    expect(buildPhotoGallery(work).total).toBe(1)
    expect(buildAlbumPhotos(work, 'al1').map((p) => p.id)).toEqual(['alive'])
    expect(buildAlbums(work).find((a) => a.name === '夏天').count).toBe(1)
    // 被收藏的照片一旦被隐藏，收藏相簿也不该再留它
    expect(buildAlbums(work).some((a) => a.name === '个人收藏')).toBe(false)
    expect(buildAlbumPhotos(work, FAVORITES_ALBUM_ID)).toEqual([])
  })

  it('已隐藏照片按时间倒序组封面，最多 4 张', () => {
    const work = makeWork(
      [1, 2, 3, 4, 5].map((i) =>
        createPhoto({ imageAssetId: `a${i}`, isHidden: true, displayTime: daysAgo(i) }),
      ),
    )
    const [hidden] = buildAlbums(work)
    expect(hidden.count).toBe(5)
    expect(hidden.coverImageAssetIds).toEqual(['a1', 'a2', 'a3', 'a4'])
  })
})

describe('buildAlbumPhotos', () => {
  it('保持相簿里的顺序，而不是时间倒序', () => {
    const work = makeWork(
      [
        createPhoto({ id: 'p_old', displayTime: daysAgo(30) }),
        createPhoto({ id: 'p_new', displayTime: daysAgo(1) }),
      ],
      [createAlbum({ id: 'al1', name: '编排', photoIds: ['p_old', 'p_new'] })],
    )
    expect(buildAlbumPhotos(work, 'al1').map((p) => p.id)).toEqual(['p_old', 'p_new'])
  })

  it('个人收藏按时间倒序', () => {
    const work = makeWork([
      createPhoto({ id: 'f_old', isFavorite: true, displayTime: daysAgo(30) }),
      createPhoto({ id: 'f_new', isFavorite: true, displayTime: daysAgo(1) }),
    ])
    expect(buildAlbumPhotos(work, FAVORITES_ALBUM_ID).map((p) => p.id)).toEqual([
      'f_new',
      'f_old',
    ])
  })

  it('回收站按时间倒序，且只收被标记的照片', () => {
    const work = makeWork([
      createPhoto({ id: 't_old', isInTrash: true, displayTime: daysAgo(30) }),
      createPhoto({ id: 't_new', isInTrash: true, displayTime: daysAgo(1) }),
      createPhoto({ id: 'alive', displayTime: daysAgo(0) }),
    ])
    expect(buildAlbumPhotos(work, TRASH_ALBUM_ID).map((p) => p.id)).toEqual(['t_new', 't_old'])
  })

  it('空回收站返回空数组而不是报错', () => {
    expect(buildAlbumPhotos(makeWork([createPhoto()]), TRASH_ALBUM_ID)).toEqual([])
  })

  it('已隐藏按时间倒序，且只收被标记的照片', () => {
    const work = makeWork([
      createPhoto({ id: 'h_old', isHidden: true, displayTime: daysAgo(30) }),
      createPhoto({ id: 'h_new', isHidden: true, displayTime: daysAgo(1) }),
      createPhoto({ id: 'alive', displayTime: daysAgo(0) }),
    ])
    expect(buildAlbumPhotos(work, HIDDEN_ALBUM_ID).map((p) => p.id)).toEqual([
      'h_new',
      'h_old',
    ])
  })

  it('空已隐藏返回空数组而不是报错', () => {
    expect(buildAlbumPhotos(makeWork([createPhoto()]), HIDDEN_ALBUM_ID)).toEqual([])
  })

  it('相簿不存在时返回空数组而不是抛错', () => {
    expect(buildAlbumPhotos(makeWork([]), 'al_none')).toEqual([])
    expect(buildAlbumPhotos(makeWork([]), null)).toEqual([])
  })
})
