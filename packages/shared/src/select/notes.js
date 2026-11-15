/**
 * 备忘录只读派生。
 *
 * 标题 / 摘要规则（iOS 备忘录列表语义）：
 *   标题   = 正文第一个非空行（过长截断交给 CSS ellipsis，不在数据层砍字）
 *   摘要   = 标题之后的其余内容压成一行（换行折成空格），可能为空
 *   时间戳 = iOS 列表里"摘要前的那段时间"——今天显示时刻，昨天显示"昨天"，
 *            更早显示 M/D（与聊天列表同一套 formatListTime 语义，保证全机一致）
 */

import { formatListTime } from '../time/format.js'

export function buildNotesList(work) {
  const notes = work.appData?.notes?.notes ?? []
  return [...notes]
    .sort((a, b) => String(b.displayTime || '').localeCompare(String(a.displayTime || '')))
    .map((n) => {
      const { title, snippet } = splitNoteContent(n.content)
      return {
        id: n.id,
        title,
        snippet,
        timeLabel: formatListTime(n.displayTime, { storyDate: work.workSettings?.storyDate }),
        /**
         * 列表搜索用的原文（作品端搜索框只做本地过滤）。
         * 标题就是正文首行，所以匹配正文即覆盖标题，不必再拼一遍。
         * 放数据层是为了让"能搜到什么"和"列表显示什么"永远同源。
         */
        searchText: String(n.content ?? ''),
      }
    })
}

export function buildNoteDetail(work, noteId) {
  const note = (work.appData?.notes?.notes ?? []).find((n) => n.id === noteId)
  if (!note) return null
  return {
    id: note.id,
    content: note.content ?? '',
  }
}

/**
 * 正文 → { 标题, 摘要 }。全部是空行时标题走占位，不让列表塌掉。
 *
 * 导出是给编辑端用的：编辑器的列表行同样要显示"第一行当标题"。
 * 规则只能有一份 —— 否则同一段文字在创作端和作品端会显示成两个名字。
 */
export function splitNoteContent(content) {
  const lines = String(content ?? '').split(/\r?\n/)
  let title = ''
  let restStart = -1
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim()) {
      title = lines[i].trim()
      restStart = i + 1
      break
    }
  }
  const snippet = restStart >= 0 ? lines.slice(restStart).join(' ').trim() : ''
  return { title: title || '（无标题）', snippet }
}
