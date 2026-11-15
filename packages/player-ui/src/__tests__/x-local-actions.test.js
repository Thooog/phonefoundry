import { expect, it } from 'vitest'
import { createLocalActions } from '../apps/x/local-actions.js'

it('keeps post and reply likes and reposts independent without changing authored data', () => {
  const actions = createLocalActions()
  const post = { id: 'post', likedByOwner: false, repostedByOwner: false, rawMetrics: { likes: 8, reposts: 2 }, metrics: { likes: '8', reposts: '2' } }
  const reply = { id: 'reply', parentId: post.id }
  for (const flag of ['likedByOwner', 'repostedByOwner']) {
    actions.toggle(post, flag)
    expect(actions.present(reply)[flag]).toBeUndefined()
    actions.toggle(reply, flag)
    actions.toggle(post, flag)
    expect(actions.present(reply)[flag]).toBe(true)
    expect(actions.present(post)[flag]).toBe(false)
  }
  expect(actions.present(post).metrics).toEqual({ likes: '8', reposts: '2' })
  expect(reply).toEqual({ id: 'reply', parentId: post.id })
})
