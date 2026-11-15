import { describe, expect, it } from 'vitest'
import { shouldSubmitMessage } from '../message-submit.js'

describe('message composer submission', () => {
  it('submits Enter on touch devices and preserves desktop multiline entry', () => {
    expect(shouldSubmitMessage({ key: 'Enter' }, true)).toBe(true)
    expect(shouldSubmitMessage({ key: 'Enter' }, false)).toBe(false)
    expect(shouldSubmitMessage({ key: 'Enter', ctrlKey: true }, false)).toBe(true)
    expect(shouldSubmitMessage({ key: 'Enter', metaKey: true }, false)).toBe(true)
    expect(shouldSubmitMessage({ key: 'Enter', shiftKey: true }, true)).toBe(false)
  })
  it('supports software keyboards that only emit beforeinput', () => {
    expect(shouldSubmitMessage({ type: 'beforeinput', inputType: 'insertLineBreak' }, true)).toBe(true)
    expect(shouldSubmitMessage({ type: 'beforeinput', inputType: 'insertParagraph' }, true)).toBe(true)
    expect(shouldSubmitMessage({ type: 'beforeinput', inputType: 'insertText' }, true)).toBe(false)
  })
  it('does not submit IME confirmation or repeated keydown', () => {
    expect(shouldSubmitMessage({ key: 'Enter', isComposing: true }, true)).toBe(false)
    expect(shouldSubmitMessage({ key: 'Enter', keyCode: 229 }, true)).toBe(false)
    expect(shouldSubmitMessage({ key: 'Enter' }, true, true)).toBe(false)
    expect(shouldSubmitMessage({ key: 'Enter', repeat: true }, true)).toBe(false)
  })
})
