

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const TARGET = 'file:///F:/Project/simulator/apps/player/dist/preview.html'
const PORT = 9333
if (!fs.existsSync(CHROME)) {
  console.error('[file-open] 未找到 Chrome：' + CHROME)
  process.exit(2)
}
if (!fs.existsSync('F:/Project/simulator/apps/player/dist/preview.html')) {
  console.error('[file-open] 缺少 dist/preview.html，请先 pnpm build:player')
  process.exit(2)
}

const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-sim-file-open-'))
process.on('exit', () => {
  try {
    fs.rmSync(USER_DATA, { recursive: true, force: true })
  } catch {
    /* Chrome 仍占用时保留，避免触碰其他 profile */
  }
})
const args = [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + USER_DATA,
  '--allow-file-access-from-files',
  '--window-size=1280,900',
  TARGET,
]

const child = spawn(CHROME, args, { stdio: 'ignore', detached: false })
const startedAt = Date.now()

async function waitForDevtools(timeoutMs = 20000) {
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      if (res.ok) {
        const list = await res.json()
        const page = list.find((t) => t.type === 'page' && t.url.includes('preview.html'))
        if (page) return page
      }
    } catch {
      // 还没起来
    }
    await new Promise((r) => setTimeout(r, 400))
  }
  return null
}

// 从头监听控制台：在导航前启用 Runtime 与 Log，这样加载期错误不会漏掉
function cdpSession(wsUrl) {
  const ws = new WebSocket(wsUrl)
  const listeners = new Map()
  const consoleMessages = []
  let seq = 0
  const pending = new Map()

  const ready = new Promise((resolve, reject) => {
    ws.onopen = () => resolve()
    ws.onerror = () => reject(new Error('WebSocket 错误'))
  })

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject: rej } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) rej(new Error(JSON.stringify(msg.error)))
      else resolve(msg.result)
      return
    }
    if (msg.method === 'Runtime.consoleAPICalled') {
      const text = (msg.params.args || [])
        .map((a) => a.value ?? a.description ?? a.type)
        .join(' ')
      consoleMessages.push({ type: msg.params.type, text })
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails
      consoleMessages.push({
        type: 'exception',
        text: d.exception?.description || d.text || 'unknown exception',
      })
    }
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      consoleMessages.push({ type: 'log-error', text: msg.params.entry.text })
    }
    const cbs = listeners.get(msg.method)
    if (cbs) cbs.forEach((fn) => fn(msg.params))
  }

  function send(method, params = {}) {
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
      }, 20000)
    })
  }

  return {
    ready,
    send,
    consoleMessages,
    close: () => {
      try {
        ws.close()
      } catch {
        // 连接可能已被对端关闭，忽略
      }
    },
  }
}

const pageHost = await waitForDevtools()
if (!pageHost) {
  console.error('[file-open] 无法连接 Chrome DevTools')
  child.kill()
  process.exit(1)
}

const session = cdpSession(pageHost.webSocketDebuggerUrl)
await session.ready

// 先启用监听，再重新加载，确保加载期错误也能收到
await session.send('Runtime.enable')
await session.send('Log.enable')
await session.send('Page.enable')
await session.send('Page.reload', { ignoreCache: true })
await new Promise((r) => setTimeout(r, 2500))

const probe = `
(() => {
  const shell = document.querySelector('[data-testid="phone-shell"]');
  const clock = document.querySelector('.stage-placeholder__clock');
  const hint = document.querySelector('.stage-placeholder__hint');
  const rect = shell ? shell.getBoundingClientRect() : null;
  return {
    url: location.href,
    protocol: location.protocol,
    shellFound: !!shell,
    shellMode: shell ? shell.getAttribute('data-mode') : null,
    shellSize: rect ? { w: Math.round(rect.width), h: Math.round(rect.height) } : null,
    clockText: clock ? clock.textContent.trim() : null,
    hintText: hint ? hint.textContent.trim() : null,
    sceneCount: document.querySelectorAll('.stage-placeholder').length,
    bodyHtmlHead: document.body.innerHTML.slice(0, 400),
    globalApi: typeof window.__PHONE_SIM__,
  };
})()
`

let result
try {
  const res = await session.send('Runtime.evaluate', {
    expression: probe,
    returnByValue: true,
  })
  result = res.result?.value
} catch (err) {
  console.error('[file-open] 探测失败：' + err.message)
  session.close()
  child.kill()
  process.exit(1)
}

result.errors = session.consoleMessages
console.log(JSON.stringify(result, null, 2))

const ok =
  result &&
  result.protocol === 'file:' &&
  result.shellFound === true &&
  result.sceneCount >= 1 &&
  result.clockText &&
  result.errors.length === 0

// 追加：移动端视口下应切换为 fill 铺满且隐藏刘海
await session.send('Emulation.setDeviceMetricsOverride', {
  width: 390,
  height: 844,
  deviceScaleFactor: 3,
  mobile: true,
})
await session.send('Emulation.setTouchEmulationEnabled', { enabled: true })
await new Promise((r) => setTimeout(r, 600))

const mobileRes = await session.send('Runtime.evaluate', {
  expression: `
  (() => {
    const shell = document.querySelector('[data-testid="phone-shell"]');
    const notch = document.querySelector('.pui-shell__notch');
    const device = document.querySelector('.pui-shell__device');
    const notchStyle = notch ? getComputedStyle(notch) : null;
    const deviceRect = device ? device.getBoundingClientRect() : null;
    return {
      viewport: [window.innerWidth, window.innerHeight],
      shellMode: shell ? shell.getAttribute('data-mode') : null,
      notchDisplay: notchStyle ? notchStyle.display : null,
      deviceSize: deviceRect ? [Math.round(deviceRect.width), Math.round(deviceRect.height)] : null,
      coarsePointer: window.matchMedia('(pointer: coarse)').matches,
    };
  })()
  `,
  returnByValue: true,
})
const mobile = mobileRes.result?.value
console.log('\n[mobile]', JSON.stringify(mobile, null, 2))

const mobileOk =
  mobile &&
  mobile.shellMode === 'fill' &&
  mobile.notchDisplay === 'none' &&
  mobile.deviceSize &&
  Math.abs(mobile.deviceSize[0] - 390) <= 1 &&
  Math.abs(mobile.deviceSize[1] - 844) <= 1

await session.send('Emulation.setDeviceMetricsOverride', {
  width: 1280,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
})
await session.send('Emulation.setTouchEmulationEnabled', { enabled: false })
await new Promise((r) => setTimeout(r, 500))

const shot = await session.send('Page.captureScreenshot', { format: 'png' })
if (shot?.data) {
  fs.mkdirSync('docs/milestones/shots', { recursive: true })
  fs.writeFileSync('docs/milestones/shots/m0-desktop.png', Buffer.from(shot.data, 'base64'))
  console.log('[shot] 已保存 docs/milestones/shots/m0-desktop.png')
}

session.close()
child.kill()

try {
  fs.rmSync(USER_DATA, { recursive: true, force: true })
} catch {
  // 临时 profile 可能仍被 Chrome 占用，留给系统清理即可
}

if (!ok) {
  console.error('\n[file-open] 未通过（桌面 file:// 渲染）')
  process.exit(1)
}
if (!mobileOk) {
  console.error('\n[file-open] 未通过（移动端铺满模式）')
  process.exit(1)
}
console.log('\n[file-open] 通过：桌面 file:// 正常渲染；移动端自动铺满并隐藏假刘海。')
process.exit(0)
