<script setup>
defineProps({ type: { type: String, default: 'incoming' } })
</script>

<template>
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path v-if="type === 'outgoing'" d="M5 19 19 5M7 5h12v12" />
    <template v-else>
      <path d="m6 3-3 2c-1 1 1 6 5 10s9 6 10 5l3-3-5-4-3 2a17 17 0 0 1-5-5l2-3Z" :fill="type === 'missed' ? 'currentColor' : 'none'" />
      <path v-if="type === 'missed'" d="m16 7 5-5" />
      <path v-else d="m15 3 6 0 0 6m0-6-6 6" />
    </template>
  </svg>
</template>
