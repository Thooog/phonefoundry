

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, URL } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const CREATOR_DIR = path.join(ROOT, 'apps', 'creator')
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const DEV_PORT = 5279
const CDP_PORT = 9347

if (!fs.existsSync(CHROME)) {
  console.error('[m2-manual] 未找到 Chrome：' + CHROME)
  process.exit(2)
}

const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-sim-manual-'))
// Vite 的 /@fs/ 只认正斜杠，Windows 路径必须先转换
const SHARED_APPS_URL = '/@fs/' + path.join(ROOT, 'packages/shared/src/constants/apps.js').split(path.sep).join('/')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
function record(step, ok, detail = '') {
  results.push({ step, ok, detail })
  console.log(`  ${ok ? '✓' : '✗'} ${step}${detail ? `  ${detail}` : ''}`)
}

const dev = spawn(
  process.execPath,
  ['../../node_modules/vite/bin/vite.js', '--port', String(DEV_PORT), '--strictPort'],
  { cwd: CREATOR_DIR, stdio: 'ignore' },
)

async function waitForServer(timeoutMs = 40000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      if ((await fetch(`http://127.0.0.1:${DEV_PORT}/`)).ok) return true
    } catch {
      /* 还没起来 */
    }
    await sleep(300)
  }
  return false
}

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

function connectCdp(wsUrl) {
  const ws = new WebSocket(wsUrl)
  let seq = 0
  const pending = new Map()
  const ready = new Promise((resolve, reject) => {
    ws.onopen = () => resolve()
    ws.onerror = () => reject(new Error('WebSocket 连接失败'))
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
  return { ready, send, close: () => ws.close() }
}

async function pageTarget() {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 25000) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()
      const target = list.find((t) => t.type === 'page' && t.url.includes(`:${DEV_PORT}`))
      if (target?.webSocketDebuggerUrl) return target
    } catch {
      /* 还没起来 */
    }
    await sleep(300)
  }
  throw new Error('没找到页面')
}

async function cleanup() {
  try {
    dev.kill()
  } catch {
    /* 忽略 */
  }
  try {
    chrome.kill()
  } catch {
    /* 忽略 */
  }
}

console.log('\n[m2-manual] 创作端手工验收\n')
console.log(`  临时 profile：${USER_DATA}\n`)

let session
try {
  if (!(await waitForServer())) throw new Error('dev server 启动失败')
  const target = await pageTarget()
  session = connectCdp(target.webSocketDebuggerUrl)
  await session.ready
  await session.send('Runtime.enable')
  await session.send('Page.enable')

  const evaluate = async (expression) => {
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

  const waitFor = async (expression, label, timeoutMs = 20000) => {
    const startedAt = Date.now()
    let lastErr = null
    while (Date.now() - startedAt < timeoutMs) {
      try {
        if (await evaluate(expression)) return true
      } catch (err) {
        lastErr = err
      }
      await sleep(150)
    }
    throw new Error(`等待超时：${label}` + (lastErr ? `（${lastErr.message}）` : ''))
  }

  const BOOTSTRAP = `
  (async () => {
    const { useProjectsStore } = await import('/src/stores/projects.js');
    const { useProjectStore } = await import('/src/stores/project.js');
    const { useUiStore } = await import('/src/stores/ui.js');
    const { APPS } = await import(${JSON.stringify(SHARED_APPS_URL)});
    window.__projects = useProjectsStore();
    window.__editor = useProjectStore();
    window.__ui = useUiStore();
    window.__APPS = APPS;
    window.__pageErrors = [];
    window.addEventListener('error', (e) => window.__pageErrors.push(String(e.message)));
    window.addEventListener('unhandledrejection', (e) => window.__pageErrors.push(String(e.reason)));
    // 让下一次 put 抛真实的 QuotaExceededError，只失败一次
    window.__injectQuotaFailure = () => {
      const orig = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) {
        IDBObjectStore.prototype.put = orig;
        throw new DOMException('模拟配额耗尽', 'QuotaExceededError');
      };
      return 'armed';
    };
    return 'ok';
  })()
  `

  await waitFor(`document.readyState === 'complete' && Boolean(document.querySelector('h1'))`, '首屏')
  // 上面那条可能在 Chrome 的错误页上也成立（错误页同样有 h1），
  // 所以必须显式导航到目标地址并确认 document.origin 真的是 dev server。
  await session.send('Page.navigate', { url: `http://127.0.0.1:${DEV_PORT}/` })
  await waitFor(
    `location.protocol === 'http:' && location.port === '${DEV_PORT}' && Boolean(document.querySelector('#app'))`,
    '页面真正加载（不是 chrome-error）',
  )
  if ((await evaluate(BOOTSTRAP)) !== 'ok') throw new Error('注入失败')

  // 从干净库开始
  await evaluate(`(async () => {
    const conn = await import('/src/db/connection.js');
    try { await conn.deleteDatabase(); } catch {}
    return 'ok';
  })()`)
  await evaluate(`window.__stamp = 1, true`)
  await session.send('Page.reload', { ignoreCache: true })
  await waitFor(
    `typeof window.__stamp === 'undefined' && document.readyState === 'complete' && Boolean(document.querySelector('h1'))`,
    '重载',
  )
  if ((await evaluate(BOOTSTRAP)) !== 'ok') throw new Error('重载后注入失败')

  const prj = await evaluate(`(async () => {
    const p = await window.__projects.create({ name: ' 手工项' });
    await window.__editor.open(p.id);
    await window.__editor.patch({ workSettings: { phoneName: '抽屉测试机' } });
    await window.__editor.flush();
    location.hash = '#/p/' + p.id + '/overview';
    return { id: p.id };
  })()`)
  await waitFor(`Boolean(document.querySelector('[data-testid="workspace-nav"]'))`, '工作区')
  console.log(`  · 项目 ${prj.id}\n`)

  // ── ① 窄屏抽屉 ──
  await session.send('Emulation.setDeviceMetricsOverride', {
    width: 1000,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await sleep(300)
  const narrow = await evaluate(`({
    navHidden: !document.querySelector('[data-testid="workspace-nav"]'),
    hasToggle: Boolean(document.querySelector('[data-testid="nav-toggle"]')),
    drawerClosed: !document.querySelector('[data-testid="nav-drawer"][open]'),
  })`)
  record(
    '窄屏（1000px）收起侧栏、出现 ☰',
    narrow.navHidden && narrow.hasToggle && narrow.drawerClosed,
    JSON.stringify(narrow),
  )

  await evaluate(`document.querySelector('[data-testid="nav-toggle"]').click()`)
  await waitFor(`Boolean(document.querySelector('[data-testid="nav-drawer"][open]'))`, '抽屉展开')
  record('点 ☰ 打开抽屉', true)

  await evaluate(`document.querySelector('[data-testid="nav-drawer"] .nav-item').click()`)
  await sleep(400)
  const afterNav = await evaluate(`({
    hash: location.hash,
    drawerClosed: !document.querySelector('[data-testid="nav-drawer"][open]'),
  })`)
  record(
    '抽屉内导航生效且自动关闭',
    // 点的是"项目概览"，本来就是当前页 —— 路由不变也必须收起抽屉，
    // 否则窄屏下抽屉会一直盖住内容。所以这里只断言"抽屉关了 + 仍在项目内"。
    afterNav.drawerClosed && /#\/p\/.+/.test(afterNav.hash),
    afterNav.hash,
  )

  await session.send('Emulation.clearDeviceMetricsOverride')
  await sleep(250)

  // ── ② 保存失败 → ③ 文案 → ② 重试 ──
  await evaluate(`(() => { location.hash = '#/p/${prj.id}/settings'; return true })()`)
  await waitFor(`Boolean(document.querySelector('[data-testid="phone-name"]'))`, '设置页')

  await evaluate(`window.__injectQuotaFailure()`)
  await evaluate(`(async () => {
    window.__editor.patch({ workSettings: { phoneName: '配额失败时输入的名字' } });
    try { await window.__editor.flush(); } catch { /* 预期失败 */ }
    return true;
  })()`)
  await waitFor(
    `document.querySelector('[data-testid="save-status"]')?.dataset.tone === 'error'`,
    '保存状态转为未保存',
  )
  record('配额失败后状态栏转「未保存」', true)

  const failText = await evaluate(`({
    label: document.querySelector('[data-testid="save-status"] .save-status__label')?.textContent?.trim(),
    detail: document.querySelector('[data-testid="save-status"]')?.getAttribute('title') ?? '',
    hasRetry: Boolean(document.querySelector('[data-testid="save-retry"]')),
  })`)
  record('状态栏提供「重试」按钮', failText.hasRetry === true)
  const rawError = /DOMException|QuotaExceededError|UnknownError|\[object Object\]/i.test(failText.detail)
  record(
    '失败文案是中文说明，不是裸异常名',
    failText.detail.length > 0 && !rawError && /[\u4e00-\u9fa5]/.test(failText.detail),
    `label=${failText.label} title=${failText.detail}`,
  )

  await evaluate(`document.querySelector('[data-testid="save-retry"]').click()`)
  await waitFor(
    `document.querySelector('[data-testid="save-status"]')?.dataset.tone === 'ok'`,
    '重试后回到已保存',
  )
  record('点「重试」后保存成功', true)

  // 重试的内容必须真的落盘
  const persisted = await evaluate(`(async () => {
    const repo = await import('/src/db/repository.js');
    const p = await repo.getProject(${JSON.stringify(prj.id)});
    return p?.workSettings?.phoneName ?? null;
  })()`)
  record('重试后磁盘上是失败时敲的内容', persisted === '配额失败时输入的名字', `磁盘=${persisted}`)

  // ── ④ 全部应用页（数量从注册表取，不写死） ──
  const appIds = await evaluate(`window.__APPS.map((a) => a.id)`)
  const appNames = await evaluate(`window.__APPS.map((a) => a.name)`)
  let appOk = 0
  const appFails = []
  for (let i = 0; i < appIds.length; i += 1) {
    const id = appIds[i]
    const name = appNames[i]
    await evaluate(`(() => { location.hash = '#/p/${prj.id}/apps/${id}'; return true })()`)
    try {
      await waitFor(`document.body.innerText.includes(${JSON.stringify(name)})`, `应用页 ${name}`, 8000)
      const errs = await evaluate(`window.__pageErrors.length`)
      if (errs > 0) appFails.push(`${name}: 页面错误 ${errs} 条`)
      else appOk += 1
    } catch {
      appFails.push(`${name}: 页面没渲染出应用名`)
    }
  }
  record(
    `全部应用页逐页打开（${appOk}/${appIds.length}）`,
    appOk === appIds.length,
    appFails.join(' / '),
  )

  const pageErrors = await evaluate(`window.__pageErrors`)
  record('全程无未捕获错误', pageErrors.length === 0, pageErrors.join(' | '))
} catch (err) {
  console.error('\n[m2-manual] 中断：' + err.message)
  record('探针执行完成', false, err.message)
} finally {
  try {
    session?.close()
  } catch {
    /* 忽略 */
  }
  await cleanup()
}

const passed = results.filter((r) => r.ok).length
console.log(`\n[m2-manual] ${passed}/${results.length} 通过`)
if (passed !== results.length) {
  console.log('\n  失败项：')
  for (const r of results.filter((x) => !x.ok)) console.log(`    · ${r.step}  ${r.detail}`)
}
console.log(`\n  临时 profile 未删除：${USER_DATA}\n`)

process.exit(passed === results.length ? 0 : 1)
