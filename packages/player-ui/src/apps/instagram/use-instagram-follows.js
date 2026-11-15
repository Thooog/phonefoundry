import { computed, ref, watch } from 'vue'
import { buildFollowGraph } from '@phone-sim/shared'

export function useInstagramFollows({ runtime, work, isFollowScreen, isProfileScreen, profileTargetId, ownerCharacterId }) {
  const followParams = computed(() =>
    isFollowScreen.value ? runtime.currentScreen.value?.params ?? {} : {},
  )

  function openFollowScreen(tab) {
    const characterId = isProfileScreen.value ? profileTargetId.value : ownerCharacterId.value
    if (!characterId) return
    runtime.push('follow', { tab: tab === 'following' ? 'following' : 'followers', characterId })
  }

  const followScreenTab = ref('followers')
  const followSearch = ref('')
  /* 从栈参数恢复 tab；进屏后用本页 tab 自由切换 */
  watch(
    () => followParams.value.tab,
    (tab) => {
      if (tab) followScreenTab.value = tab === 'following' ? 'following' : 'followers'
    },
    { immediate: true },
  )

  const followScreenGraph = computed(() => {
    if (!isFollowScreen.value || !work.value) return { following: [], followers: [] }
    return buildFollowGraph(work.value, 'instagram', {
      characterId: followParams.value.characterId,
    })
  })

  /** 按关键词筛选关注关系列表。 */
  const followScreenRows = computed(() => {
    const rows =
      followScreenTab.value === 'following'
        ? followScreenGraph.value.following
        : followScreenGraph.value.followers
    const q = followSearch.value.trim().toLowerCase()
    const searched = q
      ? rows.filter(
          (r) =>
            r.name.toLowerCase().includes(q) || (r.handle ?? '').toLowerCase().includes(q),
        )
      : rows
    return searched
  })

  const followScreenHandle = computed(() => {
    const account = (work.value?.platformAccounts ?? []).find(
      (a) => a.characterId === followParams.value.characterId && a.platform === 'instagram',
    )
    const character = (work.value?.characters ?? []).find(
      (c) => c.id === followParams.value.characterId,
    )
    return account?.handle || character?.name || ''
  })

  const followScreenEmpty = computed(() =>
    followScreenTab.value === 'following'
      ? { title: '还没有关注任何人', description: '' }
      : { title: '还没有粉丝', description: '' },
  )


  return { openFollowScreen, followScreenTab, followSearch, followScreenRows, followScreenHandle, followScreenEmpty }
}
