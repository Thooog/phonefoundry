/**
 * 「电话」应用的编辑操作 —— 联系人 + 通话记录。
 *
 * 与其他 editing/*.js 同一套约定（见 photos.js 文件头）。
 *
 * 三处刻意的设计：
 *
 * 1. **联系人头像不单独上传，靠关联角色继承。**
 *    作品端 buildContacts 的派生分支本来就是这个语义（角色的 phone 账号
 *    带什么头像，通讯录就显示什么）。编辑端再放一个上传口，会让同一张脸
 *    在项目里存两份二进制 —— 而且用户改角色头像时不会想到还要来这里改。
 *
 * 2. **删联系人必须连带删他的通话记录。**
 *    calls.contactId 是单向引用，联系人删掉后 buildCallLog 会把它渲染成
 *    「未知号码」并堆在通话页顶部。那不是"保留现场"，那是脏数据。
 *
 * 3. **通话记录不必挂在联系人身上。**
 *    陌生号码来电是捡手机文学里最常用的钩子（"138xxxx 打了三次"），
 *    所以通话有两种归属：contactId（通讯录里的人）或 phoneNumber（野号码），
 *    两个都空则是"无主叫号码"。两者互斥 —— 选了联系人就把号码清掉，
 *    否则数据里同时挂着两个身份，作品端只能显示一个，剩下那个就是谎言。
 */

import { buildContacts, createCallRecord, createContact } from '@phone-sim/shared'

/** 姓名上限。通讯录列表是单行，超过 12 个字在手机上就已经被截断了 */
export const CONTACT_NAME_MAX_LENGTH = 30

/** 号码上限。留给国际号码与分隔符（+86 138 0013 8000）也够 */
export const PHONE_NUMBER_MAX_LENGTH = 24

/** 备注上限。它在联系人详情里显示，太长会把页面撑开 */
export const CONTACT_NOTE_MAX_LENGTH = 200

/** 通话类型。与作品端的 CALL_TYPE_LABEL 一一对应 */
export const CALL_TYPES = Object.freeze([
  { value: 'incoming', label: '来电' },
  { value: 'outgoing', label: '呼出' },
  { value: 'missed', label: '未接来电' },
])

const CALL_TYPE_VALUES = new Set(CALL_TYPES.map((t) => t.value))

const nowIso = () => new Date().toISOString()

function ensureBucket(project) {
  if (!project.appData || typeof project.appData !== 'object') project.appData = {}
  if (!project.appData.phone) project.appData.phone = { contacts: [], calls: [] }

  const bucket = project.appData.phone
  if (!Array.isArray(bucket.contacts)) bucket.contacts = []
  if (!Array.isArray(bucket.calls)) bucket.calls = []
  return bucket
}

function timeOf(value) {
  const t = new Date(value ?? 0).getTime()
  return Number.isNaN(t) ? -Infinity : t
}

/**
 * 联系人按拼音排序，与作品端通讯录顺序一致。
 *
 * 用 Intl 的中文 collation 而不是 localeCompare 默认行为：
 * 后者在部分运行时按码位排，会把「周」扔到「陈」前面。
 */
export function sortContactsByName(contacts) {
  return [...(contacts ?? [])].sort((a, b) =>
    String(a.name ?? '').localeCompare(String(b.name ?? ''), 'zh-Hans-CN'),
  )
}

/** 通话记录按时间倒序（新的在前），与作品端通话页一致 */
export function sortCallsByTime(calls) {
  return [...(calls ?? [])].sort((a, b) => timeOf(b.displayTime) - timeOf(a.displayTime))
}

/**
 * 编辑端能选到的"全部联系人"。
 *
 * 直接借用作品端的派生结果：显式录入的联系人 + 由角色 phone 账号派生出来的。
 * 这样用户在通话记录里能选到作品里真实存在的每一个人，
 * 而不是只在"我自己手动加过的那几个"里挑。
 *
 * @param {object} project
 */
export function selectableContacts(project) {
  return project ? buildContacts(project) : []
}

/* ── 联系人 ─────────────────────────────────────── */

const CONTACT_EDITABLE = ['name', 'phoneNumber', 'note', 'characterId', 'avatarAssetId']

function pickContactEditable(patch) {
  const clean = {}
  for (const key of CONTACT_EDITABLE) {
    if (patch?.[key] !== undefined) clean[key] = patch[key]
  }
  return clean
}

/**
 * 新建联系人。
 *
 * @param {object} editor
 * @param {{name?: string, phoneNumber?: string, note?: string, characterId?: string|null}} [input]
 * @returns {object} 新建的联系人记录
 */
export function addContact(editor, input = {}) {
  const contact = createContact({
    name: String(input.name ?? '').slice(0, CONTACT_NAME_MAX_LENGTH),
    phoneNumber: String(input.phoneNumber ?? '').slice(0, PHONE_NUMBER_MAX_LENGTH),
    note: String(input.note ?? '').slice(0, CONTACT_NOTE_MAX_LENGTH),
    characterId: input.characterId ?? null,
  })

  editor.mutate((draft) => {
    const bucket = ensureBucket(draft)
    bucket.contacts = [...bucket.contacts, contact]
  })

  return contact
}

/**
 * 改联系人。
 *
 * characterId 传 null 是**有效修改**（解除关联），所以这里不能用
 * `patch[key] !== undefined` 之外的真值判断把它过滤掉。
 *
 * @param {object} editor
 * @param {string} contactId
 * @param {object} patch
 * @returns {object|null}
 */
export function updateContact(editor, contactId, patch) {
  const clean = pickContactEditable(patch)
  if (Object.keys(clean).length === 0) return null

  const next = { ...clean }
  if (next.name !== undefined) next.name = String(next.name).slice(0, CONTACT_NAME_MAX_LENGTH)
  if (next.phoneNumber !== undefined) {
    next.phoneNumber = String(next.phoneNumber).slice(0, PHONE_NUMBER_MAX_LENGTH)
  }
  if (next.note !== undefined) next.note = String(next.note).slice(0, CONTACT_NOTE_MAX_LENGTH)

  let updated = null
  editor.mutate((draft) => {
    const bucket = ensureBucket(draft)
    bucket.contacts = bucket.contacts.map((contact) => {
      if (contact.id !== contactId) return contact
      updated = { ...contact, ...next, updatedAt: nowIso() }
      return updated
    })
  })

  return updated
}

/**
 * 删联系人，连带删掉挂在它名下的通话记录。
 *
 * @param {object} editor
 * @param {string} contactId
 * @returns {{removed: boolean, removedCalls: number}}
 */
export function deleteContact(editor, contactId) {
  let removed = false
  let removedCalls = 0

  editor.mutate((draft) => {
    const bucket = ensureBucket(draft)

    const keptContacts = bucket.contacts.filter((contact) => contact.id !== contactId)
    removed = keptContacts.length !== bucket.contacts.length
    bucket.contacts = keptContacts

    const keptCalls = bucket.calls.filter((call) => call.contactId !== contactId)
    removedCalls = bucket.calls.length - keptCalls.length
    bucket.calls = keptCalls
  })

  return { removed, removedCalls }
}

/**
 * 该联系人身上有多少条通话记录 —— 删除确认框要说清楚会连带删掉多少。
 * @param {object} project
 * @param {string} contactId
 */
export function countCallsOfContact(project, contactId) {
  return (project?.appData?.phone?.calls ?? []).filter((c) => c.contactId === contactId).length
}

/* ── 通话记录 ───────────────────────────────────── */

const CALL_EDITABLE = ['contactId', 'phoneNumber', 'type', 'displayTime', 'durationSec']

/** 陌生号码归一：去首尾空白、截长度。空串是合法值（= 没有号码） */
function normalizeCallNumber(value) {
  return String(value ?? '').trim().slice(0, PHONE_NUMBER_MAX_LENGTH)
}

/**
 * 时长（秒）归一化：负数、NaN、超大值都收进合理范围。
 *
 * 上限 24 小时：捡手机文学里的一通电话不可能更长，
 * 而误输入一个极大值时，作品端会显示「9999:59:59」这种一眼假的东西。
 */
const MAX_DURATION_SEC = 24 * 3600

function normalizeDuration(value) {
  const n = Math.round(Number(value) || 0)
  if (n <= 0) return 0
  return Math.min(n, MAX_DURATION_SEC)
}

/**
 * 新建通话记录。
 *
 * contactId 与 phoneNumber 二选一：
 *   addCall(editor, { contactId: 'con_x' })            // 通讯录里的人
 *   addCall(editor, { phoneNumber: '13800138000' })     // 陌生号码
 *   addCall(editor, {})                                 // 无主叫号码
 *
 * @param {object} editor
 * @param {{contactId?: string|null, phoneNumber?: string, type?: string,
 *          displayTime?: string, durationSec?: number}} [input]
 * @returns {object} 新建的通话记录
 */
export function addCall(editor, input = {}) {
  const contactId = input.contactId ?? null
  const call = createCallRecord(contactId, {
    type: CALL_TYPE_VALUES.has(input.type) ? input.type : 'incoming',
    durationSec: normalizeDuration(input.durationSec),

    phoneNumber: contactId ? '' : normalizeCallNumber(input.phoneNumber),
    ...(input.displayTime ? { displayTime: input.displayTime } : {}),
  })

  editor.mutate((draft) => {
    const bucket = ensureBucket(draft)
    bucket.calls = [...bucket.calls, call]
  })

  return call
}

export function updateCall(editor, callId, patch) {
  const clean = {}
  for (const key of CALL_EDITABLE) {
    if (patch?.[key] !== undefined) clean[key] = patch[key]
  }
  if (Object.keys(clean).length === 0) return null

  if (clean.type !== undefined && !CALL_TYPE_VALUES.has(clean.type)) delete clean.type
  if (clean.durationSec !== undefined) clean.durationSec = normalizeDuration(clean.durationSec)
  if (clean.phoneNumber !== undefined) clean.phoneNumber = normalizeCallNumber(clean.phoneNumber)

  let updated = null
  editor.mutate((draft) => {
    const bucket = ensureBucket(draft)
    bucket.calls = bucket.calls.map((call) => {
      if (call.id !== callId) return call
      const next = { ...call, ...clean }
      if (next.type === 'missed') next.durationSec = 0

      if (next.contactId) next.phoneNumber = ''
      updated = next
      return next
    })
  })

  return updated
}

/**
 * 删一条通话记录。
 * @param {object} editor
 * @param {string} callId
 * @returns {boolean}
 */
export function deleteCall(editor, callId) {
  let removed = false
  editor.mutate((draft) => {
    const bucket = ensureBucket(draft)
    const kept = bucket.calls.filter((call) => call.id !== callId)
    removed = kept.length !== bucket.calls.length
    bucket.calls = kept
  })
  return removed
}
