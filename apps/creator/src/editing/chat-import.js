/**
 * 聊天族（信息 / KakaoTalk）**共用**的粘贴导入 —— 文本解析 + 时间推导。
 *
 * 为什么这两个应用要共用一份：
 *   粘贴模板是一套「写作者自己发明的微型语法」，它迭代过好几轮（圆括号 vs 连字符、
 *   发送时刻 vs 已读回执、未标注行的递进多少秒）。如果两个聊天应用各留一份实现，
 *   任何一次调整都要改两处，而改两处的地方迟早会忘记改。
 *
 *   这里只放**与具体应用无关**的部分：怎么把一行文本拆成结构与尾缀、
 *   怎么把缺席的时刻顺着上下文推出来。至于每条消息最终写进哪个桶、
 *   要不要采用已读回执 —— 那是各自 editing 层的事（见文件尾的说明）。
 *
 * 同 editing/*.js 一样：纯函数，不落盘，调用方拿结果自己决定怎么写。
 */

/** 没写时刻的行，比上一条晚多少毫秒。20 秒够表达「紧接着回的一句」，又不会全挤在同一分钟。 */
export const IMPORT_STEP_MS = 20 * 1000

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * 导入对话的解析结果。
 *
 * @typedef {object} ParsedLine
 * @property {number} index 原文行号（0 起）
 * @property {string} raw 原始行文本
 * @property {'character'|'unmatched'} speakerKind
 * @property {string|null} speakerName 原始写的人名
 * @property {string|null} characterId 解析出的角色 id（未识别为 null）
 * @property {string} content 消息正文
 * @property {string|null} sentTime 发送时刻 `HH:mm`（尾缀 `(HH:mm)`），没写则 null
 * @property {string|null} readAt 已读时刻 ISO（尾缀 `(HH:mm 已读)`），无则 null
 * @property {string|null} date 这行所属的日期 `YYYY-MM-DD`（由上面的日期行决定），没写日期行则 null
 */

export function parseConversationText(project, text) {
  const lines = String(text ?? '').split(/\r?\n/)
  const characters = project?.characters ?? []

  const parsed = []
  // 当前生效的日期。日期行是"状态行"，不产出消息，只改它。
  let currentDate = null
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue

    const date = parseDateLine(line)
    if (date) {
      currentDate = date
      continue
    }

    const parsedLine = parseOneLine(line, characters)
    if (parsedLine) parsed.push({ ...parsedLine, raw, date: currentDate })
  }
  return parsed
}

export function parseDateLine(text) {
  const s = String(text ?? '').trim()
  if (!s) return null

  const match =
    s.match(/^(\d{4})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{1,2})$/) ??
    s.match(/^(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日$/)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null

  const probe = new Date(year, month - 1, day)
  if (
    probe.getFullYear() !== year ||
    probe.getMonth() !== month - 1 ||
    probe.getDate() !== day
  ) {
    return null
  }

  const pad = (n) => String(n).padStart(2, '0')
  return `${year}-${pad(month)}-${pad(day)}`
}

/** 单行解析。返回 null 表示这行不是合法的「发送者：内容」结构（整行当垃圾跳过）。 */
function parseOneLine(line, characters) {
  const colon = line.indexOf(':')
  const fullColon = line.indexOf('：')
  const sepIndex = pickSeparator(colon, fullColon)
  if (sepIndex === -1) return null

  const speakerName = line.slice(0, sepIndex).trim()
  const rest = line.slice(sepIndex + 1)
  if (!speakerName) return null

  // 先剥尾缀。顺序不能反：一行可以同时写「(23:30)（23:31 已读）」，
  // 已读在最外层，先剥它剩下的才是发送时刻。
  const afterRead = splitReadSuffix(rest)
  const { content, sentTime } = splitTimeSuffix(afterRead.content)

  const characterId = resolveCharacterId(speakerName, characters)
  return {
    speakerKind: characterId ? 'character' : 'unmatched',
    speakerName,
    characterId,
    content,
    sentTime,
    readAt: afterRead.readAt,
  }
}

function pickSeparator(half, full) {
  if (half === -1) return full
  if (full === -1) return half
  return Math.min(half, full)
}

/**
 * 发送者名 → 角色 id。直接写角色名（不认「我」这个别名 —— 所属人也是角色，
 * 写他/她的名字即可，避免「我」在不同所属人下指代不明）。
 * 先精确匹配名字，再退「名字包含」匹配；都匹配不到返回 null（未识别）。
 */
function resolveCharacterId(name, characters) {
  const exact = characters.find((c) => c.name === name)
  if (exact) return exact.id

  const contains = characters.find((c) => String(c.name ?? '').includes(name))
  if (contains) return contains.id

  return null
}

/**
 * 拆尾缀已读标记 `(HH:mm 已读)` / `（HH:mm 已读）`。
 * 只认「以括号包住、内容是 HH:mm 已读」的精确形态，正文里的括号不会误伤。
 *
 * 注意：**解析归解析，用不用是调用方的事**。KakaoTalk 的作品端根本不读 readAt，
 * 但它同样能解析出这个字段，由 KakaoTalk 侧在写入时忽略 —— 语法层统一，语义层各异。
 */
function splitReadSuffix(rest) {
  const match = rest.match(/[（(]\s*(\d{1,2}:\d{1,2})\s*已读\s*[)）]\s*$/)
  if (!match) return { content: rest.trim(), readAt: null }

  const readAt = buildReadAt(match[1])
  // 同 splitTimeSuffix：时刻不合法时不剥，正文原样留下
  if (!readAt) return { content: rest.trim(), readAt: null }

  const content = rest.slice(0, match.index).trim()
  return { content, readAt }
}

/**
 * 拆尾缀发送时刻 `(HH:mm)` / `（HH:mm）`。
 * 只认「以括号包住、内容是一个 HH:mm」的精确形态，正文里的括号不会误伤。
 * 返回原始时刻串，不转成 Date —— 日期要由 resolveImportTimes 顺着上下文推断
 * （可能跨午夜），单行里定不下来。
 */
function splitTimeSuffix(rest) {
  const match = rest.match(/[（(]\s*(\d{1,2}:\d{1,2})\s*[)）]\s*$/)
  if (!match) return { content: rest.trim(), sentTime: null }

  const sentTime = normalizeHhmm(match[1])
  // 不是合法时刻（如 99:99）就当它没写：正文一个字都不能动，
  // 否则用户会发现自己写的「（99:99）」被静默吃掉了。
  if (!sentTime) return { content: rest.trim(), sentTime: null }

  const content = rest.slice(0, match.index).trim()
  return { content, sentTime }
}

/** `9:5` 这种也认，统一成 `09:05`；超出 23:59 的返回 null（交给调用方当没写） */
function normalizeHhmm(hhmm) {
  const [h, m] = hhmm.split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  if (h < 0 || h > 23 || m < 0 || m > 59) return null
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/**
 * `HH:mm` → 当天 ISO。日期取「现在」的日期 —— 已读回执上只打时刻，
 * 日期由消息本身的 displayTime 决定，这里先落一个占位日期，写入时再对齐。
 */
function buildReadAt(hhmm) {
  const safe = normalizeHhmm(hhmm)
  if (!safe) return null
  const [h, m] = safe.split(':').map(Number)
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m)
  return Number.isFinite(d.getTime()) ? d.toISOString() : null
}

/* ── 导入时间推导 ─────────────────────────────── */

/**
 * 把解析结果推演成每条消息的 displayTime（ISO 数组，与入参等长）。
 *
 * 对话里只有部分行写了时刻，剩下的要「顺着上下文往后推」：
 *   · 写了 `(HH:mm)` → 用这个时刻。
 *   · 没写 → 上一条的时间 + IMPORT_STEP_MS。
 *   · 第一条就没写 → 从「今天此刻」起算。
 *
 * 日期与跨午夜：HH:mm 里没有日期，**行里写了日期行**就用那天的日期（见 parseDateLine），
 * 没写日期行时第一次出现显式时刻落在今天、之后沿用同一天。
 *
 * 一旦某行的时刻**早于或等上一条**（如 23:50 → 00:10），说明聊过了午夜，往后顺延一天。
 * 不这么做的话，「23:50」后面那条「00:10」会被摆到同一天的凌晨，气泡上的时间看着是倒流的。
 * 第一行不参与这个判断 —— 它没有「上一条」可比，拿它跟基准时刻比会凭空多跨一天。
 * **有显式日期的行不参与顺延**：日期是写作者自己定的，比"猜跨天"可靠；
 * 块内真跨了天，就在下一行再写一次日期。
 *
 * 纯函数 —— 不依赖 Date.now() 之外的东西，`base` 可注入以便测试。
 *
 * @param {ParsedLine[]} lines parseConversationText 的结果
 * @param {{base?: number|Date, stepMs?: number}} [options]
 * @returns {string[]} 与 lines 等长的 ISO 时间串
 */
export function resolveImportTimes(lines, options = {}) {
  const base = options.base === undefined ? Date.now() : Number(new Date(options.base).getTime())
  const stepMs = options.stepMs ?? IMPORT_STEP_MS

  const list = Array.isArray(lines) ? lines : []
  let dayStart = startOfDay(base)
  let cursor = base
  let hasPrev = false

  return list.map((line) => {

    // 不重新把 cursor 拉回当天零点（否则块内没写时刻的行会互相覆盖）
    const date = typeof line?.date === 'string' ? line.date : null
    if (date !== null && startOfDayOfDate(date) !== dayStart) {
      dayStart = startOfDayOfDate(date)
      // 没写时刻的行要从"这一天"起算：cursor 至少推进到当天零点
      cursor = Math.max(cursor, dayStart)
    }

    if (line?.sentTime) {
      let ts = atClock(dayStart, line.sentTime)
      // 显式日期是权威，不做跨天顺延（同上）
      if (!date && hasPrev && ts <= cursor) {
        dayStart += DAY_MS
        ts = atClock(dayStart, line.sentTime)
      }
      cursor = ts
      hasPrev = true
      return new Date(ts).toISOString()
    }

    cursor += stepMs
    hasPrev = true
    return new Date(cursor).toISOString()
  })
}

/** `YYYY-MM-DD` → 那天零点的毫秒数（本地时区） */
function startOfDayOfDate(date) {
  const [y, m, d] = String(date).split('-').map(Number)
  return new Date(y, m - 1, d).getTime()
}

/** 某个时间点所在那天的零点（本地时区） */
function startOfDay(ms) {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** 把 `HH:mm` 落到 dayStart 那一天上 */
function atClock(dayStart, hhmm) {
  const safe = normalizeHhmm(hhmm)
  if (!safe) return null
  const [h, m] = safe.split(':').map(Number)
  return dayStart + h * 60 * 60 * 1000 + m * 60 * 1000
}
