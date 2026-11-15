/**
 * 时钟信号 —— 对齐到分钟边界刷新。
 *
 * 为什么不是 setInterval(1000)：
 *   状态栏与锁屏都只要"时:分"，每秒唤醒一次主线程纯属浪费，
 *   在低端机上还会和滚动/动画抢时间片（表现为滚动时时间数字轻微跳动）。
 *   对齐到下一个整分钟刷新，误差只在这一分钟内，视觉上完全看不出。
 *
 * 为什么不用 `new Date().setSeconds(0)` 反推：
 *   那样算出来的是"这一分钟的起点"，而我们要的是"下一分钟的起点"，容易差一分钟。
 *   直接 `60000 - (now % 60000)` 最不容易写错。
 */

import { ref, onMounted, onBeforeUnmount } from 'vue'

export function useClock({ enabled = true, interval = 60000 } = {}) {
  const now = ref(new Date())
  let timer = 0

  function schedule() {
    // +50ms 余量：定时器可能早于边界触发，早触发会导致这一分钟被跳过
    const delay = interval - (Date.now() % interval) + 50
    timer = setTimeout(() => {
      now.value = new Date()
      schedule()
    }, delay)
  }

  onMounted(() => {
    if (!enabled) return
    now.value = new Date()
    schedule()
  })

  onBeforeUnmount(() => clearTimeout(timer))

  return now
}
