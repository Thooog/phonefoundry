// Decide which scroll container owns a single-finger gesture before it reaches the document.
export function canConsumeScroll(elements, dx, dy, styleOf = getComputedStyle) {
  const horizontal = Math.abs(dx) > Math.abs(dy)
  const delta = horizontal ? dx : dy
  if (!delta) return false
  for (const element of elements) {
    const style = styleOf(element)
    const overflow = horizontal ? style.overflowX : style.overflowY
    if (!/^(auto|scroll)$/.test(overflow)) continue
    const position = horizontal ? element.scrollLeft : element.scrollTop
    const limit = horizontal ? element.scrollWidth - element.clientWidth : element.scrollHeight - element.clientHeight
    // 没有滚动余量的容器不是滚动目标 —— 浏览器会把手势交给祖先。
    // 这里必须跳过，不能套用 overscroll-behavior：窄屏下 `.record-workspace__detail`
    // / `.note-document__writing` 这类"高度随内容长"的容器就是空壳（limit 恒为 0），
    // 它们身上的 contain 会把整条滚动链在这里掐死，真正的滚动源 `.ws__main` 再也接管不到，
    // 表现就是手机上整页怎么滑都不动。
    if (limit < 2) continue
    if (delta < 0 ? position < limit - 1 : position > 1) return true
    const boundary = horizontal ? style.overscrollBehaviorX : style.overscrollBehaviorY
    if (boundary === 'contain' || boundary === 'none') return false
  }
  return false
}
