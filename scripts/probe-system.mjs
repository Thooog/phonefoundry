

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, URL } from 'node:url'

import { createSampleProject, formatClock, toWorkData } from '../packages/shared/src/index.js'

const UI_FIXES = process.argv.includes('--ui-fixes')
const SAMPLE_ONLY = process.argv.includes('--sample') || UI_FIXES

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const DIST = path.join(ROOT, 'apps/player', 'dist')
const SRC_DIRS = [path.join(ROOT, 'packages/player-ui/src'), path.join(ROOT, 'apps/player/src')]
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const CDP_PORT = 9351

const SIZE_BUDGET = 520 * 1024

const results = []
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function record(step, ok, detail = '') {
  results.push({ step, ok, detail })
  console.log(`  ${ok ? '✓' : '✗'} ${step}${detail ? `  ${detail}` : ''}`)
}

if (!fs.existsSync(CHROME)) {
  console.error(`[system] 未找到 Chrome：${CHROME}`)
  process.exit(2)
}
if (!fs.existsSync(path.join(DIST, 'renderer.js'))) {
  console.error('[system] 缺少构建产物，请先运行 pnpm build:player')
  process.exit(2)
}

checkNoEdgeListeners()
if (!SAMPLE_ONLY) checkBundle()

// ── 场景准备 ──
const WORK_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-sim-system-'))
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-sim-chrome-'))

for (const file of ['renderer.js', 'renderer.css']) {
  fs.copyFileSync(path.join(DIST, file), path.join(WORK_DIR, file))
}

function buildWork(overrides = {}) {
  const project = createSampleProject()
  if (overrides.workSettings) {
    project.workSettings = { ...project.workSettings, ...overrides.workSettings }
  }
  if (overrides.characters) project.characters = overrides.characters
  return toWorkData(project)
}

/**
 * 会话多到超出一屏的数据。
 *
 * 滚动位置还原只能用"真的能滚"的列表来验 —— 示例项目只有一条会话，
 * 拿它测出来的是"两边都是 0，通过"，等于没测。
 * 这里把示例会话复制 24 份，id 与 sortKey 各不相同，顺序才是确定的。
 */
function buildLongWork(count = 24) {
  const project = createSampleProject()
  const kt = project.appData.kakaotalk
  const proto = kt.conversations[0]
  const protoMessages = kt.messages
  const conversations = []
  const messages = []

  for (let i = 0; i < count; i += 1) {
    const id = `conv_long_${String(i).padStart(2, '0')}`
    conversations.push({
      ...proto,
      id,
      pinned: false,
      // 越靠后越旧：不依赖 Array.sort 的稳定性，顺序也确定
      sortKey: new Date(Date.now() - i * 60000).toISOString(),
    })
    messages.push(
      ...protoMessages.map((m, j) => ({ ...m, id: `${id}_m${j}`, conversationId: id })),
    )
  }

  project.appData = { ...project.appData, kakaotalk: { conversations, messages } }
  return toWorkData(project)
}

function buildMessagesFixture(characters) {
  const now = new Date()
  const stamp = (dayOffset, hour, minute) =>
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, hour, minute).toISOString()

  const [heroine, friend] = characters

  const conversation = {
    id: 'conv_msgs_fixture',
    title: '',
    participantIds: [heroine.id, friend.id],
    pinned: false,
    avatarAssetId: null,
    sortKey: stamp(0, 10, 23),
  }

  const rows = [
    { sender: friend, time: stamp(-1, 17, 20), content: '你那个快递放驿站了' },
    { sender: heroine, time: stamp(-1, 17, 25), content: '谢谢，我晚上回去拿' },
    { sender: friend, time: stamp(0, 9, 5), content: '关东煮最后一份我买了' },
    { sender: friend, time: stamp(0, 9, 7), content: '不吃就凉了' },
    // 两处时间都写死：已读回执要打的是"已读时刻"，跟发送时刻区分开才验得出取的是哪个
    { sender: heroine, time: stamp(0, 9, 9), content: '给我留一口', readAt: stamp(0, 9, 12) },
    { sender: friend, time: stamp(0, 10, 23), content: '已经凉了' },
  ]

  const messages = rows.map((r, i) => ({
    id: `msgs_fixture_m${i}`,
    conversationId: conversation.id,
    senderCharacterId: r.sender.id,
    senderAccountId: null,
    contentType: 'text',
    content: r.content,
    mediaAssetIds: [],
    displayTime: r.time,
    readAt: r.readAt ?? null,
    createdAt: r.time,
    updatedAt: r.time,
  }))

  return { conversations: [conversation], messages }
}

function buildMessagesWork() {
  const project = createSampleProject()
  const fixture = buildMessagesFixture(project.characters)
  project.appData = { ...project.appData, messages: fixture }
  return toWorkData(project)
}

/**
 * 「信息」+ 一条图片消息。
 *
 * 图片用 data: URL 直接当 assetId —— 资产解析器对 dataURL 原样透传，
 * 这与「独立 HTML 导出」里 assets 表存 dataURL 是同一条路径，
 * 因此不需要在探针里伪造整套 Blob → base64 的导出流水线。
 */
const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

function buildMessagesImageWork() {
  const project = createSampleProject()
  const fixture = buildMessagesFixture(project.characters)
  const conversation = fixture.conversations[0]
  const later = new Date(Date.now() + 60 * 1000).toISOString()

  fixture.messages.push(
    {
      id: 'msgs_fixture_img',
      conversationId: conversation.id,
      senderCharacterId: conversation.participantIds[1] ?? conversation.participantIds[0],
      senderAccountId: null,
      contentType: 'image',
      content: '',
      mediaAssetIds: [PNG_1PX, PNG_1PX],
      displayTime: later,
      readAt: null,
      createdAt: later,
      updatedAt: later,
    },
    {
      // 九宫格：另一个应用里也量一次「3 列 + 方形格子」，别让两个应用的图集规则漂移
      id: 'msgs_fixture_img9',
      conversationId: conversation.id,
      senderCharacterId: conversation.participantIds[1] ?? conversation.participantIds[0],
      senderAccountId: null,
      contentType: 'image',
      content: '',
      mediaAssetIds: Array.from({ length: 9 }, () => PNG_1PX),
      displayTime: later,
      readAt: null,
      createdAt: later,
      updatedAt: later,
    },
    {
      // 我方单图：上方 `.pui-msg__row[data-side='right'] .pui-msg__bubble` 的
      // #0a84ff 比图片规则"重"，蓝底会从图片的四角透出来一圈。这条专门盯它
      id: 'msgs_fixture_img_own',
      conversationId: conversation.id,
      senderCharacterId: conversation.participantIds[0],
      senderAccountId: null,
      contentType: 'image',
      content: '',
      mediaAssetIds: [SVG_3X4],
      displayTime: later,
      readAt: null,
      createdAt: later,
      updatedAt: later,
    },
  )

  project.appData = { ...project.appData, messages: fixture }
  return toWorkData(project)
}

/**
 * KakaoTalk 的「连发分组 + 单图比例」场景。
 *
 * 把 messages 的会话 fixture 塞进 kakaotalk 的数据桶 —— 两个应用共用「会话 + 消息」模型，
 * 只差 senderAccountId 一个字段（这里留 null 即可）。探针要量的是版式，不是数据从哪来。
 *
 * 图用 SVG dataURL 且原始尺寸 600×800：非 1:1 才量得出"按比例缩放"与"被 max-height 压扁"
 * 的差别（1×1 的 PNG 两种情况都是正方形，断言等于没写）。
 */
const SVG_3X4 =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='600' height='800'%3E%3Crect width='600' height='800' fill='%23888'/%3E%3C/svg%3E"

function buildKakaoTalkLayoutWork() {
  const project = createSampleProject()
  const fixture = buildMessagesFixture(project.characters)
  const conversation = fixture.conversations[0]
  const later = new Date(Date.now() + 60 * 1000).toISOString()

  // 发送者跟最后一条同人：这些图片消息应该并进上一个组，而不是各起一组。
  // 分别量：1 张（按比例）、2 张（两列）、3 张（三列）、4 张（2×2 正方形）、9 张（3×3 九宫格）。
  const imageBase = {
    conversationId: conversation.id,
    senderCharacterId: conversation.participantIds[1] ?? conversation.participantIds[0],
    senderAccountId: null,
    contentType: 'image',
    content: '',
    readAt: null,
    createdAt: later,
    updatedAt: later,
  }
  fixture.messages.push(
    {
      ...imageBase,
      id: 'kt_layout_img',
      mediaAssetIds: [SVG_3X4],
      displayTime: later,
    },
    {
      ...imageBase,
      id: 'kt_layout_album2',
      mediaAssetIds: [SVG_3X4, SVG_3X4],
      displayTime: later,
    },
    {
      ...imageBase,
      id: 'kt_layout_album',
      mediaAssetIds: [SVG_3X4, SVG_3X4, SVG_3X4],
      displayTime: later,
    },
    {
      ...imageBase,
      id: 'kt_layout_album4',
      mediaAssetIds: [SVG_3X4, SVG_3X4, SVG_3X4, SVG_3X4],
      displayTime: later,
    },
    {
      ...imageBase,
      id: 'kt_layout_album9',
      mediaAssetIds: Array.from({ length: 9 }, () => SVG_3X4),
      displayTime: later,
    },
  )

  project.appData = { ...project.appData, kakaotalk: fixture }
  return toWorkData(project)
}

function buildKakaoTalkTypesWork() {
  const project = createSampleProject()
  const fixture = buildMessagesFixture(project.characters)
  const conversation = fixture.conversations[0]
  const other = conversation.participantIds[1] ?? conversation.participantIds[0]
  const owner = project.workSettings?.ownerCharacterId ?? conversation.participantIds[0]
  const stamp = new Date(Date.now() + 60 * 1000).toISOString()

  const base = {
    conversationId: conversation.id,
    senderAccountId: null,
    senderName: null,
    content: '',
    mediaAssetIds: [],
    readAt: null,
    displayTime: stamp,
    createdAt: stamp,
    updatedAt: stamp,
  }

  fixture.messages.push(
    {
      ...base,
      id: 'kt_type_voice',
      senderCharacterId: other,
      contentType: 'voice',
      durationSec: 3,
      // 有转写 → 气泡外侧应该出现「转」按钮
      transcript: '你怎么回事啊？',
    },
    // 没转写的那条：不该有按钮（不画死按钮）
    { ...base, id: 'kt_type_voice_long', senderCharacterId: other, contentType: 'voice', durationSec: 75 },
    // 我方的语音也带转写：验证按钮镜像到气泡左侧
    {
      ...base,
      id: 'kt_type_voice_own',
      senderCharacterId: owner,
      contentType: 'voice',
      durationSec: 6,
      transcript: '我马上到',
    },
    {
      ...base,
      id: 'kt_type_sticker',
      senderCharacterId: other,
      contentType: 'sticker',
      mediaAssetIds: [SVG_3X4],
    },
    // 系统消息没有发送者 —— 作品端把它派生为 kind:'system' 的一行居中提示
    {
      ...base,
      id: 'kt_type_system',
      senderCharacterId: null,
      contentType: 'system',
      content: '演示人物 A 邀请 陈默 加入群聊',
    },
    // 单图各一条（对方 / 我方）：单图的宽度要**跟着图走**，
    // 外框一旦还留着 280px，我方的图就被贴在左半边，右边空出一条，看着没跟气泡对齐
    {
      ...base,
      id: 'kt_type_image_other',
      senderCharacterId: other,
      contentType: 'image',
      mediaAssetIds: [SVG_3X4],
    },
    {
      ...base,
      id: 'kt_type_image_own',
      senderCharacterId: owner,
      contentType: 'image',
      mediaAssetIds: [SVG_3X4],
    },
  )

  project.appData = { ...project.appData, kakaotalk: fixture }
  return toWorkData(project)
}

const SCENARIOS = {
  base: buildWork(),
  msgs: buildMessagesWork(),
  msgsImage: buildMessagesImageWork(),
  ktLayout: buildKakaoTalkLayoutWork(),
  ktTypes: buildKakaoTalkTypesWork(),

  pass4: buildWork({
    workSettings: { passcodeEnabled: true, passcode: '1234', passcodeLength: 4 },
  }),
  pass6: buildWork({
    workSettings: {
      passcodeEnabled: true,
      passcode: '123456',
      passcodeLength: 6,
      timeFormat: 'h12',
    },
  }),
  noowner: buildWork({ workSettings: { ownerCharacterId: 'char_missing' } }),
  long: buildLongWork(),
}

function scenarioUrl(name) {
  const work = SCENARIOS[name]
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />





<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="color-scheme" content="light" />
<title>phone-sim probe · ${name}</title>
<link rel="stylesheet" href="./renderer.css" />
<style>
  html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #e9e9ee; }
  #phone-root { width: 100%; height: 100%; }
</style>
<script>

  window.__probeErrors = [];
  window.addEventListener('error', function (e) { window.__probeErrors.push(String(e.message)); });
  window.addEventListener('unhandledrejection', function (e) {
    window.__probeErrors.push('rejection: ' + String(e.reason && e.reason.message || e.reason));
  });
  window.__probeLongTasks = [];
  try {
    new PerformanceObserver(function (list) {
      var es = list.getEntries();
      for (var i = 0; i < es.length; i++) window.__probeLongTasks.push(Math.round(es[i].duration));
    }).observe({ entryTypes: ['longtask'] });
  } catch (_) { /* 老浏览器没有 longtask，靠帧间隔兜底 */ }
</script>
</head>
<body>
<div id="phone-root"></div>
<script>window.__PHONE_WORK__ = ${JSON.stringify({ mode: 'inline', work, assets: {} })};</script>
<script src="./renderer.js"></script>
</body>
</html>`
  const file = path.join(WORK_DIR, `probe-${name}.html`)
  fs.writeFileSync(file, html, 'utf8')
  return 'file:///' + file.split(path.sep).join('/')
}

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--allow-file-access-from-files',
    '--autoplay-policy=no-user-gesture-required',
    // headless 默认会节流不可见窗口的 rAF：不关掉的话"帧间隔"采样只有个位数帧，
    // 指标会失去意义（第一版就踩到了）
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${USER_DATA}`,
    '--window-size=1280,900',
    'about:blank',
  ],
  { stdio: 'ignore' },
)

function connectCdp(wsUrl) {
  const ws = new WebSocket(wsUrl)
  let seq = 0
  const pending = new Map()
  /** 页面控制台与异常：Vue 的渲染错误只走 console.error，不触发 window.onerror */
  const logs = []
  const ready = new Promise((resolve, reject) => {
    ws.onopen = () => resolve()
    ws.onerror = () => reject(new Error('WebSocket 连接失败'))
  })
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.method === 'Runtime.consoleAPICalled') {
      const text = (msg.params.args ?? [])
        .map((a) => a.value ?? a.description ?? a.unserializableValue ?? '')
        .join(' ')
      logs.push(`[${msg.params.type}] ${text}`.slice(0, 500))
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails
      logs.push(`[exception] ${d.exception?.description ?? d.text}`.slice(0, 800))
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
  return { ready, send, logs, close: () => ws.close() }
}

async function findTarget(timeoutMs = 20000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()
      const target = list.find((t) => t.type === 'page')
      if (target?.webSocketDebuggerUrl) return target
    } catch {
      /* chrome 还没起来 */
    }
    await sleep(300)
  }
  return null
}

/** 注入到每个页面的探针助手：用合成 PointerEvent 精确控制拖拽节奏 */
const HELPERS = `
window.__probe = {
  q: (sel) => document.querySelector(sel),
  lock: () => document.querySelector('[data-testid="lock-screen"]'),
  lockInfo() {
    const el = this.lock();
    if (!el) return null;
    return {
      offset: Number(el.dataset.offset),
      progress: Number(el.dataset.progress),
      dragging: el.dataset.dragging === 'true',
      reduced: el.dataset.reduced === 'true',
    };
  },
  _fire(type, y) {
    const el = this.lock();
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    el.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true,
      pointerId: 1, pointerType: 'touch', isPrimary: true,
      button: 0, buttons: type === 'pointerup' ? 0 : 1,
      clientX: x, clientY: rect.top + y,
    }));
  },
  down(y) { this._fire('pointerdown', y); },
  move(y) { this._fire('pointermove', y); },
  up(y) { this._fire('pointerup', y); },
  async frames(n) {
    for (let i = 0; i < (n || 2); i++) {
      await new Promise((r) => requestAnimationFrame(() => r()));
    }
    return this.lockInfo();
  },
  startFrames() {
    window.__frames = [];
    // headless 是按需合成：如果每帧只是记录时间戳、不产生任何"损伤"，

    // 这里每帧改一个 1px 占位块的位置，强制它继续合成，采样才有意义。
    const ticker = document.createElement('div');
    ticker.setAttribute('data-probe-ticker', '');
    ticker.style.cssText =
      'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;z-index:-1';
    document.body.appendChild(ticker);
    window.__ticker = ticker;
    const loop = (t) => {
      window.__frames.push(t);
      ticker.style.transform = 'translateX(' + (window.__frames.length % 2) + 'px)';
      window.__rafId = requestAnimationFrame(loop);
    };
    window.__rafId = requestAnimationFrame(loop);
  },
  stopFrames() {
    if (window.__rafId) cancelAnimationFrame(window.__rafId);
    window.__ticker?.remove();
    const f = window.__frames || [];
    const deltas = [];
    for (let i = 1; i < f.length; i++) deltas.push(f[i] - f[i - 1]);
    if (!deltas.length) return { count: 0, max: 0, p95: 0 };
    const sorted = deltas.slice().sort((a, b) => a - b);
    return {
      count: deltas.length,
      max: Math.round(Math.max(...deltas)),
      p95: Math.round(sorted[Math.floor(sorted.length * 0.95)]),
    };
  },
  errors: () => (window.__probeErrors || []).slice(),
  longTasks: () => (window.__probeLongTasks || []).slice(),
  /** 当前屏的滚动视口。列表与详情同时存在时（过渡中）取第一个 = 列表 */
  scroller: () => document.querySelector('.pui-scroll__viewport'),
  // 注意：这里必须是方法简写而不是箭头函数 —— 箭头函数的 this 是全局 window，
  // this.scroller 会变成 undefined（上一版就是这么挂的）
  scrollTop() {
    const el = this.scroller();
    return el ? Math.round(el.scrollTop) : -1;
  },
  setScroll(top) {
    const el = this.scroller();
    if (!el) return -1;
    el.scrollTop = top;
    // 手动派发一次：赋值本身也会异步触发 scroll，但探针需要"立刻"可读
    el.dispatchEvent(new Event('scroll'));
    return Math.round(el.scrollTop);
  },
  navInfo() {

    // masthead 始终可见、不随内容滚走（它在 ScrollArea 外，是 flex:none 的头部）
    const title = document.querySelector('[data-testid="kt-list-title"]');
    if (!title) return { titleH: -1, titleOpacity: -1 };
    return {
      titleH: Math.round(title.getBoundingClientRect().height),
      titleOpacity: Number(getComputedStyle(title).opacity),
    };
  },
};
'ok'
`

let session = null

try {
  const target = await findTarget()
  if (!target) throw new Error('没能连上 Chrome')
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

  const waitFor = async (expression, label, timeoutMs = 8000) => {
    const startedAt = Date.now()
    while (Date.now() - startedAt < timeoutMs) {
      try {
        if (await evaluate(expression)) return true
      } catch {
        /* 页面正在切换，下一轮再试 */
      }
      await sleep(100)
    }
    const diagnostic = await evaluate(`({ errors: window.__probeErrors, screens: [...document.querySelectorAll('[data-testid$="screen"]')].map(n => n.dataset.testid), text: document.body.innerText.slice(0, 400) })`).catch(() => null)
    throw new Error(`等待超时：${label} ${JSON.stringify(diagnostic)} ${JSON.stringify(session.logs.slice(-3))}`)
  }

  /** 打开某个场景并等手机渲染出来 */
  async function open(name, { media } = {}) {
    if (media) await session.send('Emulation.setEmulatedMedia', { features: media })
    else await session.send('Emulation.setEmulatedMedia', { features: [] })

    await session.send('Page.navigate', { url: scenarioUrl(name) })
    try {
      await waitFor(
        `Boolean(document.querySelector('#phone-root [data-testid="phone-shell"]'))`,
        `${name} 挂载`,
      )
    } catch (err) {
      // 挂载失败时把页面自己的报错捞出来，否则只看到"超时"两个字毫无信息量
      const diag = await evaluate(`({
        url: location.href,
        readyState: document.readyState,
        rootHtml: (document.getElementById('phone-root')?.innerHTML ?? '').slice(0, 300),
        errors: window.__probeErrors ?? ['(错误收集器未执行)'],
        hasWork: Boolean(window.__PHONE_WORK__),
        hasController: Boolean(window.__PHONE_SIM__),
      })`).catch(() => null)
      throw new Error(
        `${err.message} | 诊断 ${JSON.stringify(diag)} | 控制台 ${JSON.stringify(session.logs.slice(-6))}`,
      )
    }
    await evaluate(HELPERS)
    // 首帧渲染 + 壁纸/图标解码
    await sleep(160)
  }

  console.log("\n[system]  系统层验收\n")
  console.log(`  工作目录：${WORK_DIR}`)

  // ══════════════ 场景 1：基础（无密码） ══════════════
  await open('base')

  if (SAMPLE_ONLY) {
    const shotDir = path.join(ROOT, '_shots', 'sample')
    fs.mkdirSync(shotDir, { recursive: true })
    async function screenshot(name) {
      await sleep(250)
      const shot = await session.send('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(path.join(shotDir, `${name}.png`), Buffer.from(shot.data, 'base64'))
    }
    await evaluate(`document.querySelector('[data-testid="lock-hint"]').click()`)
    await waitFor(`!!document.querySelector('[data-testid="home-screen"]')`, '示例桌面')
    record('示例桌面包含四种预设组件、HTML 组件及全部应用', await evaluate(`document.querySelectorAll('[data-testid^="home-widget-"]').length === 5 && document.querySelectorAll('[data-testid^="home-dock-"]').length === 4`))
    await screenshot('desktop')
    await session.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: true })
    await screenshot('desktop-mobile')
    const apps = [['kakaotalk', 'kt-list-screen'], ['messages', 'msg-list-screen'], ['instagram', 'ig-home-screen'], ['x', 'x-home-screen'], ['photos', 'photos-gallery-screen'], ['notes', 'notes-list-screen'], ['phone', 'phone-contacts-screen'], ['settings', 'settings-list-screen']]
    for (const [app, selector] of apps) {
      await evaluate(`window.__PHONE_SIM__.goto({ app: ${JSON.stringify(app)} })`)
      await waitFor(`!!document.querySelector('[data-testid="${selector}"]')`, `${app} 示例入口`)
      record(`${app} 示例可打开`, true)
      if (UI_FIXES && app === 'kakaotalk') {
        record('KKT 未选择好友时不自动列出人物', await evaluate(`document.querySelectorAll('[data-testid="kt-friend-item"]').length === 0`))
        await evaluate(`(() => {
          const work = structuredClone(window.__PHONE_WORK__.work);
          const account = work.platformAccounts.find(a => a.platform === 'kakaotalk' && a.characterId === work.workSettings.ownerCharacterId);
          account.extraFields.friendList = [work.characters[1].id];
          window.__PHONE_SIM__.update({work});
        })()`)
        await waitFor(`document.querySelectorAll('[data-testid="kt-friend-item"]').length === 1`, '选中的好友出现')
        record('KKT 只列出明确选择的好友', true)
      }
      if (UI_FIXES && app === 'settings') {
        record('设置搜索聚焦时无蓝色描边', await evaluate(`(() => {
          const input = document.querySelector('[data-testid="settings-search"]'); input.focus();
          return getComputedStyle(input).outlineStyle === 'none' && getComputedStyle(input.parentElement).outlineStyle === 'none';
        })()`))
      }
      if (UI_FIXES && app === 'instagram') {
        record('我的快拍头像边缘透明且无阴影', await evaluate(`(() => {
          const style = getComputedStyle(document.querySelector('.pui-ig__tray-ownwrap .pui-avatar'));
          return style.backgroundColor === 'rgba(0, 0, 0, 0)' && style.boxShadow === 'none';
        })()`))
      }
      if (UI_FIXES && app === 'x') {
        await evaluate(`window.__PHONE_SIM__.goto({app:'x', screen:'post', entityId:${JSON.stringify(SCENARIOS.base.appData.x.posts[0].id)}})`)
        await waitFor(`!!document.querySelector('[data-testid="x-post-screen"]')`, '主帖详情')
        for (const [nth, flag] of [[2, 'is-reposted'], [3, 'is-liked']]) {
          await evaluate(`document.querySelector('.pui-x__actions:not(.pui-x__actions--sm) .pui-x__act:nth-child(${nth})').click()`)
          record(`主帖 ${flag} 不影响回复`, await evaluate(`document.querySelector('.pui-x__actions:not(.pui-x__actions--sm) .pui-x__act:nth-child(${nth})').classList.contains('${flag}') && !document.querySelector('.pui-x__replies .${flag}')`))
          await evaluate(`document.querySelector('.pui-x__replies .pui-x__act:nth-child(${nth})').click()`)
          await evaluate(`document.querySelector('.pui-x__actions:not(.pui-x__actions--sm) .pui-x__act:nth-child(${nth})').click()`)
          record(`回复 ${flag} 独立保留`, await evaluate(`!document.querySelector('.pui-x__actions:not(.pui-x__actions--sm) .${flag}') && document.querySelectorAll('.pui-x__replies .${flag}').length === 1`))
        }
        await evaluate(`window.__PHONE_SIM__.goto({app:'x', screen:'profile', entityId:{characterId:${JSON.stringify(SCENARIOS.base.characters[0].id)}}})`)
        await waitFor(`!!document.querySelector('[data-testid="x-profile-screen"]')`, '回复页')
        await evaluate(`document.querySelector('[data-testid="x-tab-replies"]').click()`)
        record('回复连接线不拦截图片且图片层级更高', await evaluate(`(() => {
          const context = [...document.querySelectorAll('.pui-x__reply-context')].find(n => n.querySelector('.pui-xp__mediaband'));
          if (!context) return false;
          return getComputedStyle(context, '::after').pointerEvents === 'none' && getComputedStyle(context.querySelector('.pui-xp__mediaband')).zIndex === '1';
        })()`))
        await evaluate(`(() => {
          const band = document.querySelector('.pui-x__reply-context .pui-xp__mediaband');
          band.scrollIntoView({block:'center'});
          const track = band.querySelector('.pui-xm__track');
          track.scrollLeft = track.scrollWidth;
          track.dispatchEvent(new Event('scroll'));
        })()`)
        await sleep(180)
        record('图片翻页后连接线位置仍命中图片', await evaluate(`(() => {
          const context = [...document.querySelectorAll('.pui-x__reply-context')].find(n => n.querySelector('.pui-xp__mediaband'));
          const band = context.querySelector('.pui-xp__mediaband'), rect = band.getBoundingClientRect();
          const hit = document.elementFromPoint(context.getBoundingClientRect().left + 35, rect.top + rect.height / 2);
          return !!hit?.closest('.pui-xp__mediaband') && context.querySelector('.pui-avatar').style.width === '28px';
        })()`))
        await screenshot('x-reply-media-layer')
      }
      await screenshot(app)
      if (app === 'kakaotalk' || app === 'messages') {
        const prefix = app === 'kakaotalk' ? 'kt' : 'msg'
        if (app === 'kakaotalk') await evaluate(`document.querySelector('[data-testid="kt-tab-chats"]').click()`)
        await evaluate(`document.querySelector('[data-testid="${prefix}-conversation-item"]').click()`)
        await waitFor(`!!document.querySelector('[data-testid="${prefix}-thread-screen"]')`, `${app} 示例消息`)
        record(`${app} 示例消息和图片已渲染`, await evaluate(`document.querySelector('[data-testid="${prefix}-thread-screen"]').innerText.includes('示例') && [...document.querySelectorAll('[data-testid="${prefix}-thread-screen"] img')].every(img => img.complete && img.naturalWidth > 0)`))
        if (UI_FIXES && app === 'kakaotalk') record('KKT 系统消息与日期胶囊同高同圆角', await evaluate(`(() => {
          const system = document.querySelector('[data-testid="kt-system"]');
          const date = document.querySelector('.pui-kt__divider-pill');
          const a = getComputedStyle(system), b = getComputedStyle(date);
          return system.offsetHeight === date.offsetHeight && a.borderRadius === b.borderRadius && a.lineHeight === b.lineHeight;
        })()`))
        await screenshot(`${app}-thread`)
      }
    }
    const errors = session.logs.filter(log => log.startsWith('[error]') || log.startsWith('[exception]'))
    record('示例各应用无渲染错误', errors.length === 0, errors.join(' | '))
    console.log(`  示例截图：${shotDir}`)
  } else {

  const shellInfo = await evaluate(`(() => {
    const shell = document.querySelector('[data-testid="phone-shell"]');
    const notch = document.querySelector('.pui-shell__notch');
    return {
      mode: shell.dataset.mode,
      notchDisplay: notch ? getComputedStyle(notch).display : 'missing',
      clock: document.querySelector('[data-testid="lock-clock"]')?.textContent?.trim() ?? '',
      hasDate: Boolean(document.querySelector('[data-testid="lock-date"]')),
    };
  })()`)

  record(
    " 宽视口显示外框与刘海",
    shellInfo.mode === 'device' && shellInfo.notchDisplay !== 'none',
    `${shellInfo.mode} / 刘海 ${shellInfo.notchDisplay}`,
  )
  record(
    '锁屏显示大时钟（日期行已按参考机型移除）',
    /^\d{1,2}:\d{2}$/.test(shellInfo.clock) && !shellInfo.hasDate,
    `「${shellInfo.clock}」/ 日期行 ${shellInfo.hasDate ? '仍存在' : '已移除'}`,
  )

  // ① 1:1 跟随：上移 100px，内容也必须上移 100px
  await evaluate(`window.__probe.down(700)`)
  await evaluate(`window.__probe.move(600)`)
  const follow = await evaluate(`window.__probe.frames(2)`)
  record(" 拖动 1:1 跟随", Math.abs(follow.offset + 100) <= 1, `位移 ${follow.offset}px`)

  // ② 中途反向：退回到只上移 40px，内容立刻跟着退
  await evaluate(`window.__probe.move(660)`)
  const reverse = await evaluate(`window.__probe.frames(2)`)
  record(" 中途反向立即跟随", Math.abs(reverse.offset + 40) <= 1, `位移 ${reverse.offset}px`)

  // ③ 下拉越界走橡皮筋：位移为正但明显小于手指移动量
  await evaluate(`window.__probe.move(760)`)
  const rubber = await evaluate(`window.__probe.frames(2)`)
  record(
    " 越界下拉有阻尼（不是 1:1）",
    rubber.offset > 0 && rubber.offset < 60,
    `手指下拉 60px → 内容 ${rubber.offset}px`,
  )

  // ④ 慢速小幅松手 → 回弹且仍在锁屏
  //    这里必须真的"慢"：速度窗口是 100ms，如果前后两次移动挤在同一批

  await evaluate(`window.__probe.move(660)`)
  await sleep(150)
  await evaluate(`window.__probe.move(656)`)
  await sleep(150)
  await evaluate(`window.__probe.up(656)`)
  await sleep(900)
  const rebounded = await evaluate(`window.__probe.lockInfo()`)
  const reboundState = await evaluate(`({
    home: Boolean(document.querySelector('[data-testid="home-screen"]')),
    pad: Boolean(document.querySelector('[data-testid="passcode-pad"]')),
  })`)
  record(
    " 未过阈值松手回弹",
    rebounded !== null && Math.abs(rebounded.offset) <= 1 && !reboundState.home,
    rebounded ? `回弹到 ${rebounded.offset}px，仍在锁屏` : `锁屏已消失 ${JSON.stringify(reboundState)}`,
  )

  // ⑤ 快速轻扫（位移不足但速度够）→ 解锁
  await evaluate(`(async () => {
    window.__probe.down(700);
    await new Promise((r) => setTimeout(r, 10));
    window.__probe.move(640);
    await new Promise((r) => setTimeout(r, 8));
    window.__probe.up(640);
    return true;
  })()`)
  let flickOk = false
  try {
    await waitFor(`!window.__probe.lock()`, '快速轻扫解锁', 3000)
    flickOk = true
  } catch {
    flickOk = false
  }
  record(" 快速轻扫带惯性越过阈值", flickOk)

  // 没设密码时，解锁必须直接进桌面（不能停在密码盘上）
  const padAfterUnlock = await evaluate(
    `Boolean(document.querySelector('[data-testid="passcode-pad"]'))`,
  )
  record(" 关闭密码时直接进桌面", padAfterUnlock === false)

  await evaluate(`window.__probe.startFrames()`)
  await waitFor(`Boolean(document.querySelector('[data-testid="home-screen"]'))`, '桌面')

  // KakaoTalk 在 Dock 里（Dock 固定电话/信息/KakaoTalk/设置）
  await evaluate(`document.querySelector('[data-testid="home-dock-kakaotalk"]').click()`)
  await waitFor(`Boolean(document.querySelector('[data-testid="kt-list-screen"]'))`, '会话列表')

  await evaluate(`document.querySelector('[data-testid="kt-tab-chats"]').click()`)
  const convCount = await evaluate(
    `document.querySelectorAll('[data-testid="kt-conversation-item"]').length`,
  )
  record(" 桌面 → 应用（会话列表）", convCount > 0, `${convCount} 条会话`)

  await evaluate(`(() => {
    document.querySelector('[data-testid="kt-conversation-item"]').click();
    return true;
  })()`)
  await waitFor(`Boolean(document.querySelector('[data-testid="kt-thread-screen"]'))`, '会话详情')
  const bubbleCount = await evaluate(`document.querySelectorAll('[data-testid="kt-bubble"]').length`)
  const ownCount = await evaluate(
    `document.querySelectorAll('[data-side="right"] [data-testid="kt-bubble"]').length`,
  )
  record(
    " 列表 → 详情（气泡分左右）",
    bubbleCount > 0 && ownCount > 0,
    `${bubbleCount} 条消息，其中自己发的 ${ownCount} 条`,
  )

  await evaluate(`document.querySelector('[data-testid="nav-back"]').click()`)
  await waitFor(`Boolean(document.querySelector('[data-testid="kt-list-screen"]'))`, '返回列表')
  record(" 详情 → 返回列表（路径可逆）", true)

  await evaluate(`document.querySelector('[data-testid="nav-back"]').click()`)
  await waitFor(`Boolean(document.querySelector('[data-testid="home-screen"]'))`, '返回桌面')
  record(" 列表 → 返回桌面", true)

  // 让过渡动画真正跑完再停采样：只采样 100ms 的"点一下就完"说明不了帧率
  await sleep(320)
  const frames = await evaluate(`window.__probe.stopFrames()`)
  const longTasks = await evaluate(`window.__probe.longTasks()`)
  record(
    " 全程无长任务",
    longTasks.length === 0,
    longTasks.length ? `长任务 ${longTasks.join(',')}ms` : '0 个',
  )
  record(
    " 帧间隔无明显尖刺",
    frames.max <= 34,
    `最大 ${frames.max}ms · p95 ${frames.p95}ms · ${frames.count} 帧`,
  )

  const baseErrors = await evaluate(`window.__probe.errors()`)
  record(" 构建产物 file:// 直开可解锁并浏览", true, `${baseErrors.length} 个脚本错误`)

  // ══════════════ 场景 long：列表超出一屏 ══════════════

  // 必须用"真的能滚"的数据 —— 示例项目只有一条会话，拿它测出来的是"两边都是 0"。
  await open('long')
  await evaluate(`(async () => {
    window.__probe.down(700);
    await new Promise((r) => setTimeout(r, 10));
    window.__probe.move(640);
    await new Promise((r) => setTimeout(r, 8));
    window.__probe.up(640);
    return true;
  })()`)
  await waitFor(`Boolean(document.querySelector('[data-testid="home-screen"]'))`, 'long 场景解锁')
  await evaluate(`document.querySelector('[data-testid="home-dock-kakaotalk"]').click()`)
  await waitFor(`Boolean(document.querySelector('[data-testid="kt-list-screen"]'))`, 'long 会话列表')
  await sleep(200)
  await evaluate(`document.querySelector('[data-testid="kt-tab-chats"]').click()`)

  const longRows = await evaluate(
    `document.querySelectorAll('[data-testid="kt-conversation-item"]').length`,
  )
  const scrollable = await evaluate(`(() => {
    const el = window.__probe.scroller();
    return el ? el.scrollHeight - el.clientHeight : 0;
  })()`)
  record(
    '长列表前提：确实超出一屏',
    scrollable > 200,
    `${longRows} 行，可滚 ${Math.round(scrollable)}px`,
  )

  const navAtTop = await evaluate(`window.__probe.navInfo()`)
  record(
    " 列表页固定大标题在顶部完整可见",
    navAtTop.titleH > 20 && navAtTop.titleOpacity > 0.95,
    JSON.stringify(navAtTop),
  )

  const scrolled = await evaluate(`window.__probe.setScroll(240)`)
  await sleep(120)
  const navScrolled = await evaluate(`window.__probe.navInfo()`)
  record(
    " 滚动后大标题不随内容滚走（固定头部）",
    navScrolled.titleH > 20 && navScrolled.titleOpacity > 0.95,
    `scrollTop ${scrolled} · ${JSON.stringify(navScrolled)}`,
  )

  // 进详情再返回：列表是**重新挂载**的，位置只能靠 scrollMemory 还原
  await evaluate(`document.querySelector('[data-testid="kt-conversation-item"]').click()`)
  await waitFor(`Boolean(document.querySelector('[data-testid="kt-thread-screen"]'))`, 'long 会话详情')
  await sleep(280)
  await evaluate(`document.querySelector('[data-testid="nav-back"]').click()`)
  await waitFor(`Boolean(document.querySelector('[data-testid="kt-list-screen"]'))`, '返回 long 列表')
  // 过渡 260ms + 还原时的双 rAF，留足余量再读
  await sleep(420)

  const restored = await evaluate(`window.__probe.scrollTop()`)
  record(
    " 返回列表后滚动位置还原",
    Math.abs(restored - scrolled) <= 2,
    `${scrolled} → ${restored}`,
  )

  const navRestored = await evaluate(`window.__probe.navInfo()`)
  record(
    " 返回后固定大标题仍完整可见",
    navRestored.titleH > 20 && navRestored.titleOpacity > 0.95,
    JSON.stringify(navRestored),
  )

  await evaluate(`document.querySelector('[data-testid="kt-list-title"]').click()`)
  let ktHomeOk = true
  try {
    await waitFor(
      `Boolean(document.querySelector('[data-testid="home-screen"]'))`,
      'KakaoTalk 回桌面',
      3000,
    )
  } catch {
    ktHomeOk = false
  }
  record(" 点大标题回桌面（KakaoTalk）", ktHomeOk)

  // 新开一页：不受上面 KakaoTalk 的滚动位置与导航栈影响
  await open('base')
  await evaluate(`document.querySelector('[data-testid="lock-hint"]').click()`)
  await waitFor(`Boolean(document.querySelector('[data-testid="home-screen"]'))`, 'X 场景桌面')
  await evaluate(`document.querySelector('[data-testid="home-app-x"]').click()`)
  await waitFor(`Boolean(document.querySelector('[data-testid="x-home-screen"]'))`, 'X 首页')

  const xHome = await evaluate(`(() => ({
    posts: document.querySelectorAll('[data-testid="x-post-item"]').length,
    grok: document.body.innerText.toLowerCase().includes('grok'),
    tabs: document.querySelectorAll('[data-testid^="x-tab-"]').length,
    fab: Boolean(document.querySelector('[data-testid="x-fab"]')),
  }))()`)
  record(" X 首页渲染帖子流", xHome.posts > 0, `${xHome.posts} 条帖子`)
  record(
    " 无 Grok 元素 + 底部 4 tab + 发帖钮",
    xHome.grok === false && xHome.tabs === 4 && xHome.fab,
    `grok ${xHome.grok ? '存在' : '已移除'} · ${xHome.tabs} 个 tab`,
  )

  await evaluate(`document.querySelector('[data-testid="x-post-item"]').click()`)
  await waitFor(`Boolean(document.querySelector('[data-testid="x-post-screen"]'))`, 'X 帖子详情')
  await sleep(260)
  const xDetail = await evaluate(`(() => ({
    replies: document.querySelectorAll('[data-testid="x-reply-item"]').length,
    compose: Boolean(document.querySelector('.pui-x__replybar')),
  }))()`)
  record(
    " 帖子详情含回复列表与回复条",
    xDetail.replies > 0 && xDetail.compose,
    `${xDetail.replies} 条回复`,
  )

  // 回复线程：同一对话内用竖线连起来，只有不同对话之间才画分隔线
  const xThread = await evaluate(`(() => ({
    links: document.querySelectorAll('.pui-x__reply--down').length,
    seps: document.querySelectorAll('.pui-x__reply--end').length,
    quote: document.body.innerText.includes('查看引用'),
  }))()`)
  record(
    " 回复按对话连线，保留独立线程",
    xThread.links > 0 && xThread.seps > 0 && xThread.quote,
    `${xThread.links} 处连线 / ${xThread.seps} 处分隔`,
  )

  await evaluate(`document.querySelector('[data-testid="nav-back"]').click()`)
  await waitFor(`Boolean(document.querySelector('[data-testid="x-home-screen"]'))`, 'X 返回首页')
  record(" 详情 → 返回首页（路径可逆）", true)

  await evaluate(`document.querySelector('[data-testid="x-avatar-btn"]').click()`)
  await waitFor(`Boolean(document.querySelector('[data-testid="x-profile-screen"]'))`, 'X 个人主页')
  // 等 push 过渡结束：旧屏在 260ms 内仍挂在 DOM 上，数帖子会把它算进来
  await sleep(420)
  const xProfile = await evaluate(`(() => ({
    share: document.body.innerText.includes('分享'),
    edit: document.body.innerText.includes('编辑个人资料'),
    dm: document.body.innerText.includes('私信'),
    likes: Boolean(document.querySelector('[data-testid="x-tab-likes"]')),
    posts: document.querySelectorAll('[data-testid="x-post-item"]').length,
  }))()`)
  record(
    " 个人主页：分享 / 编辑个人资料 / 爱心 tab",
    xProfile.share && xProfile.edit && !xProfile.dm && xProfile.likes && xProfile.posts > 0,
    `帖子 ${xProfile.posts} 条 · 私信${xProfile.dm ? '仍存在' : '已改为分享'}`,
  )

  await evaluate(`document.querySelector('[data-testid="x-tab-replies"]').click()`)
  await sleep(240)
  const xRepliesTab = await evaluate(
    `document.querySelectorAll('[data-testid="x-post-item"]').length`,
  )
  record(" 主页「回复」tab 有内容", xRepliesTab > 0, `${xRepliesTab} 条回复`)

  await evaluate(`document.querySelector('[data-testid="nav-back"]').click()`)
  await waitFor(`Boolean(document.querySelector('[data-testid="x-home-screen"]'))`, 'X 回首页')
  await evaluate(`document.querySelector('[data-testid="x-home-logo"]').click()`)
  let xHomeOk = true
  try {
    await waitFor(
      `Boolean(document.querySelector('[data-testid="home-screen"]'))`,
      'X 回桌面',
      3000,
    )
  } catch {
    xHomeOk = false
  }
  record(" 点 X logo 回桌面", xHomeOk)

  // 电话在 Dock 里（HomeScreen 的 DOCK_IDS），不在网格
  await evaluate(`document.querySelector('[data-testid="home-dock-phone"]').click()`)
  await waitFor(
    `Boolean(document.querySelector('[data-testid="phone-contacts-screen"]'))`,
    '电话通讯录',
  )
  const phContacts = await evaluate(`(() => ({
    rows: document.querySelectorAll('[data-testid="phone-contact-row"]').length,
    groups: document.querySelectorAll('.pui-ph__group-head').length,
    index: document.querySelectorAll('.pui-ph__index span').length,
    tabs: document.querySelectorAll('[data-testid^="phone-tab-"]').length,
  }))()`)
  record(
    " 通讯录：按拼音分组 + 右侧索引条",
    phContacts.rows > 0 && phContacts.groups > 0 && phContacts.index > 0,
    `${phContacts.rows} 人 / ${phContacts.groups} 组 / ${phContacts.tabs} 个可点 tab`,
  )

  // 最近通话 / 通讯录 / 拨号是三 tab 直达的平级页面，谁也不是谁的"上一页"：
  // 通讯录取掉了返回键，标题必须仍在正中（左格子留空占位，否则标题会往左塌）
  const phContactHead = await evaluate(`(() => {
    const title = document.querySelector('[data-testid="phone-title"]')
    const nav = title.closest('.pui-ph__nav')
    const navBox = nav.getBoundingClientRect()
    const titleBox = title.getBoundingClientRect()
    return {
      hasBack: Boolean(document.querySelector('[data-testid="phone-contacts-back"]')),
      drift: Math.abs((titleBox.left + titleBox.right) / 2 - (navBox.left + navBox.right) / 2),
      label: title.textContent.trim(),
    }
  })()`)
  record(
    " 通讯录：无返回键（与最近通话/拨号平级），标题仍在正中",
    !phContactHead.hasBack && phContactHead.drift < 1,
    `${phContactHead.label} · 偏移 ${Math.round(phContactHead.drift * 10) / 10}px`,
  )

  const phGroups = await evaluate(
    `[...document.querySelectorAll('.pui-ph__group-head')].map((h) => h.textContent.trim())`,
  )
  const phGroupsOk =
    phGroups.length > 1 &&
    phGroups.every((letter) => /^[A-Z#]$/.test(letter)) &&
    phGroups.every((letter, i) => i === 0 || phGroups[i - 1] < letter)
  record(" 分组按拼音首字母递增", phGroupsOk, phGroups.join(' → '))

  // 索引条 27 个字符、每格等分列表高度（相邻间距必须一致）
  const phIndex = await evaluate(`(() => {
    const spans = [...document.querySelectorAll('.pui-ph__index span')]
    if (spans.length < 2) return { count: spans.length, even: false, gap: 0 }
    const tops = spans.map((s) => s.getBoundingClientRect().top)
    const gaps = tops.slice(1).map((t, i) => t - tops[i])
    return {
      count: spans.length,
      even: gaps.every((g) => Math.abs(g - gaps[0]) < 0.6),
      gap: Math.round(gaps[0] * 10) / 10,
    }
  })()`)
  record(
    " 索引条字符等距、竖向均匀",
    phIndex.count === 27 && phIndex.even,
    `${phIndex.count} 个 · 间距 ${phIndex.gap}px`,
  )

  // 横线三条规则：组标题 = 通栏（left 16）；名片下面无横线；组内最后一个联系人不画线；
  // 其余联系人行 / 通话行 = 缩进（left 72，从文字左沿起笔）
  const phRules = await evaluate(`(() => {
    const left = (el) => {
      if (!el) return 'MISSING'
      const cs = getComputedStyle(el, '::after')
      return cs.content === 'none' || !cs.content ? null : parseFloat(cs.left)
    }
    const groups = [...document.querySelectorAll('.pui-ph__group-head')]
    const headLefts = groups.map(left)
    const cardLeft = left(document.querySelector('.pui-ph__card'))
    const lastRowHasLine = groups.map((h) => {
      const rows = [...h.parentElement.querySelectorAll('[data-testid="phone-contact-row"]')]
      return rows.length > 0 && left(rows[rows.length - 1]) !== null
    })
    const innerRows = [...document.querySelectorAll('[data-testid="phone-contact-row"]')]
      .filter((r) => !r.classList.contains('pui-ph__row--last'))
      .map(left)
    return {
      headCount: headLefts.length,
      headAllFull: headLefts.every((v) => v === 16),
      cardNoLine: cardLeft === null,
      cardLeft,
      lastRowClean: lastRowHasLine.every((v) => v === false),
      badLast: lastRowHasLine.filter((v) => v).length,
      innerAllIndented: innerRows.length > 0 && innerRows.every((v) => v === 72),
      badInner: innerRows.filter((v) => v !== 72).length,
      sample: { head: headLefts[0], inner: innerRows[0] },
    }
  })()`)
  record(
    " 横线：组标题通栏 · 名片无线 · 组末无线 · 行内缩进",
    phRules.headAllFull && phRules.cardNoLine && phRules.lastRowClean && phRules.innerAllIndented,
    `组标题 left ${phRules.sample.head} · 名片 ${phRules.cardLeft === null ? '无线' : 'MISMATCH'} · 行 left ${phRules.sample.inner} · ` +
      `组末仍画线 ${phRules.badLast} 处 · 行缩进异常 ${phRules.badInner} 处`,
  )
  // 通话行的线同理（此时还停在通讯录，切过去量完再回来）
  await evaluate(`document.querySelector('[data-testid="phone-tab-recents"]').click()`)
  await waitFor(
    `Boolean(document.querySelector('[data-testid="phone-recents-screen"]'))`,
    '最近通话',
  )
  const phCallLeft = await evaluate(`(() => {
    const el = document.querySelector('.pui-ph__call')
    return el ? parseFloat(getComputedStyle(el, '::after').left) : -1
  })()`)
  await evaluate(`document.querySelector('[data-testid="phone-tab-contacts"]').click()`)
  await waitFor(
    `Boolean(document.querySelector('[data-testid="phone-contacts-screen"]'))`,
    '回通讯录',
  )
  record(" 最近通话行缩进（left 72，不划到头像下）", phCallLeft === 72, `left ${phCallLeft}`)

  // 拨号键盘：12 个键 + 边打边分组 + 输到 4 位以上提示"这是谁"
  await evaluate(`document.querySelector('[data-testid="phone-tab-dial"]').click()`)
  await waitFor(
    `Boolean(document.querySelector('[data-testid="phone-dial-screen"]'))`,
    '拨号键盘',
  )
  await evaluate(
    `['0','0','0','0','0','0','0'].forEach((d) =>
       document.querySelector('[data-testid="phone-key-' + d + '"]').click())`,
  )
  await sleep(220)
  const phDial = await evaluate(`(() => ({
    keys: document.querySelectorAll('[data-testid^="phone-key-"]').length,
    number: document.querySelector('.pui-ph__dial-num')?.textContent?.trim() ?? '',
    hint: document.querySelector('.pui-ph__dial-hint')?.textContent?.trim() ?? '',
  }))()`)
  record(
    " 拨号键盘：12 键 + 号码分组 + 联系人提示",
    phDial.keys === 12 && phDial.number === '000 0000' && phDial.hint.length > 0,
    `${phDial.keys} 键 · ${phDial.number} · ${phDial.hint}`,
  )

  // 标题的字号/字重必须和通讯录、最近通话一模一样，否则一眼就看得出是两套顶栏
  const phDialHead = await evaluate(`(() => {
    const title = document.querySelector('[data-testid="phone-dial-screen"] [data-testid="phone-title"]')
    const nav = title.closest('.pui-ph__nav')
    const navBox = nav.getBoundingClientRect()
    const titleBox = title.getBoundingClientRect()
    const cs = getComputedStyle(title)
    return {
      label: title.textContent.trim(),
      drift: Math.abs((titleBox.left + titleBox.right) / 2 - (navBox.left + navBox.right) / 2),
      size: cs.fontSize,
      weight: cs.fontWeight,
      chip: Boolean(document.querySelector('.pui-ph__labelchip')),
    }
  })()`)
  record(
    " 拨号：顶栏为居中「拨号」标题，号码标签胶囊已摘除",
    phDialHead.label === '拨号' &&
      phDialHead.drift < 1 &&
      !phDialHead.chip &&
      phDialHead.size === '17px',
    `${phDialHead.label} · ${phDialHead.size}/${phDialHead.weight} · 胶囊 ${phDialHead.chip} · 偏移 ${Math.round(phDialHead.drift * 10) / 10}px`,
  )

  await evaluate(`document.querySelector('[data-testid="phone-tab-recents"]').click()`)
  await waitFor(
    `Boolean(document.querySelector('[data-testid="phone-recents-screen"]'))`,
    '最近通话',
  )
  const phCalls = await evaluate(`(() => ({
    rows: document.querySelectorAll('[data-testid="phone-call-row"]').length,
    missed: document.querySelectorAll('.pui-ph__call-name--missed').length,
  }))()`)
  record(
    " 最近通话：列表 + 未接来电标红",
    phCalls.rows > 0 && phCalls.missed > 0,
    `${phCalls.rows} 条 / ${phCalls.missed} 条未接`,
  )

  await evaluate(`document.querySelector('[data-testid="phone-tab-contacts"]').click()`)
  await waitFor(
    `Boolean(document.querySelector('[data-testid="phone-contacts-screen"]'))`,
    '回通讯录',
  )
  await evaluate(`document.querySelector('[data-testid="phone-contact-row"]').click()`)
  await waitFor(
    `Boolean(document.querySelector('[data-testid="phone-contact-screen"]'))`,
    '联系人详情',
  )
  await sleep(320)
  const phDetail = await evaluate(`(() => ({
    name: document.querySelector('.pui-cd__name')?.textContent?.trim() ?? '',
    hasField: document.body.innerText.includes('电话'),
    back: Boolean(document.querySelector('[data-testid="nav-back"]')),
  }))()`)
  record(
    " 联系人详情：名字 + 号码字段 + 返回键",
    phDetail.name.length > 0 && phDetail.hasField && phDetail.back,
    phDetail.name,
  )

  await evaluate(`document.querySelector('[data-testid="nav-back"]').click()`)
  await waitFor(
    `Boolean(document.querySelector('[data-testid="phone-contacts-screen"]'))`,
    '详情返回通讯录',
  )
  record(" 详情 → 返回通讯录（路径可逆）", true)

  await evaluate(`document.querySelector('[data-testid="phone-title"]').click()`)
  let phHomeOk = true
  try {
    await waitFor(
      `Boolean(document.querySelector('[data-testid="home-screen"]'))`,
      '电话回桌面',
      3000,
    )
  } catch {
    phHomeOk = false
  }
  record(" 点页面标题回桌面（电话）", phHomeOk)

  await open('base')
  await evaluate(`document.querySelector('[data-testid="lock-hint"]').click()`)
  await waitFor(`Boolean(document.querySelector('[data-testid="home-screen"]'))`, '照片场景桌面')
  await evaluate(`document.querySelector('[data-testid="home-app-photos"]').click()`)
  await waitFor(
    `Boolean(document.querySelector('[data-testid="photos-gallery-screen"]'))`,
    '图库',
  )
  // 图片是 dataURL，解码是异步的：不 waiting 会量到 naturalWidth = 0
  await sleep(260)

  const phoGallery = await evaluate(`(() => {
    const tiles = [...document.querySelectorAll('[data-testid="photos-grid"] [data-testid="photos-tile"]')]
    const imgs = tiles.map((t) => t.querySelector('img')).filter(Boolean)
    const grid = document.querySelector('[data-testid="photos-grid"]')
    return {
      tiles: tiles.length,
      decoded: imgs.filter((i) => i.naturalWidth > 0 && i.naturalHeight > 0).length,
      months: [...document.querySelectorAll('[data-testid="photos-month-title"]')].map((n) => n.textContent.trim()),
      cols: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0,
    }
  })()`)
  record(
    " 图库：3 列网格，6 张照片全部解码",
    phoGallery.tiles === 6 && phoGallery.cols === 3 && phoGallery.decoded === 6,
    `${phoGallery.tiles} 张 · ${phoGallery.decoded} 张已解码 · ${phoGallery.cols} 列`,
  )
  record(
    " 图库：按拍摄月份分组，最近的月份在最前",
    phoGallery.months.length === 3 && phoGallery.months[0] === (new Date(SCENARIOS.base.appData.photos.photos[0].displayTime).getMonth() + 1) + '月',
    phoGallery.months.join(' / '),
  )

  const phoNav = await evaluate(`(() => ({
    meta: Boolean(document.querySelector('.pui-pho__nav-meta')),
    search: Boolean(document.querySelector('[data-testid="photos-search-open"]')),
  }))()`)
  record(
    " 图库：右上角是放大镜（\"N 张\"统计已摘除）",
    !phoNav.meta && phoNav.search,
    `张数格 ${phoNav.meta} · 放大镜 ${phoNav.search}`,
  )

  const phoFade = await evaluate(`(() => {
    const scroll = document.querySelector('[data-testid="photos-gallery-screen"] .pui-scroll')
    const vp = scroll?.querySelector('.pui-scroll__viewport')
    return {
      fadeClass: scroll ? scroll.classList.contains('pui-scroll--fade') : null,
      mask: vp ? getComputedStyle(vp).maskImage : 'missing',
    }
  })()`)
  record(
    "图库：滚动区无渐隐遮罩（网格切在屏幕边缘）",
    phoFade.fadeClass === false && (phoFade.mask === 'none' || phoFade.mask === ''),
    `fade 类 ${phoFade.fadeClass} · mask ${phoFade.mask}`,
  )

  await evaluate(`document.querySelector('[data-testid="photos-search-open"]').click()`)
  await waitFor(
    `Boolean(document.querySelector('[data-testid="photos-search-input"]'))`,
    '搜索输入框',
  )
  await sleep(180)
  const phoSearchOpen = await evaluate(`(() => {
    const input = document.querySelector('[data-testid="photos-search-input"]')
    return {
      focused: document.activeElement === input,
      placeholder: input.placeholder,
      title: Boolean(document.querySelector('[data-testid="photos-title"]')),
    }
  })()`)

  const typeQuery = (text) =>
    evaluate(`(() => {
      const input = document.querySelector('[data-testid="photos-search-input"]')
      input.value = ${JSON.stringify(text)}
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()`)

  await typeQuery('方形')
  await sleep(220)
  const phoSearchHit = await evaluate(`(() => ({
    tiles: document.querySelectorAll('[data-testid="photos-grid"] [data-testid="photos-tile"]').length,
    months: document.querySelectorAll('[data-testid="photos-month-title"]').length,
  }))()`)
  record(
    " 搜索：放大镜就地换成输入框并聚焦，输入「方形」只剩 1 张",
    phoSearchOpen.focused &&
      !phoSearchOpen.title &&
      phoSearchHit.tiles === 1 &&
      phoSearchHit.months === 1,
    `${phoSearchOpen.placeholder} · 聚焦 ${phoSearchOpen.focused} · ${phoSearchHit.tiles} 张 / ${phoSearchHit.months} 组`,
  )

  // 搜月份标题要整组留下：搜"10月"该给出那个月的全部 4 张，而不是 0 张
  const monthPhotos = SCENARIOS.base.appData.photos.photos.filter(photo => !photo.isHidden && !photo.isInTrash && new Date(photo.displayTime).getMonth() === new Date(SCENARIOS.base.appData.photos.photos[0].displayTime).getMonth())
  await typeQuery((new Date(monthPhotos[0].displayTime).getMonth() + 1) + '月')
  await sleep(220)
  const phoSearchMonth = await evaluate(
    `document.querySelectorAll('[data-testid="photos-grid"] [data-testid="photos-tile"]').length`,
  )
  record(
    " 搜索：搜最新月份标题整组命中",
    phoSearchMonth === monthPhotos.length,
    `${phoSearchMonth} 张`,
  )

  await typeQuery('不存在的词')
  await sleep(200)
  const phoSearchEmpty = await evaluate(`document.body.innerText.includes('没有找到照片')`)
  record(" 搜索：无结果时明说\"没有找到照片\"，不留空白", phoSearchEmpty)

  // 取消：标题回来、6 张全在。搜索态不能留下痕迹（否则后面点第一张的计数会错）
  await evaluate(`document.querySelector('[data-testid="photos-search-cancel"]').click()`)
  await sleep(240)
  const phoSearchClosed = await evaluate(`(() => ({
    tiles: document.querySelectorAll('[data-testid="photos-grid"] [data-testid="photos-tile"]').length,
    input: Boolean(document.querySelector('[data-testid="photos-search-input"]')),
    title: document.querySelector('[data-testid="photos-title"]')?.textContent?.trim() ?? '',
  }))()`)
  record(
    " 取消搜索：标题复原，6 张照片全部回来",
    phoSearchClosed.tiles === 6 &&
      !phoSearchClosed.input &&
      phoSearchClosed.title === '图库',
    `${phoSearchClosed.title} · ${phoSearchClosed.tiles} 张`,
  )

  // 查看器：点开第一张。图库共 6 张、分 3 个月份组，查看器应当拿到整条 6 张的列表
  await evaluate(
    `document.querySelector('[data-testid="photos-grid"] [data-testid="photos-tile"]').click()`,
  )
  await waitFor(`Boolean(document.querySelector('[data-testid="photos-viewer"]'))`, '照片查看器')
  await sleep(300)
  const phoViewer = await evaluate(`(() => {
    const img = document.querySelector('[data-testid="photos-pager"] img')
    const viewer = document.querySelector('[data-testid="photos-viewer"]')
    const thumbs = document.querySelectorAll('[data-testid="photos-viewer-thumbs"] .pui-pho__thumb')
    return {
      stamp: document.querySelector('[data-testid="photos-viewer-stamp"]')?.textContent?.trim() ?? '',
      count: document.querySelector('[data-testid="photos-viewer-count"]')?.textContent?.trim() ?? '',
      place: document.querySelector('.pui-pho__vplace')?.textContent?.trim() ?? '',
      tone: document.querySelector('[data-testid="statusbar"]')?.dataset.tone ?? '',
      bg: viewer ? getComputedStyle(viewer).backgroundColor : '',
      light: viewer ? viewer.classList.contains('pui-pho__screen--light') : false,
      thumbs: thumbs.length,
      current: document.querySelectorAll('[data-testid="photos-viewer-thumbs"] .is-current').length,
      drawn: img ? img.getBoundingClientRect().width > 0 : false,
    }
  })()`)
  record(
    " 查看器：图片铺满 + 拍摄时间 + 计数",
    phoViewer.drawn && phoViewer.stamp.length > 0 && phoViewer.count === '1 / 6',
    `${phoViewer.count || '无计数'} · ${phoViewer.stamp || '无时间'} · ${phoViewer.place || '无地点'}`,
  )
  record(
    " 查看器：白底主题（不再是黑底）",
    phoViewer.light === true && phoViewer.bg === 'rgb(255, 255, 255)',
    `class=${phoViewer.light ? 'light' : '非 light'} · bg=${phoViewer.bg}`,
  )
  record(
    " 查看器：白底时状态栏是深色字",
    phoViewer.tone === 'dark',
    `statusbar tone=${phoViewer.tone}`,
  )
  record(
    " 查看器：底部缩略图条列出图库全部 6 张，且只有一张标着当前",
    phoViewer.thumbs === 6 && phoViewer.current === 1,
    `${phoViewer.thumbs} 张缩略图 · ${phoViewer.current} 张标当前`,
  )

  // 点一下图片：信息层收起
  await evaluate(`document.querySelector('[data-testid="photos-pager"]').click()`)
  await sleep(200)
  const chromeOff = await evaluate(
    `document.querySelector('.pui-pho__vbar')?.dataset.on ?? 'missing'`,
  )
  record(" 查看器：轻点图片收起信息层", chromeOff === 'false', `data-on=${chromeOff}`)
  await evaluate(`document.querySelector('[data-testid="photos-pager"]').click()`)
  await sleep(160)

  // 翻页：容器自己的横向滚动（scroll-snap），不碰视口边缘
  await evaluate(`(() => {
    const el = document.querySelector('[data-testid="photos-pager"]')
    el.scrollLeft = el.clientWidth
    return true
  })()`)
  await sleep(360)
  const phoPaged = await evaluate(
    `document.querySelector('[data-testid="photos-viewer-count"]')?.textContent?.trim() ?? ''`,
  )
  record(" 查看器：横向滑动翻到第 2 张", phoPaged === '2 / 6', phoPaged || '无计数')

  /*
   * 桌面拖拽翻页。
   *
   * 为什么必须单独验：手机上原生横滑一直是可以的，失败的是"用鼠标在电脑上拖"——
   * 那正是作品在创作端预览里被看到的样子。这条覆盖 pointerType: 'mouse' 那条分支。
   * 事件用 JS 派发而不是 CDP 的 Input：需要精确控制位移与 pointerType。
   */
  await evaluate(`(() => {
    const el = document.querySelector('[data-testid="photos-pager"]')
    el.scrollLeft = 0
    const rect = el.getBoundingClientRect()
    const y = rect.top + rect.height / 2
    const startX = rect.left + rect.width * 0.75
    const dx = Math.round(rect.width * 0.8)
    const fire = (type, x, buttons) =>
      el.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId: 1,
          pointerType: 'mouse',
          button: 0,
          buttons,
          clientX: x,
          clientY: y,
        }),
      )
    fire('pointerdown', startX, 1)
    fire('pointermove', startX - dx / 2, 1)
    fire('pointermove', startX - dx, 1)
    fire('pointerup', startX - dx, 0)
    return true
  })()`)
  await sleep(600)
  const phoDragged = await evaluate(
    `document.querySelector('[data-testid="photos-viewer-count"]')?.textContent?.trim() ?? ''`,
  )
  record(
    " 查看器：鼠标拖拽也能翻到第 2 张",
    phoDragged === '2 / 6',
    phoDragged || '无计数',
  )

  await evaluate(`(() => {
    const bar = document.querySelector('[data-testid="photos-viewer-thumbs"]')
    bar.style.right = 'auto'
    bar.style.width = '130px'
    return true
  })()`)
  for (let page = 2; page <= 5; page += 1) {
    await evaluate(`(() => {
      const el = document.querySelector('[data-testid="photos-pager"]')
      el.scrollLeft = el.clientWidth * ${page}
      return true
    })()`)
    await sleep(180)
  }
  await sleep(420)
  const phoLast = await evaluate(`(() => {
    const bar = document.querySelector('[data-testid="photos-viewer-thumbs"]')
    const thumbs = [...bar.querySelectorAll('.pui-pho__thumb')]
    const cur = bar.querySelector('.pui-pho__thumb.is-current')
    const box = bar.getBoundingClientRect()
    const item = cur ? cur.getBoundingClientRect() : null
    return {
      count: document.querySelector('[data-testid="photos-viewer-count"]')?.textContent?.trim() ?? '',
      total: thumbs.length,
      slides: document.querySelectorAll('[data-testid="photos-pager"] .pui-pho__slide').length,
      currentIndex: thumbs.findIndex((t) => t.classList.contains('is-current')),
      currentCount: thumbs.filter((t) => t.classList.contains('is-current')).length,
      thumbVisible: Boolean(item) && item.left >= box.left - 1 && item.right <= box.right + 1,
      thumbScroll: Math.round(bar.scrollLeft),
      place: document.querySelector('.pui-pho__vplace')?.textContent?.trim() ?? '',
    }
  })()`)
  record(
    " 查看器：跨月份一路翻到最后一页（6 / 6），不再被当月截断",
    phoLast.count === '6 / 6' && phoLast.total === 6 && phoLast.slides === 6,
    `${phoLast.count} · ${phoLast.total} 枚缩略图 · ${phoLast.slides} 页`,
  )
  record(
    " 查看器：缩略图条同步——高亮在第 6 枚且滚动到可视区",
    phoLast.currentIndex === 5 &&
      phoLast.currentCount === 1 &&
      phoLast.thumbVisible &&
      phoLast.thumbScroll > 0,
    `高亮 ${phoLast.currentIndex} · 可视 ${phoLast.thumbVisible} · scrollLeft ${phoLast.thumbScroll} · 标题「${phoLast.place}」`,
  )
  await evaluate(`(() => {
    const bar = document.querySelector('[data-testid="photos-viewer-thumbs"]')
    bar.style.right = ''
    bar.style.width = ''
    return true
  })()`)

  await evaluate(`document.querySelector('[data-testid="photos-viewer-back"]').click()`)
  await waitFor(
    `Boolean(document.querySelector('[data-testid="photos-gallery-screen"]'))`,
    '退出查看器',
  )
  const phoToneBack = await evaluate(
    `document.querySelector('[data-testid="statusbar"]')?.dataset.tone ?? ''`,
  )
  record(
    " 退出查看器后状态栏仍为深色字（没有残留 light）",
    phoToneBack === 'dark',
    `tone=${phoToneBack}`,
  )

  // 相簿：内置「个人收藏」置顶 + 两个用户相簿；「最近删除」不占网格卡位，
  // 收在网格末尾的「更多项目」分组列表里（一行：图标 / 名称 / 张数）
  await evaluate(`document.querySelector('[data-testid="photos-tab-albums"]').click()`)
  await waitFor(
    `Boolean(document.querySelector('[data-testid="photos-albums-screen"]'))`,
    '相簿',
  )
  await sleep(260)
  const phoAlbums = await evaluate(`(() => {
    const more = document.querySelector('[data-testid="photos-more-section"]')
    const rows = more ? [...more.querySelectorAll('.pui-pho__more-row')] : []
    return {
      cards: document.querySelectorAll('[data-testid="photos-album-card"]').length,
      names: [...document.querySelectorAll('.pui-pho__album-name')].map((n) => n.textContent.trim()),
      covers: [...document.querySelectorAll('[data-testid="photos-album-card"] img')]
        .filter((i) => i.naturalWidth > 0).length,
      trashInGrid: Boolean(document.querySelector('[data-testid="photos-album-card"][data-album-id="__trash__"]')),
      moreTitle: more?.querySelector('.pui-pho__more-title')?.textContent?.trim() ?? '',
      moreLabels: rows.map((r) => r.querySelector('.pui-pho__more-label')?.textContent?.trim() ?? ''),
      moreCounts: rows.map((r) => r.querySelector('.pui-pho__more-count')?.textContent?.trim() ?? ''),
      moreIcon: rows.length > 0 && rows.every((r) => r.querySelector('svg')),
      moreBelowGrid: (() => {
        const grid = document.querySelector('[data-testid="photos-album-list"]')
        if (!grid || !more) return false
        return more.getBoundingClientRect().top >= grid.getBoundingClientRect().bottom - 1
      })(),
    }
  })()`)
  record(
    " 相簿：「个人收藏」置顶 + 两个用户相簿，「最近删除」不再占网格卡位",
    phoAlbums.cards === 3 &&
      phoAlbums.names[0] === '个人收藏' &&
      phoAlbums.names.includes('相簿示例') &&
      !phoAlbums.trashInGrid,
    `${phoAlbums.cards} 张卡：${phoAlbums.names.join(' / ')}`,
  )
  record(
    " 相簿：网格末尾「更多项目」= 已隐藏 + 最近删除 两行（图标 + 名称 + 张数）",
    phoAlbums.moreTitle === '更多项目' &&
      phoAlbums.moreLabels.join(',') === '已隐藏,最近删除' &&
      phoAlbums.moreCounts.length === 2 &&
      phoAlbums.moreCounts.every((c) => /^\d+$/.test(c)) &&
      phoAlbums.moreIcon &&
      phoAlbums.moreBelowGrid,
    `${phoAlbums.moreTitle} · ${phoAlbums.moreLabels.join(' / ')} ${phoAlbums.moreCounts.join('/')} · 在网格下方=${phoAlbums.moreBelowGrid}`,
  )
  record(" 相簿：2×2 封面拼贴可用", phoAlbums.covers >= 6, `${phoAlbums.covers} 张封面图`)

  /*
   * 封面每格必须是正方形。
   * 示例图全是 600×600，看不出 `1fr` 行高被图片固有比例撑开的坑（3:4 竖图会把
   * 单格撑到 85.5×114，4:3 横图缩到 85.5×64），所以这里临时把「相簿示例」封面的图
   * 换成 3:4 竖图量一次，量完立刻还原原图。
   */
  await evaluate(`(() => {
    const card = [...document.querySelectorAll('[data-testid="photos-album-card"]')].find((c) => c.textContent.includes('相簿示例'))
    const imgs = [...card.querySelectorAll('.pui-pho__album-cover img')]
    window.__coverPrev = imgs.map((i) => i.getAttribute('src'))
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400" viewBox="0 0 300 400"><rect width="300" height="400" fill="#d94a3d"/></svg>'
    const url = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg)
    imgs.forEach((i) => { i.src = url })
    return imgs.length
  })()`)
  await sleep(340)
  const phoCoverCells = await evaluate(`(() => {
    const card = [...document.querySelectorAll('[data-testid="photos-album-card"]')].find((c) => c.textContent.includes('相簿示例'))
    const imgs = [...card.querySelectorAll('.pui-pho__album-cover img')]
    const round = (n) => Math.round(n * 100) / 100
    const cells = imgs.map((i) => {
      const r = i.getBoundingClientRect()
      return [round(r.width), round(r.height)]
    })
    imgs.forEach((i, k) => {
      if (window.__coverPrev && window.__coverPrev[k]) i.setAttribute('src', window.__coverPrev[k])
    })
    return cells
  })()`)
  record(
    " 相簿：3:4 竖图下封面每格仍是正方形（行高不被图片比例撑开）",
    phoCoverCells.length === 3 &&
      phoCoverCells[0][1] > phoCoverCells[0][0] * 1.9 &&
      phoCoverCells.slice(1).every(([w, h]) => Math.abs(w - h) < 0.8),
    phoCoverCells.map(([w, h]) => `${w}×${h}`).join(' / '),
  )
  record(
    " 相簿：最近删除即使为空也有入口",
    await evaluate(`Boolean(document.querySelector('[data-testid="photos-trash-row"]'))`),
  )

  // 相簿详情：保持相簿里的顺序，张数与卡片一致
  await evaluate(
    `[...document.querySelectorAll('[data-testid="photos-album-card"]')].find((b) => b.textContent.includes('相簿示例')).click()`,
  )
  await waitFor(
    `Boolean(document.querySelector('[data-testid="photos-album-screen"]'))`,
    '相簿详情',
  )
  await sleep(260)
  const phoAlbum = await evaluate(`(() => ({
    tiles: document.querySelectorAll('[data-testid="photos-album-grid"] [data-testid="photos-tile"]').length,
    title: document.querySelector('.pui-pho__nav-title')?.textContent?.trim() ?? '',
  }))()`)
  record(
    " 相簿详情：标题 + 3 张照片",
    phoAlbum.tiles === 3 && phoAlbum.title === '相簿示例',
    `${phoAlbum.title} · ${phoAlbum.tiles} 张`,
  )

  await evaluate(`document.querySelector('[data-testid="nav-back"]').click()`)
  await waitFor(
    `Boolean(document.querySelector('[data-testid="photos-albums-screen"]'))`,
    '返回相簿',
  )
  record(" 相簿详情 → 返回相簿（路径可逆）", true)
  await sleep(260)

  // 「最近删除」是常驻入口：空的时候也必须能点开，且给的是它专属的空态
  await evaluate(`document.querySelector('[data-testid="photos-trash-row"]').click()`)
  await waitFor(
    `Boolean(document.querySelector('[data-testid="photos-album-screen"]'))`,
    '最近删除详情',
  )
  await sleep(260)
  const phoTrash = await evaluate(`(() => {
    const screen = document.querySelector('[data-testid="photos-album-screen"]')
    return {
      title: screen?.querySelector('.pui-pho__nav-title')?.textContent?.trim() ?? '',
      empty: screen?.querySelector('[data-testid="empty-state"]')?.textContent?.trim() ?? '',
      tiles: screen?.querySelectorAll('[data-testid="photos-tile"]').length ?? 0,
    }
  })()`)
  record(
    " 相簿：最近删除入口可点开且展示示例图片",
    phoTrash.title === '最近删除' && phoTrash.tiles === 1,
    `${phoTrash.title} · ${phoTrash.empty}`,
  )
  await evaluate(`document.querySelector('[data-testid="nav-back"]').click()`)
  await waitFor(
    `Boolean(document.querySelector('[data-testid="photos-albums-screen"]'))`,
    '从最近删除返回相簿',
  )
  await sleep(260)

  // 「已隐藏」是常驻入口：空的时候也必须能点开，且给的是它专属的空态
  await evaluate(`document.querySelector('[data-testid="photos-hidden-row"]').click()`)
  await waitFor(
    `Boolean(document.querySelector('[data-testid="photos-album-screen"]'))`,
    '已隐藏详情',
  )
  await sleep(260)
  const phoHidden = await evaluate(`(() => {
    const screen = document.querySelector('[data-testid="photos-album-screen"]')
    return {
      title: screen?.querySelector('.pui-pho__nav-title')?.textContent?.trim() ?? '',
      empty: screen?.querySelector('[data-testid="empty-state"]')?.textContent?.trim() ?? '',
      tiles: screen?.querySelectorAll('[data-testid="photos-tile"]').length ?? 0,
    }
  })()`)
  record(
    " 相簿：已隐藏入口可点开且展示示例图片",
    phoHidden.title === '已隐藏' && phoHidden.tiles === 1,
    `${phoHidden.title} · ${phoHidden.empty}`,
  )
  await evaluate(`document.querySelector('[data-testid="nav-back"]').click()`)
  await waitFor(
    `Boolean(document.querySelector('[data-testid="photos-albums-screen"]'))`,
    '从已隐藏返回相簿',
  )
  await sleep(260)

  await evaluate(`document.querySelector('[data-testid="photos-title"]').click()`)
  let phoHomeOk = true
  try {
    await waitFor(
      `Boolean(document.querySelector('[data-testid="home-screen"]'))`,
      '照片回桌面',
      3000,
    )
  } catch {
    phoHomeOk = false
  }
  record(" 点页面标题回桌面（照片）", phoHomeOk)

  // ══════════════ 场景 1b：信息（chat 模式的第二个应用） ══════════════
  // 用 msgs 夹具而非 base：日期分隔与时间间隔都以自然日为界，
  // 示例数据是"相对现在"的时间戳，凌晨与傍晚跑出来的分组不一样。
  await open('msgs')
  await evaluate(`document.querySelector('[data-testid="lock-hint"]').click()`)
  await waitFor(`Boolean(document.querySelector('[data-testid="home-screen"]'))`, '信息场景桌面')
  await evaluate(`document.querySelector('[data-testid="home-dock-messages"]').click()`)
  await waitFor(`Boolean(document.querySelector('[data-testid="msg-list-screen"]'))`, '信息列表')

  const msgList = await evaluate(`(() => {
    const cells = [...document.querySelectorAll('[data-testid="msg-conversation-item"]')]
    const titleNode = document.querySelector('[data-testid="msg-list-title"]')
    const titleStyle = titleNode ? getComputedStyle(titleNode) : null
    return {
      rows: cells.length,
      name: cells[0]?.querySelector('.pui-msg__cell-name')?.textContent?.trim() ?? '',
      preview: cells[0]?.querySelector('.pui-msg__cell-preview')?.textContent?.trim() ?? '',
      title: titleNode?.textContent?.trim() ?? '',
      hasEdit: Boolean(document.querySelector('[data-testid="msg-list-edit"]')),
      hasFilter: Boolean(document.querySelector('[data-testid="msg-list-filter"]')),
      hasSearchMic: Boolean(document.querySelector('.pui-msg__search-mic')),
      titleAlign: titleStyle?.textAlign ?? '',
      titleSize: titleStyle?.fontSize ?? '',
    }
  })()`)
  record(
    " 信息：会话列表 1 行，标题取对方名字 + 最新一条预览",
    msgList.rows === 1 &&
      msgList.name === '演示人物 B' &&
      msgList.preview === '已经凉了' &&
      msgList.title === '信息',
    `${msgList.rows} 行 · ${msgList.name} · ${msgList.preview}`,
  )
  record(
    " 信息：列表顶栏三段（编辑 / 居中标题 / 筛选），搜索栏带麦克风",
    msgList.hasEdit &&
      msgList.hasFilter &&
      msgList.hasSearchMic &&
      msgList.titleAlign === 'center' &&
      msgList.titleSize === '17px',
    `编辑 ${msgList.hasEdit} · 筛选 ${msgList.hasFilter} · 麦克风 ${msgList.hasSearchMic} · ${msgList.titleAlign}/${msgList.titleSize}`,
  )

  await evaluate(`document.querySelector('[data-testid="msg-conversation-item"]').click()`)
  await waitFor(`Boolean(document.querySelector('[data-testid="msg-thread-screen"]'))`, '信息详情')
  await sleep(240)

  const msgThread = await evaluate(`(() => {
    const bubbles = [...document.querySelectorAll('[data-testid="msg-bubble"]')]
    const right = bubbles.filter((b) => b.closest('[data-side="right"]'))
    const left = bubbles.filter((b) => b.closest('[data-side="left"]'))
    const rs = right[0] ? getComputedStyle(right[0]) : null
    const ls = left[0] ? getComputedStyle(left[0]) : null
    return {
      bubbles: bubbles.length,
      right: right.length,
      left: left.length,
      rightBg: rs?.backgroundColor ?? '',
      rightColor: rs?.color ?? '',
      leftBg: ls?.backgroundColor ?? '',
      leftColor: ls?.color ?? '',
      dividers: [...document.querySelectorAll('.pui-msg__divider')].map((n) => n.textContent.trim()),
      gaps: [...document.querySelectorAll('.pui-msg__timegap')].map((n) => n.textContent.trim()),
      readLabels: [...document.querySelectorAll('[data-testid="msg-read"]')].map((n) => n.textContent.trim()),
      hasPill: Boolean(document.querySelector('.pui-msg__peer-pill')),
      hasCall: Boolean(document.querySelector('.pui-msg__call')),
      hasSpacer: Boolean(document.querySelector('.pui-msg__thread-spacer')),
      backRadius: document.querySelector('[data-testid="nav-back"]')
        ? getComputedStyle(document.querySelector('[data-testid="nav-back"]')).borderRadius
        : '',
      chatbarPos: document.querySelector('.pui-msg__chatbar')
        ? getComputedStyle(document.querySelector('.pui-msg__chatbar')).position
        : '',
      chatbarShadow: document.querySelector('.pui-msg__chatbar')
        ? getComputedStyle(document.querySelector('.pui-msg__chatbar')).boxShadow
        : '',
      /* 用 offsetWidth 而不是 getBoundingClientRect：后者会被手机外框的
         scale 变换乘掉（0.85 左右），量出来是 39 而不是 46 */
      peerAvatar: document.querySelector('.pui-msg__peer .pui-avatar')?.offsetWidth ?? 0,
      peerNameSize: document.querySelector('.pui-msg__peer-name')
        ? getComputedStyle(document.querySelector('.pui-msg__peer-name')).fontSize
        : '',
    }
  })()`)

  /*
   * 顶栏**不许有分隔线**。第一版在 .pui-msg__chatbar 上留了 0.5px 的
   * box-shadow，白底上就是一条凭空出现的横线。这条断言锁住"没有任何阴影"，
   * 因为阴影是唯一会在白底上表现为横线的东西（border 同理，一并排除）。
   */
  record(
    " 信息：顶栏无分隔线（白底上不该出现一条横线）",
    msgThread.chatbarShadow === 'none' || msgThread.chatbarShadow === '',
    `box-shadow=${msgThread.chatbarShadow || 'none'}`,
  )

  record(
    " 信息：顶栏身份区尺寸对齐参考图（46px 头像 / 17px 名字）",
    msgThread.peerAvatar === 46 && msgThread.peerNameSize === '17px',
    `头像 ${msgThread.peerAvatar}px · 名字 ${msgThread.peerNameSize}`,
  )

  record(
    " 信息：6 条气泡，我方 2 / 对方 4",
    msgThread.bubbles === 6 && msgThread.right === 2 && msgThread.left === 4,
    `${msgThread.bubbles} 条（右 ${msgThread.right} / 左 ${msgThread.left}）`,
  )
  record(
    " 信息：跨天拆出「昨天」「今天」两个日期分隔",
    msgThread.dividers.length === 2 &&
      msgThread.dividers[0] === '昨天' &&
      msgThread.dividers[1] === '今天',
    msgThread.dividers.join(' / ') || '无',
  )
  record(
    " 信息：只在间隔 74 分钟处补一条居中时间（其余不打）",
    msgThread.gaps.length === 1 && msgThread.gaps[0] === '10:23',
    msgThread.gaps.join(' / ') || '无',
  )
  record(
    " 信息：我方蓝底白字 / 对方灰底黑字",
    msgThread.rightBg === 'rgb(10, 132, 255)' &&
      msgThread.rightColor === 'rgb(255, 255, 255)' &&
      msgThread.leftBg === 'rgb(233, 233, 235)' &&
      msgThread.leftColor === 'rgb(0, 0, 0)',
    `我 ${msgThread.rightBg}/${msgThread.rightColor} · 对方 ${msgThread.leftBg}/${msgThread.leftColor}`,
  )
  record(
    " 信息：顶栏悬浮（绝对定位 + 胶囊返回 + 名字胶囊 + 通话按钮 + 滚动占位）",
    msgThread.chatbarPos === 'absolute' &&
      msgThread.backRadius === '14px' &&
      msgThread.hasPill &&
      msgThread.hasCall &&
      msgThread.hasSpacer,
    `position=${msgThread.chatbarPos} · 返回圆角=${msgThread.backRadius} · 胶囊=${msgThread.hasPill} · 通话=${msgThread.hasCall} · 占位=${msgThread.hasSpacer}`,
  )
  record(
    " 信息：已读回执只挂一条，格式为「时刻 已读」",
    msgThread.readLabels.length === 1 && /^\d{1,2}:\d{2} 已读$/.test(msgThread.readLabels[0] ?? ''),
    msgThread.readLabels.join(' / ') || '无',
  )

  await evaluate(`document.querySelector('[data-testid="nav-back"]').click()`)
  await waitFor(`Boolean(document.querySelector('[data-testid="msg-list-screen"]'))`, '返回信息列表')
  record(" 信息：详情 → 列表可逆", true)

  await evaluate(`document.querySelector('[data-testid="msg-list-title"]').click()`)
  let msgHomeOk = true
  try {
    await waitFor(
      `Boolean(document.querySelector('[data-testid="home-screen"]'))`,
      '信息回桌面',
      3000,
    )
  } catch {
    msgHomeOk = false
  }
  record(" 点页面标题回桌面（信息）", msgHomeOk)

  // ══════════════ 场景 1b-2：信息里的图片消息 ══════════════
  await open('msgsImage')
  await evaluate(`document.querySelector('[data-testid="lock-hint"]').click()`)
  await waitFor(`Boolean(document.querySelector('[data-testid="home-screen"]'))`, '图片消息场景桌面')
  await evaluate(`document.querySelector('[data-testid="home-dock-messages"]').click()`)
  await waitFor(`Boolean(document.querySelector('[data-testid="msg-list-screen"]'))`, '图片消息列表')
  await evaluate(`document.querySelector('[data-testid="msg-conversation-item"]').click()`)
  await waitFor(`Boolean(document.querySelector('[data-testid="msg-thread-screen"]'))`, '图片消息详情')
  // dataURL 解码是异步的：不等会量到 naturalWidth = 0
  await sleep(260)

  const msgImg = await evaluate(`(() => {
    const bubble = document.querySelector('[data-testid="msg-bubble"][data-type="image"]')
    if (!bubble) return { found: false }
    const imgs = [...bubble.querySelectorAll('img')]
    const style = getComputedStyle(bubble)
    return {
      found: true,
      imgs: imgs.length,
      decoded: imgs.filter((i) => i.naturalWidth > 0 && i.naturalHeight > 0).length,
      text: bubble.textContent.trim(),
      padding: style.paddingTop,
      background: style.backgroundColor,
      count: bubble.querySelector('.pui-msg__images')?.getAttribute('data-count') ?? '',
    }
  })()`)
  record(
    " 信息图片消息：渲染真实 <img>（2 张全解码），不再是「[图片]」占位",
    msgImg.found &&
      msgImg.imgs === 2 &&
      msgImg.decoded === 2 &&
      msgImg.count === '2' &&
      !msgImg.text.includes('[图片]'),
    msgImg.found
      ? `${msgImg.imgs} 张 · 解码 ${msgImg.decoded} 张 · 文本「${msgImg.text}」`
      : '没找到图片气泡',
  )
  record(
    " 信息图片消息：气泡去底色去内边距（图本身就是气泡）",
    msgImg.found &&
      msgImg.padding === '0px' &&
      (msgImg.background === 'rgba(0, 0, 0, 0)' || msgImg.background === 'transparent'),
    `padding=${msgImg.padding} bg=${msgImg.background}`,
  )

  // 我方那条单独量：`.pui-msg__row[data-side='right'] .pui-msg__bubble` 的蓝底
  // 比图片规则更"重"，会把背景重新盖回来。气泡比图片大出来的那几像素，
  // 就是在四角露出的蓝色月牙 —— 远看像照片被描了蓝边、圆角也像变尖了
  const msgOwnImage = await evaluate(`(() => {
    const bubble = [...document.querySelectorAll('[data-testid="msg-bubble"][data-type="image"]')]
      .find((b) => b.closest('.pui-msg__row')?.dataset.side === 'right')
    if (!bubble) return null
    const cs = getComputedStyle(bubble)
    const img = bubble.querySelector('.pui-msg__image')
    if (!img) return null
    const b = bubble.getBoundingClientRect()
    const i = img.getBoundingClientRect()
    return {
      bg: cs.backgroundColor,
      padding: cs.paddingTop,
      radius: cs.borderRadius,
      imgRadius: getComputedStyle(img).borderRadius,
      // 图与气泡必须严丝合缝：差 1px 以上就说明气泡还垫在图片外面
      wDiff: Math.round(b.width - i.width),
      hDiff: Math.round(b.height - i.height),
    }
  })()`)
  record(
    " 信息我方图片：气泡透明无底无圆角，图片刚好填满（四角不透蓝、圆角只由图片自己画）",
    msgOwnImage !== null &&
      (msgOwnImage.bg === 'rgba(0, 0, 0, 0)' || msgOwnImage.bg === 'transparent') &&
      msgOwnImage.padding === '0px' &&
      msgOwnImage.radius === '0px' &&
      msgOwnImage.imgRadius === '14px' &&
      Math.abs(msgOwnImage.wDiff) <= 1 &&
      Math.abs(msgOwnImage.hDiff) <= 1,
    msgOwnImage
      ? `bg=${msgOwnImage.bg} padding=${msgOwnImage.padding} r=${msgOwnImage.radius} 图 r=${msgOwnImage.imgRadius} · 气泡−图 ${msgOwnImage.wDiff}×${msgOwnImage.hDiff}px`
      : '没找到我方图片气泡',
  )

  const msgAlbum9 = await evaluate(`(() => {
    const box = document.querySelector('.pui-msg__images[data-count="9"]')
    if (!box) return null
    const tiles = [...box.querySelectorAll('.pui-msg__tile')]
    return {
      cols: Number(box.dataset.cols),
      n: tiles.length,
      sizes: tiles.map((t) => [t.offsetWidth, t.offsetHeight]),
      radius: getComputedStyle(box).borderRadius,
      tileRadius: getComputedStyle(tiles[0]).borderRadius,
      gap: getComputedStyle(box).rowGap,
    }
  })()`)
  record(
    " 信息 9 张图：3×3 九宫格，整块只有一个圆角矩形（与 KakaoTalk 同一套规则）",
    msgAlbum9?.cols === 3 &&
      msgAlbum9.n === 9 &&
      msgAlbum9.sizes.every(([w, h]) => Math.abs(w - h) <= 1) &&
      oneRounded(msgAlbum9),
    msgAlbum9
      ? `${msgAlbum9.cols} 列 ${msgAlbum9.n} 格 · 首格 ${msgAlbum9.sizes[0].join('×')} · 外框 r=${msgAlbum9.radius} · 格子 r=${msgAlbum9.tileRadius}`
      : '没找到九宫格',
  )

  // ── 信息图片查看器：白底全屏（iOS 照片 / 信息风格，区别于 KakaoTalk 黑底） ──
  const openMsgImage = async (selector, label) => {
    await evaluate(`document.querySelector('${selector}').click()`)
    await waitFor(`Boolean(document.querySelector('[data-testid="msg-media-viewer"]'))`, label)
    await sleep(260)
  }
  const msgViewerState = () =>
    evaluate(`(() => {
      const v = document.querySelector('[data-testid="msg-media-viewer"]')
      if (!v) return null
      const img = document.querySelector('[data-testid="msg-viewer-image"]')
      const root = document.querySelector('.pui-msg')
      const on = document.querySelector('.pui-msg__viewer-thumb--on')
      const strip = document.querySelector('.pui-msg__viewer-strip')
      const stage = document.querySelector('.pui-msg__viewer-stage')
      let shift = -1
      if (strip && stage) {
        const sr = strip.getBoundingClientRect()
        const gr = stage.getBoundingClientRect()
        if (gr.width) shift = Math.round((Math.abs(sr.left - gr.left) / gr.width) * 100) / 100
      }
      return {
        bg: getComputedStyle(v).backgroundColor,
        w: v.offsetWidth,
        h: v.offsetHeight,
        rootW: root.offsetWidth,
        rootH: root.offsetHeight,
        decoded: img ? img.naturalWidth : 0,
        fit: img ? getComputedStyle(img).objectFit : '',
        src: img ? img.getAttribute('src') : '',
        shift,
        count: document.querySelector('[data-testid="msg-viewer-count"]')?.textContent.trim() ?? '',
        thumbs: document.querySelectorAll('[data-testid^="msg-viewer-thumb-"]').length,
        onLabel: on ? on.getAttribute('aria-label') : '',
        name: document.querySelector('[data-testid="msg-viewer-name"]')?.textContent.trim() ?? '',
        stamp: document.querySelector('.pui-msg__viewer-stamp')?.textContent.trim() ?? '',
      }
    })()`)

  await openMsgImage('.pui-msg__images[data-count="1"] .pui-msg__tile', '信息单图查看器')
  const msgViewSingle = await msgViewerState()
  record(
    " 信息点开单图 = 全屏白底查看器（铺满屏幕、按比例 contain、不摆缩略图条）",
    msgViewSingle?.decoded > 0 &&
      /rgb\(255,\s*255,\s*255\)/.test(msgViewSingle.bg) &&
      msgViewSingle.w === msgViewSingle.rootW &&
      msgViewSingle.h === msgViewSingle.rootH &&
      msgViewSingle.fit === 'contain' &&
      msgViewSingle.thumbs === 0 &&
      msgViewSingle.count === '' &&
      msgViewSingle.name.length > 0 &&
      /^\d{4}\. \d{1,2}\. \d{1,2}\./.test(msgViewSingle.stamp),
    `浮层 ${msgViewSingle?.w}×${msgViewSingle?.h}（屏 ${msgViewSingle?.rootW}×${msgViewSingle?.rootH}）· bg=${msgViewSingle?.bg} · fit=${msgViewSingle?.fit} · 缩略图 ${msgViewSingle?.thumbs} 条 · 顶栏「${msgViewSingle?.name} / ${msgViewSingle?.stamp}」`,
  )

  await evaluate(`document.querySelector('[data-testid="msg-viewer-close"]').click()`)
  await waitFor(`!document.querySelector('[data-testid="msg-media-viewer"]')`, '关闭信息单图查看器')
  record(
    " 信息：关掉查看器回到会话（浮层移除、会话屏还在）",
    (await evaluate(
      `!document.querySelector('[data-testid="msg-media-viewer"]') && Boolean(document.querySelector('[data-testid="msg-thread-screen"]'))`,
    )) === true,
  )

  await openMsgImage('.pui-msg__images[data-count="9"] .pui-msg__tile', '信息九图查看器')
  const msgViewMulti = await msgViewerState()
  record(
    " 信息点开多图：缩略图 9 张 + 「第 1 张，共 9 张」+ 当前张有描边",
    msgViewMulti?.thumbs === 9 &&
      msgViewMulti.count === '第 1 张，共 9 张' &&
      msgViewMulti.onLabel === '第 1 张',
    `${msgViewMulti?.thumbs} 张缩略图 · 计数「${msgViewMulti?.count}」· 高亮「${msgViewMulti?.onLabel}」`,
  )

  await evaluate(`document.querySelector('[data-testid="msg-viewer-thumb-2"]').click()`)
  await sleep(260)
  const msgViewSwitched = await msgViewerState()
  // 不比 src：这个 fixture 的九宫格是同一张图重复 9 次，src 天然一样。
  // 判断"切到了第 3 张"靠计数与高亮，那是与数据下标绑定的
  record(
    " 信息：点第 3 张缩略图：计数与高亮跟着换",
    msgViewSwitched?.count === '第 3 张，共 9 张' && msgViewSwitched.onLabel === '第 3 张',
    `计数「${msgViewSwitched?.count}」· 高亮「${msgViewSwitched?.onLabel}」`,
  )

  // 左右滑动翻页：拖 120px 松手（阈值是屏宽 1/5 且 ≤60px），走的是 stage 上的合成 pointer
  const swipeMsgViewer = async (dx) => {
    await evaluate(`(() => {
      const el = document.querySelector('.pui-msg__viewer-stage')
      const r = el.getBoundingClientRect()
      const x = r.left + r.width / 2
      const y = r.top + r.height / 2
      const mk = (type, cx) => new PointerEvent(type, {
        clientX: cx, clientY: y, bubbles: true, cancelable: true,
        pointerId: 1, pointerType: 'touch', isPrimary: true,
        button: 0, buttons: type === 'pointerup' ? 0 : 1,
      })
      el.dispatchEvent(mk('pointerdown', x))
      el.dispatchEvent(mk('pointermove', x + ${dx}))
      el.dispatchEvent(mk('pointerup', x + ${dx}))
      return true
    })()`)
    await sleep(360)
    return msgViewerState()
  }

  // 当前停在第 3 张（下标 2）：左滑 → 下标 3
  const msgViewNext = await swipeMsgViewer(-120)
  record(
    " 信息多图查看器左滑 → 翻到下一张（画面移一屏、计数与高亮同步）",
    msgViewNext?.shift === 3 && msgViewNext.count === '第 4 张，共 9 张' && msgViewNext.onLabel === '第 4 张',
    `位移 ${msgViewNext?.shift} 屏 · 计数「${msgViewNext?.count}」· 高亮「${msgViewNext?.onLabel}」`,
  )

  // 跳到最后一张（下标 8）再左滑：应该纹丝不动（不越界、不出现空白页）
  await evaluate(`document.querySelector('[data-testid="msg-viewer-thumb-8"]').click()`)
  await sleep(260)
  const msgViewLast = await msgViewerState()
  const msgViewEdge = await swipeMsgViewer(-120)
  record(
    " 信息：最后一张再左滑不越界（停在原位，不出空白页）",
    msgViewLast?.count === '第 9 张，共 9 张' &&
      msgViewEdge?.shift === 8 &&
      msgViewEdge.count === '第 9 张，共 9 张',
    `末张「${msgViewLast?.count}」· 位移 ${msgViewEdge?.shift} 屏 · 计数「${msgViewEdge?.count}」`,
  )

  const msgViewPrev = await swipeMsgViewer(120)
  record(
    " 信息：右滑 → 翻回上一张",
    msgViewPrev?.shift === 7 && msgViewPrev.count === '第 8 张，共 9 张' && msgViewPrev.onLabel === '第 8 张',
    `位移 ${msgViewPrev?.shift} 屏 · 计数「${msgViewPrev?.count}」· 高亮「${msgViewPrev?.onLabel}」`,
  )

  // 竖向拖拽不该被算成翻页（否则上下想退出时会误翻）
  const msgViewVertical = await evaluate(`(() => {
    const el = document.querySelector('.pui-msg__viewer-stage')
    const r = el.getBoundingClientRect()
    const x = r.left + r.width / 2
    const y = r.top + r.height / 2
    const mk = (type, cy) => new PointerEvent(type, {
      clientX: x, clientY: cy, bubbles: true, cancelable: true,
      pointerId: 1, pointerType: 'touch', isPrimary: true,
      button: 0, buttons: type === 'pointerup' ? 0 : 1,
    })
    el.dispatchEvent(mk('pointerdown', y))
    el.dispatchEvent(mk('pointermove', y + 130))
    el.dispatchEvent(mk('pointerup', y + 130))
    return true
  })()`)
  await sleep(360)
  const msgViewStill = await msgViewerState()
  record(
    " 信息：竖向手势不算翻页（只认横滑）",
    msgViewVertical === true && msgViewStill?.shift === 7 && msgViewStill.count === '第 8 张，共 9 张',
    `位移 ${msgViewStill?.shift} 屏 · 计数「${msgViewStill?.count}」`,
  )

  await evaluate(`document.querySelector('[data-testid="msg-viewer-close"]').click()`)
  await waitFor(`!document.querySelector('[data-testid="msg-media-viewer"]')`, '关闭信息多图查看器')

  // ══════════════ 场景 1b-3：KakaoTalk 的连发分组 / 我方贴边 / 单图比例 ══════════════
  await open('ktLayout')
  await evaluate(`document.querySelector('[data-testid="lock-hint"]').click()`)
  await waitFor(`Boolean(document.querySelector('[data-testid="home-screen"]'))`, 'KakaoTalk 版式场景桌面')
  await evaluate(`document.querySelector('[data-testid="home-dock-kakaotalk"]').click()`)
  await waitFor(`Boolean(document.querySelector('[data-testid="kt-list-screen"]'))`, 'KakaoTalk 版式列表')
  await evaluate(`document.querySelector('[data-testid="kt-tab-chats"]').click()`)
  await evaluate(`document.querySelector('[data-testid="kt-conversation-item"]').click()`)
  await waitFor(`Boolean(document.querySelector('[data-testid="kt-thread-screen"]'))`, 'KakaoTalk 版式详情')
  await sleep(260)

  const ktLayout = await evaluate(`(() => {
    const rows = [...document.querySelectorAll('.pui-kt__row')]
    const screen = document.querySelector('[data-testid="kt-thread-screen"]').getBoundingClientRect()
    const ownBubbles = rows
      .filter((r) => r.dataset.side === 'right')
      .map((r) => r.querySelector('[data-testid="kt-bubble"]').getBoundingClientRect())
    const bubbleRight = ownBubbles.length ? Math.max(...ownBubbles.map((b) => b.right)) : -1
    const img = document.querySelector('.pui-kt__images[data-count="1"] .pui-kt__image')
    const albumOf = (n) => {
      const box = document.querySelector('.pui-kt__images[data-count="' + n + '"]')
      if (!box) return null
      const tiles = [...box.querySelectorAll('.pui-kt__tile')]
      return {
        cols: Number(box.dataset.cols),
        w: box.offsetWidth,
        h: box.offsetHeight,
        tiles: tiles.map((t) => [t.offsetWidth, t.offsetHeight]),
        // 圆角必须长在外框上、格子是直角 —— 否则就变成几块各自圆角的小方图
        radius: getComputedStyle(box).borderRadius,
        tileRadius: getComputedStyle(tiles[0] ?? box).borderRadius,
        gap: getComputedStyle(box).rowGap,
      }
    }
    // 昵称：与头像同在组首，所以它们必须同频出现；位置在气泡**上方**
    const nameEls = [...document.querySelectorAll('[data-testid="kt-author-name"]')]
    const firstRow = nameEls[0]?.closest('.pui-kt__row') ?? null
    const firstAv = firstRow?.querySelector('.pui-kt__avatar-slot .pui-avatar') ?? null
    const firstBubble = firstRow?.querySelector('[data-testid="kt-bubble"]') ?? null
    const nBox = nameEls[0]?.getBoundingClientRect() ?? null
    const aBox = firstAv?.getBoundingClientRect() ?? null
    const bBox = firstBubble?.getBoundingClientRect() ?? null
    // 昵称的**墨迹**底边：name 盒子含行高留白，用它量不出真正的空档
    const nRange = nameEls[0] ? document.createRange() : null
    if (nRange) nRange.selectNodeContents(nameEls[0])
    const nInk = nRange ? nRange.getBoundingClientRect() : null

    return {
      rows: rows.length,
      avatars: document.querySelectorAll('.pui-kt__avatar-slot .pui-avatar').length,
      names: nameEls.length,
      nameTexts: nameEls.map((n) => n.textContent.trim()),
      // 同一行内的相对差值：外壳缩放对三者一致，不影响判定
      nameAboveBubble: nBox && bBox ? Math.round(bBox.top - nBox.bottom) : null,
      // 墨迹到气泡顶：用户在截图里圈出来的就是这个空档
      nameInkAboveBubble: nInk && bBox ? Math.round((bBox.top - nInk.bottom) * 10) / 10 : null,
      nameLeftOfBubble: nBox && bBox ? Math.round(nBox.left - bBox.left) : null,
      // 昵称与头像**同一行**：顶边齐平、名字落在头像右侧 —— 上一版名字被 36px
      // 的上边距推到头像下沿，头像悬空挂在名字左上方，这一对差值就是那次的判据
      nameTopVsAvatar: nBox && aBox ? Math.round(nBox.top - aBox.top) : null,
      nameOfAvatarGap: nBox && aBox ? Math.round(nBox.left - aBox.right) : null,
      // 气泡顶相对头像顶：KakaoTalk 里昵称底下一两个像素就是气泡，
      // 所以气泡顶落在头像的中线附近（头像下沿压在气泡左侧，不是骑着气泡）
      bubbleTopVsAvatar: bBox && aBox ? Math.round(bBox.top - aBox.top) : null,
      ownSlots: document.querySelectorAll('[data-side="right"] .pui-kt__avatar-slot').length,
      times: document.querySelectorAll('.pui-kt__time').length,
      rightGap: bubbleRight < 0 ? -1 : Math.round(screen.right - bubbleRight),
      // 布局尺寸用 offsetWidth：getBoundingClientRect 会把外壳的缩放一起算进去
      imgW: img ? img.offsetWidth : 0,
      imgH: img ? img.offsetHeight : 0,
      natural: img ? [img.naturalWidth, img.naturalHeight] : [],
      album2: albumOf(2),
      album3: albumOf(3),
      album4: albumOf(4),
      album9: albumOf(9),
    }
  })()`)

  // 11 条消息分成 5 组；其中 2 组是我方（所属人不画头像，本来就没有头像格），
  // 所以头像 3 个、时间 5 个 —— 时间不比组多，才是"组内只显示一次"
  record(
    " KakaoTalk 连发分组：组内只显示一个头像、一个时间",
    ktLayout.rows === 11 && ktLayout.avatars === 3 && ktLayout.times === 5,
    `${ktLayout.rows} 条 → ${ktLayout.avatars} 个头像 / ${ktLayout.times} 个时间`,
  )
  record(
    " KakaoTalk 我方消息不留头像位（气泡贴右边缘）",
    ktLayout.ownSlots === 0 && ktLayout.rightGap >= 0 && ktLayout.rightGap <= 16,
    `右侧头像位 ${ktLayout.ownSlots} 个 · 气泡距右边缘 ${ktLayout.rightGap}px`,
  )
  record(
    " KakaoTalk 对方昵称与组首头像**同一行**（顶对齐、落在头像右侧），同人连发只写一次",
    ktLayout.names === ktLayout.avatars
      && ktLayout.avatars > 1
      && ktLayout.nameTexts.every((t) => t.length > 0)
      && Math.abs(ktLayout.nameTopVsAvatar) <= 4
      && ktLayout.nameOfAvatarGap >= 4
      && ktLayout.nameOfAvatarGap <= 14
      && ktLayout.nameAboveBubble >= 0
      && ktLayout.nameInkAboveBubble >= 0
      && ktLayout.nameInkAboveBubble <= 8
      && ktLayout.nameLeftOfBubble <= 2,
    `${ktLayout.avatars} 个头像 / ${ktLayout.names} 个昵称（${ktLayout.nameTexts.join('、')}）· 名字顶−头像顶 ${ktLayout.nameTopVsAvatar}px · 距头像右缘 ${ktLayout.nameOfAvatarGap}px · 名字墨迹底距气泡顶 ${ktLayout.nameInkAboveBubble}px`,
  )
  record(
    " KakaoTalk 组首气泡紧接昵称下方（气泡顶落在头像中线附近，头像下沿压过气泡顶）",
    ktLayout.bubbleTopVsAvatar !== null
      && ktLayout.bubbleTopVsAvatar >= 12
      && ktLayout.bubbleTopVsAvatar <= 26,
    `气泡顶距头像顶 ${ktLayout.bubbleTopVsAvatar}px`,
  )
  record(
    " KakaoTalk 单图：只限宽、按原比例缩放（600×800 不被压扁）",
    ktLayout.imgW === 200 && Math.abs(ktLayout.imgW / ktLayout.imgH - 0.75) < 0.02,
    `${ktLayout.imgW}×${ktLayout.imgH}（原始 ${ktLayout.natural.join('×')}）`,
  )
  const square = (t) => Array.isArray(t) && Math.abs(t[0] - t[1]) <= 1
  const albumSquare = (a) => Boolean(a) && Math.abs(a.w - a.h) <= 1

  function oneRounded(a) {
    return Boolean(a) && a.radius !== '0px' && a.tileRadius === '0px' && parseFloat(a.gap) <= 1
  }
  record(
    " KakaoTalk 多图：整块只有一个圆角矩形（外框圆角 / 格子直角 / 1px 缝隙）",
    ktLayout.album3?.tiles.length === 3 &&
      ktLayout.album3.tiles.every(square) &&
      ktLayout.album3.tiles[0][0] >= 80 &&
      oneRounded(ktLayout.album3),
    `${ktLayout.album3?.tiles.map(([w, h]) => `${w}×${h}`).join(' / ')} · 外框 r=${ktLayout.album3?.radius} · 格子 r=${ktLayout.album3?.tileRadius} · gap=${ktLayout.album3?.gap}`,
  )
  record(
    " KakaoTalk 4 张图：排成 2×2，整体是正方形（对应参考图的四宫格）",
    ktLayout.album4?.cols === 2 && ktLayout.album4.tiles.every(square) && albumSquare(ktLayout.album4),
    `${ktLayout.album4?.cols} 列 · 整块 ${ktLayout.album4?.w}×${ktLayout.album4?.h}`,
  )
  record(
    " KakaoTalk 9 张图：3×3 九宫格，整体也是正方形",
    ktLayout.album9?.cols === 3 &&
      ktLayout.album9.tiles.length === 9 &&
      ktLayout.album9.tiles.every(square) &&
      albumSquare(ktLayout.album9),
    `${ktLayout.album9?.cols} 列 ${ktLayout.album9?.tiles.length} 格 · 整块 ${ktLayout.album9?.w}×${ktLayout.album9?.h}`,
  )
  record(
    " KakaoTalk 2 张图：两列并排（不长成一条窄条）",
    ktLayout.album2?.cols === 2 && ktLayout.album2.tiles.length === 2 && ktLayout.album2.tiles.every(square),
    `${ktLayout.album2?.cols} 列 · ${ktLayout.album2?.tiles.map(([w, h]) => `${w}×${h}`).join(' / ')}`,
  )

  // ── 图片查看器：单图直接看大图；多图给缩略图条 + 「第 N 张，共 M 张」 ──
  const openImage = async (selector, label) => {
    await evaluate(`document.querySelector('${selector}').click()`)
    await waitFor(`Boolean(document.querySelector('[data-testid="kt-media-viewer"]'))`, label)
    await sleep(260)
  }
  const viewerState = () =>
    evaluate(`(() => {
      const v = document.querySelector('[data-testid="kt-media-viewer"]')
      if (!v) return null
      const img = document.querySelector('[data-testid="kt-viewer-image"]')
      const root = document.querySelector('.pui-kt')
      const on = document.querySelector('.pui-kt__viewer-thumb--on')
      // 翻页看的是"画面真的移了几屏"：拿 strip 相对 stage 的横向位移除以屏宽。
      // 读 style 字符串只是读声明，量位置才是量用户看到的
      const strip = document.querySelector('.pui-kt__viewer-strip')
      const stage = document.querySelector('.pui-kt__viewer-stage')
      let shift = -1
      if (strip && stage) {
        const sr = strip.getBoundingClientRect()
        const gr = stage.getBoundingClientRect()
        if (gr.width) shift = Math.round((Math.abs(sr.left - gr.left) / gr.width) * 100) / 100
      }
      return {
        bg: getComputedStyle(v).backgroundColor,
        w: v.offsetWidth,
        h: v.offsetHeight,
        rootW: root.offsetWidth,
        rootH: root.offsetHeight,
        decoded: img ? img.naturalWidth : 0,
        fit: img ? getComputedStyle(img).objectFit : '',
        src: img ? img.getAttribute('src') : '',
        shift,
        count: document.querySelector('[data-testid="kt-viewer-count"]')?.textContent.trim() ?? '',
        thumbs: document.querySelectorAll('[data-testid^="kt-viewer-thumb-"]').length,
        onLabel: on ? on.getAttribute('aria-label') : '',
        name: document.querySelector('[data-testid="kt-viewer-name"]')?.textContent.trim() ?? '',
        stamp: document.querySelector('.pui-kt__viewer-stamp')?.textContent.trim() ?? '',
      }
    })()`)

  await openImage('.pui-kt__images[data-count="1"] .pui-kt__tile', '单图查看器')
  const viewSingle = await viewerState()
  record(
    " 点开单图 = 全屏黑底查看器（铺满屏幕、按比例 contain、不摆缩略图条）",
    viewSingle?.decoded > 0 &&
      viewSingle.bg === 'rgb(0, 0, 0)' &&
      viewSingle.w === viewSingle.rootW &&
      viewSingle.h === viewSingle.rootH &&
      viewSingle.fit === 'contain' &&
      viewSingle.thumbs === 0 &&
      viewSingle.count === '' &&
      viewSingle.name.length > 0 &&
      /^\d{4}\. \d{1,2}\. \d{1,2}\./.test(viewSingle.stamp),
    `浮层 ${viewSingle?.w}×${viewSingle?.h}（屏 ${viewSingle?.rootW}×${viewSingle?.rootH}）· fit=${viewSingle?.fit} · 缩略图 ${viewSingle?.thumbs} 条 · 顶栏「${viewSingle?.name} / ${viewSingle?.stamp}」`,
  )

  await evaluate(`document.querySelector('[data-testid="kt-viewer-close"]').click()`)
  await waitFor(`!document.querySelector('[data-testid="kt-media-viewer"]')`, '关闭单图查看器')
  record(
    " 关掉查看器回到会话（浮层移除、会话屏还在）",
    (await evaluate(
      `!document.querySelector('[data-testid="kt-media-viewer"]') && Boolean(document.querySelector('[data-testid="kt-thread-screen"]'))`,
    )) === true,
  )

  await openImage('.pui-kt__images[data-count="4"] .pui-kt__tile', '四图查看器')
  const viewMulti = await viewerState()
  record(
    " 点开多图：缩略图 4 张 + 「第 1 张，共 4 张」+ 当前张有描边",
    viewMulti?.thumbs === 4 &&
      viewMulti.count === '第 1 张，共 4 张' &&
      viewMulti.onLabel === '第 1 张',
    `${viewMulti?.thumbs} 张缩略图 · 计数「${viewMulti?.count}」· 高亮「${viewMulti?.onLabel}」`,
  )

  await evaluate(`document.querySelector('[data-testid="kt-viewer-thumb-2"]').click()`)
  await sleep(260)
  const viewSwitched = await viewerState()
  // 不比 src：这个 fixture 的专辑是同一张图重复 3 次，src 天然一样。
  // 判断"切到了第 3 张"靠计数与高亮，那是与数据下标绑定的
  record(
    " 点第 3 张缩略图：计数与高亮跟着换",
    viewSwitched?.count === '第 3 张，共 4 张' && viewSwitched.onLabel === '第 3 张',
    `计数「${viewSwitched?.count}」· 高亮「${viewSwitched?.onLabel}」`,
  )

  // 左右滑动翻页：拖 120px 松手（阈值是屏宽 1/5 且 ≤60px），走的是 stage 上的合成 pointer
  const swipeViewer = async (dx) => {
    await evaluate(`(() => {
      const el = document.querySelector('.pui-kt__viewer-stage')
      const r = el.getBoundingClientRect()
      const x = r.left + r.width / 2
      const y = r.top + r.height / 2
      const mk = (type, cx) => new PointerEvent(type, {
        clientX: cx, clientY: y, bubbles: true, cancelable: true,
        pointerId: 1, pointerType: 'touch', isPrimary: true,
        button: 0, buttons: type === 'pointerup' ? 0 : 1,
      })
      el.dispatchEvent(mk('pointerdown', x))
      el.dispatchEvent(mk('pointermove', x + ${dx}))
      el.dispatchEvent(mk('pointerup', x + ${dx}))
      return true
    })()`)
    await sleep(360)
    return viewerState()
  }

  // 当前停在第 3 张（下标 2）：左滑 → 下标 3
  const viewNext = await swipeViewer(-120)
  record(
    " 多图查看器左滑 → 翻到下一张（画面移一屏、计数与高亮同步）",
    viewNext?.shift === 3 && viewNext.count === '第 4 张，共 4 张' && viewNext.onLabel === '第 4 张',
    `位移 ${viewNext?.shift} 屏 · 计数「${viewNext?.count}」· 高亮「${viewNext?.onLabel}」`,
  )

  // 已经是最后一张：再往左滑应该纹丝不动（不越界、不出现空白页）
  const viewEdge = await swipeViewer(-120)
  record(
    " 最后一张再左滑不越界（停在原位，不出空白页）",
    viewEdge?.shift === 3 && viewEdge.count === '第 4 张，共 4 张',
    `位移 ${viewEdge?.shift} 屏 · 计数「${viewEdge?.count}」`,
  )

  const viewPrev = await swipeViewer(120)
  record(
    " 右滑 → 翻回上一张",
    viewPrev?.shift === 2 && viewPrev.count === '第 3 张，共 4 张' && viewPrev.onLabel === '第 3 张',
    `位移 ${viewPrev?.shift} 屏 · 计数「${viewPrev?.count}」· 高亮「${viewPrev?.onLabel}」`,
  )

  // 竖向拖拽不该被算成翻页（否则上下想退出时会误翻）
  const viewVertical = await evaluate(`(() => {
    const el = document.querySelector('.pui-kt__viewer-stage')
    const r = el.getBoundingClientRect()
    const x = r.left + r.width / 2
    const y = r.top + r.height / 2
    const mk = (type, cy) => new PointerEvent(type, {
      clientX: x, clientY: cy, bubbles: true, cancelable: true,
      pointerId: 1, pointerType: 'touch', isPrimary: true,
      button: 0, buttons: type === 'pointerup' ? 0 : 1,
    })
    el.dispatchEvent(mk('pointerdown', y))
    el.dispatchEvent(mk('pointermove', y + 130))
    el.dispatchEvent(mk('pointerup', y + 130))
    return true
  })()`)
  await sleep(360)
  const viewStill = await viewerState()
  record(
    " 竖向手势不算翻页（只认横滑）",
    viewVertical === true && viewStill?.shift === 2 && viewStill.count === '第 3 张，共 4 张',
    `位移 ${viewStill?.shift} 屏 · 计数「${viewStill?.count}」`,
  )

  await evaluate(`document.querySelector('[data-testid="kt-viewer-close"]').click()`)
  await waitFor(`!document.querySelector('[data-testid="kt-media-viewer"]')`, '关闭多图查看器')

  await open('ktTypes')
  await evaluate(`document.querySelector('[data-testid="lock-hint"]').click()`)
  await waitFor(`Boolean(document.querySelector('[data-testid="home-screen"]'))`, 'KakaoTalk 类型场景桌面')
  await evaluate(`document.querySelector('[data-testid="home-dock-kakaotalk"]').click()`)
  await waitFor(`Boolean(document.querySelector('[data-testid="kt-list-screen"]'))`, 'KakaoTalk 类型场景列表')
  await evaluate(`document.querySelector('[data-testid="kt-tab-chats"]').click()`)
  await evaluate(`document.querySelector('[data-testid="kt-conversation-item"]').click()`)
  await waitFor(`Boolean(document.querySelector('[data-testid="kt-thread-screen"]'))`, 'KakaoTalk 类型场景详情')
  await sleep(260)

  const ktTypes = await evaluate(`(() => {
    const screen = document.querySelector('[data-testid="kt-thread-screen"]').getBoundingClientRect()
    const voiceOf = (el) => {
      const bubble = el.closest('[data-testid="kt-bubble"]')
      return {
        w: el.offsetWidth,
        time: el.querySelector('[data-testid="kt-voice-time"]')?.textContent.trim() ?? '',
        bars: el.querySelectorAll('.pui-kt__voice-wave i').length,
        // 柱宽固定：长短只改柱数，不改粗细
        barW: el.querySelector('.pui-kt__voice-wave i')?.offsetWidth ?? 0,
        // 波形不能溢出被裁：柱数随宽度算（柱宽固定 3px），算错就会切掉最后一根

        waveFit: (() => {
          const w = el.querySelector('.pui-kt__voice-wave')
          return w ? w.scrollWidth <= w.clientWidth + 1 : false
        })(),
        // 播放三角必须真的画出来，而不是一个 0 宽的空 svg。
        // SVG 元素没有 offsetWidth（那是 HTMLElement 的属性，取到 undefined→0），
        // 只能用 getBoundingClientRect —— 这里只判「大于 0」，外壳缩放不影响结论
        playW: el.querySelector('.pui-kt__voice-play svg')?.getBoundingClientRect().width ?? 0,
        bubbleBg: getComputedStyle(bubble).backgroundColor,
        bubblePad: getComputedStyle(bubble).paddingLeft,
        side: el.closest('[data-side]')?.dataset.side ?? '',
      }
    }
    const voices = [...document.querySelectorAll('[data-testid="kt-voice"]')].map(voiceOf)

    const sticker = document.querySelector('[data-testid="kt-sticker"]')
    const stickerImg = sticker?.querySelector('img')
    const stickerBubble = sticker?.closest('[data-testid="kt-bubble"]')
    const sys = document.querySelector('[data-testid="kt-system"]')
    const sysRect = sys ? sys.getBoundingClientRect() : null
    return {
      voices,
      sticker: sticker
        ? {
            w: stickerImg?.offsetWidth ?? 0,
            h: stickerImg?.offsetHeight ?? 0,
            // 贴图按原比例长（3:4 的图不该被压成正方形），也不裁圆角
            ratio: stickerImg ? stickerImg.offsetWidth / stickerImg.offsetHeight : 0,
            imgRadius: stickerImg ? getComputedStyle(stickerImg).borderRadius : '',
            bg: getComputedStyle(stickerBubble).backgroundColor,
            pad: getComputedStyle(stickerBubble).paddingLeft,
          }
        : null,
      sys: sys
        ? {
            text: sys.textContent.trim(),
            centered:
              Math.abs(sysRect.left + sysRect.width / 2 - (screen.left + screen.width / 2)) <= 2,
            // 系统提示不能长成气泡：它不在任何 row 里，也就没有头像位与时刻
            inRow: Boolean(sys.closest('.pui-kt__row')),
            radius: getComputedStyle(sys).borderRadius,
            tag: sys.tagName,
          }
        : null,
      /*
       * 图片与气泡的相对位置：图必须顶在气泡自己的边上。
       * 量的都是 getBoundingClientRect 的差值（同一层缩放，比例会被约掉），
       * 不拿 offsetWidth 和 rect 混算 —— 外壳带 CSS scale 时那种混算必然偏。
       */
      images: [...document.querySelectorAll('.pui-kt__images')]
        .map((box) => {
          const bubble = box.closest('[data-testid="kt-bubble"]')
          const img = box.querySelector('.pui-kt__image')
          if (!bubble || !img) return null
          const b = bubble.getBoundingClientRect()
          const i = img.getBoundingClientRect()
          return {
            side: box.closest('[data-side]')?.dataset.side ?? '',
            count: box.dataset.count ?? '',
            leftGap: Math.round(i.left - b.left),
            rightGap: Math.round(b.right - i.right),
            boxW: Math.round(box.getBoundingClientRect().width),
            imgW: Math.round(i.width),
          }
        })
        .filter(Boolean),
    }
  })()`)

  const shortVoice = ktTypes.voices?.[0] ?? {}
  const longVoice = ktTypes.voices?.[1] ?? {}
  const ownVoice = ktTypes.voices?.[2] ?? {}

  record(
    " 语音条：播放三角 + 波形 + 时长三段齐全（三条语音都画出来了，柱子没被裁）",
    ktTypes.voices?.length === 3 &&
      ktTypes.voices.every(
        (v) => v.bars >= 6 && v.playW > 0 && v.waveFit && /^\d+:\d{2}$/.test(v.time),
      ),
    `${ktTypes.voices?.length} 条 · 波形 ${shortVoice.bars} 柱 · 三角 ${Math.round(shortVoice.playW)}px · 时长「${shortVoice.time}」· 不溢出 ${shortVoice.waveFit}`,
  )

  record(
    " 波形固定：柱宽不随语音长短变，长短只改柱数（1:15 比 0:03 多）",
    Math.abs(shortVoice.barW - 3) < 0.6 &&
      Math.abs(longVoice.barW - shortVoice.barW) < 0.6 &&
      longVoice.bars > shortVoice.bars,
    `柱宽 ${shortVoice.barW.toFixed(1)}/${longVoice.barW.toFixed(1)}px · 柱数 ${shortVoice.bars}/${longVoice.bars}`,
  )

  record(
    " 时长文字按 m:ss 显示：3 秒写 0:03、75 秒写 1:15",
    shortVoice.time === '0:03' && longVoice.time === '1:15' && ownVoice.time === '0:06',
    `${shortVoice.time} / ${longVoice.time} / ${ownVoice.time}`,
  )

  record(
    " 语音条宽度随时长增长（不是所有语音都一样宽）",
    longVoice.w > shortVoice.w + 40 && longVoice.w <= 208,
    `3 秒 ${shortVoice.w}px → 75 秒 ${longVoice.w}px`,
  )

  record(
    " 语音仍在气泡里：我方黄底、对方白底，内边距不为 0（与贴图形成对照）",
    ktTypes.voices?.every((v) => v.bubbleBg !== 'rgba(0, 0, 0, 0)' && v.bubblePad !== '0px') &&
      ownVoice.side === 'right',
    `背景 ${shortVoice.bubbleBg} · 内边距 ${shortVoice.bubblePad} · 我方侧=${ownVoice.side}`,
  )

  record(
    " 贴图：没有气泡底、按原比例长（3:4，不是正方形）、不裁圆角",
    ktTypes.sticker?.bg === 'rgba(0, 0, 0, 0)' &&
      ktTypes.sticker?.pad === '0px' &&
      Math.abs((ktTypes.sticker?.ratio ?? 0) - 0.75) < 0.03 &&
      ktTypes.sticker?.imgRadius === '0px' &&
      ktTypes.sticker?.w === 130,
    `${ktTypes.sticker?.w}×${ktTypes.sticker?.h} · 比例 ${(ktTypes.sticker?.ratio ?? 0).toFixed(2)} · 底 ${ktTypes.sticker?.bg} · 圆角 ${ktTypes.sticker?.imgRadius}`,
  )

  record(
    " 系统消息：居中一行灰字胶囊，不在气泡行里（没有头像与时刻）",
    ktTypes.sys?.inRow === false &&
      ktTypes.sys.centered === true &&
      ktTypes.sys.text === '演示人物 A 邀请 陈默 加入群聊' &&
      ktTypes.sys.tag === 'P',
    `「${ktTypes.sys?.text}」· 居中=${ktTypes.sys?.centered} · 在行内=${ktTypes.sys?.inRow} · 圆角 ${ktTypes.sys?.radius}`,
  )

  /*
   * 单图的宽度必须跟着图片走。外框若还留着多图的 280px，
   * 我方的图会贴在左半边、右边空出一截 —— 看上去就是"图片没跟气泡对齐"。
   * 判据看三件事：图到气泡左边/右边都没有缝、外框宽度==图片宽度。
   */
  const ownSingle = ktTypes.images?.find((im) => im.side === 'right' && im.count === '1')
  const otherSingle = ktTypes.images?.find((im) => im.side === 'left' && im.count === '1')
  record(
    " KakaoTalk 图片贴着自己那条气泡的边：我方贴右、对方贴左，外框不比图宽",
    Boolean(ownSingle && otherSingle) &&
      ownSingle.leftGap === 0 &&
      ownSingle.rightGap === 0 &&
      Math.abs(ownSingle.boxW - ownSingle.imgW) <= 1 &&
      otherSingle.leftGap === 0 &&
      Math.abs(otherSingle.boxW - otherSingle.imgW) <= 1,
    ownSingle && otherSingle
      ? `我方 ${ownSingle.boxW}/${ownSingle.imgW}px 左缝 ${ownSingle.leftGap} 右缝 ${ownSingle.rightGap} · 对方 ${otherSingle.boxW}/${otherSingle.imgW}px 左缝 ${otherSingle.leftGap}`
      : '没找到单图消息',
  )

  // ══════════════ 语音转文字：气泡外侧的「转」按钮（F4 的后半段） ══════════════

  const transcriptState = () =>
    evaluate(`(() => {
      const voices = [...document.querySelectorAll('[data-testid="kt-voice"]')].map((el) => {
        const bubble = el.closest('[data-testid="kt-bubble"]')
        const line = bubble.parentElement
        const btn = line.querySelector('[data-testid="kt-voice-transcript-toggle"]')
        const text = line.parentElement.querySelector('[data-testid="kt-voice-transcript"]')
        const b = bubble.getBoundingClientRect()
        const r = btn ? btn.getBoundingClientRect() : null
        const side = el.closest('[data-side]')?.dataset.side ?? ''
        return {
          dur: el.querySelector('[data-testid="kt-voice-time"]')?.textContent.trim() ?? '',
          side,
          hasBtn: Boolean(btn),
          pressed: btn?.getAttribute('aria-pressed') ?? '',
          outside: r ? (side === 'right' ? r.right <= b.left + 0.5 : r.left >= b.right - 0.5) : false,
          text: text?.textContent.trim() ?? '',
          below: text ? text.getBoundingClientRect().top >= b.bottom - 0.5 : null,
        }
      })
      return {
        voices,
        count: document.querySelectorAll('[data-testid="kt-voice-transcript"]').length,
      }
    })()`)

  const transcriptBefore = await transcriptState()
  record(
    " 只有填了转写的语音才有「转」按钮（3 条语音 → 2 个按钮，默认不展开）",
    transcriptBefore.voices.length === 3 &&
      transcriptBefore.voices.filter((v) => v.hasBtn).length === 2 &&
      transcriptBefore.count === 0 &&
      transcriptBefore.voices.find((v) => v.dur === '1:15')?.hasBtn === false,
    `语音 ${transcriptBefore.voices.length} 条 · 按钮 ${transcriptBefore.voices.filter((v) => v.hasBtn).length} 个 · 展开 ${transcriptBefore.count} 条`,
  )

  // 点开那条 0:03（对方，有转写）
  await evaluate(`(() => {
    const voice = [...document.querySelectorAll('[data-testid="kt-voice"]')]
      .find((el) => el.querySelector('[data-testid="kt-voice-time"]')?.textContent.trim() === '0:03')
    voice.closest('[data-testid="kt-bubble"]').parentElement
      .querySelector('[data-testid="kt-voice-transcript-toggle"]').click()
    return true
  })()`)
  await sleep(160)
  const transcriptOpen = await transcriptState()
  const shortOpen = transcriptOpen.voices.find((v) => v.dur === '0:03')
  record(
    " 点「转」→ 语音下方追加一条白气泡，内容是转写原文，按钮进入展开态",
    transcriptOpen.count === 1 &&
      shortOpen?.text === '你怎么回事啊？' &&
      shortOpen?.below === true &&
      shortOpen?.pressed === 'true' &&
      // 语音条本身还在 —— 转文字不该替换掉声音
      shortOpen?.hasBtn === true,
    `转写「${shortOpen?.text}」· 在语音下方=${shortOpen?.below} · aria-pressed=${shortOpen?.pressed}`,
  )

  record(
    "「转」按钮在气泡外侧：对方消息在右，我方消息镜像到左",
    transcriptOpen.voices.filter((v) => v.hasBtn).every((v) => v.outside === true),
    transcriptOpen.voices
      .filter((v) => v.hasBtn)
      .map((v) => `${v.side}${v.outside ? '✓' : '✗'}`)
      .join(' / '),
  )

  // 再点一次收起
  await evaluate(`(() => {
    const voice = [...document.querySelectorAll('[data-testid="kt-voice"]')]
      .find((el) => el.querySelector('[data-testid="kt-voice-time"]')?.textContent.trim() === '0:03')
    voice.closest('[data-testid="kt-bubble"]').parentElement
      .querySelector('[data-testid="kt-voice-transcript-toggle"]').click()
    return true
  })()`)
  await sleep(160)
  const transcriptClosed = await transcriptState()
  const shortClosed = transcriptClosed.voices.find((v) => v.dur === '0:03')
  record(
    " 再点一次收起转写（可反复切换，不是一次性展开）",
    transcriptClosed.count === 0 && shortClosed?.pressed === 'false' && shortClosed?.hasBtn === true,
    `展开 ${transcriptClosed.count} 条 · aria-pressed=${shortClosed?.pressed}`,
  )

  // 只量"有没有按钮"证明不了这一点 —— 得看里面的环和字真画出来了
  const btnLook = await evaluate(`(() => {
    const btn = document.querySelector('[data-testid="kt-voice-transcript-toggle"]')
    if (!btn) return null
    const ring = btn.querySelector('.pui-kt__transcribe-ring')
    const text = btn.querySelector('.pui-kt__transcribe-text')
    const bubble = btn.closest('.pui-kt__bubble-line')?.querySelector('[data-testid="kt-bubble"]') ?? null
    const bcs = bubble ? getComputedStyle(bubble) : null
    return {
      w: btn.offsetWidth,
      h: btn.offsetHeight,
      // 环和按钮**都**取矩形宽度：外壳的 scale 对两者一致，比值才不会被缩放污染
      // （混用 offsetWidth + getBoundingClientRect 会得出"环比按钮小 7px"的假结论）
      rectW: Math.round(btn.getBoundingClientRect().width),
      radius: getComputedStyle(btn).borderRadius,
      bg: getComputedStyle(btn).backgroundColor,
      // 环是**一段**弧 + **一个**箭尖：上一版两段弧 + 两个箭尖，读起来像"同步"图标
      ringPaths: ring ? ring.querySelectorAll('path').length : 0,
      ringHeads: ring ? ring.querySelectorAll('polygon').length : 0,
      ringW: ring ? Math.round(ring.getBoundingClientRect().width) : 0,
      // 箭头的实际颜色（环用 currentColor，所以取环的 color 就是箭尖的填充色）
      ringColor: ring ? getComputedStyle(ring).color : '',
      text: text?.textContent.trim() ?? '',
      fontSize: text ? getComputedStyle(text).fontSize : '',
      textColor: text ? getComputedStyle(text).color : '',
      voiceH: bubble ? bubble.offsetHeight : 0,
      voiceRadius: bcs ? parseFloat(bcs.borderTopLeftRadius) : 0,
    }
  })()`)

  const rgbaOf = (s) => {
    const m = String(s).match(/rgba?\(([^)]+)\)/)
    if (!m) return { r: 0, g: 0, b: 0, a: 1 }
    const p = m[1].split(',').map((v) => parseFloat(v))
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }
  }
  const lumOf = ({ r, g, b }) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  const btnBg = rgbaOf(btnLook?.bg)
  const btnText = rgbaOf(btnLook?.textColor)
  const btnRing = rgbaOf(btnLook?.ringColor)

  record(
    "「转」按钮：浅底 + 一圈循环箭头（1 段弧 + 1 个切向箭尖，直径 ≈ 按钮 5/6）+ 居中深灰「转」字",
    Boolean(btnLook) &&
      Math.abs(btnLook.w - btnLook.h) <= 1 &&
      btnLook.w >= 30 &&
      btnLook.radius === '50%' &&
      btnLook.ringPaths === 1 &&
      btnLook.ringHeads === 1 &&

      // 只缩环，按钮热区 34 和字号 13 都不动
      btnLook.ringW > 0 &&
      btnLook.ringW / btnLook.rectW > 0.74 &&
      btnLook.ringW / btnLook.rectW < 0.83 &&
      btnLook.text === '转' &&
      parseFloat(btnLook.fontSize) >= 12 &&
      // 底色比字亮：底是浅色半透明，字是深灰
      lumOf(btnBg) > 0.75 &&
      btnBg.a < 0.6 &&
      lumOf(btnText) < 0.4 &&
      // 箭头（环 + 箭尖）跟字同一个墨色，不能一深一浅
      btnLook.ringColor === btnLook.textColor,
    `${btnLook?.w}×${btnLook?.h} · 弧 ${btnLook?.ringPaths} 段 / 箭尖 ${btnLook?.ringHeads} 个 / 环 ${btnLook?.ringW}/${btnLook?.rectW}px · 底 rgba(${btnBg.r},${btnBg.g},${btnBg.b},${btnBg.a}) · 字「${btnLook?.text}」${btnLook?.fontSize} rgba(${btnText.r},${btnText.g},${btnText.b},${btnText.a}) · 环 rgba(${btnRing.r},${btnRing.g},${btnRing.b},${btnRing.a})`,
  )
  record(
    " 语音气泡是胶囊形（圆角半径 ≥ 高度一半，不是普通消息的 14px 圆角）",
    Boolean(btnLook) && btnLook.voiceH > 0 && btnLook.voiceRadius * 2 >= btnLook.voiceH - 1,
    `气泡高 ${btnLook?.voiceH}px · 圆角 ${btnLook?.voiceRadius}px`,
  )

  // 四角弧度：转写是**独立的一条**，不能套「左上近直角」那个连发尾巴特征；
  // 对方和我方各测一条 —— 我方那条的样式规则特异性更高，最容易漏改
  await evaluate(`(() => {
    const want = ['0:03', '0:06']
    ;[...document.querySelectorAll('[data-testid="kt-voice"]')]
      .filter((el) => want.includes(el.querySelector('[data-testid="kt-voice-time"]')?.textContent.trim()))
      .forEach((el) => {
        const line = el.closest('[data-testid="kt-bubble"]').parentElement
        line.querySelector('[data-testid="kt-voice-transcript-toggle"]')?.click()
      })
    return true
  })()`)
  await sleep(200)
  const corners = await evaluate(`(() => {
    const px = (s) => Math.round(parseFloat(s))
    return [...document.querySelectorAll('[data-testid="kt-voice-transcript"]')].map((el) => {
      const cs = getComputedStyle(el)
      return {
        side: el.closest('[data-side]')?.dataset.side ?? '',
        tl: px(cs.borderTopLeftRadius),
        tr: px(cs.borderTopRightRadius),
        br: px(cs.borderBottomRightRadius),
        bl: px(cs.borderBottomLeftRadius),
      }
    })
  })()`)
  const allSquare = (c) => c.tl === c.tr && c.tr === c.br && c.br === c.bl && c.tl >= 12
  record(
    " 转写气泡四角同弧度（两侧都是，不套「左上近直角」的普通消息特征）",
    corners.length === 2 && corners.every(allSquare),
    corners.map((c) => `${c.side}:${c.tl}/${c.tr}/${c.br}/${c.bl}`).join(' · ') || '没找到转写气泡',
  )

  // 收回去，别把展开态带进后面的场景
  await evaluate(`(() => {
    document.querySelectorAll('[data-testid="kt-voice-transcript-toggle"][aria-pressed="true"]')
      .forEach((b) => b.click())
    return true
  })()`)
  await sleep(160)

  // ══════════════ 场景 1c：Instagram（feed 模式的第二个应用） ══════════════
  await open('base')
  await evaluate(`document.querySelector('[data-testid="lock-hint"]').click()`)
  await waitFor(`Boolean(document.querySelector('[data-testid="home-screen"]'))`, 'Instagram 场景桌面')
  await evaluate(`document.querySelector('[data-testid="home-app-instagram"]').click()`)
  await waitFor(`Boolean(document.querySelector('[data-testid="ig-home-screen"]'))`, 'Instagram 首页')
  await sleep(260)

  const igHome = await evaluate(`(() => ({
    wordmark: document.querySelector('[data-testid="ig-home-logo"]')?.textContent?.trim() ?? '',
    tray: document.querySelectorAll('[data-testid="ig-story-item"]').length,
    traySeenFirst: document.querySelector('[data-testid="ig-story-item"]')?.classList.contains('pui-ig__tray-item--seen') ?? null,
    cards: document.querySelectorAll('[data-testid="ig-post-card"]').length,
    media: document.querySelectorAll('[data-testid="ig-post-media"]').length,
    badges: [...document.querySelectorAll('.pui-ig__media-count')].map((n) => n.textContent.trim()),
    dotGroups: [...document.querySelectorAll('.pui-ig__media-dots')].map((n) => n.children.length),
    tabs: document.querySelectorAll('[data-testid^="ig-tab-"]').length,
    dmDot: document.querySelector('.pui-ig__tab-dot') !== null,
    tabAvatarRing: getComputedStyle(document.querySelector('.pui-ig__tab-avatar')).backgroundImage !== 'none',
    ownPlus: Boolean(document.querySelector('[data-testid="ig-story-own"] .pui-ig__tray-plus')),
    ownRing: document.querySelector('[data-testid="ig-story-own"] .pui-ig__tray-ring') !== null,
    trayLine: getComputedStyle(document.querySelector('[data-testid="ig-story-tray"]')).borderBottomWidth,
    ownAv: document.querySelector('[data-testid="ig-story-own"] .pui-avatar')?.offsetWidth ?? 0,
    friendAv: document.querySelector('[data-testid="ig-story-item"] .pui-avatar')?.offsetWidth ?? 0,
    ownNameTop: document.querySelector('[data-testid="ig-story-own"] .pui-ig__tray-name')?.offsetTop ?? -1,
    friendNameTop: document.querySelector('[data-testid="ig-story-item"] .pui-ig__tray-name')?.offsetTop ?? -1,
    topbarH: document.querySelector('.pui-ig__topbar')?.offsetHeight ?? 0,
    sbH: parseFloat(getComputedStyle(document.querySelector('.pui-ig__topbar')).getPropertyValue('--pui-statusbar-h')) || 0,
  }))()`)
  record(
    " Instagram：首页字标 + 托盘 1 组 + 帖子 2 张 + 底栏 5 tab（DM 无红点）",
    igHome.wordmark === 'Instagram' &&
      igHome.tray === 1 &&
      igHome.cards === 2 &&
      igHome.tabs === 5 &&
      !igHome.dmDot &&
      !igHome.tabAvatarRing,
    `字标 ${igHome.wordmark} · 托盘 ${igHome.tray} · 帖 ${igHome.cards} · tab ${igHome.tabs}`,
  )
  record(
    " Instagram：「你的快拍」首格 = 黑色加号、无彩环，托盘与帖子之间无分隔线",
    igHome.ownPlus && !igHome.ownRing && igHome.trayLine === '0px',
    `加号 ${igHome.ownPlus} · 彩环 ${igHome.ownRing} · 托盘底边 ${igHome.trayLine}`,
  )
  record(
    " Instagram：「你的快拍」与好友头像同尺寸同心，名字垂直对齐",
    igHome.ownAv === igHome.friendAv && igHome.ownAv > 0 && igHome.ownNameTop === igHome.friendNameTop,
    `头像 ${igHome.ownAv}px=${igHome.friendAv}px · 名字 top ${igHome.ownNameTop}=${igHome.friendNameTop}`,
  )
  record(
    " Instagram：顶栏总高 = 状态栏 + 60px 字标行（height 不得双计状态栏）",
    Math.abs(igHome.topbarH - (igHome.sbH + 60)) <= 1,
    `顶栏 ${igHome.topbarH}px = 状态栏 ${igHome.sbH}px + 60px`,
  )
  record(
    " Instagram：多图帖带 1/2 角标 + 2 圆点，单图帖两者皆无",
    igHome.badges.length === 1 && igHome.badges[0] === '1/2' && igHome.dotGroups.length === 1 && igHome.dotGroups[0] === 2,
    `角标 ${JSON.stringify(igHome.badges)} · 圆点 ${JSON.stringify(igHome.dotGroups)}`,
  )

  // 点多图帖的图片区 → 翻到第 2 页（feed 第一张卡可能是单图帖，锁定带角标的那张）
  await evaluate(`document.querySelector('.pui-ig__media-count').closest('.pui-ig__media').click()`)
  await sleep(320)
  const igPage = await evaluate(
    `document.querySelector('.pui-ig__media-count')?.textContent?.trim() ?? ''`,
  )
  record(" 点图片翻页到 2/2", igPage === '2/2', igPage || '无角标')

  // 右滑 → 上一页（合成 pointer 事件模拟拖拽，验证双向滑动翻页）
  await evaluate(`(() => {
    const el = document.querySelector('.pui-ig__media-count').closest('.pui-ig__media');
    const r = el.getBoundingClientRect();
    const y = r.top + r.height / 2;
    const mk = (type, x) => new PointerEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch' });
    el.dispatchEvent(mk('pointerdown', r.left + 6));
    el.dispatchEvent(mk('pointermove', r.left + 90));
    el.dispatchEvent(mk('pointerup', r.left + 90));
    return true;
  })()`)
  await sleep(320)
  const igSwipeBack = await evaluate(
    `document.querySelector('.pui-ig__media-count')?.textContent?.trim() ?? ''`,
  )
  record(" 右滑翻回上一页 1/2", igSwipeBack === '1/2', igSwipeBack || '无角标')

  // 动作行：五格（赞/评论/转发/分享/收藏），点赞是本地态——点亮红心计数 +1

  const igCard = `[...document.querySelectorAll('[data-testid="ig-post-card"]')]
    .find((c) => c.querySelector('[data-testid="ig-card-comment"] .pui-ig__actnum')?.textContent.trim() === '3')`
  const igActs = await evaluate(`(() => ({
    cells: ${igCard}?.querySelectorAll('.pui-ig__actbtn').length ?? 0,
    likeNum: ${igCard}?.querySelector('[data-testid="ig-card-like"] .pui-ig__actnum')?.textContent?.trim() ?? '',
    commentNum: ${igCard}?.querySelector('[data-testid="ig-card-comment"] .pui-ig__actnum')?.textContent?.trim() ?? '',
  }))()`)
  await evaluate(`${igCard}?.querySelector('[data-testid="ig-card-like"]').click()`)
  await sleep(120)
  const igLike = await evaluate(`(() => ({
    on: ${igCard}?.querySelector('[data-testid="ig-card-like"]').classList.contains('pui-ig__actbtn--on') ?? false,
    num: ${igCard}?.querySelector('[data-testid="ig-card-like"] .pui-ig__actnum')?.textContent?.trim() ?? '',
  }))()`)
  record(
    " 动作行 5 格；点赞本地态：红心点亮 12 → 13",
    igActs.cells === 5 && igActs.likeNum === '12' && igActs.commentNum === '3' && igLike.on && igLike.num === '13',
    `${igActs.cells} 格 · 赞 ${igActs.likeNum}→${igLike.num}(${igLike.on ? '红' : '灰'}) · 评 ${igActs.commentNum}`,
  )

  await evaluate(`${igCard}?.querySelector('[data-testid="ig-card-like"]').click()`)
  await sleep(120)

  // Story：「你的快拍」格（无环 + 号）点开的是自己的故事 —— 自己的组不在环列表里重复出现
  await evaluate(`document.querySelector('[data-testid="ig-story-own"]').click()`)
  await waitFor(`Boolean(document.querySelector('[data-testid="ig-story-screen"]'))`, '自己的 Story 查看器')
  await sleep(240)
  const igOwnStory = await evaluate(`(() => ({
    segs: document.querySelectorAll('.pui-ig__progress i').length,
    onSegs: document.querySelectorAll('.pui-ig__progress i.pui-ig__progress-seg--on').length,
    name: document.querySelector('.pui-ig__viewer-name')?.textContent?.trim() ?? '',
  }))()`)
  record(
    " Story：「你的快拍」格可打开自己的故事，进度条一帧一段",
    igOwnStory.segs === 2 && igOwnStory.onSegs === 1 && igOwnStory.name === 'demo_a',
    `${igOwnStory.name} · ${igOwnStory.segs} 段 · 亮 ${igOwnStory.onSegs}`,
  )
  await evaluate(`document.querySelector('[data-testid="ig-story-close"]').click()`)
  await waitFor(`!document.querySelector('[data-testid="ig-story-screen"]')`, '关闭自己的故事')

  // 环列表第一组：有未看帧的组（排序规则），从第一个未看帧起播
  // 样本：demo_b 3 帧、首帧预设已读 → 起播在第 2 帧，亮 2 段
  await evaluate(`document.querySelector('[data-testid="ig-story-item"]').click()`)
  await waitFor(`Boolean(document.querySelector('[data-testid="ig-story-screen"]'))`, 'Story 查看器')
  await sleep(240)
  const igStory = await evaluate(`(() => ({
    segs: document.querySelectorAll('.pui-ig__progress i').length,
    onSegs: document.querySelectorAll('.pui-ig__progress i.pui-ig__progress-seg--on').length,
    hasReply: Boolean(document.querySelector('.pui-ig__viewer-reply')),
    name: document.querySelector('.pui-ig__viewer-name')?.textContent?.trim() ?? '',
  }))()`)
  record(
    " Story：环组从第一个未看帧起播（demo_b 3 帧 · 亮 2 段）",
    igStory.segs === 3 && igStory.onSegs === 2 && igStory.hasReply && igStory.name === 'demo_b',
    `${igStory.name} · ${igStory.segs} 段 · 亮 ${igStory.onSegs}`,
  )

  // 满屏几何：背景层存在且带模糊滤镜、前景图无圆角且填满舞台、背景与前景是同一张图
  const igStoryGeo = await evaluate(`(() => {
    const bg = document.querySelector('.pui-ig__stage-bg');
    const veil = document.querySelector('.pui-ig__stage-veil');
    const card = document.querySelector('.pui-ig__stage-card');
    const img = document.querySelector('.pui-ig__stage-img');
    if (!bg || !veil || !card || !img) return null;
    const st = getComputedStyle(card);
    const bgFilter = getComputedStyle(bg).filter;
    const cardRect = card.getBoundingClientRect();
    const imgRect = img.getBoundingClientRect();
    return {
      bgBlur: /blur\\(/.test(bgFilter),
      bgSrc: bg.src,
      imgSrc: img.src,
      cardRadius: st.borderRadius,
      cardFullW: Math.abs(cardRect.width - document.querySelector('.pui-ig__stage').getBoundingClientRect().width) < 2,
      imgW: Math.round(imgRect.width),
    };
  })()`)
  record(
    " Story：满屏布局 —— 背景层模糊 + 前景无圆角填满舞台 + 背景与前景同图",
    igStoryGeo && igStoryGeo.bgBlur && igStoryGeo.cardRadius === '0px' &&
      igStoryGeo.cardFullW && igStoryGeo.bgSrc === igStoryGeo.imgSrc && igStoryGeo.imgW > 0,
    `blur=${igStoryGeo?.bgBlur} · 圆角 ${igStoryGeo?.cardRadius} · 满宽 ${igStoryGeo?.cardFullW} · 图 ${igStoryGeo?.imgW}px`,
  )

  // 起播第 2 帧（亮 2）→ 右滑回第 1 帧（亮 1）→ 左滑再回到第 2 帧（亮 2）
  const storySwipe = (dx) => `(() => {
    const el = document.querySelector('[data-testid="ig-story-screen"] .pui-ig__stage');
    const r = el.getBoundingClientRect();
    const y = r.top + r.height / 2;
    const mk = (type, x) => new PointerEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch' });
    el.dispatchEvent(mk('pointerdown', r.left + r.width * 0.7));
    el.dispatchEvent(mk('pointermove', r.left + r.width * 0.7 + ${dx}));
    el.dispatchEvent(mk('pointerup', r.left + r.width * 0.7 + ${dx}));
    return true;
  })()`
  await evaluate(storySwipe(100))
  await sleep(320)
  const igStorySwipePrev = await evaluate(
    `document.querySelectorAll('.pui-ig__progress i.pui-ig__progress-seg--on').length`,
  )
  await evaluate(storySwipe(-100))
  await sleep(320)
  const igStorySwipeNext = await evaluate(
    `document.querySelectorAll('.pui-ig__progress i.pui-ig__progress-seg--on').length`,
  )
  record(
    " Story：右滑上一帧、左滑下一帧（拖拽跟手翻帧）",
    igStorySwipePrev === 1 && igStorySwipeNext === 2,
    `右滑亮 ${igStorySwipePrev} 段 · 左滑亮 ${igStorySwipeNext} 段`,
  )

  // 点右半屏下一帧 → 全组看完 → 关闭后托盘该组圆环变灰
  await evaluate(`document.querySelector('.pui-ig__stage-hit--next').click()`)
  await sleep(200)
  const igStoryEnd = await evaluate(
    `document.querySelectorAll('.pui-ig__progress i.pui-ig__progress-seg--on').length`,
  )
  await evaluate(`document.querySelector('[data-testid="ig-story-close"]').click()`)
  await waitFor(`!document.querySelector('[data-testid="ig-story-screen"]')`, '关闭查看器')
  const igTraySeen = await evaluate(
    `document.querySelector('[data-testid="ig-story-item"]')?.classList.contains('pui-ig__tray-item--seen') ?? null`,
  )
  record(
    " Story：播完一帧进度亮一段；全组看完后托盘环变灰",
    igStoryEnd === 3 && igTraySeen === true,
    `结束亮 ${igStoryEnd} 段 · 环灰=${igTraySeen}`,
  )

  // 评论浮层：点帖子卡评论按钮展开底部弹层，条数与入口同源；把手收起
  await evaluate(`${igCard}?.querySelector('[data-testid="ig-card-comment"]').click()`)
  await waitFor(`Boolean(document.querySelector('[data-testid="ig-comments-screen"]'))`, '评论浮层')
  await sleep(320)
  const igSheet = await evaluate(`(() => ({
    title: document.querySelector('.pui-ig__sheet-title')?.textContent?.trim() ?? '',
    items: document.querySelectorAll('[data-testid="ig-comment-item"]').length,
  }))()`)
  await evaluate(`document.querySelector('[data-testid="ig-comment-toggle"]').click()`)
  const nestedReplies = await evaluate(`document.querySelectorAll('[data-testid="ig-comment-reply"]').length`)
  record('Instagram 评论可展开嵌套回复', nestedReplies === 1)
  await evaluate(`document.querySelector('[data-testid="ig-comments-close"]').click()`)
  await waitFor(`!document.querySelector('[data-testid="ig-comments-screen"]')`, '收起评论浮层')
  record(
    " 评论浮层：底部弹层标题「评论」、2 条一级评论，把手可收起",
    igSheet.title === '评论' && igSheet.items === 2,
    `${igSheet.title} · ${igSheet.items} 条`,
  )

  // 帖子详情：从主页九宫格进（详情现在只能从主页九宫格点进，首页正文不跳转）。

  // 首页 feed 里机主自己（handle=demo_a）的帖子 → 点它的头像压栈进自己主页（应带返回键）。
  await evaluate(
    `[...document.querySelectorAll('[data-testid="ig-post-card"]')]
      .find((c) => c.querySelector('.pui-ig__card-handle')?.textContent.trim() === 'demo_a')
      ?.querySelector('.pui-ig__card-avatar')
      .click()`,
  )
  await waitFor(`Boolean(document.querySelector('[data-testid="ig-profile-screen"]'))`, '自己的主页（栈）')
  await sleep(200)
  const igOwnBack = await evaluate(
    `Boolean(document.querySelector('[data-testid="ig-profile-screen"] [data-testid="nav-back"]'))`,
  )
  record(" 首页点自己头像 → 自己主页压栈后仍有返回键", igOwnBack)

  await evaluate(`document.querySelector('[data-testid="ig-grid"] .pui-ig__cell').click()`)
  await waitFor(`Boolean(document.querySelector('[data-testid="ig-post-screen"]'))`, '帖子详情')
  await sleep(300)
  const igDetail = await evaluate(`(() => ({
    cards: document.querySelectorAll('[data-testid="ig-post-screen"] .pui-ig__card').length,
    commentlink: document.querySelector('[data-testid="ig-detail-commentlink"]')?.textContent?.trim() ?? '',
    inlineComments: document.querySelectorAll('[data-testid="ig-post-screen"] [data-testid="ig-comments"]').length,
  }))()`)
  record(
    " Instagram：详情 = 作者时间线（≥1 张卡）+ 无内联评论 + 「查看全部 N 条评论」入口",
    igDetail.cards >= 1 && igDetail.inlineComments === 0 && /查看全部/.test(igDetail.commentlink),
    `${igDetail.cards} 张卡 · 入口「${igDetail.commentlink}」 · 内联 ${igDetail.inlineComments}`,
  )

  // 点评论入口展开底部弹层，条数与首页卡角标同源
  await evaluate(`document.querySelector('[data-testid="ig-detail-commentlink"]').click()`)
  await waitFor(`Boolean(document.querySelector('[data-testid="ig-comments-screen"]'))`, '详情评论弹层')
  await sleep(240)
  const igDetailSheet = await evaluate(
    `document.querySelectorAll('[data-testid="ig-comment-item"]').length`,
  )
  await evaluate(`document.querySelector('[data-testid="ig-comments-close"]').click()`)
  await waitFor(`!document.querySelector('[data-testid="ig-comments-screen"]')`, '收起详情评论弹层')
  record(
    " 详情评论入口 → 弹层评论条数同源",
    igDetailSheet === 2,
    `${igDetailSheet} 条`,
  )

  await evaluate(`document.querySelector('[data-testid="nav-back"]').click()`)
  await waitFor(`Boolean(document.querySelector('[data-testid="ig-profile-screen"]'))`, '详情返回主页')
  record(" 帖子详情 → 主页可逆", true)
  await evaluate(`document.querySelector('[data-testid="nav-back"]').click()`)
  await waitFor(`Boolean(document.querySelector('[data-testid="ig-home-screen"]'))`, '自己主页返回首页')

  // 自己的主页：底栏头像进入
  await evaluate(`document.querySelector('[data-testid="ig-tab-profile"]').click()`)
  await waitFor(`Boolean(document.querySelector('[data-testid="ig-profile-screen"]'))`, '自己的主页')
  await sleep(240)
  const igOwn = await evaluate(`(() => ({
    btns: [...document.querySelectorAll('.pui-ig__profile-btn')].map((n) => n.textContent.trim()),
    stats: [...document.querySelectorAll('.pui-ig__profile-stat')].map((n) => n.textContent.trim()),
    cells: document.querySelectorAll('[data-testid="ig-grid"] [data-testid="ig-grid"] > *').length ||
      document.querySelectorAll('.pui-ig__grid .pui-ig__cell').length,
    stack: document.querySelectorAll('.pui-ig__cell-stack').length,
    backVisible: Boolean(document.querySelector('[data-testid="ig-profile-screen"] [data-testid="nav-back"]')),
    bellOrMenu: document.querySelector('[data-testid="ig-profile-screen"] .pui-ig__topbar-icon svg') ? true : false,
    tabbar: document.querySelector('.pui-ig__tabbar')?.offsetParent !== null,
    profileOn: document.querySelector('[data-testid="ig-tab-profile"]')?.classList.contains('pui-ig__tab--on') ?? false,
    storyRow: Boolean(document.querySelector('[data-testid="ig-profile-story-row"]')),
    storyAdd: Boolean(document.querySelector('[data-testid="ig-profile-story-row"] .pui-ig__pstory-add')),
    storyRings: document.querySelectorAll('[data-testid="ig-profile-story"]').length,
    ringGray: (() => { const r = document.querySelector('[data-testid="ig-profile-story"] .pui-ig__pstory-ring'); return r ? getComputedStyle(r).backgroundImage === 'none' : false })(),
    addOw: document.querySelector('[data-testid="ig-profile-story-row"] .pui-ig__pstory-add')?.offsetWidth ?? 0,
    ringOw: document.querySelector('[data-testid="ig-profile-story"] .pui-ig__pstory-ring')?.offsetWidth ?? 0,
  }))()`)
  record(
    " Instagram：自己主页 = 编辑/分享按钮 + 帖子 1 格 + 多图叠层角标，无返回键",
    igOwn.btns.join(',') === '编辑个人资料,分享个人资料' &&
      igOwn.cells === 1 &&
      igOwn.stack === 1 &&
      !igOwn.backVisible,
    `按钮 ${igOwn.btns.join('/')} · ${igOwn.cells} 格 · 叠层 ${igOwn.stack}`,
  )
  record(
    " 自己主页：底栏常驻且主页 tab 高亮",
    igOwn.tabbar && igOwn.profileOn,
    `底栏 ${igOwn.tabbar} · 高亮 ${igOwn.profileOn}`,
  )
  record(
    " 自己主页：快拍行 = 新增描边圆格 + 快拍环 1 组（恒灰环；两圆几何外径相等）",
    igOwn.storyRow && igOwn.storyAdd && igOwn.storyRings === 1 && igOwn.ringGray &&
      igOwn.addOw === igOwn.ringOw && igOwn.addOw > 0,
    `行 ${igOwn.storyRow} · 环 ${igOwn.storyRings} 组 · 灰环 ${igOwn.ringGray} · 外径 ${igOwn.addOw}=${igOwn.ringOw}`,
  )

  // 主页快拍环点开 = 同一个 Story 查看器（自己的故事 demo_a，2 帧）
  await evaluate(`document.querySelector('[data-testid="ig-profile-story"]').click()`)
  await waitFor(`Boolean(document.querySelector('[data-testid="ig-story-screen"]'))`, '主页快拍查看器')
  await sleep(240)
  const igProfileStory = await evaluate(`(() => ({
    segs: document.querySelectorAll('.pui-ig__progress i').length,
    name: document.querySelector('.pui-ig__viewer-name')?.textContent?.trim() ?? '',
  }))()`)
  await evaluate(`document.querySelector('[data-testid="ig-story-close"]').click()`)
  await waitFor(`!document.querySelector('[data-testid="ig-story-screen"]')`, '关闭主页快拍')
  record(
    " 主页快拍环可打开自己的故事（复用同一查看器）",
    igProfileStory.segs === 2 && igProfileStory.name === 'demo_a',
    `${igProfileStory.name} · ${igProfileStory.segs} 段`,
  )

  // 自己主页的标题也是回桌面入口（与首页字标同规则）
  await evaluate(`document.querySelector('[data-testid="ig-profile-logo"]').click()`)
  await waitFor(`Boolean(document.querySelector('[data-testid="home-screen"]'))`, '主页标题回桌面')
  record(" 自己主页标题点击回桌面", true)

  // 重进 Instagram，回到首页 feed（应用重挂载，activeTab 复位）
  await evaluate(`document.querySelector('[data-testid="home-app-instagram"]').click()`)
  await waitFor(`Boolean(document.querySelector('[data-testid="ig-home-screen"]'))`, '重进 Instagram')
  await sleep(220)

  // 他人主页：回首页后点第 2 张帖子的头像（演示人物 B，带认证徽章）
  await evaluate(`document.querySelector('[data-testid="ig-home-logo"]').click()`)
  let igProfileHomeOk = true
  try {
    await waitFor(`Boolean(document.querySelector('[data-testid="home-screen"]'))`, '主页回桌面', 3000)
  } catch {
    igProfileHomeOk = false
  }
  record(" 点字标回桌面（Instagram）", igProfileHomeOk)

  await evaluate(`document.querySelector('[data-testid="home-app-instagram"]').click()`)
  await waitFor(`Boolean(document.querySelector('[data-testid="ig-home-screen"]'))`, '重进 Instagram')
  await sleep(220)
  // 第一张卡是演示人物 B（时间最新），点它的头像进他人主页
  await evaluate(`document.querySelector('[data-testid="ig-post-card"] .pui-ig__card-avatar').click()`)
  await waitFor(`Boolean(document.querySelector('[data-testid="ig-profile-screen"]'))`, '他人主页')
  await sleep(240)
  const igOther = await evaluate(`(() => ({
    btns: [...document.querySelectorAll('.pui-ig__profile-btn')].map((n) => n.textContent.trim()),
    verified: document.querySelector('.pui-ig__verified') !== null,
    back: Boolean(document.querySelector('[data-testid="ig-profile-screen"] [data-testid="nav-back"]')),
    title: document.querySelector('.pui-ig__subbar-title')?.textContent?.trim() ?? '',
    storyRow: (() => { const s = document.querySelectorAll('[data-testid="ig-profile-screen"]')[0]; return Boolean(s && s.querySelector('[data-testid="ig-profile-story-row"]')) })(),
  }))()`)
  record(
    " 他人主页 = 已关注/发消息按钮 + 返回键 + 无认证徽章 + 无快拍行",
    igOther.btns[0] === '已关注' && igOther.btns[1] === '发消息' && igOther.back && !igOther.verified && !igOther.storyRow && igOther.title.includes('demo_b'),
    `${igOther.title} · ${igOther.btns.join('/')} · 徽章 ${igOther.verified} · 快拍行 ${igOther.storyRow}`,
  )

  await evaluate(`document.querySelector('[data-testid="nav-back"]').click()`)
  await waitFor(`Boolean(document.querySelector('[data-testid="ig-home-screen"]'))`, '他人主页返回')

  await evaluate(`document.querySelector('[data-testid="ig-tab-reels"]').click()`)
  await sleep(160)
  record('Instagram Reels 装饰入口保留反馈，不离开首页', await evaluate(`document.querySelector('[data-testid="ig-home-screen"]').offsetParent !== null && document.querySelector('[data-testid="ig-tab-home"]').classList.contains('pui-ig__tab--on')`))
  await evaluate(`document.querySelector('[data-testid="ig-home-logo"]').click()`)
  await waitFor(`!!document.querySelector('[data-testid="home-screen"]')`, 'Instagram 回桌面')

  await evaluate(`document.querySelector('[data-testid="home-app-notes"]').click()`)
  await waitFor(`Boolean(document.querySelector('[data-testid="notes-list-screen"]'))`, '备忘录列表')
  const ntList = await evaluate(`(() => ({
    rows: document.querySelectorAll('[data-testid="notes-row"]').length,
    titles: [...document.querySelectorAll('.pui-nt__row-title')].map((n) => n.textContent.trim()),
    count: document.querySelector('.pui-nt__count')?.textContent?.trim() ?? '',
    homeTitle: document.querySelector('.pui-nt__home')?.textContent?.trim() ?? '',
    listToolbar: document.querySelectorAll('[data-testid="notes-list-screen"] .pui-nt__toolbar svg').length,
    firstSub: [...(document.querySelectorAll('[data-testid="notes-row"]')[0]?.querySelector('.pui-nt__row-sub')?.children ?? [])].map((n) => n.className),
  }))()`)
  record(
    " 备忘录列表：行数与计数一致 + 标题即正文首行 + 摘要在前时间在后 + 列表工具栏两端 2 图标",
    ntList.rows === 5 && ntList.count === '5 个备忘录' && ntList.titles[0] === '功能导览' &&
      ntList.homeTitle === '备忘录' && ntList.listToolbar === 2 &&
      ntList.firstSub.join(',') === 'pui-nt__row-snippet,pui-nt__row-time',
    `${ntList.count} · 首行「${ntList.titles[0]}」 · 摘要/时间序 ${ntList.firstSub.join('→') || '?'} · 工具栏 ${ntList.listToolbar} 图标`,
  )

  // 详情：第一行（最新一条）点进去，正文与时间戳都有
  await evaluate(`document.querySelectorAll('[data-testid="notes-row"]')[0].click()`)
  await waitFor(`Boolean(document.querySelector('[data-testid="notes-detail-screen"]'))`, '备忘录详情')
  const ntDetail = await evaluate(`(() => ({
    stamp: document.querySelector('.pui-nt__stamp'),
    lines: [...document.querySelectorAll('[data-testid="notes-detail-screen"] .pui-nt__line')].filter((n) => n.textContent.trim()).length,
    body: document.querySelector('[data-testid="notes-detail-screen"] .pui-nt__body')?.textContent ?? '',
    navIcons: document.querySelectorAll('[data-testid="notes-detail-screen"] .pui-nt__nav .pui-nt__actions svg').length,
    toolbarIcons: document.querySelectorAll('[data-testid="notes-detail-screen"] .pui-nt__toolbar svg').length,
  }))()`)
  record(
    " 详情：正文在、无时间戳、顶栏 3 图标 + 底栏 4 图标（纯外观）",
    ntDetail.lines >= 2 && !ntDetail.stamp && ntDetail.navIcons === 3 && ntDetail.toolbarIcons === 4 &&
      ntDetail.body.includes('功能导览'),
    `段落 ${ntDetail.lines} · 时间戳 ${ntDetail.stamp ? '存在' : '无'} · 图标 ${ntDetail.navIcons}/${ntDetail.toolbarIcons}`,
  )

  // 返回列表 → 点顶栏字标回桌面
  await evaluate(`document.querySelector('[data-testid="notes-detail-screen"] [data-testid="nav-back"]').click()`)
  await waitFor(`Boolean(document.querySelector('[data-testid="notes-list-screen"]'))`, '详情返回列表')
  await evaluate(`document.querySelector('[data-testid="notes-title"]').click()`)
  let ntHomeOk = true
  try {
    await waitFor(`Boolean(document.querySelector('[data-testid="home-screen"]'))`, '备忘录回桌面', 3000)
  } catch {
    ntHomeOk = false
  }
  record(" 点列表大标题回桌面（备忘录）", ntHomeOk)

  await evaluate(`document.querySelector('[data-testid="home-dock-settings"]').click()`)
  await waitFor(`Boolean(document.querySelector('[data-testid="settings-list-screen"]'))`, '设置')
  await sleep(220)
  const st = await evaluate(`(() => ({
    groups: document.querySelectorAll('[data-testid="settings-group"]').length,
    rows: document.querySelectorAll('[data-testid="settings-row"]').length,
    allDiv: [...document.querySelectorAll('[data-testid="settings-row"]')].every((n) => n.tagName === 'DIV'),
    tiles: document.querySelectorAll('[data-testid="settings-row"] .pui-st__tile').length,
    ownerName: document.querySelector('[data-testid="settings-owner-name"]')?.textContent?.trim() ?? '',
    ownerSub: document.querySelector('[data-testid="settings-owner-sub"]')?.textContent?.trim() ?? '',
    switches: [...document.querySelectorAll('[data-testid="settings-switch"]')].map((n) => n.dataset.on),
    colors: [...document.querySelectorAll('[data-testid="settings-switch"]')].map((n) => getComputedStyle(n).backgroundColor),
    device: document.querySelector('[data-testid="settings-device-name"]')?.textContent?.trim() ?? '',
    title: document.querySelector('[data-testid="settings-title"]')?.textContent?.trim() ?? '',
    grouped: getComputedStyle(document.querySelector('[data-testid="settings-app"]')).backgroundColor,
  }))()`)
  record(
    " 设置：机主卡片（Apple ID 文案）+ 4 组 12 行 + 分组底色 + 大标题",
    st.ownerName === '演示人物 A' && st.ownerSub === 'Apple ID、iCloud 等' &&
      st.groups === 4 && st.rows === 12 &&
      st.tiles === 12 && st.title === '设置' && st.grouped === 'rgb(242, 242, 247)',
    `${st.ownerName} / ${st.ownerSub} · ${st.groups} 组 ${st.rows} 行 · 底色 ${st.grouped}`,
  )
  record(
    "12 行全部不可点（都是 div），3 只开关 = 1 绿开 2 灰关（冻结）",
    st.allDiv && st.switches.length === 3 &&
      st.switches.filter((v) => v === 'true').length === 1 &&
      st.colors.filter((c) => c === 'rgb(52, 199, 89)').length === 1 &&
      st.colors.filter((c) => c === 'rgb(233, 233, 234)').length === 2,
    `开关 ${st.switches.join('/')} · 色 ${st.colors.join(' ')}`,
  )
  record(" 关于本机行不带值（设备名已摘除，纯骨架行）", st.device === '', st.device || '（无值）')

  await evaluate(`document.querySelector('[data-testid="settings-title"]').click()`)
  let stHomeOk = true
  try {
    await waitFor(`Boolean(document.querySelector('[data-testid="home-screen"]'))`, '设置回桌面', 3000)
  } catch {
    stHomeOk = false
  }
  record(" 点大标题回桌面（设置）", stHomeOk)

  // ══════════════ 场景 2：reduce-motion ══════════════
  await open('base', {
    media: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  })
  const reducedInfo = await evaluate(`window.__probe.lockInfo()`)
  record(" 识别 reduce-motion", reducedInfo?.reduced === true)

  await evaluate(`window.__probe.down(700)`)
  await evaluate(`window.__probe.move(500)`)
  const reducedDrag = await evaluate(`window.__probe.frames(2)`)
  await evaluate(`window.__probe.up(500)`)
  record(
    " reduce-motion 下不做位移跟随",
    Math.abs(reducedDrag.offset) <= 1,
    `位移 ${reducedDrag?.offset}px`,
  )

  await sleep(200)
  const stillLocked = await evaluate(`Boolean(window.__probe.lock())`)
  record(" reduce-motion 拖动不触发解锁", stillLocked === true)

  // 降级环境用"轻点解锁"出口
  await evaluate(`document.querySelector('[data-testid="lock-hint"]').click()`)
  let reducedUnlock = true
  try {
    await waitFor(`Boolean(document.querySelector('[data-testid="home-screen"]'))`, '降级解锁', 3000)
  } catch {
    reducedUnlock = false
  }
  record(" reduce-motion 轻点即解锁（淡入）", reducedUnlock)

  await session.send('Emulation.setEmulatedMedia', { features: [] })

  // ══════════════ 场景 3：4 位密码 ══════════════
  await open('pass4')
  await evaluate(`document.querySelector('[data-testid="lock-hint"]').click()`)
  await waitFor(`Boolean(document.querySelector('[data-testid="passcode-pad"]'))`, '密码盘')
  record(" 设了密码时上滑弹出密码盘", true)

  const dotCount = await evaluate(
    `document.querySelectorAll('[data-testid^="passcode-dot-"]').length`,
  )
  record("4 位密码显示 4 个圆点", dotCount === 4, `${dotCount} 个`)

  // 输错
  await evaluate(`(async () => {
    for (const d of ['9','9','9','9']) {
      document.querySelector('[data-testid="passcode-key-' + d + '"]').click();
      await new Promise((r) => setTimeout(r, 30));
    }
    return true;
  })()`)
  await sleep(220)
  const wrong = await evaluate(`(() => {
    const pad = document.querySelector('[data-testid="passcode-pad"]');
    return {
      error: pad?.dataset.error === 'true',
      message: document.querySelector('[data-testid="passcode-message"]')?.textContent?.trim() ?? '',
      filled: document.querySelectorAll('[data-testid^="passcode-dot-"]').length,
      on: document.querySelectorAll('.pui-pass__dot--on').length,
    };
  })()`)
  record(
    " 错误码给提示并清空",
    wrong.error && wrong.message.includes('密码不正确') && wrong.on === 0,
    `「${wrong.message}」`,
  )

  // 输对
  await evaluate(`(async () => {
    for (const d of ['1','2','3','4']) {
      document.querySelector('[data-testid="passcode-key-' + d + '"]').click();
      await new Promise((r) => setTimeout(r, 30));
    }
    return true;
  })()`)
  let passOk = true
  try {
    await waitFor(`Boolean(document.querySelector('[data-testid="home-screen"]'))`, '密码正确进桌面', 3000)
  } catch {
    passOk = false
  }
  record(" 正确密码进入桌面", passOk)

  // ══════════════ 场景 4：6 位密码 + 12 小时制 ══════════════
  await open('pass6')
  const h12 = await evaluate(
    `document.querySelector('[data-testid="statusbar-time"]')?.textContent?.trim() ?? ''`,
  )
  record('状态栏时间跟随 timeFormat', h12 === formatClock(new Date(), 'h12'), `「${h12}」`)

  await evaluate(`document.querySelector('[data-testid="lock-hint"]').click()`)
  await waitFor(`Boolean(document.querySelector('[data-testid="passcode-pad"]'))`, '6 位密码盘')
  const six = await evaluate(`(() => ({
    length: document.querySelector('[data-testid="passcode-pad"]').dataset.length,
    dots: document.querySelectorAll('[data-testid^="passcode-dot-"]').length,
  }))()`)
  record("6 位密码切换生效", six.length === '6' && six.dots === 6, `${six.dots} 个圆点`)

  await open('noowner')
  const lockOk = await evaluate(`Boolean(window.__probe.lock())`)
  await evaluate(`document.querySelector('[data-testid="lock-hint"]').click()`)
  let noOwnerOk = true
  try {
    await waitFor(`Boolean(document.querySelector('[data-testid="home-screen"]'))`, '无主桌面', 4000)
  } catch {
    noOwnerOk = false
  }
  const noOwnerState = await evaluate(`(() => ({
    icons: document.querySelectorAll('[data-testid^="home-app-"], [data-testid^="home-dock-"]').length,
    errors: window.__probe.errors(),
    bodyLen: document.body.innerText.trim().length,
  }))()`)
  record(
    " 删除所属人后锁屏与桌面正常",
    lockOk && noOwnerOk && noOwnerState.icons === SCENARIOS.noowner.workSettings.homeLayout.items.filter(item => !['preset', 'html-widget'].includes(item.kind)).length && noOwnerState.errors.length === 0,
    `${noOwnerState.icons} 个图标 · ${noOwnerState.errors.length} 个错误`,
  )

  await session.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    mobile: true,
  })
  await sleep(400)
  const narrow = await evaluate(`(() => {
    const shell = document.querySelector('[data-testid="phone-shell"]');
    const notch = document.querySelector('.pui-shell__notch');
    return {
      innerWidth: window.innerWidth,
      mode: shell.dataset.mode,
      notch: notch ? getComputedStyle(notch).display : 'missing',
    };
  })()`)
  record(
    " 窄视口铺满且无假刘海",
    narrow.mode === 'fill' && narrow.notch === 'none',
    `${narrow.innerWidth}px → ${narrow.mode} / 刘海 ${narrow.notch}`,
  )
  await session.send('Emulation.clearDeviceMetricsOverride')

  }
  session.close()
  session = null
} catch (err) {
  console.error('\n[system] 中断：' + err.message)
  record('探针执行完成', false, err.message)
} finally {
  try {
    session?.close()
  } catch {
    /* 忽略 */
  }
  try {
    chrome.kill()
  } catch {
    /* 忽略 */
  }
}

const passed = results.filter((r) => r.ok).length
console.log(`\n[system] ${passed}/${results.length} 通过`)
if (passed !== results.length) {
  console.log('\n  失败项：')
  for (const r of results.filter((x) => !x.ok)) console.log(`    · ${r.step}  ${r.detail}`)
}
console.log(`\n  临时目录未删除：${WORK_DIR}\n`)
process.exit(passed === results.length ? 0 : 1)

// ══════════════════════ 静态检查 ══════════════════════

function checkNoEdgeListeners() {
  const files = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === '__tests__' || entry.name === 'node_modules') continue
        walk(full)
      } else if (/\.(js|vue|css)$/.test(entry.name)) {
        files.push(full)
      }
    }
  }
  for (const dir of SRC_DIRS) walk(dir)

  const offenders = []
  const windowLevel =
    /(?:window|document)\s*\.\s*addEventListener\s*\(\s*['"](touch(start|move|end)|pointerdown)['"]/g
  const overscroll = /overscroll-behavior-x/g

  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8')
    for (const re of [windowLevel, overscroll]) {
      re.lastIndex = 0
      let m = re.exec(text)
      while (m) {
        offenders.push(`${path.relative(ROOT, file)} → ${m[0]}`)
        m = re.exec(text)
      }
    }
  }

  record(
    " 源码无 window 级边缘手势监听",
    offenders.length === 0,
    offenders.length ? offenders.join('; ') : `扫描 ${files.length} 个文件`,
  )
}

function checkBundle() {
  const names = fs
    .readdirSync(DIST, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name)
  const js = fs.statSync(path.join(DIST, 'renderer.js')).size
  const css = fs.statSync(path.join(DIST, 'renderer.css')).size
  const total = js + css
  const expected = names.length === 3 && names.includes('renderer.js') && names.includes('renderer.css')
  record(
    " 产物仅 renderer.js + renderer.css（+ 宿主页）",
    expected,
    names.join(', '),
  )
  record(
    ` 产物体积 < ${Math.round(SIZE_BUDGET / 1024)}KB`,
    total < SIZE_BUDGET,
    `${(total / 1024).toFixed(1)}KB（js ${(js / 1024).toFixed(1)} + css ${(css / 1024).toFixed(1)}）`,
  )
}
