<script setup>
/**
 * 头像 / 主页背景图裁剪弹窗：比例可选的方框 + 拖动移动 + 滚轮/双指缩放。
 *
 * 为什么做成"选完文件先弹这个框"而不是直接存原图：
 *   角色头像、平台账号头像在作品里都只占一个 46~54px 的圆，
 *   直接从相册丢一张 4000px 的横构图进去，裁出来的人脸往往只剩一条缝；
 *   X 的主页背景图更极端 —— 作品里只有 390×123 的一条横幅，
 *   不裁就只能靠 object-fit 硬切，作者没法决定露出画面的哪一段。
 *
 * 交互取舍：
 *   1. **比例由调用方定**（open 时传 ratio）：头像是 1:1、主页背景图是 3:1。
 *      圆内预览只对 1:1 有意义，其它比例画虚线矩形框。
 *   2. **图动、框不动**：拖动移动、滚轮/双指缩放，是手机上最熟的裁剪手感。
 *   3. 旋转 / 翻转 / 亮度对比度饱和度全删：这个尺寸看不出差别，却占半个弹窗。
 *   4. 预览与成品同源：预览位置和烘焙裁切框都由 image-edit.js 的同一套纯函数
 *      换算（coverScale / clampOffset / cropRectOf），不会"看着调好了、存出来不一样"。
 *   5. GIF 不进这个框：canvas 只画第一帧，裁完动图就变静图了。
 *
 * 尺寸约定：方框宽度 = min(卡片内容宽, 视口高的一半 × 比例)，卡片宽度由方框反推 ——
 * 所以预览区永远撑满卡片左右内边距，视觉上就是居中的，不会出现两侧留白。
 */

import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { IMAGE_DEFAULTS } from '@phone-sim/shared'
import { computeTargetSize } from '../../media/image-format.js'
import {
  bakeEditedImage,
  clampOffset,
  coverScale,
  cropRectOf,
} from '../../media/image-edit.js'
import AppButton from './AppButton.vue'

/** 方框长边上限 420（大屏不失控），下限 200（小屏也够看清脸） */
const BOX_MAX = 420
const BOX_MIN = 200
/** 缩放上限：再大就是马赛克了 */
const ZOOM_MAX = 3

const visible = ref(false)
const busy = ref(false)
const errorText = ref('')
const fileName = ref('')
const zoom = ref(1)
const offset = ref({ x: 0, y: 0 })
/** 方框宽（高由 ratio 推出来） */
const boxW = ref(BOX_MAX)
/** 裁剪比例 = 宽 / 高：头像 1、X 主页背景图 3 */
const ratio = ref(1)
const copy = ref({ title: '调整头像', hint: '拖动移动位置，滚轮或双指缩放，虚线圆内就是头像效果' })
const previewUrl = ref('')
const stageEl = ref(null)

/** 方框显示尺寸。数学函数（coverScale / clampOffset / cropRectOf）都收这个形状 */
const boxH = computed(() => Math.max(1, Math.round(boxW.value / ratio.value)))
const boxRect = computed(() => ({ width: boxW.value, height: boxH.value }))

/** 源位图是"非响应式的大对象"，用普通变量持有，避免 Vue 深度代理 */
let sourceBitmap = null
let sourceByteSize = 0
let stageObserver = null
let objectUrl = ''
let resolver = null
/** 手势监听的解绑函数（挂在方框元素上，见 startGestures） */
let stopDrag = null

/** 每源图 1px 对应的显示像素（铺满之后再乘 zoom） */
function scaleOf() {
  if (!sourceBitmap) return 1
  return coverScale(sourceBitmap.width, sourceBitmap.height, boxRect.value) * zoom.value
}

/**
 * 指定缩放下的图片显示尺寸。
 * 捏合时新位移要按**新**缩放夹紧，而 `imageSize` 是 computed、此刻还是旧缩放的值，
 * 所以那里必须单独算一份，不能图省事用 imageSize。
 */
function imageSizeAt(nextZoom) {
  if (!sourceBitmap) return { width: 0, height: 0 }
  const s = coverScale(sourceBitmap.width, sourceBitmap.height, boxRect.value) * nextZoom
  return { width: sourceBitmap.width * s, height: sourceBitmap.height * s }
}

const imageSize = computed(() => {
  if (!sourceBitmap) return { width: 0, height: 0 }
  return imageSizeAt(zoom.value)
})

const imageStyle = computed(() => {
  if (!sourceBitmap) return {}
  const s = scaleOf()
  const px = (value) => `${Math.round(value * 100) / 100}px`
  return {
    width: px(sourceBitmap.width * s),
    height: px(sourceBitmap.height * s),
    marginTop: px((-sourceBitmap.height * s) / 2 + offset.value.y),
    marginLeft: px((-sourceBitmap.width * s) / 2 + offset.value.x),
  }
})

/** 输出尺寸（给用户看"将保存 1536×512"） */
const outputSize = computed(() => {
  if (!sourceBitmap) return null
  const s = scaleOf()
  const w = Math.min(boxW.value / s, sourceBitmap.width)
  const h = Math.min(boxH.value / s, sourceBitmap.height)
  return computeTargetSize(w, h, IMAGE_DEFAULTS.MAX_EDGE)
})

/**
 * 等下一帧（布局已稳定）。
 * 用来等 DOM 从"已插入"走到"已排版" —— nextTick 只保证前者。
 */
function nextFrame() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve())
  })
}

/**
 * 打开编辑框。
 * @param {File} file
 * @param {{ratio?:number, title?:string, hint?:string}} [options]
 *   ratio 为宽/高（头像 1、X 主页背景图 3）；title / hint 只改文案
 * @returns {Promise<object|null>} 与 prepareImage 同形状的结果；取消返回 null
 */
async function open(file, options = {}) {
  if (!file) return null
  resetState()
  ratio.value = Number(options.ratio) > 0 ? Number(options.ratio) : 1
  copy.value = {
    title: options.title || (ratio.value === 1 ? '调整头像' : '调整图片'),
    hint:
      options.hint ||
      (ratio.value === 1
        ? '拖动移动位置，滚轮或双指缩放，虚线圆内就是头像效果'
        : '拖动移动位置，滚轮或双指缩放，框内就是作品里显示的区域'),
  }
  // 换比例后先按新比例量一次，避免沿用上一个比例算出来的宽
  boxW.value = BOX_MAX
  try {
    sourceBitmap = await createImageBitmap(file)
  } catch {
    throw new Error(`无法解码这张图片：${file.name || '未命名文件'}`)
  }
  fileName.value = file.name ?? ''
  sourceByteSize = file.size ?? 0
  objectUrl = URL.createObjectURL(file)
  previewUrl.value = objectUrl
  zoom.value = 1
  offset.value = { x: 0, y: 0 }
  visible.value = true
  // 弹窗此刻才挂载，可用尺寸现在才量得到。
  // ⚠️ 必须再等一帧：方框宽度是 `:style` 绑定出来的，nextTick 之后 DOM 已插入但宽度
  //    还没落到布局上，此时量 clientWidth 拿到 0、退回 BOX_MAX 的初值，方框尺寸会一直
  //    停在错的值上（图片跟着错位）。等布局稳定再量、再挂手势。
  await nextTick()
  await nextFrame()
  syncBoxSize()
  offset.value = { x: 0, y: 0 }
  startGestures()
  stageObserver = new ResizeObserver(syncBoxSize)
  if (stageEl.value) stageObserver.observe(stageEl.value)
  return new Promise((resolve) => {
    resolver = resolve
  })
}

/**
 * 按可用空间定方框宽：宽度取卡片内容宽，高度最多占视口一半（超出就按高度回推宽度）。
 * 方框 = 卡片内容宽时两侧严丝合缝，整块预览天然居中。
 */
function syncBoxSize() {
  const el = stageEl.value
  if (!el) return
  const availW = el.clientWidth || BOX_MAX
  const availH = Math.round(window.innerHeight * 0.5)
  let next = Math.min(availW || BOX_MAX, BOX_MAX)
  if (next / ratio.value > availH) next = availH * ratio.value
  // 长边不小于 BOX_MIN：再小就拖不准了（1:1 时就是边长，3:1 时就是宽度）
  const longEdge = Math.max(next, next / ratio.value)
  if (longEdge < BOX_MIN) next = BOX_MIN * Math.min(1, ratio.value)
  next = Math.max(1, Math.round(next))
  if (next === boxW.value) return
  // 可用空间变了（窗口缩放）：位移按新旧宽度等比换算，裁到的还是同一块图
  // ⚠️ 宽高等比变化，所以用宽度的比值当位移缩放比即可
  const k = next / boxW.value
  boxW.value = next
  offset.value = clampOffset(
    { x: offset.value.x * k, y: offset.value.y * k },
    imageSize.value,
    boxRect.value,
  )
}

/** 复位：刚好铺满方框、居中 */
function resetView() {
  // 手上还按着的手指一并作废，否则残留基准会让下一帧把画面拉回旧位置
  stopGestures()
  startGestures()
  zoom.value = 1
  offset.value = { x: 0, y: 0 }
}

function resetState() {
  errorText.value = ''
  busy.value = false
  stopGestures()
}

function close() {
  stopGestures()
  visible.value = false
  stageObserver?.disconnect()
  stageObserver = null
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl)
    objectUrl = ''
  }
  previewUrl.value = ''
  offset.value = { x: 0, y: 0 }
  zoom.value = 1
  sourceBitmap?.close?.()
  sourceBitmap = null
}

function cancel() {
  close()
  resolver?.(null)
  resolver = null
}

async function confirm() {
  if (!sourceBitmap || busy.value) return
  busy.value = true
  errorText.value = ''
  try {
    const s = scaleOf()
    const prepared = await bakeEditedImage({
      source: sourceBitmap,
      crop: cropRectOf(
        { width: sourceBitmap.width, height: sourceBitmap.height },
        { box: boxRect.value, scale: s, offset: offset.value },
      ),
      fileName: fileName.value,
      originalByteSize: sourceByteSize,
    })
    const done = resolver
    resolver = null
    close()
    done?.(prepared)
  } catch (error) {
    errorText.value = error?.message || '处理这张图片失败。'
  } finally {
    busy.value = false
  }
}

/**
 * 滚轮缩放的入口（只有桌面滚轮走这里，捏合在 onPointerMove 里自己算）。
 * anchor 为指针在方框坐标系里的位置：缩放前后"锚点下的那块图"要停在原地，
 * 否则一放大人就往左上跑。
 */
function zoomTo(next, anchor) {
  const prev = zoom.value
  const clamped = Math.min(ZOOM_MAX, Math.max(1, Number(next) || 1))
  if (clamped === prev) return
  const factor = clamped / prev
  const a = anchor ?? { x: 0, y: 0 }
  const base = { x: offset.value.x - a.x, y: offset.value.y - a.y }
  const nextOffset = clampOffset(
    { x: base.x * factor + a.x, y: base.y * factor + a.y },
    imageSizeAt(clamped),
    boxRect.value,
  )
  zoom.value = clamped
  offset.value = nextOffset
}

function anchorOf(clientX, clientY) {
  const el = stageEl.value
  const rect = el?.getBoundingClientRect()
  if (!rect) return { x: 0, y: 0 }
  return {
    x: clientX - rect.left - boxW.value / 2,
    y: clientY - rect.top - boxH.value / 2,
  }
}

/**
 * 手势：**只用 Pointer Events，一套状态机**。
 *
 * 为什么不能再"拖动用 pointer*、捏合用 touch*"：
 *   移动端浏览器对同一次触摸会同时派发 pointer* 与 touch*，两套监听各算各的位移，
 *   一起往 offset.value 写，画面就每帧在两套结果之间来回跳（用户报的"双指放大时图会闪"）。
 *   所以这里只认 pointer，靠"当前按着几根手指"切换模式：
 *     - 1 指 = 拖动，位移相对**该指按下时**的 offset；
 *     - 2 指 = 捏合，位移/缩放相对**进入捏合那一刻**的 offset 与缩放；
 *     - 抬指不换回到拖动，直接重置基线（否则剩下那根手指会按旧基线猛地弹一下，
 *       这就是"松手有时候还会移动"）。
 *   手指全部抬起只清状态、**不解绑监听**（监听挂在组件自己的 DOM 上，弹窗活着就一直有效）。
 */
const activePointers = new Map()

/** 当前手势基准：kind 为 drag / pinch，进入时把 offset、缩放、距离一次拍下来 */
let gesture = null

/** 两指距离，兜底 1 避免除零 */
function spanOf([a, b]) {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1
}

/** 两指中点，捏合以它为锚点（手指怎么摆，中心那块图就停在原地） */
function midpointOf([a, b]) {
  return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 }
}

function beginGesture(kind, points) {
  if (kind === 'pinch') {
    const mid = midpointOf(points)
    gesture = {
      kind,
      startOffset: { ...offset.value },
      startZoom: zoom.value,
      startSpan: spanOf(points),
      anchor: anchorOf(mid.x, mid.y),
      mid,
    }
    return
  }
  const finger = points[0]
  gesture = {
    kind: 'drag',
    startOffset: { ...offset.value },
    startX: finger.clientX,
    startY: finger.clientY,
  }
}

/** 抬指后重拍基线：剩下的手指从"此刻的画面"继续，不追旧基线 */
function rebaseGesture() {
  const points = [...activePointers.values()]
  if (!points.length) {
    gesture = null
    return
  }
  beginGesture(points.length >= 2 ? 'pinch' : 'drag', points)
}

function onPointerDown(event) {
  if (!sourceBitmap || event.button > 0) return
  event.preventDefault()
  try {
    event.currentTarget.setPointerCapture?.(event.pointerId)
  } catch {
    // 合成事件不支持 capture：退化为普通监听即可
  }
  activePointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY })
  beginGesture(activePointers.size >= 2 ? 'pinch' : 'drag', [...activePointers.values()])
}

/**
 * 合成一帧。
 *
 * 为什么要合帧：两根手指移动时浏览器**每指各派发一次 pointermove**，两次都拿同一份
 * 基准自己算结果。后一次的结果才包含两指的完整信息，先写一次等于渲染一个"只有一根
 * 手指动了"的中间态 —— 这就是双指缩放时图片一下一下地闪的来源。
 * 所以 move 里只记坐标、不写界面，统一在下一帧用最新坐标算一次。
 */
let frameHandle = 0

function scheduleSync() {
  if (frameHandle) return
  frameHandle = requestAnimationFrame(() => {
    frameHandle = 0
    syncFromPointers()
  })
}

function cancelScheduledSync() {
  if (!frameHandle) return
  cancelAnimationFrame(frameHandle)
  frameHandle = 0
}

/** 用当前所有按着的手指算一次显示状态（每帧最多调一次） */
function syncFromPointers() {
  if (!gesture) return
  const points = [...activePointers.values()]

  if (gesture.kind === 'pinch') {
    if (points.length < 2) return
    const mid = midpointOf(points)
    const anchor = gesture.anchor
    // 缩放比 = 当前指距 / 进入捏合时指距，乘上进入时的缩放，再夹到 1~3×
    const nextZoom = Math.min(
      ZOOM_MAX,
      Math.max(1, gesture.startZoom * (spanOf(points) / gesture.startSpan)),
    )
    // 锚点下的那块图原地不动：(offset − anchor) 随缩放等比放大，再叠回锚点；
    // 两指中点移动的部分当作平移（整手横移时画面跟着走，符合"捏着移动"的直觉）
    const growth = nextZoom / gesture.startZoom
    const nextOffset = clampOffset(
      {
        x: (gesture.startOffset.x - anchor.x) * growth + anchor.x + (mid.x - gesture.mid.x),
        y: (gesture.startOffset.y - anchor.y) * growth + anchor.y + (mid.y - gesture.mid.y),
      },
      imageSizeAt(nextZoom),
      boxRect.value,
    )
    zoom.value = nextZoom
    offset.value = nextOffset
    return
  }

  const finger = points[0]
  if (!finger) return
  offset.value = clampOffset(
    {
      x: gesture.startOffset.x + (finger.clientX - gesture.startX),
      y: gesture.startOffset.y + (finger.clientY - gesture.startY),
    },
    imageSize.value,
    boxRect.value,
  )
}

function onPointerMove(event) {
  if (!activePointers.has(event.pointerId) || !gesture) return
  activePointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY })
  scheduleSync()
}

function onPointerUp(event) {
  if (!activePointers.has(event.pointerId)) return
  // 抬指前先把最后一帧坐标落下来，否则手指离开那一刻的最后一点位移会丢
  cancelScheduledSync()
  activePointers.delete(event.pointerId)
  syncFromPointers()
  try {
    event.currentTarget.releasePointerCapture?.(event.pointerId)
  } catch {
    // 同上，忽略
  }
  rebaseGesture()
  if (!activePointers.size) {
    // ⚠️ 只清状态、**不解绑监听**：监听挂在组件自己的 DOM 上，弹窗开着的期间一直有效。

    //    捏合一次之后，单指拖动彻底失效）。
    gesture = null
  }
}

/** 解绑全部指针监听并清空状态：关闭弹窗、重置、打开新图、组件卸载都要走到这里 */
function stopGestures() {
  cancelScheduledSync()
  activePointers.clear()
  gesture = null
  stopDrag?.()
  stopDrag = null
}

/** 滚轮缩放（桌面），以指针为锚点 */
function onWheel(event) {
  if (!sourceBitmap) return
  event.preventDefault()
  const factor = event.deltaY > 0 ? 0.92 : 1.08
  zoomTo(zoom.value * factor, anchorOf(event.clientX, event.clientY))
}

/**
 * 在方框元素上挂手势监听（不是 window）。
 *
 * 挂元素而不是 window 的理由，和作品端 gesture.js 一样：手机上左右边缘内划是系统的
 * 返回/切应用手势，弹窗不该去抢；元素上监听 + pointer capture 已经够保证手指滑出框外
 * 仍能收到 move/up。框外松手则由 pointercancel 兜底。
 */
function startGestures() {
  const el = stageEl.value?.querySelector('.ied__box')
  if (!el) return
  stopGestures()
  el.addEventListener('pointerdown', onPointerDown)
  el.addEventListener('pointermove', onPointerMove)
  el.addEventListener('pointerup', onPointerUp)
  el.addEventListener('pointercancel', onPointerUp)
  stopDrag = () => {
    el.removeEventListener('pointerdown', onPointerDown)
    el.removeEventListener('pointermove', onPointerMove)
    el.removeEventListener('pointerup', onPointerUp)
    el.removeEventListener('pointercancel', onPointerUp)
  }
}

onBeforeUnmount(() => {
  stopGestures()
  stageObserver?.disconnect()
})

defineExpose({ open })

</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="ied"
      data-testid="ied-dialog"
      @keydown.esc.prevent="cancel"
      @click.self="cancel"
    >
      <div class="ied__panel" role="dialog" aria-modal="true" :aria-label="copy.title">
        <header class="ied__head">
          <h2 class="ied__title">{{ copy.title }}</h2>
          <p class="ied__hint">{{ copy.hint }}</p>
        </header>

        <div class="ied__stage-wrap" :style="{ height: boxH + 'px' }">
          <div ref="stageEl" class="ied__stage">
            <div
              class="ied__box"
              data-testid="ied-box"
              :data-ratio="ratio"
              :style="{ width: boxW + 'px', height: boxH + 'px' }"
              @wheel.prevent="onWheel"
            >
              <img
                v-if="previewUrl"
                class="ied__img"
                :src="previewUrl"
                :style="imageStyle"
                alt=""
                draggable="false"
              />
              <!-- 圆形预览只在 1:1（头像）时有意义；其它比例方框本身就是成品形状 -->
              <span v-if="ratio === 1" class="ied__ring" aria-hidden="true"></span>
              <span v-else class="ied__frame" aria-hidden="true"></span>
            </div>
          </div>
        </div>

        <p v-if="errorText" class="ied__error" role="alert">{{ errorText }}</p>

        <footer class="ied__foot">
          <span class="ied__size" data-testid="ied-size">
            <template v-if="outputSize">将保存 {{ outputSize.width }}×{{ outputSize.height }}</template>
          </span>
          <div class="ied__actions">
            <AppButton data-testid="ied-reset" @click="resetView">重置</AppButton>
            <AppButton data-testid="ied-cancel" @click="cancel">取消</AppButton>
            <AppButton variant="primary" :disabled="busy" data-testid="ied-confirm" @click="confirm">
              {{ busy ? '处理中…' : '使用这张图' }}
            </AppButton>
          </div>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.ied {
  position: fixed;
  inset: 0;
  z-index: 120;
  height: var(--creator-viewport-height, 100dvh);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--sp-5);
  background: rgba(20, 20, 25, 0.42);
}

/* 卡片宽度由内容撑开：内边距 + 方框边长，方框永远贴着左右内边距 */
.ied__panel {
  display: flex;
  flex-direction: column;
  width: fit-content;
  max-width: 100%;
  max-height: 100%;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: var(--sp-5);
  border-radius: var(--radius-lg);
  background: var(--c-bg-raised);
  box-shadow: var(--shadow-lg);
}

.ied__head {
  margin-bottom: var(--sp-4);
}

.ied__title {
  font-size: var(--fs-lg);
  font-weight: 600;
  letter-spacing: -0.01em;
}

.ied__hint {
  margin-top: var(--sp-1);
  color: var(--c-text-3);
  font-size: var(--fs-sm);
}

/* 舞台只负责量可用宽度（取满卡片内容宽），高度跟着方框走 */
.ied__stage {
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.ied__stage-wrap {
  width: 100%;
  overflow: hidden;
  border-radius: var(--radius-md);
}

.ied__box {
  position: relative;
  flex: none;
  overflow: hidden;
  border-radius: var(--radius-md);
  background: var(--c-bg-sunken);
  cursor: grab;
  /* 关掉浏览器自带的手势/滚动接管，双指捏合才不会同时触发页面缩放 */
  touch-action: none;
  user-select: none;
}

.ied__box:active {
  cursor: grabbing;
}

/* 图片绝对定位在框中心，用负 margin 抵消自身宽高的一半，再叠加用户位移 */
.ied__img {
  position: absolute;
  top: 50%;
  left: 50%;
  max-width: none;
  pointer-events: none;
  -webkit-user-drag: none;
}

/* 圆形预览：圆内原样，圆外压暗成一块底，边界只用一圈细虚线交代，
   不做实心描边（实线会变成"圆环"，压住画面） */
.ied__ring {
  position: absolute;
  inset: 0;
  pointer-events: none;
  border-radius: 50%;
  box-shadow: 0 0 0 9999px rgba(20, 20, 25, 0.55);
}

.ied__ring::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 1px dashed rgba(255, 255, 255, 0.36);
}

/* 非 1:1（如主页背景图 3:1）：框内就是成品，只描一圈细虚线把边界交代清楚 */
.ied__frame {
  position: absolute;
  inset: 0;
  pointer-events: none;
  border-radius: inherit;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.42);
}

.ied__error {
  margin-top: var(--sp-3);
  color: var(--c-danger);
  font-size: var(--fs-sm);
}

.ied__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
  margin-top: var(--sp-4);
}

.ied__size {
  color: var(--c-text-3);
  font-size: var(--fs-sm);
  font-variant-numeric: tabular-nums;
}

.ied__actions {
  display: flex;
  gap: var(--sp-2);
}

.ied__actions :deep(.ui-btn) {
  min-height: 32px;
  padding: 0 var(--sp-3);
  font-size: var(--fs-sm);
}
</style>
