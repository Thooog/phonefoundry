

const CHANNEL = 'phone-preview'
const PROTOCOL_VERSION = 1
/** 尾随节流窗口：合并连续编辑，又足够快到"看起来是实时的" */
const THROTTLE_MS = 120

/**
 * 跨源场景下 targetOrigin 该用什么。
 * file:// 打开时 location.origin 是 "null"，postMessage 不接受 "null" 之外的精确值，
 * 只能退化成 '*'；安全性由收信端的 event.source 校验兜住。
 */
function resolveTargetOrigin() {
  const origin = window.location.origin
  return !origin || origin === 'null' ? '*' : origin
}

export function usePreviewBridge(iframeRef, { onNavigate, onError, onMetrics, onReady } = {}) {
  /** 子端是否已握手（收到过 phone:ready） */
  let ready = false
  /** 当前文档的 load 是否已发生 */
  let loaded = false
  let seq = 0
  let timer = 0
  /** 最新一帧数据。始终保留，供"重新握手"时重发 */
  let lastPayload = null
  /** 待发送的最新一帧；同一时刻只保留最后一帧（中间的编辑没有意义） */
  let pending = null
  let disposed = false

  const stats = {
    sentInit: 0,
    sentUpdate: 0,
    receivedReady: 0,
    receivedError: 0,
    receivedMetrics: 0,
    /** 最近一次 phone:metrics 的原始载荷（耗时 / 数据量），供 HUD 与探针读取 */
    lastMetrics: null,
  }

  function childWindow() {
    return iframeRef.value?.contentWindow ?? null
  }

  function post(type, payload) {
    const win = childWindow()
    if (!win) return false
    seq += 1
    try {
      win.postMessage(
        { channel: CHANNEL, v: PROTOCOL_VERSION, type, seq, payload },
        resolveTargetOrigin(),
      )
      return true
    } catch {
      // 子窗口已经销毁（比如切换路由）—— 忽略，下一次 load 会重新握手
      return false
    }
  }

  function sendInit(payload) {
    if (post('phone:init', payload)) stats.sentInit += 1
  }

  function sendUpdate(payload) {
    if (post('phone:update', payload)) stats.sentUpdate += 1
  }

  /** 立即发一帧：有 payload 时用 update，没有就什么都不做 */
  function flushNow() {
    if (disposed || !pending) return
    const payload = pending
    pending = null
    if (ready) sendUpdate(payload)
    // 未 ready 时不清 pending：等 ready 到了用 init 一次带过去
    else pending = payload
  }

  function schedule() {
    if (disposed) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = 0
      flushNow()
    }, THROTTLE_MS)
  }

  /**
   * 推一帧数据。
   * @param {{work: object, assets: Record<string,string>}} payload
   * @param {{immediate?: boolean}} [options] immediate 用于首帧 / 重置后重发
   */
  function push(payload, { immediate = false } = {}) {
    lastPayload = payload
    pending = payload

    if (!ready) {
      // 还没握手：只留最后一帧，等 ready 时用 init 发出去
      // （避免两边都发、子端挂两次）
      return
    }
    if (immediate) {
      if (timer) {
        clearTimeout(timer)
        timer = 0
      }
      flushNow()
      return
    }
    schedule()
  }

  function handleLoad() {
    loaded = true
    if (lastPayload) sendInit(lastPayload)
  }

  /** 子端主动要重置（回到锁屏/初始态） */
  function reset() {
    post('phone:reset', {})
  }

  /** 让子端跳到某个位置，便于"从某条内容开始预览" */
  function goto(app, screen, entityId) {
    post('phone:goto', { app, screen, entityId })
  }

  function handleMessage(event) {
    if (disposed) return

    // ① origin 校验（file:// 下两边都是 "null"）
    const expected = window.location.origin
    const originOk = expected === 'null' ? event.origin === 'null' : event.origin === expected
    if (!originOk) return

    // ② source 校验：必须是我的 iframe，别人的消息一律不理
    const win = childWindow()
    if (!win || event.source !== win) return

    const data = event.data
    if (!data || data.channel !== CHANNEL) return
    // ③ 版本漂移：未知版本静默忽略，不让旧页面把新页面搞崩
    if (data.v !== PROTOCOL_VERSION) return

    switch (data.type) {
      case 'phone:ready': {
        stats.receivedReady += 1
        ready = true
        // 子端就绪但父端还没发过数据（或刚 reload）：把待发帧用 init 带过去
        if (pending) {
          const payload = pending
          pending = null
          sendInit(payload)
        }
        onReady?.()
        break
      }
      case 'phone:navigate':
        onNavigate?.(data.payload ?? {})
        break
      case 'phone:error':
        stats.receivedError += 1
        onError?.(data.payload ?? {})
        break
      case 'phone:metrics':
        stats.receivedMetrics += 1
        stats.lastMetrics = data.payload ?? {}
        onMetrics?.(stats.lastMetrics)
        break
      default:
        // 未知 type 静默忽略
        break
    }
  }

  function attach() {
    window.addEventListener('message', handleMessage)
  }

  function dispose() {
    disposed = true
    if (timer) clearTimeout(timer)
    timer = 0
    window.removeEventListener('message', handleMessage)
  }

  return {
    attach,
    dispose,
    handleLoad,
    push,
    reset,
    goto,
    stats,
    get ready() {
      return ready
    },
    get loaded() {
      return loaded
    },
  }
}
