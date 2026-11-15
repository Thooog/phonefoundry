<script setup>
import { computed } from 'vue'
const props = defineProps({ text: { type: String, default: '' }, interactive: { type: Boolean, default: true }, accounts: { type: Array, default: () => [] } })
const emit = defineEmits(['search', 'open-account'])
const parts = computed(() => props.text.split(/([#@][^\s#@]+)/u).filter(Boolean))
const isHashtag = (part) => part.startsWith('#') && part.length > 1
const isMention = (part) => part.startsWith('@') && part.length > 1
const accountFor = (part) => props.accounts.find((account) => account.handle?.replace(/^@/, '').toLowerCase() === part.slice(1).toLowerCase())
const isBoundMention = (part) => isMention(part) && props.accounts.some((account) => account.characterId && account.handle?.replace(/^@/, '').toLowerCase() === part.slice(1).toLowerCase())
</script>
<template><template v-for="(part,index) in parts" :key="index"><a v-if="isHashtag(part) && interactive" class="x-hashtag" href="#" @click.prevent.stop="emit('search',part)">{{ part }}</a><a v-else-if="isBoundMention(part) && interactive" class="x-hashtag" href="#" @click.prevent.stop="emit('open-account',accountFor(part).characterId)">{{ part }}</a><span v-else-if="isHashtag(part) || isMention(part)" class="x-hashtag">{{ part }}</span><template v-else>{{ part }}</template></template></template>
<style>.x-hashtag{color:var(--hashtag-color,#1d9bf0);text-decoration:none}.x-hashtag:focus-visible{outline:2px solid currentColor;outline-offset:2px}</style>
