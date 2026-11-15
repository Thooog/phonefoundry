import { describe, it, expect } from 'vitest'
import { nextRecordSelection } from '../record-selection.js'
describe('record selection', () => {
  it('selects newly created records', () => expect(nextRecordSelection(['b','a'], ['a'], 'a')).toBe('b'))
  it('retains selection after reorder', () => expect(nextRecordSelection(['b','a'], ['a','b'], 'a')).toBe('a'))
  it('selects a neighbour after deletion', () => expect(nextRecordSelection(['a','c'], ['a','b','c'], 'b')).toBe('c'))
  it('clears empty selections', () => expect(nextRecordSelection([], ['a'], 'a')).toBe(null))
})
