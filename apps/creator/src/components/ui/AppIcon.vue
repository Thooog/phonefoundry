<script setup>
defineProps({ name: { type: String, default: 'overview' } })
const paths = {
  overview: 'M3 10 12 3l9 7v10H7V10m3 10v-6h4v6',
  characters: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8m8-7a4 4 0 0 1 0 8',
  photos: 'M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1m-1 14 5-5 4 4 4-6 5 7M8 7h.01',
  kakaotalk: 'M21 11c0 5-4 8-9 8H9l-5 3 1-5a8 8 0 0 1-2-6c0-5 4-8 9-8s9 3 9 8M9 8v7m5-7-5 4 5 3',
  messages: 'M21 11c0 5-4 8-9 8H9l-5 3 1-5a8 8 0 0 1-2-6c0-5 4-8 9-8s9 3 9 8M8 11h.01M12 11h.01M16 11h.01',
  x: 'M4 3h4l12 18h-4L4 3m16 0L4 21',
  phone: 'M5 3H3v5c0 7 6 13 13 13h5v-5l-5-2-2 3a14 14 0 0 1-7-7l3-2-2-5H5',
  instagram: 'M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4m5 5a4 4 0 1 0 0 8 4 4 0 0 0 0-8m5-1h.01',
  notes: 'M5 3h14v18H5V3m3 5h8m-8 4h8m-8 4h5',
  'home-layout': 'M3 3h8v8H3zM15 3h6v6h-6zM15 13h6v8h-6zM3 15h8v6H3z',
  settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8m-2-5h4l1 3 3 1 3 3v4l-3 1-1 3-3 3h-4l-1-3-3-1-3-3v-4l3-1 1-3 3-3',
}
</script>
<template><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="paths[name] || paths.overview" /></svg></template>
