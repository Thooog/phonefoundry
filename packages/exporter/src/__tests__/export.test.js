import { describe, expect, it } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'

import { createSampleProject, toWorkData } from '@phone-sim/shared'
import {
  BACKUP_FORMAT,
  assetFileName,
  buildBackupFileName,
  buildWorkFileName,
  buildWorkHtml,
  buildZip,
  countProject,
  escapeJsonForScriptNode,
  estimateExportSizes,
  exportProjectBackup,
  exportStandaloneHtml,
  exportWorkPackage,
  formatBytes,
  isBackupManifest,
  normalizeZipPath,
  planAssetFiles,
  readZip,
  sanitizeFileName,
  sizeTier,
} from '../index.js'

/** 假的作品端产物：真正的内容不重要，导出只负责原样嵌入 */
const PLAYER = { js: 'window.__FAKE_PLAYER__=1;', css: '.pui-shell{color:#000}' }

function workWithProject() {
  const project = createSampleProject()
  return project
}

/** 一个只引用了一张图的极简 WorkData（直接手写，不绕工厂） */
function tinyWork(overrides = {}) {
  return {
    schemaVersion: 1,
    title: '测试作品',
    workSettings: { phoneName: '', ownerCharacterId: null, wallpaper: { assetId: null } },
    characters: [{ id: 'char_a', name: '甲', avatarAssetId: 'img_a' }],
    platformAccounts: [],
    assets: [{ id: 'img_a', kind: 'image', mimeType: 'image/webp' }],
    appData: {},
    ...overrides,
  }
}

describe('sanitizeFileName', () => {
  it('拒绝会覆盖同一文件的归一化 ZIP 路径', () => {
    const zip = buildZip([{ path: 'project.json', text: '{}' }, { path: './project.json', text: '{"name":"duplicate"}' }])
    expect(() => readZip(zip)).toThrow('重复路径')
    expect(readZip(buildZip([{ path: 'constructor', text: 'file' }])).has('constructor')).toBe(true)
    expect([...readZip(buildZip([{ path: 'assets/', text: '' }, { path: 'project.json', text: '{}' }])).keys()]).toEqual(['project.json'])
  })
  it('删掉 Windows 非法字符，而不是替换成下划线', () => {
    expect(sanitizeFileName('雨夜/归来?')).toBe('雨夜归来')
    // 全角冒号是合法文件名字符，不该动它（「第1章：雨夜」是常见的作品名）
    expect(sanitizeFileName('第1章：雨夜')).toBe('第1章：雨夜')
  })

  it('去掉结尾的点和空格（Windows 会静默去掉，导致导出名与解压名不一致）', () => {
    expect(sanitizeFileName('  雨夜...  ')).toBe('雨夜')
  })

  it('去掉开头的点，避免变成隐藏文件', () => {
    expect(sanitizeFileName('..隐藏')).toBe('隐藏')
  })

  it('Windows 保留名前置下划线（con.zip 同样无法创建）', () => {
    expect(sanitizeFileName('CON')).toBe('_CON')
    expect(sanitizeFileName('nul')).toBe('_nul')
    // 只是以 com 开头、后面还有别的字，不算保留名
    expect(sanitizeFileName('comedy')).toBe('comedy')
  })

  it('全非法或为空时退回默认名', () => {
    expect(sanitizeFileName('///')).toBe('作品')
    expect(sanitizeFileName(null)).toBe('作品')
    expect(sanitizeFileName('   ')).toBe('作品')
  })

  it('按码点截断，不把 emoji 切成半个代理对', () => {
    const name = sanitizeFileName('📱'.repeat(80))
    expect(Array.from(name).length).toBe(60)
    // 截断后不应出现孤立代理对（U+FFFD 说明编码坏了）
    expect(name).not.toContain('\uFFFD')
  })
})

describe('assetFileName', () => {
  it('按 MIME 给真实扩展名（file:// 下浏览器靠扩展名判类型）', () => {
    expect(assetFileName('img_a', 'image/webp')).toBe('img_a.webp')
    expect(assetFileName('img_a', 'image/jpeg')).toBe('img_a.jpg')
    expect(assetFileName('img_a', 'image/png; charset=binary')).toBe('img_a.png')
  })

  it('未知类型退回 bin，不编一个看起来像对的扩展名', () => {
    expect(assetFileName('img_a', 'application/x-weird')).toBe('img_a.bin')
    expect(assetFileName('img_a', '')).toBe('img_a.bin')
  })

  it('清掉路径分隔符（assetId 理论上受控，但要防穿越）', () => {
    expect(assetFileName('../../evil', 'image/webp')).toBe('evil.webp')
  })
})

describe('buildWorkFileName', () => {
  it('作品名 + 本地日期戳', () => {
    const date = new Date(2026, 9, 28)
    expect(buildWorkFileName('雨夜', date)).toBe('雨夜_20261028.zip')
    expect(buildWorkFileName('雨夜', date, 'html')).toBe('雨夜_20261028.html')
  })

  it('用本地时间而不是 UTC：跨时区导出不该变成"昨天"', () => {

    const date = new Date(2026, 9, 28, 0, 30)
    expect(buildWorkFileName('x', date)).toBe('x_20261028.zip')
  })
})

describe('escapeJsonForScriptNode', () => {
  it('把 < 转义成 \\u003c，堵死 </script 提前闭合', () => {
    const text = escapeJsonForScriptNode({ caption: '看这个 </script><b>x</b>' })
    expect(text).not.toContain('</script')
    expect(text).not.toContain('<b>')
    // JSON 语义无损：解析后拿到原文
    expect(JSON.parse(text).caption).toBe('看这个 </script><b>x</b>')
  })

  it('顺便杀掉 <!--（HTML 注释式也会打断 script 数据状态）', () => {
    const text = escapeJsonForScriptNode({ v: '<!-- hack' })
    expect(text).not.toContain('<!--')
    expect(JSON.parse(text).v).toBe('<!-- hack')
  })
})

describe('buildWorkHtml', () => {
  it('带上 viewport，否则手机按 980px 布局、会画出"手机套手机"', () => {
    const html = buildWorkHtml({ title: 'x', work: tinyWork(), player: PLAYER })
    expect(html).toContain('name="viewport"')
    expect(html).toContain('width=device-width')
  })

  it('挂载点、内联样式、内联脚本都在', () => {
    const html = buildWorkHtml({ title: 'x', work: tinyWork(), player: PLAYER })
    expect(html).toContain('<div id="phone-root"></div>')
    expect(html).toContain(PLAYER.css)
    expect(html).toContain(PLAYER.js)
    // 不能有任何外链脚本/样式：file:// 下外部文件缺失就白屏
    expect(html).not.toMatch(/<script[^>]+src=/)
    expect(html).not.toMatch(/<link[^>]+stylesheet/)
  })

  it('数据放在 application/json 节点里，再由一小段脚本读出来', () => {
    const html = buildWorkHtml({ title: 'x', work: tinyWork(), player: PLAYER })
    expect(html).toContain('<script id="phone-work" type="application/json">')
    expect(html).toContain("window.__PHONE_WORK__ = JSON.parse(el.textContent)")
  })

  it('folder 模式写明 basePath，assets 表是 assetId → 文件名', () => {
    const html = buildWorkHtml({
      title: 'x',
      work: tinyWork(),
      player: PLAYER,
      assets: { img_a: 'img_a.webp' },
      mode: 'folder',
    })
    const payload = extractPayload(html)
    expect(payload.mode).toBe('folder')
    expect(payload.basePath).toBe('./assets/')
    expect(payload.assets).toEqual({ img_a: 'img_a.webp' })
  })

  it('inline 模式没有目录，basePath 给空串', () => {
    const html = buildWorkHtml({
      title: 'x',
      work: tinyWork(),
      player: PLAYER,
      assets: { img_a: 'data:image/webp;base64,AAA' },
      mode: 'inline',
    })
    expect(extractPayload(html).basePath).toBe('')
  })

  it('标题做 HTML 转义，不能让作品名里的尖括号变成标签', () => {
    const html = buildWorkHtml({ title: '<b>雨夜</b>', work: tinyWork(), player: PLAYER })
    expect(html).toContain('<title>&lt;b&gt;雨夜&lt;/b&gt;</title>')
  })

  it('内联代码里出现 </script 时直接抛错，不静默截断', () => {
    expect(() =>
      buildWorkHtml({ title: 'x', work: tinyWork(), player: { js: 'var s="</script>"', css: '' } }),
    ).toThrow(/闭合/)
  })

  it('CSS 里出现 </style 同样抛错', () => {
    expect(() =>
      buildWorkHtml({ title: 'x', work: tinyWork(), player: { js: 'x;', css: '/* </style> */' } }),
    ).toThrow(/闭合/)
  })

  it('作品端 JS 为空时抛错（否则导出一个白屏文件）', () => {
    expect(() => buildWorkHtml({ title: 'x', work: tinyWork(), player: { js: '  ', css: '' } })).toThrow(
      /作品端 JS/,
    )
  })
})

describe('planAssetFiles', () => {
  it('只收被引用的资源，资源表里的孤儿不进作品包', () => {
    const work = tinyWork({
      assets: [
        { id: 'img_a', mimeType: 'image/webp' },
        { id: 'img_orphan', mimeType: 'image/webp' },
      ],
    })
    const blobs = new Map([
      ['img_a', new Blob([new Uint8Array([1])])],
      ['img_orphan', new Blob([new Uint8Array([2])])],
    ])
    const plan = planAssetFiles({ work, blobs })
    expect(plan.assets.map((a) => a.assetId)).toEqual(['img_a'])
    expect(plan.map).toEqual({ img_a: 'img_a.webp' })
  })

  it('取不到二进制时进 missing，不让导出整体失败', () => {
    const plan = planAssetFiles({ work: tinyWork(), blobs: new Map() })
    expect(plan.assets).toEqual([])
    expect(plan.missing).toEqual(['img_a'])
  })

  it('顺序按 assetId 升序，同一份数据每次导出结构一致', () => {
    const work = tinyWork({
      characters: [
        { id: 'c1', avatarAssetId: 'img_c' },
        { id: 'c2', avatarAssetId: 'img_a' },
      ],
      assets: [
        { id: 'img_a', mimeType: 'image/webp' },
        { id: 'img_c', mimeType: 'image/webp' },
      ],
    })
    const blobs = new Map([
      ['img_a', new Blob([new Uint8Array([1])])],
      ['img_c', new Blob([new Uint8Array([1])])],
    ])
    expect(planAssetFiles({ work, blobs }).assets.map((a) => a.assetId)).toEqual(['img_a', 'img_c'])
  })

  it('接受普通对象形式的 blobs（调用方不必包成 Map）', () => {
    const plan = planAssetFiles({
      work: tinyWork(),
      blobs: { img_a: new Blob([new Uint8Array([1])]) },
    })
    expect(plan.assets).toHaveLength(1)
  })
})

describe('exportWorkPackage', () => {
  it('产出 ZIP：顶层一个目录，里面是 index.html + assets/', async () => {
    const project = workWithProject()
    project.characters[0].avatarAssetId = 'img_a'
    project.assets = [{ id: 'img_a', kind: 'image', mimeType: 'image/webp', byteSize: 3 }]

    const result = await exportWorkPackage({
      project,
      assets: new Map([['img_a', new Uint8Array([1, 2, 3])]]),
      player: PLAYER,
      now: new Date(2026, 9, 28),
    })

    expect(result.format).toBe('work-package')
    expect(result.fileName.endsWith('_20261028.zip')).toBe(true)
    expect(result.assetCount).toBe(1)

    const files = unzipSync(result.bytes)
    const names = Object.keys(files).sort()
    expect(names).toEqual([
      `${result.folder}/assets/img_a.webp`,
      `${result.folder}/index.html`,
    ])
    expect([...files[`${result.folder}/assets/img_a.webp`]]).toEqual([1, 2, 3])
  })

  it('ZIP 里那份 HTML 就是返回值里的 html（预览与导出同一份，便于断言）', async () => {
    const result = await exportWorkPackage({
      project: workWithProject(),
      assets: new Map(),
      player: PLAYER,
      now: new Date(2026, 9, 28),
    })
    const files = unzipSync(result.bytes)
    expect(strFromU8(files[`${result.folder}/index.html`])).toBe(result.html)
  })

  it('作品数据经过 toWorkData 裁剪：编辑态字段不进作品包', async () => {
    const project = workWithProject()
    project.appData.kakaotalk.conversations[0].draft = '写了一半的话'
    const result = await exportWorkPackage({
      project,
      assets: new Map(),
      player: PLAYER,
      now: new Date(2026, 9, 28),
    })
    expect(result.html).not.toContain('写了一半的话')
  })

  it('缺少作品端产物时明确报错，而不是导出白屏文件', async () => {
    await expect(
      exportWorkPackage({ project: workWithProject(), assets: new Map(), player: null }),
    ).rejects.toThrow(/作品端产物/)
  })

  it('资源取不到时仍然成功，并把 assetId 报进 missing', async () => {
    const project = workWithProject()
    project.characters[0].avatarAssetId = 'img_missing'
    project.assets = [{ id: 'img_missing', mimeType: 'image/webp' }]
    const result = await exportWorkPackage({
      project,
      assets: new Map(),
      player: PLAYER,
      now: new Date(2026, 9, 28),
    })
    expect(result.missing).toEqual(['img_missing'])
    expect(result.assetCount).toBe(0)
  })
})

describe('体积档位', () => {
  it('按 2/8/15MB 分档', () => {
    expect(sizeTier(1024)).toBe('ok')
    expect(sizeTier(2 * 1024 * 1024)).toBe('notice')
    expect(sizeTier(8 * 1024 * 1024)).toBe('warn')
    expect(sizeTier(15 * 1024 * 1024)).toBe('strong')
  })

  it('字节数转人类可读，整数不带小数点', () => {
    expect(formatBytes(512)).toBe('512B')
    expect(formatBytes(1536)).toBe('1.5KB')
    expect(formatBytes(12.2 * 1024 * 1024)).toBe('12.2MB')
    expect(formatBytes(98 * 1024 * 1024)).toBe('98MB')
  })
})

/** 从生成的 HTML 里取出注入的 payload */
function extractPayload(html) {
  const match = html.match(
    /<script id="phone-work" type="application\/json">([\s\S]*?)<\/script>/,
  )
  if (!match) throw new Error('没有找到 phone-work 数据节点')
  // 节点里是 \u003c 转义过的 JSON，parse 会还原
  return JSON.parse(match[1])
}

describe('exportStandaloneHtml', () => {
  const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3])

  function projectWithImage() {
    const project = createSampleProject()
    // 作品名取「手机名」优先于项目名（toWorkData 的规则），文件名跟着作品名走
    project.workSettings.phoneName = '雨夜'
    project.characters[0].avatarAssetId = 'img_a'
    project.assets = [{ id: 'img_a', kind: 'image', mimeType: 'image/png' }]
    return project
  }

  it('产出一个 .html，不是 ZIP', async () => {
    const result = await exportStandaloneHtml({
      project: projectWithImage(),
      assets: new Map([['img_a', pngBytes]]),
      player: PLAYER,
      now: new Date(2026, 9, 28),
    })

    expect(result.format).toBe('standalone-html')
    expect(result.fileName).toBe('雨夜_20261028.html')
    // 字节开头是 `<!doctype`，不是 zip 的 PK 魔数
    expect(new TextDecoder().decode(result.bytes.slice(0, 9)).toLowerCase()).toBe('<!doctype')
  })

  it('图片以 dataURL 内联，作品不依赖任何外部文件', async () => {
    const result = await exportStandaloneHtml({
      project: projectWithImage(),
      assets: new Map([['img_a', pngBytes]]),
      player: PLAYER,
      now: new Date(2026, 9, 28),
    })

    expect(result.html).toContain('data:image/png;base64,')
    // inline 模式不该再出现「去 assets/ 找文件」的路径
    expect(result.html).not.toContain('assets/img_a')

    const payload = extractPayload(result.html)
    expect(payload.mode).toBe('inline')
    expect(payload.basePath).toBe('')
    expect(payload.assets.img_a.startsWith('data:image/png;base64,')).toBe(true)
  })

  it('和作品包共用同一份作品数据（预览 = 作品包 = 独立 HTML）', async () => {
    const project = projectWithImage()
    const assets = new Map([['img_a', pngBytes]])
    const now = new Date(2026, 9, 28)

    const inline = await exportStandaloneHtml({ project, assets, player: PLAYER, now })
    const packed = await exportWorkPackage({ project, assets, player: PLAYER, now })

    expect(extractPayload(inline.html).work).toEqual(extractPayload(packed.html).work)
  })

  it('体积因 base64 膨胀：比同一份资源的作品包大约 33%', async () => {
    // 用 300KB 伪随机字节，避免全零被 ZIP 压得太好看而干扰判断
    const big = new Uint8Array(300 * 1024)
    for (let i = 0; i < big.length; i += 1) big[i] = (i * 37) % 256

    const project = projectWithImage()
    const assets = new Map([['img_a', big]])
    const now = new Date(2026, 9, 28)

    const inline = await exportStandaloneHtml({ project, assets, player: PLAYER, now })
    const packed = await exportWorkPackage({ project, assets, player: PLAYER, now })

    const ratio = inline.size / packed.size
    expect(ratio).toBeGreaterThan(1.2)
    expect(ratio).toBeLessThan(1.5)
  })
})

describe('exportProjectBackup', () => {
  function projectForBackup() {
    const project = createSampleProject()
    project.name = '雨夜'
    project.assets = [
      { id: 'img_a', kind: 'image', mimeType: 'image/webp' },
      { id: 'img_b', kind: 'image', mimeType: 'image/jpeg' },
    ]

    project.characters[0].avatarAssetId = 'img_a'
    return project
  }

  const BLOBS = new Map([
    ['img_a', new Uint8Array([1, 2, 3])],
    ['img_b', new Uint8Array([4, 5, 6])],
  ])

  it('manifest.json + project.json + assets/，且没有 index.html', async () => {
    const result = await exportProjectBackup({
      project: projectForBackup(),
      assets: BLOBS,
      appVersion: '9.9.9',
      now: new Date(2026, 9, 28),
    })

    expect(result.format).toBe('project-backup')
    expect(result.fileName).toBe('雨夜_项目备份_20261028.zip')

    const files = unzipSync(result.bytes)
    expect(Object.keys(files).sort()).toEqual([
      'assets/img_a.webp',
      'assets/img_b.jpg',
      'manifest.json',
      'project.json',
    ])
    // 备份不是作品：解压后不该有能双击打开的入口
    expect(Object.keys(files)).not.toContain('index.html')
  })

  it('manifest 能独立认亲，且记录真实数量和版本', async () => {
    const result = await exportProjectBackup({
      project: projectForBackup(),
      assets: BLOBS,
      appVersion: '9.9.9',
      now: new Date(2026, 9, 28),
    })

    const manifest = JSON.parse(
      strFromU8(unzipSync(result.bytes)['manifest.json']),
    )
    expect(manifest.format).toBe(BACKUP_FORMAT)
    expect(isBackupManifest(manifest)).toBe(true)
    expect(manifest.appVersion).toBe('9.9.9')
    expect(manifest.assetCount).toBe(2)
    expect(manifest.projectName).toBe('雨夜')
    expect(manifest.exportedAt).toBe(new Date(2026, 9, 28).toISOString())
    expect(manifest.counts.characters).toBeGreaterThanOrEqual(1)
  })

  it('保留编辑态字段（不裁剪成 WorkData）', async () => {
    const project = projectForBackup()
    // toWorkData 会剥掉 draft；备份必须留着，否则恢复后用户的半句话就没了
    project.appData.kakaotalk.conversations[0].draft = '写了一半的话'

    const result = await exportProjectBackup({
      project,
      assets: BLOBS,
      now: new Date(2026, 9, 28),
    })

    const saved = JSON.parse(strFromU8(unzipSync(result.bytes)['project.json']))
    expect(saved.appData.kakaotalk.conversations[0].draft).toBe('写了一半的话')
    expect(saved.id).toBe(project.id)
    expect(saved.revision).toBe(project.revision)
  })

  it('收全部资源，不只被引用的', async () => {
    const result = await exportProjectBackup({
      project: projectForBackup(),
      assets: BLOBS,
      now: new Date(2026, 9, 28),
    })
    // img_b 没有任何地方引用它，但它在资源表里 —— 备份要留
    expect(result.assetCount).toBe(2)
    expect(result.missing).toEqual([])
  })

  it('取不到的二进制进 missing，不阻断备份', async () => {
    const result = await exportProjectBackup({
      project: projectForBackup(),
      assets: new Map([['img_a', new Uint8Array([1])]]),
      now: new Date(2026, 9, 28),
    })
    expect(result.missing).toEqual(['img_b'])
    expect(result.assetCount).toBe(1)
  })

  it('把真实文件名写回 assets 元信息，导入时可按名字找文件', async () => {
    const result = await exportProjectBackup({
      project: projectForBackup(),
      assets: BLOBS,
      now: new Date(2026, 9, 28),
    })
    const saved = JSON.parse(strFromU8(unzipSync(result.bytes)['project.json']))
    expect(saved.assets.find((a) => a.id === 'img_b').fileName).toBe('img_b.jpg')
  })

  it('拒绝不是项目的输入', async () => {
    await expect(exportProjectBackup({ project: null })).rejects.toThrow(/项目对象/)
  })
})

describe('readZip', () => {
  it('能读回自己打的包', async () => {
    const result = await exportProjectBackup({
      project: createSampleProject(),
      assets: new Map(),
      now: new Date(2026, 9, 28),
    })
    const files = readZip(result.bytes)
    expect([...files.keys()].sort()).toEqual(['manifest.json', 'project.json'])
  })

  it('丢弃带路径穿越的条目（ZIP 条目名是攻击者可控的）', async () => {
    const evil = buildZip([
      { path: '../../evil.txt', text: 'x' },
      { path: 'safe.txt', text: 'y' },
    ])
    const files = readZip(evil)
    expect(files.has('safe.txt')).toBe(true)
    expect([...files.keys()].some((p) => p.includes('..'))).toBe(false)
  })

  it('不是 ZIP 时报可读的错', () => {
    expect(() => readZip(new Uint8Array([1, 2, 3, 4]))).toThrow(/压缩包/)
  })
})

describe('normalizeZipPath', () => {
  it('统一分隔符并去掉 ./', () => {
    expect(normalizeZipPath('a\\b\\c.txt')).toBe('a/b/c.txt')
    expect(normalizeZipPath('./a/b.txt')).toBe('a/b.txt')
  })

  it('拒绝绝对路径与穿越段', () => {
    expect(normalizeZipPath('/etc/passwd')).toBe('')
    expect(normalizeZipPath('C:/Windows/x')).toBe('')
    expect(normalizeZipPath('../x')).toBe('')
    expect(normalizeZipPath('a/../../x')).toBe('')
  })
})

describe('buildBackupFileName', () => {
  it('带「项目备份」标记，避免和作品包混在一起', () => {
    expect(buildBackupFileName('雨夜', new Date(2026, 9, 28))).toBe('雨夜_项目备份_20261028.zip')
  })

  it('同样过文件名净化', () => {
    expect(buildBackupFileName('雨夜/归来?', new Date(2026, 9, 28))).toBe(
      '雨夜归来_项目备份_20261028.zip',
    )
  })
})

describe('countProject', () => {
  it('只列非空的应用桶', () => {
    const counts = countProject({
      characters: [{}, {}],
      platformAccounts: [{}],
      assets: [{}, {}, {}],
      appData: {
        kakaotalk: { conversations: [1, 2], messages: [1, 2, 3] },
        photos: { photos: [], albums: [] },
      },
    })
    expect(counts.characters).toBe(2)
    expect(counts.platformAccounts).toBe(1)
    expect(counts.assets).toBe(3)
    expect(counts.apps).toEqual({ kakaotalk: 5 })
  })

  it('结构不全也不炸', () => {
    expect(countProject({})).toEqual({
      characters: 0,
      platformAccounts: 0,
      assets: 0,
      apps: {},
    })
    expect(countProject(null).characters).toBe(0)
  })
})

describe('estimateExportSizes', () => {
  /**
   * 预估的价值全在"够准"。这个用例直接拿真实导出结果对比，
   * 阈值放在 15%：资源部分几乎没有误差，误差只在文本压缩率上，
   * 而那部分占小作品体积的零头。超过 15% 说明系数的前提变了，要重新标定。
   */
  async function compare(assetBytesCount) {
    const project = createSampleProject()
    project.workSettings.phoneName = '估算测试'
    const blob = new Uint8Array(assetBytesCount)
    // 伪随机填充：全零会被压缩得极好，测不出真实比例
    for (let i = 0; i < blob.length; i += 1) blob[i] = (i * 37) % 256
    project.assets = [{ id: 'img_a', kind: 'image', mimeType: 'image/webp', byteSize: blob.length }]
    project.characters[0].avatarAssetId = 'img_a'

    const assets = new Map([['img_a', blob]])
    const now = new Date(2026, 9, 28)

    const estimate = estimateExportSizes({
      work: toWorkData(project),
      project,
      player: PLAYER,
      assetBytes: blob.length,
    })

    const packed = await exportWorkPackage({ project, assets, player: PLAYER, now })
    const inline = await exportStandaloneHtml({ project, assets, player: PLAYER, now })
    const backup = await exportProjectBackup({ project, assets, now })

    return {
      estimate,
      actual: {
        workPackage: packed.size,
        standaloneHtml: inline.size,
        projectBackup: backup.size,
      },
    }
  }

  function expectClose(estimated, actual, label) {
    const diff = Math.abs(estimated - actual) / actual
    // 失败信息要能直接看出差多少，不用回头再跑一遍
    expect(
      diff,
      `${label}：预估 ${formatBytes(estimated)}，实际 ${formatBytes(actual)}（差 ${(diff * 100).toFixed(1)}%）`,
    ).toBeLessThan(0.15)
  }

  it('有图作品：三种形态的预估都在 15% 以内', async () => {
    const { estimate, actual } = await compare(200 * 1024)
    expectClose(estimate.workPackage, actual.workPackage, '作品包')
    expectClose(estimate.standaloneHtml, actual.standaloneHtml, '独立 HTML')
    expectClose(estimate.projectBackup, actual.projectBackup, '备份包')
  })

  it('纯文字作品：预估不偏小（宁可说大，不能让用户被体积吓一跳）', async () => {
    const { estimate, actual } = await compare(0)

    /*
     * 这个场景刻意不断言"误差很小"。
     *
     * 没有资源时全部体积都是文本，而文本压缩率完全取决于内容重复度 ——
     * 单元测试里喂的是 20 字节的假 player，deflate 能压到 10%，
     * 真实构建产物（240KB minified，变量名随机）只能压到 33%。
     * 拿假 player 的压缩率去标定系数，等于用一个不适用的样本校准。
     *
     * 真正要守住的产品性质是**不偏小**：
     * 用户看到"约 200KB"结果下载下来 400KB 会愣一下，
     * 但看到"约 12MB"结果微信发不出去才是真问题。
     */
    expect(estimate.workPackage).toBeGreaterThanOrEqual(actual.workPackage)
    expect(estimate.workPackage).toBeLessThan(actual.workPackage * 3)
  })

  it('独立 HTML 的预估明显大于作品包（base64 膨胀要体现在 UI 上）', async () => {
    const { estimate } = await compare(200 * 1024)
    // 200KB 图片 → 至少多出 66KB
    expect(estimate.standaloneHtml - estimate.workPackage).toBeGreaterThan(60 * 1024)
  })
})
