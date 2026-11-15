

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const TARGET = 'file:///F:/Project/simulator/apps/player/dist/preview.html'
const PORT = 9335
const OUT = 'docs/milestones/shots'

const SIZES = [
  { name: 'desktop-1280x900', w: 1280, h: 900 },
  { name: 'laptop-1180x800', w: 1180, h: 800 },
]

if (!fs.existsSync(CHROME)) {
  console.error('[shot] 未找到 Chrome')
  process.exit(2)
}

const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-sim-shell-shot-'))
process.on('exit', () => {
  try {
    fs.rmSync(USER_DATA, { recursive: true, force: true })
  } catch {
    /* Chrome 仍占用时保留，避免触碰其他 profile */
  }
})

const child = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + USER_DATA,
    '--allow-file-access-from-files',
    '--window-size=1280,900',
    TARGET,
  ],
  { stdio: 'ignore' },
)

const startedAt = Date.now()
async function waitForPage(timeoutMs = 20000) {
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      if (res.ok) {
        const list = await res.json()
        const page = list.find((t) => t.type === 'page' && t.url.includes('preview.html'))
        if (page) return page
      }
    } catch {
      /* 等 */
    }
    await new Promise((r) => setTimeout(r, 400))
  }
  return null
}

function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl)
  let seq = 0
  const pending = new Map()
  const ready = new Promise((resolve, reject) => {
    ws.onopen = () => resolve()
    ws.onerror = () => reject(new Error('ws error'))
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
  function send(method, params = {}) {
    seq += 1
    const id = seq
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id)
          reject(new Error(method + ' timeout'))
        }
      }, 20000)
    })
  }
  return { ready, send, close: () => ws.close() }
}

const page = await waitForPage()
if (!page) {
  child.kill()
  process.exit(1)
}

const s = cdp(page.webSocketDebuggerUrl)
await s.ready
await s.send('Runtime.enable')
fs.mkdirSync(OUT, { recursive: true })

for (const size of SIZES) {
  await s.send('Emulation.setDeviceMetricsOverride', {
    width: size.w,
    height: size.h,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await new Promise((r) => setTimeout(r, 700))
  const shot = await s.send('Page.captureScreenshot', { format: 'png' })
  const file = path.join(OUT, `shell-${size.name}.png`)
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'))
  console.log('[shot] ' + file)
}

s.close()
child.kill()
try {
  fs.rmSync(USER_DATA, { recursive: true, force: true })
} catch {
  /* 可能仍被占用 */
}
process.exit(0)
