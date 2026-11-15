

import { APPS } from '../constants/apps.js'

/**
 * 显式登记所有"指向资源"的字段路径。
 *
 * 路径语法：`容器.字段`，容器可以是：
 *   - 项目顶层数组名（characters / platformAccounts / assets）
 *   - appData 下某个应用的集合名（conversations / messages / ...）
 * 用 `*.` 前缀表示"任一应用桶里的某个集合"。
 */
const ASSET_FIELD_PATHS = Object.freeze([
  // 项目顶层
  ['characters', 'avatarAssetId'],
  ['platformAccounts', 'avatarAssetId'],
  // X 个人主页顶部的横幅。漏登记的后果是导出时不带这张图、整理资源时又把它当孤儿删掉
  ['platformAccounts', 'bannerAssetId'],
  // assets 自身的原图引用（保留原图时指向另一条 asset）
  ['assets', 'originalAssetId'],
  // 聊天类应用
  ['*', 'conversations', 'avatarAssetId'],
  ['*', 'messages', 'mediaAssetIds'],
  // 信息流类应用
  ['*', 'posts', 'mediaAssetIds'],
  ['*', 'comments', 'mediaAssetIds'],
  ['*', 'replies', 'mediaAssetIds'],
  // Instagram 故事：一条记录一帧，所以只有一个单值字段
  ['*', 'stories', 'imageAssetId'],
  // 电话
  ['*', 'contacts', 'avatarAssetId'],
  // 照片
  ['*', 'photos', 'imageAssetId'],
])

/** 项目级（非 appData）的单值资源字段，如壁纸 */
const WORK_SETTINGS_ASSET_PATHS = Object.freeze([
  ['wallpaper', 'assetId'],
])

/**
 * 去重后的字段名列表（仅字段名，不含容器），用于覆盖守护测试。
 * 同一字段可能出现在多个容器里（如 mediaAssetIds 同时用于 messages/posts/comments），
 * 因此必须去重 —— 否则"长度相等"这类断言会误报。
 */
export const REGISTERED_ASSET_FIELDS = Object.freeze([
  ...new Set(
    ASSET_FIELD_PATHS.flat()
      .concat(WORK_SETTINGS_ASSET_PATHS.flat())
      .filter((f) => /AssetIds?$/.test(f)),
  ),
])

/**
 * 收集项目内所有被引用的 assetId（不含 project.assets 自身）。
 *
 * @param {object} project
 * @returns {Set<string>} 被引用的 assetId 集合
 */
export function collectAssetRefs(project) {
  const refs = new Set()
  if (!project || typeof project !== 'object') return refs

  // 1. 项目顶层数组
  for (const [collection, field] of ASSET_FIELD_PATHS) {
    if (collection.startsWith('*')) continue
    for (const item of project[collection] ?? []) {
      addRef(refs, item?.[field])
    }
  }

  // 2. appData 各应用桶
  for (const app of APPS) {
    const bucket = project.appData?.[app.id] ?? {}
    for (const [scope, collection, field] of ASSET_FIELD_PATHS) {
      if (scope !== '*') continue
      for (const item of bucket[collection] ?? []) {
        addRef(refs, item?.[field])
      }
    }
  }

  // 3. workSettings（壁纸等）
  for (const [parent, field] of WORK_SETTINGS_ASSET_PATHS) {
    addRef(refs, project.workSettings?.[parent]?.[field])
  }

  return refs
}

function addRef(set, value) {
  if (Array.isArray(value)) {
    for (const v of value) addRef(set, v)
    return
  }
  if (typeof value !== 'string' || !value) return
  /**
   * 内联 dataURL 与外链不是"资源表里的 asset"：
   * 它们没有对应的 asset 记录，也就不可能变成孤儿，更不该触发
   * 「引用找不到文件」的警告。示例项目里的内联照片走的就是这条路。
   */
  if (/^(data:|blob:|https?:|\/\/)/.test(value)) return
  set.add(value)
}

/**
 * 找出项目资源表里"没有任何引用"的资源。
 *
 * 注意：返回的是候选孤儿，不应当直接删除 ——
 * 用户可能刚删了引用但还会撤销，因此调用方应结合 lastReferencedAt 判断。
 *
 * @param {object} project
 * @returns {Array<object>} 孤儿资源元信息数组
 */
export function findOrphanAssets(project) {
  const refs = collectAssetRefs(project)
  return (project?.assets ?? []).filter((a) => !refs.has(a.id))
}

export function analyzeCharacterRemoval(project, characterId) {
  const impact = {
    messages: 0,
    posts: 0,
    comments: 0,
    videos: 0,
    conversations: 0,
    events: 0,
    contacts: 0,
    isOwner: false,
    /** 该角色独占、删除后会变成孤儿的资源 */
    orphanAssetIds: [],
  }
  if (!project || !characterId) return impact

  const char = (project.characters ?? []).find((c) => c.id === characterId)
  impact.isOwner = project.workSettings?.ownerCharacterId === characterId

  for (const bucket of Object.values(project.appData ?? {})) {
    for (const m of bucket.messages ?? []) if (m.senderCharacterId === characterId) impact.messages += 1
    for (const p of bucket.posts ?? []) if (p.authorCharacterId === characterId) impact.posts += 1
    for (const c of [...(bucket.comments ?? []), ...(bucket.replies ?? [])]) {
      if (c.authorCharacterId === characterId) impact.comments += 1
    }
    for (const v of bucket.videos ?? []) if (v.channelCharacterId === characterId) impact.videos += 1
    for (const cv of bucket.conversations ?? []) {
      if ((cv.participantIds ?? []).includes(characterId)) impact.conversations += 1
    }
    for (const e of bucket.events ?? []) {
      if ((e.participantIds ?? []).includes(characterId)) impact.events += 1
    }
    for (const ct of bucket.contacts ?? []) if (ct.characterId === characterId) impact.contacts += 1
  }

  if (char) {
    const hypothetical = stripCharacter(project, characterId)
    impact.orphanAssetIds = findOrphanAssets(hypothetical).map((a) => a.id)
  }

  return impact
}

/**
 * 造一份"假设该角色已被删除"的项目副本（纯函数，不修改入参）。
 *
 * 只删角色条目是不够的：角色的帖子、消息、视频仍带着 mediaAssetIds，
 * 那些图就永远不会被判为孤儿，于是资源回收永远清不掉。
 * 所以必须把该角色产出的内容一起剔除，才能得到真实的"删除后"引用图景。
 *
 * @param {object} project
 * @param {string} characterId
 * @returns {object} 副本
 */
function stripCharacter(project, characterId) {
  const clone = structuredClone(project)
  clone.characters = (clone.characters ?? []).filter((c) => c.id !== characterId)
  clone.platformAccounts = (clone.platformAccounts ?? []).filter((a) => a.characterId !== characterId)

  const ownerCharacterId = clone.workSettings?.ownerCharacterId
  if (ownerCharacterId === characterId) clone.workSettings.ownerCharacterId = null

  const ownedAccountIds = new Set(
    (project.platformAccounts ?? []).filter((a) => a.characterId === characterId).map((a) => a.id),
  )
  const isMine = (x) =>
    x.authorCharacterId === characterId ||
    x.senderCharacterId === characterId ||
    x.channelCharacterId === characterId ||
    // 账号也被删了，该账号发的内容一并消失
    (x.authorAccountId && ownedAccountIds.has(x.authorAccountId)) ||
    (x.senderAccountId && ownedAccountIds.has(x.senderAccountId)) ||
    (x.accountId && ownedAccountIds.has(x.accountId))

  for (const bucket of Object.values(clone.appData ?? {})) {
    if (!bucket || typeof bucket !== 'object') continue
    /**
     * stories 也在剔除名单里：Instagram 故事是一帧一条记录（单值 imageAssetId），
     * 漏掉它的话，被删角色的故事图永远有人"引用"，孤儿判定就永远算不到它们，
     * 资源回收也就永远清不掉 —— 用户会看到项目体积不降反升。
     */
    for (const key of ['messages', 'posts', 'comments', 'replies', 'videos', 'stories']) {
      if (Array.isArray(bucket[key])) bucket[key] = bucket[key].filter((x) => !isMine(x))
    }
    if (Array.isArray(bucket.contacts)) {
      bucket.contacts = bucket.contacts.filter((ct) => ct.characterId !== characterId)
    }
    // 会话本身保留（对方视角还存在），只把参与者移除
    for (const conv of bucket.conversations ?? []) {
      if (Array.isArray(conv.participantIds)) {
        conv.participantIds = conv.participantIds.filter((id) => id !== characterId)
      }
    }
    for (const ev of bucket.events ?? []) {
      if (Array.isArray(ev.participantIds)) {
        ev.participantIds = ev.participantIds.filter((id) => id !== characterId)
      }
    }
  }

  return clone
}
