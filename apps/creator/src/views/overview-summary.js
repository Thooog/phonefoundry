import { APPS } from '@phone-sim/shared'

const sections = [
  ['photos', 'photos', '张'], ['kakaotalk', 'conversations', '个对话'],
  ['messages', 'conversations', '个对话'], ['x', 'posts', '篇帖子'],
  ['phone', 'calls', '条通话'], ['instagram', 'posts', '篇帖子'], ['notes', 'notes', '篇'],
]
const messageLabels = { image: '图片消息', sticker: '贴图消息', voice: '语音消息', system: '系统消息' }
const modified = record => Date.parse(record?.updatedAt || record?.createdAt || '') || 0
const newest = records => records.reduce((last, record) => !last || modified(record) >= modified(last) ? record : last, null)
const firstLine = value => String(value || '').split('\n').find(line => line.trim())?.trim() || ''

export function overviewSummary(project) {
  const nameOf = id => (project.characters || []).find(character => character.id === id)?.name || '未命名人物'
  const rows = sections.map(([id, key, unit]) => {
    const bucket = project.appData?.[id] || {}
    const records = bucket[key] || []
    let record = newest(records)
    let latest = record
    let preview = ''
    let excerpt = ''
    if (id === 'messages' || id === 'kakaotalk') {
      latest = newest((bucket.messages || []).filter(message => records.some(conv => conv.id === message.conversationId)))
      record = records.find(conv => conv.id === latest?.conversationId) || record
      preview = record?.title || (record?.participantIds || []).map(nameOf).join('、') || '未命名会话'
      excerpt = latest?.content || messageLabels[latest?.contentType] || '还没有消息'
    } else if (id === 'phone' && record) {
      const contact = (bucket.contacts || []).find(item => item.id === record.contactId)
      preview = `${contact?.name || record.phoneNumber || '未知号码'} · ${{ missed: '未接来电', incoming: '来电', outgoing: '拨出电话' }[record.type] || '通话'}`
    } else preview = firstLine(record?.caption || record?.content)
    if (id === 'photos') preview = (bucket.albums || []).find(album => album.photoIds?.includes(record?.id))?.name || preview
    return { id, name: APPS.find(app => app.id === id)?.name || id, count: records.length, countLabel: `${records.length} ${unit}`,
      recordId: record?.id, preview: records.length ? preview || '尚未填写内容' : '还没有内容',
      excerpt: excerpt || preview, modifiedAt: latest?.updatedAt || latest?.createdAt || record?.updatedAt || record?.createdAt || null }
  })
  const recent = [...rows].filter(row => row.recordId).sort((a, b) => (Date.parse(b.modifiedAt) || 0) - (Date.parse(a.modifiedAt) || 0))[0] || null
  return { rows, recent }
}
