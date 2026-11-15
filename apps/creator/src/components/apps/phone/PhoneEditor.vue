<script setup>

import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import { dayRelation, formatClock } from '@phone-sim/shared'
import AppButton from '../../ui/AppButton.vue'
import DeleteIconButton from '../../ui/DeleteIconButton.vue'
import CallIcon from './CallIcon.vue'
import { useAssetUrls } from '../../../composables/use-asset-urls.js'
import { useProjectStore } from '../../../stores/project.js'
import { useUiStore } from '../../../stores/ui.js'
import { fromDateTimeLocal, toDateTimeLocal } from '../../../utils/time.js'
import {
  CALL_TYPES,
  CONTACT_NAME_MAX_LENGTH,
  CONTACT_NOTE_MAX_LENGTH,
  PHONE_NUMBER_MAX_LENGTH,
  addCall,
  addContact,
  countCallsOfContact,
  deleteCall,
  deleteContact,
  selectableContacts,
  sortCallsByTime,
  sortContactsByName,
  updateCall,
  updateContact,
} from '../../../editing/phone.js'

const editor = useProjectStore()
const ui = useUiStore()

const readOnly = computed(() => Boolean(editor.readOnlyReason))
const project = computed(() => editor.project)

const contacts = computed(() => sortContactsByName(project.value?.appData?.phone?.contacts ?? []))
const calls = computed(() => sortCallsByTime(project.value?.appData?.phone?.calls ?? []))

/** 通话记录的联系人下拉：显式录入的 + 由角色 phone 账号派生出来的 */
const contactOptions = computed(() => selectableContacts(project.value))

const characters = computed(() =>
  [...(project.value?.characters ?? [])].sort((a, b) =>
    String(a.name ?? '').localeCompare(String(b.name ?? ''), 'zh-Hans-CN'),
  ),
)

/** 归属下拉里"不挂在任何人身上"的那一项 */
const STRANGER_OPTION = '不在通讯录（陌生号码）'

const phoneRoot = ref(null)
function closeMenus(event) {
  phoneRoot.value?.querySelectorAll('details[open]').forEach(menu => {
    if (event.key === 'Escape' || !menu.contains(event.target)) menu.open = false
  })
}
onMounted(() => {
  document.addEventListener('pointerdown', closeMenus)
  document.addEventListener('keydown', closeMenus)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', closeMenus)
  document.removeEventListener('keydown', closeMenus)
})
function callDayKey(call) { return toDateTimeLocal(call.displayTime).slice(0, 10) }
function callDay(call) {
  const date = new Date(call.displayTime)
  return Number.isNaN(date.getTime()) ? '未设置日期' : `${date.getMonth() + 1}月${date.getDate()}日`
}

/* ── 联系人 ─────────────────────────────────── */

function createContact() {
  if (readOnly.value) return
  addContact(editor, { name: '新联系人' })
}

function commitContact(contact, field, event) {
  const value = event.target.value
  updateContact(editor, contact.id, { [field]: value })
}

function commitContactCharacter(contact, event) {
  const value = event.target.value || null
  updateContact(editor, contact.id, { characterId: value })
}

async function removeContact(contact, afterDelete) {
  if (readOnly.value) return

  const callCount = countCallsOfContact(project.value, contact.id)
  const ok = await ui.confirm({
    title: `删掉联系人「${contact.name || '无姓名'}」？`,
    message: callCount
      ? `他名下还有 ${callCount} 条通话记录，会一起删掉。这个操作无法撤销。`
      : '这个操作无法撤销。',
    confirmText: '删除',
    tone: 'danger',
  })
  if (!ok) return

  const result = deleteContact(editor, contact.id)
  await nextTick()
  await afterDelete?.()
  ui.toast(
    result.removedCalls
      ? `已删除联系人与 ${result.removedCalls} 条通话记录`
      : '已删除联系人',
  )
}

/* ── 通话记录 ───────────────────────────────── */

function createCall() {
  if (readOnly.value) return
  // 有联系人就默认挂第一个（大多数通话是熟人），没有就留空走陌生号码。
  // 注意这里**不是**强制：下拉第一项随时能切回"不在通讯录"。
  addCall(editor, { contactId: contactOptions.value[0]?.id ?? null })
}

function commitCallContact(call, event) {
  updateCall(editor, call.id, { contactId: event.target.value || null })
}

function commitCallNumber(call, event) {
  updateCall(editor, call.id, { phoneNumber: event.target.value })
}

function commitCallType(call, event) {
  updateCall(editor, call.id, { type: event.target.value })
}

function commitCallTime(call, event) {
  const iso = fromDateTimeLocal(event.target.value)
  if (!iso) return
  updateCall(editor, call.id, { displayTime: iso })
}

/**
 * 时长拆成分 + 秒两个输入。
 * 只给一个"秒"输入的话，用户要算 5 分 20 秒 = 320 秒 —— 没人愿意算。
 */
function commitDuration(call, event) {
  const value = Math.max(0, Math.round(Number(event.target.value) || 0))
  const current = splitDuration(call.durationSec)
  const next = event.target.dataset.unit === 'min' ? { min: value, sec: current.sec } : { min: current.min, sec: value }
  updateCall(editor, call.id, { durationSec: next.min * 60 + next.sec })
}

function splitDuration(sec) {
  const total = Math.max(0, Math.round(Number(sec) || 0))
  return { min: Math.floor(total / 60), sec: total % 60 }
}

async function removeCall(call, afterDelete) {
  if (readOnly.value) return
  const ok = await ui.confirm({ title: '删掉这条通话记录？', message: '这个操作无法撤销。', confirmText: '删除', tone: 'danger' })
  if (!ok) return
  deleteCall(editor, call.id)
  await nextTick()
  await afterDelete?.()
  ui.toast('已删除通话记录')
}

/** 联系人 id → 显示名，用于判断下拉值是否还有效 */
function contactNameOf(contactId) {
  return contactOptions.value.find((c) => c.id === contactId)?.name ?? ''
}

/**
 * 号码框里显示什么。
 *   · 挂了联系人 → 那个联系人的号码（只读：作品里显示的就是它）
 *   · 陌生号码   → 用户自己填的号码
 */
function numberShown(call) {
  if (call.contactId) {
    return contactOptions.value.find((c) => c.id === call.contactId)?.phoneNumber ?? ''
  }
  return call.phoneNumber ?? ''
}

const { selectedRecordId: selectedContactId, visibleRecords: visibleContactRecords } = useRecordSelection(contacts)
const {urls:contactAvatars}=useAssetUrls(editor,()=>characters.value.map(c=>c.avatarAssetId))
function contactAvatar(contact){return contactAvatars.value.get(characters.value.find(c=>c.id===contact.characterId)?.avatarAssetId)}
const contactsItems = computed(() => contacts.value.map(record => ({ id: record.id, title: record.name, subtitle: record.phoneNumber, avatar:contactAvatar(record), initial:record.name?.[0] })))

import RecordWorkspace from '../../workspace/RecordWorkspace.vue'
import { useRecordSelection } from '../../../composables/use-record-selection.js'

const { selectedRecordId: selectedCallId, visibleRecords: visibleCallRecords } = useRecordSelection(calls)
const { urls: callAvatars } = useAssetUrls(editor, () => contactOptions.value.map(c => c.avatarAssetId))
function callContact(call) {
  return contactOptions.value.find(c => c.id === call.contactId)
}
function callAvatar(call) {
  return callAvatars.value.get(callContact(call)?.avatarAssetId)
}
function callTitle(call) {
  return contactNameOf(call.contactId) || numberShown(call) || '陌生号码'
}
function callTypeLabel(type) {
  return CALL_TYPES.find(t => t.value === type)?.label || '通话'
}
function callTimeLabel(call, detail = false) {
  if (!toDateTimeLocal(call.displayTime)) return ''
  const date = new Date(call.displayTime)
  const clock = formatClock(date, 'h24')
  if (detail) return `${date.getMonth() + 1}月${date.getDate()}日 ${clock}`
  const relation = dayRelation(date, project.value?.settings?.storyDate)
  if (relation === 'today') return clock
  if (relation === 'yesterday') return `昨天 ${clock}`
  return `${relation === 'thisYear' ? '' : date.getFullYear() + '/'}${date.getMonth() + 1}/${date.getDate()} ${clock}`
}
const callsItems = computed(() => calls.value.map(call => ({
  id: call.id,
  title: callTitle(call),
  subtitle: callTypeLabel(call.type),
  search: numberShown(call),
  meta: callTimeLabel(call),
  displayTime: call.displayTime,
  type: call.type,
  avatar: callAvatar(call),
  initial: callContact(call)?.name?.[0],
})))
const phoneTab = ref('contacts')
const contactDetailOpen = ref(false)
const callDetailOpen = ref(false)
// A cascade can empty the inactive tab; keep its mobile list reachable.
watch(selectedContactId, id => { if (!id) contactDetailOpen.value = false }, { flush: 'post' })
watch(selectedCallId, id => { if (!id) callDetailOpen.value = false }, { flush: 'post' })
const detailOpen = computed(() => phoneTab.value === 'contacts' ? contactDetailOpen.value : callDetailOpen.value)
function openCall(call) {
  selectedCallId.value = call.id
  callDetailOpen.value = true
  phoneTab.value = 'calls'
}
const route = useRoute()
watch(() => route.query.record, id => {
  const call = calls.value.find(item => item.id === id)
  if (call) openCall(call)
}, { immediate: true })
</script>

<template>
  <section ref="phoneRoot" class="phoned" :data-detail="detailOpen" data-testid="phone-editor">
    <header class="phone-page-head">
      <h1>电话 <small>{{ phoneTab === 'contacts' ? contacts.length + ' 位联系人' : calls.length + ' 条通话记录' }}</small></h1>
      <AppButton v-if="phoneTab === 'contacts'" variant="primary" :disabled="readOnly" data-testid="contact-add" @click="createContact">添加联系人</AppButton>
      <AppButton v-else variant="primary" :disabled="readOnly" data-testid="call-add" @click="createCall">添加通话记录</AppButton>
    </header>
    <nav class="phone-tabs" aria-label="电话内容">
      <button type="button" :aria-pressed="phoneTab === 'contacts'" @click="phoneTab = 'contacts'">联系人</button>
      <button type="button" :aria-pressed="phoneTab === 'calls'" @click="phoneTab = 'calls'">通话记录</button>
    </nav>
    <!-- ── 联系人 ── -->
    <section v-show="phoneTab==='contacts'" class="phoned__block">
      <div v-if="!contacts.length" class="phoned__empty-state">还没有联系人。通话记录可以只填一个陌生号码，不必先建联系人。</div>
      <RecordWorkspace v-else v-model="selectedContactId" v-model:detail-open="contactDetailOpen" :show-heading="false" class="phone-workspace" title="联系人" search-placeholder="查找联系人" heading="电话" :records="contactsItems">
        <template #detail-toolbar="{ back }">
          <div class="phone-detail-toolbar">
            <button type="button" class="record-workspace__back" @click="back"><span class="phone-back-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m14 6-6 6 6 6" /></svg></span><span>联系人</span></button>
            <AppButton v-if="visibleContactRecords[0]" variant="danger" :disabled="readOnly" data-testid="contact-remove-mobile" @click="removeContact(visibleContactRecords[0], back)">删除</AppButton>
          </div>
        </template>
        <template #empty><p class="phone-index-empty">暂无联系人</p></template>
        <ul class="phoned__list" data-testid="contact-list">
          <li
            v-for="contact in visibleContactRecords"
            :key="contact.id"
            class="crow"
            data-testid="contact-row"
          >
            <header class="contact-summary">
              <span class="call-avatar call-avatar--large"><img v-if="contactAvatar(contact)" :src="contactAvatar(contact)" alt="" /><span v-else>{{ contact.name?.[0] || '人' }}</span></span>
              <div class="call-summary-body"><h2>{{ contact.name || '未命名联系人' }}</h2><p>{{ contact.phoneNumber || '尚未填写号码' }}</p></div>
              <DeleteIconButton class="phone-menu" label="删除联系人" :disabled="readOnly" data-testid="contact-remove" @click="removeContact(contact)" />
            </header>
            <label class="phone-field"><span>姓名</span><input
              class="crow__name"
              type="text"
              :value="contact.name"
              :maxlength="CONTACT_NAME_MAX_LENGTH"
              :disabled="readOnly"
              aria-label="姓名"
              data-testid="contact-name"
              @change="commitContact(contact, 'name', $event)"
            /></label>
            <label class="phone-field"><span>号码</span><input
              class="crow__number"
              type="tel"
              :value="contact.phoneNumber"
              :maxlength="PHONE_NUMBER_MAX_LENGTH"
              :disabled="readOnly"
              placeholder="号码"
              aria-label="号码"
              data-testid="contact-number"
              @change="commitContact(contact, 'phoneNumber', $event)"
            /></label>
            <label class="phone-field phone-field--wide"><span>关联角色</span><select
              class="crow__select"
              :value="contact.characterId ?? ''"
              :disabled="readOnly"
              aria-label="关联角色"
              data-testid="contact-character"
              @change="commitContactCharacter(contact, $event)"
            >
              <option value="">不关联角色</option>
              <option v-for="ch in characters" :key="ch.id" :value="ch.id">{{ ch.name }}</option>
            </select><small>头像随关联角色同步。</small></label>
            <label class="phone-field phone-field--wide"><span>备注</span><textarea
              class="crow__note" rows="3"

              :value="contact.note"
              :maxlength="CONTACT_NOTE_MAX_LENGTH"
              :disabled="readOnly"
              placeholder="备注"
              aria-label="备注"
              data-testid="contact-note"
              @change="commitContact(contact, 'note', $event)"
            ></textarea></label>

            <section class="contact-calls">
              <h3>关联通话 <small>{{ calls.filter(call => call.contactId === contact.id).length }}</small></h3>
              <button v-for="call in calls.filter(call => call.contactId === contact.id)" :key="call.id" type="button" @click="openCall(call)"><time>{{ callTimeLabel(call, true) }}</time><span class="related-call-type" :class="{ 'is-missed': call.type === 'missed' }"><CallIcon :type="call.type" />{{ callTypeLabel(call.type) }}</span><span aria-hidden="true">›</span></button>
              <p v-if="!calls.some(call => call.contactId === contact.id)" class="phone-muted">暂无关联通话。</p>
            </section>
          </li>
        </ul>
      </RecordWorkspace>
    </section>

    <!-- ── 通话记录 ── -->
    <section v-show="phoneTab === 'calls'" class="phoned__block phone-calls">
      <div v-if="!calls.length" class="phoned__empty-state">新建通话后，在这里编辑通话记录。</div>
      <RecordWorkspace v-else v-model="selectedCallId" v-model:detail-open="callDetailOpen" :show-heading="false" class="phone-workspace calls-workspace" title="通话记录" search-placeholder="查找通话记录" heading="电话" :records="callsItems">
        <template #detail-toolbar="{ back }">
          <div class="phone-detail-toolbar">
            <button type="button" class="record-workspace__back" @click="back"><span class="phone-back-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m14 6-6 6 6 6" /></svg></span><span>通话记录</span></button>
            <AppButton v-if="visibleCallRecords[0]" variant="danger" :disabled="readOnly" data-testid="call-remove-mobile" @click="removeCall(visibleCallRecords[0], back)">删除</AppButton>
          </div>
        </template>
        <template #empty><p class="phone-index-empty">暂无通话记录</p></template>
        <template #before-record="{ record, previous }"><p v-if="!previous || callDayKey(record) !== callDayKey(previous)" class="call-day">{{ callDay(record) }}</p></template>
        <template #record="{ record }">
          <span class="call-avatar" :class="{ 'call-avatar--stranger': !record.initial, 'is-missed': record.type === 'missed' }">
            <img v-if="record.avatar" :src="record.avatar" alt="" />
            <span v-else-if="record.initial">{{ record.initial }}</span>
            <CallIcon v-else :type="record.type" />
          </span>
          <span class="call-choice-body">
            <span class="call-choice-title"><strong>{{ record.title }}</strong><time :datetime="record.displayTime">{{ formatClock(new Date(record.displayTime), 'h24') }}</time></span>
            <span class="call-choice-type" :class="{ 'is-missed': record.type === 'missed' }"><CallIcon :type="record.type" />{{ record.subtitle }}</span>
          </span>
        </template>
        <ul class="phoned__list" data-testid="call-list">
          <li v-for="call in visibleCallRecords" :key="call.id" class="lrow" :data-call-id="call.id" data-testid="call-row">
            <header class="call-summary">
              <span class="call-avatar call-avatar--large" :class="{ 'call-avatar--stranger': !callContact(call), 'is-missed': call.type === 'missed' }">
                <img v-if="callAvatar(call)" :src="callAvatar(call)" alt="" />
                <span v-else-if="callContact(call)">{{ callContact(call).name?.[0] }}</span>
                <CallIcon v-else :type="call.type" />
              </span>
              <div class="call-summary-body">
                <h2>{{ callTitle(call) }}</h2>
                <p>{{ numberShown(call) || '尚未填写号码' }}</p>
              </div>
              <DeleteIconButton class="phone-menu" label="删除通话记录" :disabled="readOnly" data-testid="call-remove" @click="removeCall(call)" />
            </header>
            <div class="call-form">
              <label class="phone-field"><span>归属</span>
                <select :value="call.contactId ?? ''" :disabled="readOnly" aria-label="归属" data-testid="call-contact" @change="commitCallContact(call, $event)">
                  <option value="">{{ STRANGER_OPTION }}</option>
                  <option v-if="call.contactId && !contactNameOf(call.contactId)" :value="call.contactId">（联系人已失效）</option>
                  <option v-for="c in contactOptions" :key="c.id" :value="c.id" :title="c.phoneNumber">{{ c.name }}</option>
                </select>
              </label>
              <label class="phone-field"><span>号码</span>
                <input type="tel" :value="numberShown(call)" :maxlength="PHONE_NUMBER_MAX_LENGTH" :disabled="readOnly || Boolean(call.contactId)" :placeholder="call.contactId ? '取自联系人' : '号码（选填）'" :title="call.contactId ? '这条通话显示联系人的号码' : ''" aria-label="号码" data-testid="call-number" @change="commitCallNumber(call, $event)" />
                <small v-if="call.contactId">号码取自联系人。</small>
              </label>
              <fieldset class="call-types" :disabled="readOnly">
                <legend>通话类型</legend>
                <div class="call-types-options">
                  <label v-for="type in CALL_TYPES" :key="type.value">
                    <input type="radio" :name="'call-type-' + call.id" :value="type.value" :checked="call.type === type.value" data-testid="call-type" @change="commitCallType(call, $event)" />
                    <span>{{ type.label }}</span>
                  </label>
                </div>
              </fieldset>
              <label class="phone-field phone-field--wide"><span>通话时间</span>
                <input type="datetime-local" :value="toDateTimeLocal(call.displayTime)" :disabled="readOnly" aria-label="通话时间" data-testid="call-time" @change="commitCallTime(call, $event)" />
              </label>
              <fieldset v-if="call.type !== 'missed'" class="call-duration" :disabled="readOnly">
                <legend>通话时长</legend>
                <div class="call-duration-inputs">
                  <label><input type="number" min="0" max="1440" :value="splitDuration(call.durationSec).min" aria-label="时长分钟" data-unit="min" data-testid="call-min" @change="commitDuration(call, $event)" /><span>分</span></label>
                  <label><input type="number" min="0" max="59" :value="splitDuration(call.durationSec).sec" aria-label="时长秒" data-unit="sec" data-testid="call-sec" @change="commitDuration(call, $event)" /><span>秒</span></label>
                </div>
              </fieldset>
            </div>
          </li>
        </ul>
        <p v-if="!calls.length" class="calls-empty-detail">新建通话后，在这里编辑通话记录。</p>
      </RecordWorkspace>
    </section>

    <p v-if="readOnly" class="phoned__ro">当前为只读，无法修改</p>
  </section>
</template>

<style scoped>
.phoned{padding:28px;min-width:0;display:flex;flex-direction:column;height:calc(var(--creator-viewport-height,100dvh) - var(--layout-topbar-h,56px));overflow:hidden}
.phone-page-head{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:8px;flex:none}
.phone-page-head h1{display:flex;align-items:baseline;gap:18px;font:600 24px/1.5 var(--font-story)}
.phone-page-head small{font:400 12px/1.5 var(--font-sans);color:var(--c-text-3)}
.phone-page-head .ui-btn{min-height:34px;font-size:13px;padding:7px 16px;border-radius:6px}
.phone-tabs{display:flex;gap:24px;border-bottom:1px solid var(--c-border);margin-bottom:24px;flex:none}
.phone-tabs button{border:0;border-bottom:2px solid transparent;background:transparent;padding:10px 12px;font:400 14px/1.5 var(--font-sans);color:var(--c-text);cursor:pointer}
.phone-tabs button[aria-pressed=true]{border-bottom-color:var(--c-text);font-weight:600}
.phoned__block{flex:1;min-height:0}.phone-workspace{grid-template-columns:300px minmax(0,1fr);gap:32px;height:100%;min-height:0}
.phone-workspace :deep(.record-workspace__index){display:flex;flex-direction:column;min-height:0;padding:0 18px 0 0;border-right:1px solid var(--c-border)}
.phone-workspace :deep(.record-workspace__search){flex:none;margin:0 0 18px}
.phone-workspace :deep(.record-workspace__search input){height:36px;min-height:36px;font-size:13px;border-radius:6px;padding:8px 12px 8px 34px;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='%23656864' stroke-width='1.5'%3E%3Ccircle cx='10.5' cy='10.5' r='7.5'/%3E%3Cpath d='m16 16 5 5'/%3E%3C/svg%3E");background-repeat:no-repeat;background-size:16px;background-position:11px center}
.phone-workspace :deep(.record-workspace__records){display:block;overflow-y:auto;min-height:0;scrollbar-width:none}
.phone-workspace :deep(.record-workspace__records::-webkit-scrollbar){display:none}
.phone-workspace :deep(.record-choice){min-height:68px;padding:10px 12px;gap:16px;border-radius:8px;margin-bottom:4px}
.phone-workspace :deep(.record-choice strong){font:600 16px/1.5 var(--font-sans)}
.phone-workspace :deep(.record-choice small){font-size:12px}
.phone-workspace :deep(.record-choice__initial),.call-avatar{font-family:var(--font-story);font-weight:600}
.phone-workspace :deep(.record-workspace__detail){min-height:0;overflow-y:auto;overflow-x:hidden;padding:0 4px}
.phoned__list{list-style:none;padding:0;margin:0;min-width:0}
.crow{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px;min-width:0}
.contact-summary,.call-summary{display:flex;align-items:center;gap:20px;margin:0 0 8px;min-width:0}
.contact-summary{grid-column:1/-1}.call-summary{margin-bottom:32px}
.call-summary-body{min-width:0;flex:1}.call-summary-body h2{font:600 26px/1.4 var(--font-story);overflow-wrap:anywhere}.call-summary-body p{margin-top:4px;color:var(--c-text-2);font-size:13px}
.call-avatar{display:grid;place-items:center;width:42px;height:42px;flex:none;border-radius:50%;background:var(--c-bg-sunken);font-size:21px;overflow:hidden;color:var(--c-text-2)}
.call-avatar img{width:100%;height:100%;object-fit:cover}.call-avatar svg{width:22px;height:22px}.call-avatar--large{width:60px;height:60px;font-size:28px}.call-avatar--stranger.is-missed{background:var(--c-danger-weak)}
.call-choice-body{min-width:0;flex:1}.call-choice-title{display:flex;align-items:baseline;gap:10px}.call-choice-title strong{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.call-choice-title time{font-size:11px;white-space:nowrap;color:var(--c-text-3)}
.call-choice-type{display:flex;align-items:center;gap:8px;margin-top:4px;font-size:12px;color:var(--c-text-2)}.call-choice-type svg{width:15px;height:15px}.is-missed{color:var(--c-danger)}
.call-day{font-size:12px;color:var(--c-text-2);padding:12px 6px 8px}.call-day:first-child{padding-top:0}
.phone-field{display:grid;align-content:start;gap:8px;min-width:0;font-size:13px;color:var(--c-text)}
.phone-field--wide,.contact-calls{grid-column:1/-1}
.phone-field input,.phone-field select,.phone-field textarea,.call-duration input{width:100%;min-width:0;min-height:38px;border:1px solid var(--c-border);border-radius:6px;background:var(--c-white);padding:8px 12px;color:var(--c-text);font:400 14px/1.5 var(--font-sans)}
.phone-field textarea{min-height:90px;resize:vertical}.phone-field small{font-size:12px;color:var(--c-text-3);line-height:1.5}
.phone-field :disabled,.call-duration :disabled{background:var(--c-bg-sunken);color:var(--c-text-3)}
.phone-field :focus-visible,.call-duration input:focus-visible{outline:1px solid var(--c-accent);outline-offset:0;box-shadow:0 0 0 3px var(--c-accent-weak);border-radius:var(--radius-sm)}
.call-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:26px}
.call-types,.call-duration{grid-column:1/-1;border:0;padding:0;margin:0;min-width:0}.call-types legend,.call-duration legend{padding:0;margin-bottom:10px;font-size:13px}
.call-types-options{display:flex;flex-wrap:wrap;gap:12px 36px}.call-types-options label{display:flex;align-items:center;gap:10px;font-size:15px;min-height:30px;cursor:pointer}.call-types-options input{width:18px;height:18px;margin:0;accent-color:var(--c-text)}
.call-duration-inputs{display:flex;gap:24px}.call-duration-inputs label{display:flex;align-items:center;gap:12px;font-size:13px;color:var(--c-text-2)}.call-duration input{width:90px}
.contact-calls h3{font:600 17px/1.5 var(--font-story);margin:4px 0 12px}.contact-calls h3 small{margin-left:14px;color:var(--c-text-3);font:400 12px var(--font-sans)}
.contact-calls>button{display:grid;grid-template-columns:1fr 1fr auto;align-items:center;gap:16px;padding:14px 0;width:100%;border:0;border-top:1px solid var(--c-border);background:transparent;color:var(--c-text);font:400 13px/1.5 var(--font-sans);text-align:left;cursor:pointer}
.contact-calls>button:last-child{border-bottom:1px solid var(--c-border)}.related-call-type{display:flex;align-items:center;gap:16px}.related-call-type svg{width:19px;height:19px}
.phone-index-empty{padding:80px 12px;text-align:center;font-size:13px;color:var(--c-text-3)}
.phone-muted,.phoned__empty,.calls-empty-detail{font-size:13px;color:var(--c-text-3);line-height:1.8}.phoned__empty,.calls-empty-detail{padding:100px 24px;text-align:center}
.phone-menu{position:relative;align-self:flex-start;margin-left:auto}
.phoned__ro{font-size:12px;color:var(--c-text-3)}
@media(max-width:1439px){.phoned{padding:24px}.phone-workspace{grid-template-columns:280px minmax(0,1fr);gap:28px}}
@media(min-width:768px) and (max-width:1100px){.phone-workspace{grid-template-columns:220px minmax(0,1fr);gap:24px}.call-types-options{column-gap:18px}.contact-summary,.call-summary{gap:14px}}
@media(max-width:767px){
.phoned{padding:24px 16px;height:auto;min-height:calc(var(--creator-viewport-height,100dvh) - var(--layout-topbar-h,56px));overflow:visible;overflow-x:clip}
.phone-page-head h1{font-size:24px;gap:12px}.phone-page-head small{font-size:11px}.phone-page-head .ui-btn{padding:7px 12px;font-size:12px}
.phoned[data-detail=true]>.phone-page-head,.phoned[data-detail=true]>.phone-tabs{display:none}
.phone-tabs{margin-bottom:24px}.phone-tabs button{padding-inline:8px}.phone-workspace{height:auto;display:block}
.phone-workspace :deep(.record-workspace__index){padding:0;border:0}.phone-workspace[data-detail=true] :deep(.record-workspace__index){display:none}
.phone-workspace :deep(.record-workspace__detail){overflow:visible;padding:0}.phone-workspace :deep(.record-workspace__records){overflow:visible}
.phone-detail-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:20px}.phone-detail-toolbar .record-workspace__back{margin:0;display:flex;align-items:center;gap:10px;border:0;background:transparent;padding:0;min-height:36px;font:400 16px var(--font-sans);color:var(--c-text)}
.phone-detail-toolbar .ui-btn{display:none}.crow,.call-form{gap:22px 16px}.contact-summary,.call-summary{gap:16px;margin-bottom:8px}.call-summary{margin-bottom:28px}.call-summary-body h2{font-size:24px}.call-avatar--large{width:54px;height:54px;font-size:26px}
.phone-field input,.phone-field select,.phone-field textarea,.call-duration input{font-size:14px;min-height:38px}.phone-field{font-size:12px}.call-types-options{gap:8px 22px}.call-types-options label{font-size:14px;min-height:36px}.call-duration input{width:78px}
.contact-calls>button{font-size:12px;grid-template-columns:1fr auto auto;gap:16px}.related-call-type{gap:8px}
}
@media(max-width:767px){
.phone-back-icon{display:grid;place-items:center;width:28px;height:28px;border:1px solid var(--c-border);border-radius:50%;flex:none}
.contact-summary,.call-summary{position:relative}
.contact-summary>.phone-menu,.call-summary>.phone-menu{position:absolute;right:0;top:-56px;margin:0}
}
.phoned__empty-state{min-height:320px;display:grid;place-items:center;text-align:center;color:var(--c-text-3);font-size:14px;line-height:1.8;padding:24px}
</style>
