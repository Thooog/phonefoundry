/**
 * 把消息时间线滚到最底（最新一条）。
 *
 * 桌面端 `.message-timeline` 自己就是滚动窗口（flex:1 + overflow:auto）；
 * 窄屏下它被改成 `overflow:visible`，滚动交给外层页面。所以不能写死滚哪一层，
 * 得从时间线往上找**真正在滚**的那个容器 —— 只看 overflow 样式不够，
 * 消息少的时候内层容器撑不出余量，滚它等于没滚。
 */
export function scrollToEnd(element, styleOf = getComputedStyle) {
  if (!element) return false
  let node = element
  while (node) {
    const scrolls = /^(auto|scroll)$/.test(styleOf(node).overflowY)
    if (scrolls && node.scrollHeight - node.clientHeight > 1) {
      node.scrollTop = node.scrollHeight
      return true
    }
    node = node.parentElement
  }
  return false
}
