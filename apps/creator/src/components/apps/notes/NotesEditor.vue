<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import AppButton from '../../ui/AppButton.vue'
import DeleteIconButton from '../../ui/DeleteIconButton.vue'
import RecordWorkspace from '../../workspace/RecordWorkspace.vue'
import { useRecordSelection } from '../../../composables/use-record-selection.js'
import { useProjectStore } from '../../../stores/project.js'
import { useUiStore } from '../../../stores/ui.js'
import { fromDateTimeLocal, toDateTimeLocal } from '../../../utils/time.js'
import { NOTE_MAX_LENGTH, addNote, deleteNote, noteTitle, sortNotesByTime, updateNote } from '../../../editing/notes.js'

const editor = useProjectStore()
const ui = useUiStore()
const readOnly = computed(() => Boolean(editor.readOnlyReason))
const notes = computed(() => sortNotesByTime(editor.project?.appData?.notes?.notes ?? []))
const { selectedRecordId, visibleRecords } = useRecordSelection(notes)
const detailOpen = ref(false)
const draft = ref('')
const titleElement = ref(null)
const contentParts = computed(() => {
  const lines = draft.value.split('\n')
  return { title: lines[0], body: lines.slice(1).join('\n'), hasBody: lines.length > 1 }
})
const titleDraft = computed({
  get: () => contentParts.value.title,
  set: value => {
    const { body, hasBody } = contentParts.value
    draft.value = [value, ...(hasBody ? [body] : [])].join('\n').slice(0, NOTE_MAX_LENGTH)
  },
})
const bodyDraft = computed({
  get: () => contentParts.value.body,
  set: value => {
    draft.value = [contentParts.value.title, value].join('\n').slice(0, NOTE_MAX_LENGTH)
  },
})
const saveLabel = computed(() => {
  if (readOnly.value) return '只读'
  if (editor.saveStatus === 'error') return '保存失败'
  if (draft.value !== (visibleRecords.value[0]?.content ?? '')) return '尚未保存'
  return editor.saveStatus === 'saving' ? '保存中…' : '已保存'
})
let draftId = null
let textElement = null
let textObserver = null
let textWidth = 0
const recordItems = computed(() => notes.value.map(note => ({
  id: note.id,
  title: noteTitle(note.content),
  subtitle: note.content?.split('\n').slice(1).join(' ').trim() || '空白正文',
  meta: formatTime(note.displayTime),
})))

function formatTime(value) {
  const local = toDateTimeLocal(value)
  if (!local) return '未设置时间'
  const [date, time] = local.split('T')
  const [, month, day] = date.split('-')
  return `${Number(month)}月${Number(day)}日 ${time}`
}
// Keep keystrokes local; commit once on blur or navigation.
function commitContent() {
  const note = notes.value.find(note => note.id === draftId)
  if (!readOnly.value && note && note.content !== draft.value) {
    updateNote(editor, note.id, { content: draft.value })
  }
  return true
}
watch(selectedRecordId, id => {
  commitContent()
  draftId = id
  draft.value = notes.value.find(note => note.id === id)?.content ?? ''
  nextTick(fitText)
}, { immediate: true })
watch(() => visibleRecords.value[0]?.content, (content, previous) => {
  if (draftId === selectedRecordId.value && draft.value === previous) {
    draft.value = content ?? ''
    nextTick(fitText)
  }
})

function fitText() {
  if (titleElement.value) {
    titleElement.value.style.height = 'auto'
    titleElement.value.style.height = `${titleElement.value.scrollHeight}px`
  }
  if (!textElement) return
  textElement.style.height = 'auto'
  textElement.style.height = `${textElement.scrollHeight}px`
}
function setTextElement(element) {
  if (element === textElement) return
  textObserver?.disconnect()
  textElement = element
  textWidth = 0
  if (!element) return
  textObserver = new ResizeObserver(([entry]) => {
    if (entry.contentRect.width === textWidth) return
    textWidth = entry.contentRect.width
    fitText()
  })
  textObserver.observe(element)
  nextTick(fitText)
}
async function create() {
  if (readOnly.value) return
  commitContent()
  const note = addNote(editor)
  selectedRecordId.value = note.id
  detailOpen.value = true
  await nextTick()
  titleElement.value?.focus()
}
function commitOnShortcut(event) {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault()
    commitContent()
    event.target.blur()
  }
}
function commitTime(note, event) {
  if (readOnly.value) return
  const iso = fromDateTimeLocal(event.target.value)
  if (iso) updateNote(editor, note.id, { displayTime: iso })
}
async function backToList(back) {
  commitContent()
  await back()
}
async function remove(note, back) {
  if (readOnly.value || !note) return
  commitContent()
  const ok = await ui.confirm({
    title: '删掉这条备忘录？',
    message: `「${noteTitle(draft.value)}」会被删除，无法撤销。`,
    confirmText: '删除', tone: 'danger',
  })
  if (!ok) return
  deleteNote(editor, note.id)
  await nextTick()
  if (back) await back()
  if (!notes.value.length) detailOpen.value = false
  ui.toast('已删除一条备忘录')
}
onBeforeRouteLeave(commitContent)
onBeforeUnmount(() => {
  commitContent()
  textObserver?.disconnect()
})
</script>

<template>
  <section class="noted" :data-detail="detailOpen" data-testid="notes-editor">
    <header v-if="!notes.length" class="noted__bar">
      <h1>备忘录 <small>{{ notes.length }} 篇</small></h1>
      <AppButton variant="primary" :disabled="readOnly" data-testid="note-add" @click="create">新建备忘录</AppButton>
    </header>
    <div v-if="!notes.length" class="noted__empty">
      <p>还没有备忘录。记下一句，留给故事里的人。</p>
      <AppButton :disabled="readOnly" @click="create">新建备忘录</AppButton>
    </div>
    <RecordWorkspace v-else v-model="selectedRecordId" v-model:detail-open="detailOpen" title="备忘录" search-placeholder="查找备忘录" :records="recordItems" :before-select="commitContent">
      <template #count>{{ notes.length }} 篇</template>
      <template #actions>
        <button type="button" class="noted__add" :disabled="readOnly" aria-label="新建备忘录" title="新建备忘录" data-testid="note-add" @click="create">
          <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M12 4v16M4 12h16" /></svg>
        </button>
      </template>
      <template #record="{ record }">
        <span class="note-choice">
          <strong>{{ record.title }}</strong>
          <span>{{ record.subtitle }}</span>
          <time>{{ record.meta }}</time>
        </span>
      </template>
      <template #detail-toolbar="{ back }">
        <div class="noted__detail-toolbar">
          <button type="button" class="record-workspace__back" @click="backToList(back)">
            <span class="note-back-icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m14 6-6 6 6 6" /></svg></span>备忘录
          </button>
        </div>
      </template>
      <template #default="{ back }">
        <ul class="noted__list" data-testid="note-list">
          <li v-for="note in visibleRecords" :key="note.id" data-testid="note-row" class="note-document">
            <header class="note-document__tools">
              <label>编辑时间<input type="datetime-local" :value="toDateTimeLocal(note.displayTime)" :disabled="readOnly" data-testid="note-time" @change="commitTime(note, $event)" /></label>
              <DeleteIconButton label="删除备忘录" :disabled="readOnly" data-testid="note-remove" @click="remove(note, back)" />
            </header>
            <div class="note-document__writing">
              <textarea :ref="el => titleElement = el" v-model="titleDraft" rows="1" class="note-document__title" :maxlength="NOTE_MAX_LENGTH - bodyDraft.length - (contentParts.hasBody ? 1 : 0)" :disabled="readOnly" placeholder="未命名备忘录" aria-label="备忘录标题，正文首行" data-testid="note-title-input" @input="fitText" @change="commitContent" @keydown.enter.exact.prevent="textElement?.focus()" @keydown="commitOnShortcut"></textarea>
              <textarea :ref="setTextElement" v-model="bodyDraft" rows="1" class="note-document__text" :maxlength="Math.max(0, NOTE_MAX_LENGTH - titleDraft.length - 1)" :disabled="readOnly" placeholder="写下这段故事的细节……" aria-label="备忘录正文" data-testid="note-content" @input="fitText" @change="commitContent" @keydown="commitOnShortcut"></textarea>
            </div>
            <footer class="note-document__footer"><span role="status" data-testid="note-save-status">{{ saveLabel }}</span><span data-testid="note-count">{{ draft.length }} 字</span></footer>
          </li>
        </ul>
      </template>
    </RecordWorkspace>
  </section>
</template>

<style scoped>
.noted{--notes-height:calc(var(--creator-viewport-height,100dvh) - var(--layout-topbar-h,56px));height:var(--notes-height);padding:28px;min-width:0;display:flex;flex-direction:column;overflow:hidden}
.noted__bar{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-bottom:22px;margin-bottom:24px;border-bottom:1px solid var(--c-border);flex:none}
.noted__bar h1{display:flex;align-items:baseline;gap:18px;font:600 24px/1.5 var(--font-story)}
.noted__bar small{font:400 12px/1.5 var(--font-sans);color:var(--c-text-3)}
.noted__bar .ui-btn{min-height:34px;padding:7px 16px;font-size:13px;border-radius:6px}
.noted__empty{flex:1;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:20px;text-align:center;color:var(--c-text-3);font-size:14px;padding:24px}
.noted :deep(.record-workspace){flex:1;min-height:0;grid-template-columns:300px minmax(0,1fr);gap:28px}
.noted :deep(.record-workspace__index){min-height:0;position:relative;padding:0 16px 0 0;border-right:1px solid transparent;display:flex;flex-direction:column}
.noted :deep(.record-workspace__index)::before{content:"";position:absolute;right:-1px;top:-28px;bottom:-28px;width:1px;background:var(--c-border);pointer-events:none}
.noted :deep(.record-workspace__head){flex:none;display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 18px}
.noted :deep(.record-workspace__head h1){font:600 24px/1.5 var(--font-sans);gap:14px;margin:0;flex-wrap:nowrap;white-space:nowrap}
.noted :deep(.record-workspace__head small){font:400 12px/1.5 var(--font-sans);color:var(--c-text-3)}
.noted :deep(.record-workspace__actions){display:contents}
.noted__add{display:grid;place-items:center;flex:none;width:36px;height:36px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--c-text);cursor:pointer}
.noted__add:hover:not(:disabled){background:var(--c-bg-sunken)}.noted__add:disabled{opacity:.45;cursor:not-allowed}
.noted :deep(.record-workspace__search){flex:none;margin-bottom:16px}
.noted :deep(.record-workspace__search input){height:36px;min-height:36px;font-size:13px;border-radius:6px;padding-left:34px;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='%23696E66' stroke-width='1.5'%3E%3Ccircle cx='10.5' cy='10.5' r='7.5'/%3E%3Cpath d='m16 16 5 5'/%3E%3C/svg%3E");background-repeat:no-repeat;background-size:16px;background-position:11px center}
.noted :deep(.record-workspace__records){min-height:0;overflow-y:auto;scrollbar-width:none;gap:8px}
.noted :deep(.record-workspace__records::-webkit-scrollbar){display:none}
.noted :deep(.record-choice){min-height:92px;padding:12px;border-radius:8px;align-items:flex-start}
.noted :deep(.record-choice[aria-pressed=true]){background:color-mix(in srgb,var(--c-detail) 4%,var(--c-white))}
.note-choice{display:grid;gap:6px;min-width:0;width:100%}
.note-choice strong{font:600 16px/1.5 var(--font-sans)}
.note-choice>span{font-size:13px;line-height:1.5;color:var(--c-text-2)}
.note-choice strong,.note-choice>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.noted :deep(.note-choice time){max-width:none;justify-self:end;font:400 12px/1.5 var(--font-sans);color:var(--c-text-3)}
.noted :deep(.record-workspace__detail){flex:1;display:flex;flex-direction:column;min-height:0;overflow:hidden}
.noted__list{list-style:none;margin:0;padding:0;flex:1;min-height:0;display:flex;flex-direction:column}
.note-document{display:flex;flex-direction:column;flex:1;min-height:0;min-width:0}
.note-document__tools{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-bottom:16px;border-bottom:1px solid var(--c-border);flex:none}
.note-document__tools label{display:flex;align-items:center;gap:12px;font-size:13px;color:var(--c-text-2);min-width:0}
.note-document__tools input{width:190px;min-width:0;min-height:36px;border:1px solid var(--c-border);padding:7px 10px;border-radius:6px;color:var(--c-text);font:400 13px/1.5 var(--font-sans);background:var(--c-white)}




.note-document__writing{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:26px 12px 24px;scrollbar-width:thin}
.note-document__title,.note-document__text{display:block;width:100%;border:0;resize:none;background:transparent;color:var(--c-text);overflow:hidden;padding:0;border-radius:0}
.note-document__title{font:600 26px/1.5 var(--font-story);margin-bottom:24px;min-height:39px}
.note-document__text{font:400 17px/2 var(--font-sans);min-height:240px}
.note-document__title:focus,.note-document__text:focus{outline:none;box-shadow:none}
.note-document__title:focus-visible,.note-document__text:focus-visible{background:var(--c-bg-raised)}
.note-document__footer{display:flex;align-items:center;justify-content:space-between;gap:16px;flex:none;border-top:1px solid transparent;padding:12px 4px 0;font-size:12px;color:var(--c-text-3)}
@media(max-width:1439px){.noted{padding:24px}.noted :deep(.record-workspace__index)::before{top:-24px;bottom:-24px}.noted :deep(.record-workspace){grid-template-columns:280px minmax(0,1fr);gap:24px}}
@media(min-width:768px) and (max-width:1100px){.noted :deep(.record-workspace){grid-template-columns:230px minmax(0,1fr);gap:24px}.note-document__tools label{gap:8px}}
@media(max-width:767px){
.noted{padding:24px 16px;height:auto;min-height:var(--notes-height);overflow:visible}
.noted[data-detail=true]{height:var(--notes-height);min-height:0;overflow:hidden}
.noted[data-detail=true]>.noted__bar{display:none}
.noted__bar{padding-bottom:20px;margin-bottom:24px;gap:12px}.noted__bar h1{font-size:24px;gap:12px}
.noted :deep(.record-workspace){display:block;flex:1;min-height:0}
.noted :deep(.record-workspace__index){padding:0;border:0;display:block}
.noted :deep(.record-workspace__index)::before{display:none}
.noted :deep(.record-workspace[data-detail=true]>.record-workspace__index){display:none}
.noted :deep(.record-workspace[data-detail=false]>.record-workspace__detail){display:none}
.noted :deep(.record-workspace[data-detail=true]){display:flex;flex-direction:column}
.noted :deep(.record-workspace__search input){height:40px;min-height:40px;font-size:14px}
.noted :deep(.record-workspace__records){overflow:visible}
.noted :deep(.record-workspace__toolbar){flex:none}
.noted__detail-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:20px}
.noted__detail-toolbar .record-workspace__back{display:flex;align-items:center;gap:10px;margin:0;min-height:36px;border:0;background:transparent;padding:0;color:var(--c-text);font:400 16px var(--font-sans)}
.note-back-icon{display:grid;place-items:center;width:28px;height:28px;border:1px solid var(--c-border);border-radius:50%;flex:none}
.note-document__tools{padding-bottom:14px;gap:8px}.note-document__tools label{gap:10px;font-size:12px}.note-document__tools input{width:180px;font-size:13px}
.note-document__writing{padding:24px 4px}.note-document__title{font-size:25px;margin-bottom:20px}.note-document__text{font-size:17px}
.note-document__footer{padding-top:12px}
}
@media(any-pointer:coarse){.noted__add{width:44px;height:44px}}
</style>
