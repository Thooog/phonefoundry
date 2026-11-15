import { reactive, ref, computed, watch, inject, onBeforeUnmount } from 'vue'
import { emptyMessageDraft, commitMessageDraft } from './message-drafts.js'
import { onBeforeRouteLeave } from 'vue-router'
import { useUiStore } from '../stores/ui.js'

export function useMessageDrafts(conversations, operations) {
  const drafts = reactive({})
  const submitting = ref(false)
  const registry = inject('creator-drafts', null)
  const key = Symbol('message-drafts')
  const ui = useUiStore()
  const hasDrafts = computed(() => Object.values(drafts).some(draft => draft.content || draft.files.length || draft.transcript || draft.type !== 'text' || draft.pendingId))
  function draftFor(id) { return drafts[id] ??= emptyMessageDraft() }
  watch(() => conversations.value.map(record => record.id), ids => {
    for (const id of Object.keys(drafts)) if (!ids.includes(id)) delete drafts[id]
  })
  if (registry) registry.set(key, hasDrafts)
  onBeforeUnmount(() => registry?.delete(key))
  onBeforeRouteLeave(async () => !hasDrafts.value || await ui.confirm({ title: '还有未追加的消息', message: '草稿尚未追加到会话。离开此页会丢弃这些草稿。', confirmText: '丢弃并离开', cancelText: '继续编辑' }))
  async function submit(conv) {
    if (submitting.value || operations.readOnly()) return
    const draft = draftFor(conv.id)
    submitting.value = true
    try {
      const id = await commitMessageDraft(draft, operations.forConversation(conv, draft))
      drafts[conv.id] = emptyMessageDraft()
      operations.select(id)
    } catch (error) { operations.error(error.message) }
    finally { submitting.value = false }
  }
  return { draftFor, submitting, hasDrafts, submit }
}
