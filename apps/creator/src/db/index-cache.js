

const KEY = 'phone-sim:project-index'
const VERSION = 1

/** 缓存上层结构：{ v, cachedAt, items } */
function readRaw() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || parsed.v !== VERSION || !Array.isArray(parsed.items)) return null
    return parsed
  } catch {
    return null
  }
}

/**
 * 读缓存。返回 null 表示"没有可用缓存"，调用方应直接走 IDB。
 * @returns {Array<object>|null}
 */
export function readIndexCache() {
  const parsed = readRaw()
  return parsed ? parsed.items : null
}

/**
 * 写缓存。失败静默 —— 缓存丢了大不了下次首屏慢一点。
 * @param {Array<object>} items 项目摘要数组
 */
export function writeIndexCache(items) {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({ v: VERSION, cachedAt: new Date().toISOString(), items: items ?? [] }),
    )
    return true
  } catch {
    // 配额满 / 隐私模式 / 被禁用
    return false
  }
}

export function clearIndexCache() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* 忽略 */
  }
}

/** 缓存是否可用（用于判断要不要显示"正在加载"） */
export function isCacheAvailable() {
  try {
    const probe = `${KEY}:probe`
    localStorage.setItem(probe, '1')
    localStorage.removeItem(probe)
    return true
  } catch {
    return false
  }
}
