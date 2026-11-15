<script setup>
const props = defineProps({
  items: { type: Array, required: true }, characters: { type: Array, required: true },
  avatar: { type: Function, required: true }, readOnly: Boolean, depth: { type: Number, default: 0 },
  maxLength: { type: Number, required: true },
  testPrefix: { type: String, default: 'x-reply' },
  noun: { type: String, default: '回复' }, compact: Boolean,
})
const emit = defineEmits(['author-change', 'time-change', 'text-change', 'reply', 'remove'])
function grow(element) { element.style.height = 'auto'; element.style.height = `${element.scrollHeight + 2}px` }
const observers = new WeakMap()
const vAutoGrow = {
  mounted(element) {
    grow(element)
    let width = 0
    const observer = new ResizeObserver(() => {
      if (element.clientWidth === width) return
      width = element.clientWidth
      requestAnimationFrame(() => { if (element.isConnected) grow(element) })
    })
    observer.observe(element)
    observers.set(element, observer)
  },
  updated: grow,
  unmounted(element) { observers.get(element)?.disconnect(); observers.delete(element) },
}
function initial(reply) { return props.characters.find(c => c.id === reply.authorCharacterId)?.name?.[0] || '?' }
</script>

<template>
  <ul class="xreplies" :class="{ 'xreply-children': depth > 0, 'xreplies--compact': compact }" :data-flat="depth > 2">
    <li v-for="item in items" :key="item.node.id" class="xreply" :data-depth="item.depth" :data-reply-id="item.node.id" :data-comment-id="item.node.id" :data-testid="`${testPrefix}-row`">
      <div class="xreply__row" :class="{ 'xreply__row--parent': item.children.length && depth < 2 }">
        <img v-if="avatar(item.node)" class="xreply__avatar" :src="avatar(item.node)" alt="" />
        <span v-else class="xreply__avatar xreply__avatar--empty" aria-hidden="true">{{ initial(item.node) }}</span>
        <div class="xreply__body">
          <div class="xreply__head">
            <label class="xreply__author-field"><span class="sr-only">{{ noun }}者</span><select class="xreply__author" :value="item.node.authorCharacterId ?? ''" :disabled="readOnly" :data-testid="`${testPrefix}-author`" @change="emit('author-change', { reply: item.node, event: $event })">
              <option value="">未指定</option><option v-for="ch in characters" :key="ch.id" :value="ch.id">{{ ch.name }}{{ !compact && ch.handle ? ` @${ch.handle}` : '' }}</option>
            </select></label>
            <label class="xreply__time-field"><span v-if="!compact">时间</span><span v-else class="sr-only">评论时间</span><input class="xreply__time" type="datetime-local" :value="item.node.localTime" :disabled="readOnly" :aria-label="noun + '时间'" :data-testid="`${testPrefix}-time`" @change="emit('time-change', {reply:item.node,event:$event})" /></label>
            <div v-if="!compact" class="xreply__actions"><button type="button" class="xreply__reply" :disabled="readOnly" :data-testid="`${testPrefix}-to`" @click="emit('reply',item.node)">回复</button><button type="button" class="xreply__remove" :disabled="readOnly" :data-testid="`${testPrefix}-remove`" @click="emit('remove',item.node)">删除</button></div>
          </div>
          <div class="xreply__text-row"><textarea v-auto-grow class="xreply__text" :value="item.node.content" :maxlength="maxLength" :disabled="readOnly" rows="1" :aria-label="noun + '内容'" :placeholder="noun + '内容'" :data-testid="`${testPrefix}-text`" @input="grow($event.target)" @change="emit('text-change', { reply: item.node, event: $event })"></textarea><div v-if="compact" class="xreply__actions"><button type="button" class="xreply__reply" :disabled="readOnly" :data-testid="`${testPrefix}-to`" @click="emit('reply',item.node)">回复</button><button type="button" class="xreply__remove" :disabled="readOnly" :data-testid="`${testPrefix}-remove`" @click="emit('remove',item.node)">删除</button></div></div>
        </div>
      </div>
      <CommentThread v-if="item.children.length" :compact="compact" :test-prefix="testPrefix" :noun="noun" :items="item.children" :characters="characters" :avatar="avatar" :read-only="readOnly" :depth="depth + 1" :max-length="maxLength" @author-change="emit('author-change', $event)" @time-change="emit('time-change', $event)" @text-change="emit('text-change', $event)" @reply="emit('reply', $event)" @remove="emit('remove', $event)" />
    </li>
  </ul>
</template>

<style scoped>
.xreplies{list-style:none;margin:0;padding:0;min-width:0}
.xreply{position:relative;min-width:0;padding:0;margin:0 0 12px;--avatar:40px;--line-x:20px}
.xreply__row{display:grid;grid-template-columns:var(--avatar) minmax(0,1fr);gap:14px;position:relative}
.xreply__avatar{width:var(--avatar);height:var(--avatar);object-fit:cover;border-radius:50%;margin-top:2px}
.xreply__avatar--empty{display:grid;place-items:center;background:var(--c-bg-sunken);font-size:14px;color:var(--c-text-2)}
.xreply__body{min-width:0;container-type:inline-size}
.xreply__head{display:flex;align-items:center;gap:20px;margin-bottom:6px;min-width:0}
.xreply__author-field{width:164px;min-width:0;flex:none}
.xreply__time-field{flex:0 1 280px;display:flex;align-items:center;gap:12px;min-width:0;font-size:13px;color:var(--c-text-2)}
.xreply__time-field span{white-space:nowrap}
.xreply input,.xreply select{height:36px;min-width:0;width:100%;border:1px solid var(--c-border);border-radius:9px;padding:5px 10px;background:white;color:var(--c-text);font:inherit;font-size:14px}
.xreply__time{max-width:240px}
.xreply__author{font-weight:600!important}
.xreply__actions{display:flex;align-items:center;gap:14px;margin-left:auto;flex:none}
.xreply__actions button{min-height:34px;padding:5px 14px;background:white;border:1px solid var(--c-border);border-radius:10px;font-size:13px;white-space:nowrap}
.xreply__actions .xreply__remove{border-color:transparent;color:var(--c-danger);padding:5px 0}
.xreply__text{display:block;width:100%;min-height:36px;box-sizing:border-box;border:1px solid var(--c-border);border-radius:9px;padding:6px 10px;resize:vertical;font:inherit;font-size:14px;line-height:1.6;color:var(--c-text);background:white;overflow:hidden}
.xreply-children{margin-left:var(--line-x);padding-left:24px;margin-top:12px}
.xreply-children>.xreply{--avatar:32px;--line-x:16px}
.xreply__row--parent::before{content:'';position:absolute;left:var(--line-x);top:calc(var(--avatar) + 6px);bottom:-12px;border-left:1px solid var(--c-border)}
.xreply-children>.xreply::before{content:'';position:absolute;left:-24px;top:-12px;bottom:-12px;border-left:1px solid var(--c-border)}
.xreply-children>.xreply:last-child::before{bottom:auto;height:30px}
.xreply-children>.xreply::after{content:'';position:absolute;left:-24px;top:18px;width:18px;border-top:1px solid var(--c-border)}
.xreply-children[data-flat=true]{margin-left:0;padding-left:0}
.xreply-children[data-flat=true]>.xreply::before,.xreply-children[data-flat=true]>.xreply::after{display:none}
@media(max-width:1439px){.xreply__head{gap:10px}.xreply__author-field{width:140px}.xreply__time{max-width:205px}.xreply__actions{gap:8px}}
@media(max-width:1279px){.xreply__head{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px}.xreply__author-field{width:auto}.xreply__time-field{grid-row:2;grid-column:1/-1}.xreply__time{max-width:none}.xreply__time-field input{flex:1}.xreply__actions{grid-row:1;grid-column:2}}
@container(max-width:580px){
.xreply__head{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px}
.xreply__author-field{width:auto}
.xreply__time-field{grid-row:2;grid-column:1/-1}
.xreply__time{max-width:none}
.xreply__time-field input{flex:1}
.xreply__actions{grid-row:1;grid-column:2}
}
@media(max-width:767px){
.xreply{--avatar:36px;--line-x:18px}
.xreply__row{gap:10px}
.xreply__time-field{gap:8px}
.xreply input,.xreply select,.xreply__text{font-size:16px;min-height:44px}
.xreply__actions button{min-height:44px;padding:5px 8px}
.xreply__actions{gap:6px}
.xreply-children{padding-left:12px}
.xreply-children>.xreply::before,.xreply-children>.xreply::after{left:-12px}
.xreply-children>.xreply::after{width:8px}
}

@media(max-width:767px){.xreplies--compact>.xreply>.xreply__row>.xreply__body>.xreply__head{flex-wrap:wrap;gap:6px 10px}.xreplies--compact .xreply__time-field{flex:1 1 140px}.xreplies--compact .xreply__time{font-size:11px}.xreplies--compact .xreply__actions{gap:10px}}

.xreplies--compact .xreply__text-row{display:flex;align-items:flex-start;gap:24px;min-width:0}
.xreplies--compact .xreply__text-row>.xreply__text{field-sizing:content;width:auto;min-width:4ch;max-width:calc(100% - 100px);flex:0 1 auto}
.xreplies--compact .xreply__text-row>.xreply__actions{margin:0;flex:none;gap:12px}
@media(max-width:767px){.xreplies--compact .xreply__text-row{gap:16px}}
</style>
<style scoped>
.xreplies--compact>.xreply{--avatar:34px;--line-x:17px;margin-bottom:14px}.xreplies--compact>.xreply>.xreply__row{gap:14px}.xreplies--compact>.xreply>.xreply__row>.xreply__body>.xreply__head{display:flex;align-items:center;gap:10px;margin-bottom:6px;min-height:24px}.xreplies--compact .xreply__author-field{width:auto;max-width:180px;flex:0 1 auto}.xreplies--compact .xreply__author{border:0;border-radius:4px;min-height:24px;height:24px;padding:0 16px 0 0;font-size:13px}.xreplies--compact .xreply__text{border:0;border-radius:4px;min-height:28px;padding:0;resize:none;font-size:14px;line-height:1.6} .xreplies--compact .xreply__time-field{flex:0 1 200px;min-width:0;grid-row:auto;grid-column:auto}
.xreplies--compact .xreply__time{width:100%;max-width:200px;height:30px;min-height:30px;font-size:12px;padding:4px 8px;border-radius:5px}
.xreplies--compact .xreply__actions{margin-left:auto;gap:12px;grid-row:auto;grid-column:auto}
.xreplies--compact .xreply__actions button{border:0;border-radius:4px;background:none;min-height:30px;padding:4px 0;font-size:12px}
@media(max-width:767px){.xreplies--compact>.xreply{--avatar:32px}.xreplies--compact .xreply__author-field{max-width:140px}.xreplies--compact .xreply__author{font-size:13px}}

.xreplies--compact .xreply__text-row{display:flex;align-items:flex-start;gap:24px;min-width:0}
.xreplies--compact .xreply__text-row>.xreply__text{field-sizing:content;width:auto;min-width:4ch;max-width:calc(100% - 100px);flex:0 1 auto}
.xreplies--compact .xreply__text-row>.xreply__actions{margin:0;flex:none;gap:12px}
@media(max-width:767px){.xreplies--compact .xreply__text-row{gap:16px}}
</style>
