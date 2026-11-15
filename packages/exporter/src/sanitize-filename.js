

/**
 * Windows 不允许出现在文件名里的字符（含 0x00-0x1F 控制字符）。
 *
 * 控制字符是**故意**写进正则的：它们正是这里要清掉的东西
 * （从旧的 macOS 文件、终端复制来的名字里就会带 \u001b 之类）。
 * 关掉 no-control-regex 是因为规则默认假设"你多半写错了"，
 * 而这里恰恰是要匹配它们。
 */
// eslint-disable-next-line no-control-regex -- 控制字符就是要匹配的目标，见上
const ILLEGAL_CHARS = /[\\/:*?"<>|\u0000-\u001f\u007f]/g

/** Windows 设备名，不区分大小写，带扩展名也算（`con.zip` 同样非法） */
const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

const MAX_NAME_LENGTH = 60

/**
 * 净化一段"给人看的名字"（作品名 / 项目名）。
 * @param {unknown} input
 * @param {string} [fallback] 净化后为空时使用
 * @returns {string}
 */
export function sanitizeFileName(input, fallback = '作品') {
  let name = String(input ?? '')
    // 控制字符与非法字符直接删掉，不替换成下划线 ——
    // 作品名里出现 `:` 的多半是「第1章：雨夜」，替换成 `_` 反而难读
    .replace(ILLEGAL_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim()
    // 开头的点会变成隐藏文件（macOS/Linux 上看不见）
    .replace(/^\.+/, '')
    // 结尾的点和空格会被 Windows 静默去掉
    .replace(/[. ]+$/, '')

  if (!name) name = fallback
  if (RESERVED_NAMES.test(name)) name = `_${name}`

  // 按码点截断，避免把 emoji 的代理对切成半个字符（那会得到乱码文件名）
  const points = Array.from(name)
  if (points.length > MAX_NAME_LENGTH) {
    name = points.slice(0, MAX_NAME_LENGTH).join('').replace(/[. ]+$/, '')
  }
  return name
}

/**
 * 本地日期戳 `YYYYMMDD`。
 * 用本地时间而不是 UTC：用户看到的"今天"是他的今天，不是伦敦的今天。
 * @param {Date} [date]
 */
export function dateStamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
}

/**
 * 作品文件名：`作品名_20261028.zip`
 * @param {string} title
 * @param {Date} [date]
 * @param {string} [ext]
 */
export function buildWorkFileName(title, date = new Date(), ext = 'zip') {
  return `${sanitizeFileName(title)}_${dateStamp(date)}.${ext}`
}

/**
 * 项目备份包文件名：`作品名_项目备份_20261028.zip`
 *
 * 中间那段 `_项目备份_` 是**给用户看的分类**，不是多余的字：
 * 作品包和备份包都会落在同一个下载目录里，两者外观都是 zip、名字都以日期结尾。
 * 少了这个标记，创作者很容易把备份包发给读者（对方解压出来没有 index.html，
 * 只会觉得"你发错了"），或者删掉唯一一份可继续编辑的源文件。
 *
 * @param {string} title
 * @param {Date} [date]
 */
export function buildBackupFileName(title, date = new Date()) {
  return `${sanitizeFileName(title)}_项目备份_${dateStamp(date)}.zip`
}

/**
 * 资源在 `assets/` 里的文件名：`assetId.webp`
 *
 * 为什么用 assetId 而不是原文件名：
 *  - 原文件名可能重名（两张都叫 `IMG_0001.jpg`），assetId 天然唯一
 *  - 原文件名可能带路径穿越（`../../evil.js`），assetId 是受控的短 id
 *  - 作品端 `asset-resolver.js` 在 folder 模式下按 `assetId + 扩展名` 兜底拼路径，
 *    两边保持一致才不需要额外的映射表
 *
 * 扩展名必须真实且正确：`file://` 下浏览器靠扩展名判断 MIME，
 * 给 webp 图起 `.jpg` 的名字在某些浏览器上会直接不显示。
 *
 * @param {string} assetId
 * @param {string} [mimeType]
 * @returns {string}
 */
export function assetFileName(assetId, mimeType = '') {
  const safe = String(assetId ?? '').replace(/[^a-zA-Z0-9_-]/g, '')
  // 净化后为空说明 assetId 全是特殊字符 —— 这种 id 不该存在，但要给一个可用结果
  const base = safe || 'asset'
  return `${base}.${extensionForMime(mimeType)}`
}

/** MIME → 扩展名；未知类型退回 `bin`，宁可浏览器嗅探失败也不编一个假扩展名 */
const MIME_EXTENSIONS = Object.freeze({
  'image/webp': 'webp',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
})

/**
 * @param {string} [mimeType]
 * @returns {string}
 */
export function extensionForMime(mimeType = '') {
  const key = String(mimeType).split(';')[0].trim().toLowerCase()
  return MIME_EXTENSIONS[key] ?? 'bin'
}
