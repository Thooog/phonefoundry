<script setup>

import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { getApp } from '@phone-sim/shared'
import { useProjectStore } from '../stores/project.js'
import PhotosEditor from '../components/apps/photos/PhotosEditor.vue'
import NotesEditor from '../components/apps/notes/NotesEditor.vue'
import PhoneEditor from '../components/apps/phone/PhoneEditor.vue'
import XEditor from '../components/apps/x/XEditor.vue'
import InstagramEditor from '../components/apps/instagram/InstagramEditor.vue'
import MessagesEditor from '../components/apps/messages/MessagesEditor.vue'
import KakaoTalkEditor from '../components/apps/kakaotalk/KakaoTalkEditor.vue'

const EDITORS = {
  photos: PhotosEditor,
  notes: NotesEditor,
  phone: PhoneEditor,
  x: XEditor,
  instagram: InstagramEditor,
  messages: MessagesEditor,
  kakaotalk: KakaoTalkEditor,
}

const props = defineProps({
  app: { type: String, required: true },
})

const route = useRoute()
const editor = useProjectStore()

/** 不能叫 app —— 会遮住同名的 props.app，模板里就会渲染出整个对象 */
const appDef = computed(() => getApp(props.app))
const project = computed(() => editor.project)

const buckets = computed(() => {
  if (!appDef.value) return []
  const data = project.value?.appData?.[appDef.value.id] ?? {}
  return appDef.value.collections.map((key) => ({
    key,
    label: collectionLabel(key),
    count: data?.[key]?.length ?? 0,
  }))
})

const total = computed(() => buckets.value.reduce((sum, b) => sum + b.count, 0))

function collectionLabel(key) {
  const map = {
    photos: '照片',
    albums: '相簿',
    conversations: '会话',
    messages: '消息',
    posts: '帖子',
    comments: '评论',
    replies: '回复',
    stories: '故事',
    contacts: '联系人',
    calls: '通话记录',
    notes: '备忘录',
  }
  return map[key] ?? key
}

/**
 * 没有数据桶的应用（当前只有「设置」）不谈"内容"：
 * 它显示的是作品设置里的机主与设备名，改那两处就够了，不能让人在这里干等编辑器。
 */
const hasBuckets = computed(() => (appDef.value?.collections?.length ?? 0) > 0)

/** 已接入编辑器的应用渲染自己的界面，其余走旧的只读样貌 */
const editorComponent = computed(() => {
  if (!appDef.value || !hasBuckets.value) return null
  return EDITORS[appDef.value.id] ?? null
})

function bucketlessHint(name) {
  return `「${name}」不存内容：它读的是作品设置里的手机持有者与设备名，改那两处即可。`
}

/** 读取端渲染模式 → 一句人话，让用户知道这个应用的内容该怎么组织 */
function readerHint(readerType) {
  if (readerType === 'chat') return '对话形式：按会话组织，每个会话里是一来一回的消息。'
  if (readerType === 'feed') return '信息流形式：按帖子组织，可以带图片、点赞与评论。'
  if (readerType === 'gallery') return '相册形式：照片按拍摄月份排成网格，可以再整理成相簿。'
  return '列表形式：一条一条独立记录。'
}

const backToOverview = { name: 'overview', params: { projectId: route.params.projectId } }
</script>

<template>
  <div class="appview" :class="{ 'appview--editor': editorComponent }">
    <template v-if="!appDef">
      <header class="page-head">
        <h1 class="page-head__title">未知应用</h1>
        <p class="page-head__desc">没有 id 为「{{ app }}」的应用。</p>
      </header>
      <RouterLink v-if="!editorComponent" class="back" :to="backToOverview">← 回到概览</RouterLink>
    </template>

    <template v-else-if="project">
      <header v-if="!editorComponent" class="page-head">
        <div class="page-head__row">
          <span class="appdot" :style="{ background: appDef.accent }" aria-hidden="true"></span>
          <h1 class="page-head__title">{{ appDef.name }}</h1>

          <span v-if="hasBuckets && !editorComponent" class="page-head__meta">{{ total }} 条</span>
        </div>
        <p class="page-head__desc">
          {{ hasBuckets ? readerHint(appDef.readerType) : bucketlessHint(appDef.name) }}
        </p>
      </header>

      <component :is="editorComponent" v-if="editorComponent" />

      <template v-else>
        <ul v-if="hasBuckets" class="buckets">
          <li v-for="b in buckets" :key="b.key" class="bucket">
            <span class="bucket__label">{{ b.label }}</span>
            <span class="bucket__count">{{ b.count }}</span>
            <code class="bucket__key">{{ b.key }}</code>
          </li>
        </ul>

        <p class="stagehint">
          <template v-if="hasBuckets">
            「{{ appDef.name }}」的内容编辑会在下一阶段接入。现在可以先去「角色与账号」和「作品设置」
            把人物与手机配置好 —— 那些是内容的依赖。
          </template>
          <template v-else>
            这一页没有可编辑的内容。要改「{{ appDef.name }}」里显示的东西，去「作品设置」
            设置手机持有者与设备名。
          </template>
        </p>
      </template>

      <RouterLink v-if="!editorComponent" class="back" :to="backToOverview">← 回到概览</RouterLink>
    </template>
  </div>
</template>

<style scoped>
 .appview{padding:28px;max-width:1500px;margin:auto}.appview--editor{padding:0;max-width:none;margin:0}.page-head{margin-bottom:24px}.page-head__title{font-size:27px;font-weight:600}.page-head__desc,.stagehint{font-size:13px;line-height:1.8;color:var(--c-text-2);margin-top:12px}.page-head__row{display:flex;align-items:center;gap:12px}.appdot{width:7px;height:7px;border-radius:50%;background:var(--c-accent)!important}.back{display:inline-block;margin-top:24px;font-size:14px}.buckets{display:flex;flex-wrap:wrap;gap:16px}.bucket{padding:20px;background:white;border:1px solid var(--c-border);border-radius:12px}@media(max-width:767px){.appview{padding:18px 14px}.appview--editor{padding:0}}
</style>
