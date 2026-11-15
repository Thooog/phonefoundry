

<script setup>
import { computed } from 'vue'
import { formatClock, TIME_FORMAT } from '@phone-sim/shared'
import { useClock } from './use-clock.js'

const props = defineProps({
  /** 'dark' = 深色文字（浅背景）| 'light' = 白色文字（壁纸/深色导航栏上） */
  tone: { type: String, default: 'dark' },
  timeFormat: { type: String, default: TIME_FORMAT.H24 },
})

const now = useClock()
const label = computed(() => formatClock(now.value, props.timeFormat))
</script>

<template>
  <div class="pui-statusbar" :data-tone="tone" data-testid="statusbar">
    <span class="pui-statusbar__time" data-testid="statusbar-time">{{ label }}</span>

    <span class="pui-statusbar__icons">
      <!-- 信号：四格，逐格升高 -->
      <svg viewBox="0 0 18 12" width="17" height="11" aria-hidden="true">
        <rect x="0" y="8" width="3" height="4" rx="1" fill="currentColor" />
        <rect x="5" y="6" width="3" height="6" rx="1" fill="currentColor" />
        <rect x="10" y="3.5" width="3" height="8.5" rx="1" fill="currentColor" />
        <rect x="15" y="1" width="3" height="11" rx="1" fill="currentColor" opacity="0.35" />
      </svg>

      <!-- Wi-Fi：三段弧 + 圆点 -->
      <svg viewBox="0 0 16 12" width="16" height="11" aria-hidden="true">
        <g fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">
          <path d="M1.2 4.2a10 10 0 0113.6 0" />
          <path d="M4 7a6.2 6.2 0 018 0" />
        </g>
        <circle cx="8" cy="10" r="1.5" fill="currentColor" />
      </svg>

      <!-- 电量：外壳 + 填充 + 电极 -->
      <svg viewBox="0 0 27 13" width="25" height="12" aria-hidden="true">
        <rect
          x="0.6"
          y="1"
          width="22"
          height="11"
          rx="3.6"
          fill="none"
          stroke="currentColor"
          stroke-width="1.2"
          opacity="0.42"
        />
        <rect x="2.4" y="2.8" width="16" height="7.4" rx="2.2" fill="currentColor" />
        <path d="M24.4 4.6v3.8c1.1-.3 1.6-1 1.6-1.9s-.5-1.6-1.6-1.9z" fill="currentColor" opacity="0.45" />
      </svg>
    </span>
  </div>
</template>

<style>
.pui-statusbar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: var(--pui-z-statusbar);
  height: var(--pui-statusbar-h);
  display: flex;
  align-items: center;
  justify-content: space-between;
  /* 左右留白避开圆角与灵动岛：灵动岛居中占 31.8%，两侧各留 20px */
  padding: 0 var(--pui-space-6) 0 var(--pui-space-6);
  color: var(--pui-label);
  pointer-events: none;
  font-variant-numeric: tabular-nums;
}

.pui-statusbar[data-tone='light'] {
  color: #fff;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
}

.pui-statusbar__time {
  font-size: var(--pui-font-subhead);
  font-weight: var(--pui-weight-semibold);
  letter-spacing: 0;
  /* 状态栏时间在灵动岛左侧，稍微左移 2px 更接近真机视觉 */
  padding-left: 2px;
}

.pui-statusbar__icons {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
</style>
