<script setup>
import { onBeforeUnmount } from 'vue'
import { createMessageActivation } from '../../utils/message-activation.js'
import { formatChatDay, toDateTimeLocal } from '../../utils/time.js'

defineProps({
  appearance: { type: String, default: 'default' },
  messages: { type: Array, required: true }, selected: { type: String, default: null },
  sender: { type: Function, required: true }, avatar: { type: Function, required: true },
  media: { type: Function, required: true }, own: { type: Function, default: () => false },
  showRead: { type: Boolean, default: true }, readOnly: Boolean, testPrefix: { type: String, default: 'message' },
})
const emit = defineEmits(['select', 'edit', 'before', 'after', 'remove'])
const activation = createMessageActivation(id => emit('select', id), id => emit('edit', id))
onBeforeUnmount(activation.dispose)
const date = time => toDateTimeLocal(time).slice(0, 10)
const clock = time => toDateTimeLocal(time).slice(11, 16)
/**
 * 通话消息的尾部标注。这里看不到气泡分侧（发起方/接听方），所以未接通
 * 统一写「未接通」—— 作品端会按气泡所在侧细化成「已取消/未接听」。
 * 时长与作品端同一套 mm:ss 换算，两边数字对得上。
 */
const callNote = message => {
  if (message.callStatus === 'missed') return '未接通'
  const sec = Math.max(0, Math.round(message.durationSec || 0))
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}
</script>

<template>
  <ol class="message-timeline" :class="{ 'message-timeline--chat': appearance === 'chat' }">
    <li v-for="(message, index) in messages" :key="message.id">
      <p v-if="index === 0 || date(message.displayTime) !== date(messages[index - 1].displayTime)" class="message-date">{{ appearance === 'chat' ? formatChatDay(message.displayTime) : date(message.displayTime) || '未设置日期' }}</p>
      <div class="message-line" :class="{ 'message-line--selected': selected === message.id, 'message-line--own': own(message), 'message-line--system': message.contentType === 'system' }" :data-side="own(message) ? 'right' : 'left'" :data-msg-id="message.id" :data-testid="testPrefix + '-message-row'">
        <button type="button" class="message-line__select" :aria-pressed="selected === message.id" aria-description="单击显示消息操作，双击或按 Enter 编辑消息属性" @click="activation.click(message.id, $event)" @dblclick="activation.doubleClick(message.id)" @keydown.enter.prevent="activation.edit(message.id)" @pointerdown="activation.pointerDown(message.id, $event)" @pointermove="activation.pointerMove($event)" @pointerup="activation.pointerUp(message.id, $event)" @pointercancel="activation.pointerCancel()">
          <template v-if="message.contentType !== 'system'">
            <img v-if="avatar(message)" class="message-avatar" :src="avatar(message)" alt="" />
            <span v-else class="message-avatar message-avatar--empty">{{ sender(message)?.[0] || '?' }}</span>
          </template>
          <span class="message-body">
            <span v-if="message.contentType !== 'system'" class="message-meta"><strong v-if="message.contentType !== 'system'">{{ sender(message) }}</strong><time>{{ clock(message.displayTime) }}</time><small v-if="showRead && own(message) && message.readAt">已读</small></span>
            <span v-if="message.contentType === 'voice'" class="voice-summary"><span class="voice-summary__bar"><svg v-if="appearance === 'chat'" class="voice-wave" viewBox="0 0 180 24" aria-hidden="true"><path d="M2 11v2m6-4v6m6-8v10m6-12v14m6-10v6m6-7v8m6-12v16m6-10v4m6-7v10m6-12v14m6-18v22m6-16v10m6-8v6m6-10v14m6-10v6m6-9v12m6-15v18m6-20v22m6-16v10m6-8v6m6-10v14m6-9v4m6-8v12m6-9v6m6-7v8m6-5v2m6-7v12m6-9v6m6-6v6m6-5v4" /></svg><span v-else aria-hidden="true">▂ ▅ ▃ ▆ ▂ ▄ ▆ ▃ ▅ ▂</span><span class="voice-summary__duration">语音 {{ message.durationSec || 1 }}{{ appearance === 'chat' ? '秒' : ' 秒' }}</span></span><span v-if="message.transcript" class="voice-summary__transcript">{{ message.transcript }}</span></span>
            <span v-else-if="message.contentType === 'call'" class="call-summary" :data-missed="message.callStatus === 'missed' ? 'true' : 'false'" data-testid="message-call-summary">
              <svg class="call-summary__icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
              <span>{{ message.callKind === 'video' ? '视频通话' : '语音通话' }}</span>
              <span class="call-summary__note">{{ callNote(message) }}</span>
            </span>
            <span v-else-if="message.contentType === 'image' || message.contentType === 'sticker'" class="message-media" :class="{ 'message-media--sticker': message.contentType === 'sticker' }">
              <span v-for="id in message.mediaAssetIds" :key="id"><img v-if="media(id)" :src="media(id)" alt="消息图片" /><span v-else>图片缺失</span></span><span v-if="!message.mediaAssetIds?.length">尚未添加图片</span>
            </span>
            <span v-else class="message-content">{{ message.content || '空消息，点击填写' }}</span>
          </span>
        </button>
        <div v-show="selected === message.id" class="message-line__actions">
          <button type="button" :disabled="readOnly" :data-testid="testPrefix + '-message-add-before'" @click="$emit('before', message)">＋ 在前面新增</button>
          <button type="button" :disabled="readOnly" :data-testid="testPrefix + '-message-add-after'" @click="$emit('after', message)">＋ 在后面新增</button>
          <button type="button" :disabled="readOnly" :data-testid="testPrefix + '-message-remove'" @click="$emit('remove', message)">删除</button>
        </div>
      </div>
    </li>
  </ol>
</template>

<style scoped>
.message-timeline{list-style:none;padding:0;margin:0}
.message-date{display:flex;align-items:center;gap:20px;justify-content:center;margin:12px 0 22px;font-size:13px;font-weight:500;color:var(--c-text-2)}
.message-date::before,.message-date::after{content:'';height:1px;background:var(--c-border);flex:1}
.message-line{position:relative;width:fit-content;max-width:90%;padding:12px;margin:4px 0;border-radius:12px}
.message-line--own{margin-left:auto}
.message-line--selected{background:var(--c-selected);min-width:min(480px,90%)}
.message-line__select{display:flex;align-items:flex-start;gap:14px;width:100%;border:0;background:transparent;padding:0;text-align:left;color:var(--c-text)}
.message-line--own .message-line__select{flex-direction:row-reverse;text-align:right}
.message-avatar{width:38px;height:38px;border-radius:50%;object-fit:cover;flex:none}
.message-avatar--empty{display:grid;place-items:center;background:var(--c-bg-sunken);font-size:14px}
.message-body{display:flex;flex-direction:column;gap:5px;min-width:0}
.message-meta{display:flex;align-items:baseline;gap:9px;flex-wrap:wrap}
.message-meta strong{font-size:15px;font-weight:600;overflow-wrap:anywhere}
.message-meta time,.message-meta small{font-size:12px;color:var(--c-text-3)}
.message-line--own .message-meta{justify-content:flex-end}
.message-content{font-size:15px;line-height:1.8;white-space:pre-wrap;overflow-wrap:anywhere;max-width:70ch}
.message-media{display:flex;gap:6px;flex-wrap:wrap;margin-top:5px}
.message-line--own .message-media{justify-content:flex-end}
.message-media>span{width:96px;min-height:70px}
.message-media img{width:96px;height:86px;object-fit:cover;border-radius:8px}
.message-media--sticker img{object-fit:contain}
.voice-summary{display:grid;gap:8px;text-align:left;font-size:14px;max-width:55ch}
.call-summary{display:flex;align-items:center;gap:8px;font-size:15px;max-width:70ch}
.call-summary__icon{width:18px;height:18px;flex:none;color:var(--c-text-2)}
.call-summary__note{font-size:13px;color:var(--c-text-3);font-variant-numeric:tabular-nums;white-space:nowrap}
.call-summary[data-missed='true'] .call-summary__note{color:var(--c-danger)}
.voice-summary__bar{display:flex;gap:24px;align-items:center;border:1px solid var(--c-border-strong);border-radius:9px;padding:9px 14px;background:var(--c-bg-raised);width:fit-content;max-width:100%}
.voice-summary__bar>span:not(.voice-summary__duration){color:var(--c-text-3);letter-spacing:2px}
.voice-summary__transcript{font-size:13px;line-height:1.7;color:var(--c-text-2);overflow-wrap:anywhere}
.message-line--own .voice-summary{align-self:flex-end}
.message-line__actions{display:flex;gap:10px;flex-wrap:wrap;margin:10px 0 0 52px}
.message-line--own .message-line__actions{justify-content:flex-end;margin:10px 52px 0 0}
.message-line__actions button{padding:6px 4px;border:0;background:transparent;font-size:12px;min-height:32px;color:var(--c-text-2)}
.message-line__actions button:last-child{color:var(--c-danger)}
.message-line__actions button:hover{color:var(--c-text)}
.message-line--system{margin:12px auto;text-align:center;max-width:100%}
.message-line--system .message-body{align-items:center}
.message-line--system .message-line__select{justify-content:center;text-align:center}
.message-line--system .message-content{font-size:13px;color:var(--c-text-2);background:var(--c-bg-sunken);padding:4px 12px;border-radius:6px}
.message-line--system .message-line__actions{margin-left:0;justify-content:center}
@media(max-width:767px){.message-line{max-width:96%;padding:10px 6px}.message-line--selected{min-width:min(280px,96%)}.message-line__select{gap:9px}.message-avatar{width:32px;height:32px}.message-content{font-size:15px}.message-line__actions,.message-line--own .message-line__actions{margin:8px 0 0;gap:4px}.message-line__actions button{min-height:44px}.voice-summary__bar{gap:12px;padding:8px}.voice-summary__bar>span:not(.voice-summary__duration){letter-spacing:0}.message-media>span,.message-media img{width:78px}}
/* KKT selection outlines the bubble without changing its padding. */
.message-timeline--chat .message-line{padding:0;margin:0 0 4px;max-width:88%;border-radius:12px}
.message-timeline--chat .message-line--own{margin-left:auto}
.message-timeline--chat .message-line--selected{min-width:0;background:transparent}
.message-timeline--chat .message-line__actions{width:max-content;max-width:100%;margin:6px 0 6px 52px}
.message-timeline--chat .message-line--own .message-line__actions{margin:6px 52px 6px 0}
.message-timeline--chat .message-line--system .message-line__actions{margin:6px auto}
.message-timeline--chat .message-line__select{gap:12px;font:inherit}
.message-timeline--chat .message-avatar{width:40px;height:40px}
.message-timeline--chat .message-meta{line-height:1.3}
.message-timeline--chat .message-body{gap:4px;align-items:flex-start}
.message-timeline--chat .message-line--own .message-body{align-items:flex-end}
.message-timeline--chat .message-content{background:var(--c-bg-sunken);border-radius:12px;padding:4px 12px;line-height:1.5;text-align:left}
.message-timeline--chat .message-line--selected .message-content,
.message-timeline--chat .message-line--selected .voice-summary__bar,
.message-timeline--chat .message-line--selected .message-media,
.message-timeline--chat .message-line--selected .call-summary{outline:1px solid var(--c-border-strong);outline-offset:2px}
.message-timeline--chat .message-date{margin:8px 0 20px}
.message-timeline--chat .message-meta strong{font-size:15px}
.message-timeline--chat .message-meta time{font-size:13px}
.message-timeline--chat .voice-summary{max-width:100%;gap:5px}
.message-timeline--chat .call-summary{background:var(--c-bg-sunken);border-radius:12px;padding:4px 12px;line-height:1.5}
.message-timeline--chat .voice-summary__bar{gap:16px;padding:7px 12px;border-radius:10px}
.voice-wave{width:180px;height:24px;max-width:48%;min-width:36px;flex:1;stroke:var(--c-text-3);stroke-width:2;stroke-linecap:round;fill:none}
.message-timeline--chat .voice-summary__duration{white-space:nowrap;color:var(--c-text);font-size:14px;letter-spacing:0}
.message-timeline--chat .voice-summary__transcript{background:var(--c-bg-sunken);border-radius:10px;padding:3px 10px;font-size:13px;line-height:1.5}
.message-timeline--chat .message-line--system{margin:4px auto 0}
.message-timeline--chat .message-line--system .message-body{align-items:center}
@media(max-width:767px){
.message-timeline--chat .message-avatar{width:36px;height:36px}
.message-timeline--chat .message-line{max-width:96%;margin-bottom:22px}
.message-timeline--chat .message-line__select{gap:10px}
.message-timeline--chat .message-line__actions,.message-timeline--chat .message-line--own .message-line__actions{margin:6px 0;max-width:100%;gap:6px}
.message-timeline--chat .voice-summary__bar{gap:10px;padding:8px}
.voice-wave{width:140px}
}
</style>
