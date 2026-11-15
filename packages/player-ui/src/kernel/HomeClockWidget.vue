<script setup>
import { computed } from 'vue'
import { useClock } from './use-clock.js'

const now = useClock({ interval: 1000 })
const seconds = computed(() => now.value.getSeconds())
const minutes = computed(() => now.value.getMinutes() + seconds.value / 60)
const hours = computed(() => now.value.getHours() % 12 + minutes.value / 60)
const label = computed(() => now.value.toLocaleTimeString('zh-CN', { hour12: false }))
</script>

<template>
  <span class="pui-clock-widget" role="img" :aria-label="`时钟 ${label}`">
    <svg viewBox="0 0 160 160" aria-hidden="true">
      <circle class="pui-clock-widget__face" cx="80" cy="80" r="65" fill="#fff" />
      <g stroke="#383838" stroke-width="1.4" stroke-linecap="round">
        <path v-for="tick in [1, 2, 4, 5, 7, 8, 10, 11]" :key="tick" d="M80 23v4" :transform="`rotate(${tick * 30} 80 80)`" />
      </g>
      <g fill="#171717" font-family="Arial, sans-serif" font-size="16" text-anchor="middle">
        <text x="80" y="35">12</text><text x="133" y="86">3</text><text x="80" y="139">6</text><text x="27" y="86">9</text>
      </g>
      <path d="M80 84V49" :transform="`rotate(${hours * 30} 80 80)`" stroke="#171717" stroke-width="4.5" stroke-linecap="round" />
      <path d="M80 86V29" :transform="`rotate(${minutes * 6} 80 80)`" stroke="#171717" stroke-width="2.8" stroke-linecap="round" />
      <circle cx="80" cy="80" r="4.5" fill="#171717" />
      <path d="M80 89V23" :transform="`rotate(${seconds * 6} 80 80)`" stroke="#ed3b32" stroke-width="1.4" />
      <circle cx="80" cy="80" r="2.3" fill="#ed3b32" />
    </svg>
  </span>
</template>

<style scoped>
.pui-clock-widget { display: block; width: 100%; height: 100%; border-radius: inherit; background: linear-gradient(145deg, #fcfcfd, #f3f3f6); }
.pui-clock-widget svg { display: block; width: 100%; height: 100%; }
.pui-clock-widget__face { filter: drop-shadow(0 3px 5px rgb(0 0 0 / 13%)); }
</style>
