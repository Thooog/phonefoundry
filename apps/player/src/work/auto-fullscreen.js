/**
 * 自动全屏 —— 作品设置里那个开关在**导出的作品**里的落地动作。
 *
 * 三条必须守住的边界：
 *
 *  1. **预览（iframe）里不做**。
 *     创作端预览把作品装在一个 iframe 里，全屏进去的是那个 iframe，
 *     创作者会看到"编辑界面突然被预览吞掉"，而读者永远不会用这种方式看作品。
 *
 *  2. **用户退出全屏后绝不重新进入**。
 *     自动全屏是"帮读者省一次点击"，不是"接管读者的窗口"。
 *     一旦变成关不掉，读者连 Esc 之外的出路都没有 —— 那是浏览器只留给站点的最后一点克制。
 *     所以这里只尝试一次（+ 一次手势兜底），成功或失败都立刻收工。
 *
 *  3. **失败必须静默**。
 *     file:// 双击打开、没有用户手势、企业策略禁用全屏……这些情况占比很高，
 *     弹一个 console.error 只会让读者以为作品坏了。体验是"什么都没发生"，
 *     而这正是"自适应"模式本来就有的画面。
 */

/**
 * 尝试进入全屏。
 *
 * 流程：先试一次（某些环境允许无手势直接进入），失败就挂一次性手势监听，
 * 读者在页面上点一下再试一次 —— 这也是绝大多数浏览器的实际要求。
 *
 * @returns {boolean} 是否已开始尝试（不是"是否成功"）
 */
export function requestAutoFullscreen() {
  // SSR / 非浏览器环境：直接放弃，不该为了一个锦上添花的动作抛错
  if (typeof document === 'undefined' || typeof window === 'undefined') return false

  // 判断 1：iframe 里不自动全屏
  try {
    if (window.parent !== window) return false
  } catch {
    // 跨域时读 parent 也会抛 —— 能抛就说明自己确实在框里
    return false
  }

  const target = document.documentElement
  const requestFullscreen = target.requestFullscreen ?? target.webkitRequestFullscreen
  if (typeof requestFullscreen !== 'function') return false

  /** 兜底的交互事件：浏览器通常要求有一次用户手势才肯放行全屏 */
  const GESTURE_EVENTS = ['pointerdown', 'touchend', 'keydown']
  let settled = false

  function unbind() {
    for (const type of GESTURE_EVENTS) window.removeEventListener(type, onGesture)
    document.removeEventListener('fullscreenchange', onChange)
    document.removeEventListener('webkitfullscreenchange', onChange)
  }

  function stop() {
    if (settled) return
    settled = true
    unbind()
  }

  function enter() {
    try {
      // 旧的 webkit 实现返回 undefined，标准实现返回 Promise —— 两者都要能接
      const result = requestFullscreen.call(target)
      if (result && typeof result.catch === 'function') result.catch(() => {})
    } catch {
      // 无权全屏：静默降级（理由见文件头第 3 条）
    }
  }

  /** 兜底：读者第一次交互时再试一次，然后无论成败都收工 */
  function onGesture() {
    if (settled) return
    enter()
    stop()
  }

  /** 进也好退也好，状态一落地就收工：绝不追着读者重新进入 */
  function onChange() {
    stop()
  }

  for (const type of GESTURE_EVENTS) window.addEventListener(type, onGesture, { passive: true })
  document.addEventListener('fullscreenchange', onChange)
  document.addEventListener('webkitfullscreenchange', onChange)

  enter()
  return true
}
