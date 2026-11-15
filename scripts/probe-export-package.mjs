

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import { unzipSync, strFromU8 } from 'fflate'

import { createSampleProject } from '../packages/shared/src/index.js'
import {
  exportProjectBackup,
  exportStandaloneHtml,
  exportWorkPackage,
} from '../packages/exporter/src/index.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const DIST = path.join(ROOT, 'apps', 'player', 'dist')
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const CDP_PORT = 9371

const results = []
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function record(step, ok, detail = '') {
  results.push({ step, ok, detail })
  console.log(`  ${ok ? '✓' : '✗'} ${step}${detail ? `  ${detail}` : ''}`)
}

if (!fs.existsSync(CHROME)) {
  console.error(`[export] 未找到 Chrome：${CHROME}`)
  process.exit(2)
}
for (const file of ['renderer.js', 'renderer.css']) {
  if (!fs.existsSync(path.join(DIST, file))) {
    console.error(`[export] 缺少作品端产物 ${file}，请先运行 pnpm build:player`)
    process.exit(2)
  }
}

// ───────────────────── 1. 在 Node 里跑真实导出 ─────────────────────

const player = {
  js: fs.readFileSync(path.join(DIST, 'renderer.js'), 'utf8'),
  css: fs.readFileSync(path.join(DIST, 'renderer.css'), 'utf8'),
}

/** 一张 8×8 的 SVG，用来验证 folder 模式的相对路径通道（内容不重要，能解码才重要） */
const PROBE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8">' +
  '<rect width="8" height="8" fill="#e0555a"/></svg>'

const WORK_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-sim-export-'))
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-sim-chrome-'))

try {
  await run()
} catch (err) {
  console.error(`\n[export] 探针异常终止：${err.stack ?? err.message}`)
  cleanup()
  process.exit(1)
}

async function run() {
  // 场景 A：示例作品（照片是内联 dataURL，assets/ 应为空）
  const sampleProject = createSampleProject()
  const pkgA = await exportWorkPackage({ project: sampleProject, assets: new Map(), player })

  // 场景 B：带一张真实资源文件的项目（验证 assets/ 写入与相对路径解析）
  const assetProject = createSampleProject()
  assetProject.characters[0].avatarAssetId = 'img_probe'
  assetProject.assets = [
    {
      id: 'img_probe',
      kind: 'image',
      fileName: 'probe.svg',
      mimeType: 'image/svg+xml',
      byteSize: PROBE_SVG.length,
    },
  ]
  const pkgB = await exportWorkPackage({
    project: assetProject,
    assets: new Map([['img_probe', new TextEncoder().encode(PROBE_SVG)]]),
    player,
  })

  // 场景 C：同一份数据的独立 HTML（单文件，图片 base64 内联）
  const pkgC = await exportStandaloneHtml({
    project: assetProject,
    assets: new Map([['img_probe', new TextEncoder().encode(PROBE_SVG)]]),
    player,
  })

  // 场景 D：项目备份包（给创作者自己，不是作品）
  const pkgD = await exportProjectBackup({
    project: assetProject,
    assets: new Map([['img_probe', new TextEncoder().encode(PROBE_SVG)]]),
    appVersion: '0.1.0',
  })

  // ── X-1 前半：结构 ──
  const filesA = unzipSync(pkgA.bytes)
  const namesA = Object.keys(filesA)
  const htmlName = `${pkgA.folder}/index.html`
  record(
    'X-1 作品包结构：顶层一个目录，内含 index.html',
    namesA.length === 1 && namesA[0] === htmlName,
    namesA.join(' / '),
  )

  const filesB = unzipSync(pkgB.bytes)
  const namesB = Object.keys(filesB).sort()
  const assetName = `${pkgB.folder}/assets/img_probe.svg`
  record(
    '资源写入 assets/，文件名为 assetId + 真实扩展名',
    namesB.includes(assetName) && strFromU8(filesB[assetName]) === PROBE_SVG,
    path.basename(assetName),
  )

  const htmlB = strFromU8(filesB[`${pkgB.folder}/index.html`])
  record(
    'folder 模式的 assets 表是 assetId → 文件名',
    htmlB.includes('"img_probe":"img_probe.svg"'),
    'img_probe → img_probe.svg',
  )

  // ── X-3 无编辑器（静态断言，不需要浏览器） ──
  const html = pkgA.html
  const leaks = [
    'data-creator-only',
    'phone-sim-creator',
    'useProjectStore',
    'createRouter',
    'vue-router',
  ].filter((needle) => html.includes(needle))
  record('X-3 产物内不含创作端字符串与创作控件', leaks.length === 0, leaks.join(',') || '无泄漏')

  const externals = [
    /<script[^>]+\ssrc=/i.test(html) && '<script src>',
    /<link[^>]+rel=["']?stylesheet/i.test(html) && '<link stylesheet>',
  ].filter(Boolean)
  record('X-2 产物不自带任何外部引用（离线前提）', externals.length === 0, externals.join(',') || '只有一个文件 + assets/')

  // ── X-4 独立 HTML：单文件、资源内联 ──
  record(
    'X-4 独立 HTML 是一个 .html，不是压缩包',
    pkgC.fileName.endsWith('.html') && pkgC.bytes[0] === 0x3c, // '<'
    `${pkgC.fileName} · ${(pkgC.size / 1024).toFixed(1)}KB`,
  )
  record(
    'X-4 图片内联成 dataURL，不依赖同级 assets/ 目录',
    pkgC.html.includes('data:image/svg+xml;base64,'),
    'dataURL ✓',
  )

  // X-9：同一份数据两种容器，喂给作品端的东西必须一模一样
  const workOfB = extractWorkPayload(pkgB.html)
  const workOfC = extractWorkPayload(pkgC.html)
  record(
    'X-9 作品包与独立 HTML 的作品数据完全一致（只有资源通道不同）',
    Boolean(workOfB) &&
      JSON.stringify(workOfB) === JSON.stringify(workOfC) &&
      extractAssetsPayload(pkgB.html).img_probe === 'img_probe.svg' &&
      extractAssetsPayload(pkgC.html).img_probe.startsWith('data:'),
    workOfB ? `${workOfB.characters.length} 角色 · ${workOfB.appData.kakaotalk.messages.length} 消息` : '没读到作品数据',
  )

  // ── X-6 / X-7 备份包 ──
  const filesD = unzipSync(pkgD.bytes)
  const namesD = Object.keys(filesD).sort()
  record(
    'X-7 备份包是 manifest + project.json + assets/，且没有 index.html',
    namesD.includes('manifest.json') &&
      namesD.includes('project.json') &&
      namesD.includes('assets/img_probe.svg') &&
      !namesD.includes('index.html'),
    namesD.join(' / '),
  )

  const manifestD = JSON.parse(strFromU8(filesD['manifest.json']))
  record(
    'X-7 manifest 自我标识正确，记录版本与数量',
    manifestD.format === 'phone-simulator-project' &&
      manifestD.schemaVersion >= 1 &&
      manifestD.assetCount === 1 &&
      manifestD.appVersion === '0.1.0',
    `${manifestD.projectName} · schema v${manifestD.schemaVersion} · ${manifestD.assetCount} 资源 · v${manifestD.appVersion}`,
  )

  const savedD = JSON.parse(strFromU8(filesD['project.json']))
  record(
    'X-6 备份里是完整项目，不是裁剪后的作品数据',
    // 保留原 project.id 与 revision：这两样是纯编辑态字段，
    // toWorkData 会把它们剥掉 —— 在被剥掉就说明备份走了作品的裁剪路径
    savedD.id === assetProject.id &&
      savedD.revision === assetProject.revision &&
      savedD.assets.length === 1 &&
      Object.keys(savedD.appData ?? {}).length > 0,
    `${savedD.characters.length} 角色 · ${savedD.assets.length} 资源 · 保留 project.id 与 revision`,
  )

  // 解压到磁盘，模拟用户"解压后双击"
  for (const [dimName, files, folder] of [
    ['a', filesA, pkgA.folder],
    ['b', filesB, pkgB.folder],
  ]) {
    for (const [entry, bytes] of Object.entries(files)) {
      const target = path.join(WORK_DIR, dimName, entry.slice(folder.length + 1))
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, Buffer.from(bytes))
    }
  }
  const pageA = toFileUrl(path.join(WORK_DIR, 'a', 'index.html'))
  const pageB = toFileUrl(path.join(WORK_DIR, 'b', 'index.html'))

  // 独立 HTML 不用解压目录，就是一个文件躺在磁盘上 —— 这正是它的卖点
  const pageC = path.join(WORK_DIR, 'c-standalone.html')
  fs.mkdirSync(WORK_DIR, { recursive: true })
  fs.writeFileSync(pageC, Buffer.from(pkgC.bytes))

  // ───────────────────── 2. 真浏览器里打开 ─────────────────────

  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--allow-file-access-from-files',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--remote-debugging-port=' + CDP_PORT,
      '--user-data-dir=' + USER_DATA,
      '--window-size=1280,900',
      'about:blank',
    ],
    { stdio: 'ignore' },
  )

  const target = await findTarget()
  if (!target) {
    chrome.kill()
    throw new Error('无法连接 Chrome DevTools')
  }

  const cdp = connectCdp(target.webSocketDebuggerUrl)
  await cdp.ready
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Network.enable')

  try {
    // ── 场景 A ──
    cdp.reset()
    await navigate(cdp, pageA)
    await waitFor(cdp, `Boolean(document.querySelector('[data-testid="lock-screen"]'))`, '锁屏')
    record('X-1 file:// 双击打开即出锁屏（不是白屏）', true, 'lock-screen')

    const locked = await evaluate(cdp, `(() => ({
      protocol: location.protocol,
      workTitle: (document.title || '').trim(),
      hasApi: typeof window.__PHONE_SIM__,
      injected: !!(window.__PHONE_WORK__ && window.__PHONE_WORK__.work),
      mode: window.__PHONE_WORK__ && window.__PHONE_WORK__.mode,
    }))()`)
    record(
      'X-1 运行在 file:// 且拿到注入的作品数据',
      locked.protocol === 'file:' && locked.injected === true && locked.mode === 'folder',
      `${locked.protocol} · mode=${locked.mode} · title=${locked.workTitle}`,
    )

    // 上滑解锁
    await evaluate(cdp, swipeUnlockExpr())
    await waitFor(cdp, `Boolean(document.querySelector('[data-testid="home-screen"]'))`, '桌面')

    const home = await evaluate(
      cdp,
      `(() => ({
        icons: document.querySelectorAll('[data-testid^="home-app-"], [data-testid^="home-dock-"]').length,
        background: getComputedStyle(document.body).backgroundColor,
      }))()`,
    )
    record('X-1 解锁后进桌面，8 个应用图标', home.icons === 8, `${home.icons} 个图标`)

    // 打开照片：验证"内容真的渲染出来了"，而不只是外壳
    await evaluate(cdp, `document.querySelector('[data-testid="home-app-photos"]').click()`)
    await waitFor(
      cdp,
      `Boolean(document.querySelector('[data-testid="photos-gallery-screen"]'))`,
      '照片图库',
    )
    await sleep(300)

    const gallery = await evaluate(
      cdp,
      `(() => {
        const tiles = [...document.querySelectorAll('[data-testid="photos-grid"] [data-testid="photos-tile"]')];
        const imgs = tiles.map((t) => t.querySelector('img')).filter(Boolean);
        return {
          tiles: tiles.length,
          imgs: imgs.length,
          decoded: imgs.filter((i) => i.complete && i.naturalWidth > 0).length,
          months: [...document.querySelectorAll('[data-testid="photos-month-title"]')]
            .map((n) => n.textContent.trim()),
        };
      })()`,
    )
    record(
      'X-1 照片图库渲染出 6 张且全部解码成功',
      gallery.tiles === 6 && gallery.decoded === gallery.imgs && gallery.imgs > 0,
      `${gallery.tiles} 张 · 解码 ${gallery.decoded} 张 · 月份 ${gallery.months.join(' / ')}`,
    )

    const requestsA = cdp.takeRequests()
    const remoteA = requestsA.filter((u) => /^(https?|wss?):/i.test(u))
    record(
      'X-2 全程零 http(s) 请求（真的离线可用）',
      remoteA.length === 0,
      `${requestsA.length} 个请求，全部 file:/data:`,
    )

    const errorsA = cdp.takeErrors()
    record('X-1 控制台无错误、无未捕获异常', errorsA.length === 0, errorsA.slice(0, 2).join(' | '))

    // ── 场景 B：资源相对路径 ──
    cdp.reset()
    await navigate(cdp, pageB)
    await waitFor(cdp, `Boolean(document.querySelector('[data-testid="lock-screen"]'))`, '锁屏B')

    const assetProbe = await evaluate(
      cdp,
      `(async () => {
        const map = (window.__PHONE_WORK__ && window.__PHONE_WORK__.assets) || {};
        const width = await new Promise((resolve) => {
          const img = new Image();
          img.onload = () => resolve(img.naturalWidth);
          img.onerror = () => resolve(0);
          img.src = './assets/' + (map.img_probe || 'missing.svg');
        });
        return { fileName: map.img_probe || null, width };
      })()`,
    )
    record(
      '资源：assets/ 里的文件能按相对路径加载（file:// 同源）',
      assetProbe.fileName === 'img_probe.svg' && assetProbe.width === 8,
      `${assetProbe.fileName} · naturalWidth=${assetProbe.width}`,
    )

    const requestsB = cdp.takeRequests()
    const assetRequest = requestsB.find((u) => u.endsWith('assets/img_probe.svg'))
    record(
      '资源确实是从本地文件读的，没走网络',
      Boolean(assetRequest) && assetRequest.startsWith('file:'),
      assetRequest ? assetRequest.split('/').slice(-2).join('/') : '没抓到该请求',
    )

    const errorsB = cdp.takeErrors()
    record('资源场景控制台同样无错误', errorsB.length === 0, errorsB.slice(0, 2).join(' | '))

    // ── 场景 C：独立 HTML（单文件） ──
    cdp.reset()
    await navigate(cdp, toFileUrl(pageC))
    await waitFor(cdp, `Boolean(document.querySelector('[data-testid="lock-screen"]'))`, '锁屏C')
    record('X-4 单文件直接双击打开就出锁屏（不是白屏）', true, 'lock-screen')

    const standalone = await evaluate(
      cdp,
      `(async () => {
        const injected = window.__PHONE_WORK__ || {};
        const url = (injected.assets || {}).img_probe || '';
        const width = await new Promise((resolve) => {
          const img = new Image();
          img.onload = () => resolve(img.naturalWidth);
          img.onerror = () => resolve(0);
          img.src = url;
        });
        return {
          protocol: location.protocol,
          mode: injected.mode,
          basePath: injected.basePath,
          isDataUrl: url.startsWith('data:image/'),
          width,
        };
      })()`,
    )
    record(
      'X-4 资源是内联 dataURL 且能真正解码（不是被截断的 base64）',
      standalone.isDataUrl && standalone.width === 8,
      `mode=${standalone.mode} · naturalWidth=${standalone.width}`,
    )

    /*
     * 这条是独立 HTML 存在的全部理由：手机上打开一个 .html 就能看，
     * 不需要先解压、不需要同级目录里有 assets/ 。
     * 所以判据是"除了它自己，没读过任何磁盘文件"。
     */
    const requestsC = cdp.takeRequests()
    const sidecarC = requestsC.filter(
      (u) => u.startsWith('file:') && !u.includes('c-standalone.html'),
    )
    record(
      'X-4 全程只读自己，不依赖任何同级文件',
      sidecarC.length === 0,
      sidecarC.length ? sidecarC.slice(0, 2).join(' | ') : '零外部文件',
    )

    const errorsC = cdp.takeErrors()
    record('X-4 单文件场景控制台无错误', errorsC.length === 0, errorsC.slice(0, 2).join(' | '))

    // ── 截图留证 ──
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
    if (shot?.data) {
      const shotDir = path.join(ROOT, 'docs', 'milestones', 'shots')
      fs.mkdirSync(shotDir, { recursive: true })
      fs.writeFileSync(path.join(shotDir, 'export-package.png'), Buffer.from(shot.data, 'base64'))
      console.log('  （截图已存 docs/milestones/shots/export-package.png）')
    }
  } finally {
    cdp.close()
    chrome.kill()
  }

  // ───────────────────── 3. 结论 ─────────────────────

  const sizeA = `${(pkgA.size / 1024).toFixed(1)}KB`
  console.log(
    `\n[export] 作品包：${pkgA.fileName} · ${sizeA} · 资源 ${pkgA.assetCount} 个 · 档位 ${pkgA.tier}`,
  )

  const failed = results.filter((r) => !r.ok)
  console.log(`\n[export] ${results.length - failed.length}/${results.length} 通过`)
  cleanup()
  if (failed.length) {
    console.error(`[export] 未通过：${failed.map((f) => f.step).join('；')}`)
    process.exit(1)
  }
}

/**
 * 清理临时目录。失败不算探针失败 ——
 * Windows 上 Chrome 退出后句柄还占着几百毫秒，删不掉是常态，
 * 让"清理不干净"变成红色结论会掩盖真正的功能问题。
 */
function cleanup() {
  for (const dir of [WORK_DIR, USER_DATA]) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      console.log(`  （临时目录仍被占用，跳过删除：${dir}）`)
    }
  }
}

// ───────────────────── 小工具 ─────────────────────

function swipeUnlockExpr() {
  return `(() => {
  const el = document.querySelector('[data-testid="lock-screen"]');
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const fire = (type, y) => el.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, composed: true,
    pointerId: 1, pointerType: 'touch', isPrimary: true,
    button: 0, buttons: type === 'pointerup' ? 0 : 1,
    clientX: x, clientY: y,
  }));
  const start = rect.bottom - 80;
  fire('pointerdown', start);
  fire('pointermove', start - 200);
  fire('pointermove', start - 420);
  fire('pointerup', start - 500);
  return true;
})()`
}

/** 从导出 HTML 里取出注入的 payload（作品数据 + 资源表） */
function readInjectedPayload(rawHtml) {
  const match = rawHtml.match(
    /<script id="phone-work" type="application\/json">([\s\S]*?)<\/script>/,
  )
  if (!match) return null
  try {
    return JSON.parse(match[1])
  } catch {
    return null
  }
}

function extractWorkPayload(rawHtml) {
  return readInjectedPayload(rawHtml)?.work ?? null
}

function extractAssetsPayload(rawHtml) {
  return readInjectedPayload(rawHtml)?.assets ?? {}
}

function toFileUrl(p) {
  return 'file:///' + p.split(path.sep).join('/')
}

async function findTarget(timeoutMs = 20000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()
      const found = list.find((t) => t.type === 'page')
      if (found?.webSocketDebuggerUrl) return found
    } catch {
      /* chrome 还没起来 */
    }
    await sleep(300)
  }
  return null
}

function connectCdp(wsUrl) {
  const ws = new WebSocket(wsUrl)
  let seq = 0
  const pending = new Map()
  let requests = []
  let errors = []

  const ready = new Promise((resolve, reject) => {
    ws.onopen = () => resolve()
    ws.onerror = () => reject(new Error('WebSocket 连接失败'))
  })

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.method === 'Network.requestWillBeSent') {
      requests.push(msg.params.request.url)
    } else if (msg.method === 'Runtime.consoleAPICalled') {
      if (msg.params.type === 'error' || msg.params.type === 'warning') {
        const text = (msg.params.args ?? [])
          .map((a) => a.value ?? a.description ?? a.unserializableValue ?? '')
          .join(' ')
        errors.push(`[${msg.params.type}] ${text}`.slice(0, 300))
      }
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails
      errors.push(`[exception] ${d.exception?.description ?? d.text}`.slice(0, 300))
    }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(JSON.stringify(msg.error)))
      else resolve(msg.result)
    }
  }

  function send(method, params = {}, timeoutMs = 20000) {
    seq += 1
    const id = seq
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id)
          reject(new Error(`${method} 超时`))
        }
      }, timeoutMs)
    })
  }

  return {
    ready,
    send,
    close: () => ws.close(),
    /** 取走这一轮记录的请求与错误，下一轮从零开始 */
    takeRequests: () => {
      const out = requests
      requests = []
      return out
    },
    takeErrors: () => {
      const out = errors
      errors = []
      return out
    },
    reset: () => {
      requests = []
      errors = []
    },
  }
}

async function navigate(cdp, url) {
  await cdp.send('Page.navigate', { url })
  // 等加载完成：headless 下 Page.loadEventFired 偶发丢失，用 readyState 兜底
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    try {
      const ready = await evaluate(cdp, 'document.readyState')
      if (ready === 'complete') return
    } catch {
      /* 导航中上下文会换，忽略 */
    }
    await sleep(100)
  }
}

async function evaluate(cdp, expression) {
  const res = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  if (res.exceptionDetails) {
    throw new Error(`求值失败：${res.exceptionDetails.text ?? ''} ${expression.slice(0, 80)}`)
  }
  return res.result?.value
}

async function waitFor(cdp, expression, label, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      if (await evaluate(cdp, expression)) return
    } catch {
      /* 上下文切换中，重试 */
    }
    await sleep(120)
  }
  throw new Error(`等待超时：${label}`)
}
