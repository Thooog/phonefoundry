import { describe, expect, it } from 'vitest'
import { canConsumeScroll } from '../scroll-containment.js'
const box = (values = {}) => ({ scrollTop: 0, clientHeight: 100, scrollHeight: 400, scrollLeft: 0, clientWidth: 100, scrollWidth: 100, style: { overflowY: 'auto', overflowX: 'hidden', overscrollBehaviorY: 'contain' }, ...values })
const can = (nodes, x, y) => canConsumeScroll(nodes, x, y, node => node.style)
describe('scroll containment', () => {
  it('allows a list to scroll down but blocks pulling beyond its top', () => {
    expect(can([box()], 0, -20)).toBe(true)
    expect(can([box()], 0, 20)).toBe(false)
  })
  it('allows scrolling back from the bottom but blocks further dragging', () => {
    expect(can([box({ scrollTop: 300 })], 0, 20)).toBe(true)
    expect(can([box({ scrollTop: 300 })], 0, -20)).toBe(false)
  })
  it('blocks blank non-scrollable list areas and navigation chrome', () => {
    expect(can([box({ scrollHeight: 100 })], 0, -20)).toBe(false)
    expect(can([box({ style: { overflowY: 'visible' } })], 0, -20)).toBe(false)
  })
  it('finds a scrollable ancestor behind a label or blank child', () => {
    expect(can([box({ style: { overflowY: 'visible' } }), box()], 0, -20)).toBe(true)
  })
  it('skips empty shell containers instead of letting their contain kill the chain', () => {
    // 窄屏详情页：detail 高度跟着内容长，overflow:auto 但没有余量；真正的滚动源是 .ws__main。
    const shell = box({ scrollHeight: 100 })
    expect(can([shell, box()], 0, -20)).toBe(true)
    expect(can([box({ style: { overflowY: 'hidden' } }), shell, box()], 0, -20)).toBe(true)
    expect(can([shell], 0, -20)).toBe(false)
  })
  it('does not chain a contained list at its boundary into the page', () => {
    expect(can([box({ scrollTop: 300 }), box()], 0, -20)).toBe(false)
    expect(can([box({ scrollTop: 300, style: { overflowY: 'auto', overscrollBehaviorY: 'auto' } }), box()], 0, -20)).toBe(true)
  })
  it('preserves horizontal strips without allowing unrelated page panning', () => {
    const strip = box({ scrollWidth: 400, style: { overflowX: 'auto', overscrollBehaviorX: 'contain' } })
    expect(can([strip], -30, 2)).toBe(true)
    expect(can([strip], 30, 2)).toBe(false)
    expect(can([box()], -30, 2)).toBe(false)
  })
})
