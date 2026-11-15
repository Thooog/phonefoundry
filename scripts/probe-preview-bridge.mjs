

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, URL } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const CREATOR_DIR = path.join(ROOT, 'apps', 'creator')
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const DEV_PORT = 5281
const CDP_PORT = 9349

if (!fs.existsSync(CHROME)) {
  console.error('[preview] 未找到 Chrome：' + CHROME)
  process.exit(2)
}

const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-sim-preview-'))
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

let chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--allow-file-access-from-files',
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

async function findTarget(predicate, timeoutMs = 25000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()
      const target = list.find((t) => t.type === 'page' && predicate(t.url))
      if (target?.webSocketDebuggerUrl) return target
    } catch {
      /* 还没起来 */
    }
    await sleep(300)
  }
  return null
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

console.log("\n[preview] 预览桥（）\n")
console.log(`  临时 profile：${USER_DATA}\n`)

let session = null
try {
  if (!(await waitForServer())) throw new Error('dev server 启动失败')

  const target = await findTarget((url) => url.includes(`:${DEV_PORT}`))
  if (!target) throw new Error('没找到创作端页面')
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
      await sleep(120)
    }
    throw new Error(`等待超时：${label}` + (lastErr ? `（${lastErr.message}）` : ''))
  }

  await session.send('Page.navigate', { url: `http://127.0.0.1:${DEV_PORT}/` })
  // 必须等 Vue 真正挂载（pinia 在 main.js 里注册）。只等 #app 存在会抢跑：

  await waitFor(
    `location.protocol === 'http:' && Boolean(document.querySelector('h1')) &&
     document.querySelector('#app').children.length > 0`,
    '创作端真正挂载',
  )

  const BOOTSTRAP = `
  (async () => {
    const { useProjectsStore } = await import('/src/stores/projects.js');
    const { useProjectStore } = await import('/src/stores/project.js');
    window.__projects = useProjectsStore();
    window.__editor = useProjectStore();
    window.__frameDoc = () => {
      const f = document.querySelector('[data-testid="preview-frame"]');
      return f ? f.contentDocument : null;
    };
    return 'ok';
  })()
  `
  if ((await evaluate(BOOTSTRAP)) !== 'ok') throw new Error('注入失败')

  const prj = await evaluate(`(async () => {
    const p = typeof window.__projects.createSample === 'function'
      ? await window.__projects.createSample()
      : await window.__projects.create({ name: '预览桥' });
    await window.__editor.open(p.id);
    // 注意要带上原有 workSettings 再覆盖单项：patch 是浅合并，
    // 直接给 { phoneName } 会把所属人/剧情日期一起抹掉，后面的左右气泡断言就废了
    await window.__editor.patch({
      workSettings: { ...window.__editor.project.workSettings, phoneName: '预览桥测试机' },
    });
    // 把会话撑长，让详情页真的产生滚动位置 ——
    // 只有 3 条消息时 scrollTop 恒为 0，"滚动位置不变"这条断言等于没测
    await window.__editor.mutate((p) => {
      const bucket = p.appData.kakaotalk;
      const convId = bucket.conversations[0].id;
      const speaker = p.characters[0].id;
      const base = Date.now();
      for (let i = 1; i <= 24; i += 1) {
        bucket.messages.push({
          id: 'msg_probe_' + i,
          conversationId: convId,
          senderCharacterId: i % 2 === 0 ? speaker : p.characters[1].id,
          senderAccountId: null,
          displayTime: new Date(base + i * 1000).toISOString(),
          contentType: 'text',
          content: '撑出滚动位置的填充消息 ' + i,
          mediaAssetIds: [],
          snapshot: null,
          createdAt: new Date(base).toISOString(),
          updatedAt: new Date(base).toISOString(),
        });
      }
    });
    await window.__editor.flush();
    return { id: p.id };
  })()`)
  console.log(`  · 项目 ${prj.id}\n`)

  await evaluate(`(() => { location.hash = '#/p/${prj.id}/preview'; return true })()`)
  await waitFor(`Boolean(document.querySelector('[data-testid="preview-frame"]'))`, '预览 iframe')

  const inFrame = (expr) => `window.__frameDoc()?.${expr}`
  const clickFrame = async (testid) => {
    await evaluate(`(() => {
      const el = window.__frameDoc().querySelector('[data-testid="${testid}"]');
      if (!el) throw new Error('iframe 内找不到 ${testid}');
      el.click();
      return true;
    })()`)
  }

  await waitFor(`${inFrame(`querySelector('[data-testid="lock-screen"]')`)} != null`, 'iframe 内锁屏')
  record(" 握手成功，iframe 内渲染出手机", true)

  // 解锁 → 桌面。这一步同时证明"注入的是可用数据"，而不是只有外壳
  await clickFrame('lock-hint')
  await waitFor(`${inFrame(`querySelector('[data-testid="home-screen"]')`)} != null`, 'iframe 内桌面', 8000)

  const icons = await evaluate(
    `window.__frameDoc().querySelectorAll('[data-testid^="home-app-"], [data-testid^="home-dock-"]').length`,
  )
  record(" 数据已注入：桌面图标齐备", icons === 8, `${icons} 个图标`)

  await clickFrame('home-dock-kakaotalk')
  await waitFor(`${inFrame(`querySelector('[data-testid="kt-list-screen"]')`)} != null`, '会话列表')

  await clickFrame('kt-tab-chats')
  await waitFor(
    `${inFrame(`querySelector('[data-testid="kt-conversation-item"]')`)} != null`,
    '会话行',
  )
  const convCount = await evaluate(
    `window.__frameDoc().querySelectorAll('[data-testid="kt-conversation-item"]').length`,
  )
  record(" appData 也传到了子端", convCount > 0, `${convCount} 条会话`)

  // 这是整条协议最关键的一条：改完必须还在详情页、滚动位置不变、内容真的变了。
  await clickFrame('kt-conversation-item')
  await waitFor(`${inFrame(`querySelector('[data-testid="kt-thread-screen"]')`)} != null`, '会话详情')
  // 聊天界面进入时会自动贴底（这是聊天应用的正确行为）。

  await sleep(600)

  await evaluate(`(() => {
    const f = document.querySelector('[data-testid="preview-frame"]');
    f.contentWindow.__aliveStamp = 'alive';
    window.__docRef = f.contentDocument;
    const viewport = f.contentDocument.querySelector('.pui-scroll__viewport');
    window.__scrollBefore = viewport ? viewport.scrollTop : -1;
    return true;
  })()`)

  const NEW_TEXT = '预览里改过的一条消息'
  const startedAt = Date.now()
  await evaluate(`(async () => {
    await window.__editor.mutate((p) => {
      const list = p.appData.kakaotalk.messages;
      list[list.length - 1].content = ${JSON.stringify(NEW_TEXT)};
    });
    return true;
  })()`)

  try {
    await waitFor(
      `Array.from(window.__frameDoc().querySelectorAll('[data-testid="kt-bubble"]'))
        .some((el) => el.textContent.trim() === ${JSON.stringify(NEW_TEXT)})`,
      'iframe 内消息内容更新',
      5000,
    )
  } catch (err) {
    // 超时时把两侧状态都打出来，否则只知道"没变"，不知道卡在哪一段
    const diag = await evaluate(`({
      store: window.__editor.project?.appData?.kakaotalk?.messages?.slice(-1)?.[0]?.content ?? null,
      hint: document.querySelector('[data-testid="preview-hint"]')?.textContent?.trim() ?? '',
      onThread: Boolean(window.__frameDoc()?.querySelector('[data-testid="kt-thread-screen"]')),
      bubbles: Array.from(window.__frameDoc()?.querySelectorAll('[data-testid="kt-bubble"]') ?? [])
        .map((el) => el.textContent.trim()).slice(-3),
      frameUrl: document.querySelector('[data-testid="preview-frame"]')?.getAttribute('src'),
    })`)
    throw new Error(`${err.message} | 诊断 ${JSON.stringify(diag)}`)
  }
  const elapsed = Date.now() - startedAt
  record(" 改一条消息后 iframe 内内容更新", true, `${elapsed}ms（含 120ms 节流）`)

  const stillOnThread = await evaluate(
    `Boolean(window.__frameDoc().querySelector('[data-testid="kt-thread-screen"]'))`,
  )
  record(" 仍在聊天详情页（没被弹回列表）", stillOnThread === true)

  const scroll = await evaluate(`(() => {
    const f = document.querySelector('[data-testid="preview-frame"]');
    const viewport = f.contentDocument.querySelector('.pui-scroll__viewport');
    return { before: window.__scrollBefore, after: viewport ? viewport.scrollTop : -1 };
  })()`)
  record(
    " 滚动位置保持不变",
    scroll.before > 0 && Math.abs(scroll.before - scroll.after) <= 2,
    `${scroll.before} → ${scroll.after}`,
  )

  const stillSameDoc = await evaluate(`(() => {
    const f = document.querySelector('[data-testid="preview-frame"]');
    return f.contentWindow.__aliveStamp === 'alive' && window.__docRef === f.contentDocument;
  })()`)
  record(" 更新不重载、不重建文档", stillSameDoc === true)

  const creatorOnly = await evaluate(
    `window.__frameDoc().querySelectorAll('[data-creator-only]').length`,
  )
  record(" iframe 内无 data-creator-only 元素", creatorOnly === 0, `命中 ${creatorOnly} 个`)

  const metrics = await evaluate(`({
    count: window.__previewBridge?.stats?.receivedMetrics ?? 0,
    last: window.__previewBridge?.stats?.lastMetrics ?? null,
    hud: document.querySelector('[data-testid="preview-metrics"]')?.textContent?.trim() ?? '',
  })`)
  record(
    " 子端上报渲染耗时（phone:metrics）",
    metrics.count > 0 && typeof metrics.last?.applyMs === 'number',
    `${metrics.count} 帧 · 最近 ${metrics.last?.applyMs ?? '—'}ms · HUD「${metrics.hud}」`,
  )
  record(
    " 顺带上报数据体积（判断全量推送何时成瓶颈）",
    typeof metrics.last?.chars === 'number' && metrics.last.chars > 0,
    `${metrics.last?.chars ?? 0} 字`,
  )

  await evaluate(`(async () => { window.__previewBridge.reset(); return true })()`)
  let resetOk = false
  try {
    await waitFor(`${inFrame(`querySelector('[data-testid="lock-screen"]')`)} != null`, 'reset 回到锁屏', 4000)
    resetOk = true
  } catch {
    resetOk = false
  }
  record(" phone:reset 让预览回到锁屏", resetOk)

  const convId = await evaluate(`window.__editor.project.appData.kakaotalk.conversations[0].id`)
  await evaluate(
    `(async () => { window.__previewBridge.goto('kakaotalk', 'chat', ${JSON.stringify(convId)}); return true })()`,
  )
  let gotoOk = false
  try {
    await waitFor(
      `${inFrame(`querySelector('[data-testid="kt-thread-screen"]')`)} != null`,
      'goto 直达会话详情',
      4000,
    )
    gotoOk = true
  } catch {
    gotoOk = false
  }
  record(" phone:goto 让预览直达指定会话", gotoOk)

  // ── 从应用编辑页点预览：第一帧就该是那个应用 ──
  // 判定"没有从锁屏开始"不能只看最终态（最终停在应用上，也可能中途闪过锁屏）：

  await evaluate(`(() => { location.hash = '#/p/${prj.id}/apps/notes'; return true })()`)
  let labelOk = false
  try {
    await waitFor(
      `document.querySelector('[data-testid="open-preview"]')?.textContent.trim() === '预览「备忘录」'`,
      '预览按钮文案跟随应用',
      8000,
    )
    labelOk = true
  } catch {
    labelOk = false
  }
  record('预览按钮文案跟随当前应用（不再是笼统的「预览作品」）', labelOk)

  await evaluate(`(() => {
    window.__seenLock = false;
    window.__seenNotes = false;
    window.__sample = setInterval(() => {
      const f = document.querySelector('[data-testid="preview-frame"]');
      const doc = f && f.contentDocument;
      if (!doc) return;
      if (doc.querySelector('[data-testid="lock-screen"]')) window.__seenLock = true;
      if (doc.querySelector('[data-testid="notes-list-screen"]')) window.__seenNotes = true;
    }, 30);
    return true;
  })()`)

  let directOk = false
  try {
    await evaluate(`(() => { document.querySelector('[data-testid="open-preview"]').click(); return true })()`)
    await waitFor(
      `${inFrame(`querySelector('[data-testid="notes-list-screen"]')`)} != null`,
      '直达备忘录列表',
      10000,
    )
    directOk = true
  } catch {
    directOk = false
  }
  const sample = await evaluate(`(() => {
    clearInterval(window.__sample);
    return {
      lock: window.__seenLock === true,
      notes: window.__seenNotes === true,
      label: document.querySelector('[data-testid="preview-where"]')?.textContent?.trim() ?? '',
    };
  })()`)
  record(
    '应用页点预览 → 第一帧直接是目标应用（全程未出现锁屏）',
    directOk && sample.notes === true && sample.lock === false,
    JSON.stringify(sample),
  )
  record('预览工具条标出当前正在看哪个应用', sample.label.includes('备忘录'), `「${sample.label}」`)

  let homeOk = false
  try {
    await evaluate(`(() => { document.querySelector('[data-testid="preview-home"]').click(); return true })()`)
    await waitFor(`${inFrame(`querySelector('[data-testid="home-screen"]')`)} != null`, '回到桌面', 5000)
    homeOk = true
  } catch {
    homeOk = false
  }
  record('工具条「回到桌面」从应用回到桌面', homeOk)

  // 非法 app：必须被拦下停在桌面，而不是把 currentApp 设成野值渲染占位页
  await evaluate(`(async () => { window.__previewBridge.goto('notes'); return true })()`)
  try {
    await waitFor(
      `${inFrame(`querySelector('[data-testid="notes-list-screen"]')`)} != null`,
      '重新进入备忘录',
      5000,
    )
  } catch {
    /* 下一条断言会给出结论 */
  }
  await evaluate(`(async () => { window.__previewBridge.goto('nope'); return true })()`)
  let strayOk = false
  try {
    await waitFor(`${inFrame(`querySelector('[data-testid="home-screen"]')`)} != null`, '未知 app 停在桌面', 5000)
    const placeholder = await evaluate(
      `window.__frameDoc().querySelectorAll('[data-testid="app-host"][data-app="nope"]').length`,
    )
    strayOk = placeholder === 0
  } catch {
    strayOk = false
  }
  record('未知应用的定位请求被拦下（停在桌面，不渲染占位页）', strayOk)

  // ── 空态：单独打开作品端不白屏（顶层窗口、无父级数据） ──
  await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?http://127.0.0.1:${DEV_PORT}/player-runtime/`, {
    method: 'PUT',
  })
  const playerSessionTarget = await findTarget((url) => url.includes('/player-runtime/'), 15000)
  if (playerSessionTarget) {
    const ps = connectCdp(playerSessionTarget.webSocketDebuggerUrl)
    await ps.ready
    await ps.send('Runtime.enable')
    // 等过 resolve-source 的 1.2s 超时，进入空态
    await sleep(2200)
    const res = await ps.send('Runtime.evaluate', {
      expression: `({
        hasShell: Boolean(document.querySelector('[data-testid="phone-shell"]')),
        hasLock: Boolean(document.querySelector('[data-testid="lock-screen"]')),
        hasHome: Boolean(document.querySelector('[data-testid="home-screen"]')),
        bodyLen: document.body.innerText.trim().length,
      })`,
      returnByValue: true,
    })
    const state = res.result?.value ?? {}
    record(
      '空态：单独打开作品端不白屏（只出外壳，不假装有数据）',
      state.hasShell === true && state.hasLock === false && state.hasHome === false && state.bodyLen > 0,
      JSON.stringify(state),
    )
    ps.close()
  } else {
    record('空态：单独打开作品端不白屏', false, '没能打开作品端页面')
  }

  session.close()
  session = null

  // ── 构建产物：file:// 下预览运行库在不在 ──
  const distIndex = path.join(CREATOR_DIR, 'dist', 'index.html')
  const distRuntime = path.join(CREATOR_DIR, 'dist', 'player-runtime', 'preview.html')
  record(
    '构建产物内含 player-runtime',
    fs.existsSync(distIndex) && fs.existsSync(distRuntime),
    path.relative(ROOT, distRuntime),
  )

  if (fs.existsSync(distRuntime)) {
    chrome.kill()
    await sleep(600)
    chrome = spawn(
      CHROME,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--allow-file-access-from-files',
        `--remote-debugging-port=${CDP_PORT}`,
        `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), 'phone-sim-preview-file-'))}`,
        '--window-size=1280,900',
        'file:///' + distRuntime.split(path.sep).join('/'),
      ],
      { stdio: 'ignore' },
    )
    const fileTarget = await findTarget((url) => url.startsWith('file://'), 20000)
    if (fileTarget) {
      const fs2 = connectCdp(fileTarget.webSocketDebuggerUrl)
      await fs2.ready
      await fs2.send('Runtime.enable')
      await sleep(1500)
      const res = await fs2.send('Runtime.evaluate', {
        expression: `({
          hasShell: Boolean(document.querySelector('[data-testid="phone-shell"]')),
          errors: (window.__probeErrors ?? []).length,
        })`,
        returnByValue: true,
      })
      const state = res.result?.value ?? {}
      record('file:// 直开构建出来的作品端产物可用', state.hasShell === true, JSON.stringify(state))
      fs2.close()
    } else {
      record('file:// 直开构建出来的作品端产物可用', false, '没能打开 file:// 页面')
    }
  }
} catch (err) {
  console.error('\n[preview] 中断：' + err.message)
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
console.log(`\n[preview] ${passed}/${results.length} 通过`)
if (passed !== results.length) {
  console.log('\n  失败项：')
  for (const r of results.filter((x) => !x.ok)) console.log(`    · ${r.step}  ${r.detail}`)
}
console.log(`\n  临时 profile 未删除：${USER_DATA}\n`)

process.exit(passed === results.length ? 0 : 1)
