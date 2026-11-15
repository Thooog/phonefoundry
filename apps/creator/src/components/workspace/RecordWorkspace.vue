<script setup>
import { computed, ref, watch, nextTick } from 'vue'
import { useRoute } from 'vue-router'
const props = defineProps({
  title: { type: String, required: true },
  heading: { type: String, default: '' },
  showHeading: { type: Boolean, default: true },
  searchPlaceholder: { type: String, default: '' },
  records: { type: Array, default: () => [] },
  beforeSelect: { type: Function, default: () => true },
})
const selected = defineModel({ type: String, default: null })
const query = ref('')
const detailOpen = defineModel('detailOpen', { type: Boolean, default: false })
const root = ref(null)
const route = useRoute()
watch(() => route.query.record, id => {
  if (typeof id === 'string' && props.records.some(record => record.id === id)) {
    selected.value = id
    detailOpen.value = true
  }
}, { immediate: true })
let listScroll = 0
const detailScroll = new Map()
const mobile = () => window.matchMedia('(max-width:767px)').matches
const matches = computed(() => props.records.filter((record) => `${record.title} ${record.subtitle ?? ''} ${record.search ?? ''}`.toLowerCase().includes(query.value.trim().toLowerCase())))
watch(selected, () => { detailOpen.value = true })
async function select(id) {
  if (id !== selected.value && !(await props.beforeSelect(id))) return
  const main=root.value?.closest('.ws__main')
  if (mobile() && main) listScroll=main.scrollTop
  selected.value=id;detailOpen.value=true
  await nextTick()
  if (mobile() && main) main.scrollTop=detailScroll.get(id) ?? 0
}
async function back() {
  const main=root.value?.closest('.ws__main')
  if(main) detailScroll.set(selected.value,main.scrollTop)
  detailOpen.value=false
  await nextTick()
  if(main) main.scrollTop=listScroll
}
</script>

<template>
  <div ref="root" class="record-workspace" :data-detail="detailOpen">
    <aside class="record-workspace__index" aria-label="内容目录">
      <header v-if="showHeading" class="record-workspace__head"><h1>{{ heading || title }} <small><slot name="count">{{ title === '会话' ? records.length + ' 个对话' : records.length }}</slot></small></h1><div v-if="$slots.actions" class="record-workspace__actions"><slot name="actions" /></div></header>
      <div class="record-workspace__filters">
        <label class="record-workspace__search"><span class="sr-only">查找{{ title }}</span><input v-model="query" type="search" :placeholder="searchPlaceholder || (title === '会话' ? '查找对话' : '搜索' + title)" /></label>
        <slot name="search-actions" />
      </div>
      <div v-if="$slots['after-search']" class="record-workspace__after-search"><slot name="after-search" /></div>
      <div class="record-workspace__records">
        <template v-for="(record, index) in matches" :key="record.id">
          <slot name="before-record" :record="record" :previous="matches[index - 1]" />
          <button type="button" class="record-choice" :aria-pressed="selected === record.id" :data-record-id="record.id" @click="select(record.id)">
            <slot name="record" :record="record">
              <img v-if="record.avatar" :src="record.avatar" alt="" class="record-choice__avatar" />
              <span v-if="!record.avatar && record.initial" class="record-choice__initial">{{ record.initial }}</span>
              <span class="record-choice__body"><span class="record-choice__title"><strong>{{ record.title || '未命名' }}</strong><time>{{ record.meta }}</time></span><small>{{ record.subtitle }}</small></span>
            </slot>
          </button>
        </template>
        <slot v-if="!records.length && $slots.empty" name="empty" />
        <p v-else-if="!matches.length" class="record-workspace__empty">没有匹配内容。<button v-if="query" type="button" @click="query = ''">清除查找</button></p>
      </div>
    </aside>
    <section class="record-workspace__detail">
      <div class="record-workspace__toolbar"><slot name="detail-toolbar" :back="back"><button type="button" class="record-workspace__back" @click="back">← {{ title }}</button></slot></div>
      <slot :back="back" />
    </section>
  </div>
</template>

<style scoped>
.record-workspace__filters{display:contents}
.record-workspace{display:grid;grid-template-columns:248px minmax(0,1fr);gap:24px;min-width:0;min-height:calc(var(--creator-viewport-height,100dvh) - 130px)}
.record-workspace__index{min-width:0;padding:4px 0 24px}.record-workspace__head{margin-bottom:20px}.record-workspace__head h1{font-size:26px;font-weight:650;display:flex;align-items:baseline;gap:14px;flex-wrap:wrap}.record-workspace__head small{font-size:13px;font-weight:400;color:var(--c-text-3)}.record-workspace__actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:24px}
.record-workspace__after-search{display:flex;flex-wrap:wrap;gap:10px;margin:0 0 16px}.record-workspace__search{display:block;margin-bottom:18px}.record-workspace__search input{width:100%;min-width:0;min-height:40px;border:1px solid var(--c-border);border-radius:9px;padding:9px 12px;background:var(--c-white);font:inherit;color:var(--c-text);font-size:14px}
.record-workspace__records{display:grid;grid-template-columns:minmax(0,1fr);align-content:start;gap:6px}.record-choice{position:relative;display:flex;align-items:center;gap:12px;width:100%;min-width:0;min-height:76px;padding:12px;border:0;border-radius:12px;background:transparent;color:var(--c-text);font:inherit;text-align:left;cursor:pointer}.record-choice:hover{background:color-mix(in srgb,var(--c-detail) 4%,var(--c-white))}.record-choice[aria-pressed=true]{background:color-mix(in srgb,var(--c-detail) 4%,var(--c-white))}
.record-choice__body{flex:1;min-width:0}.record-choice__title{display:flex;gap:8px;align-items:baseline}.record-choice strong{font-size:14px;font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.record-choice time{font-size:11px;color:var(--c-text-3);flex:none;max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.record-choice small{display:block;font-size:12px;color:var(--c-text-2);margin-top:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.record-choice__avatar,.record-choice__initial{width:42px;height:42px;border-radius:50%;object-fit:cover;flex:none}.record-choice__initial{display:grid;place-items:center;background:var(--c-bg-sunken);color:var(--c-text-2)}
.record-workspace__detail{min-width:0}.record-workspace__toolbar{display:none}.record-workspace__back{display:none}.record-workspace__empty{padding:20px 4px;color:var(--c-text-3);font-size:13px}.record-workspace__empty button{border:0;background:transparent;color:var(--c-text);text-decoration:underline;padding:8px}
@media(max-width:1439px){.record-workspace{gap:20px}}
@media(max-width:1023px){.record-workspace{grid-template-columns:224px minmax(0,1fr);gap:18px}}
@media(max-width:767px){.record-workspace{display:block;min-height:0}.record-workspace__index{padding:0}.record-workspace[data-detail=true]>.record-workspace__index{display:none}.record-workspace[data-detail=false]>.record-workspace__detail{display:none}.record-workspace__toolbar{display:block}.record-workspace__back{display:block;margin:0 0 16px;border:0;background:transparent;color:var(--c-text);padding:0;min-height:44px;font:inherit;text-align:left}.record-workspace__search input{font-size:16px;min-height:44px}.record-workspace__head h1{font-size:25px}}
</style>
