/**
 * 资产解析器。
 *
 * 作品端可能以两种方式拿到图片（对应三种导出形式的其中两种）：
 *  - folder：作品包解压后，图片是 assets/ 目录里的独立文件（相对路径引用）
 *  - inline：独立 HTML，图片是 dataURL 表（base64 内联）
 *  - preview：创作端预览，图片通过 postMessage 以 dataURL 传入
 *
 * 无论哪种，上层组件只调用 resolve(assetId)，拿不到就返回 null 由组件降级。
 */

/**
 * @param {{ mode: string, basePath?: string, assets?: Record<string,string> }} source
 * @returns {(assetId: string) => string|null}
 */
export function createAssetResolver(source) {
  const mode = source?.mode ?? 'empty'
  const assets = source?.assets ?? {}
  const basePath = normalizeBasePath(source?.basePath)

  if (mode === 'empty') {
    return () => null
  }

  return function resolve(assetId) {
    if (!assetId) return null
    if (typeof assetId !== 'string') return null

    // 已经是 URL 或 dataURL（旧数据、外部链接）直接透传
    if (isAbsolute(assetId)) return assetId

    if (mode === 'folder') {
      const hit = assets[assetId]
      // folder 模式下，assets 表存的是文件名；表里没有时按约定拼路径
      const fileName = hit || defaultFileName(assetId)
      return `${basePath}${fileName}`
    }

    // inline / preview：必须是 dataURL 表里的键
    return assets[assetId] ?? null
  }
}

function normalizeBasePath(basePath) {
  if (!basePath) return './assets/'
  const trimmed = basePath.trim()
  if (!trimmed) return './assets/'
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`
}

function isAbsolute(value) {
  return (
    value.startsWith('data:') ||
    value.startsWith('blob:') ||
    value.startsWith('http://') ||
    value.startsWith('https://') ||
    value.startsWith('//')
  )
}

/** folder 模式下的默认文件名：assetId + .webp（导出时会保证文件名与之一致） */
function defaultFileName(assetId) {
  const safe = assetId.replace(/[^a-zA-Z0-9_-]/g, '')
  return `${safe}.webp`
}
