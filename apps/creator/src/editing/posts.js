/**
 * 帖子流应用的编辑操作 —— X 与 Instagram 共用。
 *
 * 两个应用的数据模型几乎是同一套：
 *   · 帖子 posts（作者 / 时间 / 正文 / 图片 / 指标）
 *   · 挂在帖子下的评论，X 叫 replies、Instagram 叫 comments
 * 差别只有桶名和"指标里有没有转推"，所以这里按 appId 参数化，
 * 而不是复制两份几乎一样的代码。
 *
 * 与其他 editing/*.js 同一套约定（见 photos.js 文件头）。
 *
 * 三个必须记住的点：
 *
 * 1. **作者要同时写 authorCharacterId 与 authorAccountId。**
 *    作品端的个人主页（「我的帖子」「我的回复」）是按 characterId 过滤的，
 *    只写账号 id 会让这些帖子在主页里消失；而显示名与 handle 又来自账号。
 *    两个都写才是完整的。
 *
 * 2. **删帖/删评论要连带删子级。**
 *    buildPostDetail 对"父级被删"的评论有个兜底：把它们接到列表末尾。
 *    那个兜底是给导入的残缺数据用的，不是给编辑操作用的 ——
 *    用户删掉一条回复，它的子回复却冒到最底下，读起来像幽灵。
 *
 * 3. **metrics.replies 是手填的展示数字，不等于实际回复条数。**
 *    这是刻意的：捡手机文学里"1.2万回复"本身就是叙事信息，
 *    让它跟着自己写的三条回复自动变成 3，等于毁掉这个字段。
 *
 * 4. **回复可以回一条回复，而且能一直套下去。**
 *    parentId 指向评论就是嵌套回复。数据层只是存 parentId，
 *    "谁在谁下面"由 commentThread 摊平成一维的（带 depth）阅读顺序 ——
 *    编辑器与作品端都按这个顺序渲染，两边看到的树是同一棵树。
 */

import { createComment, createPost } from '@phone-sim/shared'

/** 帖子正文上限。X 真机是 280，但作品里常要写成一段独白 */
export const POST_CONTENT_MAX_LENGTH = 1000

/** 评论/回复正文上限 */
export const COMMENT_CONTENT_MAX_LENGTH = 500

/**
 * 单条帖子最多带几张图 —— **按应用分开**。
 *
 * X 与 Instagram 的多图不设上限（作品端滑动带 / 轮播按任意张数渲染，
 * 不做网格折叠），用户想配几张配几张；其余应用仍只允许 1 张。
 */
export function mediaMaxOf(appId) {
  return appId === 'x' || appId === 'instagram' ? Infinity : 1
}

const nowIso = () => new Date().toISOString()

/** 评论桶的键：X 是 replies，Instagram 是 comments */
export function commentKeyOf(appId) {
  return appId === 'x' ? 'replies' : 'comments'
}

/** 指标字段。views 只有 X 有，Instagram 写了也不显示，所以按需取 */
export const METRIC_KEYS = Object.freeze(['likes', 'reposts', 'replies', 'views'])

function ensureBucket(project, appId) {
  if (!project.appData || typeof project.appData !== 'object') project.appData = {}
  const key = commentKeyOf(appId)

  if (!project.appData[appId]) project.appData[appId] = { posts: [], [key]: [] }

  const bucket = project.appData[appId]
  if (!Array.isArray(bucket.posts)) bucket.posts = []
  if (!Array.isArray(bucket[key])) bucket[key] = []
  return bucket
}

function timeOf(value) {
  const t = new Date(value ?? 0).getTime()
  return Number.isNaN(t) ? -Infinity : t
}

/** 帖子按时间倒序（新的在前），与作品端信息流一致 */
export function sortPostsByTime(posts) {
  return [...(posts ?? [])].sort((a, b) => timeOf(b.displayTime) - timeOf(a.displayTime))
}

/**
 * 某条帖子下的评论（含子级回复），按时间正序。
 *
 * 用"沿 parentId 往上走能不能走到这条帖子"来判断归属，
 * 与作品端 ownComments 的规则一致 —— 换一个判据就会出现
 * "编辑器里能删、作品端看不到"这种对不上的情况。
 */
export function commentsOf(project, appId, postId) {
  const bucket = project?.appData?.[appId] ?? {}
  const all = bucket[commentKeyOf(appId)] ?? []
  const postIds = new Set((bucket.posts ?? []).map((p) => p.id))
  const byId = new Map(all.map((c) => [c.id, c]))

  return all
    .filter((c) => {
      let cur = c
      const visited = new Set()
      while (cur.parentId && !postIds.has(cur.parentId)) {
        if (visited.has(cur.parentId)) return false
        visited.add(cur.parentId)
        const parent = byId.get(cur.parentId)
        if (!parent) return true // 父级被删：孤儿，仍算这条帖子的
        cur = parent
      }
      return cur.parentId === postId
    })
    .sort((a, b) => timeOf(a.displayTime) - timeOf(b.displayTime))
}

/**
 * 一条评论及其全部子级的 id。
 * 删除时用这个集合 —— 只删自己会把子级变成孤儿。
 */
function subtreeIds(allComments, rootId) {
  const ids = new Set([rootId])
  let grew = true
  // 数据量是几十条量级，迭代到收敛比递归建树更短也更好读
  while (grew) {
    grew = false
    for (const c of allComments) {
      if (!ids.has(c.id) && ids.has(c.parentId)) {
        ids.add(c.id)
        grew = true
      }
    }
  }
  return ids
}

/**
 * 帖子下的回复树，摊平成"一条对话连着看完"的顺序，并带上层级。
 *
 * 为什么不是直接平铺：X 的回复可以回一条回复，而且可以一直套下去。
 * 平铺列表里第 3 层和顶层看起来一模一样，用户根本不知道自己在回谁。
 * 所以每一项都带 depth（顶层 0），编辑器据此缩进并画竖线。
 *
 * 顺序与作品端 buildPostDetail 的 flattenThreads 一致：
 * 一条对话整条连着读完再看下一条，同层按时间正序。这样编辑器里看到的
 * 顺序就是读者看到的顺序，不需要在脑子里重排。
 *
 * @param {object} project
 * @param {string} appId
 * @param {string} postId
 * @returns {{node: object, depth: number}[]}
 */
export function commentThread(project, appId, postId) {
  const all = commentsOf(project, appId, postId)
  const ids = new Set(all.map((c) => c.id))

  // 父级不在本帖里（指向被删的评论、或干脆是野值）→ 当作顶层，
  // 与 commentsOf 的孤儿判定保持一致，否则这些回复会从编辑器里消失
  const byParent = new Map()
  for (const c of all) {
    const key = c.parentId && ids.has(c.parentId) ? c.parentId : postId
    if (!byParent.has(key)) byParent.set(key, [])
    byParent.get(key).push(c)
  }

  const out = []
  const seen = new Set()

  /** 父在前、子紧跟其后（同一层仍按时间正序） */
  const walk = (parentId, depth) => {
    for (const child of byParent.get(parentId) ?? []) {
      if (seen.has(child.id)) continue
      seen.add(child.id)
      out.push({ node: child, depth })
      walk(child.id, depth + 1)
    }
  }

  // 归一把"父级不在本帖"的评论挂到了 postId 下，所以从根出发
  // 一定能走完所有条目；成环的数据在 commentsOf 那一步就被排除了
  // （与作品端 ownComments 同一规则），这里不需要第二个兜底。
  walk(postId, 0)

  return out
}

/**
 * 一条回复下面还挂着多少条（不含自己）—— 删除确认框要说清会连带删几条。
 */
export function countRepliesUnder(project, appId, commentId) {
  const all = project?.appData?.[appId]?.[commentKeyOf(appId)] ?? []
  return subtreeIds(all, commentId).size - 1
}

/**
 * 作者字段：角色 + 该角色在这个平台的账号。
 *
 * 账号存在时 displayName / handle 从账号取（作品端 resolveAuthor 的规则），
 * 同时保留 characterId 让个人主页能过滤到它。
 *
 * @param {object} project
 * @param {string} appId
 * @param {string|null} characterId
 * @returns {{authorCharacterId: string|null, authorAccountId: string|null}}
 */
export function resolveAuthorFields(project, appId, characterId) {
  if (!characterId) return { authorCharacterId: null, authorAccountId: null }
  const account = (project?.platformAccounts ?? []).find(
    (a) => a && a.characterId === characterId && a.platform === appId,
  )
  return { authorCharacterId: characterId, authorAccountId: account?.id ?? null }
}

/** 指标归一化：负数和 NaN 归零，其余取整 */
function normalizeMetrics(input) {
  const out = {}
  for (const key of METRIC_KEYS) {
    if (input?.[key] === undefined) continue
    const n = Math.round(Number(input[key]) || 0)
    out[key] = n > 0 ? n : 0
  }
  return out
}

/** 图片 id 去重、去空；X / IG 不限张数，其余应用截到 1 张 */
function normalizeMedia(ids, appId) {
  return [...new Set((ids ?? []).filter(Boolean))].slice(0, mediaMaxOf(appId))
}

/* ── 帖子 ───────────────────────────────────────── */

const POST_EDITABLE = [
  'xPostTypes',
  'xRepostByCharacterIds',
  'xLikeByCharacterIds',
  'showInHome',
  'content',
  'displayTime',
  'metrics',
  'mediaAssetIds',
  'authorCharacterId',
  'authorAccountId',
]

/**
 * 新建帖子。
 *
 * @param {object} editor
 * @param {{app: string, content?: string, characterId?: string|null,
 *          displayTime?: string, mediaAssetIds?: string[], metrics?: object}} input
 * @returns {object} 新建的帖子记录
 */
export function addPost(editor, input) {
  const { app } = input
  if (!app) throw new Error('新建帖子必须指定应用。')

  const author = resolveAuthorFields(editor.project, app, input.characterId ?? null)
  const post = createPost(app, {
    content: String(input.content ?? '').slice(0, POST_CONTENT_MAX_LENGTH),
    mediaAssetIds: normalizeMedia(input.mediaAssetIds, app),
    metrics: { likes: 0, reposts: 0, replies: 0, views: 0, ...normalizeMetrics(input.metrics) },
    ...author,
    ...(input.displayTime ? { displayTime: input.displayTime } : {}),
  })

  editor.mutate((draft) => {
    const bucket = ensureBucket(draft, app)
    bucket.posts = [...bucket.posts, post]
  })

  return post
}

/**
 * 改帖子。
 *
 * @param {object} editor
 * @param {string} appId
 * @param {string} postId
 * @param {object} patch
 * @returns {object|null}
 */
export function updatePost(editor, appId, postId, patch) {
  const clean = {}
  for (const key of POST_EDITABLE) {
    if (patch?.[key] !== undefined) clean[key] = patch[key]
  }
  if (Object.keys(clean).length === 0) return null

  if (clean.content !== undefined) {
    clean.content = String(clean.content).slice(0, POST_CONTENT_MAX_LENGTH)
  }
  if (clean.mediaAssetIds !== undefined) {
    clean.mediaAssetIds = normalizeMedia(clean.mediaAssetIds, appId)
  }
  if (appId !== 'x') {
    delete clean.xPostTypes
    delete clean.xRepostByCharacterIds
    delete clean.xLikeByCharacterIds
    delete clean.showInHome
  } else {
    if (clean.xPostTypes !== undefined && (!Array.isArray(clean.xPostTypes) || clean.xPostTypes.some(type => !['repost', 'like'].includes(type)))) return null
    if (clean.showInHome !== undefined && typeof clean.showInHome !== 'boolean') return null
    for (const key of ['xRepostByCharacterIds', 'xLikeByCharacterIds']) {
      if (clean[key] !== undefined && (!Array.isArray(clean[key]) || clean[key].some(id => !(editor.project.characters ?? []).some(row => row.id === id)))) return null
      if (clean[key] !== undefined) clean[key] = [...new Set(clean[key])]
    }
    if (clean.xPostTypes !== undefined) {
      clean.xPostTypes = [...new Set(clean.xPostTypes)]
      if (!clean.xPostTypes.includes('repost')) clean.xRepostByCharacterIds = []
      if (!clean.xPostTypes.includes('like')) clean.xLikeByCharacterIds = []
      if (!clean.xPostTypes.length) { clean.xRepostByCharacterIds = []; clean.xLikeByCharacterIds = [] }
    }
  }
  const metricPatch = clean.metrics === undefined ? null : normalizeMetrics(clean.metrics)
  if (metricPatch) delete clean.metrics

  let updated = null
  editor.mutate((draft) => {
    const bucket = ensureBucket(draft, appId)
    bucket.posts = bucket.posts.map((post) => {
      if (post.id !== postId) return post
      // 指标要**合并**，不能整块替换：编辑端每次只改一个数字框，
      // 替换会把另外三项一起抹成 0 —— 用户改「赞」，转推和浏览全没了
      const nextMetrics = metricPatch ? { ...post.metrics, ...metricPatch } : post.metrics
      updated = { ...post, ...clean, metrics: nextMetrics, updatedAt: nowIso() }
      return updated
    })
  })

  return updated
}

/**
 * 删帖子，连带删掉它名下所有评论。
 *
 * @param {object} editor
 * @param {string} appId
 * @param {string} postId
 * @returns {{removed: boolean, removedComments: number}}
 */
export function deletePost(editor, appId, postId) {
  const doomed = commentsOf(editor.project, appId, postId).map((c) => c.id)
  const doomedSet = new Set(doomed)

  let removed = false
  let removedComments = 0

  editor.mutate((draft) => {
    const bucket = ensureBucket(draft, appId)

    const keptPosts = bucket.posts.filter((post) => post.id !== postId)
    removed = keptPosts.length !== bucket.posts.length
    bucket.posts = keptPosts

    const key = commentKeyOf(appId)
    const keptComments = bucket[key].filter((c) => !doomedSet.has(c.id))
    removedComments = bucket[key].length - keptComments.length
    bucket[key] = keptComments
  })

  return { removed, removedComments }
}

/* ── 评论 / 回复 ────────────────────────────────── */

const COMMENT_EDITABLE = [
  'content',
  'displayTime',
  'authorCharacterId',
  'authorAccountId',
  'parentId',
]

/**
 * 新建评论 / 回复。
 *
 * parentId 留空表示直接回这条帖子；给它一条评论的 id 就是"回这条评论"。
 *
 * @param {object} editor
 * @param {{app: string, postId: string, parentId?: string|null, content?: string,
 *          characterId?: string|null, displayTime?: string}} input
 * @returns {object} 新建的评论记录
 */
export function addComment(editor, input) {
  const { app, postId } = input
  if (!app || !postId) throw new Error('新建评论必须指定应用与帖子。')

  const author = resolveAuthorFields(editor.project, app, input.characterId ?? null)
  const comment = createComment(input.parentId || postId, {
    content: String(input.content ?? '').slice(0, COMMENT_CONTENT_MAX_LENGTH),
    ...author,
    ...(input.displayTime ? { displayTime: input.displayTime } : {}),
  })

  editor.mutate((draft) => {
    const bucket = ensureBucket(draft, app)
    const key = commentKeyOf(app)
    bucket[key] = [...bucket[key], comment]
  })

  return comment
}

/**
 * 改评论。
 * @param {object} editor
 * @param {string} appId
 * @param {string} commentId
 * @param {object} patch
 * @returns {object|null}
 */
export function updateComment(editor, appId, commentId, patch) {
  const clean = {}
  for (const key of COMMENT_EDITABLE) {
    if (patch?.[key] !== undefined) clean[key] = patch[key]
  }
  if (Object.keys(clean).length === 0) return null
  if (clean.content !== undefined) {
    clean.content = String(clean.content).slice(0, COMMENT_CONTENT_MAX_LENGTH)
  }

  let updated = null
  editor.mutate((draft) => {
    const bucket = ensureBucket(draft, appId)
    const key = commentKeyOf(appId)
    bucket[key] = bucket[key].map((c) => {
      if (c.id !== commentId) return c
      updated = { ...c, ...clean, updatedAt: nowIso() }
      return updated
    })
  })

  return updated
}

/**
 * 删评论，连带删掉它的全部子级回复。
 *
 * @param {object} editor
 * @param {string} appId
 * @param {string} commentId
 * @returns {{removed: boolean, removedComments: number}}
 */
export function deleteComment(editor, appId, commentId) {
  const key = commentKeyOf(appId)
  const all = editor.project?.appData?.[appId]?.[key] ?? []
  const doomedSet = subtreeIds(all, commentId)

  let removed = false
  let removedComments = 0

  editor.mutate((draft) => {
    const bucket = ensureBucket(draft, appId)
    const kept = bucket[key].filter((c) => !doomedSet.has(c.id))
    removedComments = bucket[key].length - kept.length
    removed = removedComments > 0
    bucket[key] = kept
  })

  return { removed, removedComments }
}

/* ── 资源 ───────────────────────────────────────── */

/**
 * 已经没有人引用的 assetId —— 判定与文档见 `editing/assets.js`。
 * 这里只做转发，保持既有 import 路径不变（XEditor 等调用方不用改）。
 */
export { orphanAssetIds } from './assets.js'

/**
 * 该帖子下有多少条评论 —— 删除确认框要说清楚会连带删掉多少。
 */
export function countCommentsOf(project, appId, postId) {
  return commentsOf(project, appId, postId).length
}
