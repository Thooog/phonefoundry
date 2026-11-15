import { ref, watch, nextTick, onBeforeUnmount } from 'vue'

export function useProfileCollapse({ isProfile, profileCharacterId, profileTab }) {
  const profileScroller = ref(null)
  const profileTabs = ref(null)
  const headerCollapsed = ref(false)

  const profileMinScroll = ref(0)

  function measureProfileMinScroll() {
    const viewport = profileScroller.value?.el ?? null
    const tabs = profileTabs.value ?? null
    if (!viewport || !tabs || !isProfile.value) return
    const banner = viewport.querySelector('.pui-x__banner')
    const headH = tabs.offsetTop - (banner?.offsetTop ?? 0)
    const stickyTop = Number.parseFloat(getComputedStyle(tabs).top) || 0
    profileMinScroll.value = Math.max(0, headH - stickyTop)
  }

  /** 资料块排版变化（简介行数、字体、图片解码、窗口尺寸）时重算目标量。
   *  与滚动位置无关，所以滚动事件里一次都不需要量，也不会再出现闪烁。 */
  let headObserver = null
  let headMeasureRaf = 0

  function bindProfileHeadObserver() {
    headObserver?.disconnect()
    headObserver = null
    const viewport = profileScroller.value?.el ?? null
    if (!isProfile.value || !viewport) return
    const targets = [
      viewport,
      viewport.querySelector('.pui-x__banner'),
      viewport.querySelector('.pui-x__profile-avatar-row'),
      viewport.querySelector('.pui-x__profile-info'),
    ].filter(Boolean)
    headObserver = new ResizeObserver(() => {
      if (headMeasureRaf) return
      headMeasureRaf = requestAnimationFrame(() => {
        headMeasureRaf = 0
        measureProfileMinScroll()
      })
    })
    targets.forEach((node) => headObserver.observe(node))
  }

  /**
   * 头像「一翻就缩没」（真机 X 手感和参考视频一致）：
   * 只要滚动位置离开顶部，头像立刻以 ~220ms 缩小 + 渐隐；滑回顶部再渐显回来。
   *
   * 这里刻意**不按 scrollTop 线性插值**：真机是「开始翻动」这个动作触发的过渡，
   * 慢慢滑 5px 就已经在明显淡出了；若绑死滚动距离，慢滑时几乎看不出变化，
   * 而且每次 scroll 事件都在重设 transition 目标，会一路拖尾。
   * 3 / 1 的迟滞带是为了让 0 附近的滚动抖动不会把头像/顶栏闪来闪去。
   */
  const avatarGone = ref(false)

  function updateProfileCollapse(payload) {
    const viewport = profileScroller.value?.el ?? null
    if (!viewport) return
    const top = typeof payload?.scrollTop === 'number' ? payload.scrollTop : viewport.scrollTop
    const on = avatarGone.value ? top > 1 : top > 3
    avatarGone.value = on
    headerCollapsed.value = on
    correctProfileMinScroll(viewport)
  }

  function correctProfileMinScroll(viewport) {
    const tabs = profileTabs.value ?? null
    if (!isProfile.value || !tabs) return
    const max = viewport.scrollHeight - viewport.clientHeight
    if (max <= 1 || viewport.scrollTop < max - 1) return
    const stickyTop = Number.parseFloat(getComputedStyle(tabs).top) || 0
    const gap = Math.round(tabs.getBoundingClientRect().top - viewport.getBoundingClientRect().top - stickyTop)
    if (gap > 1) profileMinScroll.value += gap
  }

  watch(
    [isProfile, profileCharacterId],
    async () => {
      headerCollapsed.value = false
      avatarGone.value = false
      await nextTick()
      updateProfileCollapse()
      measureProfileMinScroll()
      bindProfileHeadObserver()
    },
    { immediate: true, flush: 'post' },
  )

  // 换 tab 会换一批内容，补白要按新内容高度重算（目标量本身只跟资料块有关）。
  // 等两帧让新内容排版定稿（dataURL 图片是异步解码的）再量。
  watch(profileTab, async () => {
    await nextTick()
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        measureProfileMinScroll()
        profileScroller.value?.measure()
      })
    })
  })

  onBeforeUnmount(() => {
    headObserver?.disconnect()
    if (headMeasureRaf) cancelAnimationFrame(headMeasureRaf)
  })
  return { profileScroller, profileTabs, headerCollapsed, profileMinScroll, avatarGone, updateProfileCollapse }
}
