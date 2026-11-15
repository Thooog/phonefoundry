import { ref, computed, reactive, watch, nextTick } from 'vue'
import { TIME_FORMAT } from '@phone-sim/shared'

export function useMessageViewer({ thread, imageSrcs, runtime, timeFormat, tone }) {
  const viewer = ref(null)

  /** 当前查看的那条消息。消息被删 / 切走会话时自然变 null，浮层跟着自动收起 */
  const viewerItem = computed(() =>
    viewer.value ? thread.value.find((i) => i.id === viewer.value.itemId) : null,
  )

  const viewerSrcs = computed(() => (viewerItem.value ? imageSrcs(viewerItem.value) : []))

  /** 夹一次下标：图片数量可能在查看期间被编辑端改小 */
  const viewerIndex = computed(() => {
    const max = Math.max(viewerSrcs.value.length - 1, 0)
    return Math.min(viewer.value?.index ?? 0, max)
  })

  /** 查看器顶部的时间：与气泡里的时刻同源（displayTime），只是多了完整日期 */
  function viewerStamp(item) {
    const raw = item?.displayTime
    const date = raw ? new Date(raw) : null
    if (!date || !Number.isFinite(date.getTime())) return ''
    const ymd = `${date.getFullYear()}. ${date.getMonth() + 1}. ${date.getDate()}.`
    return `${ymd} ${viewerClock(date)}`
  }

  /** 12 小时制用「上午/下午」，与信息本身的写法对齐 */
  function viewerClock(date) {
    const mm = String(date.getMinutes()).padStart(2, '0')
    const h = date.getHours()
    if (timeFormat.value !== TIME_FORMAT.H12) return `${String(h).padStart(2, '0')}:${mm}`
    return `${h < 12 ? '上午' : '下午'} ${h % 12 === 0 ? 12 : h % 12}:${mm}`
  }

  function openViewer(item, index) {
    if (!imageSrcs(item).length) return
    viewer.value = { itemId: item.id, index }
    // 白底浮层要深字状态栏：应用内 'auto' 默认解析成深色，这里显式写 'dark' 更稳
    runtime.setStatusTone(tone)
  }

  function closeViewer() {
    viewer.value = null
    runtime.setStatusTone('auto')
  }

  function showViewerIndex(index) {
    if (!viewer.value) return
    viewer.value = { ...viewer.value, index }
  }

  /* ── 查看器左右滑动翻页 ──
   *
   * 做法与 KakaoTalk / Instagram 轮播同一套：整条 strip 用 translateX 位移，拖动时叠一个
   * px 偏移，松手按位移量决定翻不翻页。只认横向手势：拖到一半上下滑动（想退出）不该被算翻页。
   */
  const viewerDrag = reactive({ active: false, startX: 0, startY: 0, offset: 0, axis: null })

  /** 翻页阈值：屏宽的 1/5，且不超过 60px */
  const VIEWER_SWIPE_MAX = 60

  function stepViewer(delta) {
    const next = viewerIndex.value + delta
    if (next < 0 || next >= viewerSrcs.value.length) return
    showViewerIndex(next)
  }

  function onViewerDown(e) {
    // 单图没有翻页可言，直接不进拖拽态（否则会拖出一片空白）
    if (viewerSrcs.value.length < 2) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    viewerDrag.active = true
    viewerDrag.startX = e.clientX
    viewerDrag.startY = e.clientY
    viewerDrag.offset = 0
    viewerDrag.axis = null
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId)
    } catch {
      /* 合成事件没有真实 pointer，捕获会抛 NotFoundError，忽略即可 */
    }
  }

  function onViewerMove(e) {
    if (!viewerDrag.active) return
    const dx = e.clientX - viewerDrag.startX
    const dy = e.clientY - viewerDrag.startY

    if (!viewerDrag.axis) {
      if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return
      viewerDrag.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
    }
    if (viewerDrag.axis !== 'x') return
    // 首尾再往外拉时给阻尼，拉不动才有"到头了"的手感
    const at = viewerIndex.value
    const last = viewerSrcs.value.length - 1
    const edge = (at === 0 && dx > 0) || (at === last && dx < 0)
    viewerDrag.offset = edge ? dx * 0.32 : dx
  }

  function onViewerUp(e) {
    if (!viewerDrag.active) return
    const swiped = viewerDrag.axis === 'x'
    const dx = viewerDrag.offset
    const limit = Math.min(VIEWER_SWIPE_MAX, Math.max(e.currentTarget.offsetWidth * 0.2, 1))
    viewerDrag.active = false
    viewerDrag.offset = 0
    viewerDrag.axis = null
    // 阻尼过的位移也照样参与判断：到头那一侧本来就会被 stepViewer 挡住
    if (!swiped) return
    if (dx <= -limit) stepViewer(1) // 左滑 → 下一张
    else if (dx >= limit) stepViewer(-1) // 右滑 → 上一张
  }

  /** 缩略图条跟着当前张走：9 张时后面几张原本在可视区外，不滚过去就看不到高亮 */
  const thumbsEl = ref(null)

  watch(viewerIndex, async (i) => {
    await nextTick()
    const box = thumbsEl.value
    const el = box?.children?.[i]
    if (!box || !el) return
    box.scrollTo({ left: el.offsetLeft - (box.clientWidth - el.offsetWidth) / 2, behavior: 'smooth' })
  })

  /** strip 位移：翻页用百分比，拖动叠像素；拖拽期间关掉过渡才跟手 */
  const viewerStripStyle = computed(() => {
    const shift = `calc(${-viewerIndex.value * 100}% + ${viewerDrag.offset}px)`
    return {
      transform: `translateX(${shift})`,
      transition: viewerDrag.active ? 'none' : undefined,
    }
  })

  return { viewer, viewerItem, viewerSrcs, viewerIndex, viewerStamp, openViewer, closeViewer, showViewerIndex, viewerDrag, stepViewer, onViewerDown, onViewerMove, onViewerUp, thumbsEl, viewerStripStyle }
}
