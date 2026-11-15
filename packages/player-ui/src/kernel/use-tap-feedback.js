/**
 * 「点得动、但哪也不去」的按压反馈。
 *
 * 作品里有一批控件在真机上是入口，但我们这里没有对应页面（通话、更多、加好友、
 * 设置、未读筛选、会话顶栏的搜索/云端/菜单…）。让它们完全点不动会被当成
 * "界面坏了"，所以给一次按压高亮：只改 class，不 push/pop、不改屏。
 *
 * ⚠️ 反馈必须跟手，不能"点完还亮一会儿"：
 *   pointerdown 立刻点亮 → 按住期间一直亮（和真机按下去被压暗一样）→
 *   pointerup 立刻熄灭。只有「快到看不见」的轻点才补到 minMs 的最短可见时长，
 *   所以快速点一下 ≈ 亮 90ms 就没了。
 *   早期版本是 click 之后固定亮 360ms，抬手后高亮还挂着，用户反馈"点一下卡一下"。
 *
 * 用法：
 *   const { pinged, ping, pingDown, pingUp } = useTapFeedback()
 *   <button :class="{ 'x--ping': pinged === 'a' }"
 *           @pointerdown="pingDown('a')" @pointerup="pingUp"
 *           @pointercancel="pingUp" @pointerleave="pingUp"
 *           @click="ping('a')">
 *
 * 单个计时器（而不是每个控件一个）：连点时先清掉上一条，永远只亮最后点的那颗，
 * 也不会出现"第一下亮、第二下被上一条计时器提前熄灭"的鬼故事。
 */
import { onBeforeUnmount, ref } from 'vue'

/** 轻点的最短可见时长：再短就真的看不见了 */
const DEFAULT_MIN_MS = 90
/** pointerup 之后这么久内的 click 视为同一次交互，跳过（否则抬手后又亮一次） */
const CLICK_AFTER_POINTER_MS = 500

export function useTapFeedback(minMs = DEFAULT_MIN_MS) {
  const pinged = ref('')
  let timer = null
  let downAt = 0
  let upAt = -Infinity

  function clear() {
    clearTimeout(timer)
    timer = null
  }

  function pingDown(name) {
    downAt = performance.now()
    clear()
    pinged.value = name
  }

  function pingUp() {
    // 先判空再记 upAt：鼠标只是划过（没按下）不算一次交互，
    // 否则随后的键盘 Enter 会被误判成"指针的 click"而吞掉。
    if (!pinged.value) return
    upAt = performance.now()
    const rest = minMs - (upAt - downAt)
    clear()
    if (rest <= 0) {
      pinged.value = ''
      return
    }
    timer = setTimeout(() => { pinged.value = '' }, rest)
  }

  /**
   * click 兜底：键盘 Enter/空格、以及脚本直接 .click() 没有 pointer 过程。
   * 指针路径的 click 紧接着自己那次 pointerup 到达，已经处理过，这里跳过。
   */
  function ping(name) {
    if (performance.now() - upAt < CLICK_AFTER_POINTER_MS) return
    downAt = performance.now()
    clear()
    pinged.value = name
    timer = setTimeout(() => { pinged.value = '' }, minMs)
  }

  onBeforeUnmount(clear)

  return { pinged, pingDown, pingUp, ping }
}
