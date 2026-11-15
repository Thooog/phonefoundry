<script setup>
import { computed } from 'vue'
import { staticHomeHtml } from './static-home-html.js'

const props = defineProps({
  html: { type: String, required: true },
  title: { type: String, required: true },
})
const srcdoc = computed(() => staticHomeHtml(props.html))
</script>

<template>
  <iframe class="pui-static-home-html" sandbox="" inert tabindex="-1" aria-hidden="true" :title="title" :srcdoc="srcdoc" />
</template>

<style>
.pui-static-home-html {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
  pointer-events: none;
}
</style>
