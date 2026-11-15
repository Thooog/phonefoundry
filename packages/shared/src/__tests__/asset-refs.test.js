

import { describe, it, expect } from 'vitest'
import {
  collectAssetRefs,
  findOrphanAssets,
  analyzeCharacterRemoval,
  REGISTERED_ASSET_FIELDS,
} from '../select/asset-refs.js'
import {
  createProject,
  createCharacter,
  createPlatformAccount,
  createAsset,
  createConversation,
  createMessage,
  createPost,
  createComment,
  createStory,
  createContact,
  createPhoto,
  createAlbum,
} from '../factory/index.js'
import { APPS } from '../constants/apps.js'

// ───────────────────── 基础收集 ─────────────────────

describe('collectAssetRefs：从各个位置收集引用', () => {
  it('空项目返回空集合', () => {
    expect(collectAssetRefs(createProject()).size).toBe(0)
    expect(collectAssetRefs(null).size).toBe(0)
  })

  it('角色头像与平台账号头像', () => {
    const project = createProject()
    project.characters.push(createCharacter({ id: 'c1', avatarAssetId: 'a_char' }))
    project.platformAccounts.push(createPlatformAccount('c1', 'instagram', { avatarAssetId: 'a_acc' }))

    const refs = collectAssetRefs(project)
    expect(refs.has('a_char')).toBe(true)
    expect(refs.has('a_acc')).toBe(true)
  })

  it('平台账号的主页背景图也算引用（否则导出会丢图、整理资源会误删）', () => {
    const project = createProject()
    project.platformAccounts.push(
      createPlatformAccount('c1', 'x', { bannerAssetId: 'a_banner' }),
    )

    expect(collectAssetRefs(project).has('a_banner')).toBe(true)
    expect(findOrphanAssets(project).map((a) => a.id)).toEqual(
      expect.not.arrayContaining(['a_banner']),
    )
  })

  it('聊天会话头像与消息里的多图', () => {
    const project = createProject()
    project.appData.kakaotalk.conversations.push(createConversation('kakaotalk', { avatarAssetId: 'a_conv' }))
    project.appData.kakaotalk.messages.push(
      createMessage('conv1', { mediaAssetIds: ['a_m1', 'a_m2'] }),
    )

    const refs = collectAssetRefs(project)
    expect(refs.has('a_conv')).toBe(true)
    expect(refs.has('a_m1')).toBe(true)
    expect(refs.has('a_m2')).toBe(true)
  })

  it('信息流帖子 / 评论 / 回复里的图', () => {
    const project = createProject()
    project.appData.instagram.posts.push(createPost('instagram', { mediaAssetIds: ['a_post'] }))
    project.appData.instagram.comments.push(createComment('p1', { mediaAssetIds: ['a_comment'] }))
    project.appData.x.replies.push(createComment('p2', { mediaAssetIds: ['a_reply'] }))

    const refs = collectAssetRefs(project)
    expect([...refs]).toEqual(expect.arrayContaining(['a_post', 'a_comment', 'a_reply']))
  })

  it('Instagram 故事帧的图（单值字段）', () => {
    const project = createProject()
    project.appData.instagram.stories.push(
      createStory({ imageAssetId: 'a_story_1' }),
      createStory({ imageAssetId: 'a_story_2' }),
    )

    const refs = collectAssetRefs(project)
    expect([...refs]).toEqual(expect.arrayContaining(['a_story_1', 'a_story_2']))
  })

  it('电话头像', () => {
    const project = createProject()
    project.appData.phone.contacts.push(createContact({ avatarAssetId: 'a_contact' }))

    const refs = collectAssetRefs(project)
    expect([...refs]).toEqual(expect.arrayContaining(['a_contact']))
  })

  it('壁纸', () => {
    const project = createProject()
    project.workSettings.wallpaper = { ...project.workSettings.wallpaper, assetId: 'a_wall' }
    expect(collectAssetRefs(project).has('a_wall')).toBe(true)
  })

  it('空字符串与 null 不算引用', () => {
    const project = createProject()
    project.characters.push(
      createCharacter({ avatarAssetId: null }),
      createCharacter({ avatarAssetId: '' }),
    )
    project.appData.messages.messages.push(createMessage('c', { mediaAssetIds: [] }))
    expect(collectAssetRefs(project).size).toBe(0)
  })
})

// ───────────────────── 孤儿判定 ─────────────────────

describe('findOrphanAssets：找出没人用的资源', () => {
  it('被角色引用的不算孤儿，没人用的算', () => {
    const project = createProject()
    const used = createAsset(project.id, { id: 'a_used' })
    const orphan = createAsset(project.id, { id: 'a_orphan' })
    project.assets = [used, orphan]
    project.characters.push(createCharacter({ avatarAssetId: 'a_used' }))

    const result = findOrphanAssets(project)
    expect(result.map((a) => a.id)).toEqual(['a_orphan'])
  })

  it('project.assets 自身不构成引用（否则永远没有孤儿）', () => {
    const project = createProject()
    project.assets = [createAsset(project.id, { id: 'a1' })]
    expect(findOrphanAssets(project)).toHaveLength(1)
  })

  it('原始图 originalAssetId 视为引用，避免把原图当垃圾删掉', () => {
    const project = createProject()
    const original = createAsset(project.id, { id: 'a_original' })
    const compressed = createAsset(project.id, { id: 'a_compressed', originalAssetId: 'a_original' })
    project.assets = [original, compressed]
    project.characters.push(createCharacter({ avatarAssetId: 'a_compressed' }))

    expect(findOrphanAssets(project)).toHaveLength(0)
  })

  it('没有 assets 字段时返回空数组而不是崩', () => {
    expect(findOrphanAssets({})).toEqual([])
    expect(findOrphanAssets(null)).toEqual([])
  })
})

// ───────────────────── 删除角色影响面 ─────────────────────

describe('analyzeCharacterRemoval：删除前的影响统计', () => {
  /** 造一个角色参与各处的完整项目 */
  function makeRichProject() {
    const project = createProject()
    const target = createCharacter({ id: 'c_target', avatarAssetId: 'a_target_avatar' })
    const other = createCharacter({ id: 'c_other', avatarAssetId: 'a_other_avatar' })
    project.characters = [target, other]
    project.platformAccounts.push(createPlatformAccount('c_target', 'instagram'))
    project.assets = [
      createAsset(project.id, { id: 'a_target_avatar' }),
      createAsset(project.id, { id: 'a_other_avatar' }),
      createAsset(project.id, { id: 'a_target_post' }),
    ]

    project.appData.messages.messages.push(
      createMessage('c1', { senderCharacterId: 'c_target' }),
      createMessage('c1', { senderCharacterId: 'c_other' }),
    )
    project.appData.messages.conversations.push(
      createConversation('messages', { participantIds: ['c_target', 'c_other'] }),
    )
    project.appData.instagram.posts.push(
      createPost('instagram', { authorCharacterId: 'c_target', mediaAssetIds: ['a_target_post'] }),
    )
    project.appData.instagram.comments.push(createComment('p1', { authorCharacterId: 'c_target' }))
    project.appData.phone.contacts.push(createContact({ characterId: 'c_target' }))

    return project
  }

  it('统计各类内容数量', () => {
    const impact = analyzeCharacterRemoval(makeRichProject(), 'c_target')
    expect(impact.messages).toBe(1)
    expect(impact.posts).toBe(1)
    expect(impact.comments).toBe(1)
    expect(impact.conversations).toBe(1)
    expect(impact.contacts).toBe(1)
  })

  it('只统计目标角色，不误伤其他角色', () => {
    const impact = analyzeCharacterRemoval(makeRichProject(), 'c_other')
    expect(impact.messages).toBe(1) // other 自己那条
    expect(impact.posts).toBe(0)
  })

  it('识别所属人', () => {
    const project = makeRichProject()
    project.workSettings.ownerCharacterId = 'c_target'
    expect(analyzeCharacterRemoval(project, 'c_target').isOwner).toBe(true)
    expect(analyzeCharacterRemoval(project, 'c_other').isOwner).toBe(false)
  })

  it('独占资源会变成孤儿，被他人共用的不会', () => {
    const project = createProject()
    const target = createCharacter({ id: 'c_target', avatarAssetId: 'a_shared' })
    const other = createCharacter({ id: 'c_other', avatarAssetId: 'a_shared' })
    const exclusive = createAsset(project.id, { id: 'a_exclusive' })
    project.characters = [target, other]
    project.assets = [createAsset(project.id, { id: 'a_shared' }), exclusive]
    project.appData.instagram.posts.push(
      createPost('instagram', { authorCharacterId: 'c_target', mediaAssetIds: ['a_exclusive'] }),
    )

    const impact = analyzeCharacterRemoval(project, 'c_target')
    expect(impact.orphanAssetIds).toEqual(['a_exclusive'])
  })

  it('角色的故事图在删除后也会变成孤儿', () => {
    const project = createProject()
    project.characters = [createCharacter({ id: 'c_target' })]
    project.assets = [createAsset(project.id, { id: 'a_story' })]
    project.appData.instagram.stories.push(
      createStory({ authorCharacterId: 'c_target', imageAssetId: 'a_story' }),
    )

    // 少扫 stories 的话，这一帧会一直被当作"还有人引用"，资源回收永远清不掉
    expect(analyzeCharacterRemoval(project, 'c_target').orphanAssetIds).toEqual(['a_story'])
  })

  it('角色不存在时返回零值而不是崩', () => {
    const impact = analyzeCharacterRemoval(makeRichProject(), 'c_ghost')
    expect(impact.messages).toBe(0)
    expect(impact.orphanAssetIds).toEqual([])
  })

  it('不修改入参（纯只读分析）', () => {
    const project = makeRichProject()
    const before = JSON.stringify(project)
    analyzeCharacterRemoval(project, 'c_target')
    expect(JSON.stringify(project)).toBe(before)
  })
})

// ───────────────────── ★ 字段覆盖守护 ─────────────────────

describe('字段覆盖守护：factory 新增资源字段必须登记', () => {
  /**
   * 扫描 factory 造出的所有实体，找出所有以 AssetId / AssetIds 结尾的键，
   * 逐个与 REGISTERED_ASSET_FIELDS 对照。
   *
   * 覆盖范围：项目顶层 + 每个应用的每个集合，都是 factory 真实产出的形状。
   */
  function collectAssetKeysDeep(value, out = new Set(), seen = new Set(), depth = 0) {
    if (depth > 6 || value === null || typeof value !== 'object') return out
    if (seen.has(value)) return out
    seen.add(value)

    if (Array.isArray(value)) {
      for (const item of value) collectAssetKeysDeep(item, out, seen, depth + 1)
      return out
    }
    for (const [key, child] of Object.entries(value)) {
      if (/AssetIds?$/.test(key)) out.add(key)
      collectAssetKeysDeep(child, out, seen, depth + 1)
    }
    return out
  }

  /** 造一个"每个集合都有一条样本"的项目，确保扫描面覆盖全部字段 */
  function makeFullSampleProject() {
    const project = createProject()
    const char = createCharacter()
    project.characters = [char]
    project.platformAccounts = [createPlatformAccount(char.id, 'instagram')]
    project.assets = [createAsset(project.id)]
    project.workSettings.wallpaper = { ...project.workSettings.wallpaper, assetId: 'a' }

    project.appData.photos.photos = [createPhoto()]
    project.appData.photos.albums = [createAlbum()]
    project.appData.kakaotalk.conversations = [createConversation('kakaotalk')]
    project.appData.kakaotalk.messages = [createMessage('conv')]
    project.appData.messages.conversations = [createConversation('messages')]
    project.appData.messages.messages = [createMessage('conv')]
    project.appData.instagram.posts = [createPost('instagram')]
    project.appData.instagram.comments = [createComment('p')]
    project.appData.x.posts = [createPost('x')]
    project.appData.x.replies = [createComment('p')]
    project.appData.phone.contacts = [createContact()]
    project.appData.phone.calls = []
    return project
  }

  it('factory 产出的每个 *AssetId(s) 字段都已在扫描表中登记', () => {
    const used = collectAssetKeysDeep(makeFullSampleProject())
    const registered = new Set(REGISTERED_ASSET_FIELDS)

    const missing = [...used].filter((k) => !registered.has(k))
    // 失败信息要直接告诉开发者"去登记哪个字段"
    expect(missing, `未登记的资源字段：${missing.join(', ')}。请到 packages/shared/src/select/asset-refs.js 的 ASSET_FIELD_PATHS 里补上`).toEqual([])
  })

  it('登记表里的字段都能被 collectAssetRefs 真正读到', () => {
    // 反向守护：防止"登记了但不生效"—— 每个字段填一个唯一 id，必须被收集到
    const project = makeFullSampleProject()
    const expected = new Set()

    let counter = 0
    const fill = (obj, key) => {
      const isList = /AssetIds$/.test(key)
      const id = `a_fill_${(counter += 1)}`
      obj[key] = isList ? [id] : id
      expected.add(id)
    }

    // 项目顶层
    for (const c of project.characters) fill(c, 'avatarAssetId')
    for (const a of project.platformAccounts) fill(a, 'avatarAssetId')
    for (const a of project.assets) fill(a, 'originalAssetId')
    // 各应用桶
    for (const app of APPS) {
      const bucket = project.appData[app.id] ?? {}
      for (const c of bucket.conversations ?? []) fill(c, 'avatarAssetId')
      for (const m of bucket.messages ?? []) fill(m, 'mediaAssetIds')
      for (const p of bucket.posts ?? []) fill(p, 'mediaAssetIds')
      for (const c of [...(bucket.comments ?? []), ...(bucket.replies ?? [])]) fill(c, 'mediaAssetIds')
      for (const ct of bucket.contacts ?? []) fill(ct, 'avatarAssetId')
      for (const p of bucket.photos ?? []) fill(p, 'imageAssetId')
    }
    fill(project.workSettings.wallpaper, 'assetId')

    const refs = collectAssetRefs(project)
    const unread = [...expected].filter((id) => !refs.has(id))
    expect(unread, `这些字段填了值但没被收集到：${unread.join(', ')}`).toEqual([])
  })

  it('登记表本身没有重复项', () => {
    expect(new Set(REGISTERED_ASSET_FIELDS).size).toBe(REGISTERED_ASSET_FIELDS.length)
  })
})

// ───────────────────── 内联 / 外链 ─────────────────────

describe('内联与外链不算资源引用', () => {
  /**
   * 这条守的是"示例项目里那几张内联照片"：
   * 若把 dataURL 当成 assetId 收集，validateProject 会一直报
   * 「有 N 个资源引用找不到对应文件」—— 明明图就在数据里。
   */
  it('dataURL 与外链不进入引用集合', () => {
    const project = createProject()
    project.appData.photos.photos = [
      createPhoto({ imageAssetId: 'data:image/svg+xml;utf8,%3Csvg%3E' }),
      createPhoto({ imageAssetId: 'https://example.com/a.png' }),
      createPhoto({ imageAssetId: 'ast_real' }),
    ]

    expect([...collectAssetRefs(project)]).toEqual(['ast_real'])
  })
})
