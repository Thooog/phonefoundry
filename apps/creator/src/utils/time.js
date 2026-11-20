/**
 * 创作端的时间显示。
 *
 * 为什么不复用 packages/shared/src/time/format.js：
 *   那一套是**作品内**的时间语义 —— 以故事日期（storyDate）为基准，
 *   算出"昨天 14:23"这种沉浸式文案。
 *   创作端要回答的是"我上次什么时候动过这个项目"，跟故事日期完全无关。
 *   混用会让"改一下 storyDate，项目列表的修改时间也跟着变"这种荒谬 bug 出现。
 */

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * 相对时间：刚刚 / N 分钟前 / N 小时前 / N 天前 / 具体日期
 *
 * @param {string|null|undefined} iso ISO 时间串
 * @param {number} [now] 当前时间戳（注入是为了可测，不让测试依赖真实时钟）
 * @returns {string} 无法解析时返回空串，调用方据此不渲染
 */
export function formatRelativeTime(iso, now = Date.now()) {
  const ts = parseIso(iso)
  if (ts === null) return ''

  const diff = now - ts

  // 未来时间：本地时钟回拨或跨设备导入都会出现。不说"1 分钟后"这种怪话。
  if (diff < 0) return '刚刚'

  if (diff < MINUTE) return '刚刚'
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} 分钟前`
  if (diff < DAY) return `${Math.floor(diff / HOUR)} 小时前`
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)} 天前`
  return formatDate(ts)
}

/**
 * 绝对时间，用于 hover 提示 —— 相对时间不能替代精确值。
 * @param {string|null|undefined} iso
 * @returns {string}
 */
export function formatDateTime(iso) {
  const ts = parseIso(iso)
  if (ts === null) return ''
  const d = new Date(ts)
  return `${formatDate(ts)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** YYYY-MM-DD */
export function formatDate(ts) {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function parseIso(iso) {
  if (!iso) return null
  const ts = Date.parse(iso)
  return Number.isFinite(ts) ? ts : null
}

/**
 * ISO → `<input type="datetime-local">` 需要的 `YYYY-MM-DDTHH:mm`。
 *
 * 必须用**本地时间**拼串：input 的 value 是按本地时区解释的，
 * 直接塞 `toISOString().slice(0,16)` 会把 UTC 值当本地值，差出八小时。
 *
 * @param {string|null|undefined} iso
 * @returns {string} 无法解析时返回空串
 */
export function toDateTimeLocal(iso) {
  const ts = parseIso(iso)
  if (ts === null) return ''
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function fromDateTimeLocal(value) {
  if (!value) return null
  const normalized = value.length === 16 ? `${value}:00` : value
  const ts = new Date(normalized).getTime()
  return Number.isFinite(ts) ? new Date(ts).toISOString() : null
}

/**
 * 时间平移量的口语说法：「2 分钟」「1 小时 20 分钟」。
 *
 * 只说绝对值，方向由调用方补（往后 / 往前）—— 免得出现「-2 分钟」这种
 * 需要读第二遍才知道往哪边动的文案。
 *
 * @param {number} ms 毫秒，符号被忽略
 * @returns {string}
 */
export function formatTimeShift(ms) {
  const total = Math.abs(ms)
  const minutes = Math.round(total / MINUTE)
  if (!minutes) return `${Math.max(1, Math.round(total / 1000))} 秒`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (!hours) return `${rest} 分钟`
  return rest ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`
}

function pad(n) {
  return String(n).padStart(2, '0')
}

/** Local calendar label used by the KKT editing timeline. */
export function formatChatDay(iso, currentYear = new Date().getFullYear()) {
  const local = toDateTimeLocal(iso)
  if (!local) return '未设置日期'
  const value = new Date(iso)
  const year = value.getFullYear()
  const prefix = year === currentYear ? '' : `${year}年`
  return `${prefix}${value.getMonth() + 1}月${value.getDate()}日 星期${'日一二三四五六'[value.getDay()]}`
}
