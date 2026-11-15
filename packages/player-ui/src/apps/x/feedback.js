// Decorative actions acknowledge a press without navigating or changing authored data.
const cleanup = new WeakMap()
export const vFeedback = {
  mounted(el, binding) {
    el.removeAttribute('aria-hidden')
    if (el.tagName !== 'BUTTON') { el.setAttribute('role', 'button'); el.tabIndex = 0 }
    if (binding.value) el.setAttribute('aria-label', binding.value)
    el.classList.add('x-feedback')
    let timer, started = 0, released = -Infinity
    const clear = () => { clearTimeout(timer); el.classList.remove('x-feedback--pressed') }
    const down = () => { clearTimeout(timer); started = performance.now(); el.classList.add('x-feedback--pressed') }
    const up = () => { if (!el.classList.contains('x-feedback--pressed')) return; released = performance.now(); timer = setTimeout(clear, Math.max(0, 90 - (released - started))) }
    const click = event => { event.stopPropagation(); event.preventDefault(); if (performance.now() - released > 500) { down(); timer = setTimeout(clear, 90) } }
    const key = event => { if (el.tagName !== 'BUTTON' && ['Enter', ' '].includes(event.key)) { event.preventDefault(); event.stopPropagation(); el.click() } }
    const listeners = { pointerdown: down, pointerup: up, pointercancel: clear, pointerleave: up, click, keydown: key }
    for (const [name, handler] of Object.entries(listeners)) el.addEventListener(name, handler)
    cleanup.set(el, () => { clear(); for (const [name, handler] of Object.entries(listeners)) el.removeEventListener(name, handler) })
  },
  beforeUnmount(el) { cleanup.get(el)?.(); cleanup.delete(el) },
}
