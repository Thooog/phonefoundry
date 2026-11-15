/**
 * 平台账号字段定义 —— 编辑端表单与读取端展示共用。
 *
 * 一个角色可以在多个平台各有一个主账号，每个平台的资料字段不同。
 * fields 中每一项会被编辑端渲染成输入控件，被读取端用于取显示名/头像。
 *
 * 字段标记：
 *   - 默认（无 group）：直接作为账号顶层字段落盘，如 displayName / handle / bio。
 *   - group: 'extra'：归入 account.extraFields（自由字段桶）。用于"作品无法推导、
 *     只能由作者手填"的资料，例如 Instagram / X 的粉丝数 / 关注数、X 的所在地 /
 *     加入时间。读取端从这些字段派生展示，编辑端表单自动按 group 把值写进
 *     extraFields 而不是顶层，避免污染通用字段白名单。
 *   - span：编辑端表单栅格里占几列（仅影响人物配置表单排版，不落盘）。
 *     列数由平台级 formCols 声明；未声明 span 的字段占 1 列。
 */

/** 通用字段键（所有平台都有） */
const COMMON = {
  displayName: { key: 'displayName', label: '昵称', type: 'text', required: true },
  avatarAssetId: { key: 'avatarAssetId', label: '头像', type: 'asset', required: false },
}

export const PLATFORM_SCHEMAS = {
  kakaotalk: {
    id: 'kakaotalk',
    label: 'KakaoTalk',
    fields: [
      COMMON.displayName,
      COMMON.avatarAssetId,
      { key: 'handle', label: 'Kakao ID', type: 'text', required: false, hint: '选填' },
      { key: 'friendList', label: '好友列表', type: 'characters', group: 'extra', required: false },
      { key: 'bio', label: '状态签名', type: 'textarea', required: false, hint: '选填' },
    ],
  },
  instagram: {
    id: 'instagram',
    label: 'Instagram',
    // 编辑端表单四列栅格：昵称/用户名各占两列一行，粉丝数/关注数/关注账号
    // 一行三格（1+1+2），简介独占一行。
    formCols: 4,
    fields: [
      // 粉丝 / 关注：作品无法推导关注关系，只能由作者手填；归入 extraFields。

      { ...COMMON.displayName, span: 2 },
      { key: 'handle', label: '用户名', type: 'text', required: true, prefix: '@', span: 2 },
      COMMON.avatarAssetId,
      { key: 'followers', label: '粉丝数', type: 'number', group: 'extra', required: false },
      { key: 'following', label: '关注数', type: 'number', group: 'extra', required: false },
      // 关注账号：该账号关注的角色（ID 数组）。粉丝列表由读取端把所有角色的
      // followList 反向求出，所以只存这一个方向；归入 extraFields。
      { key: 'followList', label: '关注账号', type: 'characters', group: 'extra', required: false, span: 2 },
      { key: 'bio', label: '简介', type: 'textarea', required: false, hint: '选填' },
    ],
  },
  x: {
    id: 'x',
    label: 'X',
    // 与 Instagram 同一款四列栅格（见上）。
    formCols: 4,
    fields: [
      { ...COMMON.displayName, span: 2 },
      { key: 'handle', label: 'Handle', type: 'text', required: true, prefix: '@', span: 2 },
      COMMON.avatarAssetId,
      // 主页背景图：个人主页顶部那条横幅（真机 X 是 600×200，即 3:1）。
      // 只有 X 有这个概念，所以不放进 COMMON；编辑端按 key 单独渲染在头像下面一栏，
      // 上传时弹 3:1 裁剪框（见 CharactersView 的 prepareBanner）。
      { key: 'bannerAssetId', label: '主页背景图', type: 'asset', required: false },
      // 粉丝 / 关注：与 Instagram 同口径，归入 extraFields（X 的所在地 / 加入时间也在其中）。
      { key: 'followers', label: '粉丝数', type: 'number', group: 'extra', required: false },
      { key: 'following', label: '关注数', type: 'number', group: 'extra', required: false },
      { key: 'followList', label: '关注账号', type: 'characters', group: 'extra', required: false, span: 2 },
      { key: 'bio', label: '简介', type: 'textarea', required: false, hint: '选填' },
    ],
  },
  messages: {
    id: 'messages',
    label: '信息 / 电话',
    // 信息与电话共用同一个人物身份：同一个人在聊天里的显示名、头像与在

    // 必然出现两边不一致。v2 迁移已把旧 phone 账号并进 messages（见 migrate）。
    fields: [
      { ...COMMON.displayName, label: '显示名称' },
      { key: 'phoneNumber', label: '号码', type: 'text', required: false, hint: '选填' },
      { key: 'email', label: '电子邮件', type: 'text', required: false, hint: '选填，联系人详情里显示' },
      COMMON.avatarAssetId,
      { key: 'note', label: '备注', type: 'textarea', required: false, hint: '选填，通讯录里显示' },
    ],
  },
}

export const ACCOUNT_PLATFORMS = Object.keys(PLATFORM_SCHEMAS)

export function getPlatformSchema(platform) {
  return PLATFORM_SCHEMAS[platform] ?? null
}

/** 该平台账号的头像是否可继承角色头像 */
export function supportsAvatarInheritance(platform) {
  const schema = getPlatformSchema(platform)
  if (!schema) return false
  return schema.fields.some((f) => f.key === 'avatarAssetId')
}
