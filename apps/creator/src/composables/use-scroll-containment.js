import { onMounted, onBeforeUnmount } from 'vue'
import { canConsumeScroll } from '../utils/scroll-containment.js'

/**
 * 键盘至少要挡住这么多才算「打开」。
 *
 * 这不是精度问题：iPad 上收起键盘后 WebKit 有时把 visualViewport.height 停在
 * 比布局视口小几十像素的位置，且不再发 resize。用一个小阈值区分「键盘」与
 * 「浏览器 UI 抖动」，才能保证没打字时外壳永远铺满布局视口。
 */
const KEYBOARD_MIN_INSET = 120

export function useScrollContainment() {
  let frame = 0
  let recoveryTimers = []
  let keyboardWasOpen = false
  function resetShellScroll() {
    // overflow:hidden still permits programmatic/native focus scrolling.
    // Preserve the actual editor scroll containers and reset only outer shells.
    for (const element of document.querySelectorAll('#app, .ws, .ws__body')) {
      element.scrollTop = 0
      element.scrollLeft = 0
    }
  }
  let point
  const start = event => {
    point = event.touches.length === 1 ? { x: event.touches[0].clientX, y: event.touches[0].clientY } : null
  }
  const stop = () => { point = null }
  function move(event) {
    if (!point || event.touches.length !== 1 || !event.cancelable) return
    const touch = event.touches[0], dx = touch.clientX - point.x, dy = touch.clientY - point.y
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 2) return
    point = { x: touch.clientX, y: touch.clientY }
    const target = event.target instanceof Element ? event.target : event.target?.parentElement
    const modal = [...document.querySelectorAll('dialog[open], [aria-modal="true"]')].filter(element => element.getClientRects().length).at(-1)
    if (modal && !modal.contains(target)) { event.preventDefault(); return }
    // Crop dragging and native range inputs own their gestures via touch-action.
    if (target?.closest('.ied__frame, input[type="range"]')) return
    const ancestors = []
    for (let element = target; element && element !== document.body; element = element.parentElement) {
      ancestors.push(element)
      if (element === modal) break
    }
    if (!canConsumeScroll(ancestors, dx, dy)) event.preventDefault()
  }
  /**
   * 外壳该有多高：键盘不开时是「布局视口」，不是 visualViewport。
   *
   * 键盘收起后 visualViewport.height 在 iPad 上会一步一报，动画结束时还可能
   * 停在比布局视口小几十像素的值上不再回调；直接拿它写死高度，底部就留一条
   * body 底色（--c-bg）的白边，而且每次收起键盘都跟着抖一下。innerHeight
   * 跟着布局视口走，键盘不开时它才是满屏的那个值。
   */
  function layoutHeight() {
    const height = window.innerHeight || 0
    return height > 0 ? height : (document.documentElement?.clientHeight || 0)
  }
  function syncViewport() {
    const viewport = window.visualViewport
    const root = document.documentElement
    // 没有 visualViewport、或用户捏合缩放中：交回 CSS（100dvh / 100%），不写死像素。
    if (!viewport || Math.abs(viewport.scale - 1) >= .01) {
      root.style.removeProperty('--creator-viewport-height')
      root.style.removeProperty('--creator-viewport-top')
      keyboardWasOpen = false
      return
    }
    const layout = layoutHeight()
    if (!layout) return
    const keyboardOpen = layout - viewport.height > KEYBOARD_MIN_INSET
    if (keyboardWasOpen && !keyboardOpen) recoverViewport(true)
    keyboardWasOpen = keyboardOpen
    resetShellScroll()
    // 键盘收起的那一刻直接跳回布局视口，而不是跟着动画一档一档涨。
    const height = keyboardOpen ? viewport.height : layout
    root.style.setProperty('--creator-viewport-height', `${Math.round(height)}px`)
    // Absolute measurements: never add keyboard offsets to the previous value.
    root.style.setProperty('--creator-viewport-top', `${Math.max(0, Math.round(viewport.offsetTop))}px`)
  }
  function scheduleViewport() {
    if (frame) return
    frame = window.requestAnimationFrame(() => {
      frame = 0
      syncViewport()
    })
  }
  function recoverViewport(force = false) {
    recoveryTimers.forEach(timer => window.clearTimeout(timer))
    // iOS can finish its keyboard animation after focusout, in several steps.
    recoveryTimers = [0, 100, 350, 700].map(delay => window.setTimeout(() => {
      const active = document.activeElement
      const editing = active?.matches('input, textarea, select, [contenteditable]:not([contenteditable="false"])')
      const viewport = window.visualViewport
      if ((force === true || !editing) && !keyboardWasOpen && (!viewport || Math.abs(viewport.scale - 1) < .01)) {
        resetShellScroll()
        if (window.scrollX || window.scrollY || viewport?.offsetTop || document.scrollingElement?.scrollTop) {
          window.scrollTo({ left: 0, top: 0, behavior: 'instant' })
          if (document.scrollingElement) document.scrollingElement.scrollTop = 0
        }
      }
      scheduleViewport()
    }, delay))
  }
  function onVisibility() {
    // 切后台/分屏回来时 visualViewport 可能还停在离开前的值，等页面可见再量一次。
    if (document.visibilityState === 'visible') recoverViewport()
  }
  onMounted(() => {
    syncViewport()
    document.addEventListener('touchstart', start, { passive: true })
    document.addEventListener('touchmove', move, { passive: false })
    document.addEventListener('touchend', stop, { passive: true })
    document.addEventListener('touchcancel', stop, { passive: true })
    document.addEventListener('focusin', recoverViewport)
    document.addEventListener('focusout', recoverViewport)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pageshow', recoverViewport)
    window.addEventListener('resize', scheduleViewport)
    window.addEventListener('scroll', scheduleViewport)
    window.visualViewport?.addEventListener('resize', scheduleViewport)
    window.visualViewport?.addEventListener('scroll', scheduleViewport)
  })
  onBeforeUnmount(() => {
    document.removeEventListener('touchstart', start)
    document.removeEventListener('touchmove', move)
    document.removeEventListener('touchend', stop)
    document.removeEventListener('touchcancel', stop)
    document.removeEventListener('focusin', recoverViewport)
    document.removeEventListener('focusout', recoverViewport)
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('pageshow', recoverViewport)
    window.removeEventListener('resize', scheduleViewport)
    window.removeEventListener('scroll', scheduleViewport)
    window.visualViewport?.removeEventListener('resize', scheduleViewport)
    window.visualViewport?.removeEventListener('scroll', scheduleViewport)
    window.cancelAnimationFrame(frame)
    recoveryTimers.forEach(timer => window.clearTimeout(timer))
    document.documentElement.style.removeProperty('--creator-viewport-height')
    document.documentElement.style.removeProperty('--creator-viewport-top')
  })
}
