import { describe, expect, it } from 'vitest'
import { scrollToEnd } from '../scroll-to-end.js'

const box = (overflowY, values = {}) => ({ scrollTop: 0, clientHeight: 200, scrollHeight: 800, parentElement: null, overflowY, ...values })
const styleOf = element => ({ overflowY: element.overflowY })

describe('scroll to end', () => {
  it('scrolls the inner window when the timeline itself overflows', () => {
    const timeline = box('auto')
    expect(scrollToEnd(timeline, styleOf)).toBe(true)
    expect(timeline.scrollTop).toBe(800)
  })
  it('walks up to the page scroller when the timeline is expanded', () => {
    const outer = box('auto', { clientHeight: 300, scrollHeight: 1200 })
    const timeline = box('visible', { parentElement: outer })
    expect(scrollToEnd(timeline, styleOf)).toBe(true)
    expect(outer.scrollTop).toBe(1200)
    expect(timeline.scrollTop).toBe(0)
  })
  it('does nothing when nothing along the chain can scroll', () => {
    const timeline = box('auto', { scrollHeight: 200 })
    expect(scrollToEnd(timeline, styleOf)).toBe(false)
  })
})
