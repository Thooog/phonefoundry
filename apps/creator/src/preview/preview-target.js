

import { getApp } from '@phone-sim/shared'

/** 路由 query 的键名，和作品端 phone:goto 的字段一一对应（entity ↔ entityId） */
export const PREVIEW_QUERY = { app: 'app', screen: 'screen', entity: 'entity' }

/**
 * query → 定位目标。
 * @param {Record<string, unknown> | null | undefined} query 路由 query（值可能是数组）
 * @returns {{ app: string, screen?: string, entityId?: string } | null}
 *   null 表示"没有可用的定位目标"，调用方应保持默认（从锁屏开始）
 */
export function parsePreviewTarget(query) {
  if (!query || typeof query !== 'object') return null

  const app = firstString(query[PREVIEW_QUERY.app])
  if (!app || !getApp(app)) return null

  const screen = firstString(query[PREVIEW_QUERY.screen])
  const entityId = firstString(query[PREVIEW_QUERY.entity])

  return {
    app,
    screen: screen || undefined,
    // 没有 screen 时 entity 无处安放，丢弃（见文件头）
    entityId: screen ? entityId || undefined : undefined,
  }
}

/**
 * 定位目标 → 路由 query。
 * 非法目标返回空对象 —— 调用方直接 spread 进 query 即可，不需要再判断。
 * @param {{ app?: string, screen?: string, entityId?: string } | null | undefined} target
 * @returns {Record<string, string>}
 */
export function buildPreviewQuery(target) {
  if (!target || typeof target !== 'object') return {}
  const app = firstString(target.app)
  if (!app || !getApp(app)) return {}

  const query = { [PREVIEW_QUERY.app]: app }
  const screen = firstString(target.screen)
  if (!screen) return query

  query[PREVIEW_QUERY.screen] = screen
  const entityId = firstString(target.entityId)
  if (entityId) query[PREVIEW_QUERY.entity] = entityId
  return query
}

/**
 * query 取值。
 * 同名参数出现两次时 vue-router 给的是数组，取第一个 —— 用户手拼 URL 时
 * `?app=notes&app=x` 不该让整条链路选择困难。
 */
function firstString(value) {
  const raw = Array.isArray(value) ? value[0] : value
  if (typeof raw !== 'string') return ''
  return raw.trim()
}
