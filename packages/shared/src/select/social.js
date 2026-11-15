/**
 * 关注关系网 —— X / Instagram 共用（两个平台的关注列表语义完全一致，
 * 只是账号落在不同 platform 下，所以做成同一个派生而不是各抄一份）。
 *
 * 数据口径（与 platforms.js 的 schema 注释同源）：
 *   · 只存「关注」这一个方向：账号的 extraFields.followList 是角色 ID 数组，
 *     表示"这个账号关注了哪些角色"；
 *   · 粉丝（followers）永远由反向遍历算出 —— 谁的 followList 里有我，谁就是我的粉丝，
 *     不单独落盘，避免两份手工数据互相打架；
 *   · 粉丝数 / 关注数（extraFields.followers / following）是作者手填的展示数字，
 *     与真实关系列表是两件事：主页统计显示手填值，列表页显示真实关系，
 *     互不推导 —— 手填 5000 粉丝但列表只有 2 人是合法状态（真机也是这样）。
 *
 * 全部是纯函数，不碰 DOM、不缓存。
 */

/** 读出账号 followList 里干净的角色 ID（容错：不是字符串数组就当没填） */
export function followCharacterIds(account) {
  const raw = account?.extraFields?.followList
  if (!Array.isArray(raw)) return []
  return raw.filter((id) => typeof id === 'string' && id)
}

/** 列表行：账号优先于角色（同 IG 作者解析的口径），两边都没有的不出现 */
function resolveFollowRow(work, platform, characterId) {
  const character = (work?.characters ?? []).find((c) => c.id === characterId)
  const account = (work?.platformAccounts ?? []).find(
    (a) => a.characterId === characterId && a.platform === platform,
  )
  if (!character && !account) return null
  return {
    accountId: account?.id ?? null,
    characterId,
    name: account?.displayName || character?.name || '未知',
    handle: account?.handle ?? '',
    avatarAssetId: account?.avatarAssetId || character?.avatarAssetId || null,
  }
}

/**
 * 某平台账号的关注关系图。
 *
 * @param {object} work
 * @param {'x'|'instagram'} platform
 * @param {{accountId?: string|null, characterId?: string|null}} target
 *   accountId / characterId 二选一（与 resolveIgAuthor 的查找规则一致）。
 * @returns {{following: Array, followers: Array}} following = 它关注的人；
 *   followers = 反向遍历出的粉丝。已删除角色不出现在任一列表里。
 */
export function buildFollowGraph(work, platform, { accountId = null, characterId = null } = {}) {
  const accounts = work?.platformAccounts ?? []
  const account = accountId
    ? accounts.find((a) => a.id === accountId)
    : accounts.find((a) => a.characterId === characterId && a.platform === platform)
  if (!account) return { following: [], followers: [] }

  const selfId = account.characterId
  const following = followCharacterIds(account)
    .filter((id) => id !== selfId)
    .map((id) => resolveFollowRow(work, platform, id))
    .filter(Boolean)

  const followers = accounts
    .filter(
      (a) =>
        a.platform === platform &&
        a.characterId &&
        a.characterId !== selfId &&
        followCharacterIds(a).includes(selfId),
    )
    .map((a) => resolveFollowRow(work, platform, a.characterId))
    .filter(Boolean)

  return { following, followers }
}
