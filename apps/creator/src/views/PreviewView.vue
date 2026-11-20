<script setup>

import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRoute } from 'vue-router'
import { getApp, toWorkData } from '@phone-sim/shared'
import { useProjectStore } from '../stores/project.js'
import { usePreviewBridge } from '../preview/use-preview-bridge.js'
import { collectPreviewAssets, assetsFingerprint } from '../preview/collect-assets.js'
import { parsePreviewTarget } from '../preview/preview-target.js'

const PLAYER_SRC = './player-runtime/preview.html'
/** 子端 1.2s 没数据就进空态；这里给 2.5s 再提示，避免抢跑误报 */
const HANDSHAKE_WARN_MS = 2500
/** 连续编辑时合并重建任务（桥自己还有 120ms 的发送节流） */
const REBUILD_DEBOUNCE_MS = 120
/** 定位指令延后一帧发：等首帧 init 被子端消化完，避免"应用先挂载、数据后到"的闪空 */
const GOTO_DELAY_MS = 120

const editor = useProjectStore()
const route = useRoute()

const frame = ref(null)
/** 重载靠换 key 而不是改 src：src 不变时浏览器不会重新加载 */
const frameKey = ref(0)
const phase = ref('connecting')
const bridgeError = ref(null)
const lastNavigate = ref(null)
/** 子端上报的最近一帧渲染耗时，见 renderer.js 的 reportApplyMetrics */
const metrics = ref(null)

let readyTimer = 0
let rebuildTimer = 0
let gotoTimer = 0
let disposed = false
let assetCache = { fingerprint: null, map: {} }

const bridge = usePreviewBridge(frame, {
  onReady: () => {
    phase.value = 'ready'
    clearTimeout(readyTimer)
    scheduleInitialGoto()
  },
  onNavigate: (payload) => {
    lastNavigate.value = payload
  },
  onError: (payload) => {
    bridgeError.value = payload?.message || '作品端渲染出错'
  },
  onMetrics: (payload) => {
    metrics.value = payload
  },
})

const project = computed(() => editor.project)
const failedToSave = computed(() => editor.saveStatus === 'error')

/**
 * 定位目标：从哪个应用（哪一屏）开始预览。
 *
 * 为空 = 「完整作品预览」，保持从锁屏起播 —— 那是导出后读者看到的初始态，
 * 不能因为换了个入口就悄悄改掉。
 */
const target = computed(() => parsePreviewTarget(route.query))
const targetLabel = computed(() => (target.value ? (getApp(target.value.app)?.name ?? null) : null))

async function buildPayload() {
  const source = project.value
  if (!source) return null

  let work
  try {
    work = toWorkData(source)
  } catch (err) {
    bridgeError.value = `作品数据不完整：${err.message}`
    return null
  }

  // 资源只在资源清单变化时重新编码（把 Blob 转 dataURL 不便宜）
  const fingerprint = assetsFingerprint(source)
  if (fingerprint !== assetCache.fingerprint) {
    assetCache = { fingerprint, map: await collectPreviewAssets(source) }
  }

  return { work, assets: assetCache.map, start: target.value }
}

async function pushOnce({ immediate = false } = {}) {
  const payload = await buildPayload()
  if (!payload || disposed) return
  bridge.push(payload, { immediate })
}

function scheduleInitialGoto(delay = GOTO_DELAY_MS) {
  const next = target.value
  if (!next) return
  if (gotoTimer) clearTimeout(gotoTimer)
  gotoTimer = setTimeout(() => {
    gotoTimer = 0
    bridge.goto(next.app, next.screen, next.entityId)
  }, delay)
}

/** 回到桌面（解锁后停在家屏）：直达某应用后想确认图标与壁纸时的出口 */
function goHome() {
  bridge.goto('home')
}

/** 回到锁屏（phone:reset）：导出前确认「打开就是锁屏」的初始态 */
function resetPreview() {
  bridge.reset()
}

/** 换 key 才会真的重新加载：src 不变时浏览器不会重新请求 */
function reloadPreview() {
  frameKey.value += 1
  phase.value = 'connecting'
}

function onFrameLoad() {
  bridge.handleLoad()
  // 已经握过手又触发 load（比如子端自己重载）：不要把相位打回 connecting，
  // 否则 ready 为真时下面的定时器什么也不做，提示会永远停在"正在连接作品端…"
  if (bridge.ready) {
    phase.value = 'ready'
  } else {
    phase.value = 'connecting'
    clearTimeout(readyTimer)
    readyTimer = setTimeout(() => {
      if (!bridge.ready) phase.value = 'unresponsive'
    }, HANDSHAKE_WARN_MS)
  }
  void pushOnce({ immediate: true })
}

onMounted(async () => {
  bridge.attach()
  window.__previewBridge = bridge
  // iframe 的 load 在慢网络下可能早于 mounted，这里补一次（桥是幂等的）
  if (frame.value?.contentWindow) onFrameLoad()
  await pushOnce({ immediate: true })
})

// 编辑 → 预览：合并高频改动后再重建
watch(
  () => editor.project,
  () => {
    if (!editor.project) return
    if (rebuildTimer) clearTimeout(rebuildTimer)
    rebuildTimer = setTimeout(() => {
      rebuildTimer = 0
      void pushOnce()
    }, REBUILD_DEBOUNCE_MS)
  },
  { deep: true },
)

watch(
  () => route.query,
  () => {
    if (!target.value) return
    if (bridge.ready) scheduleInitialGoto()
  },
  { deep: true },
)

onBeforeUnmount(() => {
  disposed = true
  clearTimeout(readyTimer)
  clearTimeout(rebuildTimer)
  clearTimeout(gotoTimer)
  delete window.__previewBridge
  bridge.dispose()
})

const hint = computed(() => {
  if (bridgeError.value) return bridgeError.value
  if (failedToSave.value) return '上次保存失败，这里显示的是内存中的内容，可能与磁盘不一致。'
  if (phase.value === 'unresponsive') {
    return '作品端没有响应。若刚拉过代码，先在 apps/player 下重新构建一次产物。'
  }
  if (phase.value === 'connecting') return '正在连接作品端…'
  return ''
})

/** 性能 HUD 文案：一帧数据从收到到"画出来"的耗时 + 数据体积 */
const metricsLabel = computed(() => {
  const m = metrics.value
  if (!m || typeof m.applyMs !== 'number') return ''
  const size = typeof m.chars === 'number' ? `${Math.round(m.chars / 1024)}K 字` : '—'
  return `${m.applyMs}ms · ${size}`
})
</script>

<template>
  <div class="preview" data-testid="preview-page">
    <div class="preview__stage">
      <iframe
        :key="frameKey"
        ref="frame"
        class="preview__frame"
        :src="PLAYER_SRC"
        title="作品预览"
        data-testid="preview-frame"
        @load="onFrameLoad"
      ></iframe>
    </div>

    <div class="preview__tools" data-creator-only data-testid="preview-tools">
      <!-- 左侧信息组：定位标签与性能读数，一起吃掉剩余宽度，把按钮推到底 -->
      <div class="preview__info">
        <span v-if="targetLabel" class="preview__where" data-testid="preview-where">
          预览：{{ targetLabel }}
        </span>
        <span v-if="metricsLabel" class="preview__metrics" data-testid="preview-metrics">
          {{ metricsLabel }}
        </span>
      </div>
      <button type="button" class="preview__tool" data-testid="preview-home" @click="goHome">
        回到桌面
      </button>
      <button type="button" class="preview__tool" data-testid="preview-reset" @click="resetPreview">
        回到锁屏
      </button>
      <button type="button" class="preview__tool" data-testid="preview-reload" @click="reloadPreview">
        重载
      </button>
    </div>

    <p
      v-if="hint"
      class="preview__hint"
      :data-tone="bridgeError ? 'error' : 'info'"
      data-testid="preview-hint"
    >
      {{ hint }}
    </p>
  </div>
</template>

<style scoped>
.preview {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--c-bg-sunken);
}

.preview__stage {
  flex: 1;
  min-height: 0;
  /* iframe 自己负责手机外壳与居中，这里只管铺满可用区域 */
  display: flex;
}

.preview__frame {
  flex: 1;
  width: 100%;
  height: 100%;
  border: 0;
  background: transparent;
  display: block;
}

.preview__hint {
  margin: 0;
  padding: var(--sp-2) var(--sp-4);
  font-size: var(--fs-sm);
  text-align: center;
  color: var(--c-text-3);
  border-top: 1px solid var(--c-border);
  background: var(--c-bg-raised);
}

.preview__hint[data-tone='error'] {
  color: var(--c-danger);
  background: var(--c-danger-weak);
}

/* 工具条：贴着底部，不抢手机的展示面积 */
.preview__tools {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--sp-2);
  padding: var(--sp-1) var(--sp-3);
  border-top: 1px solid var(--c-border);
  background: var(--c-bg-raised);
}

/* 左侧信息组：定位标签 + 性能读数，占满剩余宽度把按钮推到右边 */
.preview__info {
  min-width: 0;
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin-right: var(--sp-2);
}

/* 定位标签：直达到某应用后，用户需要知道"现在看的是哪个应用" */
.preview__where {
  min-width: 0;
  max-width: 60%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: var(--fs-xs);
  color: var(--c-text-2);
}

.preview__metrics {
  flex: none;
  font-size: var(--fs-xs);
  color: var(--c-text-3);
  font-variant-numeric: tabular-nums;
}

.preview__tool {
  padding: 2px var(--sp-2);
  border: 1px solid var(--c-border);
  border-radius: 6px;
  background: transparent;
  color: var(--c-text-2);
  font: inherit;
  font-size: var(--fs-xs);
  cursor: pointer;
}

.preview__tool:hover {
  background: var(--c-bg-sunken);
}
</style>
