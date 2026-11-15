

export const APPS = [
  {
    id: 'photos',
    name: '照片',
    iconKey: 'photos',
    accent: '#FF9F0A',
    readerType: 'gallery',
    requiresOwner: false,
    collections: ['photos', 'albums'],
    order: 0,
  },
  {
    id: 'kakaotalk',
    name: 'KakaoTalk',
    iconKey: 'kakaotalk',
    accent: '#FEE500',
    readerType: 'chat',
    requiresOwner: false,
    collections: ['conversations', 'messages'],
    order: 1,
  },
  {
    id: 'messages',
    name: '信息',
    iconKey: 'messages',
    accent: '#34C759',
    readerType: 'chat',
    requiresOwner: false,
    collections: ['conversations', 'messages'],
    order: 2,
  },
  {
    id: 'instagram',
    name: 'Instagram',
    iconKey: 'instagram',
    accent: '#E1306C',
    readerType: 'feed',
    requiresOwner: false,
    collections: ['posts', 'comments', 'stories', 'searchHistory'],
    order: 3,
  },
  {
    id: 'x',
    name: 'X',
    iconKey: 'x',
    accent: '#0F1419',
    readerType: 'feed',
    requiresOwner: false,
    collections: ['posts', 'replies', 'trends', 'searchHistory'],
    order: 4,
  },
  {
    id: 'notes',
    name: '备忘录',
    iconKey: 'notes',
    accent: '#F2A33C',
    readerType: 'list',
    requiresOwner: false,
    collections: ['notes'],
    order: 5,
  },
  {
    id: 'phone',
    name: '电话',
    iconKey: 'phone',
    accent: '#34C759',
    readerType: 'list',
    requiresOwner: false,
    collections: ['contacts', 'calls'],
    order: 6,
  },
  {
    id: 'settings',
    name: '设置',
    iconKey: 'settings',
    accent: '#8E8E93',
    readerType: 'list',
    requiresOwner: false,
    collections: [],
    order: 7,
  },
]

export const APP_IDS = APPS.map((a) => a.id)

/** 按 id 查找应用定义；未知 id 返回 null，调用方需自行降级。 */
export function getApp(appId) {
  return APPS.find((a) => a.id === appId) ?? null
}

/** 桌面图标顺序：按 order 升序。 */
export function sortedApps() {
  return [...APPS].sort((a, b) => a.order - b.order)
}

/** 读取端渲染模式。 */
export const READER_TYPES = Object.freeze({
  CHAT: 'chat',
  FEED: 'feed',
  LIST: 'list',
  GALLERY: 'gallery',
})
