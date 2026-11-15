/**
 * 动效降级信号。
 *
 * 作品端会跑在三种环境里：创作端预览 iframe、导出的独立 HTML、手机浏览器。
 * 用户可能在任何一处打开"减少动态效果"（iOS 辅助功能 / Android 无障碍 / 桌面系统设置），
 * 此时弹簧、抖动、缩放反馈都应当收敛成"直接到位 + 轻微淡入"。
 *
 * 为什么不用 CSS 的 @media 就完事：
 *   - 手势位移是 JS 驱动的 transform，CSS 媒体查询管不到；
 *   - 解锁的"松手是否越过阈值"要按瞬间落位来判定，不能走 300ms 动画。
 * 所以这里提供的是**给 JS 读的信号**，CSS 侧的降级仍然由 tokens.css 负责。
 */

import { ref } from 'vue'

const QUERY = '(prefers-reduced-motion: reduce)'

/** 一次性读取（无需响应式时用，避免创建订阅） */
export function prefersReducedMotion() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(QUERY).matches
}

/** 全端共享一个 ref：系统设置变化时所有消费者同时收到 */
let sharedRef = null

export function useReducedMotion() {
  if (sharedRef) return sharedRef

  const value = ref(prefersReducedMotion())
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    const mq = window.matchMedia(QUERY)
    const onChange = (event) => {
      value.value = event.matches
    }

    if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange)
    else if (typeof mq.addListener === 'function') mq.addListener(onChange)
  }

  sharedRef = value
  return sharedRef
}
