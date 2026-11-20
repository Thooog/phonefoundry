/**
 * SourceProject → WorkData 的唯一裁剪器。
 *
 * 预览与导出必须共用这个函数，否则"预览所见"和"导出所得"会漂移。
 *
 * 输出保证：
 *   - 纯 JSON 可序列化（可安全 postMessage 结构化克隆）
 *   - 不含编辑态字段（draft / uiState / collapsed / 编辑器选中项）
 *   - 不含 Blob（二进制由 asset resolver 另行解析）
 *   - 不引用已不存在的实体时也不会崩（由读取端快照兜底）
 */

import { APPS } from '../constants/apps.js'
import { DEFAULT_WORK_SETTINGS, FRAME_MODE, SCHEMA_VERSION } from '../constants/defaults.js'
import { normalizeAppSettings } from './app-settings.js'
import { normalizeHomeLayout } from './home-layout.js'

/** 编辑端专用的字段，一律不进作品数据 */
const EDITOR_ONLY_KEYS = new Set([
  'editState',
  'uiState',
  'uiCollapsed',
  'draft',
  'isEditing',
  'lastEditedField',
  'editorScrollTop',
])

/**
 * @param {object} sourceProject
 * @returns {object} WorkData
 */
export function toWorkData(sourceProject) {
  if (!sourceProject || typeof sourceProject !== 'object') {
    throw new TypeError('toWorkData 需要传入项目对象。')
  }

  const workSettings = normalizeWorkSettings(sourceProject.workSettings)
  const characters = (sourceProject.characters ?? []).map(pickCharacter)
  const platformAccounts = (sourceProject.platformAccounts ?? []).map(pickAccount)
  const assets = (sourceProject.assets ?? []).map(pickAssetMeta)

  return {
    schemaVersion: sourceProject.schemaVersion ?? SCHEMA_VERSION,
    // 作品标题：优先手机名，其次项目名
    title: workSettings.phoneName || sourceProject.name || '作品',
    workSettings,
    characters,
    platformAccounts,
    assets,
    appData: pickAppData(sourceProject.appData),
  }
}

/** 作品设置补齐默认值，并丢弃不属于作品端的外观字段。 */
function normalizeWorkSettings(raw = {}) {
  const merged = { ...DEFAULT_WORK_SETTINGS, ...(raw ?? {}) }
  const homeLayout = normalizeHomeLayout(merged.homeLayout)
  return {
    phoneName: merged.phoneName ?? '',
    ownerCharacterId: merged.ownerCharacterId ?? null,
    wallpaper: {
      type: merged.wallpaper?.type ?? 'preset',
      presetId: merged.wallpaper?.presetId ?? 'gradient-dusk',
      assetId: merged.wallpaper?.assetId ?? null,
    },
    passcodeEnabled: Boolean(merged.passcodeEnabled),
    passcode: merged.passcodeEnabled ? String(merged.passcode ?? '') : '',
    passcodeLength: merged.passcodeLength === 6 ? 6 : 4,
    timeFormat: merged.timeFormat === 'h12' ? 'h12' : 'h24',
    storyDate: typeof merged.storyDate === 'string' ? merged.storyDate : null,
    appearance: { theme: 'light' },
    // 呈现方式：只认 always，其余一律按自适应 —— 旧项目没有这两个字段也照样跑
    frameMode: merged.frameMode === FRAME_MODE.ALWAYS ? FRAME_MODE.ALWAYS : FRAME_MODE.AUTO,
    autoFullscreen: Boolean(merged.autoFullscreen),
    // 「应用设定」：两把相簿锁（开关关闭时不带密码串）+ Wi-Fi 名
    appSettings: normalizeAppSettings(merged.appSettings),
    ...(homeLayout && { homeLayout }),
  }
}

function pickCharacter(c) {
  return {
    id: c.id,
    name: c.name ?? '',
    avatarAssetId: c.avatarAssetId ?? null,
  }
}

function pickAccount(a) {
  return {
    id: a.id,
    characterId: a.characterId ?? null,
    platform: a.platform,
    displayName: a.displayName ?? '',
    handle: a.handle ?? '',
    avatarAssetId: a.avatarAssetId ?? null,
    // X 个人主页顶部的横幅（3:1）。没上传时作品端退回默认灰渐变，
    // 所以这里保持 null 而不是给一个占位图。
    bannerAssetId: a.bannerAssetId ?? null,
    bio: a.bio ?? '',
    // 信息 / 电话账号的号码：通讯录派生联系人与「我的名片」详情页都要显示它。
    // PLATFORM_SCHEMAS.messages 里就有这一项，裁剪时漏掉会让创作者填的号码
    // 在作品端凭空消失（连详情的「呼叫」钮也跟着失效）。
    phoneNumber: a.phoneNumber ?? '',
    // 信息 / 电话账号的备注：通讯录派生联系人要显示它
    note: a.note ?? '',
    // 电子邮件：联系人详情里展示，没填则读取端整行不渲染
    email: a.email ?? '',
    extraFields: sanitizePlain(a.extraFields ?? {}),
  }
}

function pickAssetMeta(a) {
  return {
    id: a.id,
    kind: a.kind ?? 'image',
    fileName: a.fileName ?? '',
    mimeType: a.mimeType ?? 'image/webp',
    byteSize: a.byteSize ?? 0,
    width: a.width ?? 0,
    height: a.height ?? 0,
  }
}

function pickAppData(appData = {}) {
  const out = {}
  for (const app of APPS) {
    const bucket = appData[app.id] ?? {}
    const picked = {}
    for (const key of app.collections) {
      const list = Array.isArray(bucket[key]) ? bucket[key] : []
      picked[key] = list.map(stripEditorFields)
    }
    out[app.id] = picked
  }
  // settings 应用无数据，读取端只显示静态信息
  return out
}

/**
 * 递归剥掉编辑态字段。
 * 只处理普通对象与数组，遇到 Date 等保持原样（Date 可被结构化克隆）。
 */
function stripEditorFields(value) {
  if (Array.isArray(value)) return value.map(stripEditorFields)
  if (value && typeof value === 'object' && value.constructor === Object) {
    const out = {}
    for (const [k, v] of Object.entries(value)) {
      if (EDITOR_ONLY_KEYS.has(k)) continue
      // 值为 undefined 的键直接丢掉：undefined 不是 JSON 值，留着会让下游
      // assertPlain() 判死整份数据（旧版本复制/导入项目给每条回复补过
      // `mediaAssetIds: undefined`）。JSON.stringify 本来也会丢它，这里只是提前做。
      if (v === undefined) continue
      out[k] = stripEditorFields(v)
    }
    return out
  }
  return value
}

/** 只保留 JSON 可表示的值，避免函数/undefined 混进 extraFields */
function sanitizePlain(value) {
  try {
    return JSON.parse(JSON.stringify(value ?? {}))
  } catch {
    return {}
  }
}

export function assertPlain(value, path = 'work') {
  if (value === null) return
  const t = typeof value
  if (t === 'string' || t === 'number' || t === 'boolean') return
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertPlain(item, `${path}[${i}]`))
    return
  }
  if (t === 'object') {
    if (value instanceof Date) return
    const proto = Object.getPrototypeOf(value)
    if (proto !== Object.prototype && proto !== null) {
      throw new TypeError(`${path} 含有非纯对象（${proto?.constructor?.name ?? 'unknown'}），无法安全序列化。`)
    }
    for (const [k, v] of Object.entries(value)) {
      if (typeof v === 'function') throw new TypeError(`${path}.${k} 是函数，无法安全序列化。`)
      assertPlain(v, `${path}.${k}`)
    }
    return
  }
  throw new TypeError(`${path} 类型为 ${t}，无法安全序列化。`)
}

/** 便捷方法：转成空桶应用数据（读取端遇到缺失时用） */
export function emptyAppData() {
  const out = {}
  for (const app of APPS) {
    const bucket = {}
    for (const key of app.collections) bucket[key] = []
    out[app.id] = bucket
  }
  return out
}
