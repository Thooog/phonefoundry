import { describe, it, expect } from 'vitest'

import {
  STORY_CAPTION_MAX_LENGTH,
  addStory,
  deleteStory,
  framesWithoutImage,
  storiesOf,
  storyGroups,
  updateStory,
} from '../stories.js'

/**
 * 最小化的 project store 替身。
 * 与 notes.test.js 同一套写法：mutate 拿顶层浅拷贝、改完换引用。
 */
function createEditor() {
  let mutations = 0
  const editor = {
    project: {
      id: 'prj_test',
      characters: [
        { id: 'chr_a', name: '林夏' },
        { id: 'chr_b', name: '周予安' },
      ],
      platformAccounts: [
        { id: 'acc_ig_a', characterId: 'chr_a', platform: 'instagram', displayName: '夏天的林夏', handle: 'linxia' },
        { id: 'acc_ig_b', characterId: 'chr_b', platform: 'instagram', displayName: '周予安', handle: 'zhouyuan' },
        { id: 'acc_kt_a', characterId: 'chr_a', platform: 'kakaotalk', displayName: '林夏', handle: 'lin' },
      ],
      appData: { instagram: { posts: [], comments: [], stories: [] } },
      assets: [],
    },
    get mutations() {
      return mutations
    },
    mutate(fn) {
      mutations += 1
      const draft = { ...editor.project }
      fn(draft)
      editor.project = draft
    },
  }
  return editor
}

const storiesIn = (editor) => editor.project.appData.instagram.stories

describe('addStory', () => {
  it('写入一帧，默认没图、没看过、时间可解析', () => {
    const editor = createEditor()
    const story = addStory(editor, { characterId: 'chr_a' })

    expect(storiesIn(editor)).toHaveLength(1)
    expect(story.imageAssetId).toBeNull()
    expect(story.seen).toBe(false)
    expect(story.caption).toBe('')
    expect(Number.isFinite(Date.parse(story.displayTime))).toBe(true)
  })

  it('同时写角色与该角色的 Instagram 账号（两处都要有）', () => {
    const editor = createEditor()
    const story = addStory(editor, { characterId: 'chr_a' })

    expect(story.authorCharacterId).toBe('chr_a')
    expect(story.authorAccountId).toBe('acc_ig_a')
  })

  it('角色没有 Instagram 账号时账号留空，但角色照写', () => {
    const editor = createEditor()
    editor.project.characters.push({ id: 'chr_c', name: '没有账号的人' })
    const story = addStory(editor, { characterId: 'chr_c' })

    expect(story.authorCharacterId).toBe('chr_c')
    expect(story.authorAccountId).toBeNull()
  })

  it('不传作者时两个 id 都是空 —— 这种帧在作品里不会出现', () => {
    const editor = createEditor()
    const story = addStory(editor, {})

    expect(story.authorCharacterId).toBeNull()
    expect(story.authorAccountId).toBeNull()
  })

  it('贴纸文字超长时截断', () => {
    const editor = createEditor()
    const story = addStory(editor, {
      characterId: 'chr_a',
      caption: 'x'.repeat(STORY_CAPTION_MAX_LENGTH + 50),
    })

    expect(story.caption).toHaveLength(STORY_CAPTION_MAX_LENGTH)
  })

  it('seen 只认真布尔语义（"1" 这种也给真）', () => {
    const editor = createEditor()
    expect(addStory(editor, { characterId: 'chr_a', seen: 1 }).seen).toBe(true)
    expect(addStory(editor, { characterId: 'chr_a', seen: 0 }).seen).toBe(false)
  })

  it('一次操作只涨一次 revision', () => {
    const editor = createEditor()
    const before = editor.mutations
    addStory(editor, { characterId: 'chr_a' })
    expect(editor.mutations).toBe(before + 1)
  })
})

describe('storiesOf', () => {
  it('按剧情时间正序（播放顺序），不是帖子那样的倒序', () => {
    const editor = createEditor()
    addStory(editor, { characterId: 'chr_a', displayTime: '2026-05-03T10:00:00.000Z' })
    addStory(editor, { characterId: 'chr_a', displayTime: '2026-05-03T08:00:00.000Z' })
    addStory(editor, { characterId: 'chr_a', displayTime: '2026-05-03T09:00:00.000Z' })

    expect(storiesOf(editor.project).map((s) => s.displayTime.slice(11, 13))).toEqual([
      '08',
      '09',
      '10',
    ])
  })

  it('时间读不出来的沉到最后，不顶着当第一帧', () => {
    const editor = createEditor()
    addStory(editor, { characterId: 'chr_a', displayTime: '2026-05-03T10:00:00.000Z' })
    addStory(editor, { characterId: 'chr_a', displayTime: '不是时间' })

    const list = storiesOf(editor.project)
    expect(list[list.length - 1].displayTime).toBe('不是时间')
  })

  it('时间完全相同时按 id 兜底，顺序是稳定的', () => {
    const editor = createEditor()
    const t = '2026-05-03T10:00:00.000Z'
    addStory(editor, { characterId: 'chr_a', displayTime: t })
    addStory(editor, { characterId: 'chr_a', displayTime: t })

    const first = storiesOf(editor.project).map((s) => s.id)
    const second = storiesOf(editor.project).map((s) => s.id)
    expect(first).toEqual(second)
  })
})

describe('storyGroups', () => {
  it('同一个人的多帧合成一组，组内按时间正序', () => {
    const editor = createEditor()
    addStory(editor, { characterId: 'chr_a', displayTime: '2026-05-03T08:00:00.000Z' })
    addStory(editor, { characterId: 'chr_a', displayTime: '2026-05-03T09:00:00.000Z' })
    addStory(editor, { characterId: 'chr_b', displayTime: '2026-05-03T07:00:00.000Z' })

    const groups = storyGroups(editor.project)
    expect(groups).toHaveLength(2)

    const a = groups.find((g) => g.key === 'acc_ig_a')
    expect(a.total).toBe(2)
    expect(a.frames.map((f) => f.displayTime.slice(11, 13))).toEqual(['08', '09'])
    expect(a.name).toBe('夏天的林夏')
    expect(a.handle).toBe('linxia')
  })

  it('组间按最新一帧倒序（刚发的人在最上面）', () => {
    const editor = createEditor()
    addStory(editor, { characterId: 'chr_a', displayTime: '2026-05-03T08:00:00.000Z' })
    addStory(editor, { characterId: 'chr_b', displayTime: '2026-05-03T12:00:00.000Z' })

    expect(storyGroups(editor.project).map((g) => g.key)).toEqual(['acc_ig_b', 'acc_ig_a'])
  })

  it('勾了「预设已看」也不会让整组跳到别处（与作品端托盘排序不同）', () => {
    const editor = createEditor()
    const a = addStory(editor, { characterId: 'chr_a', displayTime: '2026-05-03T12:00:00.000Z' })
    addStory(editor, { characterId: 'chr_b', displayTime: '2026-05-03T08:00:00.000Z' })

    const before = storyGroups(editor.project).map((g) => g.key)
    updateStory(editor, a.id, { seen: true })
    expect(storyGroups(editor.project).map((g) => g.key)).toEqual(before)
  })

  it('没有作者的帧单独成组并排在最后 —— 作品里会被跳过', () => {
    const editor = createEditor()
    addStory(editor, { characterId: 'chr_a', displayTime: '2026-05-03T08:00:00.000Z' })
    addStory(editor, {})

    const groups = storyGroups(editor.project)
    expect(groups[groups.length - 1].key).toBe('')
  })

  it('分组 key 与作品端同判据：账号优先于角色', () => {
    const editor = createEditor()
    // 只有账号、没有角色的脏数据，与正常写入的同一账号帧应归到一组 ——
    // 作品端的 key 也是 `authorAccountId || authorCharacterId`，两边必须一致
    editor.project.appData.instagram.stories.push({
      id: 'sty_orphan',
      authorCharacterId: null,
      authorAccountId: 'acc_ig_a',
      imageAssetId: 'ast_1',
      caption: '',
      displayTime: '2026-05-03T08:00:00.000Z',
      seen: false,
    })
    addStory(editor, { characterId: 'chr_a', displayTime: '2026-05-03T09:00:00.000Z' })

    const groups = storyGroups(editor.project)
    expect(groups).toHaveLength(1)
    expect(groups[0].key).toBe('acc_ig_a')
    expect(groups[0].total).toBe(2)
  })

  it('统计未看帧数，用于组头提示', () => {
    const editor = createEditor()
    addStory(editor, { characterId: 'chr_a', seen: true })
    addStory(editor, { characterId: 'chr_a', seen: false })

    const group = storyGroups(editor.project)[0]
    expect(group.seenCount).toBe(1)
    expect(group.total).toBe(2)
  })
})

describe('updateStory', () => {
  it('改作者时把账号一起重算，不然这一帧会掉出原来的组', () => {
    const editor = createEditor()
    const story = addStory(editor, { characterId: 'chr_a' })

    const updated = updateStory(editor, story.id, { authorCharacterId: 'chr_b' })
    expect(updated.authorCharacterId).toBe('chr_b')
    expect(updated.authorAccountId).toBe('acc_ig_b')
  })

  it('把作者清空时两个 id 一起清空', () => {
    const editor = createEditor()
    const story = addStory(editor, { characterId: 'chr_a' })

    const updated = updateStory(editor, story.id, { authorCharacterId: null })
    expect(updated.authorCharacterId).toBeNull()
    expect(updated.authorAccountId).toBeNull()
  })

  it('没传的字段保持不变（只改 seen 不会洗掉 caption）', () => {
    const editor = createEditor()
    const story = addStory(editor, { characterId: 'chr_a', caption: '下课了' })

    const updated = updateStory(editor, story.id, { seen: true })
    expect(updated.caption).toBe('下课了')
    expect(updated.seen).toBe(true)
    expect(updated.authorCharacterId).toBe('chr_a')
  })

  it('id 与 createdAt 不在白名单里', () => {
    const editor = createEditor()
    const story = addStory(editor, { characterId: 'chr_a' })

    const updated = updateStory(editor, story.id, {
      id: 'sty_hacked',
      createdAt: '1999-01-01T00:00:00.000Z',
    })
    expect(updated).toBeNull()
    expect(storiesIn(editor)[0].id).toBe(story.id)
  })

  it('空 patch 不触发 mutate', () => {
    const editor = createEditor()
    const story = addStory(editor, { characterId: 'chr_a' })
    const before = editor.mutations

    expect(updateStory(editor, story.id, {})).toBeNull()
    expect(editor.mutations).toBe(before)
  })

  it('贴纸文字改超长时照样截断', () => {
    const editor = createEditor()
    const story = addStory(editor, { characterId: 'chr_a' })

    const updated = updateStory(editor, story.id, {
      caption: 'y'.repeat(STORY_CAPTION_MAX_LENGTH + 5),
    })
    expect(updated.caption).toHaveLength(STORY_CAPTION_MAX_LENGTH)
  })
})

describe('deleteStory', () => {
  it('删掉指定帧，其余不动', () => {
    const editor = createEditor()
    const a = addStory(editor, { characterId: 'chr_a' })
    addStory(editor, { characterId: 'chr_a' })

    expect(deleteStory(editor, a.id).removed).toBe(true)
    expect(storiesIn(editor)).toHaveLength(1)
    expect(storiesIn(editor)[0].id).not.toBe(a.id)
  })

  it('删不存在的帧返回 false，revision 仍涨一次（与其它编辑层一致）', () => {
    const editor = createEditor()
    expect(deleteStory(editor, 'sty_missing').removed).toBe(false)
  })
})

describe('framesWithoutImage', () => {
  it('数出一组里还没配图的帧数', () => {
    const editor = createEditor()
    addStory(editor, { characterId: 'chr_a' })
    const withImage = addStory(editor, { characterId: 'chr_a' })
    updateStory(editor, withImage.id, { imageAssetId: 'ast_1' })

    const group = storyGroups(editor.project)[0]
    expect(framesWithoutImage(group)).toBe(1)
  })
})
