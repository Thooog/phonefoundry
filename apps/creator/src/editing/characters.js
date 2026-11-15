

import {
  ACCOUNT_PLATFORMS,
  PLATFORM_SCHEMAS,
  createCharacter,
  createPlatformAccount,
} from '@phone-sim/shared'

/** 角色可被编辑的字段（白名单，避免把无关字段写进去） */
const CHARACTER_EDITABLE = ['name', 'description', 'avatarAssetId']

/**
 * 该角色在哪些平台还没有账号 —— 一个角色一个平台一个账号。
 *
 * @param {object} project
 * @param {string} characterId
 * @returns {string[]} 尚未配置的平台 id 列表
 */
export function availablePlatforms(project, characterId) {
  const used = new Set(
    (project?.platformAccounts ?? [])
      .filter((a) => a.characterId === characterId)
      .map((a) => a.platform),
  )
  return ACCOUNT_PLATFORMS.filter((p) => !used.has(p))
}

/**
 * 新建角色。
 *
 * @param {object} editor
 * @param {object} [overrides] 初始字段（如 name）
 * @returns {object} 新建的角色对象
 */
export function addCharacter(editor, overrides = {}) {
  const character = createCharacter(overrides)
  editor.mutate((draft) => {
    draft.characters = [...(draft.characters ?? []), character]
  })
  return character
}

/**
 * 修改角色字段（白名单）。
 *
 * @param {object} editor
 * @param {string} characterId
 * @param {object} patch
 * @returns {boolean} 是否真的改到了
 */
export function updateCharacter(editor, characterId, patch) {
  let changed = false
  editor.mutate((draft) => {
    const target = (draft.characters ?? []).find((c) => c.id === characterId)
    if (!target) return
    for (const key of CHARACTER_EDITABLE) {
      if (key in patch && patch[key] !== target[key]) {
        target[key] = patch[key]
        changed = true
      }
    }
    if (changed) target.updatedAt = new Date().toISOString()
  })
  return changed
}

/**
 * 删除角色 + 级联删除其全部平台账号。
 *
 * 注意：
 *   - 调用方必须先判断「是不是手机所属人」并拦截（所属人不能删，得先去设置改掉）。
 *     这里做了兜底：若删的是所属人，把 ownerCharacterId 置空，避免留一条悬空引用。
 *   - 孤儿资源（该角色独占的图片）的回收不在这里做 —— 调用方应在删除前用
 *     shared 的 analyzeCharacterRemoval 拿到 orphanAssetIds，删完再 editor.removeAssets。
 *     这样「删角色」和「清孤儿图」是两次独立的落盘，最坏情况落在「多占一点空间」
 *     而不是「内容指向已删资源」。
 *
 * @param {object} editor
 * @param {string} characterId
 * @returns {{removedAccounts: number}}
 */
export function removeCharacter(editor, characterId) {
  let removedAccounts = 0
  editor.mutate((draft) => {
    draft.characters = (draft.characters ?? []).filter((c) => c.id !== characterId)
    const before = (draft.platformAccounts ?? []).length
    draft.platformAccounts = (draft.platformAccounts ?? []).filter(
      (a) => a.characterId !== characterId,
    )
    removedAccounts = before - (draft.platformAccounts ?? []).length
    if (draft.workSettings?.ownerCharacterId === characterId) {
      draft.workSettings.ownerCharacterId = null
    }
  })
  return { removedAccounts }
}

export function addPlatformAccount(editor, characterId, platform, overrides = {}) {
  const existing = (editor.project?.platformAccounts ?? []).find(
    (a) => a.characterId === characterId && a.platform === platform,
  )
  if (existing) return existing

  const account = createPlatformAccount(characterId, platform, overrides)
  editor.mutate((draft) => {
    draft.platformAccounts = [...(draft.platformAccounts ?? []), account]
  })
  return account
}

/**
 * 修改平台账号字段。允许写的 key 由该平台的 PLATFORM_SCHEMAS 决定（动态白名单），
 * 其余字段（characterId / platform / id）不动。
 *
 * @param {object} editor
 * @param {string} accountId
 * @param {object} patch
 * @returns {boolean}
 */
export function updatePlatformAccount(editor, accountId, patch) {
  let changed = false
  editor.mutate((draft) => {
    const account = (draft.platformAccounts ?? []).find((a) => a.id === accountId)
    if (!account) return
    const schema = PLATFORM_SCHEMAS[account.platform]
    if (!schema) return
    const allowed = new Set(schema.fields.map((f) => f.key))
    for (const key of allowed) {
      if (key in patch && patch[key] !== account[key]) {
        account[key] = patch[key]
        changed = true
      }
    }
    // extraFields 是自由字段桶（如 X 的所在地 / 加入时间、各平台的粉丝 / 关注数），
    // 不在顶层白名单里，单独合并：只覆盖 patch 里带来的键，其余键原样保留。
    if ('extraFields' in patch) {
      const next = patch.extraFields ?? {}
      const merged = { ...(account.extraFields ?? {}), ...next }
      if (JSON.stringify(account.extraFields ?? {}) !== JSON.stringify(merged)) {
        account.extraFields = merged
        changed = true
      }
    }
  })
  return changed
}

/**
 * 删除平台账号。
 *
 * 仍有内容引用其 accountId 时不会崩：读取端 resolveAuthor / resolveIgAuthor 等
 * 会在账号缺失时优雅回退到角色或快照。调用方若想回收孤儿图，应先分析再 removeAssets。
 *
 * @param {object} editor
 * @param {string} accountId
 * @returns {boolean} 是否真的删到了
 */
export function removePlatformAccount(editor, accountId) {
  let removed = false
  editor.mutate((draft) => {
    const before = (draft.platformAccounts ?? []).length
    draft.platformAccounts = (draft.platformAccounts ?? []).filter((a) => a.id !== accountId)
    removed = (draft.platformAccounts ?? []).length < before
  })
  return removed
}
