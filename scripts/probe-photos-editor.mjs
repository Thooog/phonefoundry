

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
  console.error('[m5-photos] 未找到 Chrome：' + CHROME)
  process.exit(2)
}

const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-sim-m5photos-'))
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
    '--window-size=960,960',
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
  function send(method, params = {}, timeoutMs = 30000) {
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

console.log('\n[m5-photos] 照片编辑器端到端\n')

const BOOTSTRAP = `
(async () => {
  const { useProjectsStore } = await import('/src/stores/projects.js');
  const { useProjectStore } = await import('/src/stores/project.js');
  const { useUiStore } = await import('/src/stores/ui.js');
  const repo = await import('/src/db/repository.js');
  window.__projects = useProjectsStore();
  window.__editor = useProjectStore();
  window.__ui = useUiStore();
  window.__repo = repo;
  window.__pageErrors = [];
  window.addEventListener('error', (e) => window.__pageErrors.push(String(e.message)));
  window.addEventListener('unhandledrejection', (e) => window.__pageErrors.push(String(e.reason)));

  window.__makeImageFile = async (width, height, alpha) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (alpha) {
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = 'rgb(200, 60, 60)';
      ctx.beginPath();
      ctx.arc(width / 2, height / 2, Math.min(width, height) / 3, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = '#3a6ea5';
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#f0c060';
      for (let i = 0; i < 40; i += 1) {
        ctx.fillRect((i * 137) % width, (i * 89) % height, 140, 100);
      }
    }
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    return new File([blob], alpha ? 'alpha.png' : 'photo.png', { type: 'image/png' });
  };

  window.__uploadOne = (file) => {
    const input = document.querySelector('[data-testid="upload-input"]');
    if (!input) throw new Error('没找到上传输入框');
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return file.name;
  };
  return 'ok';
})()
`

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

  const waitFor = async (expression, label, timeoutMs = 25000) => {
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

  /** 留一张现场图给人工目视确认（不影响断言） */
  const shot = async (name) => {
    const res = await session.send('Page.captureScreenshot', { format: 'png' })
    const dir = path.join(ROOT, '_shots')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, `${name}.png`), Buffer.from(res.data, 'base64'))
    console.log('saved', path.join(dir, `${name}.png`))
  }

  await waitFor(`document.readyState === 'complete' && Boolean(document.querySelector('h1'))`, '首屏')
  await session.send('Page.navigate', { url: `http://127.0.0.1:${DEV_PORT}/` })
  await waitFor(
    `location.protocol === 'http:' && location.port === '${DEV_PORT}' && Boolean(document.querySelector('#app'))`,
    '页面真正加载',
  )

  // 从干净库开始
  await evaluate(`(async () => {
    const conn = await import('/src/db/connection.js');
    try { await conn.deleteDatabase(); } catch {}
    return 'ok';
  })()`)
  await session.send('Page.reload', { ignoreCache: true })
  // 必须等 reload 真的走完再注入：只判 readyState + h1 会命中"重载前的旧 DOM"，
  // 于是注入打到了刚销毁的上下文上，表现为 Pinia 说"没有 active pinia"。
  await sleep(1200)
  await waitFor(
    `document.readyState === 'complete' && Boolean(document.querySelector('.projects'))`,
    '重载',
  )
  if ((await evaluate(BOOTSTRAP)) !== 'ok') throw new Error('注入失败')

  // 建项目 → 打开 → 进照片页
  const prjId = await evaluate(`(async () => {
    const p = await window.__projects.create({ name: ' 照片切片' });
    await window.__editor.open(p.id);
    location.hash = '#/p/' + p.id + '/apps/photos';
    return p.id;
  })()`)
  await waitFor(`Boolean(document.querySelector('[data-testid="photos-editor"]'))`, '照片编辑器')
  console.log(`  · 项目 ${prjId}\n`)

  record(
    " 照片页渲染出编辑器（不再是只读计数页）",
    (await evaluate(`Boolean(document.querySelector('[data-testid="photos-editor"]'))`)) === true,
  )

  record(
    " 空项目显示引导而不是一片空白",
    (await evaluate(
      `Boolean(document.querySelector('[data-testid="photos-empty"]')) && !document.querySelector('[data-testid="photo-row"]')`,
    )) === true,
    '空状态文案 + 无照片行',
  )

  record(
    " 初始素材占用为 0",
    (await evaluate(`document.querySelector('[data-testid="photos-usage"]').textContent.trim()`)) ===
      '共0B',
  )

  /* ── ① 上传一张 2400×1800 的不透明 PNG ─────────── */

  await evaluate(`(async () => {
    const file = await window.__makeImageFile(2400, 1800, false);
    window.__uploadOne(file);
    return 'ok';
  })()`)
  await waitFor(`document.querySelectorAll('[data-testid="photo-row"]').length === 1`, '第一张照片')

  const first = await evaluate(`(() => {
    const a = window.__editor.project.assets[0];
    const p = window.__editor.project.appData.photos.photos[0];
    return {
      width: a.width, height: a.height, mimeType: a.mimeType,
      byteSize: a.byteSize, hasAlpha: a.hasAlpha,
      fileName: a.fileName, photoCount: window.__editor.project.appData.photos.photos.length,
      imageAssetId: p.imageAssetId, displayTime: p.displayTime,
    };
  })()`)

  record(
    " 长边被缩到 1600（2400×1800 → 1600×1200）",
    first.width === 1600 && first.height === 1200,
    `${first.width}×${first.height}`,
  )

  record(
    " 转成了 WebP",
    first.mimeType === 'image/webp',
    `${first.mimeType} · ${Math.round(first.byteSize / 1024)}KB`,
  )

  record(
    " 不透明图没有被误判成带 alpha",
    first.hasAlpha === false,
  )

  record(
    " 照片记录指向刚存下的资源",
    first.imageAssetId === (await evaluate(`window.__editor.project.assets[0].id`)),
  )

  record(
    " 拍摄时间取自文件修改时间，是合法时间串",
    typeof first.displayTime === 'string' && !Number.isNaN(Date.parse(first.displayTime)),
    first.displayTime,
  )

  /* ── ①b 说明预填文件名，点进去清空 ─────────────── */

  const presetCaption = await evaluate(`window.__editor.project.appData.photos.photos[0].caption`)
  record(
    " 导入时用文件名（去扩展名）预填说明",
    presetCaption === 'photo',
    `"${presetCaption}"`,
  )

  await evaluate(`document.querySelector('[data-testid="photo-row"] .prow__thumb').click()`)
  await waitFor(`Boolean(document.querySelector('dialog.inspector-panel[open]'))`, '单张照片属性面板')
  const focused = await evaluate(`(async () => {
    const input = document.querySelector('[data-testid="photo-caption"]');
    input.focus();
    await new Promise((r) => requestAnimationFrame(() => r()));
    return { active: document.activeElement === input, value: input.value };
  })()`)
  record(
    " 点进说明框时默认名被清空",
    focused.active === true && focused.value === '',
    `"${focused.value}"`,
  )

  const blurred = await evaluate(`(async () => {
    const input = document.querySelector('[data-testid="photo-caption"]');
    input.blur();
    await new Promise((r) => requestAnimationFrame(() => r()));
    return { value: input.value, data: window.__editor.project.appData.photos.photos[0].caption };
  })()`)
  record(
    " 什么都没写就离开：默认名回来，数据一次没动",
    blurred.value === 'photo' && blurred.data === 'photo',
    `"${blurred.value}"`,
  )

  await evaluate(`document.querySelector('.photo-done').click()`)
  /* ── ② 上传一张带透明通道的图 ─────────────────── */

  await evaluate(`(async () => {
    const file = await window.__makeImageFile(1200, 900, true);
    window.__uploadOne(file);
    return 'ok';
  })()`)
  await waitFor(`document.querySelectorAll('[data-testid="photo-row"]').length === 2`, '第二张照片')

  const second = await evaluate(`(() => {
    const a = window.__editor.project.assets[1];
    return { width: a.width, height: a.height, hasAlpha: a.hasAlpha, mimeType: a.mimeType };
  })()`)

  record(
    " 带透明的图保住了 alpha",
    second.hasAlpha === true,
    `${second.mimeType} · ${second.width}×${second.height}`,
  )

  record(
    " 小于上限的图不放大",
    second.width === 1200 && second.height === 900,
    `${second.width}×${second.height}`,
  )

  /* ── ③ 说明 / 时间 / 收藏 ─────────────────────── */
  await evaluate(`document.querySelector('[data-testid="photo-row"] .prow__thumb').click()`)
  await waitFor(`Boolean(document.querySelector('dialog.inspector-panel[open]'))`, '选中照片属性')

  await evaluate(`(() => {
    const rows = document.querySelectorAll('[data-testid="photo-row"]');
    // 列表按时间倒序，第二张（alpha.png）的修改时间更晚，所以在第一行
    const row = rows[0];
    const caption = document.querySelector('[data-testid="photo-caption"]');
    caption.value = '宿舍窗外的第一场雨';
    caption.dispatchEvent(new Event('change', { bubbles: true }));
    return 'ok';
  })()`)
  await sleep(200)

  const captioned = await evaluate(
    `window.__editor.project.appData.photos.photos.filter((p) => p.caption === '宿舍窗外的第一场雨').length`,
  )
  record(" 说明真的写进了项目对象", captioned === 1)

  const ownCaptionKept = await evaluate(`(async () => {
    const input = document.querySelector('[data-testid="photo-caption"]');
    input.focus();
    await new Promise((r) => requestAnimationFrame(() => r()));
    const value = input.value;
    input.blur();
    return value;
  })()`)
  record(
    " 自己写过的说明不会被当成默认名清掉",
    ownCaptionKept === '宿舍窗外的第一场雨',
    `"${ownCaptionKept}"`,
  )

  await evaluate(`(() => {
    const row = document.querySelectorAll('[data-testid="photo-row"]')[0];
    const time = document.querySelector('[data-testid="photo-time"]');
    time.value = '2026-07-14T20:30';
    time.dispatchEvent(new Event('change', { bubbles: true }));
    return 'ok';
  })()`)
  await sleep(200)

  const timed = await evaluate(`(() => {
    const p = window.__editor.project.appData.photos.photos.find((x) => x.caption === '宿舍窗外的第一场雨');
    const d = new Date(p.displayTime);
    return { y: d.getFullYear(), m: d.getMonth() + 1, day: d.getDate(), h: d.getHours(), min: d.getMinutes() };
  })()`)
  record(
    " 拍摄时间按本地时区解析（不是差八小时的 UTC）",
    timed.y === 2026 && timed.m === 7 && timed.day === 14 && timed.h === 20 && timed.min === 30,
    `${timed.y}-${timed.m}-${timed.day} ${timed.h}:${timed.min}`,
  )

  await evaluate(
    `document.querySelector('[aria-label="加入个人收藏"]').click()`,
  )
  await sleep(200)
  const favorited = await evaluate(
    `window.__editor.project.appData.photos.photos.filter((p) => p.isFavorite).length`,
  )
  record(" 收藏标记写进数据（作品端的「个人收藏」相簿靠它）", favorited === 1)

  await evaluate(`document.querySelector('.photo-done').click()`)
  /* ── ③b 多选与批量改地点 / 时间 ─────────────── */

  await evaluate(`(() => {
    document.querySelectorAll('[data-testid="photo-select"]').forEach((el) => el.click());
    return 'ok';
  })()`)
  await waitFor(`Boolean(document.querySelector('[data-testid="photo-batch"]'))`, '批量条')

  record(
    " 勾选两张后批量条出现并报出数量",
    (await evaluate(
      `document.querySelector('[data-testid="photo-batch-count"]').textContent.trim()`,
    )) === '已选 2 张',
    await evaluate(`document.querySelector('[data-testid="photo-batch-count"]').textContent.trim()`),
  )

  record(
    " 两个字段都为空时「应用」禁用",
    (await evaluate(`document.querySelector('[data-testid="photo-batch-apply"]').disabled`)) ===
      true,
  )

  const combinedBatch = await evaluate(`(async () => {
    const rev = window.__editor.project.revision;
    for (const [field, value] of [['location', '临时地点'], ['time', '2026-07-13T12:00']]) {
      const input = document.querySelector('[data-testid="photo-batch-' + field + '"]');
      input.value = value; input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await new Promise(r => requestAnimationFrame(r));
    document.querySelector('[data-testid="photo-batch-apply"]').click();
    await new Promise(r => requestAnimationFrame(r));
    return window.__editor.project.revision === rev + 1 && window.__editor.project.appData.photos.photos.every(p => p.location === '临时地点' && new Date(p.displayTime).getDate() === 13);
  })()`)
  record('两个字段一次应用，只产生一次修改', combinedBatch)

  const batchLoc = await evaluate(`(async () => {
    const revBefore = window.__editor.project.revision;
    const timesBefore = window.__editor.project.appData.photos.photos.map(p => p.displayTime);
    const input = document.querySelector('[data-testid="photo-batch-location"]');
    input.value = '学校 · 三号宿舍楼';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => requestAnimationFrame(() => r()));
    document.querySelector('[data-testid="photo-batch-apply"]').click();
    await new Promise((r) => requestAnimationFrame(() => r()));
    const photos = window.__editor.project.appData.photos.photos;
    return {
      revDelta: window.__editor.project.revision - revBefore,
      withLocation: photos.filter((p) => p.location === '学校 · 三号宿舍楼').length,
      total: photos.length,
      cleared: input.value === '',
      timesUnchanged: photos.every((p, index) => p.displayTime === timesBefore[index]),
    };
  })()`)

  record(
    " 批量改地点：两张都写进去，且只涨一次 revision",
    batchLoc.withLocation === 2 && batchLoc.total === 2 && batchLoc.revDelta === 1 && batchLoc.timesUnchanged,
    `地点 ${batchLoc.withLocation}/${batchLoc.total} · revision +${batchLoc.revDelta}`,
  )

  record(" 应用后输入框清空，接着能设下一个地点", batchLoc.cleared === true)

  const batchTime = await evaluate(`(async () => {
    const revBefore = window.__editor.project.revision;
    const input = document.querySelector('[data-testid="photo-batch-time"]');
    input.value = '2026-07-14T20:30';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => requestAnimationFrame(() => r()));
    document.querySelector('[data-testid="photo-batch-apply"]').click();
    await new Promise((r) => requestAnimationFrame(() => r()));
    const photos = window.__editor.project.appData.photos.photos;
    const same = photos.filter((p) => {
      const d = new Date(p.displayTime);
      return d.getFullYear() === 2026 && d.getMonth() === 6 && d.getDate() === 14
        && d.getHours() === 20 && d.getMinutes() === 30;
    }).length;
    return { same, total: photos.length, revDelta: window.__editor.project.revision - revBefore };
  })()`)

  record(
    " 批量改时间：两张统一到同一时刻，只涨一次 revision",
    batchTime.same === 2 && batchTime.total === 2 && batchTime.revDelta === 1,
    `同一时刻 ${batchTime.same}/${batchTime.total} · revision +${batchTime.revDelta}`,
  )

  await evaluate(`document.querySelector('[data-testid="photo-batch-clear"]').click()`)
  await waitFor(`!document.querySelector('[data-testid="photo-batch"]')`, '取消选择后收起')
  record(
    " 取消选择后批量条收起，不会常驻占地方",
    (await evaluate(`Boolean(document.querySelector('[data-testid="photo-batch"]'))`)) === false,
  )

  await evaluate(`document.querySelector('#photo-tab-albums').click()`)
  await sleep(100)
  await evaluate(`document.querySelector('[data-testid=album-create-toggle]').click()`)
  await sleep(100)
  /* ── ④ 相簿 ──────────────────────────────────── */

  await evaluate(`(() => {
    const input = document.querySelector('[data-testid="album-name-input"]');
    input.value = '那年的夏天';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return 'ok';
  })()`)
  await sleep(120)
  await evaluate(`document.querySelector('[data-testid="album-create"]').click()`)
  await waitFor(`Boolean(document.querySelector('[data-testid="album-row"]'))`, '相簿行')

  record(
    " 新建相簿",
    (await evaluate(`window.__editor.project.appData.photos.albums.length`)) === 1,
    await evaluate(`window.__editor.project.appData.photos.albums[0].name`),
  )

  await waitFor(
    `document.querySelectorAll('[data-testid="album-candidate"]').length === 2`,
    '相簿候选',
  )
  record(
    " 展开相簿列出全部候选照片",
    (await evaluate(`document.querySelectorAll('[data-testid="album-candidate"]').length`)) === 2,
  )

  await evaluate(`(() => {
    document.querySelectorAll('[data-testid="album-candidate"]')[0].click();
    return 'ok';
  })()`)
  await sleep(250)

  record(
    " 点一下就加进相簿",
    (await evaluate(`window.__editor.project.appData.photos.albums[0].photoIds.length`)) === 1,
    `成员 ${await evaluate(`document.querySelectorAll('[data-testid="album-members"] .thumb').length`)} 张`,
  )

  record(
    " 加进去之后候选少一个（不会重复加）",
    (await evaluate(`document.querySelectorAll('[data-testid="album-candidate"]').length`)) === 1,
  )

  /* ── ④b 回收站：移进去的照片不进「从图库添加」 ── */
  const trashTargetId = await evaluate(`(() => {
    const bucket = window.__editor.project.appData.photos;
    const inAlbum = new Set(bucket.albums[0].photoIds);
    return bucket.photos.find((p) => !inAlbum.has(p.id))?.id ?? '';
  })()`)
  const trashRowSel = `[data-testid="photo-row"][data-photo-id="${trashTargetId}"]`

  await evaluate(`document.querySelector('#photo-tab-library').click()`)
  await sleep(180)
  await evaluate(`document.querySelector('${trashRowSel} .prow__thumb').click()`)
  await waitFor(`Boolean(document.querySelector('[data-testid="photo-trash-toggle"]'))`, '回收站开关')
  await evaluate(`document.querySelector('[data-testid="photo-trash-toggle"]').click()`)
  await sleep(220)

  const trashedState = await evaluate(`(() => {
    const bucket = window.__editor.project.appData.photos;
    const p = bucket.photos.find((x) => x.id === ${JSON.stringify(trashTargetId)});
    return {
      isInTrash: Boolean(p?.isInTrash),
      rows: document.querySelectorAll('[data-testid="photo-row"]').length,
    };
  })()`)
  record(
    " 回收站开关写进数据，且照片记录没有被删掉",
    trashedState.isInTrash === true && trashedState.rows === 2,
    `isInTrash=${trashedState.isInTrash} · 图库仍 ${trashedState.rows} 行`,
  )

  await evaluate(`document.querySelector('#photo-tab-albums').click()`)
  await sleep(180)
  const candidatesWhileTrashed = await evaluate(
    `document.querySelectorAll('[data-testid="album-candidate"]').length`,
  )
  record(
    " 移进回收站后不出现在「从图库添加」里",
    candidatesWhileTrashed === 0,
    `候选 ${candidatesWhileTrashed} 张`,
  )

  // 后面的落盘 / 删除断言都按「两张都在」写死，验完必须还原
  await evaluate(`document.querySelector('#photo-tab-library').click()`)
  await sleep(180)
  await evaluate(`document.querySelector('${trashRowSel} .prow__thumb').click()`)
  await waitFor(`Boolean(document.querySelector('[data-testid="photo-trash-toggle"]'))`, '恢复开关')
  await evaluate(`document.querySelector('[data-testid="photo-trash-toggle"]').click()`)
  await sleep(220)
  await evaluate(`document.querySelector('#photo-tab-albums').click()`)
  await sleep(180)
  record(
    " 恢复后候选回来，且不再有照片留在回收站",
    (await evaluate(`document.querySelectorAll('[data-testid="album-candidate"]').length`)) === 1 &&
      (await evaluate(
        `window.__editor.project.appData.photos.photos.filter((p) => p.isInTrash).length`,
      )) === 0,
  )

  /* ── ④c 已隐藏：开关写进数据、行上挂角标，且不进「从图库添加」 ── */
  const hiddenRowSel = `[data-testid="photo-row"][data-photo-id="${trashTargetId}"]`

  await evaluate(`document.querySelector('#photo-tab-library').click()`)
  await sleep(180)
  await evaluate(`document.querySelector('${hiddenRowSel} .prow__thumb').click()`)
  await waitFor(`Boolean(document.querySelector('[data-testid="photo-hidden-toggle"]'))`, '已隐藏开关')
  await shot('photos-editor-hidden-off')

  const iconOff = await evaluate(`(() => {
    const btn = document.querySelector('[data-testid="photo-hidden-toggle"]');
    return { on: btn.dataset.on, paths: btn.querySelectorAll('svg path').length };
  })()`)
  await evaluate(`document.querySelector('[data-testid="photo-hidden-toggle"]').click()`)
  await sleep(220)
  await shot('photos-editor-hidden-on')
  const iconOn = await evaluate(`(() => {
    const btn = document.querySelector('[data-testid="photo-hidden-toggle"]');
    return { on: btn.dataset.on, paths: btn.querySelectorAll('svg path').length };
  })()`)
  record(
    " 未隐藏时是普通眼睛、未点亮",
    iconOff.on === 'false' && iconOff.paths === 1,
    `data-on=${iconOff.on} · path ${iconOff.paths} 条`,
  )
  record(
    " 点亮＝已隐藏，图标是划掉的眼睛",
    iconOn.on === 'true' && iconOn.paths === 2,
    `data-on=${iconOn.on} · path ${iconOn.paths} 条`,
  )

  const hiddenState = await evaluate(`(() => {
    const bucket = window.__editor.project.appData.photos;
    const p = bucket.photos.find((x) => x.id === ${JSON.stringify(trashTargetId)});
    const row = document.querySelector('${hiddenRowSel}');
    return {
      isHidden: Boolean(p?.isHidden),
      rows: document.querySelectorAll('[data-testid="photo-row"]').length,
      rowFlag: row?.dataset.hidden ?? '',
      badge: Boolean(row?.querySelector('.prow__hidden-flag')),
    };
  })()`)
  record(
    " 已隐藏开关写进数据，照片记录不删、行上挂角标",
    hiddenState.isHidden === true && hiddenState.rows === 2 &&
      hiddenState.rowFlag === 'true' && hiddenState.badge === true,
    `isHidden=${hiddenState.isHidden} · 图库仍 ${hiddenState.rows} 行 · 角标=${hiddenState.badge}`,
  )

  await evaluate(`document.querySelector('#photo-tab-albums').click()`)
  await sleep(180)
  const candidatesWhileHidden = await evaluate(
    `document.querySelectorAll('[data-testid="album-candidate"]').length`,
  )
  record(
    " 隐藏后不出现在「从图库添加」里",
    candidatesWhileHidden === 0,
    `候选 ${candidatesWhileHidden} 张`,
  )

  // 后面的落盘 / 删除断言都按「两张都在」写死，验完必须还原
  await evaluate(`document.querySelector('#photo-tab-library').click()`)
  await sleep(180)
  await evaluate(`document.querySelector('${hiddenRowSel} .prow__thumb').click()`)
  await waitFor(`Boolean(document.querySelector('[data-testid="photo-hidden-toggle"]'))`, '取消隐藏开关')
  await evaluate(`document.querySelector('[data-testid="photo-hidden-toggle"]').click()`)
  await sleep(220)
  const unhidden = await evaluate(`(() => {
    const bucket = window.__editor.project.appData.photos;
    const p = bucket.photos.find((x) => x.id === ${JSON.stringify(trashTargetId)});
    return {
      isHidden: Boolean(p?.isHidden),
      badges: document.querySelectorAll('.prow__hidden-flag').length,
    };
  })()`)
  record(
    " 取消隐藏后标记清空、角标消失",
    unhidden.isHidden === false && unhidden.badges === 0,
    `isHidden=${unhidden.isHidden} · 残留角标 ${unhidden.badges}`,
  )

  /* ── ④d 角标改图标：造出「收藏 + 已隐藏 + 回收站」三种状态同时存在的行 ── */
  const flagsBefore = await evaluate(`(() => {
    const p = window.__editor.project.appData.photos.photos.find((x) => x.id === ${JSON.stringify(trashTargetId)});
    return { favorite: Boolean(p?.isFavorite), hidden: Boolean(p?.isHidden), trash: Boolean(p?.isInTrash) };
  })()`)

  await evaluate(`document.querySelector('${hiddenRowSel} .prow__thumb').click()`)
  await waitFor(`Boolean(document.querySelector('.photo-favorite'))`, '三标记详情面板')
  // 用 class / testid 定位：按钮的 aria-label 会随状态改，class 不会
  if (!flagsBefore.favorite) { await evaluate(`document.querySelector('.photo-favorite').click()`); await sleep(160) }
  if (!flagsBefore.hidden) { await evaluate(`document.querySelector('[data-testid="photo-hidden-toggle"]').click()`); await sleep(160) }
  if (!flagsBefore.trash) { await evaluate(`document.querySelector('[data-testid="photo-trash-toggle"]').click()`); await sleep(160) }

  const iconBadges = await evaluate(`(() => {
    const row = document.querySelector('${hiddenRowSel}');
    const spans = [...row.querySelectorAll('.prow__flags span')];
    const box = spans[0] ? getComputedStyle(spans[0]) : null;
    return {
      count: spans.length,
      classes: spans.map((s) => s.className).join(','),
      withSvg: spans.filter((s) => s.querySelector('svg')).length,
      text: spans.map((s) => s.textContent.trim()).join(''),
      round: box?.borderRadius ?? '',
      size: box ? box.width + 'x' + box.height : '',
      pointer: getComputedStyle(row.querySelector('.prow__flags')).pointerEvents,
      heart: document.querySelector('.photo-favorite svg path')?.getAttribute('d')?.startsWith('M12 20.2') ?? false,
      title: row.querySelector('.prow__thumb')?.getAttribute('title') ?? '',
    };
  })()`)
  record(
    " 三个状态角标都是圆形图标徽标（无文字、20px、不拦截点击）",
    iconBadges.count === 3 && iconBadges.withSvg === 3 && iconBadges.text === '' &&
      iconBadges.round === '50%' && iconBadges.size === '20pxx20px' && iconBadges.pointer === 'none',
    `徽标 ${iconBadges.count} 个 · 含 svg ${iconBadges.withSvg} · 文字「${iconBadges.text}」· ${iconBadges.round} · ${iconBadges.size} · ${iconBadges.pointer} · ${iconBadges.classes}`,
  )
  record(
    " 收藏按钮换成心形，悬停提示补回角标含义",
    iconBadges.heart === true && iconBadges.title === '已收藏 · 已隐藏 · 在回收站',
    `心形=${iconBadges.heart} · title「${iconBadges.title}」`,
  )
  // 这个窗口宽度下详情面板是浮层，会盖住图库；收起再出图才拍得到三个角标
  await evaluate(`document.querySelector('.photo-detail-close').click()`)
  await sleep(220)
  await shot('photos-editor-flags-icons')
  await evaluate(`document.querySelector('${hiddenRowSel} .prow__thumb').click()`)
  await waitFor(`Boolean(document.querySelector('.photo-favorite'))`, '重开详情面板')

  // 收藏角标必须跟着开关出现 / 消失
  await evaluate(`document.querySelector('.photo-favorite').click()`)
  await sleep(200)
  const favBadgeOff = await evaluate(`document.querySelectorAll('${hiddenRowSel} .prow__favorite-flag').length`)
  await evaluate(`document.querySelector('.photo-favorite').click()`)
  await sleep(200)
  const favBadgeOn = await evaluate(`document.querySelectorAll('${hiddenRowSel} .prow__favorite-flag').length`)
  record(
    " 收藏角标随开关出现 / 消失",
    favBadgeOff === 0 && favBadgeOn === 1,
    `关=${favBadgeOff} · 开=${favBadgeOn}`,
  )

  // 还原成进入本段前的状态：后面的落盘 / 删除断言把收藏数写死成 1
  for (const [key, sel] of [['favorite', '.photo-favorite'], ['hidden', '[data-testid="photo-hidden-toggle"]'], ['trash', '[data-testid="photo-trash-toggle"]']]) {
    if (flagsBefore[key] === false) { await evaluate(`document.querySelector('${sel}').click()`); await sleep(160) }
  }

  await evaluate(`document.querySelector('#photo-tab-albums').click()`)
  await sleep(180)

  /* ── ⑤ 先确认改动都落盘了 ─────────────────────── */

  const persistedBefore = await evaluate(`(async () => {
    await window.__editor.flush();
    const raw = await window.__repo.getProject(window.__editor.projectId);
    const bucket = raw.appData.photos;
    const withCaption = bucket.photos.filter((p) => p.caption === '宿舍窗外的第一场雨');
    return {
      photos: bucket.photos.length,
      albums: bucket.albums.length,
      caption: withCaption[0]?.caption ?? '',
      favoriteCount: bucket.photos.filter((p) => p.isFavorite).length,
      locatedCount: bucket.photos.filter((p) => p.location === '学校 · 三号宿舍楼').length,
      albumMembers: bucket.albums[0]?.photoIds?.length ?? 0,
    };
  })()`)

  record(
    " 说明 / 收藏 / 相簿成员都已经落盘（不是只存在于内存）",
    persistedBefore.photos === 2 &&
      persistedBefore.albums === 1 &&
      persistedBefore.caption === '宿舍窗外的第一场雨' &&
      persistedBefore.favoriteCount === 1 &&
      persistedBefore.albumMembers === 1,
    `照片 ${persistedBefore.photos} · 相簿 ${persistedBefore.albums} · 收藏 ${persistedBefore.favoriteCount} · 成员 ${persistedBefore.albumMembers}`,
  )

  record(
    " 批量设的地点也一起落盘",
    persistedBefore.locatedCount === 2,
    `${persistedBefore.locatedCount} 张带地点`,
  )

  await evaluate(`document.querySelector('#photo-tab-library').click()`)
  await sleep(100)
  /* ── ⑥ 删照片 → 资源回收 ─────────────────────── */
  await evaluate(`document.querySelector('[data-testid="photo-row"] .prow__thumb').click()`)
  await waitFor(`Boolean(document.querySelector('dialog.inspector-panel[open]'))`, '删除前选中照片')

  const usageBefore = await evaluate(
    `document.querySelector('[data-testid="photos-usage"]').textContent.trim()`,
  )

  await evaluate(`(() => {
    document.querySelector('[data-testid="photo-remove"]').click();
    return 'ok';
  })()`)
  await waitFor(`Boolean(document.querySelector('[data-testid="confirm-ok"]'))`, '确认框')
  await evaluate(`document.querySelector('[data-testid="confirm-ok"]').click()`)
  await waitFor(`document.querySelectorAll('[data-testid="photo-row"]').length === 1`, '删掉一张')

  const afterDelete = await evaluate(`(async () => {
    await window.__editor.flush();
    const records = await window.__repo.listAssetRecords(window.__editor.projectId);
    return {
      photos: window.__editor.project.appData.photos.photos.length,
      assets: window.__editor.project.assets.length,
      blobs: records.length,
      albumMembers: window.__editor.project.appData.photos.albums[0].photoIds.length,
    };
  })()`)

  record(
    " 删照片同时把它从相簿里摘掉",
    afterDelete.photos === 1 && afterDelete.albumMembers === 0,
    `照片 ${afterDelete.photos} · 相簿成员 ${afterDelete.albumMembers}`,
  )

  record(
    " 删照片会回收资源（元信息与 blob 都少一条）",
    afterDelete.assets === 1 && afterDelete.blobs === 1,
    `assets ${afterDelete.assets} · IDB blob ${afterDelete.blobs}`,
  )

  const usageAfter = await evaluate(
    `document.querySelector('[data-testid="photos-usage"]').textContent.trim()`,
  )
  record(" 素材占用跟着下降", usageAfter !== usageBefore, `${usageBefore} → ${usageAfter}`)

  /* ── ⑦ 删除后的状态也落盘 ─────────────────────── */

  const persisted = await evaluate(`(async () => {
    await window.__editor.flush();
    const raw = await window.__repo.getProject(window.__editor.projectId);
    const bucket = raw.appData.photos;
    return {
      photos: bucket.photos.length,
      albums: bucket.albums.length,
      albumMembers: bucket.albums[0]?.photoIds?.length ?? 0,
      assets: raw.assets.length,
    };
  })()`)

  record(
    " 删除结果也落盘：照片少一张、相簿还在但已空",
    persisted.photos === 1 &&
      persisted.albums === 1 &&
      persisted.albumMembers === 0 &&
      persisted.assets === 1,
    `照片 ${persisted.photos} · 相簿 ${persisted.albums} · 成员 ${persisted.albumMembers} · assets ${persisted.assets}`,
  )

  /* ── ⑧ 作品端能读到（同一份数据换个渲染器） ──── */

  const workShape = await evaluate(`(async () => {
    const sharedUrl = '/@fs/' + ${JSON.stringify(
      path.join(ROOT, 'packages/shared/src/index.js').split(path.sep).join('/'),
    )};
    const { toWorkData, assertPlain } = await import(sharedUrl);
    const work = toWorkData(window.__editor.project);
    let plainOk = true;
    try { assertPlain(work); } catch { plainOk = false; }
    const photos = work.appData.photos.photos;
    return {
      count: photos.length,
      hasAssetId: photos.every((p) => Boolean(p.imageAssetId)),
      plainOk,
      jsonStable: JSON.stringify(JSON.parse(JSON.stringify(work))) === JSON.stringify(work),
      assetMetaKeys: Object.keys(work.assets[0] ?? {}).sort().join(','),
    };
  })()`)

  record(
    " toWorkData 能裁剪出作品数据，图片引用完整",
    workShape.count === 1 && workShape.hasAssetId === true,
    `${workShape.count} 张`,
  )

  record(
    " 作品数据是纯 JSON，可以安全 postMessage",
    workShape.plainOk === true && workShape.jsonStable === true,
  )

  record(
    " 资源的编辑态字段被裁掉（hasAlpha / originalAssetId 不进作品）",
    !workShape.assetMetaKeys.includes('hasAlpha') &&
      !workShape.assetMetaKeys.includes('originalAssetId'),
    workShape.assetMetaKeys,
  )

  /* ── ⑨ 加进来的图能被导出流水线收进去 ─────────── */

  const exportPlan = await evaluate(`(async () => {
    const { planAssetFiles } = await import('/@id/@phone-sim/exporter');
    const sharedUrl = '/@fs/' + ${JSON.stringify(
      path.join(ROOT, 'packages/shared/src/index.js').split(path.sep).join('/'),
    )};
    const { toWorkData } = await import(sharedUrl);
    const work = toWorkData(window.__editor.project);
    const records = await window.__repo.listAssetRecords(window.__editor.projectId);
    const blobs = new Map(records.map((r) => [r.assetId, r.blob]));
    const plan = planAssetFiles({ work, blobs });
    return {
      count: plan.assets.length,
      fileName: plan.assets[0]?.fileName ?? '',
      mimeType: plan.assets[0]?.mimeType ?? '',
      byteSize: plan.assets[0]?.blob?.size ?? 0,
      missing: plan.missing.length,
    };
  })()`)

  record(
    " 用户加的图进入了导出清单（带 .webp 扩展名与正确 mime）",
    exportPlan.count === 1 &&
      exportPlan.missing === 0 &&
      exportPlan.fileName.endsWith('.webp') &&
      exportPlan.mimeType === 'image/webp',
    `${exportPlan.fileName} · ${exportPlan.mimeType} · ${Math.round(exportPlan.byteSize / 1024)}KB`,
  )

  /* ── ⑨a 固定相簿：三个状态以普通相簿的形式管理 ───────── */

  await evaluate(`document.querySelector('#photo-tab-albums').click()`)
  await sleep(180)

  const statusList = await evaluate(`(() => {
    const rows = [...document.querySelectorAll('[data-testid="album-choice"]')];
    return {
      ids: rows.map((r) => r.dataset.albumId),
      builtins: rows.filter((r) => r.dataset.builtin === 'true').map((r) => r.dataset.albumId),
      groups: [...document.querySelectorAll('.photo-albums__group')].map((p) => p.textContent.trim()),
    };
  })()`)
  record(
    " 左侧常驻三本固定相簿，置顶单独一组",
    statusList.ids.slice(0, 3).join(',') === '__favorites__,__hidden__,__trash__' &&
      statusList.builtins.length === 3 &&
      statusList.groups.join(',') === '固定相簿,我的相簿',
    `ids=${statusList.ids.join('/')} · 分组=${statusList.groups.join('/')}`,
  )

  const statusCases = [
    { id: '__favorites__', heading: '移入收藏夹', flag: 'isFavorite' },
    { id: '__hidden__', heading: '移入隐藏相册', flag: 'isHidden' },
    { id: '__trash__', heading: '移入最近删除', flag: 'isInTrash' },
  ]

  for (const item of statusCases) {
    await evaluate(`document.querySelector('[data-album-id="${item.id}"]').click()`)
    await waitFor(`Boolean(document.querySelector('[data-testid="album-row"]'))`, `展开 ${item.heading}`)

    // 本来就有成员时先点 × 清干净：既能从「候选」开始点 ＋，也保证候选区标题
    // 一定渲染出来（收藏夹可能一进来候选就是空的，heading 节点都不存在）。
    const existing = await evaluate(`document.querySelectorAll('[data-testid="album-members"] .thumb').length`)
    for (let i = 0; i < existing; i += 1) {
      await evaluate(`document.querySelector('[data-testid="album-members"] .thumb').click()`)
      await sleep(140)
    }
    await waitFor(`Boolean(document.querySelector('[data-testid="album-candidate"]'))`, `${item.heading} 候选`)

    const view = await evaluate(`(() => ({
      heading: document.querySelector('[data-testid="album-candidates-heading"]')?.textContent.trim().split(' ')[0] ?? '',
      rename: Boolean(document.querySelector('[data-testid="album-rename"]')),
      remove: Boolean(document.querySelector('[data-testid="album-remove"]')),
    }))()`)
    record(
      `M5P-31 「${item.heading}」沿用普通相簿控件，不可改名 / 删除`,
      view.heading === item.heading && view.rename === false && view.remove === false,
      `标题=${view.heading} · 改名=${view.rename} · 删除=${view.remove}`,
    )

    await evaluate(`document.querySelector('[data-testid="album-candidate"]').click()`)
    await sleep(180)
    const joined = await evaluate(`window.__editor.project.appData.photos.photos.some((p) => p.${item.flag} === true)`)
    record(` 点 ＋ ${item.heading} 会写进标记`, joined === true, `${item.flag}=true`)

    await waitFor(`Boolean(document.querySelector('[data-testid="album-members"] .thumb'))`, `${item.heading} 成员`)
    await evaluate(`document.querySelector('[data-testid="album-members"] .thumb').click()`)
    await sleep(180)
    const left = await evaluate(`window.__editor.project.appData.photos.photos.every((p) => p.${item.flag} !== true)`)
    record(` 点 × 移出即清标记（${item.heading}）`, left === true, `${item.flag}=false`)

    if (item.id === '__trash__') await shot('photos-editor-status-albums')
  }

  await evaluate(`document.querySelector('[data-album-id]:not([data-builtin="true"])').click()`)
  await sleep(160)
  const normalHeading = await evaluate(`document.querySelector('[data-testid="album-candidates-heading"]')?.textContent.trim().split(' ')[0] ?? ''`)
  record(" 普通相簿仍是「从图库添加」", normalHeading === '从图库添加', normalHeading)

  await evaluate(`document.querySelector('#photo-tab-library').click()`)
  await sleep(160)

  /* ── ⑨b 批量删除：勾选 → 确认 → 连 blob 一起回收 ─ */

  await evaluate(`(() => {
    document.querySelector('[data-testid="photo-select"]').click();
    return 'ok';
  })()`)
  await waitFor(`Boolean(document.querySelector('[data-testid="photo-batch"]'))`, '批量条再次出现')

  await evaluate(`document.querySelector('[data-testid="photo-batch-remove"]').click()`)
  await waitFor(`Boolean(document.querySelector('[data-testid="confirm-ok"]'))`, '批量删除确认框')
  const batchConfirmText = await evaluate(
    `document.querySelector('[data-testid="confirm-ok"]').textContent.trim()`,
  )
  await evaluate(`document.querySelector('[data-testid="confirm-ok"]').click()`)
  await waitFor(`Boolean(document.querySelector('[data-testid="photos-empty"]'))`, '删到空')

  const afterBatchDelete = await evaluate(`(async () => {
    await window.__editor.flush();
    const records = await window.__repo.listAssetRecords(window.__editor.projectId);
    const raw = await window.__repo.getProject(window.__editor.projectId);
    return {
      photos: window.__editor.project.appData.photos.photos.length,
      assets: window.__editor.project.assets.length,
      blobs: records.length,
      persistedPhotos: raw.appData.photos.photos.length,
      batchBar: Boolean(document.querySelector('[data-testid="photo-batch"]')),
    };
  })()`)

  record(
    " 批量删除确认框的按钮文案带上了张数",
    batchConfirmText === '删除 1 张',
    `"${batchConfirmText}"`,
  )

  record(
    " 批量删除：清空勾选的照片、回收 blob、批量条自动收起",
    afterBatchDelete.photos === 0 &&
      afterBatchDelete.persistedPhotos === 0 &&
      afterBatchDelete.assets === 0 &&
      afterBatchDelete.blobs === 0 &&
      afterBatchDelete.batchBar === false,
    `照片 ${afterBatchDelete.photos} · assets ${afterBatchDelete.assets} · IDB blob ${afterBatchDelete.blobs}`,
  )

  /* ── ⑩ 页面没有报错 ───────────────────────────── */

  const errors = await evaluate(`window.__pageErrors`)
  record(" 页面无未捕获错误", errors.length === 0, errors.join(' | '))
} catch (err) {
  console.error('\n[m5-photos] 中断：', err.message)
  results.push({ step: '探针中断', ok: false, detail: err.message })
} finally {
  await cleanup()
}

const passed = results.filter((r) => r.ok).length
const total = results.length
console.log(`\n[m5-photos] ${passed}/${total} 通过`)
if (passed !== total) {
  console.log('\n失败项：')
  for (const r of results.filter((x) => !x.ok)) {
    console.log(`  ✗ ${r.step}${r.detail ? `  ${r.detail}` : ''}`)
  }
  process.exit(1)
}
process.exit(0)
