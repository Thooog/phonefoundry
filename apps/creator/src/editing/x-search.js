import { createId } from '@phone-sim/shared'

const keys = ['trends', 'searchHistory']
export function xSearchRows(project, key, platform = 'x') {
  if (!keys.includes(key)) throw new TypeError('未知的 X 搜索集合')
  return Array.isArray(project?.appData?.[platform]?.[key]) ? project.appData[platform][key] : []
}

function write(editor, key, rows, platform = 'x') {
  if (editor.readOnlyReason) return false
  editor.mutate(project => {
    project.appData = { ...project.appData, [platform]: { ...project.appData?.[platform], [key]: rows } }
  })
  return true
}

export function addXSearchRow(editor, key, platform = 'x') {
  const rows = xSearchRows(editor.project, key, platform)
  const row = key === 'trends'
    ? { id: createId('xtrend'), title: '', category: '', region: '', postCount: null }
    : { id: createId('xsearch'), type: 'keyword', title: '', accountId: null }
  return write(editor, key, [...rows, row], platform) ? row : null
}

export function updateXSearchRow(editor, key, id, patch, platform = 'x') {
  const rows = xSearchRows(editor.project, key, platform)
  if (!rows.some(row => row.id === id)) return false
  const next = {}
  for (const field of key === 'trends' ? ['title', 'category', 'region', 'postCount'] : ['type', 'title', 'accountId']) {
    if (!Object.hasOwn(patch, field)) continue
    const value = patch[field]
    if (field === 'postCount') {
      if (value !== null && (!Number.isSafeInteger(value) || value < 0)) return false
      next[field] = value
    } else if (field === 'type') {
      if (!['keyword', 'account'].includes(value)) return false
      next[field] = value
    } else if (field === 'accountId') {
      if (value !== null && !editor.project.platformAccounts?.some(account => account.platform === platform && account.id === value)) return false
      next[field] = value
    } else {
      if (typeof value !== 'string') return false
      next[field] = value.slice(0, field === 'title' ? 200 : 80)
    }
  }
  if (!Object.keys(next).length) return false
  return write(editor, key, rows.map(row => row.id === id ? { ...row, ...next } : row), platform)
}

export function removeXSearchRow(editor, key, id, platform = 'x') {
  const rows = xSearchRows(editor.project, key, platform)
  return rows.some(row => row.id === id) && write(editor, key, rows.filter(row => row.id !== id), platform)
}

export function moveXSearchRow(editor, key, id, target, platform = 'x') {
  const rows = xSearchRows(editor.project, key, platform)
  const from = rows.findIndex(row => row.id === id)
  if (from < 0 || !Number.isInteger(target) || target < 0 || target >= rows.length || target === from) return false
  const next = [...rows]
  next.splice(target, 0, next.splice(from, 1)[0])
  return write(editor, key, next, platform)
}
