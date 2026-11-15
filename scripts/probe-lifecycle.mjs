

import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, URL } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const CREATOR_DIR = path.join(ROOT, 'apps', 'creator')
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const DEV_PORT = 5278
const CDP_PORT = 9346

if (!fs.existsSync(CHROME)) {
  console.error('[lifecycle] 未找到 Chrome：' + CHROME)
  process.exit(2)
}

const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-sim-lifecycle-'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const results = []
function record(step, ok, detail = '') {
  results.push({ step, ok, detail })
  console.log(`  ${ok ? '✓' : '✗'} ${step}${detail ? `  ${detail}` : ''}`)
}

// ───────────────────── dev server ─────────────────────

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

// ───────────────────── CDP ─────────────────────

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

async function browserWsUrl() {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 25000) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)
      const json = await res.json()
      if (json.webSocketDebuggerUrl) return json.webSocketDebuggerUrl
    } catch {
      /* 还没起来 */
    }
    await sleep(300)
  }
  throw new Error('连不上 CDP')
}

/** 打开一个标签页，返回它的 CDP 会话（页面级） */
async function openTab(browser, url) {
  const { targetId } = await browser.send('Target.createTarget', { url })
  let page = null
  const startedAt = Date.now()
  while (Date.now() - startedAt < 25000) {
    const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()
    page = list.find((t) => t.id === targetId)
    if (page?.webSocketDebuggerUrl) break
    await sleep(250)
  }
  if (!page?.webSocketDebuggerUrl) throw new Error('标签页没起来')

  const session = connectCdp(page.webSocketDebuggerUrl)
  await session.ready
  await session.send('Runtime.enable')
  await session.send('Page.enable')
  return { targetId, session }
}

function makeEvaluate(session) {
  return async function evaluate(expression) {
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
}

async function waitFor(evaluate, expression, label, timeoutMs = 25000) {
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
  const guard = await import('/src/db/tab-guard.js');
  window.__projects = useProjectsStore();
  window.__editor = useProjectStore();
  window.__guard = guard;
  window.__readLock = async (projectId) => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('phone-simulator');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const value = await new Promise((resolve) => {
      try {
        const tx = db.transaction('meta', 'readonly');
        const get = tx.objectStore('meta').get('lock:' + projectId);
        // meta 表存的是 { key, value } 包装（repository 的 setMeta 约定），
        // 少剥这一层就会读到一个没有 tabId 的对象，看起来像"锁不存在"。
        get.onsuccess = () => {
          const entry = get.result ?? null;
          resolve(entry && typeof entry === 'object' && 'value' in entry ? entry.value : entry);
        };
        get.onerror = () => resolve('<error>');
      } catch (e) { resolve('<err:' + e.message + '>'); }
    });
    db.close();
    return value;
  };
  window.__readProjects = async () => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('phone-simulator');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const rows = await new Promise((resolve) => {
      try {
        const tx = db.transaction('projects', 'readonly');
        const all = tx.objectStore('projects').getAll();
        all.onsuccess = () => resolve(all.result);
        all.onerror = () => resolve([]);
      } catch { resolve([]); }
    });
    db.close();
    return rows.map((p) => ({ id: p.id, name: p.name, phoneName: p.workSettings?.phoneName ?? null }));
  };
  return 'ok';
})()
`

// ───────────────────── 启动 ─────────────────────

let chrome = null
let browser = null
const launchedAt = []

function launchChrome(extraArgs = []) {
  const args = [
    // 刻意不加 --headless：headless 下关标签页不派发 pagehide，验不到 H-9
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=Translate,MediaRouter',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${USER_DATA}`,
    '--window-size=560,420',
    '--window-position=-2400,-2400',
    ...extraArgs,
  ]
  const p = spawn(CHROME, args, { stdio: 'ignore' })
  launchedAt.push(p)
  return p
}

function killChromeHard() {
  if (!chrome) return
  // /F = 强杀，/T = 连同子进程（Chrome 的渲染进程是它的子进程）
  spawnSync('taskkill', ['/F', '/T', '/PID', String(chrome.pid)], { stdio: 'ignore' })
  chrome = null
}

async function cleanup() {
  try {
    browser?.close()
  } catch {
    /* 连接可能已断 */
  }
  try {
    dev.kill()
  } catch {
    /* 忽略 */
  }
  for (const p of launchedAt) {
    if (p.exitCode === null) {
      spawnSync('taskkill', ['/F', '/T', '/PID', String(p.pid)], { stdio: 'ignore' })
    }
  }
}

console.log('\n[lifecycle] 标签页关闭与进程强杀\n')
console.log(`  临时 profile：${USER_DATA}\n`)

process.on('uncaughtException', async (err) => {
  console.error('[lifecycle] 未捕获异常：' + err.message)
  await cleanup()
  process.exit(1)
})

try {
  if (!(await waitForServer())) throw new Error('dev server 启动失败')

  chrome = launchChrome()
  browser = connectCdp(await browserWsUrl())
  await browser.ready

  console.log('  H-9  真关标签页 → 锁交还（不等 15 秒）')

  const tabA = await openTab(browser, `http://127.0.0.1:${DEV_PORT}/`)
  const evalA = makeEvaluate(tabA.session)
  await waitFor(evalA, `document.readyState === 'complete' && Boolean(document.querySelector('h1'))`, 'A 页首屏')
  const bootA = await evalA(BOOTSTRAP)
  if (bootA !== 'ok') throw new Error('A 页注入失败')

  // 清一次库，避免受上一次运行的残留影响
  await evalA(`(async () => {
    const conn = await import('/src/db/connection.js');
    try { await conn.deleteDatabase(); } catch {}
    return 'ok';
  })()`)

  // 重新加载并重新注入（清库后必须换上下文）
  await evalA(`window.__probeStamp = 1, true`)
  await tabA.session.send('Page.reload', { ignoreCache: true })
  await waitFor(
    evalA,
    `typeof window.__probeStamp === 'undefined' && document.readyState === 'complete' && Boolean(document.querySelector('h1'))`,
    'A 页重载',
  )
  if ((await evalA(BOOTSTRAP)) !== 'ok') throw new Error('A 页重载后注入失败')

  const created = await evalA(`(async () => {
    const p = await window.__projects.create({ name: 'H-9 锁交还' });
    await window.__editor.open(p.id);
    await window.__editor.patch({ workSettings: { phoneName: '诺基亚 3310' } });
    await window.__editor.flush();
    return { id: p.id, lock: await window.__readLock(p.id) };
  })()`)
  const projectId = created.id

  if (process.env.PROBE_DEBUG) {
    console.log('    [debug] created =', JSON.stringify(created))
    console.log('    [debug] projectId =', projectId)
    console.log(
      '    [debug] 再读一次 =',
      JSON.stringify(await evalA(`window.__readLock(${JSON.stringify(projectId)})`)),
    )
    console.log(
      '    [debug] meta 全量 =',
      JSON.stringify(await evalA(`(async () => {
        const db = await new Promise((res, rej) => { const r = indexedDB.open('phone-simulator'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
        const keys = await new Promise((res) => { const tx = db.transaction('meta', 'readonly'); const all = tx.objectStore('meta').getAll(); all.onsuccess = () => res(all.result); all.onerror = () => res('<err>'); });
        db.close();
        return keys;
      })()`)),
    )
  }

  const lockBefore = created.lock
  record(
    'A 页打开项目后持有锁',
    Boolean(lockBefore?.tabId) && lockBefore.tabId !== null,
    `tabId=${lockBefore?.tabId} fence=${lockBefore?.fence}`,
  )
  const tabIdOfA = lockBefore?.tabId

  const pagehideBound = await evalA(`localStorage.getItem('__tabGuardPagehideBound') === '1'`)
  record('pagehide 监听器已注册', pagehideBound === true)

  // 第二个标签页按真实路径打开同一项目：会被判定为只读，并就此启动本页的心跳与 presence 通道。
  // 这一点很关键 —— 关标签页时的"bye 广播"只有活着的页面才收得到，
  // 而一个从没打开过项目的列表页根本没有 BroadcastChannel 监听器。
  const tabB = await openTab(browser, `http://127.0.0.1:${DEV_PORT}/`)
  const evalB = makeEvaluate(tabB.session)
  await waitFor(evalB, `document.readyState === 'complete' && Boolean(document.querySelector('h1'))`, 'B 页首屏')
  if ((await evalB(BOOTSTRAP)) !== 'ok') throw new Error('B 页注入失败')
  const bOpened = await evalB(`(async () => {
    const r = await window.__editor.open(${JSON.stringify(projectId)});
    return { r, readOnly: window.__editor.readOnlyReason ?? null };
  })()`)
  record(
    'B 页打开同一项目进入只读（并启动 presence）',
    Boolean(bOpened?.readOnly),
    `reason=${bOpened?.readOnly}`,
  )
  const seenByB = await evalB(`window.__readLock(${JSON.stringify(projectId)})`)
  record('B 页看到 A 的锁', seenByB?.tabId === tabIdOfA, `tabId=${seenByB?.tabId}`)

  // 在 B 页挂一个"旁听"通道，记录它到底收到过哪些广播。
  // 只有它能区分"没发出"和"发出了但没人收到"。
  await evalB(`(() => {
    window.__bcSeen = [];
    window.__bcSpy = new BroadcastChannel('phone-sim-tab-presence');
    window.__bcSpy.onmessage = (e) => window.__bcSeen.push(e.data);
    return true;
  })()`)

  // 装一个同步存证的 pagehide 监听：localStorage 是同步写，页面被销毁也不会丢。
  // 有了它才能区分两种失败：
  //   ① pagehide 根本没派发      → localStorage 里没有标记
  //   ② 派发了，但 IDB 事务没提交 → 标记在，锁记录没变
  await evalA(`(() => {
    localStorage.removeItem('__probePagehideFired');
    localStorage.removeItem('__probeMarkerAtPagehide');
    const aliveKey = 'phone-sim-tab-alive:' + ${JSON.stringify(tabIdOfA)};
    window.addEventListener('pagehide', () => {
      // 记录"我的监听器跑的时候，应用的存活标记还在不在"。
      // 应用监听器先注册、先执行；它若跑过，这里读到的就是 null。
      localStorage.setItem('__probeMarkerAtPagehide', String(localStorage.getItem(aliveKey)));
      localStorage.setItem('__probePagehideFired', String(Date.now()));
    });
    return true;
  })()`)

  // ★ 真关 A 页：走浏览器自己的关闭流程（不是手动 dispatch pagehide）
  await browser.send('Target.closeTarget', { targetId: tabA.targetId })
  try {
    tabA.session.close()
  } catch {
    /* 已销毁 */
  }

  // 给 pagehide 的事务一点时间，但远小于 15s 过期窗口 —— 只有真的交还了才会变 null
  let released = null
  const startedAt = Date.now()
  while (Date.now() - startedAt < 5000) {
    released = await evalB(`window.__readLock(${JSON.stringify(projectId)})`)
    if (released && released.tabId === null) break
    await sleep(200)
  }
  const elapsed = Date.now() - startedAt

  const pagehideFired = await evalB(`localStorage.getItem('__probePagehideFired')`)
  record(
    'pagehide 事件确实派发',
    Boolean(pagehideFired),
    pagehideFired ? `at ${pagehideFired}` : '未派发 → 浏览器没有走正常卸载流程',
  )

  if (process.env.PROBE_DEBUG) {
    console.log('    [debug] B 收到的广播 =', await evalB(`JSON.stringify(window.__bcSeen)`))
    console.log(
      '    [debug] pagehide 时应用标记是否已被清 =',
      await evalB(`JSON.stringify(localStorage.getItem('__probeMarkerAtPagehide'))`),
    )
  }
  record(
    '★ A 页关闭后锁立即交还（墓碑 owner 清空）',
    Boolean(released) && released.tabId === null,
    `${elapsed}ms 后 tabId=${released?.tabId} fence=${released?.fence}`,
  )
  record(
    '交还后 fence 未被重置',
    Number(released?.fence) === Number(lockBefore?.fence),
    `${lockBefore?.fence} → ${released?.fence}`,
  )

  // B 页此时能立刻拿到锁（不用等 15s）
  const acquiredByB = await evalB(`(async () => {
    const r = await window.__guard.acquireLock(${JSON.stringify(projectId)});
    return r;
  })()`)
  if (process.env.PROBE_DEBUG) {
    console.log('    [debug] B acquire 结果 =', JSON.stringify(acquiredByB))
    console.log(
      '    [debug] 锁记录 aliveMarker =',
      JSON.stringify(await evalB(`window.__readLock(${JSON.stringify(projectId)})`)),
    )
    console.log(
      '    [debug] B 的 localStorage keys =',
      JSON.stringify(await evalB(`Object.keys(localStorage)`)),
    )
  }
  record('B 页可立即获取编辑权', acquiredByB?.acquired === true, `fence=${acquiredByB?.fence}`)

  console.log('\n  H-12 强杀浏览器进程 → 重开 → 数据仍在')

  const survivor = await evalB(`(async () => {
    const p = await window.__projects.create({ name: 'H-12 持久化' });
    await window.__editor.open(p.id);
    await window.__editor.patch({ workSettings: { phoneName: '强杀前写进去的' } });
    await window.__editor.flush();
    return { id: p.id, name: p.name };
  })()`)
  record('强杀前数据已落盘', Boolean(survivor?.id), `projectId=${survivor?.id}`)

  // 真 SIGKILL：taskkill /F，不是 process.exit
  killChromeHard()
  await sleep(1200)
  record('浏览器进程已被强杀', chrome === null, 'taskkill /F /T')

  // 同一个 user-data-dir 重开 —— 数据只能来自磁盘
  chrome = launchChrome([`http://127.0.0.1:${DEV_PORT}/`])
  browser = connectCdp(await browserWsUrl())
  await browser.ready

  const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()
  const reopened = list.find((t) => t.type === 'page' && t.url.includes(`:${DEV_PORT}`))
  if (!reopened) throw new Error('重开后没找到页面')
  const session2 = connectCdp(reopened.webSocketDebuggerUrl)
  await session2.ready
  await session2.send('Runtime.enable')
  const eval2 = makeEvaluate(session2)

  await waitFor(eval2, `document.readyState === 'complete' && Boolean(document.querySelector('h1'))`, '重开后首屏')
  if ((await eval2(BOOTSTRAP)) !== 'ok') throw new Error('重开后注入失败')

  const afterKill = await eval2(`window.__readProjects()`)
  const found = (afterKill ?? []).find((p) => p.id === survivor.id)
  record('★ 重开后项目仍在', Boolean(found), `读到 ${afterKill?.length ?? 0} 个项目`)
  record(
    '项目内容完整（手机名保留）',
    found?.phoneName === '强杀前写进去的',
    `phoneName=${found?.phoneName ?? 'null'}`,
  )
} catch (err) {
  console.error('\n[lifecycle] 中断：' + err.message)
  record('探针执行完成', false, err.message)
} finally {
  await cleanup()
}

const passed = results.filter((r) => r.ok).length
console.log(`\n[lifecycle] ${passed}/${results.length} 通过`)
if (passed !== results.length) {
  console.log('\n  失败项：')
  for (const r of results.filter((x) => !x.ok)) console.log(`    · ${r.step}  ${r.detail}`)
}
console.log(`\n  临时 profile 未删除：${USER_DATA}`)
console.log('  （留给你自己清；脚本里删它会触发沙箱的累计删除保护）\n')

process.exit(passed === results.length ? 0 : 1)
