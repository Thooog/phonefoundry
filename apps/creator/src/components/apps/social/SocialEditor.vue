<script setup>
/**
 * 「Instagram」编辑页 —— 帖子（多图 + 评论）+ 故事。
 *
 * 它与 X 共用大部分模型，但有三处是真的不一样，别照抄 XEditor：
 *
 * 1. **一条帖子可以带 4 张图。**
 *    X 的作品端只渲染第一张，所以那边只让选一张；Instagram 的
 *    CarouselMedia 是真轮播（左右滑、页码圆点、1/2 角标），所以这里
 *    开放到 4 张，并允许**调序** —— 第一张是封面，也是九宫格的缩略图，
 *    顺序本身是编辑决定，不能只让"后加的排后面"。
 *
 * 2. **评论桶叫 comments，而且有"故事"这一整套桶。**
 *    桶名差异由 editing/posts.js 的 commentKeyOf 处理，这里只需要传
 *    APP='instagram'。故事则是 Instagram 独有的集合，逻辑在 editing/stories.js。
 *
 * 3. **指标只有三个。**
 *    作品端 IG 卡片显示赞数（正文上方）、评论图标旁的评论数、转发图标旁的
 *    转发数；浏览数只有 X 有。多给一格「浏览」等于让用户填一个作品里
 *    永远看不见的数字 —— 所以这里只列三个。
 *
 * 故事的编辑方式（与帖子完全不同）：
 *    数据层一条记录 = 一帧，同一个人发的多帧就是多条记录，分组是派生的。
 *    所以编辑端没有"新建一组"，只有"再加一帧"；列表按作者分组，
 *    组内按时间正序 —— 那正是播放顺序，用户在编辑器里看到的顺序
 *    就是读者点开后一帧帧看下去的顺序。
 */
import { computed, ref, reactive, watch, inject, onMounted, onBeforeUnmount } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'
import { resolveAuthor, resolveIgAuthor } from '@phone-sim/shared'
import CommentThread from '../../workspace/CommentThread.vue'
import XSearchEditor from './XSearchEditor.vue'
import XPostStatusMenu from './XPostStatusMenu.vue'
import XPostText from '@player-ui/apps/x/XPostText.vue'

import AppButton from '../../ui/AppButton.vue'
import DeleteIconButton from '../../ui/DeleteIconButton.vue'
import AppUploadButton from '../../ui/AppUploadButton.vue'
import { useProjectStore } from '../../../stores/project.js'
import { useUiStore } from '../../../stores/ui.js'
import { useAssetUrls } from '../../../composables/use-asset-urls.js'
import { prepareImage } from '../../../media/compress-image.js'
import { fromDateTimeLocal, toDateTimeLocal } from '../../../utils/time.js'
import {
  POST_CONTENT_MAX_LENGTH,
  COMMENT_CONTENT_MAX_LENGTH,
  addComment,
  addPost,
  commentThread,
  commentsOf,
  countCommentsOf,
  countRepliesUnder,
  deleteComment,
  deletePost,
  orphanAssetIds,
  sortPostsByTime,
  updateComment,
  updatePost,
} from '../../../editing/posts.js'
import {
  STORY_CAPTION_MAX_LENGTH,
  addStory,
  deleteStory,
  framesWithoutImage,
  storyGroups,
  updateStory,
} from '../../../editing/stories.js'

const props = defineProps({ platform: { type: String, default: 'instagram', validator: value => ['instagram','x'].includes(value) } })
const APP = props.platform
const replyNoun = APP === 'x' ? '回复' : '评论'

/**
 * 作品端 IG 卡片真正显示的数字。
 * views 不在其中 —— 填了也看不见，所以不给这一格。
 */
const IG_METRIC_KEYS = APP === 'x' ? ['likes','replies','reposts','views'] : ['likes','replies','reposts']

/**
 * 标签刻意用两字「评论 / 转发」而不是三字「评论数 / 转发数」：
 * 窄屏的指标格只有 108px，三字在 12px 字号下占 36px、加上 6px 间隙，
 * 数字框就只剩 50px 出头。两字标签在两种视口下都还能横排成
 * 「标签 | 数字框」，与 X 编辑器的四格保持同一套读法。
 */
const METRIC_LABELS = {
  likes: '赞',
  replies: replyNoun,
  reposts: APP === 'x' ? '转推' : '转发',
  views: '浏览',
}

const editor = useProjectStore()
const ui = useUiStore()

const readOnly = computed(() => Boolean(editor.readOnlyReason))
const project = computed(() => editor.project)

const posts = computed(() => sortPostsByTime(project.value?.appData?.[APP]?.posts ?? []))

const characters = computed(() =>
  [...(project.value?.characters ?? [])].sort((a, b) =>
    String(a.name ?? '').localeCompare(String(b.name ?? ''), 'zh-Hans-CN'),
  ),
)

/** 作者下拉：角色 + 它在 Instagram 上的 handle（作品里显示的就是这个） */
const characterOptions = computed(() =>
  characters.value.map((ch) => {
    const account = (project.value?.platformAccounts ?? []).find(
      (a) => a && a.characterId === ch.id && a.platform === APP,
    )
    return { id: ch.id, name: ch.name, handle: account?.handle ?? '' }
  }),
)

/** 展开着评论区的帖子 id 集合 */
const expanded = ref(new Set())

/** 正在上传（或处理图片）的帖子 id / 帧 id —— 期间禁掉那一行的按钮 */
const uploadingId = ref(null)

/* ── 图片地址 ───────────────────────────────── */

/** 帖子的多图与故事的帧图共用一个地址池：两者都会在同一个页面里显示 */
const { urls } = useAssetUrls(editor, () => [
  ...characters.value.map(c => c.avatarAssetId),
  ...(project.value?.platformAccounts ?? []).filter(account => account.platform === APP).map(account => account.avatarAssetId),
  ...posts.value.flatMap((p) => p.mediaAssetIds ?? []),
  ...(project.value?.appData?.[APP]?.stories ?? []).map((s) => s.imageAssetId),
])

function urlOf(assetId) {
  return assetId ? (urls.value.get(assetId) ?? null) : null
}

/* ── 资源回收 ───────────────────────────────── */

/**
 * 回收已经没人引用的图片。
 *
 * 必须全项目扫描（findOrphanAssets），不能只算"这条帖子还剩几张"：
 * 同一张图可能同时被一条帖子和一帧故事引用，按当前帖子算会把别人还在用的删掉。
 */
async function reclaimAssets() {
  const ids = orphanAssetIds(editor.project)
  if (ids.length === 0) return
  await editor.removeAssets(ids)
}

/* ── 帖子 ───────────────────────────────────── */

function createPost() {
  if (readOnly.value) return
  const post = addPost(editor, {
    app: APP,
    characterId: characters.value[0]?.id ?? null,
    content: '',
  })
  selectedRecordId.value = post.id
  postDetailOpen.value = true
  requestAnimationFrame(() => {
    document.querySelector(`[data-post-id="${post.id}"]`)?.scrollIntoView({
      block: 'nearest',
      behavior: 'smooth',
    })
  })
}

function toggleXHome(post) {
  updatePost(editor, APP, post.id, { showInHome: post.showInHome === false })
}

function commitPostText(post, event) {
  updatePost(editor, APP, post.id, { content: event.target.value })
}

function commitPostTime(post, event) {
  const iso = fromDateTimeLocal(event.target.value)
  if (!iso) return
  updatePost(editor, APP, post.id, { displayTime: iso })
}

function commitAuthor(post, event) {
  updatePost(editor, APP, post.id, resolveAuthorPatch(event.target.value || null))
}

/**
 * 角色 → 作者字段。两个 id 必须一起写（见 editing/posts.js 文件头），
 * updatePost 只做字段白名单，不知道"选了角色要顺带找到该角色的 IG 账号"。
 */
function resolveAuthorPatch(characterId) {
  const account = (project.value?.platformAccounts ?? []).find(
    (a) => a && a.characterId === characterId && a.platform === APP,
  )
  return { authorCharacterId: characterId, authorAccountId: account?.id ?? null }
}

function commitMetric(post, key, event) {
  const n = Math.max(0, Math.round(Number(event.target.value) || 0))
  updatePost(editor, APP, post.id, { metrics: { [key]: n } })
}

async function removePost(post) {
  if (readOnly.value) return

  const commentCount = countCommentsOf(project.value, APP, post.id)
  const ok = await ui.confirm({
    title: '删掉这条帖子？',
    message: commentCount
      ? `它下面还有 ${commentCount} 条评论，会一起删掉。这个操作无法撤销。`
      : '这个操作无法撤销。',
    confirmText: '删除',
    tone: 'danger',
  })
  if (!ok) return

  const result = deletePost(editor, APP, post.id)
  expanded.value.delete(post.id)
  expanded.value = new Set(expanded.value)
  await reclaimAssets()

  ui.toast(
    result.removedComments
      ? `已删除帖子与 ${result.removedComments} 条评论`
      : '已删除帖子',
  )
}

/* ── 帖子的多图 ─────────────────────────────── */

/**
 * 给帖子加图（可一次选多张，张数不限）。
 *
 * 容量逻辑已删（X / IG 不限张数），但仍以 data 里的当前值为准追加，
 * 避免连点两下造成重复。
 *
 * 中途失败时把已经写进资源表的那几张回收掉 —— 它们还没有被任何内容引用，
 * 留着就是永远不会被清理的垃圾。
 */
async function addImages(post, files) {
  if (readOnly.value || uploadingId.value) return

  const list = Array.from(files ?? [])
  if (!list.length) return

  const current = post.mediaAssetIds ?? []

  uploadingId.value = post.id
  const added = []
  try {
    for (const file of list) {
      const prepared = await prepareImage(file)
      const meta = await editor.addAsset(prepared)
      added.push(meta.id)
    }
    updatePost(editor, APP, post.id, { mediaAssetIds: [...current, ...added] })

    ui.toast(`已添加 ${added.length} 张`, { tone: 'success' })
  } catch (err) {
    if (added.length) await reclaimAssets()
    ui.toast(err?.message ?? '这些图没能加上。', { tone: 'error' })
  } finally {
    uploadingId.value = null
  }
}

async function removeImage(post, assetId) {
  if (readOnly.value) return
  if (!(await ui.confirm({ title: '移除这张图片？', message: '图片将从这篇帖子中移除，其余图片和正文会保留。', confirmText: '移除', tone: 'danger' }))) return
  const next = (post.mediaAssetIds ?? []).filter((id) => id !== assetId)
  updatePost(editor, APP, post.id, { mediaAssetIds: next })
  selectedImage.value = null
  await reclaimAssets()
}

/**
 * 调序：第一张是封面（feed 首图 + 九宫格缩略图），所以顺序是编辑决定。
 * 用左右按钮而不是拖拽：这个列表在可滚动容器里，拖拽会和滚动打架，
 * 而四个元素的互换用不着那么重的交互。
 */
function moveImage(post, index, delta) {
  if (readOnly.value) return
  const ids = [...(post.mediaAssetIds ?? [])]
  const to = index + delta
  if (to < 0 || to >= ids.length) return
  ;[ids[index], ids[to]] = [ids[to], ids[index]]
  updatePost(editor, APP, post.id, { mediaAssetIds: ids })
}

/* ── 评论 ───────────────────────────────────── */

function commentsOfPost(postId) {
  return commentsOf(project.value, APP, postId)
}

function threadOf(postId) {
  return commentThread(project.value, APP, postId)
}

function toggleComments(postId) {
  if (expanded.value.has(postId)) expanded.value.delete(postId)
  else expanded.value.add(postId)
  expanded.value = new Set(expanded.value)
  if (expanded.value.has(postId)) scrollCommentInput(postId)
}

/** 新建后滚到它 —— 第三层的回复可能在视口外 */
function scrollCommentInput(postId) {
  requestAnimationFrame(() => {
    igRoot.value?.querySelector(`[data-post-id="${postId}"] .igcomment-composer`)?.scrollIntoView({block:'end',behavior:'auto'})
  })
}
function revealComment(commentId) {
  requestAnimationFrame(() => {
    document.querySelector(`[data-comment-id="${commentId}"]`)?.scrollIntoView({
      block: 'nearest',
      behavior: 'smooth',
    })
  })
}

const commentDrafts = reactive({})
const draftRegistry = inject('creator-drafts', null)
const draftKey = Symbol('ig-comments')
const hasCommentDrafts = computed(() => Object.values(commentDrafts).some(d => d.content))
draftRegistry?.set(draftKey, hasCommentDrafts)
onBeforeUnmount(() => draftRegistry?.delete(draftKey))
async function confirmLeavingComments() {
  return !hasCommentDrafts.value || await ui.confirm({ title: '还有未添加的评论', message: '离开此页会丢弃尚未添加的评论草稿。', confirmText: '丢弃并离开', cancelText: '继续编辑' })
}
onBeforeRouteLeave(confirmLeavingComments)
onBeforeRouteUpdate((to, from) => to.params.app === from.params.app || confirmLeavingComments())
watch(() => posts.value.map(p => p.id), ids => { for (const id of Object.keys(commentDrafts)) if (!ids.includes(id)) delete commentDrafts[id] })
function commentDraft(post) { return commentDrafts[post.id] ??= { author: post.authorCharacterId ?? characters.value[0]?.id ?? '', content: '' } }
function createComment(post) {
  const draft = commentDraft(post)
  if (readOnly.value || !draft.content.trim()) return
  const pane=igRoot.value?.querySelector('.igposts .record-workspace__detail')
  const followBottom=!pane || pane.scrollHeight-pane.scrollTop-pane.clientHeight<48
  try {
    const created = addComment(editor, { app: APP, postId: post.id, characterId: draft.author || null, content: draft.content })
    if (!created) throw new Error('无法添加评论')
    draft.content = ''
    if(followBottom) scrollCommentInput(post.id)
  } catch (error) { ui.toast(error.message || '添加评论失败', { tone: 'error' }) }
}
function commentAvatar(reply) { return urlOf(characters.value.find(c => c.id === reply.authorCharacterId)?.avatarAssetId) }
function commentTree(postId) {
  const flat = threadOf(postId)
  const nodes = new Map(flat.map(item => [item.node.id, { ...item, node: { ...item.node, localTime: toDateTimeLocal(item.node.displayTime) }, children: [] }]))
  const roots = []
  for (const item of nodes.values()) {
    const parent = nodes.get(item.node.parentId)
    if (parent && parent.depth < item.depth) parent.children.push(item)
    else roots.push(item)
  }
  return roots
}
function growComment(element) { element.style.height = 'auto'; element.style.height = `${element.scrollHeight + 2}px` }
const vAutoGrow = { mounted: growComment, updated: growComment }

/** 回一条评论。默认作者取被回复的人 —— 往复就是一人一句 */
function createReplyToComment(post, parent) {
  if (readOnly.value) return
  const author =
    parent.authorCharacterId ?? post.authorCharacterId ?? characters.value[0]?.id ?? null
  const created = addComment(editor, {
    app: APP,
    postId: post.id,
    parentId: parent.id,
    characterId: author,
    content: '',
  })
  expanded.value.add(post.id)
  expanded.value = new Set(expanded.value)
  revealComment(created.id)
}

function commitCommentText(comment, event) {
  updateComment(editor, APP, comment.id, { content: event.target.value })
}

function commitCommentTime(comment, event) {
  const iso = fromDateTimeLocal(event.target.value)
  if (!iso) return
  updateComment(editor, APP, comment.id, { displayTime: iso })
}

function commitCommentAuthor(comment, event) {
  updateComment(editor, APP, comment.id, resolveAuthorPatch(event.target.value || null))
}

async function removeComment(comment) {
  if (readOnly.value) return
  const under = countRepliesUnder(project.value, APP, comment.id)
  const ok = await ui.confirm({
    title: '删掉这条评论？',
    message: under
      ? `它下面还挂着 ${under} 条回复，会一起删掉。这个操作无法撤销。`
      : '这个操作无法撤销。',
    confirmText: '删除',
    tone: 'danger',
  })
  if (!ok) return

  const result = deleteComment(editor, APP, comment.id)
  ui.toast(
    result.removedComments > 1
      ? `已删除 ${result.removedComments} 条评论`
      : '已删除评论',
  )
}

/* ── 故事 ───────────────────────────────────── */

const groups = computed(() => storyGroups(project.value))

/** 故事帧总数（含没图的）—— 顶部计数用，让人一眼知道有没有内容 */
const frameCount = computed(() =>
  (project.value?.appData?.[APP]?.stories ?? []).length,
)

function createFrame() {
  if (readOnly.value) return
  const frame = addStory(editor, { characterId: activeGroup.value?.characterId ?? characters.value[0]?.id ?? null })
  activeStoryId.value = frame.id
  storyDetailOpen.value = true
  requestAnimationFrame(() => {
    document.querySelector(`[data-story-id="${frame.id}"]`)?.scrollIntoView({
      block: 'nearest',
      behavior: 'smooth',
    })
  })
}

async function uploadFrameImage(frame, files) {
  if (readOnly.value || uploadingId.value) return
  const file = files?.[0]
  if (!file) return

  uploadingId.value = frame.id
  const previous = frame.imageAssetId ?? null
  try {
    const prepared = await prepareImage(file)
    const meta = await editor.addAsset(prepared)
    updateStory(editor, frame.id, { imageAssetId: meta.id })
    if (previous) await reclaimAssets()
    ui.toast('这一帧的图片已更新', { tone: 'success' })
  } catch (err) {
    ui.toast(err?.message ?? '这张图没能加上。', { tone: 'error' })
  } finally {
    uploadingId.value = null
  }
}

async function removeFrameImage(frame) {
  if (readOnly.value) return
  if (!(await ui.confirm({ title: '移除这一帧的图片？', message: '贴纸文字等资料会保留；未配图的帧在作品中会被跳过。', confirmText: '移除', tone: 'danger' }))) return
  updateStory(editor, frame.id, { imageAssetId: null })
  await reclaimAssets()
}

function commitFrameCaption(frame, event) {
  updateStory(editor, frame.id, { caption: event.target.value })
}

function commitFrameTime(frame, event) {
  const iso = fromDateTimeLocal(event.target.value)
  if (!iso) return
  updateStory(editor, frame.id, { displayTime: iso })
}

function commitFrameAuthor(frame, event) {
  updateStory(editor, frame.id, { authorCharacterId: event.target.value || null })
}

function toggleSeen(frame, event) {
  updateStory(editor, frame.id, { seen: event.target.checked })
}

async function removeFrame(frame) {
  if (readOnly.value) return
  const ok = await ui.confirm({
    title: '删掉这一帧？',
    message: '故事是按帧播放的，删掉之后这一段就没有了。这个操作无法撤销。',
    confirmText: '删除',
    tone: 'danger',
  })
  if (!ok) return
  deleteStory(editor, frame.id)
  await reclaimAssets()
  ui.toast('已删除这一帧')
}

import RecordWorkspace from '../../../components/workspace/RecordWorkspace.vue'
import { useRecordSelection } from '../../../composables/use-record-selection.js'
const { selectedRecordId, visibleRecords } = useRecordSelection(posts)

/**
 * 图片网格「一行」能放几张。
 * 桌面端 5 列；卡片宽度 ≤540px 时 @container ig-content 会切成 2 列（长边窗口/窄侧栏都可能是这种宽度），
 * 所以列数不能写死，否则窄卡片下 4 张已经两行了还判成「一行内」。
 */
const mediaColumns = ref(5)

/** 选中帖子的图片超过一行 → 编辑页从固定高度布局切为整页可翻动 */
const mediaOverflow = computed(() => {
  const post = posts.value.find((p) => p.id === selectedRecordId.value)
  return (post?.mediaAssetIds?.length ?? 0) > mediaColumns.value
})
const recordItems = computed(() => posts.value.map(record => {
  const character = authorOf(record)
  const { authorAccountId, authorCharacterId, snapshot } = record
  const accountId = authorAccountId || (APP === 'x' && authorCharacterId
    ? project.value?.platformAccounts?.find(account => account?.characterId === authorCharacterId && account.platform === APP)?.id
    : undefined)
  const resolvePostAuthor = APP === 'instagram' ? resolveIgAuthor : resolveAuthor
  const author = authorAccountId || authorCharacterId || snapshot
    ? resolvePostAuthor(project.value, { accountId, characterId: authorCharacterId, snapshot })
    : null
  const authorName = author?.name || '未指定作者'
  const handle = author?.handle ? `@${author.handle}` : ''
  const date = shortDate(record.displayTime)
  return {
    id: record.id,
    title: record.content || '空白帖子',
    avatar: urlOf(record.mediaAssetIds?.[0]),
    initial: character?.name?.[0],
    authorName,
    handle,
    date,
    displayTime: record.displayTime,
    search: `${character?.name ?? ''} ${authorName} ${handle} ${date}`,
  }
}))
const instagramTab=ref('posts')
const xSearchEditor = ref(null)
const contentTabs = computed(() => APP === 'x' ? ['posts', 'trends', 'searchHistory'] : ['posts', 'stories', 'searchHistory'])
const xSearchCount = computed(() => (project.value?.appData?.[APP]?.[instagramTab.value] ?? []).length)
const postDetailOpen = ref(false)
const storyRecords=computed(()=>groups.value.flatMap(group=>group.frames))
const { selectedRecordId: activeStoryId }=useRecordSelection(storyRecords)

const igRoot = ref(null)
const selectedImage = ref(null)
const storyDetailOpen = ref(false)
const activeGroup = computed(() => groups.value.find(group => group.frames.some(frame => frame.id === activeStoryId.value)))
const activeFrames = computed(() => activeGroup.value?.frames.filter(frame => frame.id === activeStoryId.value) ?? [])
const groupItems = computed(() => groups.value.map(group => ({ id: group.key || 'unassigned', title: group.name || '未指定作者', group })))
const selectedGroupId = computed({
  get: () => activeGroup.value?.key || 'unassigned',
  set: key => { activeStoryId.value = groups.value.find(group => (group.key || 'unassigned') === key)?.frames[0]?.id ?? null },
})
function authorOf(record) { return characterOptions.value.find(ch => ch.id === record.authorCharacterId) }
function avatarOf(record) {
  const account = project.value?.platformAccounts?.find(a => a.id === record.authorAccountId)
  return urlOf(account?.avatarAssetId || characters.value.find(ch => ch.id === record.authorCharacterId)?.avatarAssetId)
}
function shortDate(value) { const date=toDateTimeLocal(value);return date ? `${Number(date.slice(5,7))}月${Number(date.slice(8,10))}日` : '未设置时间' }
function frameIndex(frame) { return (activeGroup.value?.frames.findIndex(item => item.id === frame.id) ?? 0) + 1 }
watch(selectedRecordId, () => { selectedImage.value=null;expanded.value=new Set() }, { immediate:true })
/** 卡片宽度跨过 540px（@container ig-content 的断点）时，网格列数 5 ↔ 2 */
function syncMediaColumns() {
  const card = igRoot.value?.querySelector('.igcard')
  mediaColumns.value = card && card.clientWidth <= 540 ? 2 : 5
}
watch([selectedRecordId, postDetailOpen, instagramTab], syncMediaColumns, { flush: 'post' })
function closeMenus(event) {
  if (!event.target.closest?.('.igmedia__item')) selectedImage.value = null
}
function tabsKey(event) {
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return
  event.preventDefault()
  const tabs = contentTabs.value
  const index = tabs.indexOf(instagramTab.value)
  instagramTab.value = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs.at(-1) : tabs[(index + (event.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length]
  requestAnimationFrame(()=>igRoot.value?.querySelector('.social-tabs [aria-selected="true"]')?.focus())
}
function cancelImage(event) {
  if(event.key !== 'Escape' || !selectedImage.value) return
  igRoot.value?.querySelector('.igmedia__select[aria-pressed=true]')?.focus({preventScroll:true})
  selectedImage.value=null
}
onMounted(()=>{document.addEventListener('pointerdown',closeMenus);document.addEventListener('keydown',cancelImage);window.addEventListener('resize',syncMediaColumns);syncMediaColumns()})
onBeforeUnmount(()=>{document.removeEventListener('pointerdown',closeMenus);document.removeEventListener('keydown',cancelImage);window.removeEventListener('resize',syncMediaColumns)})
</script>

<template>
  <section ref="igRoot" class="iged" :data-platform="APP" :data-story-detail="instagramTab === 'stories' && frameCount > 0 && storyDetailOpen" :data-post-detail="instagramTab === 'posts' && posts.length > 0 && postDetailOpen" :data-tab="instagramTab" :data-comments-open="expanded.has(selectedRecordId)" :data-has-comments="selectedRecordId ? commentsOfPost(selectedRecordId).length > 0 : false" :data-media-overflow="mediaOverflow" :data-testid="APP === 'x' ? 'x-editor' : 'ig-editor'">
    <header class="ig-page-head">
      <h1>{{ APP === 'x' ? 'X' : 'Instagram' }} <small>{{ instagramTab === 'posts' ? posts.length + ' 篇帖子' : instagramTab === 'searchHistory' || APP === 'x' ? xSearchCount + (instagramTab === 'trends' ? ' 条趋势' : ' 条搜索记录') : frameCount + ' 帧 Story' }}</small></h1>
      <AppButton v-if="instagramTab === 'posts'" variant="primary" :disabled="readOnly || !characterOptions.length" :data-testid="APP === 'x' ? 'x-post-add' : 'ig-post-add'" @click="createPost">新建帖子</AppButton>
      <AppButton v-else-if="instagramTab === 'searchHistory' || APP === 'x'" variant="primary" :disabled="readOnly" data-testid="x-search-add" @click="xSearchEditor?.add()">{{ instagramTab === 'trends' ? '新建趋势' : '添加搜索记录' }}</AppButton>
      <AppButton v-else variant="primary" :disabled="readOnly || !characterOptions.length" data-testid="ig-story-add" @click="createFrame">添加一帧</AppButton>
    </header>
    <nav class="social-tabs" role="tablist" :aria-label="APP === 'x' ? 'X 内容' : 'Instagram 内容'" @keydown="tabsKey">
      <button id="ig-post-tab" type="button" role="tab" :aria-selected="instagramTab === 'posts'" :tabindex="instagramTab === 'posts' ? 0 : -1" aria-controls="ig-post-panel" @click="instagramTab='posts'">帖子</button>
      <button v-if="APP === 'instagram'" id="ig-story-tab" type="button" role="tab" :aria-selected="instagramTab === 'stories'" :tabindex="instagramTab === 'stories' ? 0 : -1" aria-controls="ig-story-panel" @click="instagramTab='stories'">Story</button>
      <button v-for="tab in (APP === 'x' ? ['trends', 'searchHistory'] : ['searchHistory'])" :id="'x-' + tab + '-tab'" :key="tab" type="button" role="tab" :aria-selected="instagramTab === tab" :tabindex="instagramTab === tab ? 0 : -1" :aria-controls="'x-' + tab + '-panel'" @click="instagramTab = tab">{{ tab === 'trends' ? '趋势' : '搜索记录' }}</button>
    </nav>
    <XSearchEditor v-if="instagramTab === 'searchHistory' || (APP === 'x' && instagramTab === 'trends')" :id="'x-' + instagramTab + '-panel'" ref="xSearchEditor" :kind="instagramTab" :platform="APP" role="tabpanel" :aria-labelledby="'x-' + instagramTab + '-tab'" />
    <div v-show="instagramTab==='posts'" id="ig-post-panel" class="igposts" role="tabpanel" :aria-labelledby="APP === 'instagram' ? 'ig-post-tab' : undefined">
      <div v-if="!posts.length" class="ig-empty"><p>还没有帖子。</p><p>点击右上方的「新建帖子」，记录故事里的一个瞬间。</p><p v-if="!characters.length">先<RouterLink :to="{name:'characters',params:{projectId:project.id}}">添加人物</RouterLink>，再为帖子选择作者。</p></div>
      <RecordWorkspace v-else v-model="selectedRecordId" v-model:detail-open="postDetailOpen" :show-heading="false" title="帖子" search-placeholder="查找帖子" :records="recordItems">
        <template #record="{record}">
          <img v-if="record.avatar" class="ig-record-cover" :src="record.avatar" alt="" />
          <span v-else class="ig-record-cover ig-record-cover--empty" aria-hidden="true">{{ record.initial || '文' }}</span>
          <span class="ig-post-choice">
            <span class="ig-post-choice__header">
              <strong class="ig-post-choice__author">{{ record.authorName }}</strong>
              <span v-if="record.handle" class="ig-post-choice__handle">{{ record.handle }}</span>
              <time class="ig-post-choice__date" :datetime="record.displayTime || undefined">{{ record.date }}</time>
            </span>
            <span class="ig-post-choice__summary">{{ record.title }}</span>
          </span>
        </template>
        <template #default="{back}">
          <button type="button" class="ig-back" aria-label="返回帖子列表" @click="back"><span class="ig-back-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m14 6-6 6 6 6" /></svg></span> <span>帖子</span></button>
          <ul class="iged__list" :data-testid="APP === 'x' ? 'x-post-list' : 'ig-post-list'">
            <li v-for="post in visibleRecords" :key="post.id" class="igcard" :data-post-id="post.id" :data-testid="APP === 'x' ? 'x-post-row' : 'ig-post-row'">
              <header class="igcard__head">
                <span class="ig-avatar"><img v-if="avatarOf(post)" :src="avatarOf(post)" alt="" /><span v-else>{{ authorOf(post)?.name?.[0] || '人' }}</span></span>
                <label class="ig-author"><span class="sr-only">作者</span><select :value="post.authorCharacterId ?? ''" :disabled="readOnly" :data-testid="APP === 'x' ? 'x-post-author' : 'ig-post-author'" @change="commitAuthor(post,$event)"><option value="">未指定作者</option><option v-for="ch in characterOptions" :key="ch.id" :value="ch.id">{{ ch.name }}</option></select></label>
                <span class="ig-handle">{{ authorOf(post)?.handle ? '@'+authorOf(post).handle : '未设置用户名' }}</span>
                <div v-if="APP === 'x'" class="x-post-options">
                  <button type="button" class="x-post-visibility" :disabled="readOnly" :aria-pressed="post.showInHome !== false" :aria-label="post.showInHome === false ? '在首页展示' : '从首页隐藏'" :title="post.showInHome === false ? '首页已隐藏，点击展示' : '首页可见，点击隐藏'" data-testid="x-post-home-visibility" @click="toggleXHome(post)">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /><path v-if="post.showInHome === false" d="m3 3 18 18" /></svg>
                  </button>
                  <XPostStatusMenu :post="post" :characters="characterOptions" :disabled="readOnly" @patch="updatePost(editor, APP, post.id, $event)" />
                </div>
                <label class="ig-post-date"><span class="sr-only">发布时间</span><input type="datetime-local" :value="toDateTimeLocal(post.displayTime)" :disabled="readOnly" :data-testid="APP === 'x' ? 'x-post-time' : 'ig-post-time'" @change="commitPostTime(post,$event)" /></label>
                <DeleteIconButton class="ig-menu" label="删除帖子" :disabled="readOnly" :data-testid="APP === 'x' ? 'x-post-remove' : 'ig-post-remove'" @click="removePost(post)" />
              </header>
              <label class="ig-body"><span>正文</span><div class="ig-post-text-wrap"><div class="x-post-text-highlight" aria-hidden="true"><XPostText :text="post.content" :interactive="false" /></div><textarea v-auto-grow class="igcard__text x-post-text-input" :value="post.content" :maxlength="POST_CONTENT_MAX_LENGTH" :disabled="readOnly" rows="1" placeholder="写下这一刻……" :data-testid="APP === 'x' ? 'x-post-text' : 'ig-post-text'" @input="growComment($event.target); commitPostText(post,$event)" @change="commitPostText(post,$event)"></textarea></div></label>
              <section class="igcard__media" aria-label="帖子图片">
                <h2 class="ig-section-label">图片 <small>{{ post.mediaAssetIds?.length || 0 }} 张</small></h2>
                <ul class="igmedia" :data-testid="APP === 'x' ? 'x-media-list' : 'ig-media-list'">
                  <li v-for="(assetId,index) in post.mediaAssetIds" :key="assetId" class="igmedia__item" :data-testid="APP === 'x' ? 'x-media-item' : 'ig-media-item'">
                    <button type="button" class="igmedia__select" :aria-pressed="selectedImage===assetId" :aria-label="'选择第'+(index+1)+'张图片'" @click="selectedImage=assetId"><img v-if="urlOf(assetId)" :src="urlOf(assetId)" alt="" /><span v-else>图片暂不可用</span></button>
                    <div v-if="selectedImage===assetId" class="igmedia__overlay">
                      <div class="igmedia__image-actions" role="group" aria-label="图片操作">
                        <button type="button" :disabled="readOnly || index===0" aria-label="前移一位" title="前移一位" :data-testid="APP === 'x' ? 'x-media-up' : 'ig-media-up'" @click="moveImage(post,index,-1)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5m6-6-6 6 6 6" /></svg></button>
                        <button type="button" :disabled="readOnly || index===post.mediaAssetIds.length-1" aria-label="后移一位" title="后移一位" :data-testid="APP === 'x' ? 'x-media-down' : 'ig-media-down'" @click="moveImage(post,index,1)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" /></svg></button>
                        <button type="button" class="igmedia__remove" :disabled="readOnly" aria-label="移除图片" title="从帖子移除图片" :data-testid="APP === 'x' ? 'x-media-remove' : 'ig-media-remove'" @click="removeImage(post,assetId)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7" /></svg></button>
                      </div>
                    </div>
                  </li>
                  <li class="igmedia__add"><AppUploadButton :multiple="true" :disabled="readOnly || uploadingId===post.id" test-id="ig-post-image" @files="addImages(post,$event)"><span class="igmedia__plus" aria-hidden="true">＋</span><span>{{ uploadingId===post.id ? '处理中…' : '添加图片' }}</span></AppUploadButton></li>
                </ul>
              </section>
              <section class="ig-metrics" aria-label="互动数据"><div class="igcard__metrics" :data-testid="APP === 'x' ? 'x-post-metrics' : 'ig-post-metrics'"><label v-for="key in IG_METRIC_KEYS" :key="key"><span>{{ METRIC_LABELS[key] }}</span><input type="number" min="0" :value="post.metrics?.[key] ?? 0" :disabled="readOnly" :data-metric="key" :data-testid="(APP === 'x' ? 'x-metric-' : 'ig-metric-')+key" @change="commitMetric(post,key,$event)" /></label></div></section>
              <section class="igcard__comments">
                <button type="button" class="ig-section-label ig-comments-toggle" :aria-expanded="expanded.has(post.id)" :data-testid="APP === 'x' ? 'x-replies-toggle' : 'ig-comments-toggle'" @click="toggleComments(post.id)"><svg class="ig-comments-arrow" viewBox="0 0 12 12" width="10" height="10" fill="currentColor" aria-hidden="true"><path d="M4 2 10 6 4 10z" /></svg>{{ replyNoun }} <small>{{ commentsOfPost(post.id).length }}</small></button>
                <template v-if="expanded.has(post.id)">
                  <CommentThread v-if="threadOf(post.id).length" compact class="igcomments" :data-testid="APP === 'x' ? 'x-reply-list' : 'ig-comment-list'" :test-prefix="APP === 'x' ? 'x-reply' : 'ig-comment'" :noun="replyNoun" :items="commentTree(post.id)" :characters="characterOptions" :avatar="commentAvatar" :read-only="readOnly" :max-length="COMMENT_CONTENT_MAX_LENGTH" @author-change="commitCommentAuthor($event.reply,$event.event)" @time-change="commitCommentTime($event.reply,$event.event)" @text-change="commitCommentText($event.reply,$event.event)" @reply="createReplyToComment(post,$event)" @remove="removeComment" />
                  <p v-else class="igcomments__empty">还没有{{ replyNoun }}。</p>
                  <form class="igcomment-composer" aria-label="添加评论" @submit.prevent="createComment(post)"><label><span class="sr-only">评论作者</span><select v-model="commentDraft(post).author" :disabled="readOnly" :data-testid="APP === 'x' ? 'x-reply-draft-author' : 'ig-comment-draft-author'"><option value="">未指定</option><option v-for="ch in characterOptions" :key="ch.id" :value="ch.id">{{ ch.name }}</option></select></label><textarea v-model="commentDraft(post).content" v-auto-grow :maxlength="COMMENT_CONTENT_MAX_LENGTH" :disabled="readOnly" rows="1" aria-label="新评论正文" :placeholder="'写一条'+replyNoun+'……'" :data-testid="APP === 'x' ? 'x-reply-draft' : 'ig-comment-draft'" @input="growComment($event.target)"></textarea><AppButton native-type="submit" :disabled="readOnly || !commentDraft(post).content.trim()" :data-testid="APP === 'x' ? 'x-reply-add' : 'ig-comment-add'">添加{{ replyNoun }}</AppButton></form>
                </template>
              </section>
            </li>
          </ul>
        </template>
      </RecordWorkspace>
    </div>
    <section v-if="APP === 'instagram'" v-show="instagramTab==='stories'" id="ig-story-panel" class="igstories" role="tabpanel" aria-labelledby="ig-story-tab" :data-testid="APP === 'x' ? 'x-stories' : 'ig-stories'">
      <div v-if="!frameCount" class="ig-empty" :data-testid="APP === 'x' ? 'x-story-empty' : 'ig-story-empty'"><p>还没有 Story。</p><p>点击右上方的「添加一帧」，让故事继续。</p><p v-if="!characters.length">先<RouterLink :to="{name:'characters',params:{projectId:project.id}}">添加人物</RouterLink>，再选择作者。</p></div>
      <RecordWorkspace v-else v-model="selectedGroupId" v-model:detail-open="storyDetailOpen" class="ig-story-workspace" :show-heading="false" title="人物" :records="groupItems">
        <template #record="{record}"><span class="ig-avatar"><img v-if="urlOf(record.group.avatarAssetId)" :src="urlOf(record.group.avatarAssetId)" alt="" /><span v-else>{{ record.title[0] }}</span></span><span class="ig-record-copy"><strong>{{ record.title }} <em>{{ record.group.handle ? '@'+record.group.handle : '' }}</em></strong><small>{{ record.group.total }} 帧 · 预设已看 {{ record.group.seenCount }}</small></span></template>
        <template #default="{back}">
          <button type="button" class="ig-back" aria-label="返回人物分组" @click="back"><span class="ig-back-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m14 6-6 6 6 6" /></svg></span> <span>人物分组</span></button>
          <section v-if="activeGroup" class="iggroup" :data-testid="APP === 'x' ? 'x-story-group' : 'ig-story-group'">
            <header class="iggroup__head"><span class="ig-avatar"><img v-if="urlOf(activeGroup.avatarAssetId)" :src="urlOf(activeGroup.avatarAssetId)" alt="" /><span v-else>{{ activeGroup.name?.[0] || '人' }}</span></span><label class="ig-author"><span class="sr-only">当前帧作者</span><select :value="activeFrames[0]?.authorCharacterId ?? ''" :disabled="readOnly || !activeFrames.length" @change="activeFrames[0] && commitFrameAuthor(activeFrames[0],$event)"><option value="">未指定作者</option><option v-for="ch in characterOptions" :key="ch.id" :value="ch.id">{{ ch.name }}</option></select></label><span class="ig-handle">{{ activeGroup.handle ? '@'+activeGroup.handle+' · ' : '' }}{{ activeGroup.total }} 帧</span><button type="button" class="ig-story-add-icon" aria-label="添加一帧" title="添加一帧" :disabled="readOnly || !characters.length" @click="createFrame"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M12 4v16M4 12h16" /></svg></button></header>
            <p v-if="!activeGroup.key" class="ig-warn" :data-testid="APP === 'x' ? 'x-story-noauthor' : 'ig-story-noauthor'">请选择作者，这组 Story 才会出现在作品中。</p><p v-else-if="framesWithoutImage(activeGroup)" class="ig-warn" :data-testid="APP === 'x' ? 'x-story-noimage' : 'ig-story-noimage'">{{ framesWithoutImage(activeGroup) }} 帧尚未配图，作品中会跳过这些帧。</p>
            <section class="ig-playback"><div class="ig-playback__head"><h2 class="ig-section-label">播放顺序</h2><span>按发布时间顺序播放</span></div><div class="story-directory"><button v-for="(frame,index) in activeGroup.frames" :key="frame.id" type="button" :aria-pressed="activeStoryId===frame.id" :aria-label="'选择第'+(index+1)+'帧'" @click="activeStoryId=frame.id"><span class="story-directory__image"><img v-if="urlOf(frame.imageAssetId)" :src="urlOf(frame.imageAssetId)" alt="" /><span v-else>未配图</span><span v-if="frame.seen" class="story-seen" role="img" aria-label="预设已看过"><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 8 3 3 5-6" /></svg></span></span></button></div></section>
            <ul class="iggroup__frames">
              <li v-for="frame in activeFrames" :key="frame.id" class="igframe" :data-story-id="frame.id" :data-testid="APP === 'x' ? 'x-story-row' : 'ig-story-row'">
                <section class="igframe__preview" aria-label="当前帧预览"><div class="igframe__thumbwrap"><img v-if="urlOf(frame.imageAssetId)" :src="urlOf(frame.imageAssetId)" alt="当前 Story 图片" /><span v-else>未配图</span><span v-if="frame.caption" class="igframe__sticker">{{ frame.caption }}</span></div></section>
                <div class="igframe__main">
                  <header class="igframe__title"><h2>第 {{ frameIndex(frame) }} 帧</h2><button type="button" class="ig-story-delete" :disabled="readOnly" aria-label="删除这一帧" title="删除这一帧" :data-testid="APP === 'x' ? 'x-story-remove' : 'ig-story-remove'" @click="removeFrame(frame)"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7" /></svg></button></header>
                  <label class="ig-frame-field"><span>作者</span><select :value="frame.authorCharacterId ?? ''" :disabled="readOnly" :data-testid="APP === 'x' ? 'x-story-author' : 'ig-story-author'" @change="commitFrameAuthor(frame,$event)"><option value="">未指定</option><option v-for="ch in characterOptions" :key="ch.id" :value="ch.id">{{ ch.name }}{{ ch.handle ? ' @'+ch.handle : '' }}</option></select></label>
                  <label class="ig-frame-field"><span>发布时间</span><input type="datetime-local" :value="toDateTimeLocal(frame.displayTime)" :disabled="readOnly" :data-testid="APP === 'x' ? 'x-story-time' : 'ig-story-time'" @change="commitFrameTime(frame,$event)" /></label>
                  <label class="ig-frame-caption"><span>贴纸文字</span><input type="text" :value="frame.caption" :maxlength="STORY_CAPTION_MAX_LENGTH" :disabled="readOnly" placeholder="写下一句话……" :data-testid="APP === 'x' ? 'x-story-caption' : 'ig-story-caption'" @change="commitFrameCaption(frame,$event)" /></label>
                  <div class="igframe__settings"><label class="igframe__seen"><input type="checkbox" :checked="Boolean(frame.seen)" :disabled="readOnly" :data-testid="APP === 'x' ? 'x-story-seen' : 'ig-story-seen'" @change="toggleSeen(frame,$event)" />预设已看过</label><p>只影响作品打开时的初始状态。</p><div class="igframe__image-actions"><AppUploadButton size="sm" :multiple="false" :disabled="readOnly || uploadingId===frame.id" test-id="ig-story-upload" @files="uploadFrameImage(frame,$event)">{{ uploadingId===frame.id ? '处理中…' : frame.imageAssetId ? '更换图片' : '添加图片' }}</AppUploadButton><button v-if="frame.imageAssetId" type="button" :disabled="readOnly" :data-testid="APP === 'x' ? 'x-story-image-remove' : 'ig-story-image-remove'" @click="removeFrameImage(frame)">移除图片</button><span class="ig-story-save" role="status">{{ uploadingId===frame.id ? '正在处理图片…' : editor.saveStatus==='saving' ? '保存中…' : editor.saveStatus==='error' ? '保存失败，请重试' : '已保存' }}</span></div></div>
                </div>
              </li>
            </ul>
          </section>
        </template>
      </RecordWorkspace>
    </section>
  </section>
</template>

<style scoped>
@media(min-width:768px){.iged[data-platform=x]:is([data-tab=trends],[data-tab=searchHistory]){display:flex;flex-direction:column;height:calc(var(--creator-viewport-height,100dvh) - var(--layout-topbar-h,56px));min-height:0;overflow:hidden}.iged[data-platform=x]:is([data-tab=trends],[data-tab=searchHistory])>.ig-page-head,.iged[data-platform=x]:is([data-tab=trends],[data-tab=searchHistory])>.social-tabs{flex:none}}
.iged{padding:28px;min-width:0;color:var(--c-text);min-height:calc(var(--creator-viewport-height,100dvh) - var(--layout-topbar-h,56px))}.ig-page-head{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:8px}.ig-page-head h1{display:flex;align-items:baseline;gap:20px;font:600 24px/1.4 var(--font-story);margin:0}.ig-page-head small{font:400 12px/1.5 var(--font-sans);color:var(--c-text-3)}.ig-page-head :deep(.ui-btn){min-height:34px;font-size:13px;padding:6px 14px;border-radius:6px}.social-tabs{display:flex;gap:24px;border-bottom:1px solid var(--c-border);margin-bottom:24px}.social-tabs button{padding:9px 10px;border:0;border-bottom:2px solid transparent;background:none;min-height:40px;font-size:14px;color:var(--c-text)}.social-tabs [aria-selected=true]{border-bottom-color:var(--c-text);font-weight:600}.igposts,.igstories{min-width:0}.iged :deep(.record-workspace){grid-template-columns:clamp(200px,22vw,280px) minmax(0,1fr);gap:32px;min-height:calc(var(--creator-viewport-height,100dvh) - var(--layout-topbar-h,56px) - 162px)}.iged :deep(.record-workspace__index){border-right:1px solid var(--c-border);padding:20px 12px 0 0;min-width:0}.iged :deep(.record-workspace__search){margin:4px 4px 18px}.iged :deep(.record-workspace__search input){min-height:36px;font-size:13px;padding:7px 10px;border-radius:6px}.iged :deep(.record-workspace__detail){min-width:0}.iged :deep(.record-workspace__toolbar){display:none}.iged :deep(.record-choice){padding:8px;gap:14px;border-radius:8px;min-height:76px}.iged :deep(.record-choice strong){font:600 16px/1.5 var(--font-story)}.iged :deep(.record-choice small){font-size:12px;line-height:1.6;margin-top:5px}.ig-record-cover{width:56px;height:60px;object-fit:cover;border-radius:4px;flex:none}.ig-record-cover--empty{display:grid;place-items:center;background:var(--c-bg-sunken);font:600 20px var(--font-story);color:var(--c-text-3)}.ig-record-copy{display:block;min-width:0;flex:1}.ig-record-copy strong,.ig-record-copy small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ig-record-copy em{font:400 12px var(--font-sans);color:var(--c-text-2);margin-left:12px}.ig-avatar{display:grid;place-items:center;width:36px;height:36px;flex:none;border-radius:50%;overflow:hidden;background:var(--c-bg-sunken);font:600 18px var(--font-story)}.ig-avatar img{width:100%;height:100%;object-fit:cover}.igcard__head,.iggroup__head{display:flex;align-items:center;gap:14px;min-width:0;margin-bottom:18px;min-height:36px}.ig-author select{border:0;background:none;font-size:14px;font-weight:600;padding:4px 18px 4px 0;max-width:140px;min-height:32px;color:var(--c-text)}.ig-handle{font-size:12px;color:var(--c-text-2);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ig-post-date{margin-left:auto;min-width:0}.ig-post-date input{width:208px;max-width:100%;border:1px solid var(--c-border-strong);border-radius:6px;padding:5px 10px;background:var(--c-white);min-height:32px;box-sizing:border-box;font:400 12px var(--font-sans);color:var(--c-text)}.ig-menu{position:relative;flex:none}.ig-menu button{display:block;text-align:left;width:100%;border:0;background:none;padding:8px 10px;min-height:34px;font-size:13px;white-space:nowrap;color:var(--c-text)}.ig-menu .ig-danger{color:var(--c-danger)}.iged__list,.iggroup__frames{list-style:none;padding:0;margin:0;min-width:0}.igcard,.iggroup{min-width:0;container:ig-content / inline-size}.ig-body{display:grid;gap:6px;margin-bottom:16px;font-size:12px;color:var(--c-text-2)}.igcard__text{display:block;width:100%;min-height:96px;max-height:240px;resize:none;border:0;background:none;padding:0;font:400 18px/1.7 var(--font-story);color:var(--c-text);overflow:auto}.igcard__text:focus{outline:none;box-shadow:none}.ig-section-label{display:flex;gap:16px;align-items:baseline;font-size:14px;font-weight:500;line-height:1.5;margin:0 0 12px}.ig-section-label small{font-size:12px;font-weight:400;color:var(--c-text-3)}.igcard__media{margin-bottom:20px}.igmedia{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:16px;list-style:none;margin:0;padding:0;max-width:950px}.igmedia__item,.igmedia__add{min-width:0}.igmedia__select{display:grid;place-items:center;aspect-ratio:1;width:100%;padding:0;border:0;border-radius:4px;overflow:hidden;background:var(--c-bg-sunken);font-size:12px;color:var(--c-text-3)}.igmedia__select img{width:100%;height:100%;object-fit:cover}.igmedia__select[aria-pressed=true]{outline:1px solid var(--c-text-2);outline-offset:3px}.igmedia__item>small{display:block;margin-top:5px;font-size:12px;color:var(--c-text-2)}.igmedia__add :deep(.ui-upload){display:block;width:100%}.igmedia__add :deep(.ui-btn){display:flex;flex-direction:column;justify-content:center;gap:8px;width:100%;height:auto;aspect-ratio:1;padding:8px;min-height:0;border:1px solid var(--c-border-strong);border-radius:5px;background:none;font-size:12px;color:var(--c-text-2)}.igmedia__plus{font-size:28px;line-height:1}.igmedia__ops{display:flex;align-items:center;gap:24px;margin-top:14px;font-size:12px}.igmedia__ops>span{color:var(--c-text-3)}.igmedia__ops button{border:0;background:none;padding:4px 0;min-height:28px;font-size:13px;color:var(--c-text)}.ig-metrics{border-top:1px solid transparent;border-bottom:1px solid transparent;margin:0 0 12px}.igcard__metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;max-width:540px;padding:12px 0}.igcard__metrics label{display:flex;gap:10px;align-items:center;font-size:12px}.igcard__metrics label>span{flex:none;white-space:nowrap}.igcard__metrics input{width:100%;min-width:0;min-height:32px;border:1px solid var(--c-border);border-radius:5px;padding:4px 8px;font:inherit;color:var(--c-text);background:white}.ig-comments-arrow{flex:none;align-self:center;transition:transform .15s ease}.ig-comments-toggle[aria-expanded=true] .ig-comments-arrow{transform:rotate(90deg)}.ig-comments-toggle{border:0;background:none;padding:0;cursor:pointer}.igcomments__empty{font-size:13px;color:var(--c-text-3);padding:8px 0 16px}.igcomment-composer{display:flex;align-items:center;gap:16px;border-top:1px solid var(--c-border);padding-top:10px;margin-top:12px;min-width:0}.igcomment-composer label{flex:0 0 90px;min-width:0}.igcomment-composer select{width:100%;height:30px;min-height:30px;box-sizing:border-box;border:1px solid var(--c-border-strong);border-radius:6px;background:var(--c-white);padding:4px 8px;font:400 12px/20px var(--font-sans);color:var(--c-text)}.igcomment-composer textarea{flex:1;min-width:0;min-height:32px;max-height:140px;padding:5px 0;border:0;background:none;font:400 13px/1.6 var(--font-sans);resize:vertical;color:var(--c-text)}.igcomment-composer :deep(.ui-btn){flex:none;height:32px;min-height:32px;box-sizing:border-box;font-size:12px;line-height:20px;border-radius:6px;padding:5px 12px}.ig-empty{min-height:calc(var(--creator-viewport-height,100dvh) - 240px);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;text-align:center;font-size:14px;line-height:1.8;color:var(--c-text-3);padding:24px}.ig-empty p{margin:0}.ig-empty a{color:var(--c-detail-text);text-decoration:none}.ig-back{display:none}.ig-story-workspace :deep(.record-workspace__search){display:none}.ig-group-label{font-size:12px;color:var(--c-text-2);margin:12px 8px 16px}.iggroup__head{padding-bottom:12px;border-bottom:1px solid transparent;margin-bottom:12px}.iggroup__head>strong{font-size:15px}.iggroup__head .ig-menu{margin-left:auto}.ig-warn{font-size:12px;color:var(--c-warning);margin:10px 0;line-height:1.6}.ig-playback{padding-bottom:16px;border-bottom:1px solid var(--c-border);margin-bottom:16px}.ig-playback__head{display:flex;justify-content:space-between;align-items:baseline;gap:12px}.ig-playback__head>span{font-size:12px;color:var(--c-text-3)}.story-directory{display:flex;gap:16px;overflow-x:auto;padding:3px 4px 4px;margin:-3px -4px -4px;scrollbar-width:thin}.story-directory>button{display:flex;flex-direction:column;gap:5px;flex:none;width:88px;background:none;border:0;padding:0;text-align:left;color:var(--c-text)}.story-directory__image{display:grid;place-items:center;width:100%;aspect-ratio:3/4;border-radius:4px;overflow:hidden;background:var(--c-bg-sunken);font-size:12px;color:var(--c-text-3)}.story-directory img{width:100%;height:100%;object-fit:cover}.story-directory [aria-pressed=true] .story-directory__image{outline:1px solid var(--c-text-2);outline-offset:3px}.story-directory small{font-size:12px;line-height:1.4}.story-directory small+small{color:var(--c-text-3)}.igframe{display:grid;grid-template-columns:clamp(180px,29%,240px) minmax(0,1fr);gap:clamp(24px,4vw,64px);min-width:0}.igframe__thumbwrap{position:relative;display:grid;place-items:center;aspect-ratio:9/15;width:100%;border-radius:4px;overflow:hidden;background:var(--c-bg-sunken);color:var(--c-text-3);font-size:13px}.igframe__thumbwrap>img{position:absolute;width:100%;height:100%;object-fit:cover}.igframe__sticker{position:absolute;bottom:16px;left:50%;transform:translateX(-50%);width:max-content;max-width:calc(100% - 24px);padding:5px 10px;border-radius:4px;background:var(--c-white);font:400 16px/1.5 var(--font-story);color:var(--c-text);overflow-wrap:anywhere}.igframe__main{min-width:0}.igframe__title{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;min-height:24px}.igframe__title h2{font:600 20px/1.5 var(--font-story);margin:0}.ig-frame-field{display:grid;grid-template-columns:72px minmax(0,1fr);align-items:center;gap:12px;font-size:13px;margin-bottom:12px}.ig-frame-field input,.ig-frame-field select{width:100%;min-width:0;min-height:32px;border:1px solid var(--c-border);border-radius:5px;padding:5px 9px;background:white;color:var(--c-text);font:inherit;font-size:13px}.ig-frame-caption{display:grid;gap:8px;margin-top:20px;font-size:13px}.ig-frame-caption input{border:0;background:none;padding:0 4px;min-height:40px;width:100%;min-width:0;font:400 18px/1.6 var(--font-story);color:var(--c-text)}.igframe__settings{border-top:1px solid transparent;padding-top:16px;margin-top:24px}.igframe__seen{display:flex;align-items:center;gap:10px;font-size:14px}.igframe__seen input{width:16px;height:16px;accent-color:var(--c-accent)}.igframe__settings p{font-size:12px;line-height:1.6;color:var(--c-text-3);margin:8px 0}.igframe__settings>p:first-of-type{margin-left:26px}.igframe__image-actions{display:flex;align-items:center;gap:24px;margin:20px 0 12px}.igframe__image-actions :deep(.ui-btn){min-height:32px;font-size:13px;border-radius:5px;padding:4px 12px}.igframe__image-actions>button{border:0;background:none;font-size:13px;min-height:32px;padding:4px 0;color:var(--c-text-2)}.iged button:not(:disabled){cursor:pointer}.iged button:disabled{opacity:.45;cursor:not-allowed}
@container ig-content (max-width:540px){.igmedia{gap:12px;grid-template-columns:repeat(2,minmax(0,1fr))}.igcard__head{display:grid;grid-template-columns:36px auto minmax(0,1fr) 28px;gap:10px}.igcard__head>.ig-menu{grid-row:1;grid-column:4}.ig-post-date{grid-row:2;grid-column:1/-1;margin-left:0;width:100%}.ig-post-date input{width:190px}.igcard__head>.ig-handle{max-width:none}.igframe{grid-template-columns:minmax(0,1fr);gap:24px}.igframe__preview{width:min(100%,220px);margin-inline:auto}.igframe__preview .ig-section-label{justify-content:center}.ig-playback__head{flex-wrap:wrap;gap:0}.ig-handle{max-width:160px}}
@media(max-width:1100px) and (min-width:768px){.iged{padding:24px}.iged :deep(.record-workspace){grid-template-columns:190px minmax(0,1fr);gap:24px}}
@media(max-width:767px){.iged{padding:24px 16px}.ig-page-head h1{font-size:22px;gap:12px}.ig-page-head :deep(.ui-btn){font-size:12px;padding:6px 10px}.social-tabs{margin-bottom:20px}.iged :deep(.record-workspace){display:block;min-height:0}.iged :deep(.record-workspace__index){border:0;padding:0}.iged :deep(.record-workspace__search){margin:0 0 16px}.iged :deep(.record-workspace__search input){font-size:14px;min-height:38px}.iged :deep(.record-workspace__records){gap:6px}.ig-record-cover{width:54px;height:58px}.ig-back{display:flex;align-items:center;gap:8px;border:0;background:none;padding:0;min-height:36px;margin-bottom:16px;font-size:24px;color:var(--c-text)}.ig-back span{font-size:13px}.igcard__head{gap:10px}.ig-author select{font-size:13px}.ig-handle{font-size:12px;max-width:140px}.igcard__text{font-size:17px}.igmedia__ops{gap:20px}.igcomment-composer{gap:10px;flex-wrap:wrap}.igcomment-composer label{flex-basis:76px}.igcomment-composer textarea{font-size:14px}.igcomment-composer :deep(.ui-btn){margin-left:auto}.ig-group-label{margin-top:4px}.story-directory>button{width:76px}.ig-frame-field{grid-template-columns:66px minmax(0,1fr)}.igframe__settings{margin-top:20px}.ig-empty{min-height:calc(var(--creator-viewport-height,100dvh) - 230px);font-size:13px;padding:16px}.ig-empty p{max-width:32em}}

@media(min-width:768px){
  .iged[data-tab=posts]{display:flex;flex-direction:column;height:calc(var(--creator-viewport-height,100dvh) - var(--layout-topbar-h,56px));min-height:0;overflow:hidden}
  .iged[data-tab=posts]>.ig-page-head,.iged[data-tab=posts]>.social-tabs{flex:none}
  .igposts{flex:1;min-height:0}
  .igposts :deep(.record-workspace){grid-template-columns:clamp(220px,24vw,320px) minmax(0,1fr);height:100%;min-height:0;grid-template-rows:minmax(0,1fr);align-items:stretch}
  .igposts :deep(.record-workspace__index){padding-top:0;padding-right:28px;display:flex;flex-direction:column;min-height:0}
  .igposts :deep(.record-workspace__search){margin-top:0}
  .igposts :deep(.record-workspace__filters){flex:none}
  .iged:is([data-comments-open=false],[data-has-comments=false]):not([data-media-overflow=true]) .igposts :deep(.record-workspace__detail){overflow-y:hidden}
  .igposts :deep(.record-workspace__records){flex:1;min-height:0;overflow-y:auto;align-content:start;scrollbar-width:none;overscroll-behavior:contain}
  .igposts :deep(.record-workspace__records::-webkit-scrollbar){display:none}
  .igposts :deep(.record-workspace__detail){height:100%;min-height:0;overflow-y:auto;padding-right:6px;scrollbar-width:thin;overscroll-behavior:contain}
  .igposts>.ig-empty{height:100%;min-height:0}
}
@media(min-width:768px) and (max-width:1100px){.igposts :deep(.record-workspace){grid-template-columns:220px minmax(0,1fr)}}

@media(min-width:768px) and (max-height:900px){.igmedia{max-width:900px}.igcard__text{min-height:88px}}

@media(min-width:768px){
  .iged:is([data-comments-open=false],[data-has-comments=false]):not([data-media-overflow=true]) .iged__list{height:100%}
  .iged:is([data-comments-open=false],[data-has-comments=false]):not([data-media-overflow=true]) .igcard{display:flex;flex-direction:column;height:100%;min-height:0}
  .iged:is([data-comments-open=false],[data-has-comments=false]):not([data-media-overflow=true]) .igcard__head{flex:none}
  .iged:is([data-comments-open=false],[data-has-comments=false]):not([data-media-overflow=true]) .ig-body{display:flex;flex-direction:column;flex:1;min-height:90px;margin-bottom:24px}
  .iged:is([data-comments-open=false],[data-has-comments=false]):not([data-media-overflow=true]) .ig-body>span{flex:none}
  .iged:is([data-comments-open=false],[data-has-comments=false]):not([data-media-overflow=true]) .igcard__text{flex:1;min-height:60px;max-height:none}
  .iged:is([data-comments-open=false],[data-has-comments=false]):not([data-media-overflow=true]) .igcard__media{flex:none;margin-bottom:20px}
  .iged:is([data-comments-open=false],[data-has-comments=false]):not([data-media-overflow=true]) .igmedia{max-width:min(100%,calc(clamp(140px,26dvh,240px) * 5 + 64px))}
  .iged:is([data-comments-open=false],[data-has-comments=false]):not([data-media-overflow=true]) .ig-metrics{flex:none}
  .iged:is([data-comments-open=false],[data-has-comments=false]):not([data-media-overflow=true]) .igcard__comments{flex:none}
  .iged:is([data-comments-open=false],[data-has-comments=false]):not([data-media-overflow=true]) .ig-comments-toggle{margin-bottom:0}
}

@media(min-width:768px){
  .iged[data-comments-open=true][data-has-comments=false] .igmedia{max-width:min(100%,calc(clamp(120px,20dvh,180px) * 5 + 64px))}
  .iged[data-comments-open=true][data-has-comments=false] .ig-body{min-height:0;margin-bottom:16px}
  .iged[data-comments-open=true][data-has-comments=false] .igcard__text{min-height:40px}
  .iged[data-comments-open=true][data-has-comments=false] .igcomments__empty{margin:0;padding:8px 0 12px}
}

@media(max-width:767px){
  .iged[data-post-detail=true]>.social-tabs,.iged[data-post-detail=true]>.ig-page-head>.ui-btn{display:none}
  .iged[data-post-detail=true]>.ig-page-head{margin-bottom:20px}
  .igposts .ig-back{margin-bottom:16px}
  .igposts .igcard__head{position:relative;display:grid;grid-template-columns:36px minmax(0,1fr) auto;gap:10px;align-items:center;margin-bottom:16px}
  .igposts .igcard__head>.ig-handle{display:none}
  .igposts .igcard__head>.ig-author{grid-column:2;min-width:0}
  .igposts .ig-author select{max-width:100%}
  .igposts .ig-post-date{grid-row:1;grid-column:3;width:auto;margin:0}
  .igposts .ig-post-date input{width:clamp(150px,38vw,190px);height:32px;min-height:32px;font-size:11px;padding:4px 7px}
  .igposts .igcard__head>.ig-menu{position:absolute;top:-52px;right:0;grid-area:auto}
  .igposts .igcard__text{min-height:clamp(112px,18dvh,160px)}
  .igposts .igmedia{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
}

.igmedia__item{position:relative}
.igmedia__overlay{position:absolute;inset:0;border-radius:4px;background:rgb(255 255 255 / 42%);pointer-events:none}
.igmedia__image-actions{position:absolute;bottom:12px;left:50%;transform:translateX(-50%);display:flex;gap:10px;pointer-events:auto}
.igmedia__image-actions button{display:grid;place-items:center;position:relative;flex:none;width:32px;height:32px;padding:6px;border:1px solid var(--c-border-strong);border-radius:50%;background:rgb(255 255 255 / 92%);color:var(--c-text);box-sizing:border-box}
.igmedia__image-actions svg{width:18px;height:18px}
.igmedia__image-actions .igmedia__remove{color:var(--c-danger)}
.igmedia__image-actions button:hover:not(:disabled){background:var(--c-white);border-color:var(--c-text-3)}
.igmedia__image-actions button:disabled{opacity:.35}
@container ig-content (max-width:420px){.igmedia__image-actions{gap:6px}.igmedia__image-actions button{width:30px;height:30px;padding:5px}}
@media(max-width:767px){.igmedia__image-actions{bottom:12px;gap:14px}.igmedia__image-actions button::before{content:'';position:absolute;inset:-6px}}

.story-directory__image{position:relative}
.story-seen{position:absolute;top:6px;right:6px;display:grid;place-items:center;width:20px;height:20px;border-radius:50%;background:var(--c-white);color:var(--c-text);box-shadow:0 1px 4px rgb(0 0 0 / 12%)}
@media(min-width:768px){
  .iged[data-tab=stories]{display:flex;flex-direction:column;height:calc(var(--creator-viewport-height,100dvh) - var(--layout-topbar-h,56px));min-height:0;overflow:hidden}
  .iged[data-tab=stories]>.ig-page-head,.iged[data-tab=stories]>.social-tabs{flex:none}
  .igstories{flex:1;min-height:0}
  .ig-story-workspace{height:100%;min-height:0;grid-template-rows:minmax(0,1fr);align-items:stretch}
  .iged .ig-story-workspace{min-height:0;grid-template-columns:clamp(220px,24vw,320px) minmax(0,1fr)}
  .ig-story-workspace :deep(.record-workspace__index){display:flex;flex-direction:column;padding-top:0;padding-right:28px;min-height:0}
  .ig-story-workspace :deep(.record-workspace__records){flex:1;min-height:0;overflow-y:auto;scrollbar-width:none;align-content:start;overscroll-behavior:contain}
  .ig-story-workspace :deep(.record-workspace__records::-webkit-scrollbar){display:none}
  .ig-story-workspace :deep(.record-workspace__detail){height:100%;min-height:0;min-width:0;overflow:hidden}
  .igframe{grid-template-columns:clamp(150px,calc((var(--creator-viewport-height,100dvh) - 500px) * .6),240px) minmax(0,1fr)}
  .igstories>.ig-empty{height:100%;min-height:0}
}
@media(min-width:768px) and (max-width:1100px){.iged .ig-story-workspace{grid-template-columns:220px minmax(0,1fr)}}

@media(min-width:768px) and (max-height:900px){
  .ig-playback{padding-bottom:12px;margin-bottom:12px}
  .igframe__title{margin-bottom:10px}
  .ig-frame-field{margin-bottom:8px}
  .ig-frame-caption{margin-top:12px}
  .igframe__settings{margin-top:14px;padding-top:12px}
  .igframe__image-actions{margin:12px 0 8px}
  .igframe__settings p{margin-top:6px;margin-bottom:6px}
}

.igstories,.iggroup,.igframe__main{min-width:0;max-width:100%}
.igposts :deep(.record-workspace__detail){overflow-x:hidden}
.ig-story-workspace :deep(.record-workspace__detail){overflow-x:hidden}
/*
 * 窄屏单栏：详情区高度跟着内容长，唯一的滚动源是 `.ws__main`。
 * 这里必须把两轴都放开（overflow-x 用 clip，不做滚动容器也不裁布局盒），
 * 否则上面的 overflow-x:hidden 会让 overflow-y 由 visible 被算成 auto ——
 * 详情区就成了"空壳滚动容器"，它的 overscroll-behavior:contain 会掐断滚动链，
 * 手机上滑不动、电脑滚轮也滚不动。
 */
@media(max-width:767px){
  .igposts :deep(.record-workspace__detail),
  .ig-story-workspace :deep(.record-workspace__detail){overflow:visible;overflow-x:clip;overscroll-behavior-y:auto}
}

@media(min-width:768px){
  .iged[data-comments-open=true] .iged__list{min-height:100%;display:flex;flex-direction:column}
  .iged[data-comments-open=true] .igcard{flex:1;display:flex;flex-direction:column}
  .iged[data-comments-open=true] .igcard__comments{flex:1;display:flex;flex-direction:column}
  .iged[data-comments-open=true] .igcomment-composer{margin-top:auto;flex:none}
}

.ig-story-add-icon{margin-left:auto;display:grid;place-items:center;width:32px;height:32px;padding:4px;border:0;border-radius:5px;background:none;color:var(--c-text)}
.ig-story-delete{display:grid;place-items:center;width:32px;border:0;border-radius:4px;background:none;min-height:32px;padding:4px 0;color:var(--c-danger);font-size:13px}
.ig-story-save{margin-left:auto;font-size:12px;color:var(--c-text-3);white-space:nowrap}
.ig-story-add-icon:hover:not(:disabled),.ig-story-delete:hover:not(:disabled){background:var(--c-bg-sunken)}

@media(min-width:768px){
  .igframe{--story-preview-width:clamp(150px,calc((var(--creator-viewport-height,100dvh) - 500px) * .6),240px);position:relative;grid-template-columns:var(--story-preview-width) minmax(0,1fr)}
  .ig-story-save{position:absolute;right:0;top:calc(var(--story-preview-width) * 5 / 3);transform:translateY(-100%);margin:0;line-height:1}
}

@media(max-width:767px){
  .iged[data-story-detail=true]>.social-tabs,.iged[data-story-detail=true]>.ig-page-head>.ui-btn{display:none}
  .iged[data-story-detail=true]>.ig-page-head{margin-bottom:28px}
  .ig-story-workspace .ig-back{margin-bottom:8px}
  .iggroup__head{position:relative}
  .iggroup__head>.ig-story-add-icon{position:absolute;right:0;top:-44px;margin:0}
  .story-directory>button{width:clamp(60px,16vw,76px)}
}

.iged[data-platform=x] .igcard__metrics{grid-template-columns:repeat(4,minmax(0,1fr));max-width:720px}
@media(max-width:767px){.iged[data-platform=x] .igcard__metrics{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 16px}}

.igcard__metrics{grid-template-columns:repeat(3,minmax(0,180px));max-width:none}
.iged[data-platform=x] .igcard__metrics{grid-template-columns:repeat(4,minmax(0,180px));max-width:none}
.igcard__metrics label{display:grid;grid-template-columns:28px minmax(0,1fr);gap:10px}
.igcard__metrics input{box-sizing:border-box;width:100%}
@media(max-width:767px){.iged .igcard__metrics,.iged[data-platform=x] .igcard__metrics{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 16px}}

.iged :deep(.record-choice strong){font-family:var(--font-sans)}
.ig-record-copy small,.ig-record-copy em{font-family:var(--font-sans)}
.ig-post-choice { display: grid; grid-template-columns: minmax(0, 1fr); flex: 1; min-width: 0; gap: 6px; }
.ig-post-choice__header { display: flex; align-items: baseline; min-width: 0; gap: 6px; }
.ig-post-choice__header > .ig-post-choice__author { flex: 0 1 auto; }
.ig-post-choice__handle,
.ig-post-choice__summary { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ig-post-choice__handle { font-size: 12px; color: var(--c-text-3); }
.ig-post-choice__date { align-self: center; flex: none; margin-inline-start: auto; margin-inline-end: 5px; font-size: 11px; color: var(--c-text-3); white-space: nowrap; }
.ig-post-choice__summary { font-size: 13px; line-height: 1.5; }

@media(max-width:767px){
  .iged:is([data-post-detail=true],[data-story-detail=true])>.ig-page-head{display:none}
  .ig-back{gap:10px}
  .ig-back .ig-back-icon{display:grid;place-items:center;width:28px;height:28px;border:1px solid var(--c-border);border-radius:50%;flex:none}
  .ig-back>span:not(.ig-back-icon){font-size:14px}
}

@media(max-width:767px){
  .igcard__head .ig-author select,.iggroup__head .ig-author select{font-size:15px;line-height:1.5}
  .igcard__head .ig-handle,.iggroup__head .ig-handle{font-size:13px;line-height:1.5}
}
.x-post-options{display:flex;align-items:center;gap:10px;margin-left:auto;flex-wrap:wrap}
.x-post-options + .ig-post-date{margin-left:0}
.x-post-types{display:flex;gap:4px}.x-post-types button{min-height:30px;padding:4px 8px;border:1px solid var(--c-border);border-radius:5px;background:white;font:inherit;font-size:12px}.x-post-types button[aria-pressed=true]{background:var(--c-bg-sunken);border-color:var(--c-border-strong)}.x-post-options select[multiple]{min-height:44px;max-width:130px}.x-post-visibility{display:grid;place-items:center;flex:none;width:32px;height:32px;border:0;background:none;color:var(--c-text-2);border-radius:4px}
.x-post-visibility:hover{background:var(--c-bg-sunken)}
.x-post-visibility svg{width:19px;height:19px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
@media(max-width:767px){.iged[data-platform=x] .igcard__head{flex-wrap:wrap}.x-post-options{margin-left:0}.x-post-options .ig-author select{max-width:120px}}
@media(max-width:767px){
  .iged[data-platform=x] .igposts .igcard__head{grid-template-columns:36px minmax(0,1fr) auto}
  .iged[data-platform=x] .igposts .ig-post-date{position:absolute;top:-52px;right:40px;grid-area:auto;margin:0}
  .iged[data-platform=x] .igposts .ig-post-date input{width:clamp(156px,36vw,200px)}
  .iged[data-platform=x] .igposts .x-post-options{grid-row:1;grid-column:3;display:flex;align-items:center;flex-wrap:nowrap;gap:8px;margin:0;min-width:0}
  .iged[data-platform=x] .x-post-options :deep(.x-status){min-width:80px;white-space:nowrap}
}
.ig-post-text-wrap{position:relative;min-width:0}.x-post-text-highlight{position:absolute;inset:0;pointer-events:none;white-space:pre-wrap;overflow-wrap:anywhere;padding:0;font:400 18px/1.7 var(--font-story);overflow:hidden}.igcard__text.x-post-text-input{position:relative;color:transparent;caret-color:var(--c-text);-webkit-text-fill-color:transparent;background:transparent}
.iged[data-platform=instagram] .x-post-text-highlight{--hashtag-color:#4d4bb9}
.igcard__text.x-post-text-input::placeholder{-webkit-text-fill-color:var(--c-text-3);color:var(--c-text-3)}
.igcard__text.x-post-text-input::selection{background:rgba(48,50,47,.16)}
@media(max-width:767px){.x-post-text-highlight{font-size:17px}}
</style>
