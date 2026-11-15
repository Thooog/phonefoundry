/**
 * 只读派生 —— 读取端（player-ui）与编辑端共用。
 *
 * 全部是纯函数：输入 WorkData，输出视图模型，不碰 DOM、不缓存。
 * 这样作品端可以完全无状态渲染，预览与导出的结果必然一致。
 */

export { buildConversationList, buildThread, chatIdentityOf, resolveAuthor } from './chat.js'
export { buildFeed, buildPostDetail, formatXCount } from './feed.js'
export { buildStoryTray, buildProfile, resolveIgAuthor } from './instagram.js'
export { buildFollowGraph, followCharacterIds } from './social.js'
export { buildNotesList, buildNoteDetail, splitNoteContent } from './notes.js'
export {
  buildSettingsOwner,
  resolveShellMode,
  shouldAutoFullscreen,
} from './settings.js'
export {
  buildContacts,
  buildMyCard,
  groupContactsByInitial,
  initialOf,
  buildCallLog,
  formatDialNumber,
  matchContactByDigits,
} from './phone.js'
export {
  buildPhotoGallery,
  buildAlbums,
  buildAlbumPhotos,
  FAVORITES_ALBUM_ID,
  TRASH_ALBUM_ID,
  HIDDEN_ALBUM_ID,
} from './photos.js'
export {
  collectAssetRefs,
  findOrphanAssets,
  analyzeCharacterRemoval,
  REGISTERED_ASSET_FIELDS,
} from './asset-refs.js'
export * from './x-search.js'
