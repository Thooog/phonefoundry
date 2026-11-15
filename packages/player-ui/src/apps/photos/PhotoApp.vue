

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import {
  buildPhotoGallery,
  buildAlbums,
  buildAlbumPhotos,
  TRASH_ALBUM_ID,
  HIDDEN_ALBUM_ID,
  resolvePhotoLock,
  formatPhotoWeekdayTime,
  TIME_FORMAT,
} from '@phone-sim/shared'
import ScrollArea from '../../appkit/ScrollArea.vue'
import EmptyState from '../../appkit/EmptyState.vue'
import PasscodePad from '../../kernel/PasscodePad.vue'
import { usePhoneRuntime, useWorkData } from '../../kernel/create-runtime.js'
import { useTapFeedback } from '../../kernel/use-tap-feedback.js'

const runtime = usePhoneRuntime()
const { getWork, resolveAsset } = useWorkData()
const { pinged, pingDown, pingUp, ping } = useTapFeedback()

const work = computed(() => getWork())
const settings = computed(() => work.value?.workSettings ?? {})
const timeFormat = computed(() => settings.value.timeFormat ?? TIME_FORMAT.H24)
const storyDate = computed(() => settings.value.storyDate ?? null)
const viewOptions = computed(() => ({
  storyDate: storyDate.value,
  timeFormat: timeFormat.value,
}))

/* ── 导航 ─────────────────────────────────────────── */
const screen = computed(() => runtime.currentScreen.value)
const screenName = computed(() => screen.value?.name ?? 'root')
const isViewer = computed(() => screenName.value === 'photo')
const albumParam = computed(() =>
  screenName.value === 'album' ? (screen.value?.params ?? null) : null,
)
const isAlbum = computed(() => Boolean(albumParam.value))

const instantNav = ref(false)
const direction = computed(() => {
  if (instantNav.value) return 'none'
  return runtime.state.transition === 'pop' ? 'pop' : 'push'
})

const tab = ref('gallery')

function setTab(next) {
  tab.value = next
}

function openAlbum(albumId) {
  if (albumId) runtime.push('album', albumId)
}

/*
 * 相簿入口闸门。
 *
 * 「已隐藏」「最近删除」在创作台设了密码后，点进去先验一次 —— 成功才推相簿屏。
 * 三条判定，顺序不能反：
 *   1. 不是这两本内置相簿 / 没上锁  → 直接进（普通相簿永远不拦）。
 *   2. 本轮已经解锁过            → 直接进（同一轮里反复进出不该反复问）。
 *   3. 其余                      → 弹密码盘，成功后再推。
 *
 * 解锁态记在 runtime（create-runtime.js 的 photoUnlocked）：组件会被 AppHost
 * 整层卸载，放本地 ref 会"退出应用再进来又要输一遍"，而 iOS 恰恰是那一步才重新验证。
 */
const lockPrompt = ref(null) // { kind: 'hidden'|'trash', albumId }

function isLockableAlbum(albumId) {
  return albumId === HIDDEN_ALBUM_ID || albumId === TRASH_ALBUM_ID
}

function requestAlbum(albumId) {
  if (!isLockableAlbum(albumId)) {
    openAlbum(albumId)
    return
  }
  const kind = albumId === HIDDEN_ALBUM_ID ? 'hidden' : 'trash'
  const lock = resolvePhotoLock(settings.value, kind)
  // 没上锁（开关关着 / 密码没填满）→ 和老版本一样直接进
  if (!lock.active || runtime.state.photoUnlocked[kind]) {
    openAlbum(albumId)
    return
  }
  lockPrompt.value = { kind, albumId }
}

/** 当前密码盘的参数：只在 lockPrompt 存在时有意义 */
const lockState = computed(() => {
  if (!lockPrompt.value) return null
  const lock = resolvePhotoLock(settings.value, lockPrompt.value.kind)
  return {
    kind: lockPrompt.value.kind,
    expected: lock.passcode,
    length: lock.length,
    hint:
      lockPrompt.value.kind === 'hidden'
        ? '输入密码以查看「已隐藏」相簿'
        : '输入密码以查看「最近删除」相簿',
  }
})

const albumLocked = computed(() => ({
  hidden: resolvePhotoLock(settings.value, 'hidden').active,
  trash: resolvePhotoLock(settings.value, 'trash').active,
}))

function onLockSuccess() {
  const prompt = lockPrompt.value
  if (!prompt) return

  runtime.state.photoUnlocked = { ...runtime.state.photoUnlocked, [prompt.kind]: true }

  instantNav.value = true
  lockPrompt.value = null
  openAlbum(prompt.albumId)
  // 下一帧就要把名字还回去，否则之后返回/再进相簿全都不动效
  nextTick(() => {
    instantNav.value = false
  })
}

function onLockCancel() {
  lockPrompt.value = null
}

function goBack() {
  runtime.pop()
}

/** 回桌面：点顶部标题（与 KakaoTalk / X / 电话同一套出口约定） */
function goHome() {
  runtime.goHome()
}

/* ── 数据 ─────────────────────────────────────────── */
/**
 * 只读作品数据 + 玩家标记，合成一份「带标记的 work」再交给 select 层。
 *
 * 作品端不写回数据（PhoneSimulator 的职责边界），查看器里的收藏/删除记在
 * runtime.state.photoFlags 里。这里每层都展开成新对象，原始 work 一个字段都不改；
 * 也正因为走的是同一套 build*，点完按钮后图库、相簿列表、相簿详情会一起变，
 * 不需要手工同步第二份派生数据。
 */
const effectiveWork = computed(() => {
  const source = work.value
  if (!source) return null
  const flags = runtime.state.photoFlags
  if (Object.keys(flags).length === 0) return source
  const bucket = source.appData?.photos
  if (!bucket || !Array.isArray(bucket.photos)) return source
  return {
    ...source,
    appData: {
      ...source.appData,
      photos: {
        ...bucket,
        photos: bucket.photos.map((photo) =>
          flags[photo.id] ? { ...photo, ...flags[photo.id] } : photo,
        ),
      },
    },
  }
})

const gallery = computed(() =>
  effectiveWork.value
    ? buildPhotoGallery(effectiveWork.value, viewOptions.value)
    : { total: 0, groups: [] },
)
const albums = computed(() => (effectiveWork.value ? buildAlbums(effectiveWork.value) : []))
const activeAlbum = computed(() => albums.value.find((a) => a.id === albumParam.value) ?? null)
/** 「最近删除」是常驻入口，空的时候也要给出对应的空态文案，而不是「相簿里的照片被删除后」 */
const isTrashAlbum = computed(() => albumParam.value === TRASH_ALBUM_ID)
/** 「已隐藏」也是常驻入口，逻辑与最近删除完全一致，只是招牌不同 */
const isHiddenAlbum = computed(() => albumParam.value === HIDDEN_ALBUM_ID)
const albumPhotos = computed(() =>
  effectiveWork.value && albumParam.value
    ? buildAlbumPhotos(effectiveWork.value, albumParam.value, viewOptions.value)
    : [],
)

/* ── 搜索 ─────────────────────────────────────────────
 * 作品端没有全文索引，也没有人物/场景标签，能匹配的只有三样：
 * 照片的说明、拍摄地点、以及月份标题（"10月"这种）。
 * 地点必须一起搜 —— 它是查看器标题行的可见文案，
 * 搜「厦门」搜不到"厦门 · 环岛路"那张，用户只会认为搜索坏了。
 * 不匹配就等于没结果，不做模糊猜测 —— 搜不到时明说搜的是什么，
 * 比返回一堆"可能相关"的东西更可信。
 */
const searching = ref(false)
const query = ref('')
const searchInput = ref(null)
const keyword = computed(() => query.value.trim().toLowerCase())

function openSearch() {
  searching.value = true
  // 输入框所在的模板片段是 v-if 换出来的，要等它挂上才能聚焦
  nextTick(() => searchInput.value?.focus())
}

function closeSearch() {
  searching.value = false
  query.value = ''
}

function matchesKeyword(item, q) {
  return (
    (item.caption ?? '').toLowerCase().includes(q) ||
    (item.location ?? '').toLowerCase().includes(q)
  )
}

/**
 * 图库的搜索结果：月份标题命中就整组留下（搜"10月"应该给出那个月的全部照片），
 * 否则只留说明或地点里带关键词的那些。空组直接丢掉 —— 留着一串光秃秃的月份标题，
 * 看起来像加载失败。
 */
const galleryView = computed(() => {
  const q = keyword.value
  if (!q) return gallery.value
  const groups = gallery.value.groups
    .map((group) =>
      group.title.toLowerCase().includes(q)
        ? group
        : { ...group, items: group.items.filter((item) => matchesKeyword(item, q)) },
    )
    .filter((group) => group.items.length > 0)
  return { total: groups.reduce((sum, group) => sum + group.items.length, 0), groups }
})

const gallerySections = computed(() => {
  let start = 0
  return galleryView.value.groups.map((group) => {
    const section = { ...group, startIndex: start }
    start += group.items.length
    return section
  })
})

const galleryPhotos = computed(() => gallerySections.value.flatMap((section) => section.items))

/** 相簿页的搜索结果：只按相簿名匹配 —— 相簿里有多少张是另一回事，不在这里展开 */
const albumsView = computed(() => {
  const q = keyword.value
  if (!q) return albums.value
  return albums.value.filter((album) => album.name.toLowerCase().includes(q))
})

/**
 * 相簿网格只列"能打开看照片"的相簿。
 *
 * 「最近删除」虽然也是由照片标记派生出来的视图，但它不是一本相簿 ——
 * 它是一条去往回收区的路，混在网格里会和真相簿抢位置，而且它只会越用越少。
 * 版式上把它挪到网格末尾的「更多项目」，这里只负责把它从网格里摘出去。
 * 数据层不动：它仍在 buildAlbums 的末位，详情页照旧按 id 打开。
 */
const gridAlbums = computed(() =>
  albumsView.value.filter((a) => a.id !== TRASH_ALBUM_ID && a.id !== HIDDEN_ALBUM_ID),
)
const trashAlbum = computed(() => albums.value.find((a) => a.id === TRASH_ALBUM_ID) ?? null)
const hiddenAlbum = computed(() => albums.value.find((a) => a.id === HIDDEN_ALBUM_ID) ?? null)
/**
 * 「更多项目」里挂的是几条由照片标记派生、不占网格卡位的入口（最近删除 / 已隐藏）。
 * 搜索时按名字各自判定：搜不到就该连这条入口一起收起，不会出现"标题在、点开空白"的死链接。
 */
const showMoreSection = computed(() =>
  [trashAlbum.value, hiddenAlbum.value].some(
    (a) => a && albumsView.value.some((x) => x.id === a.id),
  ),
)

/**
 * 视图模型只带 imageAssetId，url 在这里现算。
 * 不放进 select 层：那一层必须能在 Node 里跑测试，不能知道 assets 表。
 */
function urlOf(view) {
  const id = view?.imageAssetId
  if (!id) return null
  try {
    return resolveAsset(id) || null
  } catch {
    return null
  }
}

/**
 * 相簿封面：把成员的前几张图的 url 取出来，取不到的丢掉。
 * 丢掉而不是塞空字符串 —— <img src=""> 在 Chrome 里会画一个破图标，
 * 灰底空块反而更像"这里就是没有图"。
 */
function coverUrls(album) {
  return (album?.coverImageAssetIds ?? [])
    .map((id) => urlOf({ imageAssetId: id }))
    .filter(Boolean)
}

/* ── 查看器 ───────────────────────────────────────── */
const viewerList = ref([])
const viewerIndex = ref(0)
const pagerEl = ref(null)
const thumbsEl = ref(null)
const chromeOn = ref(true)
let scrollRaf = 0

const currentPhoto = computed(() => viewerList.value[viewerIndex.value] ?? null)

/* ── 玩家标记：收藏 / 移到回收站 ─────────────────────
 * 作品数据只读，改动记在 runtime.state.photoFlags（见 create-runtime.js），
 * 由 effectiveWork 合成进所有派生结果。所以这两个函数不碰 viewerList 之外的
 * 任何一份列表，图库/相簿/相簿详情会自己跟着变。
 */
function setPhotoFlag(id, patch) {
  if (!id) return
  const flags = runtime.state.photoFlags
  // 整对象替换：依赖它的 computed 一定会重算，不去猜嵌套属性的追踪边界
  runtime.state.photoFlags = { ...flags, [id]: { ...(flags[id] ?? {}), ...patch } }
}

/** viewerList 是打开时的快照，收藏 / 回收站态不能只读快照上的字段 */
const currentFlags = computed(() => runtime.state.photoFlags[currentPhoto.value?.id] ?? null)
const isCurrentFavorite = computed(
  () => currentFlags.value?.isFavorite ?? Boolean(currentPhoto.value?.isFavorite),
)

const isCurrentInTrash = computed(() => Boolean(currentPhoto.value?.isInTrash))

const isCurrentHidden = computed(() => Boolean(currentPhoto.value?.isHidden))

/** 爱心：收藏 / 再点一次取消，与真机一致 */
function onFavorite() {
  ping('favorite')
  const photo = currentPhoto.value
  if (photo) setPhotoFlag(photo.id, { isFavorite: !isCurrentFavorite.value })
}

function dropFromViewer(photoId) {
  const rest = viewerList.value.filter((item) => item.id !== photoId)
  if (rest.length === 0) {
    closeViewer()
    return
  }
  const index = Math.min(viewerIndex.value, rest.length - 1)
  viewerList.value = rest
  viewerIndex.value = index
  nextTick(() => {
    requestAnimationFrame(() => {
      const el = pagerEl.value
      if (el) el.scrollLeft = el.clientWidth * index
      syncThumbs('auto')
    })
  })
}

/**
 * 删除 = 打 isInTrash 软删除标记，记录与图片资源都留着，回收站相簿会接住它。
 * 回收站里的照片不显示这个按钮（换成还原），这里再挡一次是为了键盘 / 快速连点。
 */
function onTrash() {
  ping('trash')
  const photo = currentPhoto.value
  if (!photo || isCurrentInTrash.value) return
  setPhotoFlag(photo.id, { isInTrash: true })
  dropFromViewer(photo.id)
}

/**
 * 还原 = 把覆盖层里的 isInTrash 置回 false（作品数据本身带标记的也一样生效）。
 * 照片随即回到图库、原相簿与「个人收藏」，并从回收站相簿的查看器里退出。
 */
function onRestore() {
  ping('restore')
  const photo = currentPhoto.value
  if (!photo || !isCurrentInTrash.value) return
  setPhotoFlag(photo.id, { isInTrash: false })
  dropFromViewer(photo.id)
}

/**
 * 隐藏 = 打 isHidden 软标记，记录与图片资源都留着，「已隐藏」相簿会接住它。
 * 与删除一致：普通照片能藏，回收站里的照片这条入口不显示（下方按钮已按状态收起）。
 * 隐藏后照片退出图库 / 用户相簿 / 个人收藏，所以也要从当前查看器里剔掉。
 */
function onHide() {
  ping('hide')
  const photo = currentPhoto.value
  if (!photo || isCurrentInTrash.value || isCurrentHidden.value) return
  setPhotoFlag(photo.id, { isHidden: true })
  dropFromViewer(photo.id)
}

/**
 * 取消隐藏 = 把覆盖层里的 isHidden 置回 false（作品数据本身带标记的也一样生效）。
 * 照片随即回到图库、原相簿、个人收藏，并从「已隐藏」的查看器里退出。
 */
function onUnhide() {
  ping('unhide')
  const photo = currentPhoto.value
  if (!photo || !isCurrentHidden.value) return
  setPhotoFlag(photo.id, { isHidden: false })
  dropFromViewer(photo.id)
}

/**
 * 标题第一行的降级链：地点 → 说明 → 「照片」。
 *
 * 地点是这一版新加的，老作品里一条都没有；直接拿它当标题，
 * 存量作品会集体露出一行空白。降级到说明既保住了信息，
 * 也不用为"补地点"专门做一次迁移。
 */
const viewerTitleText = computed(() => {
  const photo = currentPhoto.value
  return photo?.location || photo?.caption || '照片'
})

const viewerTimeText = computed(() =>
  formatPhotoWeekdayTime(currentPhoto.value?.displayTime, { timeFormat: timeFormat.value }),
)

/** 滚到第 index 张。缩略图条与拖拽收尾共用 —— 都只改 scrollLeft，页码由 scroll 事件反推 */
function scrollToPhoto(index) {
  const el = pagerEl.value
  if (!el || !el.clientWidth) return
  const target = Math.min(Math.max(index, 0), viewerList.value.length - 1)
  el.scrollTo({ left: target * el.clientWidth, behavior: 'smooth' })
}

/**
 * 缩略图条跟着当前张走：翻到后面某张时，高亮的那枚必须还看得见。
 *
 * 用两个 rect 的中心差算位移，不用子项的 offsetLeft —— 缩略图条是绝对定位浮层，
 * 子项的 offsetParent 未必就是这个滚动容器，拿 offsetLeft 会量错基准。
 * 照片多到溢出时把当前张推到中间；装得下时 scrollTo 会被夹回 0，
 * 原本的「居中排列」一点不变。
 */
function syncThumbs(behavior = 'smooth') {
  const el = thumbsEl.value
  if (!el) return
  const current = el.querySelector('.pui-pho__thumb.is-current')
  if (!current) return
  const box = el.getBoundingClientRect()
  const item = current.getBoundingClientRect()
  const delta = item.left + item.width / 2 - (box.left + box.width / 2)
  if (Math.abs(delta) < 1) return
  el.scrollTo({ left: el.scrollLeft + delta, behavior })
}

/** 页码由 pager 的 scroll 事件反推，缩略图条跟着这个页码走（拖拽/点缩略图都覆盖） */
watch(viewerIndex, () => {
  nextTick(() => syncThumbs())
})

/** 退出查看器：状态栏先交还，再退栈（顺序反了会闪一帧白底黑字以外的配色） */
function closeViewer() {
  runtime.setStatusTone('auto')
  runtime.pop()
}

async function openPhoto(list, index) {
  if (!Array.isArray(list) || list.length === 0) return
  viewerList.value = list
  viewerIndex.value = Math.min(Math.max(index, 0), list.length - 1)
  chromeOn.value = true
  // 白底查看器要深色状态栏文字。显式写 'dark' 而不是交回 'auto'：
  // 外壳在应用内目前就解析成 dark，但那是别处的约定，不该在这里靠巧合成立。
  runtime.setStatusTone('dark')
  runtime.push('photo', list[viewerIndex.value].id)

  await nextTick()
  // 等一帧再定位：容器刚挂载时尺寸还是 0，scrollLeft 会被夹回 0
  requestAnimationFrame(() => {
    const el = pagerEl.value
    if (el) el.scrollLeft = el.clientWidth * viewerIndex.value
    // 打开时就落在中间那张：缩略图条得先对齐，不能等第一次翻页才归位
    syncThumbs('auto')
  })
}

/**
 * 桌面鼠标拖拽翻页。
 *
 * 为什么只在 pointerType === 'mouse' 时接管：
 *   触摸设备的原生横滑有惯性、有回弹、能被中断，用 pointer 模拟只会更差。
 *   判断放在最前面，触摸路径一个字节都不碰。
 *
 * 为什么拖拽期间要关掉 scroll-snap：
 *   吸附是"滚动结束后对齐整页"，但拖拽过程中每次写 scrollLeft 都会被它
 *   拽回最近的页，手感像在拽一根橡皮筋。松手时再吸附一次就够了。
 */
const drag = { active: false, pointerId: null, startX: 0, startScroll: 0, moved: false, endedAt: 0 }

/** 超过这个位移才算拖拽，否则按点击处理（手指/鼠标的抖动不该被当成翻页） */
const DRAG_THRESHOLD = 6

function onPagerPointerDown(event) {
  if (event.pointerType === 'touch') return
  if (event.button !== 0) return
  const el = pagerEl.value
  if (!el) return

  drag.active = true
  drag.pointerId = event.pointerId
  drag.startX = event.clientX
  drag.startScroll = el.scrollLeft
  drag.moved = false
  el.dataset.drag = 'true'
  try {
    // 合成事件（探针里派发的）没有真实指针，捕获会抛错，忽略即可
    el.setPointerCapture(event.pointerId)
  } catch {
    /* 没有真实指针 */
  }
}

function onPagerPointerMove(event) {
  if (!drag.active || event.pointerType === 'touch') return
  const el = pagerEl.value
  if (!el) return
  const dx = event.clientX - drag.startX
  if (Math.abs(dx) > DRAG_THRESHOLD) drag.moved = true
  el.scrollLeft = drag.startScroll - dx
}

function onPagerPointerUp(event) {
  if (!drag.active) return
  drag.active = false
  const el = pagerEl.value
  if (!el) return

  delete el.dataset.drag
  drag.endedAt = Date.now()
  try {
    el.releasePointerCapture(drag.pointerId ?? event.pointerId)
  } catch {
    /* 指针已经丢了 */
  }

  // 没超过阈值：这是一次点击，交给 click 去切信息层
  if (!drag.moved) return
  scrollToPhoto(Math.round(el.scrollLeft / el.clientWidth))
}

function toggleChrome() {
  // 拖拽收尾时浏览器还会补一次 click。不吞掉的话，
  // "拖到下一张"会顺手把信息层关掉 —— 用户只是翻页，没想藏东西。
  // 250ms 窗口足够覆盖那次合成 click，又不至于吞掉紧接着的真实点击。
  if (drag.moved && Date.now() - drag.endedAt < 250) {
    drag.moved = false
    return
  }
  chromeOn.value = !chromeOn.value
}

function onPagerScroll() {
  if (scrollRaf) return
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0
    const el = pagerEl.value
    if (!el || !el.clientWidth) return
    viewerIndex.value = Math.round(el.scrollLeft / el.clientWidth)
  })
}

/** 查看器被别处弹掉（phone:reset / 回锁屏）时，状态栏字色也要交还 */
onBeforeUnmount(() => {
  runtime.setStatusTone('auto')
})
</script>

<template>
  <div class="pui-pho" data-testid="photos-app">
    <div class="pui-pho__stack">
      <Transition :name="`pui-pho-screen-${direction}`">
        <!-- ══ 查看器 ══ -->
        <section
          v-if="isViewer"
          key="photo"
          class="pui-pho__screen pui-pho__screen--light"
          data-testid="photos-viewer"
        >
          <template v-if="viewerList.length">
            <div
              ref="pagerEl"
              class="pui-pho__pager"
              data-testid="photos-pager"
              @scroll.passive="onPagerScroll"
              @click="toggleChrome"
              @pointerdown="onPagerPointerDown"
              @pointermove="onPagerPointerMove"
              @pointerup="onPagerPointerUp"
              @pointercancel="onPagerPointerUp"
            >
              <div v-for="item in viewerList" :key="item.id" class="pui-pho__slide">
                <img v-if="urlOf(item)" :src="urlOf(item)" alt="" draggable="false" />
                <div v-else class="pui-pho__broken">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="3.5" y="5" width="17" height="14" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.6" />
                    <path d="M3.8 16.2l4.6-4.4 3.4 3.2 3-2.6 5 4.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
                  </svg>
                  <span>这张照片无法显示</span>
                </div>
              </div>
            </div>

            <!-- 顶栏：圆形返回 · 地点/时间两行标题 · ⋯ -->
            <header class="pui-pho__vbar" :data-on="chromeOn ? 'true' : 'false'">
              <button
                type="button"
                class="pui-pho__vback"
                data-testid="photos-viewer-back"
                aria-label="返回"
                @click.stop="closeViewer"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M14.5 5.5L8 12l6.5 6.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </button>

              <div class="pui-pho__vtitle">
                <span class="pui-pho__vplace">{{ viewerTitleText }}</span>
                <span class="pui-pho__vstamp" data-testid="photos-viewer-stamp">{{ viewerTimeText }}</span>
              </div>

              <!-- 纯外观入口：作品端没有"更多"能做的事，只给按压反馈、不跳屏 -->
              <button
                type="button"
                class="pui-pho__vmore"
                :class="{ 'pui-pho__vmore--ping': pinged === 'more' }"
                data-testid="photos-viewer-more"
                aria-label="更多"
                @pointerdown="pingDown('more')"
                @pointerup="pingUp"
                @pointercancel="pingUp"
                @pointerleave="pingUp"
                @click.stop="ping('more')"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="5.2" cy="12" r="1.7" fill="currentColor" />
                  <circle cx="12" cy="12" r="1.7" fill="currentColor" />
                  <circle cx="18.8" cy="12" r="1.7" fill="currentColor" />
                </svg>
              </button>
            </header>

            <!-- 缩略图条：点哪张去哪张，当前张描蓝边 -->
            <div
              ref="thumbsEl"
              class="pui-pho__thumbs"
              :data-on="chromeOn ? 'true' : 'false'"
              data-testid="photos-viewer-thumbs"
            >
              <button
                v-for="(item, i) in viewerList"
                :key="item.id"
                type="button"
                class="pui-pho__thumb"
                :class="{ 'is-current': i === viewerIndex }"
                :aria-label="`第 ${i + 1} 张`"
                :aria-current="i === viewerIndex ? 'true' : 'false'"
                @click.stop="scrollToPhoto(i)"
              >
                <img v-if="urlOf(item)" :src="urlOf(item)" alt="" draggable="false" />
                <span v-else class="pui-pho__thumb-empty" aria-hidden="true"></span>
              </button>
            </div>

            <footer class="pui-pho__vfoot" :data-on="chromeOn ? 'true' : 'false'">
              <span class="pui-pho__sr" data-testid="photos-viewer-count">
                {{ viewerIndex + 1 }} / {{ viewerList.length }}
              </span>

              <button
                type="button"
                class="pui-pho__act"
                :class="{ 'pui-pho__act--ping': pinged === 'share' }"
                data-testid="photos-viewer-share"
                aria-label="分享"
                @pointerdown="pingDown('share')"
                @pointerup="pingUp"
                @pointercancel="pingUp"
                @pointerleave="pingUp"
                @click.stop="ping('share')"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 3.4v10.2M8.4 6.8L12 3.2l3.6 3.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
                  <path d="M6.6 10.6H5.2v9.2h13.6v-9.2h-1.4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </button>

              <!--
                同一套画法、同一位置，只按状态换图标与动作：
                普通照片是「隐藏」（闭眼斜杠），已隐藏的照片换成「取消隐藏」（睁眼）。
                回收站里的照片这条入口不显示 —— 它不该被藏，只该被还原。
              -->
              <button
                v-if="!isCurrentInTrash && !isCurrentHidden"
                type="button"
                class="pui-pho__act"
                :class="{ 'pui-pho__act--ping': pinged === 'hide' }"
                data-testid="photos-viewer-hide"
                aria-label="隐藏"
                @pointerdown="pingDown('hide')"
                @pointerup="pingUp"
                @pointercancel="pingUp"
                @pointerleave="pingUp"
                @click.stop="onHide"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M2.8 12C5.2 7.5 8.4 5.5 12 5.5s6.8 2 9.2 6.5c-2.4 4.5-5.6 6.5-9.2 6.5s-6.8-2-9.2-6.5Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
                  <circle cx="12" cy="12" r="3.1" fill="none" stroke="currentColor" stroke-width="1.6" />
                  <path d="M4.2 4.2 19.8 19.8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
                </svg>
              </button>
              <button
                v-else-if="!isCurrentInTrash && isCurrentHidden"
                type="button"
                class="pui-pho__act"
                :class="{ 'pui-pho__act--ping': pinged === 'unhide' }"
                data-testid="photos-viewer-unhide"
                aria-label="取消隐藏"
                @pointerdown="pingDown('unhide')"
                @pointerup="pingUp"
                @pointercancel="pingUp"
                @pointerleave="pingUp"
                @click.stop="onUnhide"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M2.8 12C5.2 7.5 8.4 5.5 12 5.5s6.8 2 9.2 6.5c-2.4 4.5-5.6 6.5-9.2 6.5s-6.8-2-9.2-6.5Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
                  <circle cx="12" cy="12" r="3.1" fill="none" stroke="currentColor" stroke-width="1.6" />
                </svg>
              </button>

              <span class="pui-pho__actpill">
                <button
                  type="button"
                  class="pui-pho__actunit"
                  :class="{ 'pui-pho__actunit--ping': pinged === 'favorite', 'is-on': isCurrentFavorite }"
                  data-testid="photos-viewer-favorite"
                  :data-on="isCurrentFavorite ? 'true' : 'false'"
                  :aria-label="isCurrentFavorite ? '取消收藏' : '收藏'"
                  :aria-pressed="isCurrentFavorite ? 'true' : 'false'"
                  @pointerdown="pingDown('favorite')"
                  @pointerup="pingUp"
                  @pointercancel="pingUp"
                  @pointerleave="pingUp"
                  @click.stop="onFavorite"
                >
                  <svg v-if="isCurrentFavorite" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 20.2l-1.2-1.1C6.5 15.2 3.8 12.7 3.8 9.6c0-2.3 1.8-4.1 4.1-4.1 1.4 0 2.7.7 3.9 2 1.2-1.3 2.5-2 3.9-2 2.3 0 4.1 1.8 4.1 4.1 0 3.1-2.7 5.6-7 9.5z" fill="currentColor" />
                  </svg>
                  <svg v-else viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 20.2l-1.2-1.1C6.5 15.2 3.8 12.7 3.8 9.6c0-2.3 1.8-4.1 4.1-4.1 1.4 0 2.7.7 3.9 2 1.2-1.3 2.5-2 3.9-2 2.3 0 4.1 1.8 4.1 4.1 0 3.1-2.7 5.6-7 9.5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
                  </svg>
                </button>
                <button
                  type="button"
                  class="pui-pho__actunit"
                  :class="{ 'pui-pho__actunit--ping': pinged === 'info' }"
                  data-testid="photos-viewer-info"
                  aria-label="照片信息"
                  @pointerdown="pingDown('info')"
                  @pointerup="pingUp"
                  @pointercancel="pingUp"
                  @pointerleave="pingUp"
                  @click.stop="ping('info')"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="12" cy="12" r="8.3" fill="none" stroke="currentColor" stroke-width="1.6" />
                    <path d="M12 11.2v5.2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
                    <circle cx="12" cy="7.9" r="1" fill="currentColor" />
                  </svg>
                </button>
                <button
                  type="button"
                  class="pui-pho__actunit"
                  :class="{ 'pui-pho__actunit--ping': pinged === 'adjust' }"
                  data-testid="photos-viewer-adjust"
                  aria-label="调整"
                  @pointerdown="pingDown('adjust')"
                  @pointerup="pingUp"
                  @pointercancel="pingUp"
                  @pointerleave="pingUp"
                  @click.stop="ping('adjust')"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M3.6 8.6h8.2M16.6 8.6h3.8M3.6 15.4h3.8M12.2 15.4h8.2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
                    <circle cx="14.2" cy="8.6" r="2.1" fill="none" stroke="currentColor" stroke-width="1.7" />
                    <circle cx="9.8" cy="15.4" r="2.1" fill="none" stroke="currentColor" stroke-width="1.7" />
                  </svg>
                </button>
              </span>

              <!--
                右下角同一个位置、同一套画法，只按状态换图标与动作：
                普通照片是删除桶，回收站里的照片换成「还原」的回环箭头。
              -->
              <button
                v-if="!isCurrentInTrash"
                type="button"
                class="pui-pho__act"
                :class="{ 'pui-pho__act--ping': pinged === 'trash' }"
                data-testid="photos-viewer-trash"
                aria-label="移到最近删除"
                @pointerdown="pingDown('trash')"
                @pointerup="pingUp"
                @pointercancel="pingUp"
                @pointerleave="pingUp"
                @click.stop="onTrash"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M6 7h12M9.5 7V5.2h5V7M8 7l.7 12.2h6.6L16 7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </button>
              <button
                v-else
                type="button"
                class="pui-pho__act"
                :class="{ 'pui-pho__act--ping': pinged === 'restore' }"
                data-testid="photos-viewer-restore"
                aria-label="恢复照片"
                @pointerdown="pingDown('restore')"
                @pointerup="pingUp"
                @pointercancel="pingUp"
                @pointerleave="pingUp"
                @click.stop="onRestore"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4.8 10.2a7.4 7.4 0 1 1 2 6.9" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
                  <path d="M4.8 5.2v5h5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
                  <path d="M8.6 8.4l1.2 1.8-1.2 1.8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </button>
            </footer>
          </template>

          <div v-else class="pui-pho__vempty">
            <p>照片不存在。</p>
            <button type="button" class="pui-pho__vempty-btn" @click="closeViewer">返回</button>
          </div>
        </section>

        <!-- ══ 相簿详情 ══ -->
        <section v-else-if="isAlbum" key="album" class="pui-pho__screen" data-testid="photos-album-screen">
          <header class="pui-pho__nav">
            <button
              type="button"
              class="pui-pho__nav-back"
              data-testid="nav-back"
              aria-label="返回相簿"
              @click="goBack"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M14.5 5.5L8 12l6.5 6.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
              <span>相簿</span>
            </button>
            <span class="pui-pho__nav-title">{{ activeAlbum?.name ?? '相簿' }}</span>
          </header>

          <ScrollArea
            v-if="albumPhotos.length"
            :scroll-key="`photos:album:${albumParam}`"
            :padding-bottom="18"
            :fade="false"
          >
            <p class="pui-pho__count">{{ albumPhotos.length }} 张照片</p>
            <div class="pui-pho__grid" data-testid="photos-album-grid">
              <button
                v-for="(item, index) in albumPhotos"
                :key="item.id"
                type="button"
                class="pui-pho__tile"
                data-testid="photos-tile"
                :aria-label="item.caption || '照片'"
                @click="openPhoto(albumPhotos, index)"
              >
                <img v-if="urlOf(item)" :src="urlOf(item)" alt="" draggable="false" />
                <span v-else class="pui-pho__tile-empty" aria-hidden="true"></span>
              </button>
            </div>
          </ScrollArea>

          <EmptyState
            v-else-if="isTrashAlbum"
            title="最近删除是空的"
            description="删掉的照片会先放到这里。"
          />
          <EmptyState
            v-else-if="isHiddenAlbum"
            title="已隐藏是空的"
            description="隐藏的照片会出现在这里。"
          />
          <EmptyState
            v-else
            title="这个相簿是空的"
            description="相簿里的照片被删除后，这里会暂时空着。"
          />
        </section>

        <!-- ══ 根屏：图库 / 相簿 ══ -->
        <section v-else key="root" class="pui-pho__screen" :data-testid="`photos-${tab}-screen`">
          <header class="pui-pho__nav pui-pho__nav--root">
            <!-- 搜索态：整条导航就地换成输入框 + 取消（不叠第二行，标题让位） -->
            <template v-if="searching">
              <div class="pui-pho__search">
                <svg class="pui-pho__search-icon" viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="10.8" cy="10.8" r="6.4" fill="none" stroke="currentColor" stroke-width="1.9" />
                  <path d="M15.6 15.6L20 20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" />
                </svg>
                <input
                  ref="searchInput"
                  v-model="query"
                  class="pui-pho__search-input"
                  type="search"
                  data-testid="photos-search-input"
                  placeholder="搜索照片说明"
                  autocomplete="off"
                  autocapitalize="off"
                  spellcheck="false"
                />
                <button
                  v-if="query"
                  type="button"
                  class="pui-pho__search-clear"
                  data-testid="photos-search-clear"
                  aria-label="清空"
                  @click="query = ''"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="12" cy="12" r="9" fill="currentColor" />
                    <path d="M9.3 9.3l5.4 5.4M14.7 9.3l-5.4 5.4" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" />
                  </svg>
                </button>
              </div>
              <button
                type="button"
                class="pui-pho__search-cancel"
                data-testid="photos-search-cancel"
                @click="closeSearch"
              >
                取消
              </button>
            </template>

            <template v-else>
              <button type="button" class="pui-pho__nav-title" data-testid="photos-title" @click="goHome">
                {{ tab === 'albums' ? '相簿' : '图库' }}
              </button>
              <button
                type="button"
                class="pui-pho__nav-icon"
                data-testid="photos-search-open"
                aria-label="搜索"
                @click="openSearch"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="10.8" cy="10.8" r="6.4" fill="none" stroke="currentColor" stroke-width="1.9" />
                  <path d="M15.6 15.6L20 20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" />
                </svg>
              </button>
            </template>
          </header>

          <template v-if="tab === 'gallery'">
            <ScrollArea
              v-if="galleryView.total"
              scroll-key="photos:gallery"
              :padding-bottom="18"
              :fade="false"
            >
              <div v-for="section in gallerySections" :key="section.key" class="pui-pho__group">
                <h2 class="pui-pho__month" data-testid="photos-month-title">{{ section.title }}</h2>
                <div class="pui-pho__grid" data-testid="photos-grid">
                  <button
                    v-for="(item, index) in section.items"
                    :key="item.id"
                    type="button"
                    class="pui-pho__tile"
                    data-testid="photos-tile"
                    :aria-label="item.caption || '照片'"
                    @click="openPhoto(galleryPhotos, section.startIndex + index)"
                  >
                    <img v-if="urlOf(item)" :src="urlOf(item)" alt="" draggable="false" />
                    <span v-else class="pui-pho__tile-empty" aria-hidden="true"></span>
                  </button>
                </div>
              </div>
            </ScrollArea>

            <EmptyState
              v-else-if="keyword"
              title="没有找到照片"
              description="搜索只认照片说明、地点和月份，换个词试试。"
            />

            <EmptyState
              v-else
              title="还没有照片"
            />
          </template>

          <template v-else>
            <ScrollArea
              v-if="gridAlbums.length || showMoreSection"
              scroll-key="photos:albums"
              :padding-bottom="18"
              :fade="false"
            >
              <div v-if="gridAlbums.length" class="pui-pho__albums" data-testid="photos-album-list">
                <button
                  v-for="album in gridAlbums"
                  :key="album.id"
                  type="button"
                  class="pui-pho__album"
                  data-testid="photos-album-card"
                  :data-album-id="album.id"
                  :data-builtin="album.builtin ? 'true' : 'false'"
                  @click="openAlbum(album.id)"
                >
                  <span class="pui-pho__album-cover" :data-count="coverUrls(album).length">
                    <img
                      v-for="(url, i) in coverUrls(album)"
                      :key="i"
                      :src="url"
                      alt=""
                      draggable="false"
                    />
                  </span>
                  <span class="pui-pho__album-name">{{ album.name }}</span>
                  <span class="pui-pho__album-count">{{ album.count }}</span>
                </button>
              </div>

              <section
                v-if="showMoreSection"
                class="pui-pho__more"
                data-testid="photos-more-section"
              >
                <h2 class="pui-pho__more-title">
                  更多项目
                  <svg class="pui-pho__more-chevron" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M9 5.5 16 12l-7 6.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                </h2>
                <div class="pui-pho__more-card">
                  <button
                    type="button"
                    class="pui-pho__more-row"
                    data-testid="photos-hidden-row"
                    @click="requestAlbum(HIDDEN_ALBUM_ID)"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M2.8 12C5.2 7.5 8.4 5.5 12 5.5s6.8 2 9.2 6.5c-2.4 4.5-5.6 6.5-9.2 6.5s-6.8-2-9.2-6.5Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
                      <circle cx="12" cy="12" r="3.1" fill="none" stroke="currentColor" stroke-width="1.6" />
                      <path d="M4.2 4.2 19.8 19.8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
                    </svg>
                    <span class="pui-pho__more-label">{{ hiddenAlbum.name }}</span>
                    <span
                      v-if="albumLocked.hidden"
                      class="pui-pho__more-lock"
                      role="img"
                      aria-label="已上锁"
                      data-testid="photos-hidden-lock"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <rect x="6.3" y="9.5" width="11.4" height="10.5" rx="2.7" fill="currentColor" />
                        <path d="M8.2 9.5V7.7a3.8 3.8 0 0 1 7.6 0v1.8" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" />
                      </svg>
                    </span>
                    <span v-else class="pui-pho__more-count">{{ hiddenAlbum.count }}</span>
                  </button>
                  <button
                    type="button"
                    class="pui-pho__more-row"
                    data-testid="photos-trash-row"
                    @click="requestAlbum(TRASH_ALBUM_ID)"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M2.9 5.5h18.2M8.75 5.5V3.16h6.5V5.5M6.02 5.5l1.17 16.12h9.62L17.98 5.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
                      <path d="M9.66 9.78v7.28M14.34 9.78v7.28" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                    </svg>
                    <span class="pui-pho__more-label">{{ trashAlbum.name }}</span>
                    <span
                      v-if="albumLocked.trash"
                      class="pui-pho__more-lock"
                      role="img"
                      aria-label="已上锁"
                      data-testid="photos-trash-lock"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <rect x="6.3" y="9.5" width="11.4" height="10.5" rx="2.7" fill="currentColor" />
                        <path d="M8.2 9.5V7.7a3.8 3.8 0 0 1 7.6 0v1.8" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" />
                      </svg>
                    </span>
                    <span v-else class="pui-pho__more-count">{{ trashAlbum.count }}</span>
                  </button>
                </div>
              </section>
            </ScrollArea>

            <EmptyState
              v-else-if="keyword"
              title="没有找到相簿"
              description="搜索只认相簿名，换个词试试。"
            />

            <EmptyState
              v-else
              title="还没有相簿"
            />
          </template>
        </section>
      </Transition>
    </div>

    <!-- ══ 底部 tab：只在根屏出现（进相簿后由返回键接管） ══ -->
    <nav v-if="!isAlbum && !isViewer" class="pui-pho__tabbar" aria-label="照片导航">
      <button
        type="button"
        class="pui-pho__tab"
        :class="{ 'pui-pho__tab--on': tab === 'gallery' }"
        data-testid="photos-tab-gallery"
        @click="setTab('gallery')"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="4" y="4.6" width="7" height="7" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.6" />
          <rect x="13" y="4.6" width="7" height="7" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.6" />
          <rect x="4" y="13.6" width="7" height="7" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.6" />
          <rect x="13" y="13.6" width="7" height="7" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.6" />
        </svg>
        <i>图库</i>
      </button>

      <button
        type="button"
        class="pui-pho__tab"
        :class="{ 'pui-pho__tab--on': tab === 'albums' }"
        data-testid="photos-tab-albums"
        @click="setTab('albums')"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="4.4" y="6.6" width="15.2" height="13" rx="2.4" fill="none" stroke="currentColor" stroke-width="1.6" />
          <path d="M7.6 6.4V5.2A1.6 1.6 0 019.2 3.6h5.6a1.6 1.6 0 011.6 1.6v1.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
          <path d="M4.8 16.4l4.2-3.9 3.2 3 2.8-2.4 4.2 3.9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
        </svg>
        <i>相簿</i>
      </button>
    </nav>

    <!--
      相簿密码盘：白底压在整层照片应用之上（theme="light"）。
      只有「已隐藏 / 最近删除」设了密码且本轮未解锁时才会挂出来 ——
      判定在 requestAlbum 里，这里只负责渲染与回调。

      显隐有两套名字，由 instantNav 决定：
        · 普通（取消 / 中途退出）→ `pui-pho-lockfade`：进场交给 PasscodePad
          自带的 `pui-pass-in`（渐显 + 上浮 8px），离场淡出 180ms。
        · 验密通过 → `pui-pho-locknone`：离场立刻不可见（样式里只给了
          visibility:hidden，没有任何过渡属性），这一帧就把位置让给相簿。
          用户要的是「盘一撤，相簿已经在」，不是白底淡成相簿。
    -->
    <Transition :name="instantNav ? 'pui-pho-locknone' : 'pui-pho-lockfade'">
      <div v-if="lockState" class="pui-pho__lockpad" data-testid="photos-lock-pad">
        <PasscodePad
          theme="light"
          title="输入密码"
          :hint="lockState.hint"
          :expected="lockState.expected"
          :length="lockState.length"
          :show-emergency="false"
          @success="onLockSuccess"
          @cancel="onLockCancel"
        />
      </div>
    </Transition>
  </div>
</template>

<style src="./PhotoApp.css"></style>
