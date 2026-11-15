<script setup>
import { useId } from 'vue'
defineProps({ iconKey: { type: String, required: true } })
const id = `redraw-${useId()}`
const paint = name => `url(#${id}-${name})`
</script>

<!-- Individually constructed SVG geometry; no embedded reference images. -->
<template>
  <g>
    <defs>
      <linearGradient :id="`${id}-white`" x2="0" y2="1"><stop stop-color="#fff" /><stop offset="1" stop-color="#ebebea" /></linearGradient>
      <linearGradient :id="`${id}-blue`" x2="0" y2="1"><stop stop-color="#45c9fa" /><stop offset=".45" stop-color="#2099fa" /><stop offset="1" stop-color="#0061f7" /></linearGradient>
      <linearGradient :id="`${id}-silver`" x2="0" y2="1"><stop stop-color="#e5e5e2" /><stop offset="1" stop-color="#bdbdb9" /></linearGradient>
      <linearGradient :id="`${id}-dark`" x2="0" y2="1"><stop stop-color="#474744" /><stop offset=".5" stop-color="#181817" /><stop offset="1" stop-color="#41413e" /></linearGradient>
      <linearGradient :id="`${id}-screen`" x2="0" y2="1"><stop stop-color="#a3a39f" /><stop offset="1" stop-color="#4e504d" /></linearGradient>
      <linearGradient :id="`${id}-envelope`" x2="0" y2="1"><stop stop-color="#fff" /><stop offset=".45" stop-color="#daedfe" /><stop offset="1" stop-color="#398cf0" /></linearGradient>
      <linearGradient :id="`${id}-cloud`" x2="0" y2="1"><stop stop-color="#fff" /><stop offset=".45" stop-color="#d2eaff" /><stop offset="1" stop-color="#5490cf" /></linearGradient>
      <linearGradient :id="`${id}-sun`" x2="0" y2="1"><stop stop-color="#fff066" /><stop offset="1" stop-color="#ffba00" /></linearGradient>
      <linearGradient :id="`${id}-folder`" x2="0" y2="1"><stop stop-color="#04c8f7" /><stop offset="1" stop-color="#1484ed" /></linearGradient>
      <radialGradient :id="`${id}-lens`" cx=".42" cy=".35" r=".65"><stop stop-color="#242437" /><stop offset=".5" stop-color="#10121d" /><stop offset=".74" stop-color="#22243c" /><stop offset=".9" stop-color="#344f87" /><stop offset="1" stop-color="#090c15" /></radialGradient>
      <radialGradient :id="`${id}-reflection`"><stop stop-color="#fff" /><stop offset=".35" stop-color="#fff" /><stop offset=".6" stop-color="#b4eaff" /><stop offset=".82" stop-color="#52aaff" stop-opacity=".8" /><stop offset="1" stop-color="#735a9d" stop-opacity="0" /></radialGradient>
      <radialGradient :id="`${id}-sunlight`"><stop stop-color="#ffeaa0" stop-opacity=".9" /><stop offset="1" stop-color="#ffeaa0" stop-opacity="0" /></radialGradient>
      <linearGradient :id="`${id}-recorder`" x2="0" y2="1"><stop stop-color="#303033" /><stop offset="1" stop-color="#080809" /></linearGradient>
    </defs>
    <path d="M0 0h48v48H0z" :fill="paint('white')" />
    <g v-if="iconKey === 'safari'">
      <circle cx="24" cy="25" r="19.5" fill="#bbb" opacity=".28" />
      <circle cx="24" cy="24" r="19.5" :fill="paint('blue')" stroke="#89d7ff" stroke-width=".6" />
      <path v-for="tick in 60" :key="tick" :d="tick % 5 === 0 ? 'M24 6v2.7' : 'M24 6v1.8'" :transform="`rotate(${tick*6} 24 24)`" stroke="#fff" :stroke-width="tick % 5 === 0 ? .65 : .4" />
      <g transform="rotate(45 24 24)"><path d="m24 5-3.3 19h6.6Z" fill="#ff3e43" /><path d="M24 5v19h3.3Z" fill="#df2432" /><path d="m20.7 24 3.3 19 3.3-19Z" fill="#fff" /><path d="M24 24v19l3.3-19Z" fill="#c8e4f5" /></g>
    </g>
    <g v-else-if="iconKey === 'mail'">
      <path d="M0 0h48v48H0z" :fill="paint('blue')" />
      <rect x="6.3" y="12.1" width="35.4" height="23.9" rx="3.9" :fill="paint('envelope')" stroke="#b9e7ff" stroke-width=".5" />
      <path d="m7.2 35 12.3-11.3m21.3 11.3L28.5 23.7" fill="none" stroke="#fff" stroke-width=".8" />
      <path d="M7.3 13.1 20.6 26a4.9 4.9 0 0 0 6.8 0l13.3-12.9a3 3 0 0 0-2.6-1H9.9a3 3 0 0 0-2.6 1Z" fill="#fff" />
    </g>
    <g v-else-if="iconKey === 'calendar'" text-anchor="middle" font-family="Arial, Helvetica, sans-serif">
      <text x="24" y="14" font-size="9.4" fill="#f43135" letter-spacing="-.5">Tue</text>
      <path d="m19.2 24 6.4-4.5V39" fill="none" stroke="#aaa" stroke-width="2.7" stroke-linejoin="round" transform="translate(.4 .5)" />
      <path d="m19.2 24 6.4-4.5V39" fill="none" stroke="#161616" stroke-width="2.2" stroke-linejoin="round" />
      <path d="m19.8 23.4 5.3-3.5v18.7" fill="none" stroke="#5c5c5c" stroke-width=".45" />
    </g>
    <g v-else-if="iconKey === 'weather'">
      <path d="M0 0h48v48H0z" :fill="paint('blue')" /><path d="M0 0h48v48H0z" fill="#002c85" opacity=".3" />
      <circle cx="33" cy="19" r="9.5" :fill="paint('sun')" stroke="#fff497" stroke-width=".6" />
      <path d="M12.4 36.1a7.2 7.2 0 0 1-1.9-14.2 9.6 9.6 0 0 1 18.6-1.6 7.7 7.7 0 1 1 2.7 15.8Z" :fill="paint('cloud')" stroke="#c8edff" stroke-width=".6" />
      <ellipse cx="28" cy="24.5" rx="5.8" ry="4.5" :fill="paint('sunlight')" />
    </g>
    <g v-else-if="iconKey === 'clock'">
      <circle cx="24" cy="24" r="22" fill="#fafaf8" />
      <path v-for="tick in 60" :key="tick" :d="tick % 5 === 0 ? 'M24 3.4v7.1' : 'M24 3.4v3.6'" :transform="`rotate(${tick*6} 24 24)`" :stroke="tick % 5 === 0 ? '#353535' : '#b6b6b4'" :stroke-width="tick % 5 === 0 ? .7 : .55" stroke-linecap="round" />
      <text v-for="(label,index) in [12,3,6,9]" :key="label" :x="[24,38.3,24,9.7][index]" :y="[13.1,26,39.4,26][index]" text-anchor="middle" font-family="Arial, sans-serif" font-size="6" fill="#333">{{ label }}</text>
      <path d="M24 24 15.1 18M24 24l14.4-11" fill="none" stroke="#080808" stroke-width="1.8" stroke-linecap="round" />
      <path d="M24 21v23" stroke="#e68c00" stroke-width=".65" /><circle cx="24" cy="24" r="1.05" fill="#f7a10a" stroke="#724800" stroke-width=".25" />
    </g>
    <g v-else-if="iconKey === 'maps'">
      <path d="M0 0h48v48H0z" fill="#27d544" /><path d="M0 19v29h12Z" fill="#ff8de0" /><path d="M25 33v15h23Z" fill="#ffdc1b" />
      <path d="M40-6a18 18 0 0 0 18 18" fill="none" stroke="#a0ff9a" stroke-width="7" /><path d="M40-6a18 18 0 0 0 18 18" fill="none" stroke="#50ea64" stroke-width="3" />
      <path d="M17-5v57" stroke="#fff" stroke-width="15" /><path d="M17-5v57" stroke="#b9e7ff" stroke-width="11.5" /><path d="M17-5v57" stroke="#049fff" stroke-width="8" />
      <path d="m-6 9 61 40" stroke="#d3d3cc" stroke-width="13" /><path d="m-6 8 61 40" stroke="#fff" stroke-width="11" />
      <circle cx="19" cy="30.5" r="13.5" fill="#aaa" opacity=".2" /><circle cx="19" cy="29.5" r="13.2" fill="#fff" />
      <circle cx="19" cy="29.5" r="10.8" fill="#009dff" stroke="#007bfa" stroke-width=".5" />
      <path d="m19 21-5.7 14.2 5.7-3.7 5.7 3.7Z" fill="#fff" stroke="#e1f5ff" stroke-width=".5" stroke-linejoin="round" />
    </g>
    <g v-else-if="iconKey === 'calculator'">
      <path d="M0 0h48v48H0z" :fill="paint('silver')" />
      <rect x="12" y="7" width="24" height="36" rx="3.5" fill="#999" opacity=".4" />
      <rect x="12" y="6" width="24" height="36" rx="3.5" :fill="paint('dark')" stroke="#888" stroke-width=".45" />
      <rect x="15.1" y="9" width="17.8" height="8.3" rx="1" :fill="paint('screen')" stroke="#aaa" stroke-width=".45" />
      <circle v-for="(_,index) in 9" :key="index" :cx="17.3+index%3*6.7" :cy="22.8+Math.floor(index/3)*6.7" r="2.05" :fill="index%3===2 ? '#ff9d00' : '#e5e5df'" :stroke="index%3===2 ? '#ffc939' : '#fff'" stroke-width=".35" />
    </g>
    <!-- App Store follows the user's blue A image, not the collection's bag icon. -->
    <g v-else-if="iconKey === 'app-store'">
      <path d="M0 0h48v48H0z" :fill="paint('blue')" />
      <g fill="none" stroke-linecap="round" stroke-width="4.1"><path d="m21.1 9.2 17 29.4" stroke="#fff" opacity=".78" /><path d="M9 29.3h30" stroke="#fff" opacity=".8" /><path d="m26.7 9.2-17 29.4" stroke="#fff" opacity=".85" /></g>
    </g>
    <g v-else-if="iconKey === 'camera'">
      <path d="M0 0h48v48H0z" :fill="paint('silver')" />
      <circle cx="24" cy="25" r="19.4" fill="#777" opacity=".4" /><circle cx="24" cy="24" r="19.4" :fill="paint('silver')" stroke="#555" stroke-width=".5" />
      <circle cx="24" cy="24" r="17.9" fill="#181a22" stroke="#a2a3ad" stroke-width=".4" /><circle cx="24" cy="24" r="16.7" fill="#353441" stroke="#56536a" stroke-width=".5" />
      <circle cx="24" cy="24" r="15.5" :fill="paint('lens')" stroke="#090b13" stroke-width=".9" />
      <path d="M34.9 25.7a11 11 0 0 1-10.7 9.7" fill="none" stroke="#829fff" stroke-width="2.1" opacity=".8" stroke-linecap="round" /><path d="M33.8 24.7a10 10 0 0 1-9.6 9.2" fill="none" stroke="#d2efff" stroke-width="1" stroke-linecap="round" />
      <path d="M37 26a13 13 0 0 1-13 11" fill="none" stroke="#2e6be3" stroke-width="1.4" opacity=".8" />
      <ellipse cx="19.4" cy="18.3" rx="6" ry="6.8" transform="rotate(35 19.4 18.3)" :fill="paint('reflection')" /><circle cx="20" cy="19" r="1.6" fill="#fff" />
    </g>
    <g v-else-if="iconKey === 'voice-memos'">
      <path d="M0 0h48v48H0z" :fill="paint('recorder')" />
      <path d="M3 24h42" stroke="#727276" stroke-width=".4" />
      <path v-for="(height,index) in [2,4,8,17,24,15,7,12,27,19,8,4,6,15,23,13,7,3,2]" :key="index" :d="`M${3.3+index*2.3} ${24-height/2}v${height}`" :stroke="index < 9 ? '#ff453a' : '#f5f5f7'" stroke-width="1.35" stroke-linecap="round" />
      <path d="M23.5 8v32" stroke="#0a84ff" stroke-width="1" />
      <circle cx="23.5" cy="8" r="1.5" fill="#0a84ff" />
      <circle cx="23.5" cy="40" r="1.5" fill="#0a84ff" />
    </g>
    <g v-else-if="iconKey === 'reminders'">
      <g v-for="(color,index) in ['#ff9500','#007aff','#ff3b30']" :key="color">
        <circle cx="10.5" :cy="12+index*12" r="3.6" fill="none" :stroke="color" stroke-width="1" />
        <circle cx="10.5" :cy="12+index*12" r="2.1" :fill="color" />
        <path :d="`M18 ${12+index*12}h23`" stroke="#c8c8cd" stroke-width="1" />
      </g>
    </g>
    <g v-else-if="iconKey === 'files'">
      <path d="M5.7 12a2.7 2.7 0 0 1 2.7-2.7h9l3.1 3h18.6a2.8 2.8 0 0 1 2.8 2.8v23.5H5.7Z" :fill="paint('folder')" stroke="#00d6ff" stroke-width=".65" />
      <rect x="7" y="13.5" width="33.7" height="23" rx="1.8" fill="#f5fcff" stroke="#a4dcff" stroke-width=".4" />
      <rect x="5.8" y="16" width="36.3" height="23" rx="2.3" fill="#2391ef" opacity=".3" />
      <rect x="5.8" y="15" width="36.3" height="23" rx="2.3" :fill="paint('folder')" stroke="#007df2" stroke-width=".75" />
      <rect x="6.8" y="16" width="34.3" height="21" rx="1.7" fill="none" stroke="#3acaff" stroke-width=".6" />
    </g>
  </g>
</template>
