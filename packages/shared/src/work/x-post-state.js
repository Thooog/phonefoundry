/** Normalize both legacy single-actor posts and current multi-actor posts. */
export function normalizeXPostState(post = {}) {
  const types = post.xPostTypes ?? (post.xPostType && post.xPostType !== 'none' ? [post.xPostType] : [])
  const actors = type => {
    const key = type === 'like' ? 'xLikeByCharacterIds' : 'xRepostByCharacterIds'
    return post[key] ?? (post.xPostType === type && post.xActorCharacterId ? [post.xActorCharacterId] : [])
  }
  return { xPostTypes: types, xRepostByCharacterIds: actors('repost'), xLikeByCharacterIds: actors('like') }
}
