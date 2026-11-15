import { describe, it, expect } from 'vitest'
import { FAVORITES_ALBUM_ID, HIDDEN_ALBUM_ID, TRASH_ALBUM_ID } from '@phone-sim/shared'
import {
  CAPTION_MAX_LENGTH,
  addAlbum,
  addPhoto,
  addPhotoToAlbum,
  albumMembers,
  captionFromFileName,
  deleteAlbum,
  deletePhoto,
  deletePhotos,
  photosOutsideAlbum,
  removePhotoFromAlbum,
  renameAlbum,
  setAlbumMember,
  sortPhotosByTime,
  STATUS_ALBUMS,
  updatePhoto,
  updatePhotos,
  isStatusAlbum,
} from '../photos.js'

/**
 * 最小化的 project store 替身。
 *
 * 只需要一个 mutate：真实 store 的 mutate 也是"拿到顶层浅拷贝、改完换引用"，
 * 嵌套对象仍然是同一份 —— 这里如实照抄这个语义，
 * 否则测出来的行为和编辑器里的真实行为对不上。
 */
function createEditor() {
  const editor = {
    project: {
      id: 'prj_test',
      appData: {
        photos: { photos: [], albums: [] },
      },
      assets: [],
    },
    mutate(fn) {
      const draft = { ...editor.project }
      fn(draft)
      editor.project = draft
    },
  }
  return editor
}

const bucketOf = (editor) => editor.project.appData.photos

describe('addPhoto', () => {
  it('写入一条照片记录，默认不在收藏也不在回收站', () => {
    const editor = createEditor()
    const photo = addPhoto(editor, { imageAssetId: 'ast_1' })

    expect(bucketOf(editor).photos).toHaveLength(1)
    expect(bucketOf(editor).photos[0].id).toBe(photo.id)
    expect(photo.imageAssetId).toBe('ast_1')
    expect(photo.isFavorite).toBe(false)
    expect(photo.isInTrash).toBe(false)
  })

  it('给了相簿 id 时同时挂进相簿', () => {
    const editor = createEditor()
    const album = addAlbum(editor, '旅行')
    const photo = addPhoto(editor, { imageAssetId: 'ast_1', albumId: album.id })

    expect(albumMembers(editor.project, album.id).map((p) => p.id)).toEqual([photo.id])
  })

  it('相簿 id 不存在时静默忽略，不建悬空成员', () => {
    const editor = createEditor()
    addPhoto(editor, { imageAssetId: 'ast_1', albumId: 'alb_nope' })

    expect(bucketOf(editor).albums).toHaveLength(0)
    expect(bucketOf(editor).photos).toHaveLength(1)
  })

  it('数组整体换引用，不用 push —— 否则 shallowRef 下 v-for 可能不刷新', () => {
    const editor = createEditor()
    const before = bucketOf(editor).photos
    addPhoto(editor, { imageAssetId: 'ast_1' })

    expect(bucketOf(editor).photos).not.toBe(before)
  })
})

describe('updatePhoto', () => {
  it('只接受说明、地点、时间、收藏、回收站五个字段', () => {
    const editor = createEditor()
    const photo = addPhoto(editor, { imageAssetId: 'ast_1' })

    updatePhoto(editor, photo.id, {
      caption: '窗外的雨',
      location: '学校 · 三号宿舍楼',
      isFavorite: true,
      isInTrash: true,
      // 下面两个必须被忽略：改 id 会让所有引用断掉，换图应该删掉重加
      id: 'pho_hacked',
      imageAssetId: 'ast_hacked',
    })

    const stored = bucketOf(editor).photos[0]
    expect(stored.id).toBe(photo.id)
    expect(stored.imageAssetId).toBe('ast_1')
    expect(stored.caption).toBe('窗外的雨')
    expect(stored.location).toBe('学校 · 三号宿舍楼')
    expect(stored.isFavorite).toBe(true)
    expect(stored.isInTrash).toBe(true)
  })

  it('把 id 过滤掉之后，未提供的字段保持原值', () => {
    const editor = createEditor()
    const photo = addPhoto(editor, { imageAssetId: 'ast_1', caption: '原文' })

    updatePhoto(editor, photo.id, { isFavorite: true })

    expect(bucketOf(editor).photos[0].caption).toBe('原文')
  })
})

describe('deletePhoto', () => {
  it('删记录、摘相簿，并把资源 id 交回给调用方回收', () => {
    const editor = createEditor()
    const album = addAlbum(editor, '旅行')
    const photo = addPhoto(editor, { imageAssetId: 'ast_1', albumId: album.id })

    const orphan = deletePhoto(editor, photo.id)

    expect(orphan).toBe('ast_1')
    expect(bucketOf(editor).photos).toHaveLength(0)
    expect(albumMembers(editor.project, album.id)).toHaveLength(0)
    // 相簿本身还在 —— 删照片不该顺手删掉一个空相簿
    expect(bucketOf(editor).albums).toHaveLength(1)
  })

  it('同一张图还被别的照片引用时不交回资源', () => {
    const editor = createEditor()
    const a = addPhoto(editor, { imageAssetId: 'ast_shared' })
    addPhoto(editor, { imageAssetId: 'ast_shared' })

    expect(deletePhoto(editor, a.id)).toBeNull()
  })

  it('内联 dataURL 不是资源表里的资源，没有 blob 可删', () => {
    const editor = createEditor()
    const photo = addPhoto(editor, { imageAssetId: 'data:image/png;base64,AAAA' })

    expect(deletePhoto(editor, photo.id)).toBeNull()
  })

  it('照片不存在时什么都不做，也不报错', () => {
    const editor = createEditor()
    addPhoto(editor, { imageAssetId: 'ast_1' })

    expect(deletePhoto(editor, 'pho_nope')).toBeNull()
    expect(bucketOf(editor).photos).toHaveLength(1)
  })
})

describe('相簿', () => {
  it('空名字不建相簿', () => {
    const editor = createEditor()
    expect(addAlbum(editor, '   ')).toBeNull()
    expect(bucketOf(editor).albums).toHaveLength(0)
  })

  it('orderIndex 依次递增，删掉中间一个也不会撞号', () => {
    const editor = createEditor()
    const a = addAlbum(editor, 'A')
    const b = addAlbum(editor, 'B')
    deleteAlbum(editor, a.id)
    const c = addAlbum(editor, 'C')

    expect(a.orderIndex).toBe(0)
    expect(b.orderIndex).toBe(1)
    expect(c.orderIndex).toBe(2)
  })

  it('改名会去掉首尾空白；空名字直接忽略', () => {
    const editor = createEditor()
    const album = addAlbum(editor, '原名')

    renameAlbum(editor, album.id, '  新名  ')
    expect(bucketOf(editor).albums[0].name).toBe('新名')

    renameAlbum(editor, album.id, '   ')
    expect(bucketOf(editor).albums[0].name).toBe('新名')
  })

  it('删相簿不删照片', () => {
    const editor = createEditor()
    const album = addAlbum(editor, '旅行')
    addPhoto(editor, { imageAssetId: 'ast_1', albumId: album.id })

    deleteAlbum(editor, album.id)

    expect(bucketOf(editor).albums).toHaveLength(0)
    expect(bucketOf(editor).photos).toHaveLength(1)
  })

  it('重复加入是幂等的', () => {
    const editor = createEditor()
    const album = addAlbum(editor, '旅行')
    const photo = addPhoto(editor, { imageAssetId: 'ast_1' })

    addPhotoToAlbum(editor, album.id, photo.id)
    addPhotoToAlbum(editor, album.id, photo.id)

    expect(albumMembers(editor.project, album.id)).toHaveLength(1)
  })

  it('移出相簿不删照片', () => {
    const editor = createEditor()
    const album = addAlbum(editor, '旅行')
    const photo = addPhoto(editor, { imageAssetId: 'ast_1', albumId: album.id })

    removePhotoFromAlbum(editor, album.id, photo.id)

    expect(albumMembers(editor.project, album.id)).toHaveLength(0)
    expect(bucketOf(editor).photos).toHaveLength(1)
  })

  it('成员按相簿里的排列顺序返回，不按时间重排', () => {
    const editor = createEditor()
    const album = addAlbum(editor, '旅行')
    const older = addPhoto(editor, {
      imageAssetId: 'ast_1',
      displayTime: '2020-01-01T00:00:00.000Z',
    })
    const newer = addPhoto(editor, {
      imageAssetId: 'ast_2',
      displayTime: '2026-01-01T00:00:00.000Z',
    })
    addPhotoToAlbum(editor, album.id, newer.id)
    addPhotoToAlbum(editor, album.id, older.id)

    expect(albumMembers(editor.project, album.id).map((p) => p.id)).toEqual([newer.id, older.id])
  })

  it('候选列表排除已在相簿里的照片', () => {
    const editor = createEditor()
    const album = addAlbum(editor, '旅行')
    const inside = addPhoto(editor, { imageAssetId: 'ast_1', albumId: album.id })
    const outside = addPhoto(editor, { imageAssetId: 'ast_2' })

    expect(photosOutsideAlbum(editor.project, album.id).map((p) => p.id)).toEqual([outside.id])
    expect(photosOutsideAlbum(editor.project, album.id).map((p) => p.id)).not.toContain(
      inside.id,
    )
  })
})

describe('sortPhotosByTime', () => {
  it('新的在前', () => {
    const list = [
      { id: 'a', displayTime: '2024-05-01T00:00:00.000Z' },
      { id: 'b', displayTime: '2026-05-01T00:00:00.000Z' },
      { id: 'c', displayTime: '2025-05-01T00:00:00.000Z' },
    ]
    expect(sortPhotosByTime(list).map((p) => p.id)).toEqual(['b', 'c', 'a'])
  })

  it('没有时间的排到最后，而不是被当成 1970 顶到最前', () => {
    const list = [
      { id: 'none', displayTime: null },
      { id: 'old', displayTime: '1970-01-02T00:00:00.000Z' },
    ]
    expect(sortPhotosByTime(list).map((p) => p.id)).toEqual(['old', 'none'])
  })

  it('不改动入参数组', () => {
    const list = [
      { id: 'a', displayTime: '2024-01-01T00:00:00.000Z' },
      { id: 'b', displayTime: '2026-01-01T00:00:00.000Z' },
    ]
    const snapshot = list.map((p) => p.id)
    sortPhotosByTime(list)
    expect(list.map((p) => p.id)).toEqual(snapshot)
  })
})

describe('缺桶的旧数据', () => {
  it('appData 里没有 photos 桶时能补齐，不抛错', () => {
    const editor = createEditor()
    editor.project.appData = {}
    editor.project.appData.photos = undefined

    addPhoto(editor, { imageAssetId: 'ast_1' })

    expect(bucketOf(editor).photos).toHaveLength(1)
    expect(bucketOf(editor).albums).toEqual([])
  })
})

describe('updatePhotos 批量改', () => {
  /** 包一层 mutate，数它被调用了几次 —— 批量原语的价值全在这个数字上 */
  function withMutateCounter(editor) {
    const counter = { count: 0 }
    const raw = editor.mutate
    editor.mutate = (fn) => {
      counter.count += 1
      raw(fn)
    }
    return counter
  }

  it('一次 mutate 改完所有选中项', () => {
    const editor = createEditor()
    const a = addPhoto(editor, { imageAssetId: 'ast_1' })
    const b = addPhoto(editor, { imageAssetId: 'ast_2' })
    const c = addPhoto(editor, { imageAssetId: 'ast_3' })
    const counter = withMutateCounter(editor)

    const changed = updatePhotos(editor, [a.id, c.id], { location: '厦门 · 环岛路' })

    expect(changed).toBe(2)
    expect(counter.count).toBe(1)
    const byId = Object.fromEntries(bucketOf(editor).photos.map((p) => [p.id, p.location]))
    expect(byId[a.id]).toBe('厦门 · 环岛路')
    expect(byId[b.id]).toBe('')
    expect(byId[c.id]).toBe('厦门 · 环岛路')
  })

  it('批量改时间与单张改用的是同一套白名单', () => {
    const editor = createEditor()
    const a = addPhoto(editor, { imageAssetId: 'ast_1' })
    const b = addPhoto(editor, { imageAssetId: 'ast_2' })
    const iso = '2026-07-14T20:30:00.000Z'

    updatePhotos(editor, [a.id, b.id], { displayTime: iso, id: 'pho_hacked' })

    for (const photo of bucketOf(editor).photos) {
      expect(photo.displayTime).toBe(iso)
      expect(photo.id).not.toBe('pho_hacked')
    }
  })

  it('空选择、空补丁都不写入', () => {
    const editor = createEditor()
    addPhoto(editor, { imageAssetId: 'ast_1' })
    const counter = withMutateCounter(editor)

    expect(updatePhotos(editor, [], { location: 'x' })).toBe(0)
    expect(updatePhotos(editor, ['pho_nope'], {})).toBe(0)
    expect(updatePhotos(editor, ['pho_nope'], { caption: 'x' })).toBe(0)
    // 前两次连 mutate 都不该进；第三次进了 mutate 但一条都没命中，所以还是 0 条
    expect(counter.count).toBe(1)
  })

  it('不存在或重复的 id 不会把同一条改两次', () => {
    const editor = createEditor()
    const a = addPhoto(editor, { imageAssetId: 'ast_1' })

    expect(updatePhotos(editor, [a.id, a.id, 'pho_nope'], { location: '一次' })).toBe(1)
    expect(bucketOf(editor).photos).toHaveLength(1)
    expect(bucketOf(editor).photos[0].location).toBe('一次')
  })
})

describe('deletePhotos 批量删', () => {
  it('一次删多条，并全部从相簿摘掉', () => {
    const editor = createEditor()
    const album = addAlbum(editor, '夏天')
    const a = addPhoto(editor, { imageAssetId: 'ast_1', albumId: album.id })
    const b = addPhoto(editor, { imageAssetId: 'ast_2', albumId: album.id })
    const c = addPhoto(editor, { imageAssetId: 'ast_3' })

    const orphans = deletePhotos(editor, [a.id, b.id])

    expect(bucketOf(editor).photos.map((p) => p.id)).toEqual([c.id])
    expect(albumMembers(editor.project, album.id)).toEqual([])
    expect([...orphans].sort()).toEqual(['ast_1', 'ast_2'])
  })

  it('两张共用同一张图时只回收一次', () => {
    const editor = createEditor()
    const a = addPhoto(editor, { imageAssetId: 'ast_shared' })
    const b = addPhoto(editor, { imageAssetId: 'ast_shared' })
    addPhoto(editor, { imageAssetId: 'ast_other' })

    expect(deletePhotos(editor, [a.id, b.id])).toEqual(['ast_shared'])
  })

  it('同批之外还有人在用那张图就不回收', () => {
    const editor = createEditor()
    const a = addPhoto(editor, { imageAssetId: 'ast_shared' })
    addPhoto(editor, { imageAssetId: 'ast_shared' })

    expect(deletePhotos(editor, [a.id])).toEqual([])
  })

  it('内联 dataURL 没有 blob，不进回收清单', () => {
    const editor = createEditor()
    const a = addPhoto(editor, { imageAssetId: 'data:image/svg+xml;base64,AAAA' })

    expect(deletePhotos(editor, [a.id])).toEqual([])
    expect(bucketOf(editor).photos).toHaveLength(0)
  })

  it('空选择不碰数据', () => {
    const editor = createEditor()
    addPhoto(editor, { imageAssetId: 'ast_1' })
    let mutated = 0
    const raw = editor.mutate
    editor.mutate = (fn) => {
      mutated += 1
      raw(fn)
    }

    expect(deletePhotos(editor, [])).toEqual([])
    expect(mutated).toBe(0)
    expect(bucketOf(editor).photos).toHaveLength(1)
  })

  it('单条删除走的是同一个实现（回归：仍返回那个 assetId）', () => {
    const editor = createEditor()
    const a = addPhoto(editor, { imageAssetId: 'ast_1' })

    expect(deletePhoto(editor, a.id)).toBe('ast_1')
    expect(deletePhoto(editor, 'pho_nope')).toBeNull()
  })
})

describe('默认说明取自文件名', () => {
  it('去掉扩展名', () => {
    expect(captionFromFileName('IMG_2034.jpg')).toBe('IMG_2034')
    expect(captionFromFileName('宿舍窗外的雨.png')).toBe('宿舍窗外的雨')
  })

  it('只去最后一段 —— 中间的点属于名字本身', () => {
    expect(captionFromFileName('my.holiday.2024.jpeg')).toBe('my.holiday.2024')
    expect(captionFromFileName('archive.tar.gz')).toBe('archive.tar')
  })

  it('没有扩展名时原样保留', () => {
    expect(captionFromFileName('screenshot')).toBe('screenshot')
  })

  it('以点开头的文件名不截成空串', () => {
    expect(captionFromFileName('.png')).toBe('.png')
  })

  it('带路径时只取文件名部分', () => {
    expect(captionFromFileName('C:\\Users\\me\\Pictures\\海边.jpg')).toBe('海边')
    expect(captionFromFileName('/home/me/pics/海边.jpg')).toBe('海边')
  })

  it('去掉首尾空白', () => {
    expect(captionFromFileName('  风景 .jpg')).toBe('风景')
  })

  it('超长名字截到说明框上限', () => {
    const long = `${'a'.repeat(120)}.jpg`
    expect(captionFromFileName(long)).toHaveLength(CAPTION_MAX_LENGTH)
  })

  it('空文件名与缺省入参都返回空串', () => {
    expect(captionFromFileName('')).toBe('')
    expect(captionFromFileName(undefined)).toBe('')
    expect(captionFromFileName(null)).toBe('')
  })
})

describe('回收站标记', () => {
  it('开关只改标记：照片、资源引用都还在，且可恢复', () => {
    const editor = createEditor()
    const photo = addPhoto(editor, { imageAssetId: 'ast_1' })

    updatePhoto(editor, photo.id, { isInTrash: true })
    expect(bucketOf(editor).photos).toHaveLength(1)
    expect(bucketOf(editor).photos[0].isInTrash).toBe(true)
    expect(bucketOf(editor).photos[0].imageAssetId).toBe('ast_1')

    updatePhoto(editor, photo.id, { isInTrash: false })
    expect(bucketOf(editor).photos[0].isInTrash).toBe(false)
  })

  it('批量原语也能改回收站标记', () => {
    const editor = createEditor()
    const a = addPhoto(editor, { imageAssetId: 'ast_1' })
    addPhoto(editor, { imageAssetId: 'ast_2' })

    expect(updatePhotos(editor, [a.id], { isInTrash: true })).toBe(1)
    expect(bucketOf(editor).photos.map((p) => p.isInTrash)).toEqual([true, false])
  })

  it('「从图库添加」的候选里不出现回收站照片', () => {
    const editor = createEditor()
    const album = addAlbum(editor, '夏天')
    const trashed = addPhoto(editor, { imageAssetId: 'ast_1' })
    const alive = addPhoto(editor, { imageAssetId: 'ast_2' })
    updatePhotos(editor, [trashed.id], { isInTrash: true })

    expect(photosOutsideAlbum(editor.project, album.id).map((p) => p.id)).toEqual([alive.id])
  })

  it('相簿成员同样排除回收站照片，恢复后自动回到原相簿', () => {
    const editor = createEditor()
    const album = addAlbum(editor, '夏天')
    const photo = addPhoto(editor, { imageAssetId: 'ast_1', albumId: album.id })

    updatePhoto(editor, photo.id, { isInTrash: true })
    expect(albumMembers(editor.project, album.id)).toEqual([])
    // 成员被滤掉之后，不能反过来把它当成"还没进相簿"塞进候选
    expect(photosOutsideAlbum(editor.project, album.id).map((p) => p.id)).not.toContain(photo.id)

    updatePhoto(editor, photo.id, { isInTrash: false })
    expect(albumMembers(editor.project, album.id).map((p) => p.id)).toEqual([photo.id])
  })
})

describe('已隐藏标记', () => {
  it('开关只改标记：照片、资源引用都还在，且可取消隐藏', () => {
    const editor = createEditor()
    const photo = addPhoto(editor, { imageAssetId: 'ast_1' })

    updatePhoto(editor, photo.id, { isHidden: true })
    expect(bucketOf(editor).photos).toHaveLength(1)
    expect(bucketOf(editor).photos[0].isHidden).toBe(true)
    expect(bucketOf(editor).photos[0].imageAssetId).toBe('ast_1')

    updatePhoto(editor, photo.id, { isHidden: false })
    expect(bucketOf(editor).photos[0].isHidden).toBe(false)
  })

  it('批量原语也能改已隐藏标记', () => {
    const editor = createEditor()
    const a = addPhoto(editor, { imageAssetId: 'ast_1' })
    addPhoto(editor, { imageAssetId: 'ast_2' })

    expect(updatePhotos(editor, [a.id], { isHidden: true })).toBe(1)
    expect(bucketOf(editor).photos.map((p) => p.isHidden)).toEqual([true, false])
  })

  it('「从图库添加」的候选里不出现已隐藏照片', () => {
    const editor = createEditor()
    const album = addAlbum(editor, '夏天')
    const hidden = addPhoto(editor, { imageAssetId: 'ast_1' })
    const alive = addPhoto(editor, { imageAssetId: 'ast_2' })
    updatePhotos(editor, [hidden.id], { isHidden: true })

    expect(photosOutsideAlbum(editor.project, album.id).map((p) => p.id)).toEqual([alive.id])
  })

  it('相簿成员同样排除已隐藏照片，取消隐藏后自动回到原相簿', () => {
    const editor = createEditor()
    const album = addAlbum(editor, '夏天')
    const photo = addPhoto(editor, { imageAssetId: 'ast_1', albumId: album.id })

    updatePhoto(editor, photo.id, { isHidden: true })
    expect(albumMembers(editor.project, album.id)).toEqual([])
    expect(photosOutsideAlbum(editor.project, album.id).map((p) => p.id)).not.toContain(photo.id)

    updatePhoto(editor, photo.id, { isHidden: false })
    expect(albumMembers(editor.project, album.id).map((p) => p.id)).toEqual([photo.id])
  })
})

describe('固定相簿：三个状态标记外化成普通相簿', () => {
  /** 普通 / 收藏 / 隐藏 / 回收站各一张，时间递增，方便验时间倒序 */
  function seed() {
    const editor = createEditor()
    const a = addPhoto(editor, { imageAssetId: 'ast_a', displayTime: '2026-01-01T00:00:00Z' })
    const b = addPhoto(editor, { imageAssetId: 'ast_b', displayTime: '2026-01-02T00:00:00Z' })
    const c = addPhoto(editor, { imageAssetId: 'ast_c', displayTime: '2026-01-03T00:00:00Z' })
    const d = addPhoto(editor, { imageAssetId: 'ast_d', displayTime: '2026-01-04T00:00:00Z' })
    updatePhoto(editor, b.id, { isFavorite: true })
    updatePhoto(editor, c.id, { isHidden: true })
    updatePhoto(editor, d.id, { isInTrash: true })
    return { editor, a, b, c, d }
  }

  it('三本固定相簿常驻，id 与作品端同源', () => {
    expect(STATUS_ALBUMS.map((x) => x.name)).toEqual(['个人收藏', '已隐藏', '最近删除'])
    expect(STATUS_ALBUMS.map((x) => x.flag)).toEqual(['isFavorite', 'isHidden', 'isInTrash'])
    expect(STATUS_ALBUMS.map((x) => x.id)).toEqual([
      FAVORITES_ALBUM_ID, HIDDEN_ALBUM_ID, TRASH_ALBUM_ID,
    ])
    expect(isStatusAlbum(FAVORITES_ALBUM_ID)).toBe(true)
    expect(isStatusAlbum('alb_user')).toBe(false)
  })

  it('成员口径与作品端一致：删 > 藏 > 收藏，三者互不重叠', () => {
    const { editor, a, b, c, d } = seed()
    expect(albumMembers(editor.project, FAVORITES_ALBUM_ID).map((p) => p.id)).toEqual([b.id])
    expect(albumMembers(editor.project, HIDDEN_ALBUM_ID).map((p) => p.id)).toEqual([c.id])
    expect(albumMembers(editor.project, TRASH_ALBUM_ID).map((p) => p.id)).toEqual([d.id])
    expect(albumMembers(editor.project, FAVORITES_ALBUM_ID).map((p) => p.id)).not.toContain(a.id)
  })

  it('既收藏又隐藏：只算已隐藏；既隐藏又删除：只算最近删除', () => {
    const { editor, b, c } = seed()
    updatePhoto(editor, c.id, { isFavorite: true })
    expect(albumMembers(editor.project, FAVORITES_ALBUM_ID).map((p) => p.id)).toEqual([b.id])

    updatePhoto(editor, c.id, { isInTrash: true })
    expect(albumMembers(editor.project, HIDDEN_ALBUM_ID)).toEqual([])
    expect(albumMembers(editor.project, TRASH_ALBUM_ID).map((p) => p.id)).toContain(c.id)
  })

  it('候选只取「既没删也没藏」的照片，收藏夹额外剔掉已收藏的', () => {
    const { editor, a, b } = seed()
    expect(photosOutsideAlbum(editor.project, FAVORITES_ALBUM_ID).map((p) => p.id)).toEqual([a.id])
    expect(photosOutsideAlbum(editor.project, HIDDEN_ALBUM_ID).map((p) => p.id)).toEqual([b.id, a.id])
    expect(photosOutsideAlbum(editor.project, TRASH_ALBUM_ID).map((p) => p.id)).toEqual([b.id, a.id])
  })

  it('成员按时间倒序（没有 photoIds 就没有作者手排顺序）', () => {
    const { editor, a } = seed()
    updatePhoto(editor, a.id, { isInTrash: true })
    expect(albumMembers(editor.project, TRASH_ALBUM_ID).map((p) => p.imageAssetId)).toEqual([
      'ast_d', 'ast_a',
    ])
  })

  it('点「＋ 加入 / × 移出」就是打 / 清标记，往返可逆', () => {
    const { editor, a } = seed()
    const flagsOf = () => {
      const p = bucketOf(editor).photos.find((x) => x.id === a.id)
      return [p.isFavorite, p.isHidden, p.isInTrash]
    }

    setAlbumMember(editor, FAVORITES_ALBUM_ID, a.id, true)
    expect(flagsOf()).toEqual([true, false, false])
    setAlbumMember(editor, FAVORITES_ALBUM_ID, a.id, false)
    expect(flagsOf()).toEqual([false, false, false])

    setAlbumMember(editor, HIDDEN_ALBUM_ID, a.id, true)
    expect(flagsOf()).toEqual([false, true, false])
    setAlbumMember(editor, HIDDEN_ALBUM_ID, a.id, false)
    expect(flagsOf()).toEqual([false, false, false])

    setAlbumMember(editor, TRASH_ALBUM_ID, a.id, true)
    expect(flagsOf()).toEqual([false, false, true])
    setAlbumMember(editor, TRASH_ALBUM_ID, a.id, false)
    expect(flagsOf()).toEqual([false, false, false])
  })

  it('普通相簿走统一入口仍旧只改 photoIds，不产生任何标记', () => {
    const { editor, a } = seed()
    const album = addAlbum(editor, '旅行')

    setAlbumMember(editor, album.id, a.id, true)
    expect(bucketOf(editor).albums[0].photoIds).toEqual([a.id])
    expect(albumMembers(editor.project, album.id).map((p) => p.id)).toEqual([a.id])
    expect(bucketOf(editor).photos.find((p) => p.id === a.id).isFavorite).toBe(false)

    setAlbumMember(editor, album.id, a.id, false)
    expect(bucketOf(editor).albums[0].photoIds).toEqual([])
  })

  it('固定相簿不是 album 记录，落盘数据里不出现它们的 id', () => {
    const { editor } = seed()
    expect(bucketOf(editor).albums).toEqual([])
    expect(STATUS_ALBUMS.some((x) => bucketOf(editor).albums.some((a) => a.id === x.id))).toBe(false)
  })
})
