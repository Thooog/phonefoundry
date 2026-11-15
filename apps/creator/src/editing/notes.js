/**
 * 「备忘录」应用的编辑操作 —— 纯函数，入参是 project store。
 *
 * 与其他 editing/*.js 同一套约定（见 photos.js 文件头）：
 *   · 只换引用，不原地改数组
 *   · 一次操作一次 mutate，revision 只涨一次
 *   · 可写字段走白名单，id 与 createdAt 不给改
 *
 * 备忘录是八个应用里数据最少的：一条记录只有正文和时间。
 * 标题、摘要、列表时间全是派生 —— 数据层一旦多存一个 title 字段，
 * 就会出现"正文改了标题没改"的两处同步问题。
 */

import { createNote, splitNoteContent } from '@phone-sim/shared'

/**
 * 正文长度上限。
 *
 * 不是性能考虑（几万字也存得下），是叙事考虑：捡手机文学里的备忘录
 * 通常是一段话或一条清单，5000 字已经远超一屏。真有人要塞十万字，
 * 问题不在工具而在作品 —— 而且超长文本会让导出体积和首屏渲染都变差。
 */
export const NOTE_MAX_LENGTH = 5000

const nowIso = () => new Date().toISOString()

/** 拿到备忘录桶，缺什么补什么（导入的项目可能只有一部分桶） */
function ensureBucket(project) {
  if (!project.appData || typeof project.appData !== 'object') project.appData = {}
  if (!project.appData.notes) project.appData.notes = { notes: [] }

  const bucket = project.appData.notes
  if (!Array.isArray(bucket.notes)) bucket.notes = []
  return bucket
}

/** 可写字段白名单。id / createdAt 不给改 —— 换 id 应该走"删掉再新建" */
const EDITABLE_FIELDS = ['content', 'displayTime']

function pickEditable(patch) {
  const clean = {}
  for (const key of EDITABLE_FIELDS) {
    if (patch?.[key] !== undefined) clean[key] = patch[key]
  }
  return clean
}

function timeOf(value) {
  const t = new Date(value ?? 0).getTime()
  return Number.isNaN(t) ? -Infinity : t
}

/**
 * 按编辑时间倒序（新的在前）。
 * 无效时间排到最后，理由同 photos.js：否则"没填时间"的会顶到第一位。
 * @param {object[]} notes
 */
export function sortNotesByTime(notes) {
  return [...(notes ?? [])].sort((a, b) => timeOf(b.displayTime) - timeOf(a.displayTime))
}

export function addNote(editor, input = {}) {
  const note = createNote({
    content: String(input.content ?? '').slice(0, NOTE_MAX_LENGTH),
    ...(input.displayTime ? { displayTime: input.displayTime } : {}),
  })

  editor.mutate((draft) => {
    const bucket = ensureBucket(draft)
    bucket.notes = [...bucket.notes, note]
  })

  return note
}

/**
 * 改一条备忘录。
 *
 * @param {object} editor
 * @param {string} noteId
 * @param {{content?: string, displayTime?: string}} patch
 * @returns {object|null} 改后的记录；不存在或没有可写字段时返回 null
 */
export function updateNote(editor, noteId, patch) {
  const clean = pickEditable(patch)
  if (Object.keys(clean).length === 0) return null

  let updated = null
  editor.mutate((draft) => {
    const bucket = ensureBucket(draft)
    bucket.notes = bucket.notes.map((note) => {
      if (note.id !== noteId) return note
      updated = {
        ...note,
        ...clean,
        ...(clean.content !== undefined ? { content: String(clean.content).slice(0, NOTE_MAX_LENGTH) } : {}),
        updatedAt: nowIso(),
      }
      return updated
    })
  })

  return updated
}

/**
 * 删一条备忘录。
 * 备忘录不引用任何资源，所以没有"回收素材"这一步 —— 与 deletePhoto 不同。
 *
 * @param {object} editor
 * @param {string} noteId
 * @returns {boolean} 是否真的删掉了一条
 */
export function deleteNote(editor, noteId) {
  let removed = false
  editor.mutate((draft) => {
    const bucket = ensureBucket(draft)
    const kept = bucket.notes.filter((note) => note.id !== noteId)
    removed = kept.length !== bucket.notes.length
    bucket.notes = kept
  })
  return removed
}

/**
 * 列表行要显示的标题。
 *
 * 直接复用作品端的派生规则：用户在编辑器里看到的那一行标题，
 * 就是作品端列表里的那一行，不会出现"这边叫 A、那边叫 B"。
 *
 * @param {string} content
 * @returns {string}
 */
export function noteTitle(content) {
  return splitNoteContent(content).title
}
