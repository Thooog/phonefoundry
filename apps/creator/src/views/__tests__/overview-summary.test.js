import { describe, expect, it } from 'vitest'
import { overviewSummary } from '../overview-summary.js'

describe('作品首页内容摘要', () => {
  it('空作品保留七个真实目录入口，并不编造继续创作内容', () => {
    const result = overviewSummary({})
    expect(result.rows).toHaveLength(7)
    expect(result.rows.every(row => row.count === 0 && row.preview === '还没有内容')).toBe(true)
    expect(result.recent).toBeNull()
  })
  it('按编辑时间找回会话，而不是使用剧情时间或数组第一项', () => {
    const project = { appData: { messages: { conversations: [{ id: 'a', title: '旧会话' }, { id: 'b', title: '改过的会话' }], messages: [
      { conversationId: 'a', content: '故事中的未来', displayTime: '2099-01-01', updatedAt: '2026-01-01' },
      { conversationId: 'b', content: '刚修改的一句', displayTime: '1999-01-01', updatedAt: '2026-11-07' },
      { conversationId: 'deleted', content: '无主消息', updatedAt: '2027-01-01' },
    ] } } }
    const snapshot = JSON.stringify(project)
    expect(overviewSummary(project).recent).toMatchObject({ id: 'messages', recordId: 'b', preview: '改过的会话', excerpt: '刚修改的一句', count: 2 })
    expect(JSON.stringify(project)).toBe(snapshot)
  })
  it('目录显示相簿名、来电联系人和备忘录首行', () => {
    const { rows } = overviewSummary({ appData: {
      photos: { photos: [{ id: 'p', caption: '照片', createdAt: '2026-01-01' }], albums: [{ name: '海边的合照', photoIds: ['p'] }] },
      phone: { calls: [{ id: 'call', contactId: 'c', type: 'missed' }], contacts: [{ id: 'c', name: '周予安' }] },
      notes: { notes: [{ id: 'n', content: '\n搬进手机里的清单\n一盏灯', updatedAt: '2026-11-01' }] },
    } })
    expect(rows.find(row => row.id === 'photos').preview).toBe('海边的合照')
    expect(rows.find(row => row.id === 'phone').preview).toBe('周予安 · 未接来电')
    expect(rows.find(row => row.id === 'notes').preview).toBe('搬进手机里的清单')
  })
  it('语音消息没有正文时使用类型描述，匿名会话以人物名回退', () => {
    const { recent } = overviewSummary({ characters: [{ id: 'c', name: '林夏' }], appData: { kakaotalk: {
      conversations: [{ id: 'k', participantIds: ['c'] }], messages: [{ conversationId: 'k', contentType: 'voice', updatedAt: '2026-11-07' }],
    } } })
    expect(recent).toMatchObject({ preview: '林夏', excerpt: '语音消息', recordId: 'k' })
  })
  it('同一毫秒创建的消息使用最后一条摘要', () => {
    const { recent } = overviewSummary({ appData: { messages: { conversations: [{ id: 'c', title: '会话' }], messages: [
      { conversationId: 'c', content: '第一句', createdAt: '2026-11-07' },
      { conversationId: 'c', content: '最后一句', createdAt: '2026-11-07' },
    ] } } })
    expect(recent.excerpt).toBe('最后一句')
  })
})
