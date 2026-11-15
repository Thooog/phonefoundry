export function homeSchedules(content) {
  if (Array.isArray(content?.schedules)) return content.schedules.slice(0, 30)
    .filter(row => row && typeof row.title === 'string')
    .map(row => ({ title: row.title.slice(0, 100), start: /^\d{2}:\d{2}$/.test(row.start) ? row.start : '', end: /^\d{2}:\d{2}$/.test(row.end) ? row.end : '' }))
  return content?.detail && content.detail !== '今天无日程' ? [{ title: content.detail.slice(0, 100), start: '', end: '' }] : []
}
