import { describe, it, expect } from 'vitest'

import { buildPreviewQuery, parsePreviewTarget } from '../preview-target.js'

describe('parsePreviewTarget', () => {
  it('没有 query 时返回 null（默认从锁屏开始）', () => {
    expect(parsePreviewTarget(undefined)).toBeNull()
    expect(parsePreviewTarget(null)).toBeNull()
    expect(parsePreviewTarget({})).toBeNull()
  })

  it('app 命中时只给 app，不带 screen / entity', () => {
    expect(parsePreviewTarget({ app: 'notes' })).toEqual({
      app: 'notes',
      screen: undefined,
      entityId: undefined,
    })
  })

  it('未知 app 返回 null —— 挡住作品端占位页', () => {
    expect(parsePreviewTarget({ app: 'nope' })).toBeNull()
    expect(parsePreviewTarget({ app: 'home' })).toBeNull()
  })

  it('app + screen + entity 三者齐全', () => {
    expect(parsePreviewTarget({ app: 'kakaotalk', screen: 'chat', entity: 'cv_1' })).toEqual({
      app: 'kakaotalk',
      screen: 'chat',
      entityId: 'cv_1',
    })
  })

  it('有 entity 但没有 screen 时丢弃 entity（作品端无处安放）', () => {
    expect(parsePreviewTarget({ app: 'notes', entity: 'n_1' })).toEqual({
      app: 'notes',
      screen: undefined,
      entityId: undefined,
    })
  })

  it('空串与纯空格不算参数', () => {
    expect(parsePreviewTarget({ app: '  ' })).toBeNull()
    expect(parsePreviewTarget({ app: 'notes', screen: '   ' })).toEqual({
      app: 'notes',
      screen: undefined,
      entityId: undefined,
    })
  })

  it('重复参数取第一个', () => {
    expect(parsePreviewTarget({ app: ['notes', 'x'] })?.app).toBe('notes')
  })

  it('非字符串值不会让解析抛错', () => {
    expect(parsePreviewTarget({ app: 42 })).toBeNull()
    expect(parsePreviewTarget({ app: { id: 'notes' } })).toBeNull()
  })

  it('前后空格会被裁掉（手输 URL 常见）', () => {
    expect(parsePreviewTarget({ app: ' notes ' })?.app).toBe('notes')
  })
})

describe('buildPreviewQuery', () => {
  it('非法目标给空对象，调用方直接 spread 不会污染 query', () => {
    expect(buildPreviewQuery(null)).toEqual({})
    expect(buildPreviewQuery({})).toEqual({})
    expect(buildPreviewQuery({ app: 'nope' })).toEqual({})
  })

  it('只有 app 时只产一个键', () => {
    expect(buildPreviewQuery({ app: 'photos' })).toEqual({ app: 'photos' })
  })

  it('screen 无 entity 时只产 app + screen', () => {
    expect(buildPreviewQuery({ app: 'notes', screen: 'note' })).toEqual({
      app: 'notes',
      screen: 'note',
    })
  })

  it('三者齐全时键名是 entity 而不是 entityId', () => {
    expect(buildPreviewQuery({ app: 'x', screen: 'post', entityId: 'p_1' })).toEqual({
      app: 'x',
      screen: 'post',
      entity: 'p_1',
    })
  })

  it('生成再解析能原样还原（入口与预览页必须用同一套口径）', () => {
    const target = { app: 'phone', screen: 'contact', entityId: 'c_9' }
    expect(parsePreviewTarget(buildPreviewQuery(target))).toEqual(target)
  })
})
