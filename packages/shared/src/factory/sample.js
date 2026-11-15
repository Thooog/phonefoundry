/** 中性功能展示。A / B 仅为占位，无人物身份、关系或剧情；内联 SVG 保持零 Blob。 */
import {
  createCharacter, createPlatformAccount, createConversation, createMessage,
  createPost, createComment, createStory, createContact, createCallRecord,
  createNote, createPhoto, createAlbum, createProject,
} from './index.js'

export function createSampleProject(overrides = {}) {
  const now = Date.now()
  const at = minutes => new Date(now - minutes * 60000).toISOString()
  const a = createCharacter({ name: '演示人物 A', description: '仅演示手机所属人及我方气泡，不设身份或人物关系。', avatarAssetId: art('A') })
  const b = createCharacter({ name: '演示人物 B', description: '仅演示另一侧气泡及其他账号，不设身份或人物关系。', avatarAssetId: art('B', '#607a87') })
  const characters = [a, b]
  const accounts = characters.flatMap((character, index) => {
    const letter = index === 0 ? 'a' : 'b'
    return [
      createPlatformAccount(character.id, 'kakaotalk', { displayName: `聊天占位 ${letter.toUpperCase()}`, handle: `demo_${letter}`, bio: '状态签名示例' }),
      createPlatformAccount(character.id, 'instagram', {
        displayName: `图片账号 ${letter.toUpperCase()}`, handle: `demo_${letter}`, bio: '账号简介示例，仅作功能展示。',
        extraFields: { followers: 120, following: 30, followList: [], verified: index === 1, link: 'https://example.com' },
      }),
      createPlatformAccount(character.id, 'x', {
        displayName: `动态账号 ${letter.toUpperCase()}`, handle: `demo_${letter}`, bio: '账号简介示例，仅作功能展示。', bannerAssetId: art('BANNER', '#607a87', 900, 300),
        extraFields: { followers: 120, following: 30, followList: [], location: '地点字段示例', joinedAt: '2026-01' },
      }),
      createPlatformAccount(character.id, 'messages', { displayName: character.name, phoneNumber: `000 0000 000${index + 1}`, email: `demo-${letter}@example.com`, note: '号码及邮箱均为演示占位。' }),
    ]
  })
  const accountOf = (character, platform) => accounts.find(account => account.characterId === character.id && account.platform === platform)
  const author = (character, platform) => ({ authorCharacterId: character.id, authorAccountId: accountOf(character, platform).id })

  const ktConv = createConversation('kakaotalk', { participantIds: [a.id, b.id], pinned: true, sortKey: at(1) })
  const ktMessage = (character, minutes, fields) => createMessage(ktConv.id, { senderCharacterId: character?.id ?? null, senderAccountId: character ? accountOf(character, 'kakaotalk').id : null, displayTime: at(minutes), ...fields })
  const ktMessages = [
    ktMessage(b, 1500, { content: '文本消息示例：此处展示对方气泡。' }),
    ktMessage(a, 1495, { content: '文本消息示例：此处展示我方气泡，可修改发送者与时间。' }),
    ktMessage(b, 50, { contentType: 'image', mediaAssetIds: [art('01'), art('02', '#607a87')] }),
    ktMessage(a, 45, { contentType: 'sticker', mediaAssetIds: [art('STICKER', '#7c886a', 300, 300)] }),
    ktMessage(b, 40, { contentType: 'voice', durationSec: 8, transcript: '语音转写示例：点击转写按钮展开或收起文字。' }),
    ktMessage(a, 35, { contentType: 'voice', durationSec: 12 }),
    ktMessage(a, 30, { contentType: 'call', callKind: 'voice', callStatus: 'completed', durationSec: 65 }),
    ktMessage(b, 25, { contentType: 'call', callKind: 'video', callStatus: 'completed', durationSec: 90 }),
    ktMessage(b, 20, { contentType: 'call', callKind: 'voice', callStatus: 'missed' }),
    ktMessage(a, 15, { contentType: 'call', callKind: 'video', callStatus: 'missed' }),
    ktMessage(null, 10, { contentType: 'system', content: '系统消息示例：此类内容居中显示。' }),
    ktMessage(b, 1, { content: '此会话展示置顶、跨日期、图片、贴图、语音、转写、通话和系统消息。' }),
  ]
  const msgConv = createConversation('messages', { participantIds: [a.id, b.id], sortKey: at(2) })
  const msgMessage = (character, minutes, fields) => createMessage(msgConv.id, { senderCharacterId: character.id, senderAccountId: accountOf(character, 'messages').id, displayTime: at(minutes), ...fields })
  const customConv = createConversation('messages', { title: '自定义发送者示例', participantIds: [a.id], customParticipants: ['演示通知'], sortKey: at(60) })
  const msgMessages = [
    msgMessage(b, 1560, { content: '文本消息示例：跨日期时显示日期分隔。' }),
    msgMessage(a, 1555, { content: '我方气泡示例：发送者由手机所属人配置决定。' }),
    msgMessage(b, 90, { contentType: 'image', mediaAssetIds: [art('IMAGE', '#607a87')] }),
    msgMessage(a, 86, { content: '已读状态示例：这条消息带有已读时间。', readAt: at(85) }),
    msgMessage(a, 12, { content: '未读状态示例：这条消息未设置已读时间。' }),
    msgMessage(b, 2, { content: '可在编辑器调整正文、图片、发送者、日期及已读状态。' }),
    createMessage(customConv.id, { senderName: '演示通知', content: '自定义发送者示例：无需新建人物即可填写发送者名称。', displayTime: at(60) }),
  ]

  const igPosts = [
    createPost('instagram', { ...author(a, 'instagram'), displayTime: at(180), content: '多图帖子示例\n左右滑动查看图片，点击评论查看回复。', mediaAssetIds: [art('01', '#b9694f', 480, 600), art('02', '#607a87', 480, 600)], metrics: { likes: 12, reposts: 0, replies: 3, views: 0 } }),
    createPost('instagram', { ...author(b, 'instagram'), displayTime: at(95), content: '单图帖子示例：点击头像可以查看账号主页。', mediaAssetIds: [art('SINGLE', '#7c886a')], metrics: { likes: 8, reposts: 0, replies: 1, views: 0 } }),
  ]
  const igComment = createComment(igPosts[0].id, { ...author(b, 'instagram'), content: '一级评论示例。', displayTime: at(175) })
  const igComments = [
    igComment,
    createComment(igComment.id, { ...author(a, 'instagram'), content: '回复评论示例。', displayTime: at(170) }),
    createComment(igPosts[0].id, { ...author(b, 'instagram'), content: '另一条独立评论示例。', displayTime: at(165) }),
    createComment(igPosts[1].id, { ...author(a, 'instagram'), content: '单图帖子的评论示例。', displayTime: at(90) }),
  ]
  const igStories = [
    createStory({ ...author(a, 'instagram'), imageAssetId: art('STORY 1', '#b9694f', 480, 600), displayTime: at(41), caption: '故事文字示例' }),
    createStory({ ...author(a, 'instagram'), imageAssetId: art('STORY 2', '#7c886a', 480, 600), displayTime: at(38) }),
    createStory({ ...author(b, 'instagram'), imageAssetId: art('SEEN', '#607a87', 480, 600), displayTime: at(120), seen: true }),
    createStory({ ...author(b, 'instagram'), imageAssetId: art('NEXT', '#7c886a', 480, 600), displayTime: at(118) }),
    createStory({ ...author(b, 'instagram'), imageAssetId: art('9:16', '#b9694f', 360, 640), displayTime: at(115), caption: '竖屏故事示例' }),
  ]
  const xPosts = [
    createPost('x', { ...author(a, 'x'), displayTime: at(35), content: '文字动态示例\n正文支持换行。点击动态查看指标及嵌套回复。', metrics: { likes: 12, reposts: 3, replies: 3, views: 120 } }),
    createPost('x', { ...author(b, 'x'), displayTime: at(180), content: '多图动态示例：图片可以滑动及放大。点赞与转发标记仅展示功能，不代表人物关系。', mediaAssetIds: [art('01'), art('02', '#607a87')], metrics: { likes: 8, reposts: 1, replies: 1, views: 80 }, xPostTypes: ['like', 'repost'], xLikeByCharacterIds: [a.id], xRepostByCharacterIds: [a.id] }),
    createPost('x', { ...author(a, 'x'), displayTime: at(600), content: '单图动态示例：可以在搜索中输入“示例”查找内容。', mediaAssetIds: [art('SINGLE', '#7c886a')], metrics: { likes: 0, reposts: 0, replies: 0, views: 20 } }),
    createPost('x', { ...author(b, 'x'), displayTime: at(650), content: '仅主页展示示例：此动态关闭“显示在首页”，请在账号主页查看。', showInHome: false }),
  ]
  const xReply = createComment(xPosts[0].id, { ...author(b, 'x'), content: '一级回复示例。', displayTime: at(20) })
  const xReplies = [
    xReply,
    createComment(xReply.id, { ...author(a, 'x'), content: '嵌套回复示例：此条回复上一条回复。', displayTime: at(15) }),
    createComment(xPosts[0].id, { ...author(b, 'x'), content: '独立回复示例：开启另一条回复线程。', displayTime: at(9) }),
    createComment(xPosts[1].id, { ...author(a, 'x'), content: '图片动态回复示例。', displayTime: at(120) }),
  ]
  const contacts = [
    createContact({ characterId: b.id, name: '演示人物 B', phoneNumber: '000 0000 0002', note: '关联人物的联系人示例，不设人物关系。' }),
    createContact({ name: '独立联系人示例', phoneNumber: '000 0000 0003', note: '无需关联人物；号码仅为演示占位。', avatarAssetId: art('CONTACT', '#7c886a') }),
  ]
  const calls = [
    createCallRecord(contacts[0].id, { type: 'outgoing', displayTime: at(25), durationSec: 65 }),
    createCallRecord(contacts[0].id, { type: 'incoming', displayTime: at(140), durationSec: 90 }),
    createCallRecord(contacts[1].id, { type: 'missed', displayTime: at(310) }),
    createCallRecord(null, { phoneNumber: '000 0000 0004', type: 'incoming', displayTime: at(1500), durationSec: 30 }),
    createCallRecord(contacts[1].id, { type: 'outgoing', displayTime: at(2880), durationSec: 60 }),
  ]
  const photos = [
    createPhoto({ imageAssetId: art('01'), caption: '方形图片示例', location: '地点字段示例', displayTime: at(35), isFavorite: true }),
    createPhoto({ imageAssetId: art('02', '#607a87', 800, 600), caption: '横向图片示例', displayTime: at(180) }),
    createPhoto({ imageAssetId: art('03', '#7c886a', 600, 800), caption: '纵向图片示例', displayTime: at(1500) }),
    createPhoto({ imageAssetId: art('04'), caption: '收藏图片示例', displayTime: at(60 * 24 * 9), isFavorite: true }),
    createPhoto({ imageAssetId: art('05', '#607a87'), caption: '跨月份分组示例', displayTime: at(60 * 24 * 41) }),
    createPhoto({ imageAssetId: art('06', '#7c886a'), caption: '无地点时显示图片说明', displayTime: at(60 * 24 * 96) }),
    createPhoto({ imageAssetId: art('HIDDEN', '#607a87'), caption: '已隐藏图片示例', displayTime: at(40), isHidden: true }),
    createPhoto({ imageAssetId: art('TRASH', '#7c886a'), caption: '最近删除图片示例', displayTime: at(45), isInTrash: true }),
  ]
  const albums = [
    createAlbum({ name: '相簿示例', photoIds: [photos[0].id, photos[3].id, photos[4].id], orderIndex: 0 }),
    createAlbum({ name: '图片比例示例', photoIds: [photos[1].id, photos[2].id], orderIndex: 1 }),
  ]
  const notes = [
    createNote({ displayTime: at(1), content: '功能导览\n这是功能展示，不预设身份、人物关系或剧情。演示人物 A / B 仅作占位，可在“人物”中修改资料及各平台账号。\n\n信息：文本、图片、已读状态和自定义发送者。\nKakaoTalk：文本、多图、贴图、语音与转写、通话和系统消息。\nInstagram：单图与多图动态、评论回复、故事、主页及搜索。\nX：文字与图片动态、嵌套回复、指标、点赞转发标记、主页、趋势及搜索。\n电话：联系人、号码、邮箱、通话记录和拨号界面；所有号码均为占位。\n照片：不同比例、跨日期、相簿、收藏、已隐藏与最近删除。\n桌面美化：应用图标、装饰图标、四种预设小组件、自定义 HTML 小组件及图标。\n作品设置：名称、壁纸、时间格式、Wi-Fi、锁屏与相簿密码、浏览方式。\n编辑器支持新增、修改、删除及调整顺序；聊天可批量导入，可先复制示例再尝试。' }),
    createNote({ displayTime: at(2), content: '预览与导出\n在创作端点击“预览作品”查看实际效果。作品包供读者解压浏览；独立 HTML 可直接打开；项目备份包可通过“导入备份”恢复完整创作数据；“导出人物”只带走人物和账号配置，导入后成为新项目。\n\n桌面小组件和 HTML 图标均可在“桌面美化”中编辑。装饰图标只展示图标，不提供对应应用功能。' }),
    createNote({ displayTime: at(3), content: '密码与浏览设置\n锁屏和相簿密码默认关闭，便于直接浏览。\n在“作品设置”中可以分别启用锁屏、已隐藏、最近删除的密码；试用时可填写 4 位演示密码 1234，也可改成 6 位。\n这些密码用于作品交互，不是安全保护；不要填写真实密码。\n浏览方式可切换手机外框和自动全屏，时间格式可切换 12 / 24 小时制。' }),
    createNote({ displayTime: at(130), content: '单行备忘录示例' }),
    createNote({ displayTime: at(60 * 24 * 32), content: '\n多行备忘录示例\n首个非空行作为标题，其余内容作为正文。\n此条使用较早的日期，展示时间分组。' }),
  ]
  const base = createProject({ name: '功能展示 · 从这里开始', projectDescription: '以中性占位展示当前功能，不预设人物身份、关系或剧情。建议先查看“备忘录 → 功能导览”。', isSample: true })
  return {
    ...base,
    workSettings: {
      ...base.workSettings,
      phoneName: '功能演示手机', ownerCharacterId: a.id, storyDate: toDateString(now),
      appSettings: { ...base.workSettings.appSettings, wifiName: 'DEMO-WIFI' },
      homeLayout: { items: [
        { id: 'sample_date', kind: 'preset', presetId: 'date', area: 'grid', slot: 0, content: { schedules: [{ title: '功能展示', start: '09:00', end: '10:00' }] } },
        { id: 'sample_weather', kind: 'preset', presetId: 'weather', area: 'grid', slot: 2, content: { schedules: [], value: '24°', detail: '晴', high: '26°', low: '18°' } },
        { id: 'sample_note', kind: 'preset', presetId: 'note', area: 'grid', slot: 8, content: { schedules: [], title: '功能展示', detail: '打开备忘录，查看功能导览。', time: '09:00' } },
        { id: 'sample_clock', kind: 'preset', presetId: 'clock', area: 'grid', slot: 10 },
        { id: 'sample_html_widget', kind: 'html-widget', name: 'HTML 示例', size: '2x2', area: 'grid', slot: 16, html: '<style>body{margin:0;display:grid;place-content:center;height:100vh;background:#f7f4f2;color:#292c29;font:14px sans-serif;text-align:center}small{margin-top:8px;color:#696e66}</style><strong>HTML 小组件</strong><small>可在桌面美化中修改</small>' },
        ...['photos', 'instagram', 'x', 'notes'].map((id, index) => ({ id, kind: 'app', area: 'grid', slot: [18, 19, 22, 23][index] })),
        { id: 'deco-camera', kind: 'decorative-app', area: 'grid', slot: 24 },
        { id: 'sample_html_app', kind: 'html-app', name: 'HTML 图标', area: 'grid', slot: 25, html: '<style>body{margin:0;display:grid;place-content:center;height:100vh;background:#607a87;color:white;font:600 15px sans-serif}</style>HTML' },
        ...['phone', 'messages', 'kakaotalk', 'settings'].map((id, slot) => ({ id, kind: 'app', area: 'dock', slot })),
      ] },
    },
    characters, platformAccounts: accounts,
    appData: {
      ...base.appData,
      photos: { photos, albums },
      kakaotalk: { conversations: [ktConv], messages: ktMessages },
      messages: { conversations: [msgConv, customConv], messages: msgMessages },
      instagram: { posts: igPosts, comments: igComments, stories: igStories, searchHistory: [{ id: 'sample_ig_account', type: 'account', title: '', accountId: accountOf(b, 'instagram').id }] },
      x: {
        posts: xPosts, replies: xReplies,
        trends: [
          { id: 'sample_xtrend_demo', title: '功能展示', category: '示例分类', region: '示例地区', postCount: 1200 },
          { id: 'sample_xtrend_image', title: '图片', category: '', region: '', postCount: 80 },
          { id: 'sample_xtrend_text', title: '示例', category: '', region: '', postCount: null },
        ],
        searchHistory: [
          { id: 'sample_xsearch_keyword', type: 'keyword', title: '示例', accountId: null },
          { id: 'sample_xsearch_account', type: 'account', title: '', accountId: accountOf(b, 'x').id },
        ],
      },
      notes: { notes }, phone: { contacts, calls },
    },
    ...overrides,
  }
}

function toDateString(ms) {
  const d = new Date(ms)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 几何色块与编号，不携带人物肖像或故事场景。 */
function art(label, color = '#b9694f', width = 600, height = 600) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 600 600" preserveAspectRatio="xMidYMid slice"><rect width="600" height="600" fill="${color}"/><circle cx="460" cy="140" r="160" fill="white" fill-opacity=".12"/><rect x="-80" y="380" width="400" height="400" rx="40" fill="white" fill-opacity=".08" transform="rotate(-15 120 580)"/><text x="300" y="320" text-anchor="middle" font-family="sans-serif" font-size="60" fill="white">${label}</text></svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}
