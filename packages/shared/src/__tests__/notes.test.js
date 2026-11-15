/**
 * 备忘录派生测试 —— 标题/摘要切分与时间标签。
 */

import { describe, it, expect } from 'vitest'
import { createProject, createNote } from '../factory/index.js'
import { toWorkData } from '../work/to-work-data.js'
import { buildNotesList, buildNoteDetail } from '../select/notes.js'

describe('buildNotesList', () => {
  it('标题取第一个非空行，摘要取其余内容并压成一行', () => {
    const project = createProject()
    project.appData.notes.notes.push(
      createNote({ content: '搬进手机里的清单\n还差：相簿封面。\n都补完就收工。', displayTime: '2026-10-28T10:00:00.000Z' }),
    )
    const work = toWorkData(project)
    const [item] = buildNotesList(work)
    expect(item.title).toBe('搬进手机里的清单')
    expect(item.snippet).toBe('还差：相簿封面。 都补完就收工。')
  })

  it('首行是空行时跳到下一个非空行', () => {
    const project = createProject()
    project.appData.notes.notes.push(createNote({ content: '\n便利贴\n伞修好了。' }))
    const work = toWorkData(project)
    expect(buildNotesList(work)[0].title).toBe('便利贴')
    expect(buildNotesList(work)[0].snippet).toBe('伞修好了。')
  })

  it('单行短句没有摘要', () => {
    const project = createProject()
    project.appData.notes.notes.push(createNote({ content: '6 点半的闹钟记得打开' }))
    const work = toWorkData(project)
    const [item] = buildNotesList(work)
    expect(item.title).toBe('6 点半的闹钟记得打开')
    expect(item.snippet).toBe('')
  })

  it('空正文走占位标题，不让列表塌掉', () => {
    const project = createProject()
    project.appData.notes.notes.push(createNote({ content: '' }))
    const work = toWorkData(project)
    expect(buildNotesList(work)[0].title).toBe('（无标题）')
  })

  it('按 displayTime 倒序', () => {
    const project = createProject()
    project.appData.notes.notes.push(
      createNote({ content: '旧', displayTime: '2026-10-01T08:00:00.000Z' }),
      createNote({ content: '新', displayTime: '2026-10-28T09:00:00.000Z' }),
    )
    const work = toWorkData(project)
    expect(buildNotesList(work).map((n) => n.title)).toEqual(['新', '旧'])
  })
})

describe('buildNoteDetail', () => {
  it('返回全文；找不到返回 null', () => {
    const project = createProject()
    const note = createNote({ content: '全文在这里' })
    project.appData.notes.notes.push(note)
    const work = toWorkData(project)
    const detail = buildNoteDetail(work, note.id)
    expect(detail.content).toBe('全文在这里')
    expect(detail.timeLabel).toBeUndefined()
    expect(buildNoteDetail(work, 'note_missing')).toBeNull()
  })
})
