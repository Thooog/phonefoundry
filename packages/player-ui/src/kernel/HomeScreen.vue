<script setup>
import { onMounted, ref } from 'vue'
import HomeDesktop from './HomeDesktop.vue'
import { usePhoneRuntime, useWorkData } from './create-runtime.js'

const runtime = usePhoneRuntime()
const { getWork, resolveAsset } = useWorkData()
const entering = ref(false)
onMounted(() => {
  entering.value = runtime.consumeBoot()
})
</script>

<template>
  <HomeDesktop :work="getWork()" :resolve-asset="resolveAsset" :entering="entering" @open="runtime.openApp" />
</template>
