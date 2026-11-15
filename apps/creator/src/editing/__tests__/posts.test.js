import { describe, it, expect } from 'vitest'

import {
  POST_CONTENT_MAX_LENGTH,
  addComment,
  addPost,
  commentThread,
  commentsOf,
  countCommentsOf,
  countRepliesUnder,
  deleteComment,
  deletePost,
  mediaMaxOf,
  orphanAssetIds,
  resolveAuthorFields,
  sortPostsByTime,
  updateComment,
  updatePost,
} from '../posts.js'

function createEditor(overrides = {}) {
  let mutations = 0
  const editor = {
    project: {
      id: 'prj_test',
      characters: [],
      platformAccounts: [],
      appData: { x: { posts: [], replies: [] } },
      assets: [],
      ...overrides,
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

const bucketOf = (editor) => editor.project.appData.x

describe('resolveAuthorFields', () => {
  it('角色在该平台有账号时，两个 id 都写', () => {
    const editor = createEditor()
    editor.project.characters = [{ id: 'chr_1', name: '安禾' }]
    editor.project.platformAccounts = [
      { id: 'acc_x', characterId: 'chr_1', platform: 'x', displayName: 'anhe' },
    ]

    expect(resolveAuthorFields(editor.project, 'x', 'chr_1')).toEqual({
      authorCharacterId: 'chr_1',
      authorAccountId: 'acc_x',
    })
  })

  it('没有账号时只写角色 —— 个人主页靠 characterId 过滤，不能省', () => {
    const editor = createEditor()
    editor.project.characters = [{ id: 'chr_1', name: '安禾' }]

    expect(resolveAuthorFields(editor.project, 'x', 'chr_1')).toEqual({
      authorCharacterId: 'chr_1',
      authorAccountId: null,
    })
  })

  it('别的平台的账号不会被误认', () => {
    const editor = createEditor()
    editor.project.platformAccounts = [
      { id: 'acc_ig', characterId: 'chr_1', platform: 'instagram', displayName: 'x' },
    ]
    expect(resolveAuthorFields(editor.project, 'x', 'chr_1').authorAccountId).toBeNull()
  })

  it('没选角色时两个都是 null', () => {
    const editor = createEditor()
    expect(resolveAuthorFields(editor.project, 'x', null)).toEqual({
      authorCharacterId: null,
      authorAccountId: null,
    })
  })
})

describe('addPost', () => {
  it('默认四个指标都是 0', () => {
    const editor = createEditor()
    const post = addPost(editor, { app: 'x', content: '今天下雨' })

    expect(post.content).toBe('今天下雨')
    expect(post.metrics).toEqual({ likes: 0, reposts: 0, replies: 0, views: 0 })
    expect(bucketOf(editor).posts).toHaveLength(1)
  })

  it('正文超长被截断', () => {
    const editor = createEditor()
    const post = addPost(editor, { app: 'x', content: 'x'.repeat(POST_CONTENT_MAX_LENGTH + 20) })
    expect(post.content).toHaveLength(POST_CONTENT_MAX_LENGTH)
  })

  it('X 的图片支持多张', () => {
    const editor = createEditor()
    const post = addPost(editor, {
      app: 'x',
      content: 'a',
      mediaAssetIds: ['a1', 'a2', 'a3'],
    })
    expect(post.mediaAssetIds).toEqual(['a1', 'a2', 'a3'])
  })

  it('X / Instagram 的图片不设数量上限，只去重去空', () => {
    const editor = createEditor()
    const many = Array.from({ length: 9 }, (_, i) => `a${i}`)
    const post = addPost(editor, { app: 'x', content: 'a', mediaAssetIds: [...many, 'a1', ''] })
    expect(post.mediaAssetIds).toEqual(many)
  })

  it('不指定 app 会直接报错，而不是写进一个无名的桶', () => {
    const editor = createEditor()
    expect(() => addPost(editor, { content: 'a' })).toThrow(/应用/)
  })
})

describe('updatePost', () => {
  it('改一个指标不会抹掉另外三个', () => {
    const editor = createEditor()
    const post = addPost(editor, {
      app: 'x',
      content: 'a',
      metrics: { likes: 5, reposts: 3, replies: 12, views: 900 },
    })

    const updated = updatePost(editor, 'x', post.id, { metrics: { likes: 10 } })

    // 整块替换的话后面三个会变 0 —— 用户只改了「赞」
    expect(updated.metrics).toEqual({ likes: 10, reposts: 3, replies: 12, views: 900 })
  })

  it('负数指标归零', () => {
    const editor = createEditor()
    const post = addPost(editor, { app: 'x', content: 'a' })
    const updated = updatePost(editor, 'x', post.id, { metrics: { likes: -5 } })
    expect(updated.metrics.likes).toBe(0)
  })

  it('白名单之外的字段改不动', () => {
    const editor = createEditor()
    const post = addPost(editor, { app: 'x', content: 'a' })
    updatePost(editor, 'x', post.id, { id: 'hacked', createdAt: '1970-01-01T00:00:00.000Z' })

    expect(bucketOf(editor).posts[0].id).toBe(post.id)
    expect(bucketOf(editor).posts[0].createdAt).toBe(post.createdAt)
  })

  it('id 不存在时返回 null', () => {
    const editor = createEditor()
    expect(updatePost(editor, 'x', 'post_nope', { content: 'b' })).toBeNull()
  })
})

describe('addComment', () => {
  it('不传 parentId 时挂在帖子下', () => {
    const editor = createEditor()
    const post = addPost(editor, { app: 'x', content: 'a' })
    const reply = addComment(editor, { app: 'x', postId: post.id, content: '真的吗' })

    expect(reply.parentId).toBe(post.id)
    expect(bucketOf(editor).replies).toHaveLength(1)
  })

  it('传了 parentId 就是回某条回复', () => {
    const editor = createEditor()
    const post = addPost(editor, { app: 'x', content: 'a' })
    const first = addComment(editor, { app: 'x', postId: post.id, content: '1' })
    const second = addComment(editor, {
      app: 'x',
      postId: post.id,
      parentId: first.id,
      content: '2',
    })

    expect(second.parentId).toBe(first.id)
  })

  it('缺 app 或 postId 时报错', () => {
    const editor = createEditor()
    expect(() => addComment(editor, { app: 'x', content: 'a' })).toThrow(/帖子/)
  })
})

describe('commentsOf', () => {
  it('返回这条帖子的回复，含子级，按时间正序', () => {
    const editor = createEditor()
    const post = addPost(editor, { app: 'x', content: 'a' })

    const first = addComment(editor, {
      app: 'x',
      postId: post.id,
      content: '1',
      displayTime: '2026-10-01T10:00:00.000Z',
    })
    addComment(editor, {
      app: 'x',
      postId: post.id,
      parentId: first.id,
      content: '2',
      displayTime: '2026-10-01T11:00:00.000Z',
    })

    const list = commentsOf(editor.project, 'x', post.id)
    expect(list.map((c) => c.content)).toEqual(['1', '2'])
  })

  it('不会串到另一条帖子去', () => {
    const editor = createEditor()
    const a = addPost(editor, { app: 'x', content: 'a' })
    const b = addPost(editor, { app: 'x', content: 'b' })
    addComment(editor, { app: 'x', postId: a.id, content: 'A 的回复' })
    addComment(editor, { app: 'x', postId: b.id, content: 'B 的回复' })

    expect(commentsOf(editor.project, 'x', a.id).map((c) => c.content)).toEqual(['A 的回复'])
    expect(commentsOf(editor.project, 'x', b.id).map((c) => c.content)).toEqual(['B 的回复'])
  })
})

describe('commentThread', () => {
  /** 造一棵：a → a1 → a1x，以及同层的 a2；另有顶层 b */
  function buildTree(editor) {
    const post = addPost(editor, { app: 'x', content: '正文' })
    const a = addComment(editor, {
      app: 'x',
      postId: post.id,
      content: 'a',
      displayTime: '2026-10-01T10:00:00.000Z',
    })
    const a1 = addComment(editor, {
      app: 'x',
      postId: post.id,
      parentId: a.id,
      content: 'a1',
      displayTime: '2026-10-01T10:01:00.000Z',
    })
    addComment(editor, {
      app: 'x',
      postId: post.id,
      parentId: a1.id,
      content: 'a1x',
      displayTime: '2026-10-01T10:02:00.000Z',
    })
    addComment(editor, {
      app: 'x',
      postId: post.id,
      parentId: a.id,
      content: 'a2',
      displayTime: '2026-10-01T10:03:00.000Z',
    })
    addComment(editor, {
      app: 'x',
      postId: post.id,
      content: 'b',
      displayTime: '2026-10-01T10:04:00.000Z',
    })
    return post
  }

  it('按"一条对话连着看完"的顺序摊平，并带上层级', () => {
    const editor = createEditor()
    const post = buildTree(editor)

    const thread = commentThread(editor.project, 'x', post.id)
    expect(thread.map((i) => i.node.content)).toEqual(['a', 'a1', 'a1x', 'a2', 'b'])
    expect(thread.map((i) => i.depth)).toEqual([0, 1, 2, 1, 0])
  })

  it('父级被删的回复不会消失，按顶层接住', () => {
    const editor = createEditor()
    const post = addPost(editor, { app: 'x', content: '正文' })
    const parent = addComment(editor, { app: 'x', postId: post.id, content: 'parent' })
    const orphan = addComment(editor, {
      app: 'x',
      postId: post.id,
      parentId: parent.id,
      content: 'orphan',
    })

    editor.project = {
      ...editor.project,
      appData: { x: { posts: [post], replies: [{ ...orphan, parentId: 'cmt_gone' }] } },
    }

    const thread = commentThread(editor.project, 'x', post.id)
    expect(thread.map((i) => [i.node.content, i.depth])).toEqual([['orphan', 0]])
  })

  it('只算这条帖子的回复', () => {
    const editor = createEditor()
    const a = addPost(editor, { app: 'x', content: 'a' })
    const b = addPost(editor, { app: 'x', content: 'b' })
    addComment(editor, { app: 'x', postId: a.id, content: 'A 的' })
    addComment(editor, { app: 'x', postId: b.id, content: 'B 的' })

    expect(commentThread(editor.project, 'x', a.id).map((i) => i.node.content)).toEqual(['A 的'])
  })
})

describe('countRepliesUnder', () => {
  it('数的是整棵子树，不含自己', () => {
    const editor = createEditor()
    const post = addPost(editor, { app: 'x', content: '正文' })
    const a = addComment(editor, { app: 'x', postId: post.id, content: 'a' })
    const a1 = addComment(editor, { app: 'x', postId: post.id, parentId: a.id, content: 'a1' })
    addComment(editor, { app: 'x', postId: post.id, parentId: a1.id, content: 'a1x' })

    expect(countRepliesUnder(editor.project, 'x', a.id)).toBe(2)
    expect(countRepliesUnder(editor.project, 'x', a1.id)).toBe(1)
    expect(countRepliesUnder(editor.project, 'x', 'cmt_none')).toBe(0)
  })
})

describe('deletePost', () => {
  it('连带删掉它名下所有回复，包括子级', () => {
    const editor = createEditor()
    const post = addPost(editor, { app: 'x', content: 'a' })
    const first = addComment(editor, { app: 'x', postId: post.id, content: '1' })
    addComment(editor, { app: 'x', postId: post.id, parentId: first.id, content: '2' })

    const result = deletePost(editor, 'x', post.id)

    expect(result.removed).toBe(true)
    expect(result.removedComments).toBe(2)
    expect(bucketOf(editor).replies).toHaveLength(0)
  })

  it('不碰别的帖子的回复', () => {
    const editor = createEditor()
    const a = addPost(editor, { app: 'x', content: 'a' })
    const b = addPost(editor, { app: 'x', content: 'b' })
    addComment(editor, { app: 'x', postId: a.id, content: '留' })
    addComment(editor, { app: 'x', postId: b.id, content: '删' })

    deletePost(editor, 'x', b.id)
    expect(bucketOf(editor).replies.map((r) => r.content)).toEqual(['留'])
  })

  it('一次 mutate 完成（帖子 + 回复同一次提交）', () => {
    const editor = createEditor()
    const post = addPost(editor, { app: 'x', content: 'a' })
    addComment(editor, { app: 'x', postId: post.id, content: '1' })

    const before = editor.mutations
    deletePost(editor, 'x', post.id)
    expect(editor.mutations - before).toBe(1)
  })
})

describe('deleteComment', () => {
  it('连带删掉子级回复', () => {
    const editor = createEditor()
    const post = addPost(editor, { app: 'x', content: 'a' })
    const first = addComment(editor, { app: 'x', postId: post.id, content: '1' })
    const second = addComment(editor, { app: 'x', postId: post.id, parentId: first.id, content: '2' })
    addComment(editor, { app: 'x', postId: post.id, parentId: second.id, content: '3' })
    addComment(editor, { app: 'x', postId: post.id, content: '无关' })

    const result = deleteComment(editor, 'x', first.id)

    expect(result.removedComments).toBe(3)
    expect(bucketOf(editor).replies.map((r) => r.content)).toEqual(['无关'])
  })

  it('删不存在的一条返回 removed=false', () => {
    const editor = createEditor()
    expect(deleteComment(editor, 'x', 'cmt_nope')).toEqual({
      removed: false,
      removedComments: 0,
    })
  })
})

describe('updateComment', () => {
  it('改正文', () => {
    const editor = createEditor()
    const post = addPost(editor, { app: 'x', content: 'a' })
    const reply = addComment(editor, { app: 'x', postId: post.id, content: '旧' })
    const updated = updateComment(editor, 'x', reply.id, { content: '新' })

    expect(updated.content).toBe('新')
    expect(updated.id).toBe(reply.id)
  })
})

describe('orphanAssetIds', () => {
  it('帖子删掉后，只被它引用的图变成孤儿', () => {
    const editor = createEditor()
    editor.project.assets = [
      { id: 'ast_used', kind: 'image' },
      { id: 'ast_orphan', kind: 'image' },
    ]
    addPost(editor, { app: 'x', content: 'a', mediaAssetIds: ['ast_used'] })

    const orphans = orphanAssetIds(editor.project)
    expect(orphans).toEqual(['ast_orphan'])
  })

  it('被两条帖子共用的图不算孤儿', () => {
    const editor = createEditor()
    editor.project.assets = [{ id: 'ast_shared', kind: 'image' }]
    addPost(editor, { app: 'x', content: 'a', mediaAssetIds: ['ast_shared'] })
    addPost(editor, { app: 'x', content: 'b', mediaAssetIds: ['ast_shared'] })

    expect(orphanAssetIds(editor.project)).toEqual([])
  })
})

describe('辅助函数', () => {
  it('mediaMaxOf：X 与 Instagram 不限张数，其余应用 1 张', () => {
    expect(mediaMaxOf('x')).toBe(Infinity)
    expect(mediaMaxOf('instagram')).toBe(Infinity)
    expect(mediaMaxOf('kakaotalk')).toBe(1)
  })

  it('countCommentsOf 数的是这条帖子的回复', () => {
    const editor = createEditor()
    const post = addPost(editor, { app: 'x', content: 'a' })
    addComment(editor, { app: 'x', postId: post.id, content: '1' })
    addComment(editor, { app: 'x', postId: post.id, content: '2' })

    expect(countCommentsOf(editor.project, 'x', post.id)).toBe(2)
  })

  it('sortPostsByTime 新的在前，无效时间垫底', () => {
    const sorted = sortPostsByTime([
      { id: 'none', displayTime: '' },
      { id: 'new', displayTime: '2026-10-01T00:00:00.000Z' },
      { id: 'old', displayTime: '2026-01-01T00:00:00.000Z' },
    ])
    expect(sorted.map((p) => p.id)).toEqual(['new', 'old', 'none'])
  })
})
