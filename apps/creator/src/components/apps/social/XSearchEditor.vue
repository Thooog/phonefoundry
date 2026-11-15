<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { buildXTrends, xSearchAccounts } from '@phone-sim/shared'
import { useProjectStore } from '../../../stores/project.js'
import { useUiStore } from '../../../stores/ui.js'
import { useAssetUrls } from '../../../composables/use-asset-urls.js'
import { addXSearchRow, updateXSearchRow, removeXSearchRow, moveXSearchRow, xSearchRows } from '../../../editing/x-search.js'
import XSearchFields from './XSearchFields.vue'
import AppButton from '../../ui/AppButton.vue'

const props = defineProps({ kind: { type: String, required: true }, platform: { type: String, default: 'x' } })
const editor = useProjectStore(), ui = useUiStore()
const readOnly = computed(() => Boolean(editor.readOnlyReason))
const rows = computed(() => xSearchRows(editor.project, props.kind, props.platform))
const trends = computed(() => buildXTrends(editor.project))
const accounts = computed(() => xSearchAccounts({ ...editor.project, platformAccounts: editor.project?.platformAccounts?.filter(a => a.platform === props.platform).map(a => ({ ...a, platform: 'x' })) }))
const query = ref(''), selectedId = ref(null), narrow = ref(false), dialog = ref(null), list = ref(null), dragFrom = ref(null), dropIndex = ref(null), announcement = ref('')
const selected = computed(() => rows.value.find(row => row.id === selectedId.value))
const selectedIndex = computed(() => rows.value.findIndex(row => row.id === selectedId.value))
const { urls } = useAssetUrls(editor, () => accounts.value.map(row => row.avatarAssetId))
const avatarOf = row => urls.value.get(accounts.value.find(account => account.accountId === row.accountId)?.avatarAssetId) || ''
function titleOf(row) { return props.kind === 'trends' || row.type !== 'account' ? row.title || (props.kind === 'trends' ? '新趋势' : '新搜索词') : accounts.value.find(account => account.accountId === row.accountId)?.name || '未选择人物账号' }
function summaryOf(row) {
  if (props.kind === 'trends') { const trend = trends.value.find(item => item.id === row.id); return [trend?.category, trend?.countLabel].filter(Boolean).join(' · ') || '未设置分类与帖子数' }
  const account = accounts.value.find(item => item.accountId === row.accountId)
  return row.type === 'account' ? account?.handle ? '@' + account.handle : '人物账号' : '关键词'
}
const visible = computed(() => rows.value.filter(row => `${titleOf(row)} ${summaryOf(row)}`.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())))
const fieldProps = computed(() => ({ record: selected.value, kind: props.kind, first: rows.value[0] || {}, accounts: accounts.value, avatarUrl: selected.value ? avatarOf(selected.value) : '', index: selectedIndex.value, total: rows.value.length, readOnly: readOnly.value }))
watch(rows, value => { if (!value.some(row => row.id === selectedId.value)) selectedId.value = value[0]?.id ?? null; if (!value.length) dialog.value?.close() }, { immediate: true })
watch(() => props.kind, () => { cancelDrag(); dialog.value?.close(); query.value = ''; selectedId.value = rows.value[0]?.id ?? null })
function patch(value) { if (selected.value) updateXSearchRow(editor, props.kind, selectedId.value, value, props.platform) }
async function choose(row) { if (Date.now() < suppressUntil) return; selectedId.value = row.id; await nextTick(); if (narrow.value && !dialog.value.open) dialog.value.showModal() }
async function add() { if (readOnly.value) return; const row = addXSearchRow(editor, props.kind, props.platform); if (!row) return; query.value = ''; await choose(row); await nextTick(); (narrow.value ? dialog.value : list.value?.parentElement?.nextElementSibling)?.querySelector('input')?.focus() }
async function remove() {
  if (readOnly.value || !selected.value) return
  const id = selectedId.value
  if (await ui.confirm({ title: props.kind === 'trends' ? '删除这条趋势？' : '删除这条搜索记录？', message: '这个操作无法撤销。', confirmText: '删除', tone: 'danger' })) removeXSearchRow(editor, props.kind, id, props.platform)
}
function move(row, target) { if (readOnly.value) return; if (moveXSearchRow(editor, props.kind, row.id, target, props.platform)) announcement.value = `${titleOf(row)}已移到第 ${target + 1} 条` }
function closeDrawer() { nextTick(() => list.value?.querySelector(`[data-row-id="${selectedId.value}"] .xse__choose`)?.focus({ preventScroll: true })) }
function backdrop(event) { if (event.target !== dialog.value) return; const rect = dialog.value.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.value.close() }
defineExpose({ add })

let media, press = null, frame = 0, suppressUntil = 0
function setNarrow() { narrow.value = media.matches; dialog.value?.close() }
function cancelDrag() { if (press) clearTimeout(press.timer); cancelAnimationFrame(frame); press = null; dragFrom.value = null; dropIndex.value = null }
function start(event, row, touch = false) {
  if (readOnly.value || press || (!touch && (event.pointerType === 'touch' || event.button !== 0))) return
  if (touch && event.touches.length !== 1) return
  const point = touch ? event.touches[0] : event
  press = { row, x: point.clientX, y: point.clientY, lastY: point.clientY, touch, active: false }
  press.timer = setTimeout(() => { if (!press) return; press.active = true; dragFrom.value = row.id; announcement.value = '已抓取条目，上下拖动，松开完成排序'; autoScroll() }, 450)
}
function targetAt(y) {
  const nodes = [...(list.value?.querySelectorAll('[data-row-id]') ?? [])]
  let target, distance = Infinity
  for (const node of nodes) { const rect = node.getBoundingClientRect(); const next = Math.abs(y - rect.top - rect.height / 2); if (next < distance) { distance = next; target = node } }
  dropIndex.value = target ? rows.value.findIndex(row => row.id === target.dataset.rowId) : null
}
function autoScroll() {
  if (!press?.active) return
  const scroller = list.value.scrollHeight > list.value.clientHeight ? list.value : list.value.closest('.ws__main')
  if (scroller) { const rect = scroller.getBoundingClientRect(); const speed = press.lastY < rect.top + 65 ? -8 : press.lastY > rect.bottom - 65 ? 8 : 0; if (speed) { scroller.scrollTop += speed; targetAt(press.lastY) } }
  frame = requestAnimationFrame(autoScroll)
}
function dragging(event) {
  if (!press || (event.type.startsWith('touch') !== press.touch)) return
  const point = press.touch ? event.touches[0] : event
  if (!point) return
  if (!press.active) { if (Math.hypot(point.clientX - press.x, point.clientY - press.y) > 8) cancelDrag(); return }
  if (event.cancelable) event.preventDefault()
  press.lastY = point.clientY; targetAt(point.clientY)
}
function drop(event) {
  if (!press || (event.type.startsWith('touch') !== press.touch)) return
  const { row, active } = press, target = dropIndex.value
  cancelDrag()
  if (active) { suppressUntil = Date.now() + 500; if (target !== null) move(row, target) }
}
function escape(event) { if (event.key === 'Escape') cancelDrag() }
onMounted(() => {
  media = matchMedia('(max-width:767px)'); setNarrow(); media.addEventListener('change', setNarrow)
  window.addEventListener('pointermove', dragging, { passive: false }); window.addEventListener('touchmove', dragging, { passive: false })
  window.addEventListener('pointerup', drop); window.addEventListener('touchend', drop)
  window.addEventListener('touchcancel', cancelDrag); window.addEventListener('pointercancel', cancelDrag); window.addEventListener('blur', cancelDrag); window.addEventListener('keydown', escape)
})
onBeforeUnmount(() => {
  cancelDrag(); dialog.value?.close(); media?.removeEventListener('change', setNarrow)
  window.removeEventListener('pointermove', dragging); window.removeEventListener('touchmove', dragging); window.removeEventListener('pointerup', drop); window.removeEventListener('touchend', drop); window.removeEventListener('touchcancel', cancelDrag); window.removeEventListener('pointercancel', cancelDrag); window.removeEventListener('blur', cancelDrag); window.removeEventListener('keydown', escape)
})
</script>

<template>
  <div class="xse" :data-testid="'x-' + kind + '-editor'">
    <div v-if="!rows.length" class="xse__empty-state"><p>{{ kind === 'trends' ? '还没有趋势。' : '还没有搜索记录。' }}</p><p>点击右上方的「{{ kind === 'trends' ? '新建趋势' : '添加搜索记录' }}」开始添加。</p></div>
    <template v-else>
      <aside class="xse__index">
        <label class="xse__search"><span class="sr-only">{{ kind === 'trends' ? '查找趋势' : '查找搜索记录' }}</span><input v-model="query" type="search" :placeholder="kind === 'trends' ? '查找趋势' : '查找搜索记录'" /></label>
        <div ref="list" class="xse__list" @contextmenu.prevent>
          <div v-for="row in visible" :key="row.id" class="xse__row" :class="{ 'is-selected': row.id === selectedId, 'is-dragging': dragFrom === row.id, 'drop-before': dragFrom && dropIndex === rows.indexOf(row) && dropIndex < rows.findIndex(item => item.id === dragFrom), 'drop-after': dragFrom && dropIndex === rows.indexOf(row) && dropIndex > rows.findIndex(item => item.id === dragFrom) }" :data-row-id="row.id">
            <button class="xse__choose" type="button" :aria-pressed="row.id === selectedId" :aria-label="'编辑' + titleOf(row)" title="点击编辑，长按拖动排序" @click="choose(row)" @pointerdown="start($event, row)" @touchstart.passive="start($event, row, true)"><span class="xse__cover"><img v-if="kind !== 'trends' && row.type === 'account' && avatarOf(row)" :src="avatarOf(row)" alt="" /><span v-else-if="kind === 'trends'">{{ rows.indexOf(row) + 1 }}</span><span v-else-if="row.type === 'account'">{{ titleOf(row)[0] }}</span><svg v-else viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="7" /><path d="m15 15 6 6" /></svg></span><span class="xse__copy"><strong>{{ titleOf(row) }}</strong><small>{{ summaryOf(row) }}</small></span></button>
            <div class="xse__arrows"><button v-for="direction in [-1, 1]" :key="direction" type="button" :aria-label="(direction === -1 ? '上移' : '下移') + titleOf(row)" :title="direction === -1 ? '上移' : '下移'" :disabled="readOnly || rows.indexOf(row) + direction < 0 || rows.indexOf(row) + direction >= rows.length" @click="move(row, rows.indexOf(row) + direction)"><svg viewBox="0 0 24 24" aria-hidden="true"><path :d="direction === -1 ? 'M12 19V5m-6 6 6-6 6 6' : 'M12 5v14m-6-6 6 6 6-6'" /></svg></button></div>
          </div><p v-if="!visible.length" class="xse__empty">{{ rows.length ? '没有匹配的内容。' : '还没有内容，点击右上角添加第一条。' }}</p>
        </div>
      </aside>
      <section class="xse__detail"><XSearchFields v-if="selected && !narrow" v-bind="fieldProps" @patch="patch" @remove="remove" @move="move(selected, selectedIndex + $event)" /><p class="xse__tip xse__tip--footer">{{ kind === 'trends' ? '列表顺序即作品端展示顺序 · 长按条目拖动' : '第一条为最近搜索 · 长按条目拖动' }}</p></section>
      <dialog ref="dialog" class="xse__drawer" aria-label="编辑搜索内容" @close="closeDrawer" @click="backdrop"><header><span>编辑内容</span><AppButton @click="dialog.close()">完成</AppButton></header><XSearchFields v-if="selected && narrow" v-bind="fieldProps" @patch="patch" @remove="remove" @move="move(selected, selectedIndex + $event)" /></dialog>
      <span class="sr-only" role="status">{{ announcement }}</span>
    </template>
  </div>
</template>

<style scoped>
.xse{display:grid;grid-template-columns:300px minmax(0,1fr);min-height:0;flex:1;font-family:var(--font-sans)}.xse__empty-state{grid-column:1/-1;min-height:320px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;text-align:center;color:var(--c-text-3);font-size:14px;line-height:1.8}.xse__empty-state p{margin:0}.xse__index{min-width:0;padding-right:24px;border-right:1px solid var(--c-border);display:flex;flex-direction:column;min-height:0}.xse__search input{width:100%;min-height:40px;border:1px solid var(--c-border-strong);border-radius:7px;padding:8px 12px;font:400 13px/1.5 var(--font-sans);background:white;color:var(--c-text)}.xse__tip{font-size:12px;line-height:1.8;color:var(--c-text-3);margin:16px 4px 12px}.xse__list{overflow-y:auto;min-height:0;scrollbar-width:none;padding:4px 0}.xse__list::-webkit-scrollbar{display:none}.xse__row{position:relative;display:flex;align-items:center;gap:4px;min-height:82px;border-radius:8px;margin-bottom:6px;padding:8px}.xse__row.is-selected,.xse__row:hover{background:color-mix(in srgb,var(--c-detail) 4%,var(--c-white))}.xse__choose{display:flex;align-items:center;gap:12px;flex:1;min-width:0;border:0;background:none;padding:8px 0;text-align:left;min-height:64px;color:var(--c-text);user-select:none;-webkit-touch-callout:none}.xse__cover{display:grid;place-items:center;width:24px;flex:none;font-size:13px;color:var(--c-text-3);overflow:hidden}.xse__cover img{width:100%;height:100%;object-fit:cover}.xse__cover svg{width:19px;height:19px;fill:none;stroke:currentColor;stroke-width:1.6}.xse__copy{flex:1;min-width:0}.xse__copy strong,.xse__copy small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.xse__copy strong{font:600 16px/1.5 var(--font-sans);margin-bottom:5px}.xse__copy small{font:400 12px/1.6 var(--font-sans);color:var(--c-text-3)}.xse__arrows{display:flex;flex-direction:column;gap:2px;flex:none}.xse__arrows button{display:grid;place-items:center;border:0;background:none;width:32px;min-height:30px;color:var(--c-text-3);padding:4px;border-radius:4px}.xse__arrows button:hover:not(:disabled){background:var(--c-bg-sunken)}.xse__arrows svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}.xse__arrows button:disabled{opacity:.3;cursor:default}.xse__detail{min-width:0;padding:2px 32px;overflow-y:auto;scrollbar-width:thin}.xse__empty{font-size:13px;line-height:1.8;color:var(--c-text-3);padding:12px}.xse__row.is-dragging{background:var(--c-selected);outline:1px solid var(--c-border-strong);box-shadow:0 5px 18px #20232120;cursor:grabbing}.drop-before:before,.drop-after:after{content:'';position:absolute;left:8px;right:8px;height:2px;background:var(--c-text-2);border-radius:2px}.drop-before:before{top:-4px}.drop-after:after{bottom:-4px}.xse__drawer{background:white;color:var(--c-text);border:1px solid var(--c-border);border-radius:20px;padding:0;width:min(560px,calc(100% - 24px));max-height:88dvh;margin:auto auto 12px;inset:auto 0 0;overflow:auto;overscroll-behavior:contain;scrollbar-width:none;box-shadow:var(--shadow-lg)}.xse__drawer::-webkit-scrollbar{display:none}.xse__drawer::backdrop{background:#20232159}.xse__drawer>header{position:sticky;top:0;z-index:1;display:flex;align-items:center;justify-content:space-between;padding:14px 20px;background:white;border-bottom:1px solid var(--c-border);font-size:13px;color:var(--c-text-3)}.xse__drawer>:deep(.xsf){padding:24px 20px 28px}.xse__drawer>header :deep(.ui-btn){min-height:40px;font-size:13px}
@media(min-width:768px) and (max-width:1100px){.xse{grid-template-columns:260px minmax(0,1fr)}.xse__detail{padding-right:0;padding-left:24px}}
@media(max-width:767px){.xse{display:block}.xse__index{border:0;padding:0}.xse__detail{display:none}.xse__search input{min-height:38px;font-size:16px}.xse__tip{margin:12px 4px}.xse__list{overflow:visible}.xse__row{min-height:88px;padding:8px;gap:8px}.xse__choose{min-height:72px;gap:14px}.xse__cover{width:54px;height:58px;border-radius:4px;background:var(--c-bg-sunken);font-size:20px}.xse__arrows{gap:0}.xse__arrows button{width:44px;min-height:44px}.xse__arrows svg{width:18px;height:18px}}
.xse__tip--footer{flex:none;margin-top:16px}
@media(max-width:767px){.xse__tip--footer{margin:12px 4px 0;padding-top:12px}}
</style>
