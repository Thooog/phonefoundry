import { normalizeXPostState } from '../work/x-post-state.js'

import { formatListTime, formatXDetailTime } from '../time/format.js'
import { resolveAuthor } from './chat.js'

/** 数字格式化：12000 → 1.2万（中文语境用"万"比 K 自然） */
export function formatCount(n) {
  const num = Number(n) || 0
  if (num < 10000) return String(num)
  const wan = num / 10000
  return `${wan >= 100 ? Math.round(wan) : wan.toFixed(1).replace(/\.0$/, '')}万`
}

/**
 * X 的计数口径：真机 X 中文版不本地化单位 —— 1900 → 1.9K、18000 → 18K、196000 → 196K。
 * 与 IG 的「万」口径刻意不同（两个 app 各自忠实于真机），所以不并成一个函数。
 */
export function formatXCount(n) {
  const num = Number(n) || 0
  const trim = (v) => v.toFixed(1).replace(/\.0$/, '')
  if (num < 1000) return String(num)
  // 999,950 起四舍五入会变「1000K」，提前并入 M
  if (num >= 999950) return `${trim(num / 1e6)}M`
  if (num < 1e6) return `${trim(num / 1000)}K`
  return `${trim(num / 1e6)}M`
}

/**
 * 信息流。
 * @param {'instagram'|'x'} appId
 * @param {{ timeFormat, storyDate, ownerCharacterId }} options
 */
export function buildFeed(work, appId, options = {}) {
  const { timeFormat = 'h24', storyDate = null } = options
  const posts = work.appData?.[appId]?.posts ?? []
  // 计数口径按平台分：X 用 K/M，IG 用「万」
  const countOf = appId === 'x' ? formatXCount : formatCount

  return [...posts]
    .sort((a, b) => String(b.displayTime).localeCompare(String(a.displayTime)))
    .map((p) => {
      const author = resolveAuthor(work, {
        characterId: p.authorCharacterId,
        accountId: p.authorAccountId,
        snapshot: p.snapshot,
      })
      return {
        id: p.id,
        likedByOwner: appId === 'x' && Boolean((options.ownerCharacterId ?? work.workSettings?.ownerCharacterId) && ((normalizeXPostState(p).xLikeByCharacterIds).includes(options.ownerCharacterId ?? work.workSettings?.ownerCharacterId))),
        repostedByOwner: appId === 'x' && Boolean((options.ownerCharacterId ?? work.workSettings?.ownerCharacterId) && ((normalizeXPostState(p).xRepostByCharacterIds).includes(options.ownerCharacterId ?? work.workSettings?.ownerCharacterId))),
        ...(appId === 'x' ? {
          showInHome: p.showInHome !== false,
          xPostTypes: normalizeXPostState(p).xPostTypes,
          xRepostByCharacterIds: normalizeXPostState(p).xRepostByCharacterIds,
          xLikeByCharacterIds: normalizeXPostState(p).xLikeByCharacterIds,
        } : {}),
        // 个人主页要按作者过滤（只看"我发的"），没有这个字段就只能拿名字比对
        authorCharacterId: author.characterId,
        authorName: author.name,
        authorHandle: author.handle,
        authorAvatarAssetId: author.avatarAssetId,
        content: p.content ?? '',
        mediaAssetIds: p.mediaAssetIds ?? [],
        timeLabel: formatListTime(p.displayTime, { storyDate, timeFormat }),
        metrics: {
          likes: countOf(p.metrics?.likes),
          reposts: countOf(p.metrics?.reposts),
          replies: countOf(p.metrics?.replies),
          views: countOf(p.metrics?.views),
        },
        rawMetrics: p.metrics ?? {},
      }
    })
}

/**
 * 把评论/回复摊平成"按线程排好序"的一维数组。
 *
 * 为什么不是简单的 `filter(parentId === postId)`：X 的回复可以回一条回复，
 * 详情页里这些同一条对话是**用一条竖线串起来**的，只有不同对话之间才有分隔线。
 * 所以每一项都要带三个位置标记：
 *   · threadId     —— 属于哪条对话（顶层那条回复的 id）
 *   · threadStart  —— 是不是这条对话的第一条（决定要不要画分隔线）
 *   · threadEnd    —— 是不是最后一条（决定竖线画到这里为止）
 * 顺序按真机走：一条对话整条连着看完，再看下一条；同层按时间正序。
 */
function flattenThreads(raw, rootId) {
  const byParent = new Map()
  const ordered = [...raw].sort((a, b) =>
    String(a.displayTime).localeCompare(String(b.displayTime)),
  )
  for (const c of ordered) {
    const key = c.parentId ?? null
    if (!byParent.has(key)) byParent.set(key, [])
    byParent.get(key).push(c)
  }

  const out = []
  const seen = new Set()

  const push = (c, threadId) => {
    seen.add(c.id)
    out.push({ node: c, threadId })
  }

  /** 递归展开：父在前、子在后（同一层仍按时间正序） */
  const walk = (parentId, threadId) => {
    for (const child of byParent.get(parentId) ?? []) {
      if (seen.has(child.id)) continue
      push(child, threadId)
      walk(child.id, threadId)
    }
  }

  for (const root of byParent.get(rootId) ?? []) {
    if (seen.has(root.id)) continue
    push(root, root.id)
    walk(root.id, root.id)
  }

  // 兜底：父级被删掉的回复不能悄悄消失，当作一条独立对话接在最后
  for (const c of ordered) {
    if (seen.has(c.id)) continue
    push(c, c.id)
    walk(c.id, c.id)
  }

  return out.map((item, i) => ({
    node: item.node,
    threadId: item.threadId,
    threadStart: i === 0 || out[i - 1].threadId !== item.threadId,
    threadEnd: i === out.length - 1 || out[i + 1].threadId !== item.threadId,
  }))
}

/**
 * 只留"真正属于这个帖子"的评论。
 *
 * 为什么不能把整桶直接交给 flattenThreads：孤儿兜底会把"父级不存在"的评论
 * 接到任何帖子末尾 —— 但"父级是**另一篇帖子**"的评论父级同样不在展开路径上，
 * 会跨帖串门（X 时代全站只有一篇帖子在测，暴露不出来；Instagram 两篇就穿了）。
 * 规则：沿着 parentId 往上走，顶层挂在当前帖 → 属于；挂在别的帖子 → 排除；
 * 父级在桶里彻底不存在（被删）→ 保留，仍走兜底。
 */
function ownComments(raw, postId, postIds) {
  const byId = new Map(raw.map((c) => [c.id, c]))
  return raw.filter((c) => {
    let cur = c
    const visited = new Set()
    // parentId 命中任何帖子 id 即到顶；命中不了且桶里也没有 → 父级被删的孤儿
    while (cur.parentId && !postIds.has(cur.parentId)) {
      if (visited.has(cur.parentId)) return false // 防环：成环的数据不显示
      visited.add(cur.parentId)
      const parent = byId.get(cur.parentId)
      if (!parent) return true // 父级被删：孤儿，保留（接在末尾的兜底行为不变）
      cur = parent
    }
    return cur.parentId === postId
  })
}

/** 帖子详情：包含按"对话"排好序的评论/回复 */
export function buildPostDetail(work, appId, postId, options = {}) {
  const { timeFormat = 'h24', storyDate = null } = options
  const bucket = work.appData?.[appId] ?? {}
  const post = (bucket.posts ?? []).find((p) => p.id === postId)
  if (!post) return null

  const commentKey = appId === 'x' ? 'replies' : 'comments'
  const postIds = new Set((bucket.posts ?? []).map((p) => p.id))
  const comments = flattenThreads(ownComments(bucket[commentKey] ?? [], postId, postIds), postId).map(
    ({ node: c, threadId, threadStart, threadEnd }) => {
      const author = resolveAuthor(work, {
        characterId: c.authorCharacterId,
        accountId: c.authorAccountId,
        snapshot: c.snapshot,
      })
      return {
        id: c.id,
        // 详情页要用它判断「点回复者头像 → 进谁的主页」，缺了就只能退回「我」
        authorCharacterId: author.characterId,
        authorName: author.name,
        authorHandle: author.handle,
        authorAvatarAssetId: author.avatarAssetId,
        content: c.content ?? '',
        timeLabel: formatListTime(c.displayTime, { storyDate, timeFormat }),
        threadId,
        threadStart,
        threadEnd,
      }
    },
  )

  const author = resolveAuthor(work, {
    characterId: post.authorCharacterId,
    accountId: post.authorAccountId,
    snapshot: post.snapshot,
  })

  const countOf = appId === 'x' ? formatXCount : formatCount

  return {
    id: post.id,
    likedByOwner: appId === 'x' && Boolean((options.ownerCharacterId ?? work.workSettings?.ownerCharacterId) && (normalizeXPostState(post).xLikeByCharacterIds).includes(options.ownerCharacterId ?? work.workSettings?.ownerCharacterId)),
    repostedByOwner: appId === 'x' && Boolean((options.ownerCharacterId ?? work.workSettings?.ownerCharacterId) && (normalizeXPostState(post).xRepostByCharacterIds).includes(options.ownerCharacterId ?? work.workSettings?.ownerCharacterId)),
    authorCharacterId: author.characterId,
    authorName: author.name,
    authorHandle: author.handle,
    authorAvatarAssetId: author.avatarAssetId,
    content: post.content ?? '',
    mediaAssetIds: post.mediaAssetIds ?? [],
    // 详情 meta 行是"完整答案"：X 用全日期「26年11月13日, 17:42」，
    // 不像列表时间做今天/昨天折算；回复行仍走列表口径。
    timeLabel:
      appId === 'x'
        ? formatXDetailTime(post.displayTime, { timeFormat })
        : formatListTime(post.displayTime, { storyDate, timeFormat }),
    metrics: {
      likes: countOf(post.metrics?.likes),
      reposts: countOf(post.metrics?.reposts),
      replies: countOf(post.metrics?.replies),
      views: countOf(post.metrics?.views),
    },
    rawMetrics: post.metrics ?? {},
    comments,
  }
}
