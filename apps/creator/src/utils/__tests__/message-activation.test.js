import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMessageActivation } from '../message-activation.js'

let select, edit, activation
const pointer = (overrides = {}) => ({ pointerType: 'touch', pointerId: 1, isPrimary: true, clientX: 100, clientY: 100, ...overrides })
function tap(id = 'a', event = pointer()) {
  activation.pointerDown(id, event)
  vi.advanceTimersByTime(30)
  activation.pointerUp(id, event)
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
  select = vi.fn(); edit = vi.fn()
  activation = createMessageActivation(select, edit)
})
afterEach(() => { activation.dispose(); vi.useRealTimers() })

describe('message activation', () => {
  it('delays a mouse click, cancels it for a native double click', () => {
    activation.click('a', { detail: 1 }); vi.advanceTimersByTime(100)
    expect(select).not.toHaveBeenCalled()
    activation.doubleClick('a'); vi.advanceTimersByTime(500)
    expect(edit).toHaveBeenCalledTimes(1); expect(edit).toHaveBeenCalledWith('a'); expect(select).not.toHaveBeenCalled()
  })
  it('selects a single tap once and ignores synthesized click events', () => {
    tap(); activation.click('a', { detail: 0 }); activation.click('a', { detail: 1 })
    vi.advanceTimersByTime(349); expect(select).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1); expect(select).toHaveBeenCalledTimes(1); expect(select).toHaveBeenCalledWith('a')
    expect(edit).not.toHaveBeenCalled()
  })
  it('opens on two taps without a dblclick event and ignores duplicate mouse events', () => {
    tap(); vi.advanceTimersByTime(100); tap()
    activation.click('a', { detail: 1 }); activation.doubleClick('a')
    vi.advanceTimersByTime(1000)
    expect(edit).toHaveBeenCalledTimes(1); expect(edit).toHaveBeenCalledWith('a'); expect(select).not.toHaveBeenCalled()
  })
  it('opens after the compatibility click so it cannot hit a newly opened dialog backdrop', () => {
    tap(); vi.advanceTimersByTime(100); tap()
    expect(edit).not.toHaveBeenCalled()
    activation.click('a', { detail: 1 })
    expect(edit).toHaveBeenCalledTimes(1)
    activation.click('a', { detail: 1 }); vi.advanceTimersByTime(500)
    expect(edit).toHaveBeenCalledTimes(1); expect(select).not.toHaveBeenCalled()
  })
  it('does not treat taps on different messages as a double tap', () => {
    tap('a'); vi.advanceTimersByTime(100); tap('b'); vi.advanceTimersByTime(400)
    expect(edit).not.toHaveBeenCalled(); expect(select).toHaveBeenCalledTimes(1); expect(select).toHaveBeenCalledWith('b')
  })
  it('does not activate messages while dragging or scrolling', () => {
    activation.pointerDown('a', pointer()); activation.pointerMove(pointer({ clientY: 130 }))
    activation.pointerUp('a', pointer({ clientY: 130 })); vi.advanceTimersByTime(500)
    expect(edit).not.toHaveBeenCalled(); expect(select).not.toHaveBeenCalled()
  })
  it('cancels gestures interrupted by the browser or a second finger', () => {
    tap(); activation.pointerDown('a', pointer()); activation.pointerCancel()
    activation.pointerUp('a', pointer()); vi.advanceTimersByTime(500)
    expect(edit).not.toHaveBeenCalled(); expect(select).not.toHaveBeenCalled()
    activation.pointerDown('a', pointer()); activation.pointerDown('a', pointer({ isPrimary: false, pointerId: 2 }))
    activation.pointerUp('a', pointer()); vi.advanceTimersByTime(500)
    expect(select).not.toHaveBeenCalled()
  })
  it('does not activate a long press', () => {
    activation.pointerDown('a', pointer()); vi.advanceTimersByTime(600)
    activation.pointerUp('a', pointer()); vi.advanceTimersByTime(500)
    expect(edit).not.toHaveBeenCalled(); expect(select).not.toHaveBeenCalled()
  })
  it('keeps keyboard activation immediate and cancels pending clicks when disposed', () => {
    activation.click('a', { detail: 0 }); expect(select).toHaveBeenCalledTimes(1); expect(select).toHaveBeenCalledWith('a')
    activation.click('b', { detail: 1 }); activation.dispose(); vi.advanceTimersByTime(500)
    expect(select).toHaveBeenCalledTimes(1)
    activation.edit('b'); expect(edit).toHaveBeenCalledTimes(1); expect(edit).toHaveBeenCalledWith('b')
  })
})
