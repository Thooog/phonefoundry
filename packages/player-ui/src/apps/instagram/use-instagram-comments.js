import { computed, ref, reactive } from 'vue'
import { buildPostDetail } from '@phone-sim/shared'

export function useInstagramComments({ work, timeFormat, storyDate }) {
  const commentsForPostId = ref(null)
  const expandedThreads = reactive(new Set())
  const commentsOpen = computed(() => commentsForPostId.value != null)
  const commentsDetail = computed(() => {
    if (!commentsForPostId.value || !work.value) return null
    return buildPostDetail(work.value, 'instagram', commentsForPostId.value, {
      timeFormat: timeFormat.value,
      storyDate: storyDate.value,
    })
  })
  /** [{ top, replies }] —— threadId 相同的归一条对话，顶层在前 */
  const commentThreads = computed(() => {
    const list = commentsDetail.value?.comments ?? []
    const map = new Map()
    for (const c of list) {
      if (!map.has(c.threadId)) map.set(c.threadId, [])
      map.get(c.threadId).push(c)
    }
    return [...map.values()].map((items) => ({ top: items[0], replies: items.slice(1) }))
  })
  function openComments(postId) {
    commentsForPostId.value = postId
  }
  function closeComments() {
    commentsForPostId.value = null
  }
  function toggleThread(threadId) {
    if (expandedThreads.has(threadId)) expandedThreads.delete(threadId)
    else expandedThreads.add(threadId)
  }


  return { expandedThreads, commentsOpen, commentsDetail, commentThreads, openComments, closeComments, toggleThread }
}
