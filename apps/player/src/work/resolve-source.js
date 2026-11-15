

/** 等待父窗口数据的超时（毫秒）。超时后进入空态但继续监听。 */
const PREVIEW_WAIT_MS = 1200

export async function resolveSource() {
  const injected = readInjected()

  if (injected) {
    return {
      mode: injected.mode ?? 'inline',
      basePath: injected.basePath ?? '',
      work: injected.work ?? null,
      assets: injected.assets ?? {},

      start: null,
      onUpdate: null,
      onControl: null,
      notifyReady: null,
      reportMetrics: null,
    }
  }

  // 无内联数据 → 尝试预览模式
  const preview = await waitForPreview()
  return preview
}

/** 读取导出时注入的全局变量 */
function readInjected() {
  const raw = typeof window !== 'undefined' ? window.__PHONE_WORK__ : null
  if (!raw || typeof raw !== 'object') return null
  return {
    mode: raw.mode === 'folder' ? 'folder' : 'inline',
    basePath: typeof raw.basePath === 'string' ? raw.basePath : '',
    work: raw.work ?? null,
    assets: raw.assets ?? {},
  }
}

function waitForPreview() {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || window.parent === window) {

      resolve({
        mode: 'empty',
        basePath: '',
        work: null,
        assets: {},
        start: null,
        onUpdate: null,
        onControl: null,
        notifyReady: null,
        reportMetrics: null,
      })
      return
    }

    let settled = false

    const listeners = new Set()
    /** 控制指令（goto / reset）的订阅者：由 renderer 转交给手机运行时 */
    const controls = new Set()
    /**
     * 早到的控制指令。
     *
     * 父端收到 phone:ready 就会发定位指令，而这个 ready 是本模块一启动就发的，
     * 比 Vue 挂载更早 —— 那一刻 controls 还是空集合，`forEach` 一遍等于**静默丢弃**，
     * 表现为"URL 带了定位却停在锁屏"。存最后一条，等订阅者出现立刻补发。
     * 只留最后一条：连续两条定位里前一条已经没有意义。
     */
    let pendingControl = null

    function postToParent(type, payload = {}) {
      try {
        window.parent.postMessage(
          { channel: 'phone-preview', v: 1, type, payload },
          window.location.origin === 'null' ? '*' : window.location.origin,
        )
      } catch {
        // 父窗口已关闭，忽略
      }
    }

    function onMessage(event) {
      const data = event.data
      if (!data || data.channel !== 'phone-preview' || data.v !== 1) return
      // 只认父窗口发的，同源 iframe 之间不能互相串数据
      if (event.source !== window.parent) return

      // 控制指令不影响数据，任何时候都直接派发（不需要等 settled）
      if (data.type === 'phone:goto' || data.type === 'phone:reset') {
        const control = { type: data.type, payload: data.payload ?? {} }
        // 订阅者还没注册：先存着，别丢（见 pendingControl 的说明）
        if (controls.size === 0) {
          pendingControl = control
          return
        }
        controls.forEach((fn) => fn(control.type, control.payload))
        return
      }
      if (data.type !== 'phone:init' && data.type !== 'phone:update') return

      const payload = data.payload ?? {}
      const next = {
        mode: 'preview',
        basePath: '',
        work: payload.work ?? null,
        assets: payload.assets ?? {},

        start: payload.start ?? null,
      }

      if (!settled) {
        settled = true
        resolve({
          ...next,
          onUpdate: subscribe,
          onControl: subscribeControl,
          notifyReady: () => postToParent('phone:ready'),
          reportMetrics: (metrics) => postToParent('phone:metrics', metrics),
        })
        return
      }
      // 已 settle：正常的分支是交给订阅者做数据合并（不重建组件树）
      listeners.forEach((fn) => fn(next))
    }

    function subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    }

    function subscribeControl(fn) {
      controls.add(fn)
      // 补发早到的指令。放在这里而不是 setTimeout：
      // renderer 是先 mount 再注册订阅，此刻实例一定已经存在，不必再猜延迟。
      if (pendingControl) {
        const { type, payload } = pendingControl
        pendingControl = null
        try {
          fn(type, payload)
        } catch (err) {
          // 定位失败不该拖垮整机渲染，但也不能假装没发生
          console.warn('[phone-sim] 补发定位指令失败', err)
        }
      }
      return () => controls.delete(fn)
    }

    window.addEventListener('message', onMessage)
    postToParent('phone:ready')

    setTimeout(() => {
      if (settled) return
      // 超时：仍然保持同一个监听器，父窗口晚到照样能注入（只是首帧走 listeners 分支）
      settled = true
      resolve({
        mode: 'empty',
        basePath: '',
        work: null,
        assets: {},
        start: null,
        onUpdate: subscribe,
        onControl: subscribeControl,
        notifyReady: () => postToParent('phone:ready'),
        reportMetrics: (metrics) => postToParent('phone:metrics', metrics),
      })
    }, PREVIEW_WAIT_MS)
  })
}
