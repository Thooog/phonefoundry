<script setup>
import { computed, ref } from 'vue'
import { shouldSubmitMessage } from '../../utils/message-submit.js'
import { useUiStore } from '../../stores/ui.js'
const ui = useUiStore()
import { MESSAGE_CONTENT_MAX_LENGTH, MESSAGE_MEDIA_MAX, MESSAGE_DURATION_MAX } from '../../editing/messages.js'
import { MESSAGE_TRANSCRIPT_MAX_LENGTH, STICKER_MEDIA_MAX } from '../../editing/kakaotalk.js'
const draft = defineModel('draft', { type: Object, required: true })
const props = defineProps({
  appearance: { type: String, default: 'chat' }, defaultSenderId: { type: String, default: '' },
  conversation: { type: String, default: '当前会话' }, senders: { type: Array, default: () => [] },
  types: { type: Object, required: true }, disabled: Boolean, busy: Boolean,
})
const emit = defineEmits(['submit'])
const fileInput = ref(null)
const form = ref(null)
const mobile = window.matchMedia('(any-pointer: coarse)').matches
const composing = ref(false)
let allowLineBreak = false
function onMessageEnter(event) {
  if (event.type === 'keydown') allowLineBreak = event.key === 'Enter' && event.shiftKey
  if (event.type === 'beforeinput' && allowLineBreak) { allowLineBreak = false; return }
  if (!shouldSubmitMessage(event, mobile, composing.value)) return
  event.preventDefault()
  submitShortcut()
}
const selectedSender = computed(() => props.senders.find(sender => sender.id === (draft.value.sender || props.defaultSenderId)))
const hasDraft = computed(() => draft.value.content || draft.value.files.length || draft.value.transcript || draft.value.type !== 'text' || draft.value.pendingId)
const shortcut = /Mac/.test(navigator.platform) ? '⌘' : 'Ctrl'
function selectFiles(event) {
  const files = Array.from(event.target.files || []).slice(0, draft.value.type === 'sticker' ? STICKER_MEDIA_MAX : MESSAGE_MEDIA_MAX)
  if (files.length) draft.value.files = files
  event.target.value = ''
}
async function removeFile(index) {
  if (props.disabled || props.busy) return
  const file = draft.value.files[index]
  if (!file || !(await ui.confirm({ title: '移除这张待发送图片？', message: `「${file.name}」将从当前消息草稿移除。`, confirmText: '移除', tone: 'danger' }))) return
  const current = draft.value.files.indexOf(file)
  if (current >= 0) draft.value.files.splice(current, 1)
}
function submitShortcut() { if (!props.disabled && !props.busy) form.value.requestSubmit() }
</script>

<template>
  <form ref="form" class="message-composer reference-composer" :aria-label="'追加消息到' + conversation" @submit.prevent="emit('submit')">
    <div class="reference-compose-tools">
      <label class="reference-sender"><span class="sr-only">发送者</span><select v-model="draft.sender" :disabled="disabled || busy || draft.type === 'system'"><option value="">{{ selectedSender?.name || '默认发送者' }}</option><option v-for="sender in senders" :key="sender.id" :value="sender.id">{{ sender.name }}</option></select></label>
      <input ref="fileInput" class="sr-only" type="file" accept="image/*" :multiple="draft.type !== 'sticker'" :disabled="disabled || busy" tabindex="-1" @change="selectFiles" />
      <label class="reference-type"><span class="sr-only">消息类型</span><select v-model="draft.type" :disabled="disabled || busy" @change="draft.files = []"><option v-for="(name, type) in types" :key="type" :value="type">{{ name }}</option></select></label>
      <label class="reference-time"><input v-model="draft.time" aria-label="消息时间" type="datetime-local" :disabled="disabled || busy" /></label>
    </div>
    <div class="reference-compose-body">
      <div v-if="draft.type === 'image' || draft.type === 'sticker'" class="reference-files"><button type="button" :disabled="disabled || busy" @click="fileInput.click()">选择{{ draft.type === 'sticker' ? '贴图' : '图片' }}</button><ul><li v-for="(file, index) in draft.files" :key="index">{{ file.name }}<button type="button" :disabled="disabled || busy" @click="removeFile(index)">移除</button></li></ul></div>
      <template v-else-if="draft.type === 'voice'">
        <label class="reference-voice">语音时长（秒）<input v-model.number="draft.duration" type="number" min="1" :max="MESSAGE_DURATION_MAX" :disabled="disabled || busy" /></label>
        <textarea v-model="draft.transcript" :disabled="disabled || busy" :maxlength="MESSAGE_TRANSCRIPT_MAX_LENGTH" aria-label="语音转文字草稿" placeholder="语音转写（选填）" rows="2" :enterkeyhint="mobile ? 'send' : 'enter'" @keydown="onMessageEnter" @beforeinput="onMessageEnter" @compositionstart="composing = true" @compositionend="composing = false"></textarea>
      </template>
      <!-- 通话：类型/结果/时长。未接通没有时长可打，输入条直接不出现 -->
      <template v-else-if="draft.type === 'call'">
        <label class="reference-voice">通话类型<select v-model="draft.callKind" :disabled="disabled || busy"><option value="voice">语音通话</option><option value="video">视频通话</option></select></label>
        <label class="reference-voice">通话结果<select v-model="draft.callStatus" :disabled="disabled || busy"><option value="completed">已接通</option><option value="missed">未接通</option></select></label>
        <label v-if="draft.callStatus !== 'missed'" class="reference-voice">通话时长（秒）<input v-model.number="draft.duration" type="number" min="1" :max="MESSAGE_DURATION_MAX" :disabled="disabled || busy" /></label>
      </template>
      <textarea v-else v-model="draft.content" :disabled="disabled || busy" :maxlength="MESSAGE_CONTENT_MAX_LENGTH" aria-label="新消息正文" :placeholder="draft.type === 'system' ? '写下系统消息…' : '接着写下一句……'" rows="2" :enterkeyhint="mobile ? 'send' : 'enter'" @keydown="onMessageEnter" @beforeinput="onMessageEnter" @compositionstart="composing = true" @compositionend="composing = false"></textarea>
    </div>
    <footer><span v-if="hasDraft" class="reference-draft-status" role="status">{{ draft.pendingId ? '追加未完成，草稿已保留' : '尚未添加' }}</span><span v-else class="reference-key-hint">{{ mobile ? 'Enter 添加 · Shift Enter 换行' : `Enter 换行 · ${shortcut} Enter 添加` }}</span><button class="message-composer__submit" type="submit" :disabled="disabled || busy || ((draft.type === 'image' || draft.type === 'sticker') && !draft.files.length)">{{ busy ? '正在添加…' : draft.pendingId ? '重试添加' : '添加消息' }}</button></footer>
  </form>
</template>
