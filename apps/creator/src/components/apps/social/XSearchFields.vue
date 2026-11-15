<script setup>
import { computed } from 'vue'
import { formatXTrendCount } from '@phone-sim/shared'
import AppButton from '../../ui/AppButton.vue'
import DeleteIconButton from '../../ui/DeleteIconButton.vue'
const props = defineProps({ record: { type: Object, required: true }, kind: { type: String, required: true }, first: { type: Object, default: () => ({}) }, accounts: { type: Array, default: () => [] }, avatarUrl: { type: String, default: '' }, index: { type: Number, default: 0 }, total: { type: Number, default: 0 }, readOnly: Boolean })
const emit = defineEmits(['patch', 'remove', 'move'])
const trend = computed(() => props.kind === 'trends')
const account = computed(() => props.accounts.find(row => row.accountId === props.record.accountId))
function patch(key, value) { emit('patch', { [key]: value }) }
function count(event) {
  const input = event.target
  input.setCustomValidity('')
  if (!input.validity.valid) return
  const value = input.value === '' ? null : Number(input.value)
  if (value !== null && (!Number.isSafeInteger(value) || value < 0)) { input.setCustomValidity('请输入有效的非负整数'); return }
  patch('postCount', value)
}
function placeholder(key) { return props.index === 0 ? '选填，留空则不显示' : `跟随第一条${props.first[key] ? '：' + props.first[key] : '（未设置）'}` }
</script>

<template>
  <div class="xsf">
    <header class="xsf__head"><div><p>{{ trend ? '趋势内容' : '搜索记录' }}</p><h2>{{ trend ? '编辑趋势' : '编辑搜索记录' }}</h2></div><DeleteIconButton :label="trend ? '删除趋势' : '删除搜索记录'" :disabled="readOnly" @click="emit('remove')" /></header>
    <template v-if="trend">
      <label class="xsf__field"><span>话题名称</span><input class="xsf__title" :value="record.title" maxlength="200" :disabled="readOnly" data-testid="x-trend-title" @input="patch('title', $event.target.value)" /></label>
      <div class="xsf__pair"><label v-for="key in ['category', 'region']" :key="key" class="xsf__field"><span>{{ key === 'category' ? '分类' : '地区' }}（选填）</span><input :value="record[key]" maxlength="80" :placeholder="placeholder(key)" :disabled="readOnly" :data-testid="'x-trend-' + key" @input="patch(key, $event.target.value)" /></label></div>
      <p class="xsf__inherit">{{ index === 0 ? '第一条的分类、地区作为默认值；其他条目未单独填写时跟随这里。' : '分类、地区留空时跟随当前第一条；单独填写后使用本条设置。' }}</p>
      <label class="xsf__field"><span>帖子数（选填）</span><input type="number" min="0" step="1" inputmode="numeric" :value="record.postCount ?? ''" placeholder="例如：12000" :disabled="readOnly" data-testid="x-trend-count" @input="count" @change="$event.target.reportValidity()" /><small>{{ formatXTrendCount(record.postCount) ? '显示为：' + formatXTrendCount(record.postCount) : '留空时不显示帖子数。' }}</small></label>
    </template>
    <template v-else>
      <div class="xsf__field"><span>记录类型</span><div class="xsf__types"><button v-for="type in ['keyword', 'account']" :key="type" type="button" :aria-pressed="record.type === type" :disabled="readOnly" @click="emit('patch', { type, ...(type === 'account' && !record.accountId ? { accountId: accounts[0]?.accountId ?? null } : {}) })">{{ type === 'keyword' ? '关键词' : '人物账号' }}</button></div></div>
      <label v-if="record.type !== 'account'" class="xsf__field"><span>搜索词</span><input class="xsf__title" :value="record.title" maxlength="200" :disabled="readOnly" data-testid="x-history-title" @input="patch('title', $event.target.value)" /></label>
      <template v-else>
        <label class="xsf__field"><span>选择 X 账号</span><select :value="record.accountId ?? ''" :disabled="readOnly" data-testid="x-history-account" @change="patch('accountId', $event.target.value || null)"><option value="">选择人物账号</option><option v-for="row in accounts" :key="row.accountId" :value="row.accountId">{{ row.name }}{{ row.handle ? ' @' + row.handle : '' }}</option></select></label>
        <div v-if="account" class="xsf__account"><span class="xsf__avatar"><img v-if="avatarUrl" :src="avatarUrl" alt="" /><span v-else>{{ account.name[0] }}</span></span><div><strong>{{ account.name }}</strong><small v-if="account.handle">@{{ account.handle }}</small></div><small>已关联人物</small></div>
        <p class="xsf__hint">{{ accounts.length ? '头像、昵称与用户名跟随人物中的 X 账号资料。' : '先在人物页面添加 X 账号，再选择关联人物。' }}</p>
      </template>
    </template>
    <section class="xsf__order"><h3>展示顺序</h3><div><span>第 {{ index + 1 }} 条 / 共 {{ total }} 条</span><AppButton :disabled="readOnly || index === 0" @click="emit('move', -1)">↑ 上移</AppButton><AppButton :disabled="readOnly || index === total - 1" @click="emit('move', 1)">↓ 下移</AppButton></div><p>{{ trend ? '点击话题后，按话题名称搜索作品内的帖子。' : '这是故事中手机主人的搜索记录，可用于留下线索。关键词进入对应搜索结果，人物账号打开其个人主页。' }}</p></section>
  </div>
</template>

<style scoped>
.xsf{min-width:0;color:var(--c-text);font:400 13px/1.5 var(--font-sans)}.xsf__head{display:flex;align-items:center;justify-content:space-between;margin-bottom:26px;gap:16px}.xsf__head p{font-size:12px;color:var(--c-text-3);margin:0 0 7px}.xsf__head h2{font:600 20px/1.5 var(--font-story);margin:0}.xsf__field{display:flex;flex-direction:column;gap:10px;margin-bottom:24px}.xsf__field input,.xsf__field select{width:100%;min-width:0;min-height:40px;padding:8px 12px;border:1px solid var(--c-border-strong);border-radius:6px;background:white;color:var(--c-text);font:400 13px/1.5 var(--font-sans)}.xsf__field input:focus,.xsf__field select:focus{outline:none;border-color:var(--c-accent);box-shadow:0 0 0 3px var(--c-accent-weak)}.xsf__field .xsf__title{font-size:18px;min-height:50px}.xsf__field small,.xsf__hint,.xsf__inherit{font-size:12px;line-height:1.8;color:var(--c-text-3)}.xsf__pair{display:grid;grid-template-columns:1fr 1fr;gap:18px}.xsf__inherit{margin:-12px 0 24px}.xsf__types{display:flex;gap:8px}.xsf__types button{flex:1;min-height:40px;border:1px solid var(--c-border-strong);border-radius:6px;background:white;font-size:13px}.xsf__types [aria-pressed=true]{border-color:var(--c-text-2);background:var(--c-accent-weak)}.xsf__account{display:flex;align-items:center;gap:12px;padding:13px;border:1px solid var(--c-border-strong);border-radius:6px}.xsf__account strong,.xsf__account small{display:block}.xsf__account strong{font-size:15px;font-weight:600}.xsf__account small{font-size:12px;color:var(--c-text-3)}.xsf__account>small{margin-left:auto}.xsf__avatar{width:34px;height:34px;background:var(--c-bg-sunken);display:grid;place-items:center;border-radius:50%;overflow:hidden;font-size:16px}.xsf__avatar img{width:100%;height:100%;object-fit:cover}.xsf__hint{margin:12px 0 0}.xsf__order{margin-top:30px;padding-top:0}.xsf__order h3{font:600 13px/1.5 var(--font-sans);margin:0 0 12px}.xsf__order>div{display:flex;align-items:center;gap:10px}.xsf__order>div>span{margin-right:auto;color:var(--c-text-3)}.xsf__order :deep(.ui-btn){font-size:13px;min-height:34px}.xsf__order p{font-size:12px;line-height:1.9;color:var(--c-text-3);margin:20px 0 0}.xsf input:disabled,.xsf select:disabled,.xsf button:disabled{opacity:.45}.xsf input::placeholder{color:var(--c-text-3)}
@media(max-width:767px){.xsf__field input,.xsf__field select{min-height:44px;font-size:14px}.xsf__field .xsf__title{font-size:14px}.xsf__pair{gap:14px}}
</style>
