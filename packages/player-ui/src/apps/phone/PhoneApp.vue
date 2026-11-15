

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  buildContacts,
  buildMyCard,
  groupContactsByInitial,
  buildCallLog,
  buildConversationList,
  formatDialNumber,
  matchContactByDigits,
  TIME_FORMAT,
} from '@phone-sim/shared'
import ScrollArea from '../../appkit/ScrollArea.vue'
import Avatar from '../../appkit/Avatar.vue'
import EmptyState from '../../appkit/EmptyState.vue'
import ContactDetailView from '../shared/ContactDetailView.vue'
import { usePhoneRuntime, useWorkData } from '../../kernel/create-runtime.js'
import { useTapFeedback } from '../../kernel/use-tap-feedback.js'

const runtime = usePhoneRuntime()
const { getWork } = useWorkData()

const work = computed(() => getWork())
const settings = computed(() => work.value?.workSettings ?? {})
const timeFormat = computed(() => settings.value.timeFormat ?? TIME_FORMAT.H24)
const storyDate = computed(() => settings.value.storyDate ?? null)
const ownerCharacterId = computed(() => settings.value.ownerCharacterId ?? null)

const AVATAR_BG = 'linear-gradient(180deg, #b9c4e4 0%, #8d9cc9 100%)'

/* ── 导航 ─────────────────────────────────────────── */
const screen = computed(() => runtime.currentScreen.value)
const screenName = computed(() => screen.value?.name ?? 'root')
/** 'myCard' 与 'contact' 共用详情页版式，但数据来路不同，所以是两个屏名 */
const isMyCard = computed(() => screenName.value === 'myCard')
const isDetail = computed(() => screenName.value === 'contact' || isMyCard.value)
const isCall = computed(() => screenName.value === 'call')
const direction = computed(() => (runtime.state.transition === 'pop' ? 'pop' : 'push'))

const callFade = ref(false)
watch(
  screenName,
  (next, prev) => { callFade.value = next === 'call' || prev === 'call' },
  { flush: 'sync', immediate: true },
)
const screenTransition = computed(() =>
  callFade.value ? 'pui-ph-screen-fade' : `pui-ph-screen-${direction.value}`,
)

// 通话中整屏是暗色底：状态栏切白字，离开通话屏（含卸载前 openApp 重置）交回自动判断。
// immediate 必须开：从信息应用「呼叫」借道进来时，本组件一挂载就已经落在通话屏，
// 没有 false→true 的变化，不 immediate 就会停在 auto（= 深字）——
// 深灰通话背景上等于状态栏消失。
watch(isCall, (on) => {
  runtime.setStatusTone(on ? 'light' : 'auto')
}, { immediate: true })

const tab = ref('contacts')

function setTab(next) {
  // 在联系人详情里点 tab：先退回根屏，否则 tab 换了但详情盖在上面，看着像没反应
  if (isDetail.value) runtime.pop()
  tab.value = next
}

function openContact(contactId) {
  if (contactId) runtime.push('contact', contactId)
}

/** 「我的名片」：不带参数，数据由 buildMyCard 从作品里的机主派生 */
function openMyCard() {
  runtime.push('myCard')
}

function goBack() {
  runtime.pop()
}

/** 回桌面：点顶部居中的页面标题（与 KakaoTalk / X 同一套出口约定） */
function goHome() {
  runtime.goHome()
}

/* ── 通讯录 ───────────────────────────────────────── */
const contacts = computed(() => (work.value ? buildContacts(work.value) : []))
const groups = computed(() => groupContactsByInitial(contacts.value))

/**
 * 这一行是否该"不画线"：当且仅当它是本组的最后一个联系人。
 * 此时它后面紧跟的就是下一个字母分类的组标题（那条通栏线已经替它封口了），
 * 列表最后一个组的最后一个人也一样 —— 后面是留白，不该再补一条。
 * 组内的其余联系人后面还有同组联系人，要画一条缩进线把它们串起来。
 */
function isRowLast(contact, group) {
  return contact === group.items[group.items.length - 1]
}

const INDEX_LETTERS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '#']

/**
 * 「我的名片」：机主不在通讯录列表里（真机也是单独一张名片），
 * 数据由 shared 的 buildMyCard 从机主角色 / 信息·电话账号派生，字段形状与
 * buildContacts 一致，可以直接喂给 ContactDetailView。
 * 没有作品数据时也给一份占位 —— 名片点开不能变成没有返回键的死路。
 */
const EMPTY_MY_CARD = {
  hasOwner: false,
  characterId: null,
  name: '我的名片',
  avatarAssetId: null,
  phoneNumber: '',
  email: '',
  note: '',
}
const myCard = computed(() => (work.value ? buildMyCard(work.value) : EMPTY_MY_CARD))

const activeContactId = computed(() =>
  isDetail.value && !isMyCard.value ? (screen.value?.params ?? null) : null,
)
const activeContact = computed(() =>
  isMyCard.value
    ? myCard.value
    : (contacts.value.find((c) => c.id === activeContactId.value) ?? null),
)

/* ── 呼叫与跨应用跳转 ─────────────────────────────── */
// 通话屏参数：{ number, name? }。有姓名按联系人样式显示，无姓名走「主号 + 号码」。
const callParams = computed(() => (isCall.value ? screen.value?.params ?? {} : {}))
const callName = computed(() => String(callParams.value.name ?? '').trim())
/* formatDialNumber 会剥非数字；国际前缀要单独留在最前，拨号盘长按 0 输的 +
   才不会在拨出去的那一刻消失。不带 + 的号码行为完全不变。 */
const callNumDisplay = computed(() => {
  const raw = String(callParams.value.number ?? '')
  return (raw.startsWith('+') ? '+' : '') + formatDialNumber(raw)
})

function endCall() {
  /**
   * 借道进来的通话（信息应用联系人页点「呼叫」）：挂断要把用户还回**来处**。
   * 这种情况电话应用只是被临时借用的壳，用户没进过它，
   * 直接 pop 会落在电话自己的通讯录，看起来像"挂断反而跳到了联系人"。
   * 不是借道就走普通 pop（拨号盘 / 联系人详情 / 最近通话拨出的都在自己应用内）。
   */
  if (runtime.returnFromBorrow()) return
  runtime.pop()
}

/** 拨号键盘呼出：有号码才接（与真机一致，空号拨号钮就是灰的） */
function startDialCall() {
  // 只有 + 没有数字时不算一个可拨的号码（呼叫钮与 Enter 都走这条）
  if (digits.value) runtime.push('call', { number: (intlPrefix.value ? '+' : '') + digits.value })
}

/** 联系人详情呼出（自己的名片不呼出：不能给自己打电话） */
function openCallFromContact() {
  if (isMyCard.value || !activeContact.value?.phoneNumber) return
  runtime.push('call', {
    number: activeContact.value.phoneNumber,
    name: activeContact.value.name,
  })
}

/**
 * 最近通话回拨：点行主体（头像 / 名字号码）直接拨出去，不先绕详情页。
 * 号码只认 buildCallLog 给的 dialNumber —— 它把"联系人号码写在通讯录里"
 * 和"陌生号码写在通话记录里"两种来路统一了；两者都空的记录（未知号码）
 * 没有可拨的目标，这一行就不接端。陌生号码不传姓名：通话屏已经把号码
 * 当标题显示，再传一次只会重复一遍。
 */
function redial(call) {
  if (!call.dialNumber) return
  runtime.push('call', {
    number: call.dialNumber,
    ...(call.stranger ? {} : { name: call.name }),
  })
}

/** 信息应用的会话列表（找"跟这个人的聊天"用） */
const msgConversations = computed(() =>
  work.value
    ? buildConversationList(work.value, 'messages', {
        timeFormat: timeFormat.value,
        storyDate: storyDate.value,
        ownerCharacterId: ownerCharacterId.value,
      })
    : [],
)

/** 详情的「信息」钮是否可点：联系人关联了角色，且该角色有信息会话 */
const contactHasChat = computed(() => {
  const chId = activeContact.value?.characterId
  return Boolean(chId && msgConversations.value.some((c) => c.participantIds.includes(chId)))
})

/**
 * 详情两颗动作钮的接端开关。自己的名片即便有机主号码、机主也参与会话，
 * 也不该出现「呼叫」「信息」—— 打给自己 / 发给自己是两个没有目的的假入口。
 */
const detailCanCall = computed(
  () => !isMyCard.value && Boolean(activeContact.value?.phoneNumber),
)
const detailCanMessage = computed(() => !isMyCard.value && contactHasChat.value)

/** 详情的「信息」→ 跳到信息应用里跟这个人的聊天页 */
function openChatFromContact() {
  if (isMyCard.value) return
  const chId = activeContact.value?.characterId
  const conv = chId ? msgConversations.value.find((c) => c.participantIds.includes(chId)) : null
  if (!conv) return
  runtime.openApp('messages')
  runtime.push('chat', conv.id)
}

/* ── 最近通话 ─────────────────────────────────────── */
const calls = computed(() => {
  if (!work.value) return []
  return buildCallLog(work.value, {
    storyDate: storyDate.value,
    timeFormat: timeFormat.value,
  })
})

/* ── 拨号键盘 ─────────────────────────────────────── */
const KEYS = [
  { digit: '1', letters: '' },
  { digit: '2', letters: 'ABC' },
  { digit: '3', letters: 'DEF' },
  { digit: '4', letters: 'GHI' },
  { digit: '5', letters: 'JKL' },
  { digit: '6', letters: 'MNO' },
  { digit: '7', letters: 'PQRS' },
  { digit: '8', letters: 'TUV' },
  { digit: '9', letters: 'WXYZ' },
  { digit: '*', letters: '' },
  { digit: '0', letters: '+' },
  { digit: '#', letters: '' },
]

const MAX_DIGITS = 15

const digits = ref('')
/* 长按 0 出来的国际前缀单独存一份：shared 的 formatDialNumber 会剥掉所有
   非数字字符、matchContactByDigits 也只认数字，把 + 塞进 digits 会显示不出来。
   它恒在号码最前面，显示与呼叫时再拼回去。 */
const intlPrefix = ref(false)
const dialDisplay = computed(
  () => (intlPrefix.value ? '+' : '') + formatDialNumber(digits.value),
)
const dialMatch = computed(() => matchContactByDigits(contacts.value, digits.value))

/* 号码区拆成「前面所有字 + 最后一位」：只有最后一位带入场动画，
   删除时不重建它，所以删一位不会有淡入闪烁。 */
const dialHead = computed(() => dialDisplay.value.slice(0, -1))
const dialTail = computed(() => dialDisplay.value.slice(-1))

/* ── 交互反馈（B 档）─────────────────────────────────────────────
 * 原则：反馈只在「按下 / 悬停 / 焦点 / 刚输入」时出现，静止态的尺寸、
 * 颜色、字号、位置一个都不改。动效统一走 tokens 的 --pui-dur-fast /
 * --pui-ease-out，系统开了「减少动态效果」会自动降级到 1ms。
 */
const numTick = ref(0)
function bumpNumber() {
  numTick.value += 1
}

/** 同一颗键连按也要能重播高亮：先撤 class，下一帧再挂上 */
const flashedKey = ref('')
let flashTimer = null
let flashRaf = 0
function flashKey(digit) {
  clearTimeout(flashTimer)
  cancelAnimationFrame(flashRaf)
  flashedKey.value = ''
  flashRaf = requestAnimationFrame(() => {
    flashedKey.value = digit
    flashTimer = setTimeout(() => { flashedKey.value = '' }, 140)
  })
}

const {
  pinged: pingedTab,
  ping: pingTab,
  pingDown: pingTabDown,
  pingUp: pingTabUp,
} = useTapFeedback()

/**
 * 通话屏那批装饰钮（免提 / FaceTime / 静音 / 添加 / 拨号键盘 / 右上 (i)）共用的事件组。
 * 点一下只给按压反馈：不切页、不弹面板、不改通话状态 —— 真机上它们各自会接续动作
 * （开扬声器、转视频、开联系人选择器…），作品里没有对应数据，做成入口只会进空屏。
 * 六颗钮各写五遍事件属性太容易漏，这里用 v-on 对象一次挂齐。
 */
function tapFx(name) {
  return {
    pointerdown: () => pingTabDown(name),
    pointerup: pingTabUp,
    pointercancel: pingTabUp,
    pointerleave: pingTabUp,
    click: () => pingTab(name),
  }
}

function pressKey(digit) {
  if (digits.value.length >= MAX_DIGITS) return
  digits.value += digit
  bumpNumber()
}

function backspace() {
  // 数字删光后再删一次才轮到国际前缀（真机里 + 也算可删的一位）
  if (digits.value) digits.value = digits.value.slice(0, -1)
  else if (intlPrefix.value) intlPrefix.value = false
}

/**
 * 点匹配到的联系人姓名 → 把完整号码填进拨号框（真机"点建议补全号码"）。
 * 号码在作品里是自由文本（可能带空格 / 横线），这里剥成与按键输入同口径的
 * 纯数字；联系人没录号码时不改输入，免得把已输的半截号清掉。
 */
function fillMatchedNumber() {
  const num = String(dialMatch.value?.phoneNumber ?? '').replace(/\D/g, '')
  if (!num) return
  digits.value = num.slice(0, MAX_DIGITS)
  intlPrefix.value = false
  bumpNumber()
}

/* ── 物理键盘：只在拨号页、且没被通话屏 / 详情页盖住时接管 ──
 * 拨号页本身没有输入框，所以监听 window 是安全的；但仍要放掉落在
 * 输入框、组合键和系统重复事件，免得抢了创作端自己的编辑操作。
 */
const DIAL_KEYS = /^[0-9*#]$/
function onKeydown(e) {
  if (tab.value !== 'dial' || isCall.value || isDetail.value) return
  if (e.altKey || e.ctrlKey || e.metaKey || e.repeat) return
  const t = e.target
  if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName ?? ''))) return
  if (DIAL_KEYS.test(e.key)) {
    e.preventDefault()
    pressKey(e.key)
    flashKey(e.key)
  } else if (e.key === 'Backspace' || e.key === 'Delete') {
    e.preventDefault()
    backspace()
  } else if (e.key === 'Enter') {
    e.preventDefault()
    startDialCall()
  }
}

/* ── 删除键长按连删 ──
 * 只用一套 Pointer Events：pointerdown 起 400ms 计时，到点先删一位，
 * 之后每 80ms 删一位；抬手 / 取消 / 移出都清表。长按已经连删过时，
 * 抬手那次 click 要吞掉，否则会比预期多删一位。
 */
let holdTimer = null
let repeatTimer = null
let holdFired = false
function clearBackspaceHold() {
  if (holdTimer) { clearTimeout(holdTimer); holdTimer = null }
  if (repeatTimer) { clearInterval(repeatTimer); repeatTimer = null }
}
function startBackspaceHold(e) {
  if (e.pointerType === 'mouse' && e.button !== 0) return
  holdFired = false
  clearBackspaceHold()
  holdTimer = setTimeout(() => {
    holdFired = true
    if (!digits.value && !intlPrefix.value) return
    backspace()
    repeatTimer = setInterval(() => {
      if (!digits.value && !intlPrefix.value) { clearBackspaceHold(); return }
      backspace()
    }, 80)
  }, 400)
}
function onBackspaceClick(e) {
  // e.detail === 0 是键盘触发的 click，不参与长按抑制
  if (e.detail !== 0 && holdFired) { holdFired = false; return }
  backspace()
}

/* ── 长按 0 输 +（真机的国际前缀）──
 * 和删除键共用同一套 Pointer Events 习惯：按下 0 起 400ms，到点落一个 +，
 * 并吞掉紧接抬手的那次 click —— 否则会变成「先补一个 0 再加 +」。
 * + 只在号码开头有意义，重复长按不叠加；已有号码时补前缀，不改动已输的数字。
 */
let keyHoldTimer = null
let keyHoldFired = false
function clearKeyHold() {
  if (keyHoldTimer) { clearTimeout(keyHoldTimer); keyHoldTimer = null }
}
function startKeyHold(e, digit) {
  if (digit !== '0' || (e.pointerType === 'mouse' && e.button !== 0)) return
  keyHoldFired = false
  clearKeyHold()
  keyHoldTimer = setTimeout(() => {
    keyHoldFired = true
    if (!intlPrefix.value) {
      intlPrefix.value = true
      bumpNumber()
    }
    flashKey('0')
  }, 400)
}
function onKeyClick(e, digit) {
  // e.detail === 0 是脚本触发的 click，不参与长按抑制；
  // 标志只抑制「紧接长按的那次 0 键 click」，任何一次 click 都会把它清掉。
  const suppress = e.detail !== 0 && keyHoldFired && digit === '0'
  keyHoldFired = false
  if (suppress) return
  pressKey(digit)
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  clearBackspaceHold()
  clearKeyHold()
  clearTimeout(flashTimer)
  cancelAnimationFrame(flashRaf)
})
</script>

<template>
  <div class="pui-ph" data-testid="phone-app">
    <div class="pui-ph__stack">
      <Transition :name="screenTransition">
        <!-- ══ 通话中（iOS 18 风格）：暗色渐变整屏，底部六颗圆钮 ══
             「结束」是真的（pop 回原屏）；其余五颗 + 右上 (i) 只给按压反馈，
             不切页、不弹面板（见 tapFx 的注释）。 -->
        <section
          v-if="isCall"
          key="call"
          class="pui-ph__screen pui-ph__incall"
          data-testid="phone-call-screen"
        >
          <div class="pui-ph__incall-top">
            <template v-if="callName">
              <h1 class="pui-ph__incall-title">{{ callName }}</h1>
              <p class="pui-ph__incall-sub">{{ callNumDisplay }}</p>
            </template>
            <template v-else>
              <p class="pui-ph__incall-label">主号</p>
              <h1 class="pui-ph__incall-title">{{ callNumDisplay }}</h1>
            </template>
          </div>

          <button
            type="button"
            class="pui-ph__incall-info"
            :class="{ 'pui-ph__incall-info--ping': pingedTab === 'incallInfo' }"
            data-testid="phone-incall-info"
            aria-label="通话详情"
            v-on="tapFx('incallInfo')"
          >
            <svg viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="9.2" fill="none" stroke="currentColor" stroke-width="1.4" />
              <path d="M12 10.6v6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
              <circle cx="12" cy="7.6" r="1.15" fill="currentColor" />
            </svg>
          </button>

          <div class="pui-ph__incall-grid">
            <button
              type="button"
              class="pui-ph__callkey"
              :class="{ 'pui-ph__callkey--ping': pingedTab === 'speaker' }"
              data-testid="phone-call-speaker"
              v-on="tapFx('speaker')"
            >
              <span class="pui-ph__callkey-orb">
                <svg viewBox="0 0 24 24">
                  <path d="M4.4 9.4v5.2h3.4l4.4 3.8V5.6L7.8 9.4H4.4z" fill="currentColor" />
                  <path d="M15.4 9.2a4.4 4.4 0 010 5.6M18 6.8a8 8 0 010 10.4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
                </svg>
              </span>
              <i>免提</i>
            </button>
            <button
              type="button"
              class="pui-ph__callkey"
              :class="{ 'pui-ph__callkey--ping': pingedTab === 'facetime' }"
              data-testid="phone-call-facetime"
              v-on="tapFx('facetime')"
            >
              <span class="pui-ph__callkey-orb">
                <svg viewBox="0 0 24 24">
                  <rect x="2.8" y="6.6" width="12.6" height="10.8" rx="3.2" fill="currentColor" />
                  <path d="M16.6 10.8l4.4-2.5v7.4l-4.4-2.5z" fill="currentColor" />
                </svg>
              </span>
              <i>FaceTime</i>
            </button>
            <button
              type="button"
              class="pui-ph__callkey"
              :class="{ 'pui-ph__callkey--ping': pingedTab === 'mute' }"
              data-testid="phone-call-mute"
              v-on="tapFx('mute')"
            >
              <span class="pui-ph__callkey-orb">
                <svg viewBox="0 0 24 24">
                  <path d="M14.2 5.2v6.2M9.8 9.4v5.4a2.2 2.2 0 004.4 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
                  <path d="M4.8 4.8l14.4 14.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
                </svg>
              </span>
              <i>静音</i>
            </button>
            <button
              type="button"
              class="pui-ph__callkey"
              :class="{ 'pui-ph__callkey--ping': pingedTab === 'callAdd' }"
              data-testid="phone-call-add"
              v-on="tapFx('callAdd')"
            >
              <span class="pui-ph__callkey-orb">
                <svg viewBox="0 0 24 24">
                  <circle cx="10.6" cy="8.8" r="3.3" fill="none" stroke="currentColor" stroke-width="1.7" />
                  <path d="M4.6 19c.8-3.2 3.2-4.9 6-4.9 1 0 1.9.2 2.7.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
                  <path d="M18.2 13.6v5M15.7 16.1h5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
                </svg>
              </span>
              <i>添加</i>
            </button>
            <button
              type="button"
              class="pui-ph__callkey pui-ph__callkey--end"
              data-testid="phone-call-end"
              aria-label="结束通话"
              @click="endCall"
            >
              <span class="pui-ph__callkey-orb">
                <svg viewBox="0 0 24 24">
                  <path
                    d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"
                    fill="currentColor"
                    transform="rotate(134 12 12)"
                  />
                </svg>
              </span>
              <i>结束</i>
            </button>
            <button
              type="button"
              class="pui-ph__callkey"
              :class="{ 'pui-ph__callkey--ping': pingedTab === 'keypad' }"
              data-testid="phone-call-keypad"
              v-on="tapFx('keypad')"
            >
              <span class="pui-ph__callkey-orb">
                <svg viewBox="0 0 24 24">
                  <circle cx="7" cy="7" r="1.7" fill="currentColor" />
                  <circle cx="12" cy="7" r="1.7" fill="currentColor" />
                  <circle cx="17" cy="7" r="1.7" fill="currentColor" />
                  <circle cx="7" cy="12" r="1.7" fill="currentColor" />
                  <circle cx="12" cy="12" r="1.7" fill="currentColor" />
                  <circle cx="17" cy="12" r="1.7" fill="currentColor" />
                  <circle cx="7" cy="17" r="1.7" fill="currentColor" />
                  <circle cx="12" cy="17" r="1.7" fill="currentColor" />
                  <circle cx="17" cy="17" r="1.7" fill="currentColor" />
                </svg>
              </span>
              <i>拨号键盘</i>
            </button>
          </div>
        </section>

        <!-- ══ 联系人详情 / 我的名片（iOS 18 风格）══
             版式在共享组件 ContactDetailView 里（电话 / 信息两处同一份）。
             这里只决定哪些动作钮是"真的"：呼叫要号码、信息要角色有会话；
             自己的名片两颗都不接端，只留外观。 -->
        <section
          v-else-if="isDetail"
          :key="isMyCard ? 'myCard' : 'contact'"
          class="pui-ph__screen pui-ph__screen--detail"
          :data-testid="isMyCard ? 'phone-mycard-screen' : 'phone-contact-screen'"
        >
          <ContactDetailView
            v-if="activeContact"
            :contact="activeContact"
            :scroll-key="isMyCard ? 'phone:mycard' : 'phone:contact'"
            :real-call="detailCanCall"
            :real-message="detailCanMessage"
            @back="goBack"
            @call="openCallFromContact"
            @message="openChatFromContact"
          />

          <EmptyState
            v-else
            :title="isMyCard ? '还没有设置机主' : '联系人不存在'"
            :description="isMyCard ? '' : '它可能已经被删除，返回通讯录看看。'"
          />
        </section>

        <!-- ══ 根屏：通讯录 / 最近通话 / 拨号键盘 ══
             key 固定为 root（不带 tab）—— tab 切换是"同一屏换内容"，
             换 key 会让 Transition 把整块当成新页面推拉一次，那是页面跳转才该有的动效。 -->
        <section
          v-else
          key="root"
          class="pui-ph__screen"
          :data-testid="`phone-${tab}-screen`"
        >
          <!-- 通讯录：居中"联系人" + 右侧加号。左侧留一个空格子而不是返回键 ——
               通讯录和最近通话、拨号一样是 tab 直达的平级页面，没有"上一页"可回。 -->
          <header v-if="tab === 'contacts'" class="pui-ph__nav pui-ph__nav--round">
            <span></span>
            <button
              type="button"
              class="pui-ph__nav-title"
              data-testid="phone-title"
              @click="goHome"
            >
              联系人
            </button>
            <!-- 与拨号页左上同口径：真按钮，点一下给一瞬高亮，不跳页（作品端只读） -->
            <button
              type="button"
              class="pui-ph__roundbtn"
              :class="{ 'pui-ph__roundbtn--ping': pingedTab === 'contactsAdd' }"
              data-testid="phone-contacts-add"
              aria-label="添加联系人"
              @pointerdown="pingTabDown('contactsAdd')"
              @pointerup="pingTabUp"
              @pointercancel="pingTabUp"
              @pointerleave="pingTabUp"
              @click="pingTab('contactsAdd')"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 5.5v13M5.5 12h13" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" />
              </svg>
            </button>
          </header>

          <!-- 最近通话：编辑 / 最近通话 / ＋ -->
          <header v-else-if="tab === 'recents'" class="pui-ph__nav">
            <!-- 编辑 / ＋ 与通讯录右上、拨号左上同口径：真按钮 + 一瞬高亮，不跳页 -->
            <button
              type="button"
              class="pui-ph__nav-side"
              :class="{ 'pui-ph__nav-side--ping': pingedTab === 'recentsEdit' }"
              data-testid="phone-recents-edit"
              @pointerdown="pingTabDown('recentsEdit')"
              @pointerup="pingTabUp"
              @pointercancel="pingTabUp"
              @pointerleave="pingTabUp"
              @click="pingTab('recentsEdit')"
            >
              编辑
            </button>
            <button
              type="button"
              class="pui-ph__nav-title"
              data-testid="phone-title"
              @click="goHome"
            >
              最近通话
            </button>
            <button
              type="button"
              class="pui-ph__nav-side pui-ph__nav-side--end"
              :class="{ 'pui-ph__nav-side--ping': pingedTab === 'recentsAdd' }"
              data-testid="phone-recents-add"
              aria-label="添加联系人"
              @pointerdown="pingTabDown('recentsAdd')"
              @pointerup="pingTabUp"
              @pointercancel="pingTabUp"
              @pointerleave="pingTabUp"
              @click="pingTab('recentsAdd')"
            >
              ＋
            </button>
          </header>

          <header v-else class="pui-ph__nav pui-ph__nav--round">
            <!-- 与底部两颗装饰 tab 同口径：真按钮，点一下只给一瞬高亮，
                 不切 tab、不跳屏、不改作品数据（功能暂未开放，先把手感补齐）。 -->
            <button
              type="button"
              class="pui-ph__addbtn"
              :class="{ 'pui-ph__addbtn--ping': pingedTab === 'add' }"
              data-testid="phone-dial-add"
              aria-label="添加联系人"
              @pointerdown="pingTabDown('add')"
              @pointerup="pingTabUp"
              @pointercancel="pingTabUp"
              @pointerleave="pingTabUp"
              @click="pingTab('add')"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="11" cy="8.4" r="3.5" fill="none" stroke="currentColor" stroke-width="1.8" />
                <path d="M4.4 19.2c.8-3.4 3.4-5.2 6.6-5.2 1 0 1.9.2 2.8.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
                <path d="M18.4 13.4v5.2M15.8 16h5.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
              </svg>
            </button>
            <button
              type="button"
              class="pui-ph__nav-title"
              data-testid="phone-title"
              @click="goHome"
            >
              拨号
            </button>
            <span></span>
          </header>

          <!-- ══ 通讯录 ══ -->
          <template v-if="tab === 'contacts'">
            <!-- index 条要贴着"列表区"而不是整屏：只在导航栏与 tab 栏之间铺满 -->
            <div class="pui-ph__list">
              <ScrollArea
                v-if="groups.length"
                scroll-key="phone:contacts"
                :padding-bottom="14"
              >
                <!-- 我的名片：与其它联系人行一样是真按钮，点进详情屏。
                     头像 / 名字与详情页同源（buildMyCard），有资产就显示机主照片。 -->
                <button
                  type="button"
                  class="pui-ph__card"
                  data-testid="phone-my-card"
                  @click="openMyCard"
                >
                  <Avatar
                    :asset-id="myCard.avatarAssetId"
                    :name="myCard.name"
                    :size="44"
                    :background="AVATAR_BG"
                  />
                  <span class="pui-ph__card-text">我的名片</span>
                </button>
                <div v-for="group in groups" :key="group.letter" class="pui-ph__group">
                  <h2 class="pui-ph__group-head">{{ group.letter }}</h2>
                  <ul class="pui-ph__rows">
                    <li v-for="contact in group.items" :key="contact.id">
                      <button
                        type="button"
                        class="pui-ph__row"
                        :class="{ 'pui-ph__row--last': isRowLast(contact, group) }"
                        data-testid="phone-contact-row"
                        @click="openContact(contact.id)"
                      >
                        <Avatar
                          :asset-id="contact.avatarAssetId"
                          :name="contact.name"
                          :size="44"
                          :background="AVATAR_BG"
                        />
                        <span class="pui-ph__row-main">
                          <span class="pui-ph__row-name">{{ contact.name }}</span>
                          <span v-if="contact.note" class="pui-ph__row-sub">{{ contact.note }}</span>
                        </span>
                      </button>
                    </li>
                  </ul>
                </div>
              </ScrollArea>

              <EmptyState
                v-else
                title="还没有联系人"
              />

              <div v-if="groups.length" class="pui-ph__index" aria-hidden="true">
                <span v-for="letter in INDEX_LETTERS" :key="letter">{{ letter }}</span>
              </div>
            </div>
          </template>

          <!-- ══ 最近通话 ══ -->
          <div v-else-if="tab === 'recents'" class="pui-ph__body">
            <ScrollArea v-if="calls.length" scroll-key="phone:recents" :padding-bottom="14">
              <ul class="pui-ph__rows">
                <li v-for="call in calls" :key="call.id">
                  <div class="pui-ph__call" data-testid="phone-call-row">
                    <button
                      type="button"
                      class="pui-ph__call-redial"
                      data-testid="phone-call-redial"
                      :aria-label="`回拨 ${call.name}`"
                      :disabled="!call.dialNumber"
                      @click="redial(call)"
                    >
                      <!--
                        陌生号码没有头像可继承，画一个人形占位（真机就是这样）。
                        不能拿号码首字当头像 —— "1" 长在圆圈里像个未读角标。
                      -->
                      <span v-if="call.stranger" class="pui-ph__call-anon" aria-hidden="true">
                        <svg viewBox="0 0 24 24">
                          <path
                            d="M12 12.4a4.1 4.1 0 1 0 0-8.2 4.1 4.1 0 0 0 0 8.2Zm0 1.9c-3.5 0-6.4 2.2-6.4 4.9v.6c0 .5.4.9.9.9h11c.5 0 .9-.4.9-.9v-.6c0-2.7-2.9-4.9-6.4-4.9Z"
                            fill="currentColor"
                          />
                        </svg>
                      </span>
                      <Avatar
                        v-else
                        :asset-id="call.avatarAssetId"
                        :name="call.name"
                        :size="44"
                        :background="AVATAR_BG"
                      />
                      <span class="pui-ph__call-main">
                        <span class="pui-ph__call-text">
                          <span
                            class="pui-ph__call-name"
                            :class="{ 'pui-ph__call-name--missed': call.type === 'missed' }"
                          >{{ call.name }}</span>
                          <span class="pui-ph__call-type">
                            <svg
                              class="pui-ph__call-arrow"
                              :class="{ 'pui-ph__call-arrow--in': call.type !== 'outgoing' }"
                              viewBox="0 0 24 24"
                              aria-hidden="true"
                            >
                              <path
                                d="M6.6 6.6l10.8 10.8M17.4 17.4h-7M17.4 17.4v-7"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                              />
                            </svg>
                            {{ call.phoneNumber || call.typeLabel }}
                          </span>
                        </span>
                        <span class="pui-ph__call-time">{{ call.timeLabel }}</span>
                      </span>
                    </button>
                    <!--
                      iOS 18 口径：行尾是「信息」钮，图标只有一个衬线小写 i，
                      浅灰圆形是按钮底色而非图标描边，别画成 ⓘ（带圈的 info）。
                      点开该行联系人详情，不是回拨。
                    -->
                    <button
                      type="button"
                      class="pui-ph__callbtn pui-ph__callbtn--sm"
                      data-testid="phone-call-info"
                      aria-label="查看联系人"
                      @click="openContact(call.contactId)"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <rect x="10.2" y="2.9" width="3.6" height="3.6" rx="0.9" fill="currentColor" />
                        <rect x="7.7" y="8.8" width="6.1" height="1.8" fill="currentColor" />
                        <rect x="10.2" y="10.6" width="3.6" height="8.4" fill="currentColor" />
                        <rect x="7.7" y="19" width="8.6" height="1.8" fill="currentColor" />
                      </svg>
                    </button>
                  </div>
                </li>
              </ul>
            </ScrollArea>

            <EmptyState
              v-else
              title="还没有通话记录"
            />
          </div>

          <!-- ══ 拨号键盘 ══ -->
          <div v-else class="pui-ph__dial">
            <!-- 两个 span 紧挨着写：中间不能留空白文本节点，否则 textContent
                 会多出空格，号码显示和分组都会走样。删除时不重建末位，不播动画。 -->
            <div class="pui-ph__dial-num" data-testid="phone-dial-number">
              <span
                class="pui-ph__dial-num-head"
              >{{ dialHead }}</span><span
                v-if="dialDisplay"
                :key="numTick"
                class="pui-ph__dial-num-last"
              >{{ dialTail }}</span>
            </div>

            <div class="pui-ph__dial-hint">
              <Transition name="pui-ph-fade">
                <button
                  v-if="dialMatch"
                  type="button"
                  class="pui-ph__dial-name"
                  data-testid="phone-dial-match"
                  :aria-label="`填入 ${dialMatch.name} 的号码`"
                  @click="fillMatchedNumber"
                >
                  {{ dialMatch.name }}
                </button>
              </Transition>
            </div>

            <div class="pui-ph__dial-main">
              <div class="pui-ph__keypad">
                <button
                  v-for="key in KEYS"
                  :key="key.digit"
                  type="button"
                  class="pui-ph__key"
                  :class="{ 'pui-ph__key--flash': flashedKey === key.digit }"
                  :data-testid="`phone-key-${key.digit}`"
                  :aria-label="key.letters ? `${key.digit} ${key.letters}` : key.digit"
                  @pointerdown="startKeyHold($event, key.digit)"
                  @pointerup="clearKeyHold"
                  @pointercancel="clearKeyHold"
                  @pointerleave="clearKeyHold"
                  @click="onKeyClick($event, key.digit)"
                >
                  <span class="pui-ph__key-digit">{{ key.digit }}</span>
                  <span v-if="key.letters" class="pui-ph__key-letters">{{ key.letters }}</span>
                </button>
              </div>

              <div class="pui-ph__dial-foot">
                <!-- 呼叫是真的：进 iOS 18 风格的通话屏。空号时禁用（真机同款行为） -->
                <button
                  type="button"
                  class="pui-ph__callbtn"
                  data-testid="phone-dial-call"
                  aria-label="呼叫"
                  :disabled="!digits"
                  @click="startDialCall"
                >
                  <svg viewBox="0 0 24 24">
                    <path
                      d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"
                      fill="currentColor"
                    />
                  </svg>
                </button>
                <!-- 空号时整个删除键不渲染，输入第一位数字或长按 0 得到 + 后淡入
                     （与真机一致）。长按 400ms 后连删；短按仍由 click 只删一位。 -->
                <Transition name="pui-ph-fade">
                  <button
                    v-if="digits || intlPrefix"
                    type="button"
                    class="pui-ph__delbtn"
                    data-testid="phone-dial-delete"
                    aria-label="删除一位数字"
                    @pointerdown="startBackspaceHold"
                    @pointerup="clearBackspaceHold"
                    @pointercancel="clearBackspaceHold"
                    @pointerleave="clearBackspaceHold"
                    @click="onBackspaceClick"
                  >
                    <!--
                      删除键 = 经典退格键五边形：左端一个小尖角（尖头只带极小的圆），
                      上下边平直，右端 5px 圆角。灰底由 svg 画，按钮本身透明，
                      按压只换笔身填充。
                    -->
                    <svg viewBox="0 0 42 30" aria-hidden="true">
                      <path
                        class="pui-ph__delbtn-body"
                        d="M2.2 15c0-.8.3-1.6.9-2.2L10.3 5c.7-.7 1.6-1 2.6-1H33c2.8 0 5 2.2 5 5v12c0 2.8-2.2 5-5 5H12.9c-1 0-1.9-.4-2.6-1l-7.2-7.8C2.5 16.6 2.2 15.8 2.2 15z"
                        fill="#e7e7e9"
                      />
                      <path
                        d="M19.5 10.5l9 9M28.5 10.5l-9 9"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                      />
                    </svg>
                  </button>
                </Transition>
              </div>
            </div>
          </div>
        </section>
      </Transition>
    </div>

    <!-- ══ 底部五 tab（详情页也保留，和真机一致；通话屏全屏接管，不显示） ══ -->
    <nav v-if="!isCall" class="pui-ph__tabbar" aria-label="电话导航">
      <button
        type="button"
        class="pui-ph__tab"
        :class="{ 'pui-ph__tab--ping': pingedTab === 'favorites' }"
        data-testid="phone-tab-favorites"
        aria-label="个人收藏"
        @pointerdown="pingTabDown('favorites')"
        @pointerup="pingTabUp"
        @pointercancel="pingTabUp"
        @pointerleave="pingTabUp"
        @click="pingTab('favorites')"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M12 4.2l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4-3.9-3.8 5.4-.8z"
            fill="none"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linejoin="round"
          />
        </svg>
        <i>个人收藏</i>
      </button>

      <button
        type="button"
        class="pui-ph__tab"
        :class="{ 'pui-ph__tab--on': tab === 'recents' }"
        data-testid="phone-tab-recents"
        @click="setTab('recents')"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="8.4" fill="none" stroke="currentColor" stroke-width="1.7" />
          <path d="M12 7.6V12l3 1.9" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
        </svg>
        <i>最近通话</i>
      </button>

      <button
        type="button"
        class="pui-ph__tab"
        :class="{ 'pui-ph__tab--on': tab === 'contacts' }"
        data-testid="phone-tab-contacts"
        @click="setTab('contacts')"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="8.6" r="3.6" fill="none" stroke="currentColor" stroke-width="1.7" />
          <path d="M4.8 19.4c.9-3.6 3.7-5.6 7.2-5.6s6.3 2 7.2 5.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
        </svg>
        <i>通讯录</i>
      </button>

      <button
        type="button"
        class="pui-ph__tab"
        :class="{ 'pui-ph__tab--on': tab === 'dial' }"
        data-testid="phone-tab-dial"
        @click="setTab('dial')"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="4" y="4" width="4.4" height="4.4" rx="1.2" fill="currentColor" />
          <rect x="9.8" y="4" width="4.4" height="4.4" rx="1.2" fill="currentColor" />
          <rect x="15.6" y="4" width="4.4" height="4.4" rx="1.2" fill="currentColor" />
          <rect x="4" y="9.8" width="4.4" height="4.4" rx="1.2" fill="currentColor" />
          <rect x="9.8" y="9.8" width="4.4" height="4.4" rx="1.2" fill="currentColor" />
          <rect x="15.6" y="9.8" width="4.4" height="4.4" rx="1.2" fill="currentColor" />
          <rect x="4" y="15.6" width="4.4" height="4.4" rx="1.2" fill="currentColor" />
          <rect x="9.8" y="15.6" width="4.4" height="4.4" rx="1.2" fill="currentColor" />
          <rect x="15.6" y="15.6" width="4.4" height="4.4" rx="1.2" fill="currentColor" />
        </svg>
        <i>拨号键盘</i>
      </button>

      <button
        type="button"
        class="pui-ph__tab"
        :class="{ 'pui-ph__tab--ping': pingedTab === 'voicemail' }"
        data-testid="phone-tab-voicemail"
        aria-label="语音留言"
        @pointerdown="pingTabDown('voicemail')"
        @pointerup="pingTabUp"
        @pointercancel="pingTabUp"
        @pointerleave="pingTabUp"
        @click="pingTab('voicemail')"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="7.4" cy="12" r="3.6" fill="none" stroke="currentColor" stroke-width="1.7" />
          <circle cx="16.6" cy="12" r="3.6" fill="none" stroke="currentColor" stroke-width="1.7" />
          <path d="M11 12h2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
        </svg>
        <i>语音留言</i>
      </button>
    </nav>
  </div>
</template>

<style scoped src="./PhoneApp.css"></style>
