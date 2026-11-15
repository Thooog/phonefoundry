

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, URL } from 'node:url'

import { createSampleProject, toWorkData } from '../packages/shared/src/index.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const DIST = path.join(ROOT, 'apps/player/dist')
const OUT = path.join(ROOT, 'docs/milestones/shots')
const WORK_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-sim-shot-'))
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-sim-chrome-'))
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const CDP_PORT = 9403

for (const file of ['renderer.js', 'renderer.css']) {
  fs.copyFileSync(path.join(DIST, file), path.join(WORK_DIR, file))
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 3:4 竖图 + 4:3 横图：两种比例都出现，才看得出"按原比例"和"圆角在图身上"
const svg = (w, h, fill) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="${fill}"/></svg>`,
  )}`
const TALL = svg(600, 800, '#c76')
const WIDE = svg(800, 600, '#6a9')

const project = createSampleProject()
const [owner, other] = project.characters
const now = Date.now()
const stamp = (min) => new Date(now - min * 60000).toISOString()

const conv = {
  id: 'conv_media_align',
  title: '',
  participantIds: [owner.id, other.id],
  pinned: false,
  avatarAssetId: null,
  sortKey: stamp(1),
}
const base = {
  conversationId: conv.id,
  senderAccountId: null,
  senderName: null,
  content: '',
  mediaAssetIds: [],
  readAt: null,
}
const mk = (id, sender, min, extra) => ({
  ...base,
  id,
  senderCharacterId: sender,
  contentType: 'text',
  content: '',
  displayTime: stamp(min),
  createdAt: stamp(min),
  updatedAt: stamp(min),
  ...extra,
})

const messages = [
  mk('d1', other.id, 14, { content: '给你看个东西' }),
  mk('d2', other.id, 13, { contentType: 'image', mediaAssetIds: [TALL] }),
  mk('d3', other.id, 12, { contentType: 'image', mediaAssetIds: [TALL, WIDE, TALL, WIDE] }),
  mk('d4', owner.id, 11, { contentType: 'image', mediaAssetIds: [TALL] }),
  mk('d5', owner.id, 10, { content: '好看吗' }),
  mk('d6', other.id, 9, { content: '好看' }),
]

project.appData = {
  ...project.appData,
  kakaotalk: { conversations: [conv], messages },
  messages: { conversations: [conv], messages },
}
const work = toWorkData(project)

const html = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>media align</title>
<link rel="stylesheet" href="./renderer.css">
<style>html,body{margin:0;height:100%;background:#1c1c22}#phone-root{width:100%;height:100%}</style>
</head>
<body>
<div id="phone-root"></div>
<script>window.__PHONE_WORK__ = ${JSON.stringify({ mode: 'inline', work, assets: {} })};</script>
<script src="./renderer.js"></script>
</body>
</html>`

const pageFile = path.join(WORK_DIR, 'media-align.html')
fs.writeFileSync(pageFile, html, 'utf8')
const pageUrl = 'file:///' + pageFile.split(path.sep).join('/')

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

async function findTarget(timeoutMs = 20000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()
      const target = list.find((t) => t.type === 'page')
      if (target?.webSocketDebuggerUrl) return target
    } catch {
      /* chrome 还没起好 */
    }
    await sleep(300)
  }
  throw new Error('没能连上 Chrome')
}

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
    '--disable-backgrounding-occluded-windows',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${USER_DATA}`,
    '--window-size=420,880',
    'about:blank',
  ],
  { stdio: 'ignore' },
)

async function evalJs(session, expression) {
  const res = await session.send('Runtime.evaluate', { expression, returnByValue: true })
  if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails))
  return res.result?.value
}

async function waitFor(session, expression, label, timeoutMs = 10000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (await evalJs(session, expression)) return
    await sleep(150)
  }
  throw new Error(`等待超时: ${label}`)
}

async function shot(session, name, clip, scale = 1) {
  const params = { format: 'png', captureBeyondViewport: false }
  if (clip) params.clip = { ...clip, scale }
  const data = await session.send('Page.captureScreenshot', params)
  const out = path.join(OUT, name)
  fs.writeFileSync(out, Buffer.from(data.data, 'base64'))
  console.log('saved', out)
}

try {
  const target = await findTarget()
  const session = connectCdp(target.webSocketDebuggerUrl)
  await session.ready
  await session.send('Runtime.enable')
  await session.send('Page.enable')
  await session.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  })

  const gotoApp = async (app) => {
    await session.send('Page.navigate', { url: pageUrl })
    await sleep(1800)
    await waitFor(
      session,
      `Boolean(document.querySelector('[data-testid="lock-hint"]') || document.querySelector('[data-testid="home-screen"]'))`,
      '锁屏或桌面',
    )
    if (await evalJs(session, `Boolean(document.querySelector('[data-testid="lock-hint"]'))`)) {
      await evalJs(session, `document.querySelector('[data-testid="lock-hint"]').click()`)
    }
    await waitFor(session, `Boolean(document.querySelector('[data-testid="home-screen"]'))`, '桌面')
    await evalJs(session, `document.querySelector('[data-testid="home-dock-${app}"]').click()`)
    if (app === 'kakaotalk') {
      await waitFor(session, `Boolean(document.querySelector('[data-testid="kt-list-screen"]'))`, 'kt 列表')
      await evalJs(session, `document.querySelector('[data-testid="kt-tab-chats"]').click()`)
      await waitFor(
        session,
        `Boolean(document.querySelector('[data-testid="kt-conversation-item"]'))`,
        'kt 会话',
      )
      await evalJs(session, `document.querySelector('[data-testid="kt-conversation-item"]').click()`)
      await waitFor(session, `Boolean(document.querySelector('[data-testid="kt-thread-screen"]'))`, 'kt 聊天')
    } else {
      await waitFor(session, `Boolean(document.querySelector('[data-testid="msg-list-screen"]'))`, 'msg 列表')
      await evalJs(session, `document.querySelector('[data-testid="msg-conversation-item"]').click()`)
      await waitFor(session, `Boolean(document.querySelector('[data-testid="msg-thread-screen"]'))`, 'msg 聊天')
    }
    await sleep(600)
  }

  // ── 信息：图片圆角 + 我方不垫蓝底 ──
  await gotoApp('messages')
  await shot(session, 'm8-media-1-imessage.png')
  const msgCorner = await evalJs(
    session,
    `(() => {
      const row = [...document.querySelectorAll('.pui-msg__row')].find(
        (r) => r.dataset.side === 'right' && r.querySelector('.pui-msg__image'),
      )
      const r = row.querySelector('.pui-msg__image').getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height }
    })()`,
  )
  // 只截右上角那一小块：圆弧外面应该是页面白底
  await shot(
    session,
    'm8-media-3-corner.png',
    { x: Math.round(msgCorner.x + msgCorner.width - 34), y: Math.max(0, Math.round(msgCorner.y - 4)), width: 40, height: 40 },
    8,
  )

  // ── KakaoTalk：我方图片贴右 ──
  await gotoApp('kakaotalk')
  await shot(session, 'm8-media-2-kakao.png')
  const ktRight = await evalJs(
    session,
    `(() => {
      const row = [...document.querySelectorAll('.pui-kt__row')].find(
        (r) => r.dataset.side === 'right' && r.querySelector('.pui-kt__images'),
      )
      const img = row.querySelector('.pui-kt__image').getBoundingClientRect()
      const bubble = [...document.querySelectorAll('[data-side="right"] [data-testid="kt-bubble"]')]
        .map((b) => b.getBoundingClientRect())
        .filter((b) => b.top > img.bottom)
        .sort((a, b) => a.top - b.top)[0]
      const r = img
      return { x: r.x, y: r.y, width: r.width, height: r.height, bubble: bubble ? { right: bubble.right } : null }
    })()`,
  )
  // 我方图片右边 + 下方黄气泡的右缘：两者要落在同一条竖线上
  await shot(
    session,
    'm8-media-4-align.png',
    {
      x: Math.max(0, Math.round(ktRight.x + ktRight.width - 60)),
      y: Math.round(ktRight.y + ktRight.height - 40),
      width: 90,
      height: 120,
    },
    4,
  )
} finally {
  chrome.kill('SIGKILL')
}
