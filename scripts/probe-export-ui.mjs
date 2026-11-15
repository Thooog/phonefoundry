

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import { unzipSync } from 'fflate'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const CREATOR_DIR = path.join(ROOT, 'apps', 'creator')
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

const results = []
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let DEV_PORT = 0
let CDP_PORT = 0
let dev = null
let chrome = null
let devLogFd = null
const DEV_LOG = path.join(os.tmpdir(), `phone-sim-dev-${process.pid}.log`)

function record(step, ok, detail = '') {
  results.push({ step, ok, detail })
  console.log(`  ${ok ? '✓' : '✗'} ${step}${detail ? `  ${detail}` : ''}`)
}

if (!fs.existsSync(CHROME)) {
  console.error(`[export-ui] 未找到 Chrome：${CHROME}`)
  process.exit(2)
}

const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-sim-export-ui-'))
const DOWNLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-sim-export-dl-'))

try {
  await run()
} catch (err) {
  console.error(`\n[export-ui] 探针异常终止：${err.stack ?? err.message}`)
  await shutdown()
  process.exit(1)
}

async function run() {
  DEV_PORT = await findFreePort(5300)
  CDP_PORT = await findFreePort(9400)

  // dev server 的输出必须落盘而不是 ignore：启动失败时
  // （端口被占、配置报错、依赖没装）唯一能说明原因的就在这几行里。
  devLogFd = fs.openSync(DEV_LOG, 'w')
  dev = spawn(
    process.execPath,
    ['../../node_modules/vite/bin/vite.js', '--port', String(DEV_PORT), '--strictPort'],
    { cwd: CREATOR_DIR, stdio: ['ignore', devLogFd, devLogFd] },
  )
  chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-debugging-port=' + CDP_PORT,
      '--user-data-dir=' + USER_DATA,
      '--window-size=1440,900',
      'about:blank',
    ],
    { stdio: 'ignore' },
  )

  await waitForServer()

  const target = await waitForTarget()
  if (!target) throw new Error('无法连接 Chrome DevTools')

  const cdp = connectCdp(target.webSocketDebuggerUrl)
  await cdp.ready
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  // DOM 域供导入步骤使用：headless 下没法点系统文件对话框，
  // 只能通过 DOM.setFileInputFiles 直接往 input 里塞文件
  await cdp.send('DOM.enable')

  // 让下载静默落到指定目录，否则 headless 下文件会停在"待下载"状态。
  // Browser.* 域只在浏览器级连接上有效（/json/version 那个 ws），
  // 发到页面级连接上会被忽略且不报错 —— 表现是"点了按钮但永远等不到文件"。
  const version = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json()
  const browserCdp = connectCdp(version.webSocketDebuggerUrl)
  await browserCdp.ready
  await browserCdp.send('Browser.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: DOWNLOAD_DIR,
    eventsEnabled: true,
  })

  // ── 1. 建一个示例作品，进工作区 ──
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${DEV_PORT}/` })
  await waitFor(cdp, `Boolean(document.querySelector('[data-testid="new-project"]'))`, '项目列表')
  await evaluate(cdp, `document.querySelector('[data-testid="new-project"]').click()`)
  await waitFor(cdp, `/^#\\/p\\/.+\\/overview$/.test(location.hash)`, '进入工作区')

  await waitFor(cdp, `document.querySelector('[data-testid="export-work"]')?.disabled === false`, '空项目导出可用')
  await evaluate(cdp, `document.querySelector('[data-testid="export-work"]').click()`)
  await waitFor(cdp, `!!document.querySelector('[data-testid="export-characters"]')`, '空项目导出面板')
  record('没有人物时人物导出不可用', await evaluate(cdp, `document.querySelector('[data-testid="export-characters"]').disabled`))
  await evaluate(cdp, `document.querySelector('[data-testid="export-cancel"]').click()`)
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${DEV_PORT}/#/` })
  await waitFor(cdp, `!!document.querySelector('[data-testid="new-sample"]')`, '示例入口')
  await evaluate(cdp, `document.querySelector('[data-testid="new-sample"]').click()`)
  await waitFor(cdp, `/^#\\/p\\/.+\\/overview$/.test(location.hash)`, '示例工作区')

  await evaluate(cdp, `location.hash = location.hash.replace(/overview$/, 'characters')`)
  await waitFor(cdp, `!!document.querySelector('[data-testid$="-friendList"] .charpick__toggle')`, 'KKT 好友配置')
  await evaluate(cdp, `document.querySelector('[data-testid$="-friendList"] .charpick__toggle').click()`)
  await evaluate(cdp, `document.querySelector('[data-testid$="-friendList"] .charpick__opt').click()`)
  await evaluate(cdp, `document.querySelector('[data-testid^="save-account-"]').click()`)
  await waitFor(cdp, `document.querySelector('.accform__footer').textContent.includes('账号资料已保存')`, '好友配置已保存')
  await cdp.send('Page.reload', { ignoreCache: true })
  await waitFor(cdp, `document.querySelector('[data-testid$="-friendList"] .charpick__names')?.textContent.includes('演示人物 B')`, '好友配置刷新保留')
  record('人物页 KKT 好友多选复用关注列表样式，保存刷新后保留', true)
  await evaluate(cdp, `location.hash = location.hash.replace(/characters$/, 'overview')`)
  await waitFor(cdp, `!!document.querySelector('.work-home h1')`, '返回概览')

  // 按钮的 disabled 绑着 !ready：刚进工作区时项目数据还没读回来，按钮还是禁用态。
  // 必须先等它可用再断言 —— 直接读会偶发失败，读到的正是那一瞬间的 disabled，
  // 而 textContent 已经是「导出作品」，所以失败信息看起来像"按钮不见了"。
  try {
    await waitFor(
      cdp,
      `(() => { const b = document.querySelector('[data-testid="export-work"]'); return !!b && !b.disabled; })()`,
      '导出按钮可用',
      10000,
    )
  } catch {
    /* 超时就交给下面的断言报告实际状态 */
  }

  const bar = await evaluate(
    cdp,
    `(() => {
      const btn = document.querySelector('[data-testid="export-work"]');
      return { exists: !!btn, label: btn ? btn.textContent.trim() : '', disabled: btn ? btn.disabled : null };
    })()`,
  )
  record(
    '工作区顶栏有「导出作品」且可用',
    bar.exists && bar.label.includes('导出') && bar.disabled === false,
    `「${bar.label}」`,
  )

  // ── 2. 点「导出作品」→ 面板出现 ──
  await evaluate(cdp, `document.querySelector('[data-testid="export-work"]').click()`)
  await waitFor(cdp, `!!document.querySelector('[data-testid="export-panel"]')`, '导出面板出现')

  // 面板要先把作品端产物取回来才估得出体积，这期间按钮是禁用的
  await waitFor(
    cdp,
    `(() => {
      const sizes = [...document.querySelectorAll('.xp__size')].map((n) => n.textContent);
      return sizes.length === 4 && sizes.every((s) => /约/.test(s));
    })()`,
    '预估体积算完',
    20000,
  )

  const panel = await evaluate(
    cdp,
    `(() => {
      const p = document.querySelector('[data-testid="export-panel"]');
      const cards = [...p.querySelectorAll('.xp__option')];
      return {
        count: cards.length,
        titles: cards.map((c) => c.querySelector('strong').textContent.trim()),
        sizes: cards.map((c) => c.querySelector('.xp__size').textContent.trim()),
        groups: [...p.querySelectorAll('.xp__group h3')].map((n) => n.textContent.trim()),
        primary: cards.filter((c) => c.querySelector('input')?.checked).length,
      };
    })()`,
  )

  record(
    '面板列出四种形态，分成「给读者」「给自己」',
    panel.count === 4 && panel.groups.includes('给读者') && panel.groups.includes('给自己'),
    `${panel.titles.join(' / ')}`,
  )
  record(
    '每个选项都显示预估体积，且默认选择作品包',
    panel.sizes.every((s) => /约\s?[\d.]+(B|KB|MB)/.test(s)) && panel.primary === 1,
    panel.sizes.join(' | '),
  )

  // 面板的视觉证据：分组是否真的看得出界线、体积数字是否对齐
  const panelShot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  const panelShotPath = path.join(ROOT, 'docs', 'milestones', 'shots', 'export-panel.png')
  fs.mkdirSync(path.dirname(panelShotPath), { recursive: true })
  fs.writeFileSync(panelShotPath, Buffer.from(panelShot.data, 'base64'))
  console.log(`  （截图已存 ${path.relative(ROOT, panelShotPath)}）`)

  for (const [width, height] of [[375, 812], [667, 375]]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
    const layout = await evaluate(cdp, `(() => {
      const p = document.querySelector('.xp__panel');
      const r = p.getBoundingClientRect();
      const button = p.querySelector('[data-testid="export-confirm"]');
      button.scrollIntoView({block: 'nearest'});
      const b = button.getBoundingClientRect();
      return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight && p.scrollWidth <= p.clientWidth && b.bottom <= innerHeight && b.top >= 0 && b.height >= 44;
    })()`)
    record(`${width}×${height} 导出面板无横向溢出且可操作`, layout)
  }
  await cdp.send('Emulation.clearDeviceMetricsOverride')

  // ── 3. 作品包 ──
  const beforeZip = snapshotDownloads()
  await evaluate(cdp, `document.querySelector('[data-testid="export-work-package"]').click()`)
  await evaluate(cdp, `document.querySelector('[data-testid="export-confirm"]').click()`)
  const zip = await waitForNewDownload(beforeZip, 25000)

  record(
    '选「作品包」后浏览器落下一个 zip',
    Boolean(zip),
    zip ? `${zip.name} · ${(zip.size / 1024).toFixed(1)}KB` : '没有文件',
  )

  if (!zip) {
    console.error('  控制台：', cdp.takeErrors().slice(0, 4).join('\n  '))
  } else {
    record('作品包文件名是「作品名_日期.zip」', /^.+_\d{8}\.zip$/.test(zip.name), zip.name)

    const files = unzipSync(new Uint8Array(fs.readFileSync(zip.path)))
    const names = Object.keys(files)
    record(
      '作品包结构是 顶层目录/index.html',
      names.length >= 1 &&
        names.every((n) => n.split('/').length === 2) &&
        names.some((n) => n.endsWith('/index.html')),
      names.join(' / '),
    )

    // 浏览器里导出的 HTML 必须同样内联了作品端产物：
    // 这证明它取到的是预览正在用的那份 renderer.js，而不是某个占位
    const htmlEntry = names.find((n) => n.endsWith('/index.html'))
    const html = htmlEntry ? new TextDecoder().decode(files[htmlEntry]) : ''
    record(
      '浏览器导出的 HTML 同样内联了作品端产物',
      html.includes('window.__PHONE_SIM__'),
      `${(html.length / 1024).toFixed(1)}KB HTML`,
    )
    record(
      '导出的 HTML 带 viewport（手机端不会"手机套手机"）',
      html.includes('name="viewport"') && html.includes('width=device-width'),
      'viewport ✓',
    )
  }

  // ── 4. 独立 HTML ──
  await openPanel(cdp)
  const beforeHtml = snapshotDownloads()
  await evaluate(cdp, `document.querySelector('[data-testid="export-standalone-html"]').click()`)
  await evaluate(cdp, `document.querySelector('[data-testid="export-confirm"]').click()`)
  const single = await waitForNewDownload(beforeHtml, 30000)

  record(
    '选「独立 HTML」后落下一个 .html',
    Boolean(single) && single.name.endsWith('.html'),
    single ? `${single.name} · ${(single.size / 1024).toFixed(1)}KB` : '没有文件',
  )

  if (single) {
    const text = new TextDecoder().decode(new Uint8Array(fs.readFileSync(single.path)))
    /*
     * 这里断言的是"资源通道变成了内联"，而不是"一定有图"。
     * 探针建的是空项目（没有照片），此时本来就没有 dataURL 可找；
     * 拿"必须有 dataURL"当判据，会在空项目上一直假失败。
     * 有图时的 dataURL 断言在 probe-export-package.mjs 里（那边造的是带图项目）。
     */
    const payload = text.match(
      /<script id="phone-work" type="application\/json">([\s\S]*?)<\/script>/,
    )
    const injected = payload ? JSON.parse(payload[1]) : {}
    /*
     * 判据用 basePath 而不是"文本里有没有 assets/"：
     * 作品端产物自己就内含 `'./assets/'` 这个默认值字符串（asset-resolver 的兜底），
     * 拿它当"还在引用外部文件"的证据会永久假失败。
     * inline 模式下 buildWorkHtml 把 basePath 置空、资源表直接放 dataURL，
     * 这两个字段才是真正的通道开关。
     */
    record(
      '独立 HTML 走 inline 资源通道（basePath 置空，不按文件名找图）',
      injected.mode === 'inline' && injected.basePath === '',
      `mode=${injected.mode || '未读到'} · basePath=${JSON.stringify(injected.basePath ?? null)}`,
    )
    record(
      '独立 HTML 比作品包大（base64 的代价，面板已提示）',
      zip ? single.size > zip.size : true,
      zip ? `${(single.size / zip.size).toFixed(2)}×` : '',
    )
  }

  // 人物包：下载后既不带剧情，也可以通过现有入口重新导入。
  await openPanel(cdp)
  const beforeCharacters = snapshotDownloads()
  await evaluate(cdp, `document.querySelector('[data-testid="export-characters"]').click()`)
  await evaluate(cdp, `document.querySelector('[data-testid="export-confirm"]').click()`)
  const characters = await waitForNewDownload(beforeCharacters, 25000)
  record('导出人物下载独立人物包', Boolean(characters) && /_人物包_\d{8}\.zip$/.test(characters.name))
  if (characters) {
    const files = unzipSync(new Uint8Array(fs.readFileSync(characters.path)))
    const project = JSON.parse(new TextDecoder().decode(files['project.json']))
    record('人物包保留人物和账号，不含剧情内容', project.characters.length === 2 && project.platformAccounts.length > 0 && Object.values(project.appData).every(bucket => Object.values(bucket).every(items => items.length === 0)))
    record('人物包保留 KKT 好友列表配置', project.platformAccounts.some(account => account.platform === 'kakaotalk' && account.extraFields?.friendList?.includes(project.characters[1].id)))
  }

  // ── 5. 项目备份包 ──
  await openPanel(cdp)
  const beforeBackup = snapshotDownloads()
  await evaluate(cdp, `document.querySelector('[data-testid="export-project-backup"]').click()`)
  await evaluate(cdp, `document.querySelector('[data-testid="export-confirm"]').click()`)
  const backup = await waitForNewDownload(beforeBackup, 30000)

  record(
    '选「项目备份包」后落下一个 zip，名字带「项目备份」',
    Boolean(backup) && /_项目备份_\d{8}\.zip$/.test(backup.name),
    backup ? backup.name : '没有文件',
  )

  if (backup) {
    const files = unzipSync(new Uint8Array(fs.readFileSync(backup.path)))
    const names = Object.keys(files).sort()
    record(
      '备份包是 manifest + project.json + assets/，且没有 index.html',
      names.includes('manifest.json') &&
        names.includes('project.json') &&
        !names.includes('index.html'),
      names.join(' / '),
    )

    const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json']))
    record(
      'manifest 能被认出来（format = phone-simulator-project）',
      manifest.format === 'phone-simulator-project' && manifest.projectId,
      `${manifest.projectName} · ${manifest.appVersion || '无版本号'}`,
    )
  }

  // ── 6. 把刚导出的备份包导回来 ──
  if (backup) {
    const imported = await importBackup(cdp, backup)
    record(
      '导入刚导出的备份包：进到了新项目',
      imported.ok,
      imported.detail,
    )
    record(
      '导入后的名字带「（导入）」，没有覆盖原项目',
      imported.name?.includes('（导入）'),
      imported.name ?? '没有读到项目名',
    )
  }

  if (characters) {
    const imported = await importBackup(cdp, characters)
    record('人物包可导入为新的创作项目', imported.ok && imported.name?.includes('人物'))
  }

  // ── 7. Toast 反馈 ──
  const toasts = await evaluate(
    cdp,
    `[...document.querySelectorAll('.ui-toast')].map((n) => n.textContent.trim())`,
  )
  record(
    '全过程有 Toast 带文件名与体积',
    toasts.some((t) => /\.(zip|html)/.test(t) && /KB|MB/.test(t)),
    toasts.slice(0, 3).join(' | ') || '没有 Toast',
  )

  const errors = cdp.takeErrors().filter((e) => !e.includes('[warning]'))
  record('全程无页面错误', errors.length === 0, errors.slice(0, 2).join(' | '))

  await evaluate(cdp, `window.originalFetch = window.fetch; window.fetch = (url, ...args) => String(url).includes('player-runtime/') ? Promise.reject(new Error('模拟作品端不可用')) : window.originalFetch(url, ...args)`)
  await openPanel(cdp)
  await waitFor(cdp, `!!document.querySelector('[data-testid="export-error"]')`, '作品端加载失败提示')
  await evaluate(cdp, `document.querySelector('[data-testid="export-characters"]').click()`)
  record('作品端不可用时仍可选择并导出人物', await evaluate(cdp, `!document.querySelector('[data-testid="export-characters"]').disabled && !document.querySelector('[data-testid="export-confirm"]').disabled`))
  const beforeWithoutPlayer = snapshotDownloads()
  await evaluate(cdp, `document.querySelector('[data-testid="export-confirm"]').click()`)
  record('人物导出无需作品端产物', Boolean(await waitForNewDownload(beforeWithoutPlayer, 25000)))
  await evaluate(cdp, `window.fetch = window.originalFetch; delete window.originalFetch`)

  await shutdown()

  const failed = results.filter((r) => !r.ok)
  console.log(`\n[export-ui] ${results.length - failed.length}/${results.length} 通过`)
  if (failed.length) {
    console.error(`[export-ui] 未通过：${failed.map((f) => f.step).join('；')}`)
    process.exit(1)
  }
}

// ───────────────────── 基础设施 ─────────────────────

/**
 * 现场找一个空闲端口。
 *
 * 写死端口在这个项目上是真踩过的：5283 被 QQ 占着，
 * `--strictPort` 让 vite 秒退，而 stdio:'ignore' 把原因一起吞了，
 * 最后只看到一句"dev server 没有起来"。
 * 顺手也把 CDP 端口纳入同一套逻辑 —— 9373 撞车同样会让人找不到北。
 */
async function findFreePort(start) {
  for (let port = start; port < start + 200; port += 1) {
    if (await isPortFree(port)) return port
  }
  throw new Error(`从 ${start} 起找不到空闲端口`)
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => server.close(() => resolve(true)))
    server.listen(port, '127.0.0.1')
  })
}

async function shutdown() {
  try {
    dev?.kill()
  } catch {
    /* 已退出 */
  }
  try {
    chrome?.kill()
  } catch {
    /* 已退出 */
  }
  if (devLogFd !== null) {
    try {
      fs.closeSync(devLogFd)
    } catch {
      /* 已关闭 */
    }
    devLogFd = null
  }
  for (const dir of [USER_DATA, DOWNLOAD_DIR]) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      console.log(`  （临时目录仍被占用，跳过删除：${dir}）`)
    }
  }
}

async function waitForServer(timeoutMs = 40000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      if ((await fetch(`http://127.0.0.1:${DEV_PORT}/`)).ok) return
    } catch {
      /* 还没起来 */
    }
    await sleep(300)
  }
  throw new Error(
    `创作端 dev server 没有起来（端口 ${DEV_PORT}）\n${readLogTail(DEV_LOG)}`,
  )
}

/** 读 dev server 日志的尾部：启动失败时这几行就是全部线索 */
function readLogTail(file, lines = 15) {
  try {
    const text = fs.readFileSync(file, 'utf8').trimEnd()
    return text.split(/\r?\n/).slice(-lines).join('\n')
  } catch {
    return '（没有日志）'
  }
}

function snapshotDownloads() {
  return new Set(fs.existsSync(DOWNLOAD_DIR) ? fs.readdirSync(DOWNLOAD_DIR) : [])
}

/**
 * 等一个**新**文件出现。
 *
 * 不能用"目录里有 zip 就算成功"：这个探针要连续导出三次，
 * 第二次开始目录里已经躺着上一次的文件，会立刻误判成"下载成功"，
 * 于是后面解出来的全是第一个包 —— 检查全绿但什么都没验证到。
 */
async function waitForNewDownload(before, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const entries = fs.existsSync(DOWNLOAD_DIR) ? fs.readdirSync(DOWNLOAD_DIR) : []
    const fresh = entries.find((n) => !before.has(n) && !n.endsWith('.crdownload'))
    if (fresh) {
      const full = path.join(DOWNLOAD_DIR, fresh)
      const stat = fs.statSync(full)
      // Chrome 先建空文件再写内容，大小为 0 时再等一轮
      if (stat.size > 0) return { name: fresh, path: full, size: stat.size }
    }
    await sleep(200)
  }
  return null
}

/** 打开导出面板，并等到预估体积算完（结算前按钮是禁用的） */
async function openPanel(cdp) {
  await evaluate(cdp, `document.querySelector('[data-testid="export-work"]').click()`)
  await waitFor(cdp, `!!document.querySelector('[data-testid="export-panel"]')`, '导出面板出现')
  await waitFor(
    cdp,
    `(() => {
      const sizes = [...document.querySelectorAll('.xp__size')].map((n) => n.textContent);
      return sizes.length === 4 && sizes.every((s) => /约/.test(s));
    })()`,
    '预估体积算完',
    20000,
  )
}

/**
 * 把一个真实的备份文件塞进「导入项目」的文件输入框。
 *
 * `DOM.setFileInputFiles` 是 CDP 里唯一能绕过系统文件选择器的办法 ——
 * headless 下没法点系统对话框。它会派发 change，
 * 但不同 Chrome 版本上有差异，所以再手动补一次：
 * 处理函数开头会 `input.value = ''`，第二次触发时 files 已经空了，
 * 会直接 return，不会导入两遍。
 */
async function importBackup(cdp, backup) {
  await evaluate(cdp, `location.hash = '#/'`)
  try {
    await waitFor(
      cdp,
      `!!document.querySelector('[data-testid="import-project"]')`,
      '回到项目列表',
      10000,
    )
  } catch {
    return { ok: false, detail: '没能回到项目列表' }
  }

  const doc = await cdp.send('DOM.getDocument', { depth: -1 })
  const found = await cdp.send('DOM.querySelector', {
    nodeId: doc.root.nodeId,
    selector: '[data-testid="import-file"]',
  })
  if (!found?.nodeId) return { ok: false, detail: '找不到文件输入框' }

  await cdp.send('DOM.setFileInputFiles', { files: [backup.path], nodeId: found.nodeId })
  await sleep(200)
  /*
   * 补一次 change。两种时序都要能过：
   *  - setFileInputFiles 已经派发并被处理 → 此时已跳转到工作区，
   *    文件 input 早就不在 DOM 里了，querySelector 返回 null
   *  - 没派发 → 手动补上
   * 所以这里用可选链 + 捕获，不能因为"元素不在了"把整个探针打挂。
   */
  try {
    await evaluate(
      cdp,
      `document.querySelector('[data-testid="import-file"]')
         ?.dispatchEvent(new Event('change', { bubbles: true }))`,
    )
  } catch {
    /* 页面已跳转，说明第一次触发就成功了 */
  }

  try {
    await waitFor(
      cdp,
      `/^#\\/p\\/.+\\/overview$/.test(location.hash)`,
      '导入后进入工作区',
      30000,
    )
  } catch {
    const errors = cdp.takeErrors().slice(0, 2).join(' | ')
    return { ok: false, detail: `导入后没有跳转${errors ? `：${errors}` : ''}` }
  }

  const name = await evaluate(
    cdp,
    `document.querySelector('.ws__name')?.textContent?.trim() ?? ''`,
  )
  return { ok: true, name, detail: name }
}

async function waitForTarget(timeoutMs = 20000) {
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
  let errors = []

  const ready = new Promise((resolve, reject) => {
    ws.onopen = () => resolve()
    ws.onerror = () => reject(new Error('WebSocket 连接失败'))
  })

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.method === 'Runtime.consoleAPICalled') {
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
    takeErrors: () => {
      const out = errors
      errors = []
      return out
    },
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

async function waitFor(cdp, expression, label, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      if (await evaluate(cdp, expression)) return
    } catch {
      /* 导航/上下文切换中，重试 */
    }
    await sleep(120)
  }
  throw new Error(`等待超时：${label}`)
}
