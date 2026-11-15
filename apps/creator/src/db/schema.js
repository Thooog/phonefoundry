/**
 * IndexedDB 结构定义与迁移。
 *
 * 四张表，各自的职责边界很清楚：
 *   projects          完整项目对象（真相）
 *   projectSummaries  列表页用的摘要，与 projects **同事务**写，不可能不同步
 *   assets            图片等二进制，按 projectId 索引以便级联删除
 *   meta              杂项：多标签页心跳、最近打开、存储状态
 *
 * 为什么要有 projectSummaries：
 *   列表页若对 projects 做 getAll()，会把所有消息一起读出来（100 个项目 × 5MB 不可接受）。
 *   IDB 不支持字段投影，所以只能冗余一份摘要 —— 但必须与 projects 同事务，
 *   否则又会回到"项目存在、列表不显示"的老问题。
 */

export const DB_NAME = 'phone-simulator'
export const DB_VERSION = 1

export const STORE = Object.freeze({
  PROJECTS: 'projects',
  SUMMARIES: 'projectSummaries',
  ASSETS: 'assets',
  META: 'meta',
})

export function upgradeSchema(db, oldVersion) {
  // v0 → v1：首次创建
  if (oldVersion < 1) {
    if (!db.objectStoreNames.contains(STORE.PROJECTS)) {
      // 主键就是项目 id
      db.createObjectStore(STORE.PROJECTS, { keyPath: 'id' })
    }

    if (!db.objectStoreNames.contains(STORE.SUMMARIES)) {
      const summaries = db.createObjectStore(STORE.SUMMARIES, { keyPath: 'id' })
      // 列表默认按最近修改倒序
      summaries.createIndex('updatedAt', 'updatedAt', { unique: false })
    }

    if (!db.objectStoreNames.contains(STORE.ASSETS)) {
      const assets = db.createObjectStore(STORE.ASSETS, { keyPath: 'assetId' })
      // 删项目时按 projectId 一次性扫出所有资源
      assets.createIndex('projectId', 'projectId', { unique: false })
    }

    if (!db.objectStoreNames.contains(STORE.META)) {
      db.createObjectStore(STORE.META, { keyPath: 'key' })
    }
  }
}

/** 生成摘要对象：列表页只读这个，不碰完整项目 */
export function toSummary(project) {
  return {
    id: project.id,
    name: project.name || '未命名作品',
    description: project.projectDescription || '',
    createdAt: project.createdAt ?? null,
    updatedAt: project.updatedAt ?? null,
    isSample: Boolean(project.isSample),
    /** 列表封面：优先手机所属人头像，其次第一个角色头像 */
    coverAssetId: pickCoverAssetId(project),
    revision: project.revision ?? 0,
  }
}

function pickCoverAssetId(project) {
  const ownerId = project.workSettings?.ownerCharacterId
  const characters = project.characters ?? []
  const owner = ownerId ? characters.find((c) => c.id === ownerId) : null
  if (owner?.avatarAssetId) return owner.avatarAssetId
  const first = characters.find((c) => c.avatarAssetId)
  return first?.avatarAssetId ?? null
}
