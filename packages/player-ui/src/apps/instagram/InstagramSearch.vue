<script setup>
import { computed, ref } from 'vue'
import Avatar from '../../appkit/Avatar.vue'
import ScrollArea from '../../appkit/ScrollArea.vue'
const props = defineProps({ history: { type: Array, default: () => [] }, accounts: { type: Array, default: () => [] }, initialQuery: { type: String, default: '' }, posts: { type: Array, required: true }, resolveSrc: { type: Function, required: true } })
const emit = defineEmits(['back','open-post','open-account','submit'])
function submit() { submitted.value = query.value.trim(); if (submitted.value) emit('submit', submitted.value) }
const removed = ref([])
const recent = computed(() => props.history.filter(r => !removed.value.includes(r.id)).map(r => ({ ...r, account: props.accounts.find(a => a.id === r.accountId) })))
function openRecent(row) { if (row.type === 'account' && row.account?.characterId) emit('open-account',row.account.characterId); else { query.value = row.title; submitted.value = row.title.trim(); emit('submit', submitted.value) } }
const query = ref(props.initialQuery)
const submitted = ref(props.initialQuery.trim())
const results = computed(() => {
  const needle = submitted.value.normalize('NFKC').toLocaleLowerCase().replace(/^#/, '')
  return needle ? props.posts.filter(post => post.content.normalize('NFKC').toLocaleLowerCase().includes(needle)) : []
})
</script>
<template>
  <section class="ig-tag-search" data-testid="ig-search-results">
    <form class="ig-tag-search__header" role="search" @submit.prevent="submit">
      <button type="button" aria-label="返回" @click="emit('back')"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 5-7 7 7 7" /></svg></button>
      <input v-model="query" type="search" placeholder="搜索" aria-label="搜索帖子" />
      <button type="submit">搜索</button>
    </form>
    <ScrollArea :scroll-key="'ig-search:'+submitted" :fade="false" padding-bottom="12">
      <template v-if="!submitted"><div class="ig-recent-head"><strong>近期记录</strong><button type="button" @click="removed=[]">显示全部</button></div><div v-for="row in recent" :key="row.id" class="ig-recent-row"><button type="button" class="ig-recent-open" @click="openRecent(row)"><Avatar v-if="row.account" :asset-id="row.account.avatarAssetId" :name="row.account.displayName || row.account.handle" :size="48" /><span v-else class="ig-clock">◷</span><strong>{{ row.account?.handle || row.title }}</strong></button><button type="button" aria-label="移除记录" @click="removed.push(row.id)">×</button></div></template>
      <div v-if="results.length" class="ig-tag-search__grid"><button v-for="post in results" :key="post.id" type="button" :aria-label="'查看'+post.authorName+'的帖子'" @click="emit('open-post',post.id)"><img v-if="post.mediaAssetIds.length" :src="resolveSrc(post.mediaAssetIds[0])" alt="" /><span v-else>{{ post.content }}</span></button></div>
      <p v-else-if="submitted" class="ig-tag-search__empty">{{ submitted ? '没有找到相关帖子' : '输入关键词搜索帖子' }}</p>
    </ScrollArea>
  </section>
</template>
<style scoped>
.ig-tag-search{position:absolute;inset:0;z-index:12;background:white;color:#000;display:flex;flex-direction:column;--hashtag-color:#4d4bb9}
.ig-tag-search__header{display:flex;align-items:center;gap:12px;padding:calc(var(--pui-statusbar-h) + 8px) 12px 12px;border-bottom:1px solid #efefef;flex:none}
.ig-tag-search__header button{padding:8px;font:inherit;font-size:14px}.ig-tag-search__header svg{width:24px;height:24px;fill:none;stroke:currentColor;stroke-width:2}
.ig-tag-search__header input{min-width:0;flex:1;background:#efefef;border:0;border-radius:8px;height:36px;padding:0 12px;font:inherit;font-size:15px}
h1{font-size:20px;font-weight:600;padding:16px}
.ig-tag-search__grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:3px}
.ig-tag-search__grid button{aspect-ratio:3/4;overflow:hidden;background:#fafafa}
.ig-tag-search__grid img{width:100%;height:100%;object-fit:cover}.ig-tag-search__grid span{display:block;padding:10px;font-size:13px;white-space:pre-wrap;overflow-wrap:anywhere}
.ig-tag-search__empty{text-align:center;padding:50px 16px;color:#737373;font-size:14px}
.ig-recent-head{display:flex;justify-content:space-between;padding:18px 16px;font-size:16px}.ig-recent-head button{color:#4d4bb9;font:inherit;font-size:14px}.ig-recent-row{display:flex;align-items:center;padding:12px 18px;gap:12px}.ig-recent-open{display:flex;align-items:center;gap:16px;flex:1;text-align:left;font:inherit}.ig-recent-row>button:last-child{color:#737373;font-size:23px;padding:8px}.ig-clock{width:48px;height:48px;border:1px solid #eee;border-radius:50%;display:grid;place-items:center;font-size:30px}.ig-tag-search__header input:focus,.ig-tag-search__header input:focus-visible{outline:none;box-shadow:none;border:0}</style>
