/**
 * Instagram「故事」的编辑操作 —— 纯函数，入参是 project store。
 *
 * 与其他 editing/*.js 同一套约定（见 photos.js 文件头）：
 *   · 只换引用，不原地改数组
 *   · 一次操作一次 mutate，revision 只涨一次
 *   · 可写字段走白名单，id 与 createdAt 不给改
 *
 * 这一层最容易被误解的一点：**一条 stories 记录 = 一帧，不是一个"故事组"**。
 * 同一个人发的三帧就是三条记录，分组由派生层按作者做（作品端
 * buildStoryTray、这里 storyGroups，两处规则一致）。所以本文件里没有
 * "新建一组"的操作 —— 编辑端能做的只有"再加一帧"。
 *
 * 为什么分组 key 用 `authorAccountId || authorCharacterId`：
 * 作品端托盘就是这么分的（select/instagram.js）。编辑器必须用同一个判据，
 * 否则会出现"编辑器里算一组、作品里是两组"这种对不上的情况 ——
 * 同一个角色的两帧，一帧只填了角色、一帧只填了账号，就会这样。所以
 * 写入时统一通过 resolveAuthorFields 把两个 id 一起写全，从源头上避免。
 */

import { createStory, findOrphanAssets } from '@phone-sim/shared'
import { resolveAuthorFields } from './posts.js'

const APP = 'instagram'

/**
 * 图上贴纸文字的上限。
 *
 * 真机的文字贴纸能贴很多，但一屏里能读的只有一句。200 字已经远超
 * 一屏的显示量，再长只会把画面糊掉 —— 而且作品端的说明区只有几行高。
 */
export const STORY_CAPTION_MAX_LENGTH = 200

const nowIso = () => new Date().toISOString()

function ensureBucket(project) {
  if (!project.appData || typeof project.appData !== 'object') project.appData = {}
  if (!project.appData[APP]) project.appData[APP] = { posts: [], comments: [], stories: [] }

  const bucket = project.appData[APP]
  if (!Array.isArray(bucket.stories)) bucket.stories = []
  return bucket
}

/** 可写字段白名单。id / createdAt 不给改 —— 换 id 应该走"删掉再新建" */
const STORY_EDITABLE = [
  'authorCharacterId',
  'authorAccountId',
  'imageAssetId',
  'caption',
  'displayTime',
  'seen',
]

function timeOf(value) {
  const t = new Date(value ?? 0).getTime()
  return Number.isNaN(t) ? -Infinity : t
}

/**
 * 全部帧，按剧情时间正序。
 *
 * 正序而不是倒序：故事是**按顺序播放**的（第 1 帧 → 第 2 帧），
 * 编辑时要能一眼看出播放顺序。这一点与帖子流相反，别照抄 posts.js。
 */
export function storiesOf(project) {
  const rows = project?.appData?.[APP]?.stories ?? []
  return [...rows].sort((a, b) => {
    const ta = timeOf(a.displayTime)
    const tb = timeOf(b.displayTime)
    if (ta !== tb) {
      // 时间读不出来的（脏数据）沉到最后，理由同 notes.js：
      // 否则它会以 -Infinity 的身份顶到"第一帧"去
      if (!Number.isFinite(ta)) return 1
      if (!Number.isFinite(tb)) return -1
      return ta - tb
    }
    // 时间相同（同一分钟批量导入很常见）时用 id 兜底，否则每次排序顺序都可能不同，
    // 列表位置会莫名跳动
    return String(a.id).localeCompare(String(b.id))
  })
}

/**
 * 按作者分组 —— 编辑器里"一列一组"，与作品端的托盘结构一一对应。
 *
 * 组间顺序：最新一帧倒序（刚发的人在最上面）。
 * 刻意**不做**作品端那种"有未看的组排前面"：那是播放语义，
 * 编辑时勾一下「预设已看」整组就会跳到别处，用户会以为点错了。
 *
 * 没有作者的帧归到 key 为 '' 的组，排最后。它们在作品端会被直接跳过
 * （buildStoryTray 里 `if (!key) continue`），编辑器要因此给一句提示，
 * 否则用户会疑惑"我明明加了帧，预览里却没有"。
 *
 * @returns {{key: string, characterId: string|null, accountId: string|null,
 *            name: string, handle: string, avatarAssetId: string|null,
 *            frames: object[], latestTime: string,
 *            seenCount: number, total: number}[]}
 */
export function storyGroups(project) {
  const rows = storiesOf(project)
  const byKey = new Map()

  for (const row of rows) {
    const key = row.authorAccountId || row.authorCharacterId || ''
    if (!byKey.has(key)) byKey.set(key, [])
    byKey.get(key).push(row)
  }

  const characters = project?.characters ?? []
  const accounts = project?.platformAccounts ?? []

  const groups = [...byKey.entries()].map(([key, frames]) => {
    const first = frames[0]
    const character = first.authorCharacterId
      ? characters.find((c) => c.id === first.authorCharacterId) ?? null
      : null
    const account = first.authorAccountId
      ? accounts.find((a) => a.id === first.authorAccountId) ?? null
      : null

    return {
      key,
      characterId: first.authorCharacterId ?? null,
      accountId: first.authorAccountId ?? null,
      name: account?.displayName || character?.name || '',
      handle: account?.handle ?? '',
      avatarAssetId: account?.avatarAssetId || character?.avatarAssetId || null,
      frames,
      latestTime: String(frames[frames.length - 1].displayTime ?? ''),
      seenCount: frames.filter((f) => Boolean(f.seen)).length,
      total: frames.length,
    }
  })

  return groups.sort((a, b) => {
    // 没有作者的那组永远在最后：它不是一个"人"，不该参与时间排序
    if ((a.key === '') !== (b.key === '')) return a.key === '' ? 1 : -1
    const diff = b.latestTime.localeCompare(a.latestTime)
    if (diff !== 0) return diff
    return a.key.localeCompare(b.key)
  })
}

/**
 * 新建一帧。
 *
 * imageAssetId 允许为空（用户可以先建帧、再补图），但空图的帧在作品里
 * 不会出现 —— 作品端托盘会跳过它。编辑器必须把这件事说出来，
 * 否则用户会以为"加了却看不到"是 bug。
 *
 * @param {object} editor
 * @param {{characterId?: string|null, imageAssetId?: string|null, caption?: string,
 *          displayTime?: string, seen?: boolean}} [input]
 * @returns {object} 新建的帧
 */
export function addStory(editor, input = {}) {
  const author = resolveAuthorFields(editor.project, APP, input.characterId ?? null)
  const story = createStory({
    ...author,
    imageAssetId: input.imageAssetId || null,
    caption: String(input.caption ?? '').slice(0, STORY_CAPTION_MAX_LENGTH),
    seen: Boolean(input.seen),
    ...(input.displayTime ? { displayTime: input.displayTime } : {}),
  })

  editor.mutate((draft) => {
    const bucket = ensureBucket(draft)
    bucket.stories = [...bucket.stories, story]
  })

  return story
}

/**
 * 改一帧。
 *
 * 传 authorCharacterId 时**重算 authorAccountId**：这两个字段必须成对出现
 * （见文件头），只改一半会让这一帧从原作者的组里掉出去，跑到"未指定"组。
 *
 * @param {object} editor
 * @param {string} storyId
 * @param {object} patch
 * @returns {object|null}
 */
export function updateStory(editor, storyId, patch) {
  const clean = {}
  for (const key of STORY_EDITABLE) {
    if (patch?.[key] !== undefined) clean[key] = patch[key]
  }
  if (Object.keys(clean).length === 0) return null

  if (clean.authorCharacterId !== undefined) {
    const resolved = resolveAuthorFields(editor.project, APP, clean.authorCharacterId || null)
    clean.authorCharacterId = resolved.authorCharacterId
    clean.authorAccountId = resolved.authorAccountId
  }
  if (clean.imageAssetId !== undefined) clean.imageAssetId = clean.imageAssetId || null
  if (clean.caption !== undefined) {
    clean.caption = String(clean.caption).slice(0, STORY_CAPTION_MAX_LENGTH)
  }
  if (clean.seen !== undefined) clean.seen = Boolean(clean.seen)

  let updated = null
  editor.mutate((draft) => {
    const bucket = ensureBucket(draft)
    bucket.stories = bucket.stories.map((story) => {
      if (story.id !== storyId) return story
      updated = { ...story, ...clean, updatedAt: nowIso() }
      return updated
    })
  })

  return updated
}

/**
 * 删一帧。
 *
 * 不在这里回收图片：调用方拿到结果后用 orphanAssetIds → removeAssets
 * 一次性回收（那是一次事务，比每删一帧清一次快）。
 *
 * @returns {{removed: boolean}}
 */
export function deleteStory(editor, storyId) {
  let removed = false
  editor.mutate((draft) => {
    const bucket = ensureBucket(draft)
    const kept = bucket.stories.filter((story) => story.id !== storyId)
    removed = kept.length !== bucket.stories.length
    bucket.stories = kept
  })
  return { removed }
}

/**
 * 当前项目里已经没人引用的资源 id。
 * 与 posts.js 的同名函数是同一件事（findOrphanAssets 是全项目扫描）。
 */
export function orphanAssetIds(project) {
  return findOrphanAssets(project).map((asset) => asset.id)
}

/** 这一组里有多少帧还没图 —— 编辑器用它决定要不要提醒 */
export function framesWithoutImage(group) {
  return (group?.frames ?? []).filter((f) => !f.imageAssetId).length
}
