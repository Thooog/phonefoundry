

import { formatListTime, formatDuration } from '../time/format.js'

export function buildContacts(work) {
  const explicit = (work.appData?.phone?.contacts ?? []).map((c) => {
    // 关联了角色就用角色头像兜底。编辑端不提供"上传联系人头像"，
    // 用户能做的关联就是选一个角色 —— 头像必须跟着走，
    // 否则通讯录里关联过的联系人仍然是灰格子，看起来像没生效。
    const linked = c.characterId
      ? (work.characters ?? []).find((ch) => ch?.id === c.characterId)
      : null
    const linkedAccount = c.characterId
      ? (work.platformAccounts ?? []).find(
          (a) => a.characterId === c.characterId && a.platform === 'messages',
        )
      : null
    return {
      id: c.id,
      characterId: c.characterId ?? null,
      name: c.name || '（无姓名）',
      avatarAssetId: c.avatarAssetId ?? linked?.avatarAssetId ?? null,
      phoneNumber: c.phoneNumber ?? '',
      note: c.note ?? '',
      // 关联角色时邮箱与头像同规则：从角色的信息 / 电话账号兜底
      email: linkedAccount?.email ?? '',
    }
  })

  const claimed = new Set(explicit.map((c) => c.characterId).filter(Boolean))
  const derived = []
  for (const ch of work.characters ?? []) {
    if (!ch?.id || claimed.has(ch.id)) continue
    const account = (work.platformAccounts ?? []).find(
      // 信息与电话共用一条账号（v2 起没有独立 phone 平台），联系人从它派生。
      (a) => a.characterId === ch.id && a.platform === 'messages',
    )
    if (!account) continue
    derived.push({
      id: account.id,
      characterId: ch.id,
      name: account.displayName || ch.name || '（无姓名）',
      avatarAssetId: account.avatarAssetId ?? ch.avatarAssetId ?? null,
      phoneNumber: account.phoneNumber ?? '',
      note: account.note ?? '',
      email: account.email ?? '',
    })
  }

  return [...explicit, ...derived].sort((a, b) =>
    String(a.name).localeCompare(String(b.name), 'zh-Hans-CN'),
  )
}

/**
 * 「我的名片」—— 机主自己的联系人卡片（通讯录置顶那一行点开的详情页数据）。
 *
 * 它**不在 buildContacts 里**：真机把机主单独放一张名片，不混进 A–Z 分组，
 * 示例数据也刻意没给机主录号码（见 factory/sample.js）。所以这里单独派生一份
 * 与联系人同形状的对象，好让详情页复用 ContactDetailView，不另起一套版式。
 *
 * 数据优先级（和「信息 / 电话共用一条账号」的 v2 口径一致）：
 *   1. 机主的 platform 'messages' 账号 —— 显示名 / 头像 / 号码 / 邮箱 / 备注；
 *   2. 机主角色 —— 账号没填的名字、头像退到这里；
 *   3. 创作者若把机主也录进了通讯录（显式联系人或派生联系人），
 *      用它补账号里空着的号码 / 邮箱 / 备注 —— 同一张脸不该两处写两个号码；
 *      姓名与头像仍以账号、角色为准，只有前两者都没有时才退到它。
 *
 * 没设机主时也不抛错：返回 hasOwner:false 的占位（姓名「我的名片」、
 * 字段为空），界面照常能打开，字段显示「未填写」而不是伪造一个人。
 *
 * @param {object} work WorkData
 * @returns {{hasOwner: boolean, characterId: string|null, name: string,
 *            avatarAssetId: string|null, phoneNumber: string, email: string, note: string}}
 */
export function buildMyCard(work) {
  const ownerId = work?.workSettings?.ownerCharacterId ?? null
  const character = (work?.characters ?? []).find((c) => c?.id === ownerId) ?? null
  const account =
    (work?.platformAccounts ?? []).find(
      (a) => a?.characterId === ownerId && a.platform === 'messages',
    ) ?? null
  // 机主被录进通讯录时，那条记录是创作者手填的，优先补账号里缺的字段
  const linked = ownerId ? buildContacts(work).find((c) => c.characterId === ownerId) ?? null : null

  return {
    hasOwner: Boolean(character || account || linked),
    characterId: ownerId,
    name: account?.displayName || character?.name || linked?.name || '我的名片',
    avatarAssetId: account?.avatarAssetId ?? character?.avatarAssetId ?? linked?.avatarAssetId ?? null,
    phoneNumber: account?.phoneNumber || linked?.phoneNumber || '',
    email: account?.email || linked?.email || '',
    note: account?.note || linked?.note || '',
  }
}

/* ── 拼音首字母 ────────────────────────────────────────
 * 不背拼音字典：Intl 的中文 collation 本身就是拼音序。
 * 给每个字母挑一个"该字母下拼音最小的常用字"当锚点，
 * 二分找到"不超过该字的最后一个锚点"，就是它所属的字母。
 *
 * 代价是依赖运行时的 ICU 数据，所以启动时先自检锚点是否严格单调递增，
 * 不单调（浏览器没有中文排序）就整条链作废，汉字统一归 # —— 宁可挤在一起，
 * 也不能把"周"扔进 C 组。
 *
 * 没有 I / U / V：拼音里不存在以它们开头的音节。
 */
const PINYIN_ANCHORS = [
  ['A', '啊'],
  ['B', '八'],
  ['C', '擦'],
  ['D', '搭'],
  ['E', '蛾'],
  ['F', '发'],
  ['G', '噶'],
  ['H', '哈'],
  ['J', '击'],
  ['K', '喀'],
  ['L', '拉'],
  ['M', '妈'],
  ['N', '拿'],
  ['O', '哦'],
  ['P', '趴'],
  ['Q', '七'],
  ['R', '然'],
  ['S', '撒'],
  ['T', '塌'],
  ['W', '挖'],
  ['X', '夕'],
  ['Y', '压'],
  ['Z', '匝'],
]

/**
 * 多音**姓氏**的读音特例。collation 按字典音排（曾 céng），
 * 但姓氏读 zēng —— 通讯录得听主人的。只查首字，只收姓氏用字。
 */
const SURNAME_LETTER = Object.freeze({
  曾: 'Z',
  单: 'S',
  解: 'X',
  仇: 'Q',
  区: 'O',
  查: 'Z',
  朴: 'P',
  乐: 'Y',
  尉: 'Y',
  覃: 'Q',
  缪: 'M',
  翟: 'Z',
  种: 'C',
  员: 'Y',
  折: 'S',
  柏: 'B',
  薄: 'B',
  牟: 'M',
  宿: 'S',
  宁: 'N',
  长: 'Z',
  重: 'C',
})

const ZH_COLLATOR = (() => {
  try {
    const collator = new Intl.Collator('zh-Hans-CN', { usage: 'sort', sensitivity: 'base' })
    const monotonic = PINYIN_ANCHORS.every(
      ([, ch], i) => i === 0 || collator.compare(PINYIN_ANCHORS[i - 1][1], ch) < 0,
    )
    return monotonic ? collator : null
  } catch {
    return null
  }
})()

const HAN_CHAR = /[\u3400-\u9fff]/
const LETTER_ORDER = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ']

/** 姓名 → 首字母（A–Z 或 #）：英文取首字母大写，汉字取拼音首字母 */
export function initialOf(name) {
  const ch = String(name ?? '').trim().charAt(0)
  if (!ch) return '#'
  if (/[A-Za-z]/.test(ch)) return ch.toUpperCase()
  if (!HAN_CHAR.test(ch)) return '#'
  const override = SURNAME_LETTER[ch]
  if (override) return override
  if (!ZH_COLLATOR) return '#'

  let lo = 0
  let hi = PINYIN_ANCHORS.length - 1
  let hit = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (ZH_COLLATOR.compare(PINYIN_ANCHORS[mid][1], ch) <= 0) {
      hit = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  // 比"啊"还小的汉字（a 组里的异体/生僻调）也归 A，不能落到 #
  return hit < 0 ? PINYIN_ANCHORS[0][0] : PINYIN_ANCHORS[hit][0]
}

/**
 * 按姓名首字母分组、组间严格按 A–Z 再 # 排列，
 * 组内保持传入顺序（调用方 buildContacts 已按拼音排好）。
 */
export function groupContactsByInitial(contacts) {
  const groups = new Map()
  for (const c of contacts) {
    const key = initialOf(c.name)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(c)
  }
  const rank = (letter) => {
    const i = LETTER_ORDER.indexOf(letter)
    return i < 0 ? LETTER_ORDER.length : i // '#' 等杂项永远垫底
  }
  return [...groups.entries()]
    .map(([letter, items]) => ({ letter, items }))
    .sort((a, b) => rank(a.letter) - rank(b.letter))
}

export const CALL_TYPE_LABEL = Object.freeze({
  incoming: '来电',
  outgoing: '呼出',
  missed: '未接来电',
})

/**
 * 拨号盘上的数字分组："1897" → "189 7"，"13900139000" → "139 0013 9000"。
 * 首段 3 位、其后每 4 位一段 —— 这是国内号码在 iOS 上的样子，
 * 长号码读起来才不会糊成一片；只处理数字，其它字符原样丢掉。
 */
export function formatDialNumber(digits) {
  const d = String(digits ?? '').replace(/\D/g, '')
  if (d.length <= 3) return d
  const groups = d.slice(3).match(/.{1,4}/g) ?? []
  return [d.slice(0, 3), ...groups].join(' ')
}

/**
 * 拨号时反查联系人：输到 4 位以上才认，避免刚按两个数字就"匹配"到人。
 * 号码在作品里是自由文本（可能带空格），所以两边都先剥成纯数字再比。
 * 前缀匹配是给"边打边提示"用的（真机就是这样）；后缀匹配兜住只记得尾号的情况。
 */
export function matchContactByDigits(contacts, digits) {
  const d = String(digits ?? '').replace(/\D/g, '')
  if (d.length < 4) return null
  return (
    contacts.find((c) => {
      const num = String(c.phoneNumber ?? '').replace(/\D/g, '')
      if (!num) return false
      return num === d || num.startsWith(d) || num.endsWith(d) || d.endsWith(num)
    }) ?? null
  )
}

/**
 * 最近通话。
 *
 * 有三种"人"要分清，它们的显示方式不同（真机也是这三档）：
 *   1. 号码在通讯录里        → 姓名（副标题写号码）
 *   2. 号码不在通讯录里      → **号码本身当标题**，副标题回到「来电/未接来电」
 *   3. 连号码都没有（无主叫）→ 「未知号码」
 *
 * 第 2 种是捡手机文学里很重要的一档：「陌生号码 138xxxx 打了三次」本身
 * 就是剧情，把它统一压成「未知号码」等于把信息抹掉。
 * 所以 name 这里可能是号码 —— 调用方不要拿 name 当"人名"用。
 */
export function buildCallLog(work, { storyDate = null, timeFormat = 'h24' } = {}) {
  const calls = work.appData?.phone?.calls ?? []
  // 用 buildContacts 而不是原始数组：派生出来的联系人也要能在这里查到名字
  const contacts = buildContacts(work)
  return [...calls]
    .sort((a, b) => String(b.displayTime).localeCompare(String(a.displayTime)))
    .map((c) => {
      const contact = contacts.find((x) => x.id === c.contactId) ?? null
      const rawNumber = String(c.phoneNumber ?? '').trim()
      // 陌生号码走 formatDialNumber（"13900139000" → "139 0013 9000"），
      // 纯符号之类的脏输入格式化后会变空，那时退回原文，别把整行清空
      const strangerLabel = contact ? '' : formatDialNumber(rawNumber) || rawNumber
      return {
        id: c.id,
        contactId: c.contactId,
        /** 不在通讯录 —— 界面据此换成人形占位头像 */
        stranger: !contact,
        name: contact?.name || strangerLabel || '未知号码',
        avatarAssetId: contact?.avatarAssetId ?? null,
        /**
         * 只有"有姓名"的情况才填号码：陌生号码已经把号码放在标题上了，
         * 副标题再写一遍只会变成"138 0013 8000 / 138 0013 8000"。
         */
        phoneNumber: contact?.phoneNumber ?? '',
        /**
         * 回拨用的号码，和上面「展示用号码」是两回事：
         * 陌生号码把号码写在标题上、phoneNumber 留空，拿它回拨会拨出空号；
         * 联系人那条记录里号码在通讯录上，createCallRecord 里则是空串。
         * 所以这里单独给界面一个「真能拨」的字段：有联系人取联系人号码，
         * 否则取通话记录里的原始号码，两者都空时才是无法回拨（未知号码）。
         */
        dialNumber: contact?.phoneNumber || rawNumber || '',
        type: c.type,
        typeLabel: CALL_TYPE_LABEL[c.type] ?? '通话',
        timeLabel: formatListTime(c.displayTime, { storyDate, timeFormat }),
        durationLabel: c.type === 'missed' ? '' : formatDuration(c.durationSec),
      }
    })
}
