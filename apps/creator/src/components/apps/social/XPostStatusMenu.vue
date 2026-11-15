<script setup>
import { normalizeXPostState } from '@phone-sim/shared'
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
const props = defineProps({ post: { type: Object, required: true }, characters: { type: Array, required: true }, disabled: Boolean })
const emit = defineEmits(['patch'])
const menu = ref(null)
const types = computed(() => normalizeXPostState(props.post).xPostTypes)
const label = type => type === 'repost' ? '转推' : '点赞'
const keyOf = type => type === 'repost' ? 'xRepostByCharacterIds' : 'xLikeByCharacterIds'
function actors(type) { return normalizeXPostState(props.post)[keyOf(type)] }
function toggleType(type) {
  const next = types.value.includes(type) ? types.value.filter(value => value !== type) : [...types.value, type]
  emit('patch', { xPostTypes: next, xRepostByCharacterIds: next.includes('repost') ? actors('repost') : [], xLikeByCharacterIds: next.includes('like') ? actors('like') : [] })
}
function toggleActor(type, id) {
  const current = actors(type)
  emit('patch', { xPostTypes: [...new Set([...types.value, type])], [keyOf(type)]: current.includes(id) ? current.filter(value => value !== id) : [...current, id] })
}
function outside(event) { if (!menu.value?.contains(event.target) && menu.value) menu.value.open = false }
onMounted(() => document.addEventListener('pointerdown', outside))
onBeforeUnmount(() => document.removeEventListener('pointerdown', outside))
</script>

<template>
  <details ref="menu" class="x-status" @keydown.esc.stop="menu.open = false">
    <summary :aria-disabled="disabled" @click="disabled && $event.preventDefault()">{{ types.length ? types.map(label).join('、') : '无状态' }}<span aria-hidden="true">⌄</span></summary>
    <div class="x-status__menu">
      <button type="button" :disabled="disabled" @click="emit('patch', { xPostTypes: [], xRepostByCharacterIds: [], xLikeByCharacterIds: [] })"><span>{{ types.length ? '' : '✓' }}</span>无状态</button>
      <details v-for="type in ['repost', 'like']" :key="type" class="x-status__branch">
        <summary><label @click.stop><input type="checkbox" :checked="types.includes(type)" :disabled="disabled" @change="toggleType(type)" />{{ label(type) }}</label><span aria-hidden="true">›</span></summary>
        <div class="x-status__people">
          <p>{{ label(type) }}人（可多选）</p>
          <label v-for="person in characters" :key="person.id"><input type="checkbox" :checked="actors(type).includes(person.id)" :disabled="disabled" @change="toggleActor(type, person.id)" />{{ person.name }}</label>
          <p v-if="!characters.length">暂无人物</p>
        </div>
      </details>
    </div>
  </details>
</template>

<style scoped>
.x-status{position:relative;font:400 14px/1.5 var(--font-sans);color:var(--c-text)}
summary{display:flex;align-items:center;justify-content:space-between;gap:14px;cursor:pointer;list-style:none;padding:4px 0;min-height:32px;box-sizing:border-box}
summary::-webkit-details-marker{display:none}
summary[aria-disabled=true]{opacity:.45;cursor:default}
.x-status__menu{position:absolute;right:0;top:100%;z-index:20;width:220px;padding:6px;background:var(--c-white);border:1px solid var(--c-border);border-radius:7px;box-shadow:0 6px 22px #00000014}
.x-status__menu button{display:flex;align-items:center;gap:8px;width:100%;border:0;background:none;color:inherit;font:inherit;text-align:left;padding:7px 10px;border-radius:4px;cursor:pointer}
.x-status__menu button>span{width:14px}
.x-status__branch>summary{padding:7px 10px;border-radius:4px}
.x-status__branch>summary:hover,.x-status__menu button:hover{background:var(--c-bg-sunken)}
label{display:flex;align-items:center;gap:8px;cursor:pointer}
input{width:14px;height:14px;margin:0;accent-color:var(--c-text)}
.x-status__people{margin:0 6px 6px 16px;padding:4px 8px;border-left:1px solid var(--c-border);max-height:220px;overflow:auto}
.x-status__people label{padding:6px 0}
.x-status__people p{margin:4px 0;color:var(--c-text-3);font-size:12px}
</style>
