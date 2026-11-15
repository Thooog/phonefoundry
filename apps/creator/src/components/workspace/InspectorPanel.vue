<script setup>
import { ref, watch, nextTick, onBeforeUnmount } from 'vue'
import { useMediaQuery } from '../../composables/use-media-query.js'
const props = defineProps({ title: { type: String, default: '属性' }, photoLayout: Boolean, inlineAt: { type: Number, default: 1440 } })
const open = defineModel({ type: Boolean, default: false })
const wide = useMediaQuery(`(min-width: ${props.inlineAt}px)`)
const panel = ref(null)
let previousFocus
watch([open, wide], async ([show, inline]) => {
  await nextTick()
  if (inline || !(panel.value instanceof HTMLDialogElement)) return
  if (show && !panel.value.open) { previousFocus = document.activeElement; panel.value.showModal(); if (props.photoLayout) panel.value.focus() }
  else if (!show && panel.value?.open) panel.value.close()
}, { flush: 'post', immediate: true })
function close() { open.value = false; previousFocus?.focus?.() }
onBeforeUnmount(() => { if (panel.value?.open) panel.value.close(); previousFocus?.focus?.() })
</script>

<template>
  <component :is="wide ? 'aside' : 'dialog'" ref="panel" tabindex="-1" class="inspector-panel" :class="{ 'inspector-panel--photo': photoLayout, 'inspector-panel--inline': wide, 'inspector-panel--closed': wide && !open }" :aria-label="title" @cancel="close" @close="close" @click="!wide && $event.target === panel && close()">
    <header class="inspector-panel__head"><h3>{{ title }}</h3><slot v-if="!wide || open" name="header-actions" /><button v-if="!photoLayout" type="button" aria-label="关闭属性面板" @click="close">{{ wide ? '×' : '完成' }}</button></header>
    <slot v-if="!wide || open" /><button v-else class="inspector-panel__reopen" type="button" @click="open = true">打开{{ title }}</button>
    <slot v-if="!wide || open" name="footer" :close="close" :wide="wide" />
  </component>
</template>

<style scoped>
.inspector-panel{color:var(--c-text);background:var(--c-white);border:1px solid var(--c-border);border-radius:16px;padding:22px;width:min(400px,calc(100vw - 32px));max-height:90dvh;overflow:auto;box-shadow:var(--shadow-md)}.inspector-panel::backdrop{background:rgb(41 44 41 / 28%)}
.inspector-panel--inline{width:304px;max-height:none;min-width:0;position:sticky;top:24px;align-self:start}.inspector-panel--closed{box-shadow:none;background:transparent;border-color:transparent}.inspector-panel__head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:22px}.inspector-panel__head h3{font-size:18px;font-weight:600}.inspector-panel__head button{background:transparent;border:0;min-height:32px;min-width:32px;color:var(--c-text-3);font-size:14px}.inspector-panel__reopen{border:1px solid var(--c-border);border-radius:8px;background:white;padding:10px 14px;font:inherit}
.inspector-panel :deep(.message-property){display:grid;gap:7px;font-size:13px;color:var(--c-text-2);min-width:0}.inspector-panel :deep(.message-property input),.inspector-panel :deep(.message-property select),.inspector-panel :deep(.message-property textarea){width:100%;min-width:0;max-width:100%;min-height:38px;border:1px solid var(--c-border);border-radius:8px;padding:8px 10px;background:white;color:var(--c-text);font:inherit}.inspector-panel :deep(.message-property textarea){line-height:1.7;resize:vertical}
@media(max-width:767px){.inspector-panel{width:100%;max-width:none;margin:auto 0 0;max-height:90dvh;border-radius:18px 18px 0 0;padding:22px 16px max(22px,env(safe-area-inset-bottom))}.inspector-panel__head button{min-height:44px}.inspector-panel :deep(input),.inspector-panel :deep(select),.inspector-panel :deep(textarea){font-size:16px!important}}
.inspector-panel--photo:focus{outline:none}
/* Photos reserve the form and actions; only their preview gives up height. */
@media(max-width:1439px){
.inspector-panel--photo{height:calc(var(--creator-viewport-height,100dvh) - var(--layout-topbar-h) - 12px);max-height:calc(var(--creator-viewport-height,100dvh) - var(--layout-topbar-h) - 12px);display:grid;grid-template-rows:auto minmax(min-content,1fr) auto;gap:16px;box-sizing:border-box;overflow:auto}
.inspector-panel--photo:not([open]){display:none}
.inspector-panel--photo .inspector-panel__head{flex:none;margin-bottom:0}
}
@media(max-width:767px){.inspector-panel--photo{margin:auto 0 0;--layout-topbar-h:60px;padding-top:16px;gap:12px}}
@media(min-width:1440px){.inspector-panel--photo.inspector-panel--inline{position:static;max-height:none;overflow:visible}}
</style>
