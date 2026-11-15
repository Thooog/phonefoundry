<script setup>

import { computed, ref, nextTick, watch } from 'vue'
import { useRoute } from 'vue-router'
import {
  SIZE_THRESHOLDS,
  FAVORITES_ALBUM_ID,
  HIDDEN_ALBUM_ID,
  TRASH_ALBUM_ID,
} from '@phone-sim/shared'
import { formatBytes, sizeHint, sizeTier } from '@phone-sim/exporter'

import AppButton from '../../ui/AppButton.vue'
import DeleteIconButton from '../../ui/DeleteIconButton.vue'
import AppInput from '../../ui/AppInput.vue'
import AppUploadButton from '../../ui/AppUploadButton.vue'
import { useProjectStore } from '../../../stores/project.js'
import { useUiStore } from '../../../stores/ui.js'
import { useAssetUrls } from '../../../composables/use-asset-urls.js'
import { useMediaQuery } from '../../../composables/use-media-query.js'
import { prepareImage } from '../../../media/compress-image.js'
import { fromDateTimeLocal, toDateTimeLocal } from '../../../utils/time.js'
import {
  CAPTION_MAX_LENGTH,
  LOCATION_MAX_LENGTH,
  addAlbum,
  addPhoto,
  albumMembers,
  captionFromFileName,
  deleteAlbum,
  deletePhoto,
  deletePhotos,
  photosOutsideAlbum,
  renameAlbum,
  setAlbumMember,
  sortPhotosByTime,
  STATUS_ALBUMS,
  updatePhoto,
  updatePhotos,
} from '../../../editing/photos.js'

const editor = useProjectStore()
const ui = useUiStore()

const readOnly = computed(() => Boolean(editor.readOnlyReason))
const project = computed(() => editor.project)

const photos = computed(() => project.value?.appData?.photos?.photos ?? [])

const statusAlbums = computed(() =>
  STATUS_ALBUMS.map((album) => ({ id: album.id, name: album.name, builtin: true })),
)
const userAlbums = computed(() =>
  [...(project.value?.appData?.photos?.albums ?? [])].sort(
    (a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0),
  ),
)
const albums = computed(() => [...statusAlbums.value, ...userAlbums.value])

/**
 * 固定相簿只换动词，标题结构、缩略图、按钮全部照抄普通相簿。
 * 「最近删除」里点 ＋ 实际是把照片移进回收站，所以文案必须说清楚，
 * 不能沿用「从图库添加 / 加入相簿」——那是反的。
 */
const STATUS_COPY = {
  [FAVORITES_ALBUM_ID]: {
    addHeading: '移入收藏夹', addLabel: '设为收藏', addTip: '加入个人收藏',
    removeLabel: '取消收藏', removeTip: '取消收藏（照片仍在图库）',
    emptyHint: '收藏夹还是空的，从下方移入几张照片。',
    footnote: '取消收藏后，照片仍在图库与原有相簿中。',
  },
  [HIDDEN_ALBUM_ID]: {
    addHeading: '移入隐藏相册', addLabel: '隐藏', addTip: '隐藏这张照片',
    removeLabel: '取消隐藏', removeTip: '取消隐藏（照片回到图库）',
    emptyHint: '隐藏相册是空的，从下方移入几张照片。',
    footnote: '取消隐藏后，照片回到图库与原有相簿。',
  },
  [TRASH_ALBUM_ID]: {
    addHeading: '移入最近删除', addLabel: '移到最近删除', addTip: '移到最近删除（可在这里恢复）',
    removeLabel: '恢复照片', removeTip: '恢复照片（回到图库）',
    emptyHint: '最近删除是空的，从下方移入几张照片。',
    footnote: '移出即恢复，照片回到图库与原有相簿；彻底删除请到图库操作。',
  },
}
const DEFAULT_COPY = {
  addHeading: '从图库添加', addLabel: '加入相簿', addTip: '加入相簿',
  removeLabel: '移出相簿', removeTip: '移出相簿（照片保留在图库）',
  emptyHint: '相簿还是空的，从图库添加几张照片。',
  footnote: '移出相簿不会删除图库中的照片。',
}

/** 列表封面用的状态图标：复用详情面板 / 角标同一套路径，不引入新图标集 */
const STATUS_GLYPHS = {
  [FAVORITES_ALBUM_ID]: {
    filled: true,
    d: 'M12 20.2l-1.2-1.1C6.5 15.2 3.8 12.7 3.8 9.6c0-2.3 1.8-4.1 4.1-4.1 1.4 0 2.7.7 3.9 2 1.2-1.3 2.5-2 3.9-2 2.3 0 4.1 1.8 4.1 4.1 0 3.1-2.7 5.6-7 9.5z',
  },
  [HIDDEN_ALBUM_ID]: {
    filled: false,
    d: 'M2.8 12C5.2 7.5 8.4 5.5 12 5.5s6.8 2 9.2 6.5c-2.4 4.5-5.6 6.5-9.2 6.5s-6.8-2-9.2-6.5Z M4.2 4.2 19.8 19.8',
    circle: { cx: 12, cy: 12, r: 3.1 },
  },
  [TRASH_ALBUM_ID]: {
    filled: false,
    d: 'M2.9 5.5h18.2M8.75 5.5V3.16h6.5V5.5M6.02 5.5l1.17 16.12h9.62L17.98 5.5 M9.66 9.78v7.28M14.34 9.78v7.28',
  },
}
const statusGlyph = (albumId) => STATUS_GLYPHS[albumId]

const photoSort = ref('time')
const sortedPhotos = computed(() => photoSort.value === 'name'
  ? [...photos.value].sort((a, b) => (a.caption || '').localeCompare(b.caption || '', 'zh-CN'))
  : sortPhotosByTime(photos.value))

const { urls } = useAssetUrls(editor, () => photos.value.map((p) => p.imageAssetId))

function urlOf(photo) {
  const id = photo?.imageAssetId
  return id ? (urls.value.get(id) ?? null) : null
}

const usedBytes = computed(() => editor.assetTotalBytes)
const usageTier = computed(() => sizeTier(usedBytes.value))
const usageHint = computed(() => sizeHint(usedBytes.value))

/* ── 添加照片 ─────────────────────────────────── */

const importing = ref(false)
const progress = ref({ done: 0, total: 0 })
const failures = ref([])

async function handleFiles(files) {
  if (readOnly.value || importing.value) return

  if (photoTab.value === 'photos') expandedAlbumId.value = null
  importing.value = true
  progress.value = { done: 0, total: files.length }
  failures.value = []

  let added = 0

  for (const file of files) {
    try {
      const prepared = await prepareImage(file)

      // 跨过「体积较大」这一档时问一次。只问一次：加完这一张之后
      // tier 就已经是 strong，后面几张不会再触发。
      const before = usedBytes.value
      const after = before + prepared.blob.size
      if (sizeTier(before) !== 'strong' && sizeTier(after) === 'strong') {
        const ok = await ui.confirm({
          title: `素材就要超过 ${formatBytes(SIZE_THRESHOLDS.STRONG)} 了`,
          message: `再加这一张（${formatBytes(prepared.blob.size)}）会到约 ${formatBytes(after)}。这么大的作品发到微信、邮件里可能被拒收，建议之后用网盘或链接分享。`,
          confirmText: '继续添加',
          cancelText: '先不加',
        })
        if (!ok) break
      }

      const meta = await editor.addAsset(prepared)
      addPhoto(editor, {
        imageAssetId: meta.id,
        // 默认说明取文件名（去掉扩展名）。用户不改的话，作品里这张图就叫
        // 它本来的名字；点进说明框时它会被清空，方便直接写自己的话。
        caption: captionFromFileName(file.name),
        // 用文件的修改时间当拍摄时间：比"刚才"更接近真相，
        // 而且用户往往是一次性导入一批旧照片，按导入时间排会全是同一分钟。
        displayTime: file.lastModified
          ? new Date(file.lastModified).toISOString()
          : new Date().toISOString(),
      })
      added += 1
    } catch (err) {
      failures.value = [...failures.value, { name: file.name || '未命名文件', message: err.message }]
    } finally {
      progress.value = { ...progress.value, done: progress.value.done + 1 }
    }
  }

  importing.value = false

  if (added > 0) ui.toast(`已添加 ${added} 张照片`, { tone: 'success' })
  if (failures.value.length > 0) {
    ui.toast(`${failures.value.length} 个文件没能添加，原因见下方`, { tone: 'error' })
  }
}

/* ── 说明框：预填文件名，点进去就清空 ─────────────── */

const fileNameByAssetId = computed(() => {
  const map = new Map()
  for (const asset of project.value?.assets ?? []) map.set(asset.id, asset.fileName ?? '')
  return map
})

/**
 * 这条照片的"默认说明"。
 *
 * 找不到资源元信息就返回空串 —— 示例项目的照片是内联 dataURL，不在资源表里，
 * 它们的说明是作者写好的文案，本来就不该被当成默认名清掉。返回空串正好让
 * onCaptionFocus 的条件不成立。
 */
function defaultCaptionOf(photo) {
  return captionFromFileName(fileNameByAssetId.value.get(photo.imageAssetId) ?? '')
}

const captionDrafts = ref(new Map())

function captionValueOf(photo) {
  return captionDrafts.value.has(photo.id)
    ? captionDrafts.value.get(photo.id)
    : (photo.caption ?? '')
}

function setCaptionDraft(photoId, value) {
  captionDrafts.value = new Map(captionDrafts.value).set(photoId, value)
}

function dropCaptionDraft(photoId) {
  if (!captionDrafts.value.has(photoId)) return
  const next = new Map(captionDrafts.value)
  next.delete(photoId)
  captionDrafts.value = next
}

function onCaptionFocus(photo) {
  if (readOnly.value) return
  const value = photo.caption ?? ''
  // 只有"还是那个默认文件名"时才清空。用户自己写过的说明一个字都不动。
  if (!value || value !== defaultCaptionOf(photo)) return
  setCaptionDraft(photo.id, '')
}

/** 编辑期间让草稿跟着输入走，否则重渲染会把用户正在打的字抹掉 */
function onCaptionInput(photo, event) {
  if (!captionDrafts.value.has(photo.id)) return
  setCaptionDraft(photo.id, event.target.value ?? '')
}

/* ── 单张照片的操作 ───────────────────────────── */

function commitCaption(photo, event) {
  const value = event.target.value ?? ''
  dropCaptionDraft(photo.id)
  if (value === (photo.caption ?? '')) return
  updatePhoto(editor, photo.id, { caption: value })
}

function onCaptionBlur(photo) {
  dropCaptionDraft(photo.id)
}

function commitTime(photo, event) {
  const iso = fromDateTimeLocal(event.target.value)
  updatePhoto(editor, photo.id, { displayTime: iso })
}

/**
 * 地点：作品端查看器的第一行标题就是它。
 *
 * 允许写成空串（清空），因为写错了地点比没有地点更糟 ——
 * 所以这里不像批量那样拦空值。
 */
function commitLocation(photo, event) {
  const value = (event.target.value ?? '').trim()
  if (value === (photo.location ?? '')) return
  updatePhoto(editor, photo.id, { location: value })
}

function toggleFavorite(photo) {
  updatePhoto(editor, photo.id, { isFavorite: !photo.isFavorite })
}

/**
 * 回收站开关，与收藏同一套做法：只改照片上的一个布尔标记，不删记录、不回收资源。
 * 作品端会把被标记的照片从图库/普通相簿里隐去，只在「回收站」相簿里显示。
 */
function toggleTrash(photo) {
  updatePhoto(editor, photo.id, { isInTrash: !photo.isInTrash })
}

/**
 * 已隐藏开关，与收藏 / 回收站同一套做法：只改照片上的一个布尔标记。
 * 作品端会把被标记的照片从图库与所有相簿里隐去，只在「已隐藏」相簿里显示；
 * 创作端仍把它列在图库里（要能取消隐藏），行上挂图标角标。
 *
 * 图标表达的是**状态**而不是动作（和收藏的心形一致）：
 * 未隐藏 = 空心普通眼睛（照片此刻看得见），已隐藏 = 点亮 + 划掉的眼睛。
 */
function toggleHidden(photo) {
  updatePhoto(editor, photo.id, { isHidden: !photo.isHidden })
}

function flagTitleOf(photo) {
  const labels = []
  if (photo.isFavorite) labels.push('已收藏')
  if (photo.isHidden) labels.push('已隐藏')
  if (photo.isInTrash) labels.push('在回收站')
  return labels.join(' · ')
}

async function removePhoto(photo) {
  const ok = await ui.confirm({
    title: '删除这张照片？',
    message: '照片、说明和拍摄时间会一起删除，相簿里也会移除。这个操作不能撤销。',
    confirmText: '删除',
    tone: 'danger',
  })
  if (!ok) return

  const orphanAssetId = deletePhoto(editor, photo.id)
  // 第二刀：记录已经没了，再把二进制回收掉（顺序与添加时相反）
  if (orphanAssetId) await editor.removeAsset(orphanAssetId)
  ui.toast('已删除一张照片')
}

/* ── 多选与批量改 ─────────────────────────────── */

/**
 * 选中的 photoId。
 *
 * 存 id 而不是照片对象：列表是按时间重排的，对象引用在每次 mutate 后都会换新，
 * 拿对象当 key 会让"勾选"在任意一次改动后全部失效。id 不会变。
 */
const selectedIds = ref(new Set())

/**
 * 当前这批选中的照片。
 *
 * 注意它是从 sortedPhotos 里**过滤**出来的，而不是直接遍历 selectedIds ——
 * 被删掉的照片 id 会留在 Set 里，用过滤的结果天然把它们剔掉，
 * 不用再写一个 watch 去同步"照片没了要清勾"。
 */
const selectedPhotos = computed(() => sortedPhotos.value.filter((p) => selectedIds.value.has(p.id)))
const selectedCount = computed(() => selectedPhotos.value.length)

function isSelected(photo) {
  return selectedIds.value.has(photo.id)
}

function toggleSelect(photo) {
  const next = new Set(selectedIds.value)
  if (next.has(photo.id)) next.delete(photo.id)
  else next.add(photo.id)
  selectedIds.value = next
}

function selectAll() {
  selectedIds.value = new Set(visibleLibraryPhotos.value.map((p) => p.id))
}

function clearSelection() {
  selectedIds.value = new Set()
}

/* 批量地点 / 时间：输入框留空时按钮禁用，不做"空值即清空"——
   一次手滑点到就能抹掉 20 张照片的拍摄时间，这个代价不值得省一次点击。 */

const batchLocation = ref('')
const batchTime = ref('')

function applyBatchChanges() {
  if (readOnly.value || !selectedCount.value) return
  const location = batchLocation.value.trim()
  const iso = fromDateTimeLocal(batchTime.value)
  if (batchTime.value && !iso) return
  if (!location && !iso) return

  const changed = updatePhotos(
    editor,
    selectedPhotos.value.map((p) => p.id),
    { ...(location ? { location } : {}), ...(iso ? { displayTime: iso } : {}) },
  )
  batchLocation.value = ''
  batchTime.value = ''
  ui.toast(`已更新 ${changed} 张照片`, { tone: 'success' })
}

async function removeSelected() {
  const count = selectedCount.value
  if (!count) return

  const ok = await ui.confirm({
    title: `删除这 ${count} 张照片？`,
    message: '照片、说明、地点和拍摄时间会一起删除，相簿里也会移除。这个操作不能撤销。',
    confirmText: `删除 ${count} 张`,
    tone: 'danger',
  })
  if (!ok) return

  // 先把 id 抄下来：删完之后 selectedPhotos 就空了，回收要靠这份快照
  const ids = selectedPhotos.value.map((p) => p.id)
  const orphanAssetIds = deletePhotos(editor, ids)
  clearSelection()
  if (orphanAssetIds.length) await editor.removeAssets(orphanAssetIds)
  ui.toast(`已删除 ${count} 张照片`)
}

/* ── 相簿 ────────────────────────────────────── */

const newAlbumName = ref('')
const expandedAlbumId = ref(null)
const albumDetailOpen = ref(false)
const albumList = ref(null)

async function backToAlbums() {
  albumDetailOpen.value = false
  await nextTick()
  albumList.value?.querySelector('[aria-pressed="true"]')?.focus()
}

const activeStatus = computed(() =>
  STATUS_ALBUMS.find((album) => album.id === expandedAlbumId.value) ?? null,
)
const albumCopy = computed(() =>
  activeStatus.value ? STATUS_COPY[activeStatus.value.id] : DEFAULT_COPY,
)

const expanded = computed(() => {
  if (!expandedAlbumId.value) return null
  return {
    members: albumMembers(project.value, expandedAlbumId.value),
    candidates: photosOutsideAlbum(project.value, expandedAlbumId.value),
  }
})

function toggleAlbum(albumId) {
  expandedAlbumId.value = albumId
  albumDetailOpen.value = true
}

function submitNewAlbum() {
  const created = addAlbum(editor, newAlbumName.value)
  if (!created) return
  newAlbumName.value = ''
  ui.toast(`已新建相簿「${created.name}」`, { tone: 'success' })
  return created
}

function commitAlbumName(album, event) {
  if (readOnly.value || renamingAlbumId.value !== album.id) return
  renamingAlbumId.value = null
  const value = event.target.value ?? ''
  if (value.trim() === (album.name ?? '')) return
  renameAlbum(editor, album.id, value)
}

async function removeAlbum(album) {
  const ok = await ui.confirm({
    title: `删除相簿「${album.name || '未命名相簿'}」？`,
    message: '相簿只是照片的一种整理方式，里面的照片会留在图库里，不会被删掉。',
    confirmText: '删除相簿',
    tone: 'danger',
  })
  if (!ok) return
  deleteAlbum(editor, album.id)
  if (expandedAlbumId.value === album.id) expandedAlbumId.value = null
  albumDetailOpen.value = false
  ui.toast('已删除相簿，照片仍在图库')
}

async function removeAlbumPhoto(album, photo) {
  if (readOnly.value) return
  // 固定相簿的移出只是清一个可逆标记（点一下就能加回来），不必每次弹确认；

  if (!album.builtin) {
    const ok = await ui.confirm({ title: '从相簿移除这张照片？', message: '照片会从当前相簿移除，仍保留在图库中。', confirmText: '移除', tone: 'danger' })
    if (!ok) return
  }
  setAlbumMember(editor, album.id, photo.id, false)
}

import InspectorPanel from '../../workspace/InspectorPanel.vue'
import { useRecordSelection } from '../../../composables/use-record-selection.js'
const { selectedRecordId: selectedPhotoId, visibleRecords: visiblePhotoRecords }=useRecordSelection(sortedPhotos)
const photoDesktop = useMediaQuery('(min-width:1024px)')
const photoInspectorOpen=ref(photoDesktop.value && photos.value.length > 0)
watch(photoDesktop, (wide, previous) => { if (!wide && previous) photoInspectorOpen.value = false })
const photoTab=ref('photos')
const photoLayout=ref('grid')
const route = useRoute()
watch(() => route.query.record, id => {
  if (typeof id === 'string' && sortedPhotos.value.some(photo => photo.id === id)) {
    selectedPhotoId.value = id
    photoInspectorOpen.value = true
  }
}, { immediate: true })
const visibleLibraryPhotos = computed(() => sortedPhotos.value)

const albumFormOpen = ref(false)
const albumCreateTrigger = ref(null)
const albumNameInput = ref(null)
const albumDialog = ref(null)
const photoEditor = ref(null)
const renamingAlbumId = ref(null)
const albumRenameInput = ref(null)
const batchFieldsOpen = ref(false)
watch(selectedCount, count => { if (!count) batchFieldsOpen.value = false })
async function toggleAlbumForm() {
  if (readOnly.value) return
  albumFormOpen.value = !albumFormOpen.value
  await nextTick()
  if (albumFormOpen.value) { albumDialog.value?.showModal(); albumNameInput.value?.$el?.focus() }
  else albumCreateTrigger.value?.focus()
}
function closeAlbumForm() {
  albumFormOpen.value = false
  albumDialog.value?.close()
  albumCreateTrigger.value?.focus()
}
function createAlbumFromForm() {
  if (readOnly.value) return
  const created = submitNewAlbum()
  if (created) {
    expandedAlbumId.value = created.id
    albumDetailOpen.value = true
    photoTab.value = 'albums'
    photoInspectorOpen.value = false
    closeAlbumForm()
  }
}
watch(albums, records => {
  if (!records.some(album => album.id === expandedAlbumId.value)) expandedAlbumId.value = records[0]?.id ?? null
}, { immediate: true })
watch(visiblePhotoRecords, records => { if (!records.length) photoInspectorOpen.value = false })
function setPhotoTab(tab) {
  photoTab.value = tab
  albumDetailOpen.value = false
  if (tab === 'albums') photoInspectorOpen.value = false
}
function onTabKey(event) {
  const tabs = [...event.currentTarget.parentElement.querySelectorAll('[role=tab]')]
  let index = tabs.indexOf(event.currentTarget)
  if (event.key === 'Home') index = 0
  else if (event.key === 'End') index = tabs.length - 1
  else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') index = (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
  else return
  event.preventDefault()
  tabs[index].click()
  tabs[index].focus()
}
async function beginRenameAlbum(album) {
  renamingAlbumId.value = album.id
  await nextTick()
  albumRenameInput.value?.focus()
  albumRenameInput.value?.select()
}
</script>

<template>
  <section ref="photoEditor" class="photed" :data-album-detail="photoTab === 'albums' && albumDetailOpen" data-testid="photos-editor">
    <header class="photo-page-title">
      <div class="photo-page-title__label"><h1>照片</h1><span>{{ photos.length }} 张照片</span></div>
      <AppUploadButton v-if="photoTab === 'photos'" variant="primary" :disabled="readOnly || importing" @files="handleFiles">
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 4v16M4 12h16" /></svg>{{ importing ? '处理中 ' + progress.done + '/' + progress.total : '添加照片' }}
      </AppUploadButton>
      <button v-else ref="albumCreateTrigger" type="button" class="photo-primary" :disabled="readOnly || importing" aria-haspopup="dialog" :aria-expanded="albumFormOpen" data-testid="album-create-toggle" @click="toggleAlbumForm">
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 4v16M4 12h16" /></svg>新建相簿
      </button>
    </header>
    <nav class="photo-tabs" role="tablist" aria-label="照片与相簿">
      <button id="photo-tab-library" type="button" role="tab" :aria-selected="photoTab === 'photos'" :aria-pressed="photoTab === 'photos'" :tabindex="photoTab === 'photos' ? 0 : -1" aria-controls="photo-tab-panel" @click="setPhotoTab('photos')" @keydown="onTabKey">图库</button>
      <button id="photo-tab-albums" type="button" role="tab" :aria-selected="photoTab === 'albums'" :aria-pressed="photoTab === 'albums'" :tabindex="photoTab === 'albums' ? 0 : -1" aria-controls="photo-tab-panel" @click="setPhotoTab('albums')" @keydown="onTabKey">相簿</button>
    </nav>
    <p v-if="readOnly" class="photed__ro">当前为只读，无法修改</p>
    <p v-if="importing" class="photed__progress" role="status">正在添加照片 {{ progress.done }} / {{ progress.total }}，请稍候。</p>
    <ul v-if="failures.length" class="photed__failures" role="alert"><li v-for="item in failures" :key="item.name"><strong>{{ item.name }}</strong> — {{ item.message }}</li></ul>
    <div id="photo-tab-panel" class="photo-workbench" :data-tab="photoTab" :data-album-detail="albumDetailOpen" role="tabpanel" :aria-labelledby="photoTab === 'photos' ? 'photo-tab-library' : 'photo-tab-albums'">
      <aside v-if="photoTab === 'albums'" ref="albumList" class="photo-albums" aria-label="相簿列表">
        <header class="photo-albums__head"><h2>相簿</h2><span>{{ albums.length }}</span></header>
        <div class="photo-albums__list">
          <template v-for="(album, index) in albums" :key="album.id">
            <p v-if="index === 0" class="photo-albums__group">固定相簿</p>
            <p v-if="index === statusAlbums.length" class="photo-albums__group">我的相簿</p>
            <button type="button" class="album-choice" data-testid="album-choice" :data-album-id="album.id" :data-builtin="album.builtin ? 'true' : 'false'" :aria-pressed="expandedAlbumId === album.id" @click="toggleAlbum(album.id)">
              <span class="album-choice__cover" :class="{ 'album-choice__cover--status': album.builtin }">
                <svg v-if="album.builtin" viewBox="0 0 24 24" :fill="statusGlyph(album.id).filled ? 'currentColor' : 'none'" :stroke="statusGlyph(album.id).filled ? 'none' : 'currentColor'" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="statusGlyph(album.id).d" /><circle v-if="statusGlyph(album.id).circle" v-bind="statusGlyph(album.id).circle" /></svg>
                <template v-else><img v-if="urlOf(albumMembers(project, album.id)[0])" :src="urlOf(albumMembers(project, album.id)[0])" alt="" loading="lazy" /><svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="m3 16 6-6 5 5 3-3 4 4" /></svg></template>
              </span>
              <span class="album-choice__copy"><strong>{{ album.name || '未命名相簿' }}</strong><small>{{ albumMembers(project, album.id).length }} 张照片</small></span>
            </button>
          </template>
        </div>
        <p v-if="!albums.length" class="photo-albums__empty">暂无相簿</p>
      </aside>
      <main class="photo-library">
        <div v-if="photoTab === 'photos'" class="photo-library__content">
          <header class="photed__bar">
            <div class="photed__blockhead"><h2>全部照片</h2><span>{{ visibleLibraryPhotos.length }} 张</span></div>
            <div class="photo-view-tools">
              <label class="photo-sort"><span class="sr-only">照片排序</span><select v-model="photoSort" aria-label="照片排序"><option value="time">按拍摄时间</option><option value="name">按说明名称</option></select></label>
              <div class="photo-layout" aria-label="照片布局">
                <button type="button" :aria-pressed="photoLayout === 'grid'" aria-label="网格视图" title="网格视图" @click="photoLayout = 'grid'"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></svg></button>
                <button type="button" :aria-pressed="photoLayout === 'list'" aria-label="列表视图" title="列表视图" @click="photoLayout = 'list'"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M8 6h12M8 12h12M8 18h12M3 6h1M3 12h1M3 18h1" /></svg></button>
              </div>
            </div>
          </header>
          <!-- 批量条：勾了才有。地点尤其需要批量 —— 一批照片往往拍在同一个地方 -->
          <div v-if="selectedCount" class="photed__batch" data-testid="photo-batch">
            <div class="photed__batch-head">
              <button type="button" class="photed__link photed__link--detail" :aria-expanded="batchFieldsOpen" aria-controls="photo-batch-fields" data-testid="photo-batch-toggle" @click="batchFieldsOpen=!batchFieldsOpen">批量修改</button>
              <button type="button" class="photed__link" data-testid="photo-batch-all" @click="selectAll">全选</button>
              <strong class="photed__batch-count" data-testid="photo-batch-count">已选 {{ selectedCount }} 张</strong>
              <span class="photed__batch-gap"></span>
              <button type="button" class="photed__link photed__batch-clear" data-testid="photo-batch-clear" @click="clearSelection">取消</button>
              <button type="button" class="photed__link photed__link--danger" :disabled="readOnly" data-testid="photo-batch-remove" @click="removeSelected">删除</button>
            </div>
            <div v-show="batchFieldsOpen" id="photo-batch-fields" class="photo-batch-fields">
              <div class="photed__batch-row">
                <input
                  v-model="batchLocation"
                  class="photed__batch-input"
                  type="text"
                  :maxlength="LOCATION_MAX_LENGTH"
                  placeholder="地点，比如「学校 · 三号宿舍楼」"
                  :disabled="readOnly"
                  data-testid="photo-batch-location"
                  aria-label="批量修改地点（留空不改）"
                  @keydown.enter="applyBatchChanges"
                />
                <input
                  v-model="batchTime"
                  class="photed__batch-input"
                  type="datetime-local"
                  :disabled="readOnly"
                  data-testid="photo-batch-time"
                  aria-label="批量修改拍摄时间（留空不改）"
                  @keydown.enter="applyBatchChanges"
                />
                <AppButton
                  size="sm"
                  :disabled="readOnly || (!batchLocation.trim() && !batchTime)"
                  data-testid="photo-batch-apply"
                  @click="applyBatchChanges"
                >
                  应用到 {{ selectedCount }} 张
                </AppButton>
              </div>
              <p class="photed__batch-hint">留空的字段保持不变</p>
            </div>
          </div>

          <ul v-if="visibleLibraryPhotos.length" class="plist" :class="{ 'plist--list': photoLayout === 'list' }" data-testid="photo-list">
            <li v-for="photo in visibleLibraryPhotos" :key="photo.id" class="prow" data-testid="photo-row" :data-photo-id="photo.id" :data-favorite="photo.isFavorite ? 'true' : 'false'" :data-hidden="photo.isHidden ? 'true' : 'false'" :data-in-trash="photo.isInTrash ? 'true' : 'false'" :data-selected="isSelected(photo) ? 'true' : 'false'" :data-focused="photoInspectorOpen && selectedPhotoId === photo.id">
              <input class="prow__check" type="checkbox" :checked="isSelected(photo)" :disabled="readOnly" :aria-label="'选择「' + (photo.caption || '未填写说明') + '」'" data-testid="photo-select" @change="toggleSelect(photo)" />
              <button type="button" class="prow__thumb" :aria-label="'编辑照片：' + (photo.caption || '未填写说明')" :title="flagTitleOf(photo)" @click="selectedPhotoId = photo.id; photoInspectorOpen = true"><img v-if="urlOf(photo)" :src="urlOf(photo)" alt="" draggable="false" loading="lazy" /><span v-else class="prow__thumb-empty" aria-hidden="true"></span></button>
              <div class="prow__flags" aria-hidden="true"><span v-if="photo.isFavorite" class="prow__favorite-flag"><svg viewBox="0 0 24 24"><path d="M12 20.2l-1.2-1.1C6.5 15.2 3.8 12.7 3.8 9.6c0-2.3 1.8-4.1 4.1-4.1 1.4 0 2.7.7 3.9 2 1.2-1.3 2.5-2 3.9-2 2.3 0 4.1 1.8 4.1 4.1 0 3.1-2.7 5.6-7 9.5z" fill="currentColor" /></svg></span><span v-if="photo.isHidden" class="prow__hidden-flag"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.8 12C5.2 7.5 8.4 5.5 12 5.5s6.8 2 9.2 6.5c-2.4 4.5-5.6 6.5-9.2 6.5s-6.8-2-9.2-6.5Z" /><circle cx="12" cy="12" r="3.1" /><path d="M4.2 4.2 19.8 19.8" /></svg></span><span v-if="photo.isInTrash" class="prow__trash-flag"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 7h12M9.5 7V5.2h5V7M8 7l.7 12.2h6.6L16 7" /></svg></span></div>
              <button type="button" class="photo-open" @click="selectedPhotoId = photo.id; photoInspectorOpen = true"><strong>{{ photo.caption || '未填写说明' }}</strong><small>{{ photo.location || '未填写地点' }}</small></button>
            </li>
          </ul>
          <div v-else class="photed__empty" data-testid="photos-empty"><p>还没有照片。</p><p>点击右上方的「添加照片」，放进故事里的第一张照片。</p></div>
        </div>
        <section v-else class="album-management">
          <ul v-if="albums.length" class="alist" data-testid="album-list">
            <li v-for="album in albums.filter(a => a.id === expandedAlbumId)" :key="album.id" class="arow" data-testid="album-row" data-open="true">
              <header class="arow__head">
                <button type="button" class="album-back" aria-label="返回相簿列表" @click="backToAlbums"><span aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m14 6-6 6 6 6" /></svg></span></button>
                <h2 class="album-title">
                  <input v-if="renamingAlbumId === album.id" :ref="element => albumRenameInput = element" class="album-title__input" type="text" maxlength="30" :value="album.name" aria-label="相簿名称" data-testid="album-rename-input" @blur="commitAlbumName(album, $event)" @keydown.enter.prevent="$event.target.blur()" @keydown.esc.prevent="renamingAlbumId = null" />
                  <button v-else-if="!album.builtin" type="button" class="album-title__edit" :disabled="readOnly" aria-label="修改相簿名称" @click="beginRenameAlbum(album)">{{ album.name || '未命名相簿' }}</button>
                  <template v-else>{{ album.name }}</template>
                </h2><span class="album-count">{{ expanded.members.length }} 张照片</span>
                <div v-if="!album.builtin" class="arow__tools">
                  <DeleteIconButton class="photo-menu" label="删除相簿" :disabled="readOnly" data-testid="album-remove" @click="removeAlbum(album)" />
                </div>
              </header>
              <h3 class="arow__label">相簿中的照片 <span>{{ expanded.members.length }} 张</span></h3>
              <div v-if="expanded.members.length" class="arow__strip" data-testid="album-members">
                <article v-for="photo in expanded.members" :key="photo.id" class="album-photo"><button type="button" class="thumb" :disabled="readOnly" :aria-label="albumCopy.removeLabel + '：' + (photo.caption || '未填写说明')" :title="albumCopy.removeTip" @click="removeAlbumPhoto(album, photo)"><img v-if="urlOf(photo)" :src="urlOf(photo)" alt="" draggable="false" loading="lazy" /><span v-else class="thumb__empty"></span><span class="thumb__badge" aria-hidden="true">×</span></button><p>{{ photo.caption || '未填写说明' }}</p></article>
              </div>
              <p v-else class="photed__note">{{ albumCopy.emptyHint }}</p>
              <section v-if="expanded.candidates.length" class="album-candidates">
                <h3 class="arow__label" data-testid="album-candidates-heading">{{ albumCopy.addHeading }} <span>{{ expanded.candidates.length }} 张可选</span></h3>
                <div class="arow__strip"><article v-for="photo in expanded.candidates" :key="photo.id" class="album-photo"><button type="button" class="thumb thumb--add" :disabled="readOnly" :aria-label="albumCopy.addLabel + '：' + (photo.caption || '未填写说明')" :title="albumCopy.addTip" data-testid="album-candidate" @click="setAlbumMember(editor, album.id, photo.id, true)"><img v-if="urlOf(photo)" :src="urlOf(photo)" alt="" draggable="false" loading="lazy" /><span v-else class="thumb__empty"></span><span class="thumb__badge" aria-hidden="true">＋</span></button><p>{{ photo.caption || '未填写说明' }}</p><small>{{ albumCopy.addLabel }}</small></article></div>
              </section>
              <p class="album-footnote">{{ albumCopy.footnote }}</p>
            </li>
          </ul>
          <div v-else class="photed__empty"><p>还没有相簿。</p><p>点击右上方的「新建相簿」，把同一段故事的照片放在一起。</p></div>
        </section>
      </main>
      <InspectorPanel v-if="photoTab === 'photos'" v-model="photoInspectorOpen" title="照片详情" photo-layout :inline-at="1024">
        <template #header-actions><button type="button" class="photo-detail-close" aria-label="关闭照片详情" @click="$event.currentTarget.focus(); photoInspectorOpen = false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg></button></template>
        <div v-for="photo in visiblePhotoRecords" :key="photo.id" class="photo-inspector">
          <div class="photo-preview"><img v-if="urlOf(photo)" :src="urlOf(photo)" :alt="photo.caption || '选中的照片'" /></div>
          <div class="prow__fields">
            <label class="photo-field"><span>说明</span><textarea class="prow__caption" rows="2" :maxlength="CAPTION_MAX_LENGTH" placeholder="写下这张照片的故事" :value="captionValueOf(photo)" :disabled="readOnly" data-testid="photo-caption" @focus="onCaptionFocus(photo)" @input="onCaptionInput(photo, $event)" @change="commitCaption(photo, $event)" @blur="onCaptionBlur(photo)"></textarea></label>
            <div class="prow__meta"><label class="photo-field"><span>地点</span><input class="prow__location" type="text" :maxlength="LOCATION_MAX_LENGTH" placeholder="照片在哪里拍摄" :value="photo.location ?? ''" :disabled="readOnly" data-testid="photo-location" @change="commitLocation(photo, $event)" @keydown.enter="$event.target.blur()" /></label><label class="photo-field"><span>拍摄时间</span><input class="prow__time" type="datetime-local" :value="toDateTimeLocal(photo.displayTime)" :disabled="readOnly" data-testid="photo-time" @change="commitTime(photo, $event)" /></label><span v-if="!photo.displayTime" class="prow__warn">未设置时间，照片将排在最后。</span></div>
          </div>
        </div>
        <template #footer="{ close, wide }"><div class="photo-footer"><template v-for="photo in visiblePhotoRecords" :key="photo.id"><button type="button" class="prow__icon photo-favorite" :data-on="photo.isFavorite ? 'true' : 'false'" :aria-pressed="photo.isFavorite" :disabled="readOnly" :aria-label="photo.isFavorite ? '取消收藏' : '加入个人收藏'" @click="toggleFavorite(photo)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.2l-1.2-1.1C6.5 15.2 3.8 12.7 3.8 9.6c0-2.3 1.8-4.1 4.1-4.1 1.4 0 2.7.7 3.9 2 1.2-1.3 2.5-2 3.9-2 2.3 0 4.1 1.8 4.1 4.1 0 3.1-2.7 5.6-7 9.5z" :fill="photo.isFavorite ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" /></svg></button><button type="button" class="prow__icon photo-hidden" :data-on="photo.isHidden ? 'true' : 'false'" :aria-pressed="Boolean(photo.isHidden)" :disabled="readOnly" :aria-label="photo.isHidden ? '取消隐藏' : '隐藏这张照片'" :title="photo.isHidden ? '取消隐藏（照片回到图库与相簿）' : '隐藏这张照片（作品端收进已隐藏）'" data-testid="photo-hidden-toggle" @click="toggleHidden(photo)"><svg v-if="photo.isHidden" viewBox="0 0 24 24" aria-hidden="true"><path d="M2.8 12C5.2 7.5 8.4 5.5 12 5.5s6.8 2 9.2 6.5c-2.4 4.5-5.6 6.5-9.2 6.5s-6.8-2-9.2-6.5Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" /><circle cx="12" cy="12" r="3.1" fill="none" stroke="currentColor" stroke-width="1.5" /><path d="M4.2 4.2 19.8 19.8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" /></svg><svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="M2.8 12C5.2 7.5 8.4 5.5 12 5.5s6.8 2 9.2 6.5c-2.4 4.5-5.6 6.5-9.2 6.5s-6.8-2-9.2-6.5Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" /><circle cx="12" cy="12" r="3.1" fill="none" stroke="currentColor" stroke-width="1.5" /></svg></button><button type="button" class="prow__icon photo-trash" :data-on="photo.isInTrash ? 'true' : 'false'" :aria-pressed="Boolean(photo.isInTrash)" :disabled="readOnly" :aria-label="photo.isInTrash ? '从回收站恢复' : '移到回收站'" :title="photo.isInTrash ? '从回收站恢复' : '移到回收站（照片仍在项目里，可随时恢复）'" data-testid="photo-trash-toggle" @click="toggleTrash(photo)"><svg v-if="!photo.isInTrash" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 7h12M9.5 7V5.2h5V7M8 7l.7 12.2h6.6L16 7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg><svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="M4.6 11.4a7.6 7.6 0 1 1 2 6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" /><path d="M4.4 5.8v5.7h5.7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg></button><button type="button" class="prow__icon photo-danger photo-delete" :disabled="readOnly" aria-label="删除照片" data-testid="photo-remove" @click="removePhoto(photo)">删除照片</button></template><button v-if="!wide" type="button" class="photo-done" @click="$event.currentTarget.focus(); close()">完成</button></div></template>
      </InspectorPanel>
    </div>
    <footer class="photo-page-footer"><div class="photo-page-footer__usage"><span>{{ photos.length }} 张照片</span><span aria-hidden="true">·</span><span :data-tier="usageTier" data-testid="photos-usage">共{{ formatBytes(usedBytes) }}</span></div><p v-if="usageHint" class="photed__usagehint" :data-tier="usageTier">{{ usageHint }}</p></footer>
    <dialog ref="albumDialog" class="album-dialog" aria-labelledby="new-album-title" @cancel.prevent="closeAlbumForm" @click.self="closeAlbumForm">
      <form id="new-album-form" class="photed__newalbum" @submit.prevent="createAlbumFromForm"><header><h2 id="new-album-title">新建相簿</h2><button type="button" aria-label="关闭新建相簿" @click="closeAlbumForm">×</button></header><label for="new-album-name">相簿名称</label><AppInput id="new-album-name" ref="albumNameInput" v-model="newAlbumName" placeholder="比如「夏天」" maxlength="30" :disabled="readOnly" data-testid="album-name-input" /><footer><AppButton native-type="button" @click="closeAlbumForm">取消</AppButton><AppButton native-type="submit" variant="primary" :disabled="readOnly || !newAlbumName.trim()" data-testid="album-create">创建</AppButton></footer></form>
    </dialog>
  </section>
</template>

<style scoped>
.photed{--photo-header-space:clamp(0px,calc((100vw - 1024px) / 80),8px);padding:28px 28px 24px;width:100%;margin:0;min-height:calc(var(--creator-viewport-height,100dvh) - var(--layout-topbar-h,56px));min-width:0;display:flex;flex-direction:column;color:var(--c-text)}
.photo-page-title,.photo-page-title__label{display:flex;align-items:center;gap:16px;min-width:0}.photo-page-title{justify-content:space-between;margin-bottom:calc(4px + var(--photo-header-space))}.photo-page-title h1{font:600 24px/1.4 var(--font-story)}.photo-page-title__label>span{font-size:12px;color:var(--c-text-3);white-space:nowrap}
.photo-primary,.photed :deep(.photo-page-title .ui-btn){display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:34px;padding:6px 12px;border:1px solid var(--c-accent);border-radius:6px;background:var(--c-accent);color:var(--c-text-inverse);font-size:13px;font-weight:400;white-space:nowrap}.photo-primary svg,.photo-page-title :deep(svg){width:16px;height:16px;flex:none}.photo-primary:hover:not(:disabled){background:var(--c-accent-hover)}
.photo-tabs{display:flex;gap:24px;border-bottom:1px solid var(--c-border);margin-bottom:calc(20px + var(--photo-header-space))}.photo-tabs button{border:0;border-bottom:2px solid transparent;min-height:36px;padding:6px 2px;background:none;font-size:13px;color:var(--c-text)}.photo-tabs button[aria-selected=true]{font-weight:600;border-bottom-color:var(--c-text)}
.photo-workbench{display:grid;grid-template-columns:minmax(0,1fr);gap:24px;min-width:0;flex:1;align-items:start}.photo-workbench:has(.inspector-panel--inline:not(.inspector-panel--closed)){grid-template-columns:minmax(0,1fr) clamp(230px,27%,360px)}.photo-workbench[data-tab=albums]{grid-template-columns:clamp(150px,14%,200px) minmax(0,1fr);gap:20px}
.photo-library{min-width:0;display:flex;flex-direction:column;align-self:stretch;container-type:inline-size;container-name:photo-content}.photed__bar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px;min-height:32px}.photed__blockhead{display:flex;align-items:baseline;gap:12px;min-width:0}.photed__blockhead h2{font-size:14px;font-weight:400;white-space:nowrap}.photed__blockhead>span{font-size:12px;color:var(--c-text-3);white-space:nowrap}.photo-view-tools{display:flex;align-items:center;gap:16px}.photo-sort select{max-width:140px;min-height:32px;padding:4px 2px;border:0;background:transparent;color:var(--c-text-2);font:inherit;font-size:12px}.photo-layout{display:flex;align-items:center;gap:4px}.photo-layout button{display:grid;place-items:center;width:32px;height:32px;border:1px solid transparent;border-radius:5px;padding:6px;background:none;color:var(--c-text-2)}.photo-layout button[aria-pressed=true]{border-color:var(--c-border-strong);background:var(--c-white);color:var(--c-text)}.photo-layout svg{width:18px;height:18px}
.plist{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:20px 16px;list-style:none;padding:0;margin:0}.photo-workbench:has(.inspector-panel--inline:not(.inspector-panel--closed)) .plist{grid-template-columns:repeat(4,minmax(0,1fr))}.prow{position:relative;min-width:0}.prow__thumb{display:block;width:100%;aspect-ratio:1;border:0;border-radius:4px;padding:0;background:var(--c-bg-sunken);overflow:hidden}.prow__thumb img{display:block;width:100%;height:100%;object-fit:cover}.prow[data-selected=true] .prow__thumb{outline:1px solid var(--c-border-strong);outline-offset:3px}.prow__check{position:absolute;z-index:1;inset-block-start:9px;inset-inline-start:9px;width:16px;height:16px;min-height:0;margin:0;accent-color:var(--c-accent);cursor:pointer}.photo-open{display:grid;gap:3px;min-width:0;width:100%;padding:8px 0 0;border:0;background:transparent;color:var(--c-text);text-align:start}.photo-open strong{font-size:14px;line-height:1.5;font-weight:400;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.photo-open small{font-size:12px;line-height:1.5;color:var(--c-text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.photo-workbench .plist--list{grid-template-columns:minmax(0,1fr)!important;gap:0}.plist--list .prow{display:grid;grid-template-columns:64px minmax(0,1fr);align-items:center;gap:16px;padding:12px 0 12px 32px;border-bottom:1px solid var(--c-border)}.plist--list .prow__thumb{width:64px;height:64px}.plist--list .prow__check{inset-inline-start:0;inset-block-start:36px}.plist--list .photo-open{padding:0}
.photed__batch{margin:0 0 20px;padding:10px 12px;border:1px solid var(--c-border);border-radius:6px;background:var(--c-bg-sunken)}.photed__batch-head{display:flex;align-items:center;flex-wrap:wrap;gap:8px}.photed__link{border:0;border-radius:4px;background:none;padding:4px;font-size:12px;min-height:28px;color:var(--c-text-2)}.photed__link--danger{color:var(--c-danger)}.photed__batch-count{font-size:12px;font-weight:500;color:var(--c-text-2)}.photed__batch-gap{flex:1}.photed__batch-row{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-top:12px}.photed__batch-input{flex:1;min-width:0;min-height:34px;padding:6px 10px;border:1px solid var(--c-border-strong);border-radius:5px;background:white;font:inherit;font-size:13px}.photed__batch-row :deep(.ui-btn){min-height:34px;font-size:12px}.photed__batch-hint{font-size:12px;color:var(--c-text-3)}
.photed__ro,.photed__progress,.photed__usagehint,.photed__failures{font-size:12px;line-height:1.7;color:var(--c-warning);margin-bottom:16px}.photed__empty{min-height:280px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;text-align:center;font-size:14px;line-height:1.8;color:var(--c-text-3);padding:24px}.photed__empty p+p{font-size:13px}.photed__note{font-size:13px;line-height:1.8;color:var(--c-text-3);padding:20px 0}.photo-page-footer{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 20px;margin-top:20px;padding-top:0;padding-bottom:0;font-size:12px;line-height:1.6;color:var(--c-text-3)}
.photed :deep(.inspector-panel--photo.inspector-panel--inline){width:100%;position:sticky;top:24px;align-self:start;display:flex;flex-direction:column;gap:0;height:auto;max-height:calc(var(--creator-viewport-height,100dvh) - var(--layout-topbar-h,56px) - 148px);overflow:auto;grid-template-rows:none;box-shadow:none;border:0;border-inline-start:1px solid var(--c-border);border-radius:0;padding:0 4px 0 24px;background:white}.photed :deep(.inspector-panel--photo.inspector-panel--closed){display:none}.photed :deep(.inspector-panel__head){margin-bottom:16px;min-height:32px}.photed :deep(.inspector-panel__head h3){font:600 16px/1.5 var(--font-story)}.photo-detail-close{display:grid;place-items:center;margin-inline-start:auto;width:32px;height:32px;padding:0;border:0;border-radius:4px;background:none;color:var(--c-text-2)}.photo-detail-close svg{width:18px;height:18px}
.photo-inspector{min-width:0}.photo-preview{aspect-ratio:1.5;display:grid;place-items:center;margin-bottom:20px;min-width:0;min-height:0;overflow:hidden;border-radius:4px;background:var(--c-bg-sunken)}.photo-preview img{display:block;width:100%;height:100%;object-fit:contain}.prow__fields,.prow__meta{display:grid;gap:16px;min-width:0}.photo-field{display:grid;gap:6px;font-size:12px;line-height:1.5;color:var(--c-text-2);min-width:0}.photo-field input,.photo-field textarea{width:100%;min-width:0;min-height:34px;padding:6px 9px;border:1px solid var(--c-border-strong);border-radius:5px;background:white;font:inherit;font-size:13px;line-height:1.6;color:var(--c-text)}.photo-field textarea{resize:vertical;min-height:52px}.prow__warn{font-size:12px;color:var(--c-warning)}.photo-footer{display:flex;align-items:center;gap:12px;margin-top:24px;padding-top:0;flex:none}.prow__icon{display:inline-flex;align-items:center;gap:6px;padding:4px 0;min-height:32px;border:0;background:none;color:var(--c-text);font-size:13px}.prow__icon svg{width:18px;height:18px}.photo-favorite{justify-content:center;width:32px;height:32px;min-height:32px;flex:none;margin-inline-start:0}.photo-favorite + .photo-detail-close{margin-inline-start:0}.photo-favorite[data-on=true]{color:var(--c-detail-text)}.photo-footer .photo-delete{margin-inline-start:auto}.photo-done{padding:6px 12px;border:0;border-radius:6px;background:var(--c-accent);color:white;min-height:34px;font-size:13px}
.photo-menu{position:relative}.photo-danger{color:var(--c-danger)}
.photo-albums{padding-inline-end:8px;min-width:0;border-inline-end:1px solid var(--c-border);align-self:stretch}.photo-albums__head{display:flex;align-items:center;gap:12px;min-height:32px;margin:0 0 12px 8px}.photo-albums__head h2{font-size:14px;font-weight:600}.photo-albums__head>span{font-size:12px;color:var(--c-text-3)}.photo-albums__list{display:grid;gap:4px}.album-choice{display:flex;align-items:center;width:100%;min-width:0;gap:10px;padding:8px;border:0;border-radius:8px;text-align:start;color:var(--c-text);background:none}.album-choice[aria-pressed=true]{background:color-mix(in srgb,var(--c-detail) 4%,var(--c-white))}.album-choice__cover{display:grid;place-items:center;width:40px;height:40px;flex:none;border-radius:4px;background:var(--c-bg-sunken);overflow:hidden;color:var(--c-text-3)}.album-choice__cover img{width:100%;height:100%;object-fit:cover}.album-choice__cover svg{width:20px;height:20px}.album-choice__copy{display:grid;gap:3px;min-width:0}.album-choice strong{font-size:14px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.album-choice small{font-size:12px;color:var(--c-text-3)}.photo-albums__empty{font-size:13px;text-align:center;padding:40px 8px;color:var(--c-text-3)}
.photo-albums__group{font-size:11px;line-height:1.6;color:var(--c-text-3);margin:6px 8px 2px;padding:0}
.album-choice__cover--status{background:var(--c-selected);color:var(--c-detail-text)}
@media(max-width:767px){.photo-albums__group{display:none}}
.alist{list-style:none;margin:0;padding:0}.arow__head{display:flex;align-items:center;gap:12px;min-height:32px;margin-bottom:16px}.arow__head h2{font:600 24px/1.4 var(--font-story);overflow-wrap:anywhere;min-width:0}.arow__head>span{font-size:12px;color:var(--c-text-3);white-space:nowrap}.arow__tools{display:flex;align-items:center;gap:12px;margin-inline-start:auto;flex:none}.photo-text-action{border:0;border-radius:4px;padding:5px 0;min-height:32px;font-size:13px;background:none;color:var(--c-text-2)}.arow__rename{display:grid;gap:6px;font-size:13px;max-width:360px;margin-bottom:20px}.arow__rename input{width:100%;min-width:0;min-height:34px;padding:6px 9px;border:1px solid var(--c-border-strong);border-radius:5px;font:inherit}.arow__label{font-size:14px;font-weight:600;line-height:1.5;margin-bottom:14px;display:flex;align-items:baseline;gap:12px}.arow__label>span{font-size:12px;color:var(--c-text-3);font-weight:400}.arow__strip{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:18px 14px}.album-photo{min-width:0}.thumb{position:relative;display:block;width:100%;aspect-ratio:1;padding:0;border:0;border-radius:4px;background:var(--c-bg-sunken);overflow:hidden}.thumb img{display:block;width:100%;height:100%;object-fit:cover}.thumb__badge{display:grid;place-items:center;position:absolute;inset-inline-end:8px;inset-block-start:8px;width:24px;height:24px;border-radius:50%;background:white;color:var(--c-text-2);font:400 18px/1 var(--font-sans);box-shadow:0 1px 4px #0001}.album-photo p{font-size:14px;line-height:1.5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:7px}.album-photo small{display:block;font-size:12px;line-height:1.5;color:var(--c-text-3);margin-top:3px}.album-candidates{border-top:1px solid var(--c-border);margin-top:24px;padding-top:18px}.album-footnote{font-size:12px;line-height:1.7;color:var(--c-text-3);margin-top:24px}
.album-dialog{width:min(400px,calc(100vw - 32px));padding:24px;border:1px solid var(--c-border);border-radius:10px;background:white;color:var(--c-text);box-shadow:var(--shadow-md)}.album-dialog::backdrop{background:#20232140}.photed__newalbum{display:grid;gap:12px}.photed__newalbum header{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;gap:16px}.photed__newalbum h2{font-size:18px;font-weight:600}.photed__newalbum header button{width:32px;height:32px;background:none;border:0;font-size:22px;color:var(--c-text-3)}.photed__newalbum label{font-size:13px}.photed__newalbum footer{display:flex;justify-content:flex-end;gap:8px;margin-top:8px}.photed__newalbum :deep(.ui-input){min-width:0;width:100%}.photed__newalbum :deep(.ui-btn){min-height:34px;font-size:13px;padding:6px 12px}
.photed button:disabled{opacity:.45;cursor:not-allowed}.photed button:not(:disabled){cursor:pointer}.photo-open:hover strong,.photo-text-action:hover:not(:disabled){color:var(--c-detail-text)}.album-choice:hover{background:color-mix(in srgb,var(--c-detail) 4%,var(--c-white))}.photo-layout button:hover{background:var(--c-bg-sunken)}
@container photo-content (min-width:960px){.photo-workbench:has(.inspector-panel--inline:not(.inspector-panel--closed)) .plist{grid-template-columns:repeat(5,minmax(0,1fr))}}
@container photo-content (min-width:1200px){.photo-workbench:has(.inspector-panel--inline:not(.inspector-panel--closed)) .plist{grid-template-columns:repeat(6,minmax(0,1fr))}}
@container photo-content (min-width:1440px){.photo-workbench:has(.inspector-panel--inline:not(.inspector-panel--closed)) .plist{grid-template-columns:repeat(7,minmax(0,1fr))}}
@container photo-content (min-width:1120px){.arow__strip{grid-template-columns:repeat(7,minmax(0,1fr))}}
@container photo-content (max-width:620px){.arow__strip{grid-template-columns:repeat(4,minmax(0,1fr))}}
@container photo-content (max-width:480px){.arow__strip{grid-template-columns:repeat(3,minmax(0,1fr))}}
@container photo-content (max-width:360px){.arow__strip{grid-template-columns:repeat(2,minmax(0,1fr))}}

@media(max-width:1023px){.photed{padding:24px}.photo-workbench[data-tab=albums]{grid-template-columns:160px minmax(0,1fr)}.photo-inspector{display:grid;grid-template-rows:minmax(0,1fr) auto;gap:16px;min-height:0}.photo-preview{aspect-ratio:auto;margin:0;min-height:80px;position:relative}.photo-preview img{position:absolute;inset:0;object-fit:contain}.photo-footer{padding:0;margin:0}.photed :deep(.inspector-panel--photo){border-radius:10px}.photed :deep(.inspector-panel__head){margin-bottom:0}}
@media(max-width:767px){.photed{padding:24px 16px;min-height:calc(var(--creator-viewport-height,100dvh) - var(--layout-topbar-h,56px))}.photo-page-title{gap:12px;margin-bottom:10px}.photo-page-title h1{font-size:22px}.photo-page-title__label{gap:10px}.photo-page-title__label>span{font-size:12px}.photo-primary,.photed :deep(.photo-page-title .ui-btn){min-height:34px;padding:6px 10px;font-size:12px}.photo-tabs{gap:24px;margin-bottom:20px}.photo-tabs button{min-height:40px}.photo-workbench,.photo-workbench[data-tab=albums]{display:block}.photo-albums{border:0;padding:0;margin-bottom:24px}.photo-albums__head{margin-inline-start:0}.photo-albums__list{display:flex;overflow-x:auto;gap:8px;scrollbar-width:none}.album-choice{width:auto;min-width:124px;max-width:180px;flex:none;padding:8px}.photo-albums__empty{padding:16px 0;text-align:start}.photed__bar{gap:8px;margin-bottom:16px}.photo-view-tools{gap:8px}.photed__blockhead{gap:8px}.photed__blockhead h2{font-size:13px}.photo-sort select{font-size:12px;max-width:112px}.photo-layout{gap:0}.photo-layout button{width:30px;height:32px;padding:6px}.plist{grid-template-columns:repeat(3,minmax(0,1fr));gap:20px 12px}.photo-open{padding-top:7px}.photo-open strong{font-size:13px}.photo-open small{font-size:12px}.prow__check{width:18px;height:18px}.photed__batch{padding:8px}.photed__batch-head{gap:4px}.photed__link{min-height:32px}.photed__batch-row{align-items:stretch;flex-direction:column;gap:8px}.photed__batch-input{flex:auto;font-size:16px;min-height:36px}.photed__batch-row :deep(.ui-btn){min-height:36px}.photed__empty{min-height:240px;padding:16px}.photo-page-footer{margin-top:24px;padding-top:8px;padding-bottom:0}.arow__head{gap:8px;margin-bottom:20px;flex-wrap:wrap}.arow__head h2{font-size:22px}.arow__tools{gap:10px}.photo-text-action{font-size:12px}.arow__strip{gap:18px 12px}.thumb__badge{width:26px;height:26px;inset-inline-end:6px;inset-block-start:6px}.photo-field input,.photo-field textarea,.arow__rename input,.photed__newalbum :deep(.ui-input){font-size:16px;min-height:36px}.photo-field textarea{min-height:64px}.photo-field{gap:5px}.prow__fields,.prow__meta{gap:12px}.photo-inspector{gap:14px}.photed :deep(.inspector-panel--photo){border-radius:14px 14px 0 0}.photo-footer{gap:16px}.photo-footer .photo-delete{margin-inline-start:auto}.photo-preview{min-height:48px}.album-dialog{padding:20px}.photed__newalbum footer :deep(.ui-btn){min-height:36px}}
@media(max-width:359px){.photed{padding-inline:12px}.photo-page-title__label{gap:8px}.photo-view-tools{gap:4px}.photo-layout button{width:26px}.photo-sort select{max-width:100px}.photed__blockhead{gap:5px}}

.photo-page-footer__usage{display:flex;flex-wrap:wrap;gap:5px}.photo-page-footer .photed__usagehint{margin:0;text-align:end}
.photo-layout{gap:0;flex:none;padding:0;border:1px solid var(--c-border);border-radius:9px;background:var(--c-white)}
.photo-layout button{border:0;border-radius:6px;background:transparent;color:var(--c-text-2)}
.photo-layout button[aria-pressed=true],.photo-layout button[aria-pressed=true]:hover{background:var(--c-selected);color:var(--c-text)}
.photo-layout button:not([aria-pressed=true]):hover{background:var(--c-bg-sunken)}
.photed__batch-head{gap:12px;align-items:center}
.photed__batch-head .photed__link,.photed__batch-count{display:inline-flex;align-items:center;gap:4px;min-height:28px;padding:4px 0;font:400 13px/20px var(--font-sans);color:var(--c-text-2)}
.photed__batch-head .photed__link--danger{color:var(--c-danger)}
.photed__batch-head .photed__link--detail{color:var(--c-detail-text)}
.photed__batch-count{font-weight:500}
.photed__batch-row{flex-wrap:nowrap}
.photed__batch-row .ui-btn{flex:none;white-space:nowrap}
.photed__batch-hint{margin:6px 0 0;line-height:1.5}
@media(min-width:768px){.photed__batch-input,.photed__batch-row :deep(.ui-btn){height:34px;min-height:34px;box-sizing:border-box}.photed__batch-head .photed__link,.photed__batch-count{height:28px;box-sizing:border-box}}
@media(max-width:767px){.photed__batch-head{gap:10px}.photed__batch-head .photed__link,.photed__batch-count{font-size:12px;line-height:20px;height:28px;min-height:28px;box-sizing:border-box}.photed__batch-input{font-size:14px;line-height:20px;height:36px;min-height:36px;box-sizing:border-box}.photed__batch-row :deep(.ui-btn){font-size:12px;height:34px;min-height:34px}.photed__batch-hint{font-size:12px}}
@media(max-width:767px){.photo-albums__empty{display:none}}
@media(min-width:1024px){
  .photo-albums__empty{flex:1;display:grid;place-items:center;padding:0 8px;margin:0}
  .album-management:has(>.photed__empty){display:flex;flex-direction:column}
  .album-management>.photed__empty{flex:1}
  .photed{height:calc(var(--creator-viewport-height,100dvh) - var(--layout-topbar-h,56px));min-height:0;overflow:hidden;padding-bottom:8px}
  .photo-page-footer{margin-top:8px}
  .photo-page-title,.photo-tabs,.photo-page-footer,.photed__progress,.photed__ro,.photed__failures{flex:none}
  .photo-workbench{min-height:0;grid-template-rows:minmax(0,1fr);align-items:stretch}
  .photo-library{min-height:0}
  .photo-library__content{display:flex;flex-direction:column;flex:1;min-height:0}
  .photed__bar,.photed__batch{flex:none}
  .plist{row-gap:clamp(24px,1.65vw,28px)}
  .arow__head{margin-bottom:clamp(20px,1.4vw,24px)}
  .arow__label{margin-bottom:clamp(16px,1.05vw,18px)}
  .plist{flex:1;min-height:0;overflow-y:auto;align-content:start;padding:4px 6px 4px 4px;margin:-4px;scrollbar-width:thin;scrollbar-color:var(--c-border-strong) transparent;overscroll-behavior:contain}
  .photed :deep(.inspector-panel--photo.inspector-panel--inline){position:static;top:auto;align-self:start;max-height:100%}
  .photo-inspector{display:flex;flex-direction:column;min-height:0;flex:0 1 auto}
  .photo-preview{position:relative;flex:none;aspect-ratio:auto;height:clamp(150px,28dvh,320px);min-height:0;max-height:320px;background:transparent}
  .photo-preview img{position:static;width:auto;height:auto;max-width:100%;max-height:clamp(150px,28dvh,320px);object-fit:contain}
  .prow__fields{flex:none}
  .photo-albums{display:flex;flex-direction:column;min-height:0}
  .photo-albums__list{overflow-y:auto;min-height:0;scrollbar-width:thin}
  .album-management{overflow-y:auto;min-height:0;flex:1;padding-inline-end:4px;scrollbar-width:thin;overscroll-behavior:contain}
}

.prow__flags{position:absolute;z-index:1;inset-block-start:9px;inset-inline-end:9px;display:flex;gap:4px;pointer-events:none}
.prow__flags span{display:grid;place-items:center;flex:none;width:20px;height:20px;border-radius:50%;background:var(--c-white);box-shadow:0 1px 4px #0001;color:var(--c-text-3)}
.prow__flags svg{width:12px;height:12px}
.prow[data-in-trash=true] .prow__thumb,.prow[data-hidden=true] .prow__thumb{opacity:.55}
.prow[data-in-trash=true] .photo-open strong,.prow[data-hidden=true] .photo-open strong{color:var(--c-text-3)}
.photo-trash,.photo-hidden{justify-content:center;width:32px;height:32px;min-height:32px;flex:none}
.photo-trash[data-on=true],.photo-hidden[data-on=true]{color:var(--c-detail-text)}
.album-back{display:none}
.album-title__edit{display:block;max-width:100%;padding:0;border:0;background:none;color:inherit;font:inherit;text-align:start;overflow-wrap:anywhere}
.album-title__input{width:100%;min-width:0;min-height:36px;padding:0 6px;border:1px solid var(--c-border-strong);border-radius:5px;background:var(--c-white);color:inherit;font:inherit}
@media(max-width:767px){
  .photed[data-album-detail=true]>.photo-page-title,.photed[data-album-detail=true]>.photo-tabs{display:none}
  .arow__head{display:grid;grid-template-columns:28px minmax(0,1fr) auto;gap:2px 10px;margin-bottom:28px}
  .arow__head .album-title{grid-column:2;grid-row:1}
  .arow__head .album-count{grid-column:2;grid-row:2}
  .arow__tools{grid-column:3;grid-row:1}
  .photo-workbench[data-tab=albums][data-album-detail=true]>.photo-albums,
  .photo-workbench[data-tab=albums][data-album-detail=false]>.photo-library{display:none}
  .photo-albums{margin-bottom:0}
  .photo-albums__list{display:grid;grid-template-columns:minmax(0,1fr);overflow:visible;gap:8px}
  .photo-albums__group{display:block}
  .album-choice{width:100%;min-width:0;max-width:none;min-height:64px;gap:14px;padding:12px 8px}
  .album-choice__copy{flex:1}
  .album-back{display:flex;align-items:center;justify-content:center;grid-column:1;grid-row:1;min-height:44px;margin:0;padding:0;border:0;background:none;color:var(--c-text);font:inherit;font-size:14px}
  .album-back>span{display:grid;place-items:center;width:28px;height:28px;border:1px solid var(--c-border);border-radius:50%;flex:none}
}
</style>
