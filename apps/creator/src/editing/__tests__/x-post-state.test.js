import { describe, expect, it } from 'vitest'
import { buildFeed, searchX, toWorkData } from '@phone-sim/shared'
import { addPost, updatePost } from '../posts.js'

function editor() {
  return {
    project: { characters: [{ id: 'author', name: '作者' }, { id: 'actor', name: '关联人物' }], platformAccounts: [], assets: [], appData: { x: { posts: [], replies: [] } } },
    mutate(fn) { fn(this.project) },
  }
}

describe('X 帖子类型与首页可见性', () => {
  it('新帖子默认无状态且首页可见；保存导出保留关联关系，搜索仍能找到隐藏帖子', () => {
    const store = editor()
    const post = addPost(store, { app: 'x', characterId: 'author', content: '隐藏的线索' })
    expect(post).toMatchObject({ xPostTypes: [], xRepostByCharacterIds: [], xLikeByCharacterIds: [], showInHome: true })
    updatePost(store, 'x', post.id, { xPostTypes: ['repost'], xRepostByCharacterIds: ['actor'], showInHome: false })
    const work = toWorkData(store.project)
    const row = buildFeed(work, 'x')[0]
    expect(row).toMatchObject({ showInHome: false, xPostTypes: ['repost'], xRepostByCharacterIds: ['actor'], authorCharacterId: 'author' })
    expect(searchX(work, '线索').posts.map(item => item.id)).toEqual([post.id])
    updatePost(store, 'x', post.id, { xPostTypes: ['repost', 'like'], xLikeByCharacterIds: ['actor', 'author'] })
    expect(buildFeed(toWorkData(store.project), 'x')[0]).toMatchObject({ xPostTypes: ['repost', 'like'], xRepostByCharacterIds: ['actor'], xLikeByCharacterIds: ['actor', 'author'] })
    updatePost(store, 'x', post.id, { xPostTypes: [] })
    expect(store.project.appData.x.posts[0]).toMatchObject({ xPostTypes: [], xRepostByCharacterIds: [], xLikeByCharacterIds: [] })
  })

  it('旧数据保持首页可见；无效类型、可见性与不存在的关联人物不写入', () => {
    const store = editor()
    store.project.appData.x.posts = [{ id: 'old', authorCharacterId: 'author' }]
    expect(buildFeed(store.project, 'x')[0]).toMatchObject({ showInHome: true, xPostTypes: [], xRepostByCharacterIds: [], xLikeByCharacterIds: [] })
    for (const patch of [{ xPostTypes: ['invalid'] }, { showInHome: 'false' }, { xRepostByCharacterIds: ['missing'] }]) {
      expect(updatePost(store, 'x', 'old', patch)).toBeNull()
    }
    expect(store.project.appData.x.posts[0]).toEqual({ id: 'old', authorCharacterId: 'author' })
  })
})
