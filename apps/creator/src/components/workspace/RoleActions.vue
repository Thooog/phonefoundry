<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import AppButton from '../ui/AppButton.vue'
defineProps({
  character: { type: Object, required: true },
  account: { type: Object, default: null },
  ownerId: { type: String, default: null },
  projectId: { type: String, required: true },
  disabled: { type: Boolean, default: false },
})
defineEmits(['remove-character', 'remove-account'])
const menu = ref(null)
function close(restoreFocus = true) {
  menu.value.open = false
  if (restoreFocus) menu.value.querySelector('summary').focus()
}
function outside(event) { if (menu.value?.open && !menu.value.contains(event.target)) close(false) }
onMounted(() => document.addEventListener('pointerdown', outside, true))
onBeforeUnmount(() => document.removeEventListener('pointerdown', outside, true))
</script>

<template>
  <details ref="menu" class="role-menu" @keydown.esc.prevent.stop="close()">
    <summary aria-label="人物与账号操作"><svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="4" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="20" cy="12" r="1.5" /></svg></summary>
    <div @click="$event.target.closest('button,a') && close(false)">
      <AppButton variant="danger" :disabled="disabled || character.id === ownerId" :data-testid="'remove-character-' + character.id" @click="$emit('remove-character', character)">删除人物</AppButton>
      <AppButton v-if="account" variant="danger" :disabled="disabled" :data-testid="'remove-account-' + account.id" @click="$emit('remove-account', account)">删除当前账号</AppButton>
      <RouterLink :to="{ name: 'settings', params: { projectId } }">设置手机所属人</RouterLink>
    </div>
  </details>
</template>

<style scoped>
.role-menu{position:relative;align-self:start}
.role-menu>summary{list-style:none;text-align:center;border:1px solid var(--c-border);border-radius:9px;padding:4px;cursor:pointer;font-size:20px;min-height:36px}
.role-menu>summary::-webkit-details-marker{display:none}
.role-menu>div{position:absolute;right:0;top:44px;z-index:3;display:grid;gap:8px;padding:12px;border:1px solid var(--c-border);border-radius:12px;background:white;box-shadow:var(--shadow-md);min-width:180px}
.role-menu a{font-size:13px;padding:8px}
@media(max-width:767px){.role-menu{width:44px}.role-menu>summary{min-height:44px}.role-menu>div{top:50px}.role-menu a{min-height:44px;display:flex;align-items:center}}
</style>
