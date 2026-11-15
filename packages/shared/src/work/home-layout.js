import { homeSchedules } from '../constants/home-schedule.js'
import { APPS, sortedApps } from '../constants/apps.js'
import { DECORATIVE_APPS } from '../constants/decorative-apps.js'

export const HOME_COLUMNS = 4
export const HOME_ROWS = 7
export const HOME_DOCK_IDS = ['phone', 'messages', 'kakaotalk', 'settings']
export const HOME_HTML_LIMIT = 256 * 1024
export const HOME_PRESETS = [
  { id: 'date', name: '日期' },
  { id: 'weather', name: '天气' },
  { id: 'note', name: '便签' },
  { id: 'clock', name: '时钟' },
]

const GRID_SIZE = HOME_COLUMNS * HOME_ROWS
// Dock can hold only four of the built-in apps. Reserve desktop cells for the rest.
const MAX_WIDGET_CELLS = GRID_SIZE - Math.max(0, APPS.length - HOME_COLUMNS)
export const DEFAULT_HOME_WIDGET_SIZE = '2x2'
export const HOME_WIDGET_SIZES = Array.from({ length: HOME_COLUMNS }, (_, index) => index + 1)
  .flatMap(columns => Array.from({ length: HOME_ROWS }, (_, index) => ({ columns, rows: index + 1 })))
  .filter(({ columns, rows }) => columns * rows <= MAX_WIDGET_CELLS)
  .map(size => ({ ...size, value: `${size.columns}x${size.rows}` }))
const widgetSizesByValue = new Map(HOME_WIDGET_SIZES.map(size => [size.value, size]))
const appsById = new Map(APPS.map(app => [app.id, app]))
const decorationsById = new Map(DECORATIVE_APPS.map(app => [app.id, app]))

export function homeAppDefinition(id) {
  return appsById.get(id) ?? decorationsById.get(id) ?? null
}

export function hasAppContent(work, appId) {
  const app = appsById.get(appId)
  if (!app) return false
  if (appId === 'settings') return true
  if (app.collections.some(key => Array.isArray(work?.appData?.[appId]?.[key]) && work.appData[appId][key].length)) return true
  const platform = appId === 'phone' ? 'messages' : appId
  return (work?.platformAccounts ?? []).some(account => account.platform === platform &&
    (work?.characters ?? []).some(character => character.id === account.characterId))
}

export function canRemoveHomeItem(work, item) {
  return Boolean(item && (item.kind !== 'app' || !hasAppContent(work, item.id)))
}

/** Reserve one free cell for every built-in icon currently removed. */
export function hasHomeRestoreCapacity(work, items) {
  const missing = visibleHomeApps(work).filter(app => !items.some(item => item.kind === 'app' && item.id === app.id)).length
  return items.reduce((sum, item) => sum + homeItemCells(item).length, 0) + missing <= GRID_SIZE + HOME_COLUMNS
}

export function visibleHomeApps(work) {
  const ownerId = work?.workSettings?.ownerCharacterId
  const hasOwner = Boolean(ownerId && work.characters?.some(character => character.id === ownerId))
  return sortedApps().filter(app => !app.requiresOwner || hasOwner)
}

export function homeItemName(item) {
  if (item.kind === 'app' || item.kind === 'decorative-app') return homeAppDefinition(item.id)?.name ?? ''
  if (item.kind === 'preset') return HOME_PRESETS.find(preset => preset.id === item.presetId)?.name ?? ''
  return item.name
}

export function isHomeWidget(item) {
  return item.kind === 'preset' || item.kind === 'html-widget'
}

export function homeItemSize(item) {
  if (!isHomeWidget(item)) return { columns: 1, rows: 1 }
  const size = item.kind === 'html-widget' ? item.size ?? DEFAULT_HOME_WIDGET_SIZE : DEFAULT_HOME_WIDGET_SIZE
  return widgetSizesByValue.get(size) ?? null
}

export function homeItemCells(item, area = item.area, slot = item.slot) {
  const widget = isHomeWidget(item)
  const size = area === 'dock' ? HOME_COLUMNS : GRID_SIZE
  if (!['grid', 'dock'].includes(area) || !Number.isInteger(slot) || slot < 0 || slot >= size) return []
  if (!widget) return [slot]
  const footprint = homeItemSize(item)
  if (area === 'dock' || !footprint) return []
  const { columns, rows } = footprint
  if (slot % HOME_COLUMNS + columns > HOME_COLUMNS || Math.floor(slot / HOME_COLUMNS) + rows > HOME_ROWS) return []
  return Array.from({ length: columns * rows }, (_, index) =>
    slot + Math.floor(index / columns) * HOME_COLUMNS + index % columns)
}

function occupants(items, area, cells, ignoredId) {
  return items.filter(item => item.area === area && item.id !== ignoredId &&
    homeItemCells(item).some(cell => cells.includes(cell)))
}

export function findHomeSpace(items, item, preferred = null) {
  function fits(area, slot) {
    const cells = homeItemCells(item, area, slot)
    return cells.length && !occupants(items, area, cells).length
  }
  if (preferred && fits(preferred.area, preferred.slot)) return { area: preferred.area, slot: preferred.slot }
  for (const area of ['grid', 'dock']) {
    const size = area === 'grid' ? GRID_SIZE : HOME_COLUMNS
    for (let slot = 0; slot < size; slot += 1) {
      if (fits(area, slot)) return { area, slot }
    }
  }
  return null
}

export function moveHomeItem(items, id, area, slot) {
  const item = items.find(entry => entry.id === id)
  if (!item || (item.area === area && item.slot === slot)) return { items }
  const cells = homeItemCells(item, area, slot)
  if (!cells.length) {
    if (isHomeWidget(item)) {
      const footprint = homeItemSize(item)
      if (!footprint) return { error: '小组件尺寸无效。' }
      const { columns, rows } = footprint
      return { error: area === 'dock' ? '小组件只能放在桌面网格。' : `小组件需要完整的 ${columns} × ${rows} 格。` }
    }
    return { error: '这个格位超出了桌面范围。' }
  }
  const [other] = occupants(items, area, cells, id)
  if (other && (isHomeWidget(item) || isHomeWidget(other))) return { error: '这个位置与小组件重叠。' }

  return {
    items: items.map(entry => {
      if (entry === item) return { ...item, area, slot }
      if (entry === other) return { ...other, area: item.area, slot: item.slot }
      return entry
    }),
  }
}

export function fitsHomeHtml(html) {
  return typeof html === 'string' && html.length <= HOME_HTML_LIMIT &&
    new TextEncoder().encode(html).length <= HOME_HTML_LIMIT
}

function readHomeItem(raw) {
  if (!raw || typeof raw.id !== 'string' || !/^[a-z0-9_-]{1,80}$/i.test(raw.id)) return null
  const { id, kind, area, slot } = raw
  const item = { id, kind, area, slot }
  if (kind === 'app') return appsById.has(id) ? item : null
  if (kind === 'decorative-app') return decorationsById.has(id) ? item : null
  if (homeAppDefinition(id)) return null
  if (kind === 'preset') return HOME_PRESETS.some(preset => preset.id === raw.presetId)
    ? { ...item, presetId: raw.presetId, ...(raw.content && typeof raw.content === 'object' ? { content: { schedules: homeSchedules(raw.content), ...Object.fromEntries(['title', 'value', 'detail', 'time', 'high', 'low', 'lunar'].filter(key => typeof raw.content[key] === 'string').map(key => [key, raw.content[key].slice(0, 500)])) } } : {}) }
    : null
  if (!['html-app', 'html-widget'].includes(kind) || !fitsHomeHtml(raw.html)) return null
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 30) : ''
  if (!name || !raw.html.trim()) return null
  if (kind === 'html-widget' && raw.size != null) {
    if (!widgetSizesByValue.has(raw.size)) return null
    if (raw.size === '1x1') return { ...item, kind: 'html-app', name, html: raw.html }
    return { ...item, name, html: raw.html, size: raw.size }
  }
  return { ...item, name, html: raw.html }
}

/** Validates stored or imported positions without compacting intentional gaps. */
export function normalizeHomeLayout(raw) {
  if (!Array.isArray(raw?.items)) return null
  const items = []
  for (const entry of raw.items) {
    if (items.length === GRID_SIZE + HOME_COLUMNS) break
    const item = readHomeItem(entry)
    if (!item || items.some(other => other.id === item.id)) continue
    const cells = homeItemCells(item)
    if (cells.length && !occupants(items, item.area, cells).length) items.push(item)
  }
  const removedItems = []
  for (const entry of Array.isArray(raw.removedItems) ? raw.removedItems : []) {
    const item = readHomeItem(entry)
    if (!item || !['app', 'decorative-app', 'html-app'].includes(item.kind) ||
      item.id === 'settings' || !homeItemCells(item).length ||
      items.some(other => other.id === item.id) || removedItems.some(other => other.id === item.id)) continue
    removedItems.push(item)
  }
  return items.length || removedItems.length ? { items, ...(removedItems.length && { removedItems }) } : null
}

export function resolveHomeLayout(work, stored = normalizeHomeLayout(work?.workSettings?.homeLayout)) {
  const apps = visibleHomeApps(work)
  const removedItems = [...(stored?.removedItems ?? [])]
  const items = stored?.items.filter(item => item.kind !== 'app' || apps.some(app => app.id === item.id)) ?? []
  let gridSlot = 0
  for (const { id } of apps) {
    const dockSlot = HOME_DOCK_IDS.indexOf(id)
    const item = dockSlot < 0
      ? { id, kind: 'app', area: 'grid', slot: gridSlot++ }
      : { id, kind: 'app', area: 'dock', slot: dockSlot }
    if (items.some(existing => existing.id === id)) continue
    const removed = removedItems.find(entry => entry.id === id)
    if (removed && !hasAppContent(work, id)) continue
    const available = findHomeSpace(items, item, removed ?? item)
    if (available) {
      items.push({ ...item, ...available })
      if (removed) removedItems.splice(removedItems.indexOf(removed), 1)
    }
  }
  return { items, ...(removedItems.length && { removedItems }) }
}

export function removeHomeItem(work, id) {
  const layout = resolveHomeLayout(work)
  const item = layout.items.find(entry => entry.id === id)
  if (!canRemoveHomeItem(work, item)) return { error: '有作品内容的应用和设置不能移除。' }
  const removedItems = [...(layout.removedItems ?? [])]
  if (['app', 'decorative-app', 'html-app'].includes(item.kind)) removedItems.push(item)
  return { items: layout.items.filter(entry => entry.id !== id), ...(removedItems.length && { removedItems }) }
}

/** Atomic batch import/restore; no partial changes when the desktop is full. */
export function importHomeApps(work, ids) {
  const layout = resolveHomeLayout(work)
  const items = [...layout.items]
  const removedItems = [...(layout.removedItems ?? [])]
  for (const id of new Set(ids)) {
    if (items.some(item => item.id === id)) continue
    const removed = removedItems.find(item => item.id === id)
    const item = removed ?? (decorationsById.has(id) ? { id, kind: 'decorative-app' } : null)
    if (!item) continue
    const position = findHomeSpace(items, item, removed)
    if (!position || !hasHomeRestoreCapacity(work, [...items, { ...item, ...position }])) {
      return { error: '空间不足，请减少选择或先腾出位置；需为已移除的内置应用保留恢复空间。' }
    }
    items.push({ ...item, ...position })
    if (removed) removedItems.splice(removedItems.indexOf(removed), 1)
  }
  return { items, ...(removedItems.length && { removedItems }) }
}


