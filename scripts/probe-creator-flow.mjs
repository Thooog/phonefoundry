

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import { reloadAndWait, removeTempDir } from './lib/probe-kit.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const CREATOR_DIR = path.join(ROOT, 'apps', 'creator')
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const DEV_PORT = 5273
const CDP_PORT = 9341

if (!fs.existsSync(CHROME)) {
  console.error('[m2] 未找到 Chrome：' + CHROME)
  process.exit(2)
}

const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-sim-creator-flow-'))

const results = []
const cleanups = []
cleanups.push(() => removeTempDir(USER_DATA))

function record(step, ok, detail = '') {
  results.push({ step, ok, detail })
  console.log(`  ${ok ? '✓' : '✗'} ${step}${detail ? `  ${detail}` : ''}`)
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

// ───────────────────── dev server ─────────────────────

console.log('[m2] 启动 dev server…')
const dev = spawn(
  process.execPath,
  ['../../node_modules/vite/bin/vite.js', '--port', String(DEV_PORT), '--strictPort'],
  { cwd: CREATOR_DIR, stdio: 'ignore' },
)
cleanups.push(() => dev.kill())

async function waitForServer(timeoutMs = 30000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEV_PORT}/`)
      if (res.ok) return true
    } catch {
      /* 还没起来 */
    }
    await sleep(300)
  }
  return false
}

if (!(await waitForServer())) {
  console.error('[m2] dev server 启动失败')
  await Promise.all(cleanups.map((fn) => fn()))
  process.exit(1)
}
console.log(`[m2] dev server 就绪 http://127.0.0.1:${DEV_PORT}`)

// ───────────────────── Chrome ─────────────────────

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${USER_DATA}`,
    '--window-size=1280,900',
    `http://127.0.0.1:${DEV_PORT}/`,
  ],
  { stdio: 'ignore' },
)
cleanups.push(() => chrome.kill())

async function waitForTarget(timeoutMs = 20000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)
      if (res.ok) {
        const list = await res.json()
        const page = list.find((t) => t.type === 'page' && t.url.includes(`:${DEV_PORT}`))
        if (page) return page
      }
    } catch {
      /* 还没起来 */
    }
    await sleep(300)
  }
  return null
}

function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl)
  let seq = 0
  const pending = new Map()

  const ready = new Promise((resolve, reject) => {
    ws.onopen = () => resolve()
    ws.onerror = () => reject(new Error('WebSocket 错误'))
  })

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(JSON.stringify(msg.error)))
      else resolve(msg.result)
    }
  }

  function send(method, params = {}, timeoutMs = 15000) {
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

  return { ready, send, close: () => ws.close() }
}

const target = await waitForTarget()
if (!target) {
  console.error('[m2] 无法连接 DevTools')
  await Promise.all(cleanups.map((fn) => fn()))
  process.exit(1)
}

const session = cdp(target.webSocketDebuggerUrl)
await session.ready
await session.send('Runtime.enable')
await session.send('Page.enable')

/** 在页面里执行表达式并取回结果 */
async function evaluate(expression) {
  const res = await session.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  if (res.exceptionDetails) {
    throw new Error(res.exceptionDetails.exception?.description ?? '页面内异常')
  }
  return res.result?.value
}

async function waitFor(expression, label, timeoutMs = 12000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (await evaluate(`Boolean(${expression})`)) return true
    await sleep(150)
  }
  throw new Error(`等待超时：${label}`)
}

const SET_INPUT = `
window.__setInput = (selector, value) => {
  const el = document.querySelector(selector);
  if (!el) return false;
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
};
true
`

const HASH = `window.location.hash`

console.log('\n[m2] 流程检查\n')

try {
  /*
   * 先等应用真正挂上，再动手。
   *
   * 冷缓存下 Vite 会"发现新依赖 → 重新预构建 → 强制刷新页面"，
   * 那一瞬间文档还是 about:blank：此时执行绝对路径的动态 import
   * 会报 `Failed to resolve module specifier "/src/db/connection.js"` ——
   * 看上去像模块不存在，其实是抢跑了半个导航。
   */
  await waitFor(
    `location.href.includes(':${DEV_PORT}') && document.readyState === 'complete' && Boolean(document.querySelector('h1'))`,
    '应用首次挂载完成',
    30000,
  )

  await evaluate(SET_INPUT)

  // ── 0. 清空本地库，保证从"首次使用"开始 ──
  // 用 deleteDatabase 而不是删 Chrome profile：
  // 清库是应用自己的 API，删 user-data-dir 则是去动文件系统，
  // 后者既危险又慢（每次都要重建整个 profile）。
  const wiped = await evaluate(`(async () => {
    const conn = await import('/src/db/connection.js');
    try {
      await conn.deleteDatabase();
      return 'ok';
    } catch (err) {
      return 'fail: ' + err.message;
    }
  })()`)
  if (wiped !== 'ok') throw new Error(`清空本地库失败：${wiped}`)
  // reload 后必须等「新文档」而不是「某个元素」。
  // 旧文档里本来就有 h1，直接 waitFor 会假阳性立刻通过，
  // 随后的操作却落进 Vue 还没挂载的新文档。
  await reloadAndWait(
    { evaluate, reload: () => session.send('Page.reload', { ignoreCache: true }) },
    `document.readyState === 'complete' && document.querySelector('h1')`,
    '清库后页面重新加载',
  )
  await evaluate(SET_INPUT)
  console.log('  · 已清空本地库，从首次使用状态开始\n')

  // ── 1. 首屏：直接进项目管理，不是作品锁屏 ──
  await waitFor(
    `document.querySelector('[data-testid="projects-empty"]') || document.querySelector('[data-testid="projects-grid"]')`,
    '列表页渲染',
  )
  const firstScreen = await evaluate(`({
    heading: document.querySelector('h1')?.textContent?.trim() ?? '',
    isEmpty: Boolean(document.querySelector('[data-testid="projects-empty"]')),
    hasLockScreen: Boolean(document.querySelector('[class*="lock"]')),
  })`)
  record(
    '首屏直接是项目管理，无作品锁屏',
    firstScreen.heading === '我的作品' && !firstScreen.hasLockScreen,
    `h1="${firstScreen.heading}" 空态=${firstScreen.isEmpty}`,
  )

  // ── 2. 新建项目并进入工作区 ──
  await evaluate(`document.querySelector('[data-testid="new-project"]').click()`)
  await waitFor(`/^#\\/p\\/.+\\/overview$/.test(${HASH})`, '进入项目概览')
  // hash 变了不代表渲染完了，等标题出现再断言，否则会跟 Vue 的首次渲染抢时间
  await waitFor(`document.querySelector('.work-home h1')`, '概览页标题渲染')
  const afterCreate = await evaluate(`({
    hash: ${HASH},
    title: document.querySelector('.work-home h1')?.textContent?.trim() ?? '',
    nav: Boolean(document.querySelector('[data-testid="workspace-nav"]')),
  })`)
  record(
    '新建项目后直接进入工作区概览',
    afterCreate.title === '未命名作品' && afterCreate.nav,
    afterCreate.hash,
  )

  // ── 3. 改作品设置：手机名 + 壁纸 + 密码 ──
  const projectId = await evaluate(`(${HASH}.match(/^#\\/p\\/([^/]+)/) || [])[1]`)
  await evaluate(`(window.location.hash = '#/p/${projectId}/settings'), true`)
  await waitFor(`document.querySelector('[data-testid="phone-name"]')`, '作品设置面板')

  await evaluate(`window.__setInput('[data-testid="phone-name"]', '林夏的手机')`)
  await sleep(120)
  await evaluate(`document.querySelectorAll('.wall')[2].click()`)
  await sleep(120)
  // 两个浏览方式开关：数据进 workSettings，刷新后要还在（第 5 步按 store 断言）
  await evaluate(`document.querySelector('#frame-mode').click()`)
  await sleep(120)
  await evaluate(`document.querySelector('#auto-fullscreen').click()`)
  await sleep(120)

  // 密码开关必须按 id 点：面板里现在有多个开关，取"第一个"会点到别的上去
  await evaluate(`(() => {
    document.querySelector('#passcode-enabled').click();
    return true;
  })()`)
  await waitFor(`document.querySelector('[data-testid="passcode"]')`, '密码输入框出现')
  await evaluate(`window.__setInput('[data-testid="passcode"]', '2468')`)
  await sleep(120)

  // ── 4. 等落盘：状态回到"已保存" ──
  await waitFor(
    `document.querySelector('[data-testid="save-status"]')?.dataset.tone === 'ok'`,
    '保存完成',
  )
  record('改设置后自动保存成功', true, '状态栏回到「已保存」')

  // 这条尤其不能靠旧 DOM：刷新前页面里就有 phone-name 输入框，
  // waitFor 会立刻命中旧文档，读到的是刷新前的值 —— 断言会假通过。
  await reloadAndWait(
    { evaluate, reload: () => session.send('Page.reload', { ignoreCache: true }) },
    `document.querySelector('[data-testid="phone-name"]')`,
    '刷新后重新渲染设置页',
  )
  const afterReload = await evaluate(`({
    phoneName: document.querySelector('[data-testid="phone-name"]').value,
    passcode: document.querySelector('[data-testid="passcode"]')?.value ?? '',
    activeWall: document.querySelectorAll('.wall')[2]?.classList.contains('wall--active') ?? false,
    readonly: Boolean(document.querySelector('[data-testid="readonly-banner"]')),
    disabled: document.querySelector('[data-testid="phone-name"]')?.disabled ?? null,
  })`)
  record(
    '刷新后手机名仍在',
    afterReload.phoneName === '林夏的手机',
    `读到「${afterReload.phoneName}」`,
  )
  record('刷新后锁屏密码仍在', afterReload.passcode === '2468', `读到「${afterReload.passcode}」`)
  record('刷新后壁纸选择仍在', afterReload.activeWall === true)

  /*
   * 两个浏览方式开关读 store，不读 DOM。
   *
   * 开关的视觉态是 `<input :checked>`，它跟着数据走 —— 读它只能证明"界面画对了"，
   * 证明不了"值进库了、刷新后还在"。这两个字段要跟着作品一起导出，
   * 没落库的话读者打开作品还是旧行为，而创作端看上去一切正常。
   */
  const reloadedToggles = await evaluate(`(async () => {
    const { useProjectStore } = await import('/src/stores/project.js');
    const s = useProjectStore().project?.workSettings ?? {};
    return { frameMode: s.frameMode, autoFullscreen: s.autoFullscreen };
  })()`)
  record(
    '刷新后「始终显示手机外框」仍在',
    reloadedToggles.frameMode === 'always',
    `frameMode=${reloadedToggles.frameMode}`,
  )
  record(
    '刷新后「自动全屏」仍在',
    reloadedToggles.autoFullscreen === true,
    `autoFullscreen=${reloadedToggles.autoFullscreen}`,
  )
  // 标签页的身份存在 sessionStorage，刷新后应当还是"自己"，不能把自己判成别人
  record(
    '刷新后仍是自己的编辑权（没变成只读）',
    afterReload.readonly === false && afterReload.disabled === false,
    `只读=${afterReload.readonly} 输入框禁用=${afterReload.disabled}`,
  )

  // ── 6. 回列表，项目出现在卡片里 ──
  await evaluate(`(window.location.hash = '#/projects'), true`)
  await waitFor(`document.querySelector('[data-testid="projects-grid"]')`, '列表页出现卡片')
  const listState = await evaluate(`({
    count: document.querySelectorAll('.card').length,
    name: document.querySelector('.card__name')?.textContent?.trim() ?? '',
    empty: Boolean(document.querySelector('[data-testid="projects-empty"]')),
  })`)
  record(
    '列表中能看到刚建的项目',
    listState.count === 1 && listState.name === '未命名作品' && !listState.empty,
    `${listState.count} 张卡片，名字「${listState.name}」`,
  )

  // ── 7. 删除：必须先出确认框，取消则不动 ──
  await evaluate(`[...document.querySelectorAll('.card__ops button')].find(b => b.textContent.trim() === '删除').click()`)
  await waitFor(`document.querySelector('[data-testid="confirm-ok"]')`, '删除确认框')
  const dialogText = await evaluate(
    `document.querySelector('.ui-confirm__message')?.textContent ?? ''`,
  )
  record(
    '删除有确认框且说明影响面',
    dialogText.includes('无法恢复'),
    '文案含「无法恢复」',
  )

  await evaluate(`document.querySelector('[data-testid="confirm-cancel"]').click()`)
  await sleep(300)
  const afterCancel = await evaluate(`document.querySelectorAll('.card').length`)
  record('取消删除后项目还在', afterCancel === 1, `${afterCancel} 张卡片`)

  // ── 8. 真删 ──
  await evaluate(`[...document.querySelectorAll('.card__ops button')].find(b => b.textContent.trim() === '删除').click()`)
  await waitFor(`document.querySelector('[data-testid="confirm-ok"]')`, '删除确认框（第二次）')
  await evaluate(`document.querySelector('[data-testid="confirm-ok"]').click()`)
  await waitFor(`document.querySelector('[data-testid="projects-empty"]')`, '列表回到空态')
  record('确认删除后列表回到空态', true)

  // ── 9. 空态的两个出口都在 ──
  const emptyActions = await evaluate(`({
    sample: Boolean(document.querySelector('[data-testid="new-sample"]')),
    create: [...document.querySelectorAll('button')].some(b => b.textContent.includes('新建空项目')),
  })`)
  record(
    '空态提供「新建空项目」与「载入示例作品」两条出路',
    emptyActions.sample && emptyActions.create,
  )

  // ── 10. 载入示例项目：验证工厂产出的真实结构 ──
  await evaluate(`document.querySelector('[data-testid="new-sample"]').click()`)
  await waitFor(`/^#\\/p\\/.+\\/overview$/.test(${HASH})`, '进入示例项目概览')
  const sampleStats = await evaluate(`(async () => {
    const { useProjectStore } = await import('/src/stores/project.js');
    const p = useProjectStore().project;
    return { name: document.querySelector('.ws__name')?.textContent?.trim() ?? '', stats: [p.characters.length, p.platformAccounts.length, p.assets.length] };
  })()`)
  record(
    '示例项目能打开且带角色与账号',
    Number(sampleStats.stats[0]) > 0 && Number(sampleStats.stats[1]) > 0,
    `角色 ${sampleStats.stats[0]} / 账号 ${sampleStats.stats[1]} / 图片 ${sampleStats.stats[2]}`,
  )

  // 中性功能展示：两个人物占位、四平台账号、三条会话及各消息类型。
  // 从 store 读取结构，不依赖概览页的视觉排版。
  const sampleShape = await evaluate(`(async () => {
    const { useProjectStore } = await import('/src/stores/project.js');
    const p = useProjectStore().project;
    const apps = p?.appData ?? {};
    const messages = Object.values(apps).flatMap(a => a?.messages ?? []);
    const posts = Object.values(apps).flatMap(a => a?.posts ?? []);
    const conversations = Object.values(apps).flatMap(a => a?.conversations ?? []);
    return {
      isSample: p?.isSample === true,
      characters: p?.characters?.length ?? 0,
      accounts: p?.platformAccounts?.length ?? 0,
      conversations: conversations.length,
      messages: messages.length,
      posts: posts.length,
      assets: p?.assets?.length ?? 0,
    };
  })()`)
  record(
    'H-2b 示例项目结构完整',
    sampleShape.isSample &&
      sampleShape.characters === 2 &&
      sampleShape.accounts === 8 &&
      sampleShape.conversations === 3 &&
      sampleShape.messages === 19 &&
      sampleShape.posts === 6,
    `isSample=${sampleShape.isSample} 角色${sampleShape.characters} 账号${sampleShape.accounts} ` +
      `会话${sampleShape.conversations} 消息${sampleShape.messages} 帖子${sampleShape.posts} ` +
      `图片${sampleShape.assets}`,
  )
  record(
    'H-2b 示例项目零图片资源（不牵动孤儿回收）',
    sampleShape.assets === 0,
    `图片 ${sampleShape.assets} 张`,
  )
} catch (err) {
  record('流程执行', false, err.message)
} finally {
  session.close()
  await sleep(200)
  await Promise.all(cleanups.map((fn) => fn()))
}

const failed = results.filter((r) => !r.ok)
console.log('')
if (failed.length === 0) {
  console.log(`[m2] 结论：${results.length} 项流程检查全部通过`)
  process.exit(0)
}
console.log(`[m2] 结论：${failed.length} / ${results.length} 项未通过`)
for (const f of failed) console.log(`  ✗ ${f.step}  ${f.detail}`)
process.exit(1)
