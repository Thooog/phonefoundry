/**
 * 响应式媒体查询 —— 用 matchMedia 而不是监听 resize 再读 innerWidth。
 *
 * 差别不只是性能：
 *   resize 在拖拽窗口时会连续触发，每次都读 innerWidth 会让布局抖动；
 *   matchMedia 只在跨过断点的那一帧触发一次，而且与 CSS 里的断点语义完全对应
 *   （同一个查询串），不会出现"CSS 认为已是窄屏、JS 认为还是宽屏"的错位。
 */

import { ref, onMounted, onBeforeUnmount } from 'vue'

/**
 * @param {string} query 标准媒体查询串，如 '(min-width: 1100px)'
 * @returns {import('vue').Ref<boolean>}
 */
export function useMediaQuery(query) {
  let mql = typeof window === 'undefined' ? null : window.matchMedia(query)
  const matches = ref(mql?.matches ?? false)

  function update(event) {
    matches.value = event?.matches ?? mql?.matches ?? false
  }

  onMounted(() => {
    mql ??= window.matchMedia(query)
    matches.value = mql.matches
    mql.addEventListener('change', update)
  })

  onBeforeUnmount(() => {
    mql?.removeEventListener('change', update)
    mql = null
  })

  return matches
}
