/**
 * KakaoTalk 语音 /「转」按钮截图：截整屏 + 按钮特写（关闭态）+ 展开态特写。
 * 用法：node scripts/shot-kt-voice.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, URL } from 'node:url'

import { createSampleProject, toWorkData } from '../packages/shared/src/index.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const DIST = path.join(ROOT, 'apps/player', 'dist')
const OUT = path.join(ROOT, 'docs/milestones/shots')
const WORK_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-sim-shot-'))
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-sim-chrome-'))
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const CDP_PORT = 9399

for (const file of ['renderer.js', 'renderer.css']) {
  fs.copyFileSync(path.join(DIST, file), path.join(WORK_DIR, file))
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const project = createSampleProject()
const [owner, other] = project.characters
const now = Date.now()
const stamp = (min) => new Date(now - min * 60000).toISOString()

const conversation = {
  id: 'conv_shot_voice',
  title: '',
  participantIds: [owner.id, other.id],
  pinned: false,
  avatarAssetId: null,
  sortKey: stamp(1),
}

const base = {
  conversationId: conversation.id,
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
  mk('v1', other.id, 12, { content: '你到家了吗' }),
  mk('v2', other.id, 11, {
    contentType: 'voice',
    durationSec: 3,
    transcript: '你怎么回事啊？',
  }),
  mk('v3', owner.id, 10, { contentType: 'voice', durationSec: 6, transcript: '我马上到' }),
  mk('v4', other.id, 9, { content: '好，我先去楼下等你' }),
]

project.appData = {
  ...project.appData,
  kakaotalk: { conversations: [conversation], messages },
}
const work = toWorkData(project)

const html = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>kakaotalk voice</title>
<link rel="stylesheet" href="./renderer.css">
<style>html,body{margin:0;height:100%;background:#1c1c22}#phone-root{width:100%;height:100%}</style>
</head>
<body>
<div id="phone-root"></div>
<script>window.__PHONE_WORK__ = ${JSON.stringify({ mode: 'inline', work, assets: {} })};</script>
<script src="./renderer.js"></script>
</body>
</html>`

const pageFile = path.join(WORK_DIR, 'shot-kt-voice.html')
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

async function waitFor(session, expression, label, timeoutMs = 8000) {
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

function clipOf(rect, pad = 26) {
  const x = Math.max(0, Math.round(rect.x - pad))
  const y = Math.max(0, Math.round(rect.y - pad))
  return { x, y, width: Math.round(rect.width + pad * 2), height: Math.round(rect.height + pad * 2) }
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
  await session.send('Page.navigate', { url: pageUrl })
  await sleep(2200)

  // 锁屏提示可能还没渲染出来：先等它出现，再点；已有桌面就直接进
  await waitFor(
    session,
    `Boolean(document.querySelector('[data-testid="lock-hint"]') || document.querySelector('[data-testid="home-screen"]'))`,
    '锁屏或桌面',
    10000,
  )
  const hinted = await evalJs(session, `Boolean(document.querySelector('[data-testid="lock-hint"]'))`)
  if (hinted) await evalJs(session, `document.querySelector('[data-testid="lock-hint"]').click()`)
  await waitFor(session, `Boolean(document.querySelector('[data-testid="home-screen"]'))`, '桌面')
  await evalJs(session, `document.querySelector('[data-testid="home-dock-kakaotalk"]').click()`)
  await waitFor(session, `Boolean(document.querySelector('[data-testid="kt-list-screen"]'))`, '列表')
  // 默认停在 Friends tab，会话条目在 Chats tab 里
  await evalJs(session, `document.querySelector('[data-testid="kt-tab-chats"]').click()`)
  await waitFor(
    session,
    `Boolean(document.querySelector('[data-testid="kt-conversation-item"]'))`,
    '会话条目',
  )
  await evalJs(session, `document.querySelector('[data-testid="kt-conversation-item"]').click()`)
  await waitFor(
    session,
    `Boolean(document.querySelector('[data-testid="kt-voice-transcript-toggle"]'))`,
    '聊天页',
  )
  await sleep(500)
  await shot(session, 'm8-kt-ink-1-page.png')

  // 我的那条（左侧按钮）裁一张特写
  const ownRect = await evalJs(
    session,
    `(() => {
      const btns = [...document.querySelectorAll('[data-testid="kt-voice-transcript-toggle"]')]
      const r = btns[0].getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height }
    })()`,
  )
  await shot(session, 'm8-kt-ink-2-btn.png', clipOf(ownRect), 4)

  // 点开转写，看展开态的同色表现
  await evalJs(
    session,
    `document.querySelectorAll('[data-testid="kt-voice-transcript-toggle"]')[0].click()`,
  )
  await sleep(400)
  const openRect = await evalJs(
    session,
    `(() => {
      const btn = document.querySelectorAll('[data-testid="kt-voice-transcript-toggle"]')[0]
      const bubble = btn.closest('.pui-kt__bubble-line').querySelector('[data-testid="kt-bubble"]')
      const a = btn.getBoundingClientRect()
      const b = bubble.getBoundingClientRect()
      const top = Math.min(a.y, b.y)
      const left = Math.min(a.x, b.x)
      return {
        x: left, y: top,
        width: Math.max(a.right, b.right) - left,
        height: Math.max(a.bottom, b.bottom) - top,
      }
    })()`,
  )
  await shot(session, 'm8-kt-ink-3-open.png', clipOf(openRect, 18), 3)
} finally {
  chrome.kill('SIGKILL')
}
