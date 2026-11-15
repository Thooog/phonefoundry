/**
 * 作品端渲染器入口
 *
 * 这个文件是导出产物的核心：它被构建成一个 IIFE，
 * 首行即自执行 —— 找到挂载点、解析数据、渲染手机。
 *
 * 数据源解析优先级（见 resolve-source.js）：
 *   1. window.__PHONE_WORK__  （导出时内联注入）
 *   2. postMessage            （创作端预览 iframe）
 *   3. null                   （空态，不白屏）
 */

import { createApp, h, ref, computed } from 'vue'
import { PhoneSimulator } from '@phone-sim/player-ui'
import { resolveShellMode, shouldAutoFullscreen } from '@phone-sim/shared'
import '@phone-sim/player-ui/styles/entry.css'
import { resolveSource } from './work/resolve-source.js'
import { createAssetResolver } from './work/asset-resolver.js'
import { requestAutoFullscreen } from './work/auto-fullscreen.js'

/**
 * 某个作品实例的自动全屏是否已经接手过。
 *
 * 预览模式会反复推送数据帧，没有这个标记就是每帧调一次；而模块内部
 * 不管是进去了还是失败都会自己收工，重复调用只是在反复碰壁。
 * 真正的导出作品一帧定终身，这里其实只会被唤醒一次。
 */
let autoFullscreenArmed = false

function armAutoFullscreen(work) {
  if (autoFullscreenArmed) return
  if (!shouldAutoFullscreen(work?.workSettings)) return
  autoFullscreenArmed = true
  requestAutoFullscreen()
}

/**
 * 挂载手机到指定容器。
 * @param {HTMLElement} el
 * @param {{ work: object|null, resolveAsset: Function|null, start?: object|null }} initial
 */
function mountPhone(el, initial) {
  const work = ref(initial.work)
  /**
   * 外壳形态取自作品设置，且必须是计算属性。
   *
   * 直接用 initial 里的值也可以，但那样"预览时改一次设置"就只有重载才生效 ——
   * 创作者拨开关会以为开关失灵。挂在 work 上之后 shellMode 跟着数据帧走，
   * 与 props.work 一样挂在数据帧上，创作者拨一下开关就能立刻看到差别。
   */
  const shellMode = computed(() => resolveShellMode(work.value?.workSettings))
  const resolver = ref(initial.resolveAsset)

  const start = initial.start ?? null
  /** 拿到 PhoneSimulator 实例，才能把 goto / reset 这类控制指令转进去 */
  const rootRef = ref(null)

  const app = createApp({
    name: 'PhoneSimulatorRoot',
    setup() {
      return () =>
        h(PhoneSimulator, {
          ref: rootRef,
          work: work.value,
          resolveAsset: resolver.value ? (id) => resolver.value(id) : null,
          shellMode: shellMode.value,
          start,
        })
    },
  })

  app.mount(el)

  armAutoFullscreen(work.value)

  return {
    update(next) {
      work.value = next.work
      if (next.resolveAsset) resolver.value = next.resolveAsset
      armAutoFullscreen(work.value)
    },
    /** 预览定位：phone:goto */
    goto(target) {
      rootRef.value?.goto?.(target)
    },
    /** 回到锁屏：phone:reset */
    reset() {
      rootRef.value?.reset?.()
    },
    unmount() {
      app.unmount()
    },
  }
}

/** 耗时采样；没有 performance 的老环境退化为 0，度量本身不该把渲染搞崩 */
function now() {
  return typeof performance !== 'undefined' ? performance.now() : 0
}

/**
 * 作品数据体积。
 * 用字符数而不是字节数：它只是"内容变多时，全量推送的代价会不会失控"的代理指标，
 * 精确到 B 没有意义，但拿到一个随内容线性增长的数字很有意义。
 */
function measureChars(work) {
  try {
    return JSON.stringify(work)?.length ?? 0
  } catch {
    // 有循环引用时退化 —— 度量失败绝不能影响渲染
    return 0
  }
}

function reportApplyMetrics(source, startedAt, work) {
  if (!source.reportMetrics) return
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      source.reportMetrics({
        applyMs: Math.round((now() - startedAt) * 10) / 10,
        chars: measureChars(work),
        at: Date.now(),
      })
    })
  })
}

async function boot() {
  const el = document.getElementById('phone-root')
  if (!el) {
    // 宿主页缺少挂载点，属于集成错误，直接报告而不是静默失败
    console.error('[phone-sim] 未找到挂载点 #phone-root')
    return
  }

  const source = await resolveSource()

  // 先渲染（即便空态也要出手机），再挂载数据
  const resolveAsset = createAssetResolver(source)
  const controller = mountPhone(el, {
    work: source.work,
    resolveAsset: source.mode === 'empty' ? null : resolveAsset,
    start: source.start ?? null,
  })

  if (source.onUpdate) {
    source.onUpdate((next) => {
      const startedAt = now()
      controller.update({
        work: next.work,
        resolveAsset: createAssetResolver({ ...source, ...next }),
      })
      reportApplyMetrics(source, startedAt, next.work)
    })
  }

  // 预览模式：控制指令（定位 / 复位）
  if (source.onControl) {
    source.onControl((type, payload) => {
      if (type === 'phone:goto') controller.goto(payload)
      else if (type === 'phone:reset') controller.reset()
    })
  }

  // 挂载完再报一次就绪。
  // resolve-source 里那一次 ready 发得很早，父端如果还没挂上监听就会错过；

  source.notifyReady?.()

  window.__PHONE_SIM__ = controller
}

boot()
