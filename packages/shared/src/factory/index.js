/**
 * 实体内联构造器 —— 每个函数返回一个"完整合法"的默认对象。
 *
 * 编辑端新建任何实体都走这里，保证不会有字段漏初始化；
 * 读取端遇到旧数据缺字段时也应该用同样的默认值补齐。
 */

import { createId, ID_PREFIX } from '../ids.js'
import { SCHEMA_VERSION, DEFAULT_WORK_SETTINGS } from '../constants/defaults.js'

const nowIso = () => new Date().toISOString()

export function createCharacter(overrides = {}) {
  const ts = nowIso()
  return {
    id: createId(ID_PREFIX.CHARACTER),
    name: '',
    avatarAssetId: null,
    description: '',
    createdAt: ts,
    updatedAt: ts,
    ...overrides,
  }
}

export function createPlatformAccount(characterId, platform, overrides = {}) {
  return {
    id: createId(ID_PREFIX.ACCOUNT),
    characterId,
    platform,
    displayName: '',
    handle: '',
    avatarAssetId: null,
    // X 个人主页背景图（3:1）。其它平台不用这个字段，但形状留在工厂里，
    // asset-refs 的「字段覆盖守护」才能盯住它（漏登记会把它当孤儿删掉）。
    bannerAssetId: null,
    bio: '',
    extraFields: {},
    ...overrides,
  }
}

export function createAsset(projectId, overrides = {}) {
  return {
    id: createId(ID_PREFIX.ASSET),

    projectId,
    kind: 'image',
    fileName: '',
    mimeType: 'image/webp',
    byteSize: 0,
    width: 0,
    height: 0,
    hasAlpha: false,
    /** 保留原图时指向另一条 asset，读取端优先用压缩后的本体 */
    originalAssetId: null,
    /** 最后一次被引用的时间，供孤儿资源回收使用（§3.4） */
    lastReferencedAt: null,
    createdAt: nowIso(),
    ...overrides,
  }
}

export function createConversation(app, overrides = {}) {
  return {
    id: createId(ID_PREFIX.CONVERSATION),
    app,
    title: '',

    participantIds: [],
    /**
     * 自定义参与者（自由文本，如「10657999」「校园快递驿站」）。
     *
     * 信息应用里并不是每个对话对象都是角色 —— 营销广告、验证码通知这类
     * 发信人根本没有对应角色。它们以字符串形式参与会话，消息的发送者
     * 用 message.senderName 指向其中一项。角色参与者仍走 participantIds。
     */
    customParticipants: [],
    avatarAssetId: null,
    pinned: false,

    unreadCount: 0,
    sortKey: nowIso(),
    ...overrides,
  }
}

export function createMessage(conversationId, overrides = {}) {
  return {
    id: createId(ID_PREFIX.MESSAGE),
    conversationId,
    senderCharacterId: null,
    senderAccountId: null,
    /**
     * 自定义发送者（自由文本）。与会话的 customParticipants 对应，
     * 用于「发信人不是任何角色」的消息 —— 营销广告、快递通知。
     * 非空时作品端直接显示它，优先于 senderCharacterId 的解析结果。
     */
    senderName: null,
    /** 剧情中显示的时间，与 createdAt 严格分离 */
    displayTime: nowIso(),
    contentType: 'text',
    content: '',
    mediaAssetIds: [],
    /**
     * 语音消息时长（秒）。只对 contentType==='voice' 有意义。
     *
     * 存秒数而不是「3:42」这样的字符串：气泡上要按秒画波形长度、
     * 界面上还要能编辑成 0:03 / 3:42 两种写法，字符串得反解析一遍。
     * 空值表示未填 —— 渲染端退回默认长度，不会画出一条 0 秒的空白条。
     */
    durationSec: null,
    /**
     * 语音的转写文本。同样只对 contentType==='voice' 有意义。
     *
     * 空串 = 这条语音没有转写 —— 作品端据此决定**画不画**「转」按钮，
     * 而不是画一个点下去没反应的空按钮。
     * 存原文而不是布尔：点了「转」要显示的就是这段字，布尔还得再找地方存文本。
     */
    transcript: '',
    /**
     * 通话消息的形态。只对 contentType==='call' 有意义：
     *   'voice' 语音通话 / 'video' 视频通话。
     * 其他类型恒为 null —— 渲染端拿到稳定形状，不用先判类型再决定字段存不存在。
     */
    callKind: null,
    /**
     * 通话结果。只对 contentType==='call' 有意义：
     *   'completed' 已接通（气泡尾部显示 durationSec）/
     *   'missed'    未接通（文案由渲染端按气泡所在侧自动定：发起方=已取消，接听方=未接听）。
     */
    callStatus: null,
    /**
     * 剧情内「对方读到这条」的时刻，仅对我方发出的消息有意义。
     *
     * 空表示未读 —— 聊天页据此决定显示不显示「20:42 已读」。
     * 之所以存时刻而不是布尔：已读回执上要打的正是这个时间，
     * 存布尔还得再编一个时间出来，叙事上反而说不通（"三点已读"是有意义的细节）。
     */
    readAt: null,
    /** 角色/账号被删除后的显示快照，正常时保持 null */
    snapshot: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    ...overrides,
  }
}

export function createPost(app, overrides = {}) {
  return {
    id: createId(ID_PREFIX.POST),
    app,
    authorCharacterId: null,
    authorAccountId: null,
    displayTime: nowIso(),
    content: '',
    mediaAssetIds: [],
    metrics: { likes: 0, reposts: 0, replies: 0, views: 0 },
    ...(app === 'x' ? { xPostTypes: [], xRepostByCharacterIds: [], xLikeByCharacterIds: [], showInHome: true } : {}),
    snapshot: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    ...overrides,
  }
}

export function createComment(parentId, overrides = {}) {
  return {
    id: createId(ID_PREFIX.COMMENT),
    parentId,
    authorCharacterId: null,
    authorAccountId: null,
    displayTime: nowIso(),
    content: '',
    snapshot: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    ...overrides,
  }
}

export function createStory(overrides = {}) {
  const ts = nowIso()
  return {
    id: createId(ID_PREFIX.STORY),
    authorCharacterId: null,
    authorAccountId: null,
    imageAssetId: null,
    /** 图上贴的文字（真机的文字贴纸）；空串表示没有 */
    caption: '',
    /** 剧情时间，与 createdAt 严格分离 */
    displayTime: ts,
    /**
     * 剧本预设的"已看过"。作品端点开后还会在内存里再标一次，
     * 但那个标记不写回作品数据 —— 导出后的作品是只读的。
     */
    seen: false,
    /** 角色被删除后的显示快照 */
    snapshot: null,
    createdAt: ts,
    updatedAt: ts,
    ...overrides,
  }
}

/**
 * 一条备忘录。
 *
 * 数据层只存全文：标题 = 正文第一个非空行，摘要 = 其余行 ——
 * 两者都是派生（select/notes.js），不落库。这样"改了首行，
 * 标题跟着变"是自然成立的事，不需要两处同步。
 */
export function createNote(overrides = {}) {
  const ts = nowIso()
  return {
    id: createId(ID_PREFIX.NOTE),
    content: '',
    /** 剧情中的编辑时间，与 createdAt 严格分离（同 photo.displayTime） */
    displayTime: ts,
    createdAt: ts,
    updatedAt: ts,
    ...overrides,
  }
}

export function createContact(overrides = {}) {
  return {
    id: createId(ID_PREFIX.CONTACT),
    characterId: null,
    name: '',
    avatarAssetId: null,
    phoneNumber: '',
    note: '',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    ...overrides,
  }
}

/**
 * 一条通话记录。
 *
 * contactId 与 phoneNumber 是**互斥的两种归属**：
 *   · contactId 有值        → 通讯录里的人（作品里显示姓名）
 *   · contactId 为 null 且 phoneNumber 有值 → 陌生号码（作品里把号码当标题）
 *   · 两个都空              → 无主叫号码（作品里显示「未知号码」）
 * 编辑端保证了不会两个都填：选了联系人就把号码清掉。读取端以 contactId 优先。
 */
export function createCallRecord(contactId, overrides = {}) {
  return {
    id: createId(ID_PREFIX.CALL),
    contactId,
    /** 不在通讯录的号码。contactId 有值时恒为空串 */
    phoneNumber: '',
    /** incoming | outgoing | missed */
    type: 'incoming',
    displayTime: nowIso(),
    durationSec: 0,
    ...overrides,
  }
}

export function createEmptyAppData() {
  return {
    photos: { photos: [], albums: [] },
    kakaotalk: { conversations: [], messages: [] },
    messages: { conversations: [], messages: [] },
    instagram: { posts: [], comments: [], stories: [], searchHistory: [] },
    x: { posts: [], replies: [], trends: [], searchHistory: [] },
    notes: { notes: [] },
    phone: { contacts: [], calls: [] },
    settings: {},
  }
}

/**
 * 一张照片。
 *
 * 图片本体不在数据层：这里只记 imageAssetId，二进制由资源表持有。
 * imageAssetId 为 null 或指向已删除的资源时，读取端画占位格而不是空白 ——
 * 相册的网格节奏一旦被空 div 打断，整屏都会"塌"。
 */
export function createPhoto(overrides = {}) {
  const ts = nowIso()
  return {
    id: createId(ID_PREFIX.PHOTO),
    imageAssetId: null,
    caption: '',
    /** 剧情中的拍摄时间，与 createdAt 严格分离（同 message.displayTime） */
    displayTime: ts,
    /**
     * 拍摄地点，自由文本（"杭州 · 湖滨" / "学校 · 三号宿舍楼"）。
     *
     * 不做地点库、不做坐标：这是给读者看的一行字，不是用来检索的地理数据。
     * 与 X 账号资料里的 location 同名同义 —— 同一个概念在项目里只该有一种叫法。
     */
    location: '',
    /** 个人收藏。相簿页的「个人收藏」是内置相簿，不建 album 记录，只读这个标记 */
    isFavorite: false,
    /**
     * 已隐藏。与 isFavorite / isInTrash 同一套做法：只做标记、不建 album 记录。
     * 作品端由它派生出常驻的「已隐藏」相簿；隐藏的照片从图库与所有相簿里隐去，
     * 记录与图片资源都还在，创作端可随时取消隐藏。
     */
    isHidden: false,
    /**
     * 回收站。与 isFavorite 同一套做法：只做标记、不建 album 记录。
     * 作品端由它派生出常驻的「回收站」相簿；记录与图片资源都还在，创作端可随时恢复。
     */
    isInTrash: false,
    createdAt: ts,
    updatedAt: ts,
    ...overrides,
  }
}

/**
 * 一个相簿。
 *
 * 为什么成员写在相簿这一侧（photoIds）而不是照片上的 albumIds：
 *   一张照片可以同时属于多个相簿，双向各存一份就必须保证两边同步，
 *   而"删照片"和"删相簿"是两条路径，迟早会漏一条。
 *   只写一侧之后，删相簿只是扔掉一个数组，照片本身毫发无损。
 */
export function createAlbum(overrides = {}) {
  const ts = nowIso()
  return {
    id: createId(ID_PREFIX.ALBUM),
    name: '',
    photoIds: [],
    orderIndex: 0,
    createdAt: ts,
    updatedAt: ts,
    ...overrides,
  }
}

export function createProject(overrides = {}) {
  const ts = nowIso()
  return {
    id: createId(ID_PREFIX.PROJECT),

    schemaVersion: SCHEMA_VERSION,
    appVersion: '',
    revision: 0,
    name: '未命名作品',
    projectDescription: '',
    /** 示例项目标记：可重置、可删除，列表页单独标注 */
    isSample: false,
    createdAt: ts,
    updatedAt: ts,
    workSettings: structuredClone(DEFAULT_WORK_SETTINGS),
    characters: [],
    platformAccounts: [],
    assets: [],
    appData: createEmptyAppData(),
    ...overrides,
  }
}
