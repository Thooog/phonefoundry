<script setup>
import { computed } from 'vue'
const props = defineProps({ text: { type: String, default: '' }, interactive: { type: Boolean, default: true }, accounts: { type: Array, default: () => [] } })
const emit = defineEmits(['search', 'open-account'])

/**
 * 一次切出链接、hashtag、@ 三种片段。
 *
 * 链接必须排在备选分支最前面：`https://a.com/#tag` 里的 `#tag` 属于 URL，
 * 先匹配 `#` 会把它拆成"链接 + hashtag"两半。
 *
 * 字符集只收 ASCII 的 URL 安全字符：中文正文里链接后面常常直接跟标点或汉字
 * （`https://a.com/b，还有…`），若用 `\S+` 会把「，还有…」一起吞进 href。
 */
const URL_BODY = "[A-Za-z0-9\\-._~:/?#\\[\\]@!$&'()*+,;=%]"
const TOKEN_RE = new RegExp(`(https?://${URL_BODY}+|www\\.${URL_BODY}+|[#@][^\\s#@]+)`, 'u')
/** 链接末尾的标点是句子的一部分，不该跟着进 URL（真机 X 也是这么处理的） */
const TRAILING_PUNCT = /[.,;:!?，。；：！？、)\]】》」』"'“”‘’]+$/u

const tokens = computed(() => {
  const out = []
  for (const raw of props.text.split(TOKEN_RE)) {
    if (!raw) continue
    const isUrl = /^(?:https?:\/\/|www\.)/i.test(raw)
    if (!isUrl) {
      out.push({ kind: 'text', text: raw })
      continue
    }
    const tail = raw.match(TRAILING_PUNCT)?.[0] ?? ''
    const url = tail ? raw.slice(0, -tail.length) : raw
    out.push({ kind: 'url', text: url, href: /^www\./i.test(url) ? `https://${url}` : url })
    if (tail) out.push({ kind: 'text', text: tail })
  }
  return out
})

const isHashtag = (part) => part.startsWith('#') && part.length > 1
const isMention = (part) => part.startsWith('@') && part.length > 1
const accountFor = (part) => props.accounts.find((account) => account.handle?.replace(/^@/, '').toLowerCase() === part.slice(1).toLowerCase())
const isBoundMention = (part) => isMention(part) && props.accounts.some((account) => account.characterId && account.handle?.replace(/^@/, '').toLowerCase() === part.slice(1).toLowerCase())
</script>
<template><template v-for="(part, index) in tokens" :key="index"><a v-if="part.kind === 'url'" class="x-link" :href="part.href" target="_blank" rel="noopener noreferrer" @click.stop>{{ part.text }}</a><a v-else-if="isHashtag(part.text) && interactive" class="x-hashtag" href="#" @click.prevent.stop="emit('search',part.text)">{{ part.text }}</a><a v-else-if="isBoundMention(part.text) && interactive" class="x-hashtag" href="#" @click.prevent.stop="emit('open-account',accountFor(part.text).characterId)">{{ part.text }}</a><span v-else-if="isHashtag(part.text) || isMention(part.text)" class="x-hashtag">{{ part.text }}</span><template v-else>{{ part.text }}</template></template></template>
<style>.x-hashtag,.x-link{color:var(--hashtag-color,#1d9bf0);text-decoration:none}.x-hashtag:focus-visible,.x-link:focus-visible{outline:2px solid currentColor;outline-offset:2px}</style>
