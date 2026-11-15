import { reactive } from 'vue'
import { formatXCount } from '@phone-sim/shared'

export function createLocalActions() {
  const states = reactive(new Map())
  function present(post) {
    if (!post) return post
    const state = states.get(post.id)
    if (!state) return post
    const metrics = { ...post.metrics }
    for (const [kind, flag] of [['likes', 'likedByOwner'], ['reposts', 'repostedByOwner']]) {
      if (state[flag] !== undefined) metrics[kind] = formatXCount(Math.max(0, Number(post.rawMetrics?.[kind] || 0) + Number(state[flag]) - Number(!!post[flag])))
    }
    return { ...post, ...state, metrics }
  }
  function toggle(post, flag) {
    const current = present(post)
    states.set(post.id, { ...states.get(post.id), [flag]: !current[flag] })
  }
  return { present, toggle }
}
