/**
 * Instagram 的只读派生 —— 故事（Stories）托盘与个人主页。
 *
 * 为什么这两个放同一个文件：它们的作者解析规则完全一样（账号优先、角色兜底、
 * 删号后走 snapshot），拆成两个文件会让那段解析逻辑被抄两遍，然后慢慢漂移。
 * 同理不放进 select/feed.js —— feed 的派生对三个信息流应用通用，这里只服务 Instagram。
 *
 * 全部是纯函数，不碰 DOM、不缓存。已读状态是唯一的"外部输入"：
 * 作品端点开一帧只在内存里记，不写回作品数据（导出后的作品是只读的）。
 */

import { formatListTime } from '../time/format.js'
import { buildFeed, formatCount } from './feed.js'

/**
 * 解析一个 Instagram 作者。
 *
 * 账号优先于角色：同一个角色的 IG 资料和 KakaoTalk 资料是两套，
 * 头像/昵称都会不一样。账号被删了才退到角色，最后退到 snapshot。
 *
 * @returns {{accountId, characterId, name, handle, avatarAssetId, verified, link, bio, isDeleted}}
 */
export function resolveIgAuthor(work, { accountId = null, characterId = null, snapshot = null }) {
  const account = accountId
    ? (work?.platformAccounts ?? []).find((a) => a.id === accountId)
    : (work?.platformAccounts ?? []).find(
        (a) => a.characterId === characterId && a.platform === 'instagram',
      )
  const character = characterId
    ? (work?.characters ?? []).find((c) => c.id === characterId)
    : (account ? (work?.characters ?? []).find((c) => c.id === account.characterId) : null)

  const extra = account?.extraFields ?? {}

  if (account || character) {
    return {
      accountId: account?.id ?? null,
      characterId: account?.characterId ?? character?.id ?? null,
      name: account?.displayName || character?.name || snapshot?.displayName || '未知',
      handle: account?.handle ?? '',
      avatarAssetId: account?.avatarAssetId || character?.avatarAssetId || null,
      bio: account?.bio ?? '',
      verified: Boolean(extra.verified),
      link: String(extra.link ?? ''),
      displayName: account?.displayName ?? character?.name ?? '',
      isDeleted: false,
    }
  }

  return {
    accountId: null,
    characterId: null,
    name: snapshot?.displayName || '已删除用户',
    handle: snapshot?.handle ?? '',
    avatarAssetId: snapshot?.avatarAssetId ?? null,
    bio: '',
    verified: false,
    link: '',
    displayName: snapshot?.displayName ?? '',
    isDeleted: true,
  }
}

/**
 * 故事托盘：把扁平的 stories 记录按作者聚成"一组"。
 *
 * 排序规则（和真机一致）：
 *   1. 有未看帧的组排在前面 —— 托盘的字面意义就是"有哪些人发了新东西"；
 *   2. 同组内按剧情时间正序，播放从第一帧往后走；
 *   3. 组之间按最新一帧倒序。
 *
 * @param {object} work
 * @param {{timeFormat, storyDate, seenFrameIds: string[], ownerCharacterId: string}} options
 *   seenFrameIds 是本场播放中已经点开过的帧 id，不写回作品数据。
 */
export function buildStoryTray(work, options = {}) {
  const { timeFormat = 'h24', storyDate = null, seenFrameIds = [], ownerCharacterId = null } = options
  const rows = work?.appData?.instagram?.stories ?? []
  if (rows.length === 0) return []

  const watched = new Set(seenFrameIds)
  const grouped = new Map()

  const ordered = [...rows].sort((a, b) =>
    String(a.displayTime).localeCompare(String(b.displayTime)),
  )
  for (const row of ordered) {
    /**
     * 没有图的帧不进托盘。
     *
     * 真机上不存在"没有画面的故事"；而放进来之后，播放器里 <img src=""> 会画成
     * 一个破图方块。创作端允许先建帧再补图（用户可能正在一张张传），
     * 那么这些"半成品帧"就必须在派生层被过滤掉，而不是靠编辑端保证顺序。
     */
    if (!row.imageAssetId) continue
    const key = row.authorAccountId || row.authorCharacterId
    // 作者信息全空的一帧没法归组，也无处可放，直接跳过（也不该出现在托盘里）
    if (!key) continue
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key).push(row)
  }

  const groups = [...grouped.entries()].map(([key, frames]) => {
    const first = frames[0]
    const author = resolveIgAuthor(work, {
      accountId: first.authorAccountId,
      characterId: first.authorCharacterId,
      snapshot: first.snapshot,
    })
    const items = frames.map((f) => ({
      id: f.id,
      imageAssetId: f.imageAssetId ?? null,
      caption: f.caption ?? '',
      displayTime: f.displayTime,
      timeLabel: formatListTime(f.displayTime, { storyDate, timeFormat }),
      /** 数据里的预设已读 + 本场已经点开过 */
      seen: Boolean(f.seen) || watched.has(f.id),
    }))
    const firstUnseen = items.findIndex((i) => !i.seen)
    return {
      key,
      author,
      frames: items,
      /** 播放起点：第一帧未看的；全看过了就从 0 开始重播 */
      startIndex: firstUnseen === -1 ? 0 : firstUnseen,
      unseenCount: items.filter((i) => !i.seen).length,
      isOwner: Boolean(ownerCharacterId) && author.characterId === ownerCharacterId,
      latestTime: String(frames[frames.length - 1].displayTime ?? ''),
    }
  })

  return groups.sort((a, b) => {
    if (a.unseenCount > 0 !== b.unseenCount > 0) return a.unseenCount > 0 ? -1 : 1
    return b.latestTime.localeCompare(a.latestTime)
  })
}

/**
 * 个人主页。
 *
 * 自己的主页与别人的主页是同一套骨架、两套按钮：前者「编辑个人资料 / 分享个人资料」，
 * 后者「已关注 / 发消息 / 加好友」。按钮由 isOwner 决定，其余结构完全一致 ——
 * 所以只做一个数据出口，界面按 isOwner 分支。
 *
 * 统计数字的来源（这三项刻意不同）：
 *   · 帖子数  = 真实统计，作品里有几条就显示几条；
 *   · 粉丝/关注 = 只能来自作者填写的 extraFields（作品无法推导关注关系）；
 *   · 没填就不显示该数字，不补 0 —— 补 0 会变成一句谎话。
 *
 * @param {object} work
 * @param {{accountId, characterId, ownerCharacterId, timeFormat, storyDate, seenFrameIds}} options
 */
export function buildProfile(work, options = {}) {
  const {
    accountId = null,
    characterId = null,
    ownerCharacterId = null,
    timeFormat = 'h24',
    storyDate = null,
    seenFrameIds = [],
  } = options

  const author = resolveIgAuthor(work, { accountId, characterId })
  if (!author.characterId && !author.accountId) return null

  const isOwner = Boolean(ownerCharacterId) && author.characterId === ownerCharacterId

  const feed = buildFeed(work, 'instagram', { timeFormat, storyDate })
  const own = author.characterId
    ? feed.filter((p) => p.authorCharacterId === author.characterId)
    : []

  const extra =
    (work?.platformAccounts ?? []).find((a) => a.id === author.accountId)?.extraFields ?? {}

  /** 数字统一走 formatCount（1.2万 这种），和帖子里的赞数是同一个口径 */
  const stat = (value) => (value == null || value === '' ? '' : formatCount(Number(value) || 0))

  const authorKey = author.accountId || author.characterId
  const storyGroups = buildStoryTray(work, {
    timeFormat,
    storyDate,
    seenFrameIds,
    ownerCharacterId,
  }).filter((g) => g.key === authorKey)

  return {
    ...author,
    isOwner,
    stats: {
      posts: String(own.length),
      followers: stat(extra.followers),
      following: stat(extra.following),
    },
    /**
     * 九宫格单元。只取首图当封面，多图带角标 ——
     * 真机的格子里既不放轮播也不放视频，点进去才展开。
     */
    grid: own.map((p) => ({
      postId: p.id,
      coverAssetId: (p.mediaAssetIds ?? [])[0] ?? null,
      mediaCount: (p.mediaAssetIds ?? []).length,
    })),
    posts: own,
    storyGroups,
  }
}
