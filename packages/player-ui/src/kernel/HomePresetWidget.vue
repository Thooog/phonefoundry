<script setup>
import { computed } from 'vue'
import { homeWeather, homeSchedules } from '@phone-sim/shared'
import HomeClockWidget from './HomeClockWidget.vue'

const props = defineProps({
  presetId: { type: String, required: true },
  storyDate: { type: String, default: null },
  content: { type: Object, default: () => ({}) },
})

const calendarDate = computed(() => {
  const date = props.storyDate ? new Date(`${props.storyDate}T12:00:00`) : new Date()
  return Number.isNaN(date.getTime()) ? new Date() : date
})
const lunarDay = computed(() => {
  const day = Number(new Intl.DateTimeFormat('zh-CN-u-ca-chinese', { day: 'numeric' }).format(calendarDate.value))
  return day <= 10 ? '初' + '一二三四五六七八九十'[day - 1] : day < 20 ? '十' + '一二三四五六七八九'[day - 11] : day === 20 ? '二十' : day < 30 ? '廿' + '一二三四五六七八九'[day - 21] : '三十'
})
const scheduleGroups = computed(() => {
  const groups = new Map()
  for (const row of homeSchedules(props.content).filter(row => row.title.trim()).sort((a, b) => a.start.localeCompare(b.start))) {
    const key = `${row.start}|${row.end}`
    if (!groups.has(key)) groups.set(key, { start: row.start, end: row.end, titles: [] })
    groups.get(key).titles.push(row.title)
  }
  return [...groups.values()]
})
const weather = computed(() => homeWeather(props.content.detail))
</script>

<template>
  <span class="pui-home-preset" :data-preset="presetId">
    <HomeClockWidget v-if="presetId === 'clock'" />
    <template v-else-if="presetId === 'note'">
      <span class="pui-home-preset__note-header">
        <svg viewBox="0 0 28 24" fill="none" aria-hidden="true"><path d="M2 6V3.5A2 2 0 0 1 4 1.5h4l3 2h13a2 2 0 0 1 2 2v15a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" /><path d="M5 7h18" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" /></svg>
        <span>备忘录</span>
      </span>
      <span class="pui-home-preset__note-body">
        <span class="pui-home-preset__note-title">{{ content.title ?? '新备忘录' }}</span>
        <span class="pui-home-preset__note">{{ content.detail ?? '手写备忘录' }}</span>
        <span class="pui-home-preset__note-time">{{ content.time ?? '20:52' }}</span>
      </span>
    </template>
    <span v-else class="pui-home-preset__content">
      <template v-if="presetId === 'date'">
        <span class="pui-home-preset__date-top">
          <strong>{{ calendarDate.getDate() }}</strong>
          <span class="pui-home-preset__lunar">{{ lunarDay }}</span>
          <span class="pui-home-preset__weekday">{{ `周${'日一二三四五六'[calendarDate.getDay()]}` }}</span>
        </span>
        <span v-if="!scheduleGroups.length" class="pui-home-preset__schedule">今天无日程</span>
        <span v-else class="pui-home-preset__events" :class="{ 'pui-home-preset__events--single': scheduleGroups.length === 1 }">
          <span v-for="(group, index) in scheduleGroups.slice(0, 2)" :key="index" class="pui-home-preset__event">
            <strong v-if="group.titles.length > 1">{{ group.titles.length }}个日程</strong>
            <span v-for="(title, i) in group.titles.slice(0, group.titles.length > 1 ? 2 : 1)" :key="i" class="pui-home-preset__event-title">{{ title }}</span>
            <span v-if="group.titles.length > 2">…</span>
            <span v-if="group.start || group.end" class="pui-home-preset__event-time">{{ group.start }}{{ group.start && group.end ? '–' : '' }}{{ group.end }}</span>
          </span>
        </span>
      </template>
      <template v-else-if="presetId === 'weather'">
        <strong class="pui-home-preset__temperature">{{ content.value ?? '34°' }}</strong>
        <svg class="pui-home-preset__sun" viewBox="0 0 24 24" aria-hidden="true">
          <g v-if="weather === '晴' || weather === '多云'" :transform="weather === '多云' ? 'translate(-2 -3) scale(.8)' : undefined">
            <circle cx="12" cy="12" r="4.5" fill="#ffda55" />
            <path d="M12 1v3m0 16v3M1 12h3m16 0h3M4.2 4.2l2.1 2.1m11.4 11.4 2.1 2.1M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" stroke="#ffda55" stroke-width="1.3" />
          </g>
          <path v-if="weather !== '晴'" d="M6 17a4 4 0 0 1-1-7.9 6 6 0 0 1 11.5-1.3A4.7 4.7 0 1 1 18 17Z" :fill="weather === '阴' || weather === '雷雨' ? '#bacbdb' : '#f1f5fa'" />
          <path v-if="weather === '雨'" d="m7 19-1 3m7-3-1 3m7-3-1 3" stroke="#80d5ff" stroke-width="1.6" stroke-linecap="round" />
          <path v-if="weather === '雷雨'" d="m12 14-4 6h4l-1 4 6-7h-4l2-3Z" fill="#ffda55" />
          <g v-if="weather === '雪'" fill="#fff"><circle cx="7" cy="20" r="1.2" /><circle cx="13" cy="22" r="1.2" /><circle cx="19" cy="20" r="1.2" /></g>
        </svg>
        <span class="pui-home-preset__condition">{{ weather }}</span>
        <span class="pui-home-preset__range"><span class="pui-home-preset__range-label">最高</span><span>{{ content.high ?? '34°' }}</span><span class="pui-home-preset__range-label">最低</span><span>{{ content.low ?? '25°' }}</span></span>
      </template>
    </span>
  </span>
</template>

<style scoped>
.pui-home-preset {
  display: block;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  container-type: size;
  overflow: hidden;
  background: #fff5f1;
  color: #1c2030;
}
.pui-home-preset__content {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  justify-content: center;
  height: 100%;
  padding: 7cqw;
  text-align: start;
  font-size: min(7.5cqw, 8cqh);
  line-height: 1.3;
}
.pui-home-preset strong { font-size: min(22cqw, 23cqh); line-height: 1.1; }
.pui-home-preset[data-preset='weather'] { background: linear-gradient(165deg, #305580, #5e88b8); color: #eaf3ff; border-radius: 18%; }
.pui-home-preset[data-preset='date'] { background: #fff; color: #111; border-radius: 18%; }
/* Positions are measured against the reference's square widget canvas. */
.pui-home-preset[data-preset='weather'],
.pui-home-preset[data-preset='date'] { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, 'Noto Sans SC', sans-serif; font-weight: 400; font-variant-numeric: lining-nums; }
.pui-home-preset[data-preset='weather'] .pui-home-preset__content,
.pui-home-preset[data-preset='date'] .pui-home-preset__content { position: relative; display: block; padding: 0; }
.pui-home-preset .pui-home-preset__temperature { position: absolute; left: 10%; top: 22%; font-size: 26cqw; font-weight: 300; letter-spacing: -.04em; line-height: 1.1; }
.pui-home-preset__sun { position: absolute; left: 10%; top: 50%; width: 10cqw; height: 10cqw; }
.pui-home-preset__condition { position: absolute; left: 10%; top: 62%; font-size: 8cqw; line-height: 1.2; }
.pui-home-preset__range { position: absolute; left: 10%; bottom: 9%; display: flex; align-items: center; gap: 1cqw; font-size: 15cqw; font-weight: 300; line-height: 1; white-space: nowrap; letter-spacing: -.03em; }
.pui-home-preset__range-label { flex: none; width: 7cqw; font-size: 6cqw; font-weight: 400; line-height: 1; white-space: normal; letter-spacing: 0; }
.pui-home-preset__date-top { position: absolute; left: 11%; top: 14%; display: flex; align-items: flex-start; gap: 4cqw; }
.pui-home-preset__date-top strong { font-size: 21cqw; font-weight: 400; letter-spacing: -.05em; line-height: 1; }
.pui-home-preset__lunar, .pui-home-preset__weekday { width: 7cqw; padding-top: 1cqh; font-size: 7cqw; font-weight: 400; line-height: 1.15; overflow-wrap: anywhere; }
.pui-home-preset__lunar { color: #d5d5d5; }
.pui-home-preset__weekday { color: #ef6e6d; }
.pui-home-preset__schedule { position: absolute; left: 11%; right: 10%; top: 61%; color: #999; font-size: 9cqw; line-height: 1.3; overflow-wrap: anywhere; }
.pui-home-preset[data-preset='note'] { background: #fff; color: #111; border-radius: 18%; font-family: Arial, 'Noto Sans SC', sans-serif; }
.pui-home-preset__note-header { display: flex; align-items: center; gap: 7cqw; height: 26%; box-sizing: border-box; padding: 0 11cqw; background: linear-gradient(#ffdf00, #ffc400); color: #fff; font-size: 9cqw; line-height: 1; }
.pui-home-preset__note-header svg { width: 12cqw; height: 11cqw; flex: none; }
.pui-home-preset__note-body { position: relative; display: flex; flex-direction: column; gap: 4cqh; height: 74%; box-sizing: border-box; padding: 12cqh 10cqw 11cqh; text-align: left; }
.pui-home-preset__note-body::before { content: ''; position: absolute; top: 2.5cqh; left: 3cqw; right: 3cqw; height: 1.3cqw; background: radial-gradient(circle, #dedede 45%, transparent 50%) 0 0 / 2.9cqw 1.3cqw repeat-x; }
.pui-home-preset__note-title { font-size: 8cqw; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pui-home-preset__note { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; max-height: 2.7em; font-size: 8cqw; line-height: 1.35; color: #929292; white-space: pre-wrap; overflow-wrap: anywhere; overflow: hidden; text-overflow: ellipsis; }
.pui-home-preset__note-time { margin-top: auto; flex: none; color: #929292; font-size: 8cqw; line-height: 1; }
.pui-home-preset__events { position: absolute; top: 38%; left: 11%; right: 11%; bottom: 11%; display: flex; flex-direction: column; gap: 3cqh; overflow: hidden; }
.pui-home-preset__event { position: relative; display: flex; flex-direction: column; padding: 2cqh 3cqw 2cqh 5cqw; border-radius: 3cqw; background: #fbf0fd; color: #86238c; font-size: 7.5cqw; line-height: 1.15; min-height: 0; }
.pui-home-preset__event::before { content: ''; position: absolute; left: 1.5cqw; top: 2cqh; bottom: 2cqh; width: 1.5cqw; background: #d326dd; border-radius: 1cqw; }
.pui-home-preset__event-title { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.pui-home-preset__event-time { white-space: nowrap; }
.pui-home-preset__events--single .pui-home-preset__event { background: transparent; padding-top: 0; }
.pui-home-preset__events--single .pui-home-preset__event::before { top: 0; bottom: 0; }
.pui-home-preset__event strong { color: #111; font-size: 8cqw; font-weight: 600; }
.pui-home-preset__events--single .pui-home-preset__event-time { color: #999; margin-top: 2cqh; }
</style>
