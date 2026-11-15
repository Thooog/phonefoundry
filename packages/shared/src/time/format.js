

import { TIME_FORMAT } from '../constants/defaults.js'

const WEEKDAY_ZH = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']
const WEEKDAY_SHORT_ZH = ['日', '一', '二', '三', '四', '五', '六']

/** 把 'YYYY-MM-DD' 解析为本地零点 Date；非法返回 null。 */
export function parseStoryDate(storyDate) {
  if (!storyDate || typeof storyDate !== 'string') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(storyDate)
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2]) - 1
  const day = Number(m[3])
  const date = new Date(year, month, day, 0, 0, 0, 0)

  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) {
    return null
  }
  return date
}

/** Date → 'YYYY-MM-DD'（本地时区） */
export function toDateKey(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * 剧情"今天"。
 * 有 storyDate → 该日期的本地零点；否则 → 真实今天零点。
 * @param {string|null} storyDate
 * @returns {Date}
 */
export function storyToday(storyDate) {
  const parsed = parseStoryDate(storyDate)
  if (parsed) return parsed
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
}

/**
 * 状态栏 / 锁屏时钟。
 * 真实系统时间，但若设置了 storyDate 且与真实今天不同，
 * 日期部分仍取 storyDate（由调用方分别取 storyToday 与本函数）。
 *
 * 12 小时制**不带 AM/PM**：锁屏大时钟字号极大（5.6rem），后缀会把
 * 「12:22 AM」挤成两行；状态栏也因此在 20px 宽度里塞不下。
 * 12 小时制只做 13→1、0→12 的换算，其余与 24 小时制一致。
 * @param {Date} [now] 便于测试注入
 * @param {'h12'|'h24'} [timeFormat]
 */
export function formatClock(now = new Date(), timeFormat = TIME_FORMAT.H24) {
  const h = now.getHours()
  const m = String(now.getMinutes()).padStart(2, '0')
  if (timeFormat === TIME_FORMAT.H12) {
    const h12 = h % 12 === 0 ? 12 : h % 12
    return `${h12}:${m}`
  }
  return `${String(h).padStart(2, '0')}:${m}`
}

/** 锁屏日期：9月26日 星期六 */
export function formatStoryDateLine(storyDate, now = new Date()) {
  const base = parseStoryDate(storyDate) ?? now
  return `${base.getMonth() + 1}月${base.getDate()}日 ${WEEKDAY_ZH[base.getDay()]}`
}

/** 短星期，日历表头用 */
export function weekdayShort(index) {
  return WEEKDAY_SHORT_ZH[index] ?? ''
}

export function weekdayLong(index) {
  return WEEKDAY_ZH[index] ?? ''
}

/**
 * 聊天日期分隔的判定：相对 storyToday 的偏移。
 * @returns {'today'|'yesterday'|'thisYear'|'older'}
 */
export function dayRelation(targetDate, storyDate) {
  const base = storyToday(storyDate)
  const t = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate())
  const diffDays = Math.round((base - t) / (24 * 60 * 60 * 1000))
  if (diffDays === 0) return 'today'
  if (diffDays === 1) return 'yesterday'
  if (t.getFullYear() === base.getFullYear()) return 'thisYear'
  return 'older'
}

/**
 * 聊天日期分隔文案。
 * 已设为 storyDate 的"今天"显示为「今天」，而不是真实今天。
 */
export function formatDayDivider(targetDate, storyDate) {
  const relation = dayRelation(targetDate, storyDate)
  if (relation === 'today') return '今天'
  if (relation === 'yesterday') return '昨天'
  if (relation === 'thisYear') {
    return `${targetDate.getMonth() + 1}月${targetDate.getDate()}日`
  }
  return `${targetDate.getFullYear()}年${targetDate.getMonth() + 1}月${targetDate.getDate()}日`
}

/** 会话列表 / 信息流角标时间：今天显示 HH:mm，昨天显示"昨天"，更早显示日期。 */
export function formatListTime(iso, { storyDate, timeFormat } = {}) {
  const date = toDate(iso)
  if (!date) return ''
  const relation = dayRelation(date, storyDate)
  if (relation === 'today') return formatClock(date, timeFormat)
  if (relation === 'yesterday') return '昨天'
  if (relation === 'thisYear') return `${date.getMonth() + 1}/${date.getDate()}`
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`
}

/** 详情页时间戳：今天只显示时刻，否则带日期。 */
export function formatDetailTime(iso, { storyDate, timeFormat } = {}) {
  const date = toDate(iso)
  if (!date) return ''
  const relation = dayRelation(date, storyDate)
  const clock = formatClock(date, timeFormat)
  if (relation === 'today') return clock
  if (relation === 'yesterday') return `昨天 ${clock}`
  if (relation === 'thisYear') return `${date.getMonth() + 1}月${date.getDate()}日 ${clock}`
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${clock}`
}

/**
 * X 帖子详情 meta 行的时间：「26年11月13日, 17:42」。
 * 真机 X 中文版这里永远给全日期（年份两位 + 逗号 + 时刻），不做今天/昨天折算 ——
 * 详情页的时间是"这条帖子什么时候发的"的完整答案。
 */
export function formatXDetailTime(iso, { timeFormat } = {}) {
  const date = toDate(iso)
  if (!date) return ''
  return `${date.getFullYear() % 100}年${date.getMonth() + 1}月${date.getDate()}日, ${formatClock(date, timeFormat)}`
}

export function formatMonthTitle(iso, { storyDate } = {}) {
  const date = toDate(iso)
  if (!date) return '日期未知'
  const baseYear = storyToday(storyDate).getFullYear()
  const month = date.getMonth() + 1
  return date.getFullYear() === baseYear ? `${month}月` : `${date.getFullYear()}年${month}月`
}

/** 照片详情的时间戳：始终带年份（这是"这张照片什么时候拍的"的完整答案）。 */
export function formatPhotoStamp(iso, { timeFormat } = {}) {
  const date = toDate(iso)
  if (!date) return ''
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${formatClock(date, timeFormat)}`
}

/**
 * 照片查看器副标题：「星期三 13:39」。
 *
 * 与 formatPhotoStamp 的分工：那个要回答"哪天拍的"，日期是主角；
 * 这个只在照片正下方配一行小字，主图已经说明了拍的是什么，
 * 多出来的年份和月日只是噪音。星期几反而是读者会去对的——"那天不是周三吗"。
 *
 * 不看 storyDate：照片自带 displayTime，是剧情里的客观时刻，
 * 与"今天是剧情第几天"无关。
 */
export function formatPhotoWeekdayTime(iso, { timeFormat } = {}) {
  const date = toDate(iso)
  if (!date) return ''
  return `${weekdayLong(date.getDay())} ${formatClock(date, timeFormat)}`
}

/** 秒 → mm:ss；非法输入返回 0:00 */
export function formatDuration(totalSeconds) {
  const sec = Math.max(0, Math.floor(Number(totalSeconds) || 0))
  const m = Math.floor(sec / 60)
  const s = String(sec % 60).padStart(2, '0')
  return `${m}:${s}`
}

function toDate(iso) {
  if (iso instanceof Date) return Number.isNaN(iso.getTime()) ? null : iso
  if (typeof iso === 'number') {
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? null : d
  }
  if (typeof iso !== 'string' || !iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

/** 月视图的日期网格（含前后补白），返回 Date[][]，每行 7 天。 */
export function buildMonthGrid(year, month) {
  const first = new Date(year, month, 1)
  const startOffset = first.getDay()
  const start = new Date(year, month, 1 - startOffset)
  const rows = []
  let cursor = new Date(start)
  for (let r = 0; r < 6; r += 1) {
    const week = []
    for (let c = 0; c < 7; c += 1) {
      week.push(new Date(cursor))
      cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1)
    }
    rows.push(week)
    // 最后一行若整行都是下个月，裁掉
    if (r >= 4 && week.every((d) => d.getMonth() !== month)) {
      rows.pop()
      break
    }
  }
  return rows
}

export function isSameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}
