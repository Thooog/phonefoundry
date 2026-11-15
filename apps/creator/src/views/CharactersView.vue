<script setup>

import { computed, ref, shallowRef, watch, onBeforeUnmount, inject, nextTick } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { useMediaQuery } from '../composables/use-media-query.js'
import RoleActions from '../components/workspace/RoleActions.vue'
import { PLATFORM_SCHEMAS, analyzeCharacterRemoval, getPlatformSchema } from '@phone-sim/shared'
import { useProjectStore } from '../stores/project.js'
import { useUiStore } from '../stores/ui.js'
import { prepareImage } from '../media/compress-image.js'
import { classifyImage } from '../media/image-format.js'
import { useAssetUrls } from '../composables/use-asset-urls.js'
import {
  addCharacter,
  addPlatformAccount,
  removeCharacter,
  removePlatformAccount,
  updateCharacter,
  updatePlatformAccount,
} from '../editing/characters.js'
import { orphanAssetIds } from '../editing/assets.js'
import AppIcon from '../components/ui/AppIcon.vue'
import AppButton from '../components/ui/AppButton.vue'
import AppInput from '../components/ui/AppInput.vue'
import AppUploadButton from '../components/ui/AppUploadButton.vue'
import ImageEditDialog from '../components/ui/ImageEditDialog.vue'

const editor = useProjectStore()
const ui = useUiStore()

/** 上传头像前先过一遍裁剪 / 调节；它在模板末尾挂载，开口是 Promise 式的 */
const imageEditor = ref(null)

/**
 * X 个人主页背景图的比例：真机是 600×200 的横幅。
 * 作品端那条横幅只有 390×123 左右，所以必须让作者自己决定露出哪一段。
 */
const BANNER_RATIO = 3

/**
 * 把选中的文件变成可落盘的素材。
 *
 * 头像在作品里只是一个 46~54px 的小圆，直接存整张原图往往脸都看不清，
 * 所以静态图先弹一个 1:1 的裁剪框（只能缩放 / 移动，不调比例和滤镜）。
 * GIF 不进裁剪 —— canvas 只画第一帧，裁完动图就变静图了，那种图原样保留更诚实。
 * 用户取消返回 null。
 */
async function prepareAvatar(file) {
  if (classifyImage(file) !== 'raster') return prepareImage(file)
  return (await imageEditor.value?.open(file)) ?? null
}

/**
 * 主页背景图：同一个裁剪框，换成 3:1。
 * 背景图在作品里是通栏横幅，1:1 裁出来的方图铺上去只会剩中间一条，
 * 所以比例绝不能沿用头像那套。
 */
async function prepareBanner(file) {
  if (classifyImage(file) !== 'raster') return prepareImage(file)
  return (
    (await imageEditor.value?.open(file, {
      ratio: BANNER_RATIO,
      title: '调整主页背景图',
      hint: '拖动移动位置，滚轮或双指缩放，框内就是个人主页顶部显示的横幅',
    })) ?? null
  )
}

const isNarrow = useMediaQuery('(max-width: 767px)')
const detailOpen = ref(false)
const readOnly = computed(() => editor.isReadOnly)

const project = computed(() => editor.project)
const characters = computed(() => project.value?.characters ?? [])
const accounts = computed(() => project.value?.platformAccounts ?? [])

const ownerId = computed(() => project.value?.workSettings?.ownerCharacterId ?? null)

/** 当前展开编辑账号表单的 accountId */
const openAccountId = ref(null)
/** 账号表单草稿：避免每敲一个字就写一次库 */
const draft = ref(null)
const profileDraft = ref({ id: '', name: '', description: '', avatarAssetId: null, originalAvatarId: null })
const profileAvatar = shallowRef(null)
const profileAvatarUrl = ref('')

/** 把角色的头像 + 所有账号头像 + 账号背景图都拉成可用的 <img src> */
const { urls } = useAssetUrls(editor, () => [
  ...characters.value.map((c) => c.avatarAssetId),
  ...accounts.value.map((a) => a.avatarAssetId),
  ...accounts.value.map((a) => a.bannerAssetId),
  ...(draft.value ? [draft.value.values.avatarAssetId, draft.value.values.bannerAssetId] : []),
  profileDraft.value.avatarAssetId,
])

function avatarUrl(assetId) {
  return assetId ? urls.value.get(assetId) ?? '' : ''
}

function initial(name) {
  return Array.from(name || '?')[0]
}

/** 平台显示名：优先用平台自己的说法（「电话 / 联系人」比「电话」更准确） */
function platformLabel(platform) {
  return PLATFORM_SCHEMAS[platform]?.label ?? platform
}

/** 该角色配置了哪些平台账号 */
function accountsOf(characterId) {
  return accounts.value.filter((a) => a.characterId === characterId)
}

/** 某平台需要填的字段，由 PLATFORM_SCHEMAS 决定（编辑端与读取端共用同一份定义） */
function fieldsOf(platform) {
  return getPlatformSchema(platform)?.fields ?? []
}

// ── 角色 ────────────────────────────────────────

async function onCreateCharacter() {
  if (readOnly.value) return
  if (!(await confirmAccountSwitch())) return
  const character = addCharacter(editor, {})
  selectedRecordId.value = character.id
  detailOpen.value = true
  await nextTick()
  openProfile(character)
  ui.toast('已新建人物，填上名字吧')
  return character
}

async function onAvatarFiles(character, files) {
  if (readOnly.value || saving.value) return
  const file = files?.[0]
  if (!file) return
  try {
    const prepared = await prepareAvatar(file)
    if (!prepared) return
    const meta = await editor.addAsset(prepared)
    const previous = character.avatarAssetId
    updateCharacter(editor, character.id, { avatarAssetId: meta.id })

    // 不然每换一次头像项目就胖一点。
    if (previous && orphanAssetIds(project.value).includes(previous)) await editor.removeAsset(previous)
  } catch (error) {
    ui.toast(error?.message ?? '头像上传失败。', { tone: 'danger' })
  }
}

/**
 * 删除角色的影响面文案。
 * 「确定删除？」这种没有实据的确认等于没确认，所以必须说清会失去什么。
 */
function impactMessage(character, impact) {
  const parts = []
  if (impact.messages) parts.push(`${impact.messages} 条消息`)
  if (impact.posts) parts.push(`${impact.posts} 条帖子`)
  if (impact.comments) parts.push(`${impact.comments} 条评论 / 回复`)
  if (impact.conversations) parts.push(`${impact.conversations} 个会话失去成员`)
  if (impact.contacts) parts.push(`${impact.contacts} 条联系人失去关联`)
  if (impact.events) parts.push(`${impact.events} 个日程失去参与者`)

  const lines = []
  if (parts.length) {
    lines.push(`这些内容会失去作者，作品里显示为「已删除角色」：${parts.join('、')}。`)
  } else {
    lines.push('目前没有其他内容引用这个角色。')
  }
  if (impact.orphanAssetIds.length) {
    lines.push(`另有 ${impact.orphanAssetIds.length} 张图片不再被使用，会一并清理。`)
  }
  const accountCount = accountsOf(character.id).length
  if (accountCount) lines.push(`它的 ${accountCount} 个平台账号会同时删除。`)
  return lines.join('\n')
}

async function onRemoveCharacter(character) {
  if (readOnly.value || saving.value) return
  const impact = analyzeCharacterRemoval(project.value, character.id)
  if (impact.isOwner) {
    ui.toast('这是手机所属人，先在「作品设置」里把所属人改成别的角色再删。', {
      tone: 'danger',
    })
    return
  }

  const ok = await ui.confirm({
    title: `删除人物「${character.name || '未命名人物'}」`,
    message: impactMessage(character, impact),
    confirmText: '删除',
    tone: 'danger',
  })
  if (!ok) return

  removeCharacter(editor, character.id)
  // 孤儿图单独一次落盘：宁可留下孤儿再清，也不要让内容指向已经删掉的资源
  if (impact.orphanAssetIds.length) await editor.removeAssets(impact.orphanAssetIds)
  ui.toast('已删除人物')
}

// Account uploads stay in memory until the explicit save; saved avatars are never removed by a draft.
const saving = ref(false)
const stagedAvatar = shallowRef(null)
const stagedAvatarUrl = ref('')
/** 主页背景图同款草稿：上传后先留在内存，点「保存账号」才落盘 */
const stagedBanner = shallowRef(null)
const stagedBannerUrl = ref('')
const draftBaseline = ref('')
const activePlatform = ref('kakaotalk')
// 简介类宽字段（textarea）所在网格行要拉伸填满剩余高度（minmax(112px,1fr)），
// 它前面的行数随平台字段而变（如 IG/X 在昵称/用户名后多了粉丝/关注/关注账号一行）。
// 列数优先看 schema：平台声明 formCols（IG/X 四列栅格——昵称/用户名各占两列，
// 粉丝数/关注数/关注账号一行三格，字段 span 定各自占几列）就用它；否则沿用
// 旧口径：恰好 3 个短字段（信息/电话的显示名称、号码、电子邮件）时宽屏一行
// 三列，其余两列。≤650px 容器单列时每个字段独占一行。用 CSS 变量把「宽字段

const accountFieldRows = computed(() => {
  const platform = activePlatform.value
  const fs = fieldsOf(platform).filter(f => f.type !== 'asset' && f.type !== 'textarea')
  const plain = fs.length
  const formCols = getPlatformSchema(platform)?.formCols
  const cols = formCols ?? (plain === 3 ? 3 : 2)
  return { cols, twoCol: Math.ceil(plain / cols), oneCol: plain }
})
/** 当前平台有没有「主页背景图」这一项（目前只有 X）——没声明就整块不渲染 */
const hasBannerField = computed(() => fieldsOf(activePlatform.value).some(f => f.key === 'bannerAssetId'))
const draftSignature = () => JSON.stringify(draft.value && { values: draft.value.values, extra: draft.value.extra, inheritAvatar: draft.value.inheritAvatar })
const accountDirty = computed(() => Boolean(draft.value && (stagedAvatar.value || stagedBanner.value || draftSignature() !== draftBaseline.value)))
const registry = inject('creator-drafts', null)
const registryKey = Symbol('account-draft')
registry?.set(registryKey, accountDirty)

function clearStagedAvatar() {
  if (stagedAvatarUrl.value) URL.revokeObjectURL(stagedAvatarUrl.value)
  stagedAvatarUrl.value = ''
  stagedAvatar.value = null
}
function clearStagedBanner() {
  if (stagedBannerUrl.value) URL.revokeObjectURL(stagedBannerUrl.value)
  stagedBannerUrl.value = ''
  stagedBanner.value = null
}
function closeAccount() {
  clearStagedAvatar()
  clearStagedBanner()
  closeFollowPick()
  openAccountId.value = null
  draft.value = null
  draftBaseline.value = ''
}
function openAccount(account, platform = account?.platform || activePlatform.value) {
  closeAccount()
  const role = characters.value.find(c => c.id === selectedRecordId.value)
  // 顶层字段（handle / displayName / bio 等）；asset 与 extra 两组单独处理。
  // asset 字段（头像 / 主页背景图）不进表单循环，但仍要进 values ——
  // 保存时是整份 values 落盘的，漏了就等于把作者传过的图清空。
  const values = {}
  for (const f of fieldsOf(platform)) {
    if (f.type === 'asset' || f.group === 'extra') continue
    values[f.key] = account?.[f.key] ?? (f.key === 'displayName' ? role?.name || '' : '')
  }
  for (const f of fieldsOf(platform)) {
    if (f.type !== 'asset') continue
    values[f.key] = account?.[f.key] ?? null
  }
  // extraFields：保留账号里已有的全部自由字段（如 X 的所在地 / 加入时间），
  // 再为本平台声明的 extra 字段补默认值（null / undefined 视作未填 → ''），
  // 确保表单能双向绑定到 draft.extra[f.key]。
  // 数字类字段先转成字符串，匹配 AppInput 的 String 模型，避免类型告警；
  // characters 类字段（关注账号）是 ID 数组，不是数组就当没填 → []。
  const extra = { ...(account?.extraFields ?? {}) }
  for (const f of fieldsOf(platform)) {
    if (f.group !== 'extra') continue
    if (f.type === 'characters') { extra[f.key] = Array.isArray(extra[f.key]) ? [...extra[f.key]] : []; continue }
    extra[f.key] = extra[f.key] == null ? '' : (f.type === 'number' ? String(extra[f.key]) : extra[f.key])
  }
  draft.value = { id: account?.id || null, platform, values, extra, originalAvatarId: account?.avatarAssetId, originalBannerId: account?.bannerAssetId, inheritAvatar: !values.avatarAssetId }
  openAccountId.value = account?.id || null
  draftBaseline.value = draftSignature()
}
async function confirmAccountSwitch() {
  if (saving.value) return false
  return !accountDirty.value || await ui.confirm({ title: '账号资料尚未保存', message: '离开后将丢弃当前账号草稿。', confirmText: '丢弃并离开', cancelText: '继续编辑' })
}
async function selectPlatform(platform) {
  if (platform === activePlatform.value || !(await confirmAccountSwitch())) return
  activePlatform.value = platform
  openAccount(accountsOf(selectedRecordId.value).find(a => a.platform === platform), platform)
}
function setInheritance(value) {
  if (readOnly.value || saving.value || !draft.value) return
  draft.value.inheritAvatar = value
  if (value) { clearStagedAvatar(); draft.value.values.avatarAssetId = null }
}
async function clearAccountAvatar() {
  if (readOnly.value || saving.value || !draft.value) return
  if (!(await ui.confirm({ title: '清除账号头像？', message: '保存账号后将不再使用当前头像，人物头像本身会保留。', confirmText: '清除', tone: 'danger' }))) return
  clearStagedAvatar()
  draft.value.values.avatarAssetId = null
}
async function onAccountAvatarFiles(files) {
  if (readOnly.value || saving.value || !draft.value) return
  const target = draft.value
  try {
    const prepared = files?.[0] && await prepareAvatar(files[0])
    if (!prepared || draft.value !== target || readOnly.value) return
    clearStagedAvatar()
    stagedAvatar.value = prepared
    stagedAvatarUrl.value = URL.createObjectURL(prepared.blob)
    target.inheritAvatar = false
  } catch (error) { ui.toast(error.message || '头像上传失败。', { tone: 'error' }) }
}

/**
 * 主页背景图上传：与头像完全同一套流程（先在内存里，保存时落盘），
 * 差别只有裁剪比例（3:1）和落盘字段（bannerAssetId）。
 * 背景图没有「继承人物头像」的概念，所以不受 inheritAvatar 影响。
 */
async function onAccountBannerFiles(files) {
  if (readOnly.value || saving.value || !draft.value) return
  const target = draft.value
  try {
    const prepared = files?.[0] && await prepareBanner(files[0])
    if (!prepared || draft.value !== target || readOnly.value) return
    clearStagedBanner()
    stagedBanner.value = prepared
    stagedBannerUrl.value = URL.createObjectURL(prepared.blob)
  } catch (error) { ui.toast(error.message || '背景图上传失败。', { tone: 'error' }) }
}
async function clearAccountBanner() {
  if (readOnly.value || saving.value || !draft.value) return
  clearStagedBanner()
  draft.value.values.bannerAssetId = null
}
// ── 关注账号多选下拉（type:'characters' 的表单控件）─────────────
// 值存在 draft.extra[f.key]（角色 ID 数组），保存时规整为 null / 干净数组。
// 单选不关面板、点外部收起，是多选下拉与原生 <select> 的行为差别。
const followPickOpen = ref(false)

function closeFollowPick() { followPickOpen.value = false }

/** 可选项 = 除当前人物外的所有人物（不能关注自己） */
const followPickOptions = computed(() =>
  characters.value
    .filter((c) => c.id !== selectedRecordId.value)
    .map((c) => ({ id: c.id, name: c.name || '未命名人物', avatar: avatarUrl(c.avatarAssetId), initial: c.name ? initial(c.name) : '人' })),
)

function followPickSelected(key) {
  const ids = draft.value?.extra?.[key]
  return Array.isArray(ids) ? ids : []
}

function followPickNames(key) {
  const sels = followPickSelected(key)
  return followPickOptions.value.filter((o) => sels.includes(o.id)).map((o) => o.name)
}

function toggleFollowPick(key, id) {
  if (readOnly.value || saving.value || !draft.value) return
  const ids = followPickSelected(key)
  draft.value.extra[key] = ids.includes(id) ? ids.filter((v) => v !== id) : [...ids, id]
}

/** 点下拉外部收起面板；监听挂在 window 上，卸载时摘掉。
    不能用模板 ref：charpick 处在 v-for 里，ref 会收集成数组 */
function onDocMousedownForPick(e) {
  if (!followPickOpen.value) return
  if (e.target instanceof Element && e.target.closest('.charpick')) return
  closeFollowPick()
}
document.addEventListener('mousedown', onDocMousedownForPick)

async function onSaveAccount() {
  if (readOnly.value || saving.value || !draft.value) return
  const target = draft.value
  const missing = fieldsOf(target.platform).filter(f => f.required && !String(target.values[f.key] ?? '').trim())
  if (missing.length) { ui.toast('请填写' + missing.map(f => f.label).join('、'), { tone: 'error' }); return }
  saving.value = true
  try {
    const previous = target.originalAvatarId
    const previousBanner = target.originalBannerId
    if (stagedAvatar.value) {
      const meta = await editor.addAsset(stagedAvatar.value)
      target.values.avatarAssetId = meta.id
      clearStagedAvatar()
    }
    if (stagedBanner.value) {
      const meta = await editor.addAsset(stagedBanner.value)
      target.values.bannerAssetId = meta.id
      clearStagedBanner()
    }
    if (readOnly.value) throw new Error('当前为只读状态，账号草稿仍保留。')
    // extraFields：把表单里 group:'extra' 的字段规整后并入（数字转 number、
    // 关注列表保持字符串数组、清空转 null），同时保留账号里其它自由字段
    // （如 X 的所在地 / 加入时间），不被覆盖。
    const extra = { ...(target.extra ?? {}) }
    for (const f of fieldsOf(target.platform)) {
      if (f.group !== 'extra') continue
      const raw = extra[f.key]
      if (f.type === 'number') extra[f.key] = (raw === '' || raw == null) ? null : Number(raw)
      else if (f.type === 'characters') {
        const ids = Array.isArray(raw) ? raw.filter((v) => typeof v === 'string' && v) : []
        extra[f.key] = ids.length ? ids : null
      }
      else if (raw === '') extra[f.key] = null
    }
    const values = { ...target.values, avatarAssetId: target.inheritAvatar ? null : target.values.avatarAssetId, extraFields: extra }
    if (!target.id) target.id = addPlatformAccount(editor, selectedRecordId.value, target.platform, values).id
    else updatePlatformAccount(editor, target.id, values)
    await editor.flush()
    if (previous && previous !== values.avatarAssetId && orphanAssetIds(project.value).includes(previous)) await editor.removeAsset(previous)
    if (previousBanner && previousBanner !== values.bannerAssetId && orphanAssetIds(project.value).includes(previousBanner)) await editor.removeAsset(previousBanner)
    openAccount(accounts.value.find(a => a.id === target.id))
    ui.toast('已保存账号资料')
  } catch (error) { ui.toast(error.message || '保存失败，账号草稿已保留。', { tone: 'error' }) }
  finally { saving.value = false }
}
async function onRemoveAccount(account) {
  if (readOnly.value || saving.value) return
  if (!(await ui.confirm({ title: '删除「' + platformLabel(account.platform) + '」账号', message: '该账号发布的内容会保留，并回退到角色或名字显示。', confirmText: '删除', tone: 'danger' }))) return
  removePlatformAccount(editor, account.id)
  await editor.flush()
  if (account.avatarAssetId && orphanAssetIds(project.value).includes(account.avatarAssetId)) await editor.removeAsset(account.avatarAssetId)
  if (account.bannerAssetId && orphanAssetIds(project.value).includes(account.bannerAssetId)) await editor.removeAsset(account.bannerAssetId)
  openAccount(null, activePlatform.value)
  ui.toast('已删除平台账号')
}
import RecordWorkspace from '../components/workspace/RecordWorkspace.vue'
import { useRecordSelection } from '../composables/use-record-selection.js'
const { selectedRecordId, visibleRecords } = useRecordSelection(characters)

const recordItems = computed(() => (project.value?.characters || []).map(record => ({ id: record.id, title: record.name || '未命名人物', subtitle: record.id === ownerId.value ? '手机主人' : record.description || '尚未填写人物介绍', avatar: avatarUrl(record.avatarAssetId), initial: record.name ? initial(record.name) : '人' })))
const profileDialog = ref(null)
const profileNameInput = ref(null)
let profileTrigger
function clearProfileStagedAvatar() {
  if (profileAvatarUrl.value) URL.revokeObjectURL(profileAvatarUrl.value)
  profileAvatarUrl.value = ''
  profileAvatar.value = null
}
async function openProfile(character, event) {
  profileTrigger = event?.currentTarget || document.activeElement
  clearProfileStagedAvatar()
  profileDraft.value = { id: character.id, name: character.name, description: character.description || '', avatarAssetId: character.avatarAssetId, originalAvatarId: character.avatarAssetId }
  profileDialog.value.showModal()
  await nextTick()
  profileNameInput.value?.focus()
}
function closeProfile() {
  if (saving.value) return
  profileDialog.value.close()
  clearProfileStagedAvatar()
  profileTrigger?.focus?.()
}
async function onProfileAvatarFiles(files) {
  if (readOnly.value || saving.value || !files?.[0]) return
  const target = profileDraft.value
  // 裁剪器不在浏览器顶层，先收起资料对话框，避免它遮住裁剪操作。
  profileDialog.value.close()
  try {
    const prepared = await prepareAvatar(files[0])
    if (!prepared || profileDraft.value !== target || readOnly.value) return
    clearProfileStagedAvatar()
    profileAvatar.value = prepared
    profileAvatarUrl.value = URL.createObjectURL(prepared.blob)
  } catch (error) { ui.toast(error.message || '头像上传失败。', { tone: 'error' }) }
  finally { if (profileDialog.value && profileDraft.value === target) profileDialog.value.showModal() }
}
async function clearProfileAvatar() {
  if (readOnly.value || saving.value) return
  if (!(await ui.confirm({ title: '清除人物头像？', message: '保存人物资料后，继承此头像的平台账号也将同步更新。', confirmText: '清除', tone: 'danger' }))) return
  clearProfileStagedAvatar()
  profileDraft.value.avatarAssetId = null
}
async function saveProfile() {
  if (readOnly.value || saving.value) return
  saving.value = true
  let saved = false
  try {
    if (profileAvatar.value) {
      const meta = await editor.addAsset(profileAvatar.value)
      profileDraft.value.avatarAssetId = meta.id
      clearProfileStagedAvatar()
    }
    if (readOnly.value) throw new Error('当前为只读状态，人物资料草稿仍保留。')
    const values = profileDraft.value
    updateCharacter(editor, values.id, { name: values.name.trim(), description: values.description, avatarAssetId: values.avatarAssetId })
    await editor.flush()
    if (values.originalAvatarId && values.originalAvatarId !== values.avatarAssetId && orphanAssetIds(project.value).includes(values.originalAvatarId)) await editor.removeAsset(values.originalAvatarId)
    if (draft.value && !draft.value.id && !accountDirty.value) openAccount(null, activePlatform.value)
    saved = true
  } catch (error) { ui.toast(error.message || '保存失败，人物资料草稿已保留。', { tone: 'error' }) }
  finally { saving.value = false }
  if (saved) closeProfile()
}
async function onPlatformKey(event) {
  const platforms = Object.keys(PLATFORM_SCHEMAS)
  let index = platforms.indexOf(activePlatform.value)
  if (event.key === 'ArrowRight') index = (index + 1) % platforms.length
  else if (event.key === 'ArrowLeft') index = (index - 1 + platforms.length) % platforms.length
  else if (event.key === 'Home') index = 0
  else if (event.key === 'End') index = platforms.length - 1
  else return
  event.preventDefault()
  await selectPlatform(platforms[index])
  document.querySelector('.account-tabs [data-platform="' + activePlatform.value + '"]')?.focus()
}
watch(activePlatform, async () => {
  await nextTick()
  const tab = document.querySelector('.account-tabs [aria-pressed=true]')
  const nav = tab?.parentElement
  if (!nav) return
  const item = tab.getBoundingClientRect(), bounds = nav.getBoundingClientRect()
  if (item.left < bounds.left) nav.scrollLeft += item.left - bounds.left
  else if (item.right > bounds.right) nav.scrollLeft += item.right - bounds.right
})
watch(selectedRecordId, () => {
  const account = accountsOf(selectedRecordId.value)[0]
  activePlatform.value = account?.platform || 'kakaotalk'
  openAccount(account, activePlatform.value)
}, { immediate: true })
onBeforeRouteLeave(confirmAccountSwitch)
onBeforeUnmount(() => { clearStagedAvatar(); clearStagedBanner(); clearProfileStagedAvatar(); registry?.delete(registryKey); document.removeEventListener('mousedown', onDocMousedownForPick) })
</script>

<template>
  <section v-if="project" class="characters" :class="{ 'characters--empty': !characters.length }" data-testid="characters-editor">
    <RecordWorkspace v-model="selectedRecordId" :detail-open="!characters.length || detailOpen" title="人物" heading="人物" search-placeholder="查找人物" :records="recordItems" :before-select="confirmAccountSwitch" @update:detail-open="detailOpen = $event">
      <template #count><span>{{ characters.length ? characters.length + ' 位' : '' }}</span></template>
      <template #empty><p class="characters__list-empty">暂无人物</p></template>
      <template #actions><button type="button" class="characters__add" aria-label="新建人物" :disabled="readOnly || saving" data-testid="add-character" @click="onCreateCharacter"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M12 3v18M3 12h18" /></svg></button></template>
      <template #detail-toolbar><span></span></template>
      <template #default="{ back }">
        <div v-if="!characters.length" class="characters__empty">
          <div class="characters__empty-body">
            <p>还没有人物。先创建一个人物，再为她或他配置平台身份。</p>
            <button type="button" :disabled="readOnly || saving" data-testid="add-character-empty" @click="onCreateCharacter">添加人物</button>
          </div>
        </div>
        <ul v-else class="charlist">
          <li v-for="c in visibleRecords" :key="c.id" class="charcard" :data-character-id="c.id">
            <header class="role-profile">
              <button v-if="isNarrow" type="button" class="characters__back" aria-label="返回人物列表" @click="back"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg></button>
              <div class="role-portrait">
                <AppUploadButton class="role-avatar-upload" title="更换人物头像" :multiple="false" :disabled="readOnly || saving" :test-id="'character-avatar-' + c.id" @files="onAvatarFiles(c, $event)"><span class="charcard__avatar" aria-hidden="true"><img v-if="avatarUrl(c.avatarAssetId)" :src="avatarUrl(c.avatarAssetId)" alt="" /><span v-else>{{ c.name ? initial(c.name) : '人' }}</span></span><span class="sr-only">更换人物头像</span></AppUploadButton>
              </div>
              <div class="role-identity">
                <div class="role-heading"><h2>{{ c.name || '未命名人物' }}</h2><span v-if="c.id === ownerId" class="role-owner">手机主人</span></div>
                <p class="role-description" :class="{ 'role-description--empty': !c.description }">{{ c.description || '尚未填写人物介绍' }}</p>
              </div>
              <div class="role-tools"><button type="button" class="role-edit" :disabled="saving" :data-testid="'edit-character-' + c.id" @click="openProfile(c, $event)">{{ readOnly ? '查看人物资料' : '编辑人物资料' }}</button><RoleActions :character="c" :account="accounts.find(a => a.id === draft?.id)" :owner-id="ownerId" :project-id="project.id" :disabled="readOnly || saving" @remove-character="onRemoveCharacter" @remove-account="onRemoveAccount" /></div>
            </header>

            <section class="accounts" aria-labelledby="accounts-title">
              <h2 id="accounts-title">平台身份</h2>
              <nav class="account-tabs" role="tablist" aria-label="平台身份">
                <button v-for="(schema, platform) in PLATFORM_SCHEMAS" :id="'platform-tab-' + platform" :key="platform" type="button" role="tab" :aria-selected="activePlatform === platform" :aria-pressed="activePlatform === platform" :tabindex="activePlatform === platform ? 0 : -1" aria-controls="account-panel" :data-platform="platform" :disabled="saving" @click="selectPlatform(platform)" @keydown="onPlatformKey"><AppIcon :name="platform" /><span>{{ schema.label }}</span><small class="account-status" :data-configured="accountsOf(c.id).some(a => a.platform === platform)">{{ accountsOf(c.id).some(a => a.platform === platform) ? '已配置' : '未配置' }}</small></button>
              </nav>
              <form v-if="draft" id="account-panel" class="accform" role="tabpanel" :aria-labelledby="'platform-tab-' + activePlatform" :data-testid="'account-form-' + (draft.id || c.id)" @submit.prevent="onSaveAccount">
                <div class="accform__body">
                  <div class="accform__asset">
                    <p class="accform__asset-label">账号头像</p>
                    <span class="accform__thumb"><img v-if="stagedAvatarUrl || avatarUrl(draft.inheritAvatar ? c.avatarAssetId : draft.values.avatarAssetId)" :src="stagedAvatarUrl || avatarUrl(draft.inheritAvatar ? c.avatarAssetId : draft.values.avatarAssetId)" alt="账号头像" /><span v-else>{{ c.name ? initial(c.name) : '人' }}</span></span>
                    <div class="accform__avatar-controls">
                      <div class="accform__avatar-actions"><AppUploadButton :multiple="false" size="sm" :disabled="readOnly || saving || draft.inheritAvatar" :test-id="'account-avatar-' + (draft.id || c.id)" @files="onAccountAvatarFiles">更换头像</AppUploadButton><button v-if="stagedAvatarUrl || draft.values.avatarAssetId" type="button" :disabled="readOnly || saving || draft.inheritAvatar" @click="clearAccountAvatar">清除头像</button></div>
                      <label class="avatar-inherit"><input type="checkbox" :checked="draft.inheritAvatar" :disabled="readOnly || saving" @change="setInheritance($event.target.checked)" />使用人物头像</label>
                    </div>
                    <!-- 主页背景图：只有声明了 bannerAssetId 的平台（目前只有 X）才出现。
                         真机 X 的横幅是 3:1，所以缩略图也按 3:1 摆，别做成方图骗人 -->
                    <div v-if="hasBannerField" class="accform__banner">
                      <p class="accform__asset-label">主页背景图</p>
                      <span class="accform__banner-thumb" data-testid="account-banner-thumb">
                        <img v-if="stagedBannerUrl || avatarUrl(draft.values.bannerAssetId)" :src="stagedBannerUrl || avatarUrl(draft.values.bannerAssetId)" alt="主页背景图" />
                        <span v-else>未设置</span>
                      </span>
                      <div class="accform__banner-actions">
                        <AppUploadButton :multiple="false" size="sm" :disabled="readOnly || saving" :test-id="'account-banner-' + (draft.id || c.id)" @files="onAccountBannerFiles">更换背景</AppUploadButton>
                        <button v-if="stagedBannerUrl || draft.values.bannerAssetId" type="button" :disabled="readOnly || saving" @click="clearAccountBanner">清除背景</button>
                      </div>
                    </div>
                  </div>
                  <div class="accform__fields" :style="{ '--accform-cols': accountFieldRows.cols, '--accform-rows-2col': accountFieldRows.twoCol, '--accform-rows-1col': accountFieldRows.oneCol }">
                    <div v-for="f in fieldsOf(activePlatform).filter(f => f.type !== 'asset')" :key="f.key" class="accform__item" :style="f.type !== 'textarea' && f.span > 1 ? { '--accform-span': f.span } : null" :class="{ 'accform__item--wide': f.type === 'textarea' }">
                      <label :for="c.id + '-' + activePlatform + '-' + f.key">{{ f.label }}</label>
                      <textarea v-if="f.type === 'textarea'" :id="c.id + '-' + activePlatform + '-' + f.key" v-model="draft.values[f.key]" class="accform__input" rows="4" maxlength="200" :disabled="readOnly || saving" :data-testid="'account-field-' + (draft.id || c.id) + '-' + f.key"></textarea>
                      <div v-else-if="f.type === 'characters'" class="charpick" :data-testid="'account-field-' + (draft.id || c.id) + '-' + f.key">
                        <button type="button" class="charpick__toggle" :disabled="readOnly || saving" :aria-expanded="followPickOpen" @click="followPickOpen = !followPickOpen">
                          <span v-if="followPickNames(f.key).length" class="charpick__names">{{ followPickNames(f.key).join('、') }}</span>
                          <span v-else class="charpick__placeholder">{{ f.key === 'friendList' ? '选择好友人物' : '选择关注的账号' }}</span>
                          <svg class="charpick__chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
                        </button>
                        <ul v-if="followPickOpen" class="charpick__panel" :data-testid="'charpick-panel-' + (draft.id || c.id)">
                          <li v-for="opt in followPickOptions" :key="opt.id">
                            <button type="button" class="charpick__opt" :aria-pressed="followPickSelected(f.key).includes(opt.id)" :data-testid="'charpick-opt-' + opt.id" @click="toggleFollowPick(f.key, opt.id)">
                              <span class="charpick__avatar" aria-hidden="true"><img v-if="opt.avatar" :src="opt.avatar" alt="" /><span v-else>{{ opt.initial }}</span></span>
                              <span class="charpick__opt-name">{{ opt.name }}</span>
                              <svg v-if="followPickSelected(f.key).includes(opt.id)" class="charpick__check" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
                            </button>
                          </li>
                          <li v-if="!followPickOptions.length" class="charpick__empty">还没有其他人物，先去新建</li>
                        </ul>
                      </div>
                      <AppInput v-else-if="f.type === 'number'" :id="c.id + '-' + activePlatform + '-' + f.key" v-model="draft.extra[f.key]" type="number" min="0" :required="f.required" :disabled="readOnly || saving" :data-testid="'account-field-' + (draft.id || c.id) + '-' + f.key" />
                      <span v-else class="accform__text-input" :dir="f.key === 'handle' || f.key === 'phoneNumber' ? 'ltr' : undefined" :class="{ 'accform__text-input--prefixed': f.prefix && !draft.values[f.key]?.startsWith(f.prefix) }"><span v-if="f.prefix && !draft.values[f.key]?.startsWith(f.prefix)" class="accform__field-prefix" aria-hidden="true">{{ f.prefix }}</span><AppInput :id="c.id + '-' + activePlatform + '-' + f.key" v-model="draft.values[f.key]" :required="f.required" :disabled="readOnly || saving" :data-testid="'account-field-' + (draft.id || c.id) + '-' + f.key" /></span>
                    </div>
                  </div>
                </div>
                <footer class="accform__footer"><p role="status">{{ accountDirty ? '账号改动尚未保存' : draft.id ? '账号资料已保存' : '填写后保存此平台身份' }}</p><AppButton native-type="submit" variant="primary" :disabled="readOnly || saving" :data-testid="'save-account-' + (draft.id || c.id)">{{ saving ? '保存中…' : '保存账号' }}</AppButton></footer>
              </form>
            </section>
          </li>
        </ul>
      </template>
    </RecordWorkspace>
    <dialog ref="profileDialog" class="character-info" aria-labelledby="character-info-title" @click.self="closeProfile" @cancel.prevent="closeProfile">
      <form @submit.prevent="saveProfile">
        <header><h2 id="character-info-title">人物资料</h2><button type="button" aria-label="关闭人物资料" @click="closeProfile">×</button></header>
        <div class="character-info__avatar-row"><span class="character-info__avatar"><img v-if="profileAvatarUrl || avatarUrl(profileDraft.avatarAssetId)" :src="profileAvatarUrl || avatarUrl(profileDraft.avatarAssetId)" alt="人物头像预览" /><span v-else>{{ profileDraft.name ? initial(profileDraft.name) : '人' }}</span></span><div class="character-info__avatar-actions"><AppUploadButton :multiple="false" size="sm" :disabled="readOnly || saving" test-id="profile-avatar-input" @files="onProfileAvatarFiles">更换头像</AppUploadButton><button v-if="profileAvatarUrl || profileDraft.avatarAssetId" type="button" :disabled="readOnly || saving" data-testid="clear-profile-avatar" @click="clearProfileAvatar">清除头像</button></div></div>
        <label for="character-profile-name">人物名称</label><input id="character-profile-name" ref="profileNameInput" v-model="profileDraft.name" maxlength="24" :disabled="readOnly || saving" :data-testid="'character-name-' + profileDraft.id" />
        <label for="character-profile-description">人物介绍</label><textarea id="character-profile-description" v-model="profileDraft.description" rows="4" maxlength="200" :disabled="readOnly || saving" :data-testid="'character-desc-' + profileDraft.id"></textarea>
        <footer><button type="button" @click="closeProfile">{{ readOnly ? '关闭' : '取消' }}</button><button v-if="!readOnly" type="submit" :disabled="saving" data-testid="save-character-profile">保存资料</button></footer>
      </form>
    </dialog>
  </section>
  <ImageEditDialog ref="imageEditor" />
</template>

<style scoped>
.characters{--role-muted:#656864;--role-line:#eceeeb;min-width:0;background:white;min-height:calc(var(--creator-viewport-height,100dvh) - var(--layout-topbar-h,64px));height:100%}
.characters :deep(.record-workspace){grid-template-columns:300px minmax(0,1fr);gap:0;height:100%;min-height:0}
.characters :deep(.record-workspace__index){display:flex;flex-direction:column;min-height:0;padding:24px 12px;border-right:1px solid var(--role-line);background:#fdfdfc}
.characters :deep(.record-workspace__head){display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 8px 18px}
.characters :deep(.record-workspace__head h1){font-size:22px;line-height:1.4;font-weight:600}
.characters :deep(.record-workspace__head h1 small){font-size:12px;color:var(--role-muted);white-space:nowrap}
.characters :deep(.record-workspace__actions){display:flex;align-items:center;gap:12px;margin:0}
.characters__add{display:grid;place-items:center;width:32px;height:32px;border:0;padding:0;background:transparent}
.characters :deep(.record-workspace__search){margin:0 4px 18px}
.characters :deep(.record-workspace__search input){height:38px;min-height:38px;padding:7px 12px 7px 34px;border:1px solid #dfe2dc;border-radius:7px;background:white url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23656864' stroke-width='1.5' stroke-linecap='round'%3E%3Ccircle cx='10.5' cy='10.5' r='7.5'/%3E%3Cpath d='m16 16 5 5'/%3E%3C/svg%3E") no-repeat 12px center/16px;font-size:14px}
.characters :deep(.record-workspace__records){flex:1;min-height:0;overflow-y:auto;scrollbar-width:none;gap:8px}
.characters :deep(.record-workspace__records::-webkit-scrollbar){display:none}
.characters :deep(.record-choice){min-height:68px;padding:10px 12px;border-radius:8px;gap:12px}
.characters :deep(.record-choice:hover),.characters :deep(.record-choice[aria-pressed=true]){background:#f5f3f1}
.characters :deep(.record-choice__avatar),.characters :deep(.record-choice__initial){width:36px;height:36px;background:#eeedea;border-radius:50%;font-family:var(--font-story);font-size:18px;font-weight:400}
.characters :deep(.record-choice strong){font-size:15px;font-weight:600;line-height:1.4}
.characters :deep(.record-choice small){font-size:12px;line-height:1.5;margin-top:4px}
.characters :deep(.record-workspace__detail){padding:48px 36px;min-width:0;overflow-y:auto}
.characters :deep(.record-workspace__toolbar){display:none}
.charlist{padding:0;margin:0;list-style:none}.charcard{width:100%;max-width:1000px;margin:0 auto;min-width:0;container-type:inline-size;container-name:character-detail}
.role-profile{display:grid;grid-template-columns:120px minmax(0,1fr) auto;align-items:start;gap:24px;padding:0 0 26px;border-bottom:1px solid transparent}
.role-portrait{min-width:0;display:flex;flex-direction:column;align-items:center;gap:6px}
.charcard__avatar{display:grid;place-items:center;width:96px;height:96px;border-radius:50%;background:#eeedea;overflow:hidden;font:600 36px/1 var(--font-story)}
.charcard__avatar img,.accform__thumb img{width:100%;height:100%;object-fit:cover;border-radius:inherit;outline:1px solid oklch(0 0 0 / .1);outline-offset:-1px}
.characters :deep(.role-avatar-upload>.ui-btn){display:block;min-height:0;border:0;border-radius:50%;padding:0;background:none}
.characters :deep(.accform__avatar-actions .ui-btn),.accform__avatar-actions>button{min-height:28px;border:0;padding:4px 0;border-radius:4px;background:none;color:var(--role-muted);font-size:12px;line-height:1.5}
.role-identity{min-width:0;padding-top:0}.role-heading{display:flex;align-items:center;flex-wrap:wrap;gap:10px 14px}
.role-heading h2{font:600 28px/1.4 var(--font-story);overflow-wrap:anywhere}
.role-owner{border-inline-start:1px solid #cdd1ca;padding-inline-start:14px;font-size:13px;line-height:1.4;white-space:nowrap}
.role-description{font-size:14px;line-height:1.8;margin-top:16px;overflow-wrap:anywhere;white-space:pre-wrap}.role-description--empty{color:var(--role-muted)}
.role-tools{display:flex;align-items:center;gap:20px;min-width:0;padding-top:4px}.role-edit{min-height:30px;border:0;background:none;padding:4px 0;font-size:13px;white-space:nowrap}
.characters :deep(.role-menu){align-self:center;flex:none;width:32px}
.characters :deep(.role-menu>summary){display:grid;place-items:center;width:32px;height:30px;min-height:30px;border:0;padding:0;background:none}
.characters :deep(.role-menu>div){right:auto;inset-inline-end:0;top:calc(100% + 8px);min-width:200px;gap:4px;padding:8px;border-radius:10px}
.characters :deep(.role-menu>div .ui-btn){justify-content:flex-start;min-height:34px;font-size:13px;border:0;background:none;padding:6px 10px}
.characters :deep(.role-menu a){padding:8px 10px;font-size:13px}
.accounts{padding-top:22px;min-width:0}.accounts>h2{font-size:18px;line-height:1.5;font-weight:600;margin-bottom:12px}
.account-tabs{display:flex;align-items:stretch;justify-content:space-between;gap:24px;min-width:0;overflow-x:auto;scrollbar-width:none;border-bottom:1px solid var(--role-line)}.account-tabs::-webkit-scrollbar{display:none}
.account-tabs>button{display:flex;align-items:center;gap:7px;flex:none;white-space:nowrap;border:0;border-bottom:2px solid transparent;padding:10px 0;min-height:44px;background:none;color:var(--c-text);font-size:13px}
.account-tabs>button[aria-selected=true]{border-bottom-color:var(--c-text)}.account-tabs svg{width:18px;height:18px;flex:none}
.account-status{font-size:12px;line-height:1.5;border-radius:3px;padding:1px 4px;background:#f3f4f2;color:#696e66;white-space:nowrap}.account-status[data-configured=true]{background:#f2f8f3;color:#397354}
.accform{min-width:0;padding-top:24px}.accform__body{display:grid;grid-template-columns:120px minmax(0,1fr);gap:24px;min-width:0}
.accform__asset{display:flex;flex-direction:column;align-items:center;gap:12px;min-width:0}.accform__asset-label{align-self:center;font-size:13px;line-height:1.5}
.accform__thumb{display:grid;place-items:center;width:80px;height:80px;overflow:hidden;border-radius:50%;background:#eeedea;font:600 32px/1 var(--font-story)}
.avatar-inherit{display:flex;align-items:center;gap:7px;font-size:12px;white-space:nowrap}.avatar-inherit input{width:14px;height:14px;margin:0;accent-color:#30322f}
.avatar-inherit,.accform__avatar-actions>button,.accform__avatar-actions :deep(.ui-btn){font-size:12px;line-height:1.5}
.accform__avatar-controls{display:flex;flex-direction:column;align-items:center;gap:12px;min-width:0}.accform__avatar-actions{display:flex;justify-content:center;flex-wrap:wrap;gap:0 12px}
/* 主页背景图：与头像同一栏，但缩略图按真机 3:1（600×200）摆，不做成方图。
   ⚠️ 必须显式 width:100% —— 父级是 column + align-items:center，不写的话这一块会被
   内容宽度撑成收缩宽度，缩略图的 width:100% 也跟着缩，最后只剩一条小窄条。 */
.accform__banner{display:flex;flex-direction:column;align-items:center;gap:8px;margin-top:6px;width:100%;min-width:0}
.accform__banner-thumb{display:grid;place-items:center;width:100%;max-width:104px;aspect-ratio:3/1;overflow:hidden;border-radius:6px;background:#eeedea;color:var(--role-muted);font-size:11px;line-height:1.2}
.accform__banner-thumb img{width:100%;height:100%;object-fit:cover;border-radius:inherit;outline:1px solid oklch(0 0 0 / .1);outline-offset:-1px}
.accform__banner-actions{display:flex;flex-direction:column;align-items:center;gap:2px}
.accform__banner-actions :deep(.ui-btn),.accform__banner-actions>button{min-height:26px;border:0;padding:3px 0;border-radius:4px;background:none;color:var(--role-muted);font-size:12px;line-height:1.5}
.accform__fields{display:grid;grid-template-columns:repeat(var(--accform-cols,2),minmax(0,1fr));gap:18px 24px;align-content:start;min-width:0}
.accform__item{display:grid;gap:8px;align-content:start;min-width:0;grid-column:span var(--accform-span,1)}.accform__item--wide{grid-column:1/-1}.accform__item>label{font-size:13px;line-height:1.5}.accform__prefix{color:var(--role-muted)}.accform__req{font-size:12px;color:var(--role-muted)}
.characters :deep(.accform .ui-input){width:100%;min-height:36px;border-radius:6px;border-color:#d2d6cf;padding:6px 10px;font-size:14px;line-height:1.5}
.characters :deep(.accform .ui-input:focus){outline:none;border-color:var(--c-accent);box-shadow:0 0 0 3px var(--c-accent-weak)}
.accform__text-input{position:relative;display:flex;min-width:0}.accform__field-prefix{position:absolute;left:10px;top:50%;transform:translateY(-50%);font-size:14px;color:var(--c-text);pointer-events:none}.characters :deep(.accform__text-input--prefixed .ui-input){padding-left:25px}
/* 关注账号多选下拉：与表单其它小控件同款（36px 高、#d2d6cf 边、6px 圆角） */
.charpick{position:relative;min-width:0}
.charpick__toggle{display:flex;align-items:center;gap:8px;width:100%;min-height:36px;padding:6px 10px;border:1px solid #d2d6cf;border-radius:6px;background:white;font:inherit;font-size:14px;line-height:1.5;color:var(--c-text);text-align:left;cursor:pointer}
.charpick__toggle:disabled{opacity:.45;cursor:not-allowed}
.charpick__toggle:focus-visible{outline:none;border-color:var(--c-accent);box-shadow:0 0 0 3px var(--c-accent-weak)}
.charpick__names{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.charpick__placeholder{flex:1;min-width:0;color:var(--role-muted)}
.charpick__chev{width:16px;height:16px;flex:none;color:var(--role-muted)}
.charpick__panel{position:absolute;top:calc(100% + 4px);left:0;right:0;z-index:30;max-height:224px;margin:0;padding:4px;list-style:none;overflow-y:auto;border:1px solid #d2d6cf;border-radius:8px;background:white;box-shadow:0 8px 28px rgba(15,17,14,.12);scrollbar-width:none}
/* 列表可滚但不显示滚动条（用户要求）：Firefox 走 scrollbar-width，WebKit 走伪元素 */
.charpick__panel::-webkit-scrollbar{width:0;height:0}
.charpick__opt{display:flex;align-items:center;gap:10px;width:100%;min-height:40px;padding:6px 8px;border:0;border-radius:6px;background:none;font:inherit;font-size:14px;color:var(--c-text);text-align:left;cursor:pointer}
.charpick__opt:hover{background:#f5f3f1}
.charpick__avatar{display:grid;place-items:center;flex:none;width:26px;height:26px;border-radius:50%;overflow:hidden;background:#eeedea;font:600 13px/1 var(--font-story);color:var(--c-text)}
.charpick__avatar img{width:100%;height:100%;object-fit:cover}
.charpick__opt-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.charpick__check{width:16px;height:16px;flex:none;color:#30322f}
.charpick__empty{padding:10px 8px;font-size:13px;color:var(--role-muted)}
.accform__input{display:block;width:100%;min-height:112px;resize:vertical;border:1px solid #d2d6cf;border-radius:6px;padding:8px 10px;font:inherit;font-size:14px;line-height:1.7;color:var(--c-text);background:white}
.accform__footer{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;padding-top:16px;margin-top:24px;margin-inline-start:144px;border-top:1px solid transparent}.accform__footer p{font-size:12px;color:var(--role-muted);line-height:1.6}
.characters :deep(.accform__footer>.ui-btn){height:36px;min-height:36px;padding:6px 16px;font-size:13px;font-weight:400;border-radius:6px}
.characters__back{display:grid;place-items:center;width:28px;height:28px;flex:none;border:1px solid var(--role-line);border-radius:50%;padding:0;background:white}
.characters__empty{height:100%;min-height:240px;display:flex;flex-direction:column}.characters--empty :deep(.record-workspace__records){align-content:center}.characters__list-empty{text-align:center;color:var(--role-muted);font-size:14px}.characters__empty-body{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding-bottom:12vh;text-align:center}.characters__empty button{min-height:34px;padding:6px 12px;border:1px solid var(--role-line);border-radius:6px;background:white;font-size:13px}.characters__empty p{font-size:14px;line-height:1.8;color:var(--role-muted)}
.character-info{width:min(440px,calc(100vw - 32px));max-height:calc(var(--creator-viewport-height,100dvh) - 40px);overflow:auto;overscroll-behavior:contain;padding:24px;border:1px solid var(--role-line);border-radius:12px;background:white;color:var(--c-text);box-shadow:0 16px 60px #0002}.character-info::backdrop{background:#20232140}.character-info form{display:flex;flex-direction:column}.character-info header{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px}.character-info h2{font-size:18px}.character-info header button{font-size:24px;border:0;background:none}.character-info label{font-size:13px;margin-bottom:6px}.character-info label:not(:first-of-type){margin-top:16px}.character-info input,.character-info textarea{width:100%;border:1px solid #d2d6cf;border-radius:6px;padding:8px 10px;font:inherit;font-size:14px;line-height:1.6;color:var(--c-text);background:white}.character-info textarea{resize:vertical}.character-info footer{display:flex;justify-content:flex-end;gap:8px;margin-top:20px}.character-info footer button{min-height:34px;border:1px solid #d2d6cf;border-radius:6px;padding:6px 12px;background:white;font-size:13px}.character-info footer button[type=submit]{background:#30322f;color:white;border-color:#30322f}
.characters button:disabled{opacity:.45;cursor:not-allowed}
.character-info__avatar-row{display:flex;align-items:center;gap:20px;margin-bottom:20px}.character-info__avatar{display:grid;place-items:center;flex:none;width:64px;height:64px;border-radius:50%;overflow:hidden;background:#eeedea;font:600 26px/1 var(--font-story)}.character-info__avatar img{width:100%;height:100%;object-fit:cover}.character-info__avatar-actions{display:flex;align-items:center;gap:16px}.character-info__avatar-actions :deep(.ui-btn),.character-info__avatar-actions>button{font-size:12px;min-height:30px;padding:4px 0;border:0;background:none;color:var(--role-muted)}
@media(min-width:768px){
  .charlist{display:flex;min-height:100%}
  .charcard{display:flex;flex-direction:column;flex:1}
  .role-profile{flex:none}
  .role-identity{align-self:center}
  /* 两侧标签原本差 2px：左列 line-height 1.65、右列 1.5，旧代码用 top:2px 硬顶。
     现在统一成 1.5，两列都从网格顶开始，天然对齐。 */
  .accounts{display:flex;flex-direction:column;flex:1}
  .accounts>h2,.account-tabs{flex:none}
  .accform{display:flex;flex-direction:column;flex:1}
  .accform__body{flex:1}
  .accform__fields:has(.accform__item--wide){grid-template-rows:repeat(var(--accform-rows-2col,1),auto) minmax(112px,1fr);align-content:stretch}
  .accform__item--wide{grid-template-rows:auto minmax(112px,1fr)}
  .accform__item--wide .accform__input{height:100%}
  .accform__footer{flex:none}
  @container character-detail (max-width:650px){.accform__fields:has(.accform__item--wide){grid-template-rows:repeat(var(--accform-rows-1col,1),auto) minmax(112px,1fr)}}
}
@container character-detail (max-width:650px){.role-profile{grid-template-columns:112px minmax(0,1fr);gap:24px}.charcard__avatar{width:80px;height:80px;font-size:32px}.role-portrait{grid-column:1;grid-row:1/3}.role-tools{grid-column:2;grid-row:2;justify-content:flex-end;padding:0}.role-identity{grid-column:2;grid-row:1;padding:0}.role-heading h2{font-size:26px}.accform__body{grid-template-columns:112px minmax(0,1fr);gap:24px}.accform__footer{margin-inline-start:136px}.accform__thumb{width:72px;height:72px;font-size:28px}.accform__fields{grid-template-columns:minmax(0,1fr);gap:16px}.accform__item{grid-column:auto}.role-owner{font-size:12px}.account-tabs{gap:16px}}
@media(max-width:1100px){.characters :deep(.record-workspace__detail){padding:40px 24px}}
@media(max-width:767px){.characters{height:auto;min-height:calc(var(--creator-viewport-height,100dvh) - var(--layout-topbar-h,60px))}.characters :deep(.record-workspace){display:block}.characters :deep(.record-workspace__index){min-height:calc(var(--creator-viewport-height,100dvh) - var(--layout-topbar-h,60px));border:0;padding:24px 16px}.characters :deep(.record-workspace__detail){padding:24px 20px 32px;overflow:visible;overflow-x:clip;overscroll-behavior-y:auto}.characters__add{width:36px;height:36px}.characters :deep(.record-workspace__head){margin-bottom:18px}.characters :deep(.record-workspace__records){flex:none;overflow:visible}.characters :deep(.record-workspace__search input){font-size:14px}.role-profile{grid-template-columns:72px minmax(0,1fr);gap:16px;padding-bottom:20px}.charcard__avatar{width:72px;height:72px;font-size:30px}.role-heading{gap:8px}.role-heading h2{font-size:24px}.role-owner{padding-inline-start:8px}.role-description{font-size:13px;margin-top:14px}.role-tools{gap:14px}.role-edit{font-size:12px}.accounts{padding-top:20px}.accounts>h2{font-size:18px;margin-bottom:8px}.account-tabs>button{min-height:40px;font-size:12px;gap:6px}.account-tabs svg{width:16px;height:16px}.accform{padding-top:20px}.accform__body{display:flex;flex-direction:column;gap:24px}.accform__asset{display:grid;grid-template-columns:64px minmax(0,1fr);align-items:center;gap:8px 16px;padding:0;border:0}.accform__asset-label{grid-column:2;grid-row:1}.accform__thumb{grid-column:1;grid-row:1/4;width:64px;height:64px;font-size:26px}.avatar-inherit{grid-column:2;grid-row:2}.accform__avatar-actions{grid-column:2;grid-row:3;justify-content:flex-start}.accform__fields{gap:16px}.accform__item>label{font-size:13px}.characters :deep(.accform .ui-input){font-size:16px;min-height:36px}.accform__input{font-size:16px;min-height:100px}.accform__footer{margin-top:24px;margin-inline-start:0;padding-top:14px}.character-info{padding:20px}.character-info input,.character-info textarea{font-size:16px}}
@media(max-width:767px){.role-profile{row-gap:24px}.characters__back{grid-column:1;grid-row:1;align-self:center}.role-tools{grid-column:2;grid-row:1;align-self:center}.role-portrait{grid-column:1;grid-row:2}.role-identity{grid-column:2;grid-row:2}}
@media(max-width:767px){.accform__asset{grid-template-rows:auto auto;row-gap:8px}.accform__asset-label{align-self:end}.accform__thumb{grid-row:1/3}.accform__avatar-controls{grid-column:2;grid-row:2;align-self:start;flex-direction:row;align-items:center;justify-content:flex-start;flex-wrap:wrap;gap:4px 16px}.accform__avatar-actions{flex-wrap:nowrap}.avatar-inherit,.accform__avatar-actions>button,.accform__avatar-actions :deep(.ui-btn){font-size:12px;line-height:1.5}}

@media(max-width:767px){.accform__banner{grid-column:1/-1;grid-row:3;display:grid;grid-template-columns:64px minmax(0,1fr);align-items:center;column-gap:20px;row-gap:8px;margin-top:8px}.accform__banner>.accform__asset-label{grid-column:1/-1;grid-row:1;justify-self:start;align-self:start;white-space:nowrap}.accform__banner-thumb{grid-column:1;grid-row:2;width:100%;max-width:104px}.accform__banner-actions{grid-column:2;grid-row:2;flex-direction:row;align-items:center;justify-content:flex-start;flex-wrap:wrap;gap:0 20px}}
@media(max-width:767px){.characters--empty :deep(.record-workspace__index){display:none}.characters--empty :deep(.record-workspace__detail){display:flex;min-height:calc(var(--creator-viewport-height,100dvh) - var(--layout-topbar-h,60px))}.characters--empty .characters__empty{flex:1;min-height:0;height:auto}.characters--empty .characters__empty-body{padding-bottom:0}}
</style>
