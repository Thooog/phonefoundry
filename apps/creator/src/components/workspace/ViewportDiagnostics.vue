<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'

const summary = ref('')
const report = ref('')
const rows = []
let timer
let stopped = false
const round = value => Number.isFinite(value) ? Math.round(value * 100) / 100 : null
function sample(event = 'sample') {
  if (stopped) return
  const viewport = window.visualViewport
  const rect = element => {
    if (!element) return null
    const box = element.getBoundingClientRect()
    return { top: round(box.top), bottom: round(box.bottom), height: round(box.height), scrollTop: round(element.scrollTop) }
  }
  const row = {
    time: Date.now(), event: typeof event === 'string' ? event : event.type,
    innerHeight: window.innerHeight, innerWidth: window.innerWidth,
    scrollY: round(window.scrollY), clientHeight: document.documentElement.clientHeight,
    viewport: viewport ? Object.fromEntries(['height', 'width', 'offsetTop', 'pageTop', 'scale'].map(key => [key, round(viewport[key])])) : null,
    body: rect(document.body), app: rect(document.getElementById('app')),
    workspace: rect(document.querySelector('.ws')), main: rect(document.querySelector('.ws__main')),
    focusedTag: document.activeElement?.tagName,
    appliedHeight: document.documentElement.style.getPropertyValue('--creator-viewport-height'),
    appliedTop: document.documentElement.style.getPropertyValue('--creator-viewport-top'),
  }
  rows.push(row)
  // Preserve the initial baseline as well as the most recent two minutes.
  if (rows.length > 600) rows.splice(1, 1)
  summary.value = `可见高度 ${row.viewport?.height} / 页面高度 ${row.innerHeight}\n视口偏移 ${row.viewport?.offsetTop} / 页面顶部 ${row.app?.top}`
}
function finish() {
  sample('finish')
  stopped = true
  report.value = JSON.stringify({ version: 'viewport-diag-1', userAgent: navigator.userAgent, rows }, null, 2)
}
async function copy() {
  try {
    await navigator.clipboard.writeText(report.value)
    summary.value = '诊断记录已复制'
  } catch {
    summary.value = '请长按下方记录，选择全选并复制'
  }
}
onMounted(() => {
  sample('mounted')
  timer = window.setInterval(sample, 250)
  document.addEventListener('focusin', sample)
  document.addEventListener('focusout', sample)
  window.visualViewport?.addEventListener('resize', sample)
  window.visualViewport?.addEventListener('scroll', sample)
})
onBeforeUnmount(() => {
  window.clearInterval(timer)
  document.removeEventListener('focusin', sample)
  document.removeEventListener('focusout', sample)
  window.visualViewport?.removeEventListener('resize', sample)
  window.visualViewport?.removeEventListener('scroll', sample)
})
</script>

<template>
  <Teleport to="body">
    <aside class="viewport-diagnostics" aria-label="键盘诊断">
      <strong>键盘诊断 · diag-1</strong>
      <pre>{{ summary }}</pre>
      <button v-if="!report" type="button" @click="finish">空白出现后，结束记录</button>
      <template v-else>
        <button type="button" @click="copy">复制诊断记录</button>
        <textarea :value="report" readonly aria-label="诊断记录" @focus="$event.target.select()"></textarea>
      </template>
    </aside>
  </Teleport>
</template>

<style scoped>
.viewport-diagnostics{position:fixed;z-index:2147483647;top:8px;right:8px;max-width:min(330px,90vw);padding:10px;background:#222;color:#fff;border:1px solid #aaa;border-radius:8px;font:12px/1.5 sans-serif}
pre{white-space:pre-wrap;margin:6px 0}button{min-height:44px;padding:8px;color:#111;background:#fff;border:0;border-radius:4px}textarea{display:block;width:100%;height:100px;margin-top:8px;font-size:16px}
</style>
