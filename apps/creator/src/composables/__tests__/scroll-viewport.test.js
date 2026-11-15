import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const lifecycle = vi.hoisted(() => ({}))
vi.mock('vue', () => ({
  onMounted: fn => { lifecycle.mount = fn },
  onBeforeUnmount: fn => { lifecycle.unmount = fn },
}))
import { useScrollContainment } from '../use-scroll-containment.js'

describe('workspace keyboard viewport recovery', () => {
  let viewport, root, win, doc, values
  beforeEach(() => {
    vi.useFakeTimers()
    values = new Map()
    root = { style: {
      setProperty: (key, value) => values.set(key, value),
      removeProperty: key => values.delete(key),
    } }
    viewport = Object.assign(new EventTarget(), { height: 800, offsetTop: 0, scale: 1 })
    win = Object.assign(new EventTarget(), {
      visualViewport: viewport, scrollX: 0, scrollY: 0,
      scrollTo: vi.fn(),
      requestAnimationFrame: fn => setTimeout(fn, 16),
      cancelAnimationFrame: clearTimeout,
      setTimeout, clearTimeout,
    })
    doc = Object.assign(new EventTarget(), { documentElement: root, activeElement: null, querySelectorAll: () => [] })
    vi.stubGlobal('window', win)
    vi.stubGlobal('document', doc)
    useScrollContainment()
    lifecycle.mount()
  })
  afterEach(() => {
    lifecycle.unmount()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })
  const emit = (target, type) => { target.dispatchEvent(new Event(type)); vi.advanceTimersByTime(20) }

  it('restores absolute height and offset across repeated keyboard cycles, even with focus retained', () => {
    doc.activeElement = { matches: () => true }
    for (let i = 0; i < 5; i++) {
      Object.assign(viewport, { height: 340, offsetTop: 120 })
      emit(viewport, 'resize')
      expect(values.get('--creator-viewport-height')).toBe('340px')
      expect(values.get('--creator-viewport-top')).toBe('120px')
      Object.assign(viewport, { height: 800, offsetTop: 0 })
      emit(viewport, 'resize')
      expect(values.get('--creator-viewport-height')).toBe('800px')
      expect(values.get('--creator-viewport-top')).toBe('0px')
    }
    expect(win.scrollTo).not.toHaveBeenCalled()
  })
  it('tracks viewport panning without a resize and allows pinch zoom', () => {
    viewport.offsetTop = 90
    emit(viewport, 'scroll')
    expect(values.get('--creator-viewport-top')).toBe('90px')
    viewport.scale = 2
    emit(viewport, 'resize')
    expect(values.size).toBe(0)
    expect(win.scrollTo).not.toHaveBeenCalled()
  })
  it('recovers a closed keyboard with retained input focus and stale document and shell scrolling', () => {
    const shells = [{ scrollTop: 240, scrollLeft: 0 }, { scrollTop: 120, scrollLeft: 0 }]
    doc.querySelectorAll = () => shells
    doc.activeElement = { matches: () => true }
    viewport.height = 340
    emit(viewport, 'resize')
    win.scrollY = 200
    viewport.height = 800
    viewport.offsetTop = 80
    emit(viewport, 'resize')
    vi.advanceTimersByTime(800)
    expect(win.scrollTo).toHaveBeenCalledWith({ left: 0, top: 0, behavior: 'instant' })
    expect(shells.map(shell => shell.scrollTop)).toEqual([0, 0])
  })
  it('recovers document scrolling after blur but does not fight a newly focused field', () => {
    win.scrollY = 200
    emit(doc, 'focusout')
    expect(win.scrollTo).toHaveBeenCalledWith({ left: 0, top: 0, behavior: 'instant' })
    win.scrollTo.mockClear()
    doc.activeElement = { matches: () => true }
    emit(doc, 'focusin')
    vi.advanceTimersByTime(1000)
    expect(win.scrollTo).not.toHaveBeenCalled()
  })
  it('removes viewport listeners, timers and CSS properties on leaving the workspace', () => {
    emit(doc, 'focusout')
    lifecycle.unmount()
    viewport.offsetTop = 100
    emit(viewport, 'scroll')
    vi.advanceTimersByTime(1000)
    expect(values.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })
})
