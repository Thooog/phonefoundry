import { onMounted, onBeforeUnmount } from 'vue'
import { canConsumeScroll } from '../utils/scroll-containment.js'

export function useScrollContainment() {
  let frame = 0
  let recoveryTimers = []
  let fullHeight = 0
  let viewportWidth = 0
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
  function syncViewport() {
    const viewport = window.visualViewport
    if (viewport && Math.abs(viewport.scale - 1) < .01) {
      if (Math.abs(viewport.width - viewportWidth) > 2) {
        viewportWidth = viewport.width
        fullHeight = 0
        keyboardWasOpen = false
      }
      fullHeight = Math.max(fullHeight, viewport.height)
      const keyboardOpen = fullHeight - viewport.height > 120
      if (keyboardWasOpen && !keyboardOpen) recoverViewport(true)
      keyboardWasOpen = keyboardOpen
      resetShellScroll()
      document.documentElement.style.setProperty('--creator-viewport-height', `${viewport.height}px`)
      // Absolute measurements: never add keyboard offsets to the previous value.
      document.documentElement.style.setProperty('--creator-viewport-top', `${Math.max(0, viewport.offsetTop)}px`)
    } else {
      document.documentElement.style.removeProperty('--creator-viewport-height')
      document.documentElement.style.removeProperty('--creator-viewport-top')
      if (viewport && viewport.scale !== 1) return
    }
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
  onMounted(() => {
    syncViewport()
    document.addEventListener('touchstart', start, { passive: true })
    document.addEventListener('touchmove', move, { passive: false })
    document.addEventListener('touchend', stop, { passive: true })
    document.addEventListener('touchcancel', stop, { passive: true })
    document.addEventListener('focusin', recoverViewport)
    document.addEventListener('focusout', recoverViewport)
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
