import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { exportStandaloneHtml } from '../packages/exporter/src/index.js'
import { reloadAndWait } from './lib/probe-kit.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const port = 5297, cdpPort = 9497
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'x-search-check-'))
const shots = path.join(root, 'docs', 'milestones', 'shots')
fs.mkdirSync(shots, { recursive: true })
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const dev = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--port', String(port), '--strictPort'], { cwd: path.join(root, 'apps/creator'), stdio: 'ignore', windowsHide: true })
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true })
let ws
const errors = []
try {
  let target
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}`)).ok) target = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find(row => row.type === 'page')
    } catch { /* Wait for the two owned processes. */ }
    if (target) break
    await sleep(200)
  }
  assert.ok(target, 'Creator and Chrome started')
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
  let id = 0
  const pending = new Map()
  ws.onmessage = event => {
    const msg = JSON.parse(event.data)
    if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text)
    if (pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
  }
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const key = ++id
    const timer = setTimeout(() => { pending.delete(key); reject(new Error(`Timeout: ${method}`)) }, 15000)
    pending.set(key, msg => { clearTimeout(timer); msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result) })
    ws.send(JSON.stringify({ id: key, method, params }))
  })
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
  const wait = async (expression, label) => {
    for (let i = 0; i < 90; i++) { if (await evaluate(expression)) return; await sleep(150) }
    throw new Error(`Timeout: ${label}`)
  }
  const click = async selector => { await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); await sleep(150) }
  const setInput = async (selector, value) => { await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('input',{bubbles:true}));return true})()`); await sleep(100) }
  const shot = async name => { await sleep(250); const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); fs.writeFileSync(path.join(shots, `x-search-${name}.png`), Buffer.from(result.data, 'base64')) }
  const check = async (expression, label) => { assert.ok(await evaluate(expression), label); console.log('PASS', label) }
  await send('Runtime.enable'); await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url: `http://127.0.0.1:${port}/` })
  await wait('Boolean(document.querySelector(\'[data-testid="new-sample"]\'))', 'project list')
  await click('[data-testid="new-sample"]')
  await wait('location.hash.endsWith("/overview")', 'sample work')
  const projectId = await evaluate('location.hash.split("/")[2]')
  await evaluate(`location.hash='#/p/${projectId}/apps/x'`)
  await wait('Boolean(document.querySelector("#x-trends-tab"))', 'X tabs')
  await evaluate(`import('/src/stores/project.js').then(module=>{window.__editor=module.useProjectStore();return true})`)
  await click('#x-trends-tab')
  await check('document.querySelectorAll(".xse__row").length===3', 'authored trends in editor')
  await click('[data-testid="x-search-add"]')
  await setInput('[data-testid="x-trend-title"]', '浏览器验证趋势')
  await setInput('[data-testid="x-trend-count"]', '12000')
  await check('document.querySelector(".xsf").textContent.includes("1.2万 帖子")', 'numeric count formats with automatic label')
  await setInput('[data-testid="x-trend-count"]', '')
  await check('__editor.project.appData.x.trends.at(-1).postCount===null', 'blank count remains absent')
  await setInput('[data-testid="x-trend-count"]', '800')
  await evaluate('document.querySelector(".xse__row:last-child .xse__arrows button").click()')
  await check('__editor.project.appData.x.trends[2].title==="浏览器验证趋势"', 'row arrow updates persisted order')
  await check('document.querySelector(".xse__row:nth-child(3)").textContent.includes("示例分类")', 'blank category inherits first trend')
  // Drag the newly added trend one place upwards with actual input events.
  const point = index => evaluate(`(()=>{const rect=document.querySelectorAll('.xse__choose')[${index}].getBoundingClientRect();return {x:rect.x+rect.width/2,y:rect.y+rect.height/2}})()`)
  let from = await point(2), to = await point(1)
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...from, button: 'left', clickCount: 1 })
  await sleep(500)
  await check('Boolean(document.querySelector(".is-dragging"))', 'mouse hold activates dragging')
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...to, buttons: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...to, button: 'left', clickCount: 1 })
  await check('__editor.project.appData.x.trends[1].title==="浏览器验证趋势"', 'mouse drop saves new position')
  await shot('creator-trends')
  await evaluate('__editor.flush()')
  await reloadAndWait({ evaluate, reload: () => send('Page.reload') }, 'Boolean(document.querySelector("#x-trends-tab"))', 'saved project reload')
  await click('#x-trends-tab')
  await check('document.querySelectorAll(".xse__row")[1].textContent.includes("浏览器验证趋势")', 'edits survive reload')
  await click('#x-searchHistory-tab')
  await click('[data-testid="x-search-add"]')
  await setInput('[data-testid="x-history-title"]', '功能展示记录')
  await shot('creator-history')
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false })
  await sleep(200)
  await check('document.querySelectorAll(".xse__row")[0].getBoundingClientRect().width>330', 'narrow screen uses full-width vertical list')
  await shot('mobile-list')
  await evaluate('document.querySelectorAll(".xse__choose")[1].click()')
  await check('document.querySelector(".xse__drawer").open', 'mobile account editor opens card drawer')
  await check('getComputedStyle(document.querySelector(".xse__drawer")).scrollbarWidth==="none"', 'drawer scrollbar is hidden')
  await shot('mobile-drawer')
  await click('.xse__drawer>header button')
  // Touch long-press must sort without opening the edit drawer.
  from = await point(2); to = await point(0)
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] })
  await sleep(500)
  await check('Boolean(document.querySelector(".is-dragging"))', 'touch hold activates dragging')
  await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [to] })
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await check('document.querySelectorAll(".xse__row")[0].textContent.includes("功能展示记录")&&!document.querySelector(".xse__drawer").open', 'touch sort commits without opening drawer')
  await evaluate(`import('/src/stores/project.js').then(async module=>{window.__editor=module.useProjectStore();await __editor.flush();return true})`)
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false })
  await evaluate(`location.hash='#/p/${projectId}/preview'`)
  await wait('Boolean(document.querySelector(\'[data-testid="preview-frame"]\')?.contentDocument?.querySelector(".pui-root"))', 'real player preview')
  await evaluate('window.__doc=()=>document.querySelector(\'[data-testid="preview-frame"]\').contentDocument')
  const frameClick = async selector => { await evaluate(`__doc().querySelector(${JSON.stringify(selector)}).click()`); await sleep(250) }
  await wait('Boolean(__doc().querySelector(\'[data-testid="lock-hint"]\'))', 'lock screen')
  await frameClick('[data-testid="lock-hint"]')
  await wait('Boolean(__doc().querySelector(\'[data-testid="home-app-x"]\'))', 'phone home')
  await frameClick('[data-testid="home-app-x"]')
  await frameClick('[data-testid="x-tab-search"]')
  await check('Boolean(__doc().querySelector(\'[data-testid="x-trends-screen"]\'))', 'home bottom search opens trends')
  await check('__doc().querySelectorAll(".xs__trend").length===4', 'player uses edited and exported trends')
  await check('__doc().querySelectorAll(".xs__trend")[1].textContent.includes("浏览器验证趋势")', 'player preserves author order')
  await check('(()=>{const doc=__doc(),screen=doc.querySelector(".xs"),pill=doc.querySelector(".xs__search-pill");return pill.getBoundingClientRect().top-screen.getBoundingClientRect().top>=parseFloat(doc.defaultView.getComputedStyle(doc.documentElement).getPropertyValue("--pui-statusbar-h"))})()', 'explore header clears the phone status bar')
  await shot('player-trends')
  await frameClick('[data-testid="x-explore-search"]')
  await check('Boolean(__doc().querySelector(\'[data-testid="x-search-screen"]\'))', 'top search opens recent search page')
  await check('(()=>{const doc=__doc(),screen=doc.querySelector(".xs"),input=doc.querySelector(".xs__searchbar input");return input.getBoundingClientRect().top-screen.getBoundingClientRect().top>=parseFloat(doc.defaultView.getComputedStyle(doc.documentElement).getPropertyValue("--pui-statusbar-h"))})()', 'search header clears the phone status bar')
  await check('__doc().querySelectorAll(".xs__recent li")[0].textContent.includes("功能展示记录")', 'authored search history reaches player')
  await shot('player-recent')
  await frameClick('.xs__recent li:last-child .xs__recent-open')
  await check('Boolean(__doc().querySelector(\'[data-testid="x-profile-screen"]\'))', 'account history opens actual character profile')
  await frameClick('[data-testid="nav-back"]')
  await frameClick('.xs__recent li:nth-child(2) .xs__recent-open')
  await check('__doc().querySelectorAll(".xs__posts li").length>0', 'keyword history searches real posts')
  await shot('player-results')
  await frameClick('.xs__posts [data-testid="x-post-item"]')
  await check('Boolean(__doc().querySelector(\'[data-testid="x-post-screen"]\'))', 'search result opens post detail')
  await frameClick('[data-testid="nav-back"]')
  await check('__doc().querySelector(\'[data-testid="x-search-input"]\').value==="示例"', 'back from detail preserves query')
  await evaluate(`__doc().querySelector('[data-testid="x-search-input"]').focus()`)
  await sleep(120)
  await frameClick('[aria-label="清空搜索词"]')
  await frameClick('[data-testid="x-history-clear"]')
  await check('__doc().querySelectorAll(".xs__recent li").length===0', 'reader can clear recent searches locally')
  await check('__editor.project.appData.x.searchHistory.length===3', 'reader actions do not modify authored history')
  const project = await evaluate('JSON.parse(JSON.stringify(__editor.project))')
  const exported = await exportStandaloneHtml({ project, player: { js: fs.readFileSync(path.join(root, 'apps/player/dist/renderer.js'), 'utf8'), css: fs.readFileSync(path.join(root, 'apps/player/dist/renderer.css'), 'utf8') } })
  const exportedPath = path.join(shots, 'x-search-export.html')
  fs.writeFileSync(exportedPath, exported.bytes)
  await send('Page.navigate', { url: pathToFileURL(exportedPath).href })
  await wait('location.protocol==="file:" && Boolean(document.querySelector(\'[data-testid="lock-hint"]\'))', 'exported standalone work')
  await evaluate('window.__doc=()=>document')
  await frameClick('[data-testid="lock-hint"]')
  await wait('Boolean(document.querySelector(\'[data-testid="home-app-x"]\'))', 'exported work unlock')
  await frameClick('[data-testid="home-app-x"]')
  await wait('Boolean(document.querySelector(\'[data-testid="x-tab-search"]\'))', 'exported X home')
  await frameClick('[data-testid="x-tab-search"]')
  await check('document.querySelectorAll(".xs__trend").length===4', 'exported HTML opens edited trends offline')
  await frameClick('[data-testid="x-explore-search"]')
  await check('document.querySelectorAll(".xs__recent li").length===3', 'exported HTML retains authored history after reader cleared preview')
  await frameClick('.xs__recent li:nth-child(2) .xs__recent-open')
  await check('document.querySelectorAll(".xs__posts li").length>0', 'exported HTML search works offline')
  assert.deepEqual(errors, [], 'No uncaught browser errors')
  console.log('PASS all X search browser flows')
  await send('Browser.close')
} finally {
  ws?.close(); chrome.kill(); dev.kill()
}
