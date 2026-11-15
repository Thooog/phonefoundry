<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { buildXTrends, buildXSearchHistory, searchX } from '@phone-sim/shared'
import Avatar from '../../appkit/Avatar.vue'
import ScrollArea from '../../appkit/ScrollArea.vue'
import XPostItem from './XPostItem.vue'
import { vFeedback } from './feedback.js'
const props = defineProps({ mode: { type: String, required: true }, work: { type: Object, required: true }, modelValue: { type: Object, required: true }, owner: { type: Object, default: null }, ownerName: { type: String, default: '我' } })
const emit = defineEmits(['update:modelValue', 'search', 'results', 'back', 'home', 'open-author', 'open-post', 'open-image'])
const input = ref(null)
const trends = computed(() => buildXTrends(props.work).filter(row => row.title.trim()))
const recent = computed(() => [...props.modelValue.local, ...buildXSearchHistory(props.work)].filter(row => !props.modelValue.hidden.includes(row.id)))
const query = computed({ get: () => props.modelValue.query, set: value => emit('update:modelValue', { ...props.modelValue, query: value }) })
const results = computed(() => searchX(props.work, query.value, { timeFormat: props.work.workSettings?.timeFormat, storyDate: props.work.workSettings?.storyDate }))
function submit(value = query.value) {
  const title = value.trim()
  if (!title) return
  input.value?.blur()
  const id = `local:${title.toLocaleLowerCase()}`
  emit('update:modelValue', { ...props.modelValue, query: title, local: [{ id, type: 'keyword', title }, ...props.modelValue.local.filter(row => row.id !== id)], hidden: props.modelValue.hidden.filter(key => key !== id) })
  emit('results', title)
}
function clearHistory() { emit('update:modelValue', { ...props.modelValue, local: [], hidden: buildXSearchHistory(props.work).map(row => row.id) }) }
function openRecent(row) { if (row.type === 'account') emit('open-author', row.characterId); else submit(row.title) }
async function fill(title) { query.value = title; await nextTick(); input.value?.focus() }
async function focusSearch() { if (props.mode === 'search') { await nextTick(); input.value?.focus({ preventScroll: true }) } }
watch(() => props.mode, focusSearch)
onMounted(focusSearch)
function metadata(row) { return [row.category && `${row.category} 趋势`, row.region && `${row.region}的趋势`].filter(Boolean).join(' · ') }
</script>

<template>
  <section class="xs" :data-testid="mode === 'explore' ? 'x-trends-screen' : 'x-search-screen'">
    <template v-if="mode === 'explore'">
      <header class="xs__top"><button class="xs__avatar" type="button" aria-label="我的主页" @click="emit('open-author', work.workSettings?.ownerCharacterId)"><Avatar :asset-id="owner?.avatarAssetId" :name="ownerName" :size="30" /></button><button class="xs__search-pill" type="button" data-testid="x-explore-search" @click="emit('search', '')"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="7" /><path d="m15 15 6 6" /></svg><span>搜索</span></button><span class="xs__settings" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" /><path d="M19.4 15a1.7 1.7 0 0 0 .1 2.5l-.1.1-2.4 2.4-.1-.1a1.7 1.7 0 0 0-2.5.1v.2a1.7 1.7 0 0 1-4.8 0V20a1.7 1.7 0 0 0-2.5-.1l-.1.1-2.4-2.4.1-.1a1.7 1.7 0 0 0-.1-2.5H4a1.7 1.7 0 0 1 0-4.8h.2a1.7 1.7 0 0 0 .1-2.5l-.1-.1 2.4-2.4.1.1a1.7 1.7 0 0 0 2.5-.1V5a1.7 1.7 0 0 1 4.8 0v.2a1.7 1.7 0 0 0 2.5.1l.1-.1 2.4 2.4-.1.1a1.7 1.7 0 0 0 .1 2.5h.2a1.7 1.7 0 0 1 0 4.8Z" /></svg></span></header>
      <ScrollArea scroll-key="x:trends" padding-bottom="12" :fade="false"><ol v-if="trends.length" class="xs__trends"><li v-for="row in trends" :key="row.id"><button class="xs__trend" type="button" :aria-label="'搜索' + row.title" @click="submit(row.title)"><small>{{ row.rank }}<template v-if="metadata(row)"> · {{ metadata(row) }}</template></small><strong>{{ row.title }}</strong><small v-if="row.countLabel" class="xs__count">{{ row.countLabel }}</small><span class="xs__more" aria-hidden="true">⋮</span></button></li></ol><p v-else class="xs__empty">暂无趋势</p></ScrollArea>
      <nav class="xs__bottom" aria-label="主导航"><button type="button" aria-label="首页" data-testid="x-explore-home" @click="emit('home')"><svg viewBox="0 0 24 24"><path d="m3 10 9-7 9 7v11h-6v-7H9v7H3Z" /></svg></button><button class="is-active" type="button" aria-label="搜索" aria-current="page" @click="emit('search', '')"><svg viewBox="0 0 24 24"><circle cx="10" cy="10" r="7" /><path d="m15 15 6 6" /></svg></button><span v-feedback="'通知'" data-testid="x-tab-notif"><svg class="xs__nav-icon" viewBox="0 0 24 24"><path d="M19.993 9.042C19.48 5.017 16.054 2 11.996 2s-7.49 3.021-7.999 7.051L2.866 18H7.1c.463 2.282 2.481 4 4.9 4s4.437-1.718 4.9-4h4.236l-1.143-8.958zM12 20c-1.306 0-2.417-.835-2.829-2h5.658c-.412 1.165-1.523 2-2.829 2zm-6.866-4l.847-6.698C6.364 6.272 8.941 4 11.996 4s5.627 2.268 6.013 5.295L18.864 16H5.134z" fill="currentColor" /></svg></span><span v-feedback="'私信'" data-testid="x-tab-dm"><svg class="xs__nav-icon" viewBox="0 0 24 24"><path d="M1.751 10c0-4.42 3.584-8 8.005-8h4.366c4.49 0 8.129 3.64 8.129 8.13 0 2.96-1.607 5.68-4.196 7.11l-8.054 4.46v-3.69h-.067c-4.49.1-8.183-3.51-8.183-8.01zm8.005-6c-3.317 0-6.005 2.69-6.005 6 0 3.37 2.77 6.08 6.138 6.01l.351-.01h1.761v2.3l5.087-2.81c1.951-1.08 3.163-3.13 3.163-5.36 0-3.39-2.744-6.13-6.129-6.13H9.756z" fill="currentColor" /></svg></span></nav>
    </template>
    <template v-else>
      <form class="xs__searchbar" :class="{ 'xs__searchbar--results': mode === 'results' }" role="search" @submit.prevent="submit()">
        <button type="button" :aria-label="mode === 'results' ? '返回搜索' : '返回趋势'" data-testid="x-search-back" @click="emit('back')"><svg viewBox="0 0 24 24"><path d="M20 12H4m7-7-7 7 7 7" /></svg></button>
        <label class="xs__query-field">
          <svg class="xs__search-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="7" /><path d="m15 15 6 6" /></svg>
          <input ref="input" v-model="query" type="search" maxlength="200" placeholder="搜索" aria-label="搜索 X 的帖子和人物" data-testid="x-search-input" @focus="mode === 'results' && emit('search', query)" />
        </label>
        <span v-if="mode === 'results'" class="xs__filters" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3 7h12m4 0h2M3 17h4m4 0h10M15 3v8M7 13v8" /></svg></span>
        <button v-else-if="query" type="button" aria-label="清空搜索词" @click="fill('')">×</button>
      </form>
      <ScrollArea :scroll-key="'x:' + mode + ':' + query" padding-bottom="16" :fade="false">
        <template v-if="mode !== 'results' && !query.trim()"><div class="xs__recent-head"><h1>最近</h1><button v-if="recent.length" type="button" aria-label="清除全部搜索记录" data-testid="x-history-clear" @click="clearHistory">×</button></div><ul class="xs__recent"><li v-for="row in recent" :key="row.id"><button class="xs__recent-open" type="button" :aria-label="row.type === 'account' ? '查看' + row.title + '的主页' : '搜索' + row.title" @click="openRecent(row)"><Avatar v-if="row.type === 'account'" :asset-id="row.avatarAssetId" :name="row.title" :size="36" /><span><strong>{{ row.title }}</strong><small v-if="row.type === 'account' && row.handle">@{{ row.handle }}</small></span></button><button v-if="row.type !== 'account'" class="xs__fill" type="button" :aria-label="'填入' + row.title" @click="fill(row.title)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 18 6 6m0 9V6h9" /></svg></button></li></ul><p v-if="!recent.length" class="xs__empty">暂无搜索记录</p></template>
        <template v-else><ul v-if="mode !== 'results' && results.accounts.length" class="xs__accounts"><li v-for="row in results.accounts" :key="row.accountId"><button type="button" @click="emit('open-author', row.characterId)"><Avatar :asset-id="row.avatarAssetId" :name="row.name" :size="40" /><span><strong>{{ row.name }}</strong><small v-if="row.handle">@{{ row.handle }}</small></span></button></li></ul><ul v-if="mode === 'results'" class="xs__posts"><li v-for="post in results.posts" :key="post.id"><XPostItem :item="post" @search="emit('results', $event)" @open="emit('open-post', $event)" @open-image="emit('open-image', $event)" @open-author="emit('open-author', $event)" /></li></ul><p v-if="mode === 'results' ? !results.posts.length : !results.accounts.length" class="xs__empty">没有找到“{{ query }}”的相关内容</p></template>
      </ScrollArea>
    </template>
  </section>
</template>

<style scoped>
.xs{position:absolute;inset:0;display:flex;flex-direction:column;background:white;color:#0f1419;overflow:hidden;font-family:inherit}.xs svg{width:24px;height:24px;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}.xs button{font:inherit;color:inherit;background:none;border:0;padding:0}.xs button:focus-visible,.xs input:focus-visible{outline:2px solid #1d9bf0;outline-offset:-2px}.xs__top{position:relative;display:flex;align-items:center;justify-content:space-between;gap:16px;flex:none;min-height:62px;padding:calc(var(--pui-statusbar-h) + 4px) 16px 8px;border-bottom:1px solid #eff3f4}.xs__avatar{flex:none;display:grid;place-items:center;min-width:32px;min-height:40px}.xs .xs__search-pill{position:absolute;left:50%;top:calc(var(--pui-statusbar-h) + 4px);transform:translateX(-50%);display:flex;align-items:center;justify-content:center;gap:12px;background:#eff1f2;color:#536471;border-radius:30px;width:min(70%,320px);min-height:42px;font-size:16px}.xs__search-pill svg{width:22px;height:22px}.xs__settings{display:grid;place-items:center;flex:none;width:24px}.xs__trends,.xs__recent,.xs__posts,.xs__accounts{list-style:none;padding:0;margin:0}.xs .xs__trend{position:relative;width:100%;text-align:left;padding:18px 44px 18px 14px;min-height:92px;display:block}.xs__trend small{display:block;font-size:13px;line-height:1.5;color:#536471}.xs__trend strong{display:block;font-size:17px;font-weight:700;line-height:1.5;margin-top:7px;overflow-wrap:anywhere}.xs__trend .xs__count{margin-top:5px}.xs__more{position:absolute;right:20px;top:18px;color:#85929b;font-size:22px;line-height:1}.xs__bottom{display:flex;align-items:center;justify-content:space-around;padding:6px 10px calc(var(--pui-homebar-h) + 2px);border-top:1px solid #eff3f4;flex:none}.xs__bottom>button,.xs__bottom>span{display:grid;place-items:center;width:46px;height:44px;color:#536471}.xs__bottom>.is-active{color:#0f1419}.xs__bottom>.is-active svg{stroke-width:2.5}.xs__searchbar{display:flex;align-items:center;gap:16px;padding:calc(var(--pui-statusbar-h) + 4px) 12px 8px 6px;min-height:60px;border-bottom:1px solid #eff3f4;flex:none}.xs__searchbar button{display:grid;place-items:center;min-width:40px;min-height:44px;font-size:26px}.xs__search-icon{color:#536471;flex:none}.xs__searchbar input{flex:1;width:0;min-width:0;height:44px;border:0;padding:0;background:none;font-family:inherit;font-size:16px;font-weight:400;line-height:1.5;color:#0f1419;outline:none}.xs__searchbar input:focus-visible{outline:none}.xs__searchbar input::-webkit-search-cancel-button{display:none}.xs__recent-head{display:flex;align-items:center;justify-content:space-between;padding:14px 12px 10px}.xs__recent-head h1{font-size:19px;line-height:1.35;font-weight:800;margin:0}.xs .xs__recent-head button{display:grid;place-items:center;width:22px;height:22px;border-radius:50%;color:white;background:#0f1419;font-size:22px;line-height:1}.xs__recent li{display:flex;align-items:center;gap:8px;padding:2px 12px;min-height:48px}.xs .xs__recent-open{display:flex;align-items:center;text-align:left;gap:10px;flex:1;min-width:0;min-height:44px;padding:5px 0}.xs__recent-open strong{font-size:14px;font-weight:700;overflow-wrap:anywhere;line-height:1.35}.xs__recent-open small{display:block;font-size:12px;color:#536471;line-height:1.35}.xs .xs__fill{flex:none;display:grid;place-items:center;min-width:36px;min-height:36px;color:#249ac7}.xs__accounts li{border-bottom:1px solid #eff3f4}.xs__accounts button{width:100%;display:flex;align-items:center;gap:12px;padding:14px 16px;text-align:left;min-height:64px}.xs__accounts strong,.xs__accounts small{display:block;line-height:1.5;font-size:15px}.xs__accounts small{font-size:13px;color:#536471}.xs__empty{font-size:15px;line-height:1.7;text-align:center;color:#536471;padding:36px 20px;overflow-wrap:anywhere}
.xs__query-field{display:flex;align-items:center;gap:16px;flex:1;min-width:0}
.xs__searchbar--results{gap:10px;padding-right:16px;padding-bottom:12px}
.xs__searchbar--results .xs__query-field{background:#eff1f2;border-radius:24px;padding:0 18px;gap:10px;height:44px}
.xs__searchbar--results input{background:none;padding:0;font-size:16px}
.xs__filters{display:grid;place-items:center;width:32px;flex:none}
.xs__filters svg{width:26px;height:26px;stroke-width:2.2}
.xs .xs__nav-icon{width:24px;height:24px;stroke:none;fill:currentColor}
</style>
