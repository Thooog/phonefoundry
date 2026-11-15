

import { reactive, computed, provide, inject, unref } from 'vue'
import { getApp } from '@phone-sim/shared'

export const PHONE_RUNTIME = Symbol('phone-runtime')

/** 每个应用的根屏名 */
export const ROOT_SCREEN = 'root'

/**
 * @param {{ locked?: boolean, work?: object|null }} [options]
 */
export function createPhoneRuntime(options = {}) {
  const state = reactive({
    /** 是否在锁屏 */
    locked: options.locked ?? true,
    /** 是否显示密码盘（锁屏上叠加，不改变 locked） */
    passcodeOpen: false,
    /** 当前应用 id；null = 在桌面 */
    currentApp: null,
    /** 应用内导航栈，元素为 { name, params } */
    stack: [],
    /**
     * 最近一次跳转方向：'push' | 'pop' | 'fade' | 'none'，供过渡动画选择方向。
     * 'fade' 专给「跨应用借道」（信息应用点呼叫 → 电话通话屏）：整层淡入淡出，
     * 不做横移 —— 通话是全屏接管，滑进来会让人以为又推进了一层页面。
     */
    transition: 'none',

    booted: false,

    statusTone: 'auto',

    photoFlags: {},
    /**
     * 两本受密码保护的相簿本轮是否已解锁：{ hidden, trash }。
     *
     * 和 photoFlags 一样必须挂在 runtime 上 —— AppHost 切应用会把组件整层卸载，
     * 组件内的 ref 一重挂就丢，那样「输完密码进相簿、退回相簿页再点一次」会莫名又要输。
     * 反过来它又不能像 photoFlags 那样长期保留：iOS 的「已隐藏 / 最近删除」是
     * 离开应用再回来重新验证，所以 openApp / lock / reset / goto 一律清空。
     */
    photoUnlocked: { hidden: false, trash: false },
  })

  const currentScreen = computed(() => state.stack[state.stack.length - 1] ?? null)
  const atHome = computed(() => !state.locked && state.currentApp === null)
  const canGoBack = computed(() => state.currentApp !== null)

  function clearPhotoUnlocked() {
    state.photoUnlocked = { hidden: false, trash: false }
  }

  /**
   * 滚动位置记忆。
   *
   * 为什么必须放在运行时里：应用内返回上一层时，上一屏是**重新挂载**的
   * （列表与详情用 v-if 互斥），scrollTop 会归零 —— 真机 iOS 会保留。
   * 往下滑了二十行点进详情、返回又被弹回顶部，是"这不是手机"最直接的破绽。
   *
   * 键由调用方给（如 'kakaotalk:list'）：运行时只负责存取，不猜语义。
   * 之所以不放进模块级 Map，是因为同一个页面里可能有多个运行时
   * （比如文档里并排演示两部手机），共用一个表会让两部手机互相串位置。
   */
  const scrollMemory = new Map()

  /** @param {string} key @param {number} top */
  function rememberScroll(key, top) {
    if (!key || !Number.isFinite(top) || top < 0) return
    scrollMemory.set(key, top)
  }

  /** @param {string} key */
  function recallScroll(key) {
    if (!key) return 0
    return scrollMemory.get(key) ?? 0
  }

  /**
   * 清空记忆。
   * 只在"整机状态作废"时调用（回锁屏 / 复位）：
   * 从桌面重新点进应用**不**清 —— 那正是要记住的场景。
   */
  function clearScrollMemory() {
    scrollMemory.clear()
  }

  let borrowedFrom = null

  /** 进入应用（等价于桌面点图标） */
  function openApp(appId) {
    if (!appId) return
    borrowedFrom = null
    // 换应用 = 上一轮的相簿解锁作废：iOS 是重新进照片才重新验证
    clearPhotoUnlocked()
    state.currentApp = appId
    state.stack = [{ name: ROOT_SCREEN, params: null }]
    state.transition = 'push'
    state.passcodeOpen = false

    state.statusTone = 'auto'
  }

  /**
   * 借道进入另一个应用的某一屏，并记下来处。
   *
   * 用途单一但很关键：信息应用里点「呼叫」要直接落到电话的通话屏。
   * 栈里保留 root 是为了兼容电话应用自己的假设（栈永远至少一项），
   * 但用户看到的只有借道那一屏；退出走 returnFromBorrow，不 pop。
   *
   * @param {string} appId 目标应用
   * @param {string} name 目标屏名
   * @param {object|string|null} [params]
   * @returns {boolean} 是否借道成功
   */
  function borrowApp(appId, name, params = null) {
    if (!appId || !name) return false
    // 已经在借道中就不要覆盖来处：连点两次「呼叫」时，第二次记下的"来处"
    // 会是电话自己，挂断就又跳错了。只换目标屏，来处保留最初那一次。
    if (!borrowedFrom) {
      borrowedFrom = {
        app: state.currentApp,
        stack: state.stack.map((s) => ({ name: s.name, params: s.params })),
      }
    }
    state.currentApp = appId
    state.stack = [
      { name: ROOT_SCREEN, params: null },
      { name, params },
    ]
    state.transition = 'fade'
    state.passcodeOpen = false
    state.statusTone = 'auto'
    return true
  }

  /**
   * 从借道中退出：原样还回来处（应用 + 栈位置）。
   * @returns {boolean} 当时是否处于借道中；false 表示调用方该走普通 pop
   */
  function returnFromBorrow() {
    if (!borrowedFrom) return false
    const back = borrowedFrom
    borrowedFrom = null
    state.currentApp = back.app
    state.stack = back.stack
    state.transition = 'fade'
    // 借道屏（通话）可能把状态栏切成了白字；组件是整层卸载的，
    // 它自己的 watch 不会跑到，必须在这里还回自动判断，否则浅色页面配白字。
    state.statusTone = 'auto'
    return true
  }

  /**
   * 设置状态栏字色。
   * 只接受 'light' / 'dark'，其余（含 'auto'）都按自动处理 ——
   * 组件传错值时宁可回到默认，也不要让整屏文字消失。
   * @param {'light'|'dark'|'auto'} tone
   */
  function setStatusTone(tone) {
    state.statusTone = tone === 'light' || tone === 'dark' ? tone : 'auto'
  }

  /**
   * 应用内前进一层。
   * @param {string} name 屏幕名（应用自己定义）
   * @param {object|null} [params] 屏幕参数（如会话 id）
   */
  function push(name, params = null) {
    if (!state.currentApp || !name) return
    // 同名同参重复 push 是明显的 bug（双击/重复触发），直接忽略而不是压两层
    const top = state.stack[state.stack.length - 1]
    if (top && top.name === name && sameParams(top.params, params)) return
    state.stack.push({ name, params })
    state.transition = 'push'
  }

  /**
   * 退一层。已在应用根屏时退回桌面。
   * @returns {boolean} 是否发生了变化
   */
  function pop() {
    if (state.currentApp === null) return false
    if (state.stack.length > 1) {
      state.stack.pop()
      state.transition = 'pop'
      return true
    }
    state.currentApp = null
    state.stack = []
    state.transition = 'pop'
    state.statusTone = 'auto'
    return true
  }

  function goHome() {
    if (state.currentApp === null) return false
    borrowedFrom = null
    state.currentApp = null
    state.stack = []
    state.transition = 'pop'
    state.statusTone = 'auto'
    return true
  }

  /** 解锁（密码校验通过或本来就没设密码时调用） */
  function unlock() {
    state.locked = false
    state.passcodeOpen = false
    state.booted = true
    state.transition = 'none'
  }

  /**
   * 取走"刚开机"标记 —— 桌面入场动画只该播一次。
   *
   * 做成"读取即消费"而不是让调用方自己判断：从应用退回桌面时再抖一次会显得很廉价，
   * 而这个判断只要有一个调用点忘了写，就会出现"有时播有时不播"的鬼故事。
   */
  function consumeBoot() {
    if (!state.booted) return false
    state.booted = false
    return true
  }

  /** 回到锁屏：清空应用与栈，避免下次解锁时"接着上次的页面" */
  function lock() {
    state.locked = true
    state.passcodeOpen = false
    borrowedFrom = null
    state.currentApp = null
    state.stack = []
    state.transition = 'none'
    // 回到锁屏意味着"这一轮使用结束了"，滚动记忆一并作废
    clearScrollMemory()
    clearPhotoUnlocked()
    state.statusTone = 'auto'
  }

  function openPasscode() {
    state.passcodeOpen = true
  }

  function closePasscode() {
    state.passcodeOpen = false
  }

  /**
   * 预览定位：phone:goto 的实现。
   * 允许直接落到某应用某屏，用于"从这条内容开始预览"。
   * @param {{app?: string, screen?: string, entityId?: string}} target
   */
  function goto(target = {}) {
    const wanted = target.app && target.app !== 'home' ? target.app : null
    /**
     * 只认应用表里存在的 id。
     * 未知 id 会让 AppHost 落到 AppPlaceholder 占位页 —— 在用户看来就是
     * "点预览进来是个白板"，比停在桌面难解释得多。
     * 校验源用 shared 的应用表，不另维护一份名单。
     */
    const appId = wanted && getApp(wanted) ? wanted : null
    if (!appId) {
      state.locked = false
      goHome()
      return
    }
    state.locked = false
    borrowedFrom = null
    state.currentApp = appId
    state.stack = [{ name: target.screen || ROOT_SCREEN, params: target.entityId ?? null }]
    state.transition = 'none'
    state.statusTone = 'auto'
    // goto 意味着换了一次预览（可能是另一个作品），旧的玩家标记不能带过去
    clearPhotoUnlocked()
    state.photoFlags = {}
  }

  /** 整体复位（预览重载 / phone:reset） */
  function reset() {
    state.locked = true
    state.passcodeOpen = false
    borrowedFrom = null
    state.currentApp = null
    state.stack = []
    state.transition = 'none'
    state.booted = false
    clearScrollMemory()
    clearPhotoUnlocked()
    state.statusTone = 'auto'
    state.photoFlags = {}
  }

  return {
    state,
    currentScreen,
    atHome,
    canGoBack,
    openApp,
    borrowApp,
    returnFromBorrow,
    push,
    pop,
    goHome,
    setStatusTone,
    unlock,
    consumeBoot,
    lock,
    openPasscode,
    closePasscode,
    goto,
    reset,
    rememberScroll,
    recallScroll,
    clearScrollMemory,
  }
}

function sameParams(a, b) {
  if (a === b) return true
  if (a == null || b == null) return false
  if (typeof a !== 'object' || typeof b !== 'object') return false
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  return ka.every((k) => a[k] === b[k])
}

/** 在作品端根组件里提供运行时（子组件一律 inject，不通过 props 层层传） */
export function providePhoneRuntime(runtime) {
  provide(PHONE_RUNTIME, runtime)
  return runtime
}

/** 子组件取运行时；缺失时直接抛错，避免"静默不工作" */
export function usePhoneRuntime() {
  const runtime = inject(PHONE_RUNTIME, null)
  if (!runtime) {
    throw new Error('[phone-ui] 找不到手机运行时：请确认组件在 PhoneSimulator 内部使用。')
  }
  return runtime
}

/** 便捷读取当前工作数据（phoneWork 是一个函数，见 PhoneSimulator 的说明） */
export function useWorkData() {
  const getter = inject('phoneWork', null)
  const resolver = inject('phoneResolveAsset', null)
  return {
    getWork: () => (typeof getter === 'function' ? unref(getter()) : null),
    resolveAsset: (assetId) => (typeof resolver === 'function' ? resolver(assetId) : null),
  }
}
