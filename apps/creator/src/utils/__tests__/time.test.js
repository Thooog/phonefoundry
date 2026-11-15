/**
 * 创作端时间显示测试。
 *
 * 全部显式注入 now —— 不注入就只能写"大约 3 分钟前"，那种测试在 CI 上会随机失败。
 */

import { describe, it, expect } from 'vitest'
import { formatRelativeTime, formatDateTime, formatDate, formatChatDay } from '../time.js'

const NOW = new Date(2026, 9, 27, 12, 0, 0).getTime()
const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

function iso(offsetMs) {
  return new Date(NOW + offsetMs).toISOString()
}

describe('formatRelativeTime', () => {
  it('30 秒前 → 刚刚', () => {
    expect(formatRelativeTime(iso(-30 * 1000), NOW)).toBe('刚刚')
  })

  it('5 分钟前', () => {
    expect(formatRelativeTime(iso(-5 * MINUTE), NOW)).toBe('5 分钟前')
  })

  it('3 小时前', () => {
    expect(formatRelativeTime(iso(-3 * HOUR), NOW)).toBe('3 小时前')
  })

  it('2 天前', () => {
    expect(formatRelativeTime(iso(-2 * DAY), NOW)).toBe('2 天前')
  })

  it('超过 7 天改用具体日期', () => {
    const result = formatRelativeTime(iso(-10 * DAY), NOW)
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('未来时间算「刚刚」而不是负数', () => {
    // 跨设备导入、系统时钟回拨都会造出未来时间戳
    expect(formatRelativeTime(iso(5 * MINUTE), NOW)).toBe('刚刚')
  })

  it('空值 / 非法值返回空串（调用方据此不渲染）', () => {
    expect(formatRelativeTime(null, NOW)).toBe('')
    expect(formatRelativeTime(undefined, NOW)).toBe('')
    expect(formatRelativeTime('', NOW)).toBe('')
    expect(formatRelativeTime('不是时间', NOW)).toBe('')
  })
})

describe('formatDateTime', () => {
  it('补零到 YYYY-MM-DD HH:mm', () => {
    const ts = new Date(2026, 0, 5, 9, 7).toISOString()
    expect(formatDateTime(ts)).toBe('2026-01-05 09:07')
  })

  it('非法输入返回空串', () => {
    expect(formatDateTime(null)).toBe('')
    expect(formatDateTime('x')).toBe('')
  })
})

describe('formatDate', () => {
  it('用本地时区，不是 UTC', () => {
    // 本地 00:30 对应的 UTC 可能是前一天，用 toISOString 切片会少一天
    const ts = new Date(2026, 9, 27, 0, 30).getTime()
    expect(formatDate(ts)).toBe('2026-10-27')
  })
})

describe('formatChatDay', () => {
  it('uses the local date and weekday', () => {
    expect(formatChatDay(new Date(2026, 5, 30, 23, 21).toISOString(), 2026)).toBe('6月30日 星期二')
  })
  it('includes the year across calendar years', () => {
    expect(formatChatDay(new Date(2025, 11, 31, 23, 59).toISOString(), 2026)).toBe('2025年12月31日 星期三')
  })
  it.each([null, '', 'invalid'])('labels a missing or invalid date: %s', value => {
    expect(formatChatDay(value, 2026)).toBe('未设置日期')
  })
})
