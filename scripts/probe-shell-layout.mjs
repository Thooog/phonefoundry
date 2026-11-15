

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const TARGET = 'file:///F:/Project/simulator/apps/player/dist/preview.html'
const PORT = 9334

const SIZES = [
  { name: '1280x900 典型桌面', w: 1280, h: 900 },
  { name: '1440x1080 大屏', w: 1440, h: 1080 },
  { name: '800x1000 窄高窗', w: 800, h: 1000 },
  { name: '700x760 贴边界的桌面', w: 700, h: 760 },
]

if (!fs.existsSync(CHROME)) {
  console.error('[probe] 未找到 Chrome：' + CHROME)
  process.exit(2)
}

const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-sim-shell-probe-'))
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
      /* 还没起来 */
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

  return { ready, send, close: () => ws.close() }
}

const page = await waitForPage()
if (!page) {
  console.error('[probe] 无法连接 DevTools')
  child.kill()
  process.exit(1)
}

const s = cdp(page.webSocketDebuggerUrl)
await s.ready
await s.send('Runtime.enable')

const PROBE = `
(() => {
  const shell  = document.querySelector('[data-testid="phone-shell"]');
  const stage  = document.querySelector('.pui-shell__stage');
  const device = document.querySelector('.pui-shell__device');
  const screen = document.querySelector('.pui-shell__screen');
  if (!shell || !device) return { error: 'shell not found' };

  const r  = (el) => { const b = el.getBoundingClientRect(); return { w: +b.width.toFixed(1), h: +b.height.toFixed(1), x: +b.left.toFixed(1), y: +b.top.toFixed(1), cx: +(b.left + b.width / 2).toFixed(1), cy: +(b.top + b.height / 2).toFixed(1) }; };
  const cs = getComputedStyle(shell);

  return {
    viewport: [window.innerWidth, window.innerHeight],
    mode: shell.getAttribute('data-mode'),
    shell:  r(shell),
    stage:  stage ? r(stage) : null,
    device: r(device),
    screen: screen ? r(screen) : null,
    scaleVar: cs.getPropertyValue('--pui-shell-scale').trim(),
    // 设备中心与视口中心的偏移（正数=偏右下）
    offsetX: +(r(device).cx - window.innerWidth / 2).toFixed(1),
    offsetY: +(r(device).cy - window.innerHeight / 2).toFixed(1),
    // 左右上下留白
    gutterLeft: r(device).x,
    gutterRight: +(window.innerWidth - (r(device).x + r(device).w)).toFixed(1),
    gutterTop: r(device).y,
    gutterBottom: +(window.innerHeight - (r(device).y + r(device).h)).toFixed(1),
    // 机身占视口宽度比例
    widthRatio: +((r(device).w / window.innerWidth) * 100).toFixed(1),
  };
})()
`

const rows = []
for (const size of SIZES) {
  await s.send('Emulation.setDeviceMetricsOverride', {
    width: size.w,
    height: size.h,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await new Promise((r) => setTimeout(r, 500))
  const res = await s.send('Runtime.evaluate', { expression: PROBE, returnByValue: true })
  rows.push({ size: size.name, ...res.result.value })
}

s.close()
child.kill()

try {
  fs.rmSync(USER_DATA, { recursive: true, force: true })
} catch {
  /* Chrome 可能仍占用 */
}

console.log('[probe] 外壳几何测量\n')
for (const row of rows) {
  console.log(`── ${row.size}  (视口 ${row.viewport[0]}x${row.viewport[1]}, mode=${row.mode}, scale=${row.scaleVar})`)
  console.log(`   设备  ${row.device.w} x ${row.device.h}   占视口宽 ${row.widthRatio}%`)
  console.log(`   留白  左 ${row.gutterLeft}  右 ${row.gutterRight}  上 ${row.gutterTop}  下 ${row.gutterBottom}`)
  console.log(`   偏移  中心相对视口中心  dx=${row.offsetX}  dy=${row.offsetY}`)
  console.log('')
}

const anyOffCenter = rows.some((r) => Math.abs(r.offsetX) > 1 || Math.abs(r.offsetY) > 1)
console.log(anyOffCenter ? '[probe] 结论：存在非居中偏移' : '[probe] 结论：所有尺寸下设备均居中')
process.exit(anyOffCenter ? 1 : 0)
