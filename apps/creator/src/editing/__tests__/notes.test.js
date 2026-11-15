import { describe, it, expect } from 'vitest'

import {
  NOTE_MAX_LENGTH,
  addNote,
  deleteNote,
  noteTitle,
  sortNotesByTime,
  updateNote,
} from '../notes.js'

/**
 * 最小化的 project store 替身。
 * 与 photos.test.js 同一套写法：mutate 拿顶层浅拷贝、改完换引用。
 */
function createEditor() {
  let mutations = 0
  const editor = {
    project: {
      id: 'prj_test',
      appData: { notes: { notes: [] } },
      assets: [],
    },
    get mutations() {
      return mutations
    },
    mutate(fn) {
      mutations += 1
      const draft = { ...editor.project }
      fn(draft)
      editor.project = draft
    },
  }
  return editor
}

const notesOf = (editor) => editor.project.appData.notes.notes

describe('addNote', () => {
  it('写入一条备忘录，默认带时间', () => {
    const editor = createEditor()
    const note = addNote(editor, { content: '周三要还伞' })

    expect(notesOf(editor)).toHaveLength(1)
    expect(note.content).toBe('周三要还伞')
    // 不传时间时应该是"现在"，不是空串 —— 没有时间的备忘录会排到列表最后
    expect(Number.isFinite(Date.parse(note.displayTime))).toBe(true)
  })

  it('一次新建只涨一次 revision（只调一次 mutate）', () => {
    const editor = createEditor()
    addNote(editor, { content: 'a' })
    expect(editor.mutations).toBe(1)
  })

  it('超长正文被截断到上限', () => {
    const editor = createEditor()
    const note = addNote(editor, { content: 'x'.repeat(NOTE_MAX_LENGTH + 50) })
    expect(note.content).toHaveLength(NOTE_MAX_LENGTH)
  })

  it('缺桶时自动补桶', () => {
    const editor = { project: { appData: {} }, mutate(fn) { const d = { ...editor.project }; fn(d); editor.project = d } }
    addNote(editor, { content: 'a' })
    expect(editor.project.appData.notes.notes).toHaveLength(1)
  })
})

describe('updateNote', () => {
  it('改正文，并刷新 updatedAt', () => {
    const editor = createEditor()
    const note = addNote(editor, { content: '旧' })
    const updated = updateNote(editor, note.id, { content: '新' })

    expect(updated.content).toBe('新')
    expect(notesOf(editor)[0].content).toBe('新')
    expect(updated.updatedAt >= note.updatedAt).toBe(true)
  })

  it('只认白名单：id 与 createdAt 改不动', () => {
    const editor = createEditor()
    const note = addNote(editor, { content: 'a' })
    updateNote(editor, note.id, { id: 'hacked', createdAt: '1970-01-01T00:00:00.000Z' })

    // 没有任何白名单字段 → 直接返回 null，不产生改动
    expect(notesOf(editor)[0].id).toBe(note.id)
    expect(notesOf(editor)[0].createdAt).toBe(note.createdAt)
  })

  it('没有可写字段时不触发 mutate', () => {
    const editor = createEditor()
    const note = addNote(editor, { content: 'a' })
    const before = editor.mutations
    expect(updateNote(editor, note.id, {})).toBeNull()
    expect(editor.mutations).toBe(before)
  })

  it('id 不存在时返回 null，不误改别人', () => {
    const editor = createEditor()
    addNote(editor, { content: 'a' })
    expect(updateNote(editor, 'note_nope', { content: 'b' })).toBeNull()
    expect(notesOf(editor)[0].content).toBe('a')
  })
})

describe('deleteNote', () => {
  it('删掉指定的一条', () => {
    const editor = createEditor()
    const a = addNote(editor, { content: 'a' })
    addNote(editor, { content: 'b' })

    expect(deleteNote(editor, a.id)).toBe(true)
    expect(notesOf(editor)).toHaveLength(1)
    expect(notesOf(editor)[0].content).toBe('b')
  })

  it('删不存在的一条返回 false', () => {
    const editor = createEditor()
    expect(deleteNote(editor, 'note_nope')).toBe(false)
  })
})

describe('sortNotesByTime', () => {
  it('新的在前', () => {
    const sorted = sortNotesByTime([
      { id: 'a', displayTime: '2026-10-01T10:00:00.000Z' },
      { id: 'b', displayTime: '2026-10-20T10:00:00.000Z' },
    ])
    expect(sorted.map((n) => n.id)).toEqual(['b', 'a'])
  })

  it('没有时间的排到最后，而不是当成 1970 顶到最前', () => {
    const sorted = sortNotesByTime([
      { id: 'none', displayTime: '' },
      { id: 'old', displayTime: '2026-01-01T00:00:00.000Z' },
    ])
    expect(sorted.map((n) => n.id)).toEqual(['old', 'none'])
  })

  it('不改原数组', () => {
    const input = [{ id: 'a', displayTime: '2026-10-01T10:00:00.000Z' }]
    const copy = [...input]
    sortNotesByTime(input)
    expect(input).toEqual(copy)
  })
})

describe('noteTitle', () => {
  it('取正文第一个非空行', () => {
    expect(noteTitle('\n\n第一行\n第二行')).toBe('第一行')
  })

  it('空正文走占位，与作品端一致', () => {
    expect(noteTitle('')).toBe('（无标题）')
    expect(noteTitle('\n  \n')).toBe('（无标题）')
  })
})
