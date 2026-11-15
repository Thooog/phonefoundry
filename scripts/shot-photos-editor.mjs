

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, URL } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const CREATOR_DIR = path.join(ROOT, 'apps', 'creator')
const naturalPhotos = process.argv.includes('--natural')
const OUT_DIR = path.join(ROOT, 'docs', 'milestones', 'shots', 'photo-refinement', naturalPhotos ? 'natural' : process.argv.includes('--before') ? 'before' : 'after')
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const DEV_PORT = 5292
const CDP_PORT = 9362

if (!fs.existsSync(CHROME)) {
  console.error('[shot-photos-edit] 未找到 Chrome：' + CHROME)
  process.exit(2)
}

fs.mkdirSync(OUT_DIR, { recursive: true })
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-sim-shotm5-'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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
    '--force-device-scale-factor=1',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${USER_DATA}`,
    '--window-size=1340,1000',
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
      pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value) }, reject })
      ws.send(JSON.stringify({ id, method, params }))
      const timer = setTimeout(() => {
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
    while (Date.now() - startedAt < timeoutMs) {
      try {
        if (await evaluate(expression)) return true
      } catch {
        /* 页面还在切换 */
      }
      await sleep(150)
    }
    throw new Error(`等待超时：${label}`)
  }

  await waitFor(`document.readyState === 'complete' && Boolean(document.querySelector('h1'))`, '首屏')
  await session.send('Page.navigate', { url: `http://127.0.0.1:${DEV_PORT}/` })
  await waitFor(
    `location.protocol === 'http:' && location.port === '${DEV_PORT}' && Boolean(document.querySelector('#app'))`,
    '页面加载',
  )
  await evaluate(`(async () => {
    const conn = await import('/src/db/connection.js');
    try { await conn.deleteDatabase(); } catch {}
    return 'ok';
  })()`)
  await session.send('Page.reload', { ignoreCache: true })
  await sleep(1200)
  await waitFor(
    `document.readyState === 'complete' && Boolean(document.querySelector('.projects'))`,
    '重载',
  )

  await evaluate(`(async () => {
    const { useProjectsStore } = await import('/src/stores/projects.js');
    const { useProjectStore } = await import('/src/stores/project.js');
    const projects = useProjectsStore();
    const editor = useProjectStore();
    const p = await projects.createSample({ name: '功能展示 · 从这里开始' });
    await editor.open(p.id);
    location.hash = '#/p/' + p.id + '/apps/photos';
    return 'ok';
  })()`)
  await waitFor(`Boolean(document.querySelector('[data-testid="photos-editor"]'))`, '照片编辑器')
  if (naturalPhotos) await evaluate(`(async()=>{const {useProjectStore}=await import('/src/stores/project.js');const editor=useProjectStore();editor.patch({appData:{...editor.project.appData,photos:{photos:[],albums:editor.project.appData.photos.albums.map(a=>({...a,photoIds:[]}))}}})})()`)

  // Six sample photos plus two imports match the eight-photo reference.
  await evaluate(`(async () => {
    const input = () => document.querySelector('[data-testid="upload-input"]');
    if (${naturalPhotos}) {
      const files=${JSON.stringify([20,30,42,60,76,82,91,175].map(id=>'/@fs/'+path.join(ROOT,'design/reset/native/visual-photos',id+'.jpg').replaceAll('\\','/')))};
      const transfer=new DataTransfer();
      for(const [index,url] of files.entries()){
        const response=await fetch(url);if(!response.ok)throw Error('摄影素材读取失败');
        transfer.items.add(new File([await response.blob()],index+'.jpg',{type:'image/jpeg',lastModified:new Date(2026,5,30,18,index).getTime()}));
      }
      input().files=transfer.files;input().dispatchEvent(new Event('change',{bubbles:true}));return 'ok';
    }
    const palettes = [
      ['#f7cdb0', '#b9613c'], ['#cdd7f2', '#5b6b96'],
      ['#e7e2d6', '#8c8577'], ['#cfe3d4', '#4d7a62'],
    ];
    const dt = new DataTransfer();
    for (let i = 0; i < 2; i += 1) {
      const [a, b] = palettes[i % palettes.length];
      const c = document.createElement('canvas');
      c.width = i % 2 ? 1200 : 600; c.height = i % 2 ? 600 : 1000;
      const ctx = c.getContext('2d');
      const g = ctx.createLinearGradient(0, 0, 0, c.height);
      g.addColorStop(0, a); g.addColorStop(1, b);
      ctx.fillStyle = g; ctx.fillRect(0, 0, c.width, c.height);
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.beginPath();
      ctx.arc(450, 520, 190, 0, Math.PI * 2);
      ctx.fill();
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
      dt.items.add(new File([blob], 'shot-' + i + '.png', {
        type: 'image/png',
        lastModified: new Date(2026, 0, 1).getTime() - i * 86400000,
      }));
    }
    const el = input();
    el.files = dt.files;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return 'ok';
  })()`)
  await waitFor(`document.querySelectorAll('[data-testid="photo-row"]').length === 8`, '8 张照片')
  if(naturalPhotos) await evaluate(`(async()=>{const {useProjectStore}=await import('/src/stores/project.js');const {updatePhoto}=await import('/src/editing/photos.js');const e=useProjectStore();const captions=['摊开的书与一整个下午','那杯还没喝完的咖啡','我们坐过的窗边','深夜留下的工作台','靠在木屋旁的自行车','春天经过这扇窗','把这一刻拍下来','钟声还没有响'];for(const [index,p] of e.project.appData.photos.photos.entries())updatePhoto(e,p.id,{caption:captions[index],location:['宿舍 · 书桌','街角 · 咖啡店','学校 · 窗边','宿舍','旧街巷','回家的路上','校园','房间'][index],displayTime:new Date(2026,5,30,18,50-index).toISOString()});})()`)

  await evaluate(`(async()=>{
    const {useProjectStore}=await import('/src/stores/project.js');
    const e=useProjectStore(); window.__reviewEditor=e;
    const {addPhotoToAlbum}=await import('/src/editing/photos.js');
    const bucket=e.project.appData.photos;
    for(const p of bucket.photos.slice(0,5)) addPhotoToAlbum(e,bucket.albums[0].id,p.id);
    window.__reviewErrors=[];addEventListener('error',e=>window.__reviewErrors.push(e.message));
  })()`);
  await sleep(4200);
  const resize=async(width,height)=>{await session.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await sleep(150)};
  const click=async(selector)=>{await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);await sleep(120)};
  const shot=async(name)=>{await sleep(200);const s=await session.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(OUT_DIR,name+'.png'),Buffer.from(s.data,'base64'))};
  const photos=()=>click('#photo-tab-library');
  const albums=()=>click('.photo-tabs button:last-child');
  await resize(502,1325);
  await click('[data-testid=photo-select]');await click('[data-testid=photo-batch-toggle]');
  await shot('frame19-library');
  await resize(1707,826);
  if(!await evaluate(`(()=>{const row=[...document.querySelectorAll('.photed__batch-row input,.photed__batch-row .ui-btn')].map(e=>e.getBoundingClientRect());const head=[...document.querySelectorAll('.photed__batch-head button,.photed__batch-count')].map(e=>e.getBoundingClientRect());return row.length===3&&row.every(r=>Math.abs(r.top-row[0].top)<1&&Math.abs(r.height-row[0].height)<1)&&head.every(r=>Math.abs(r.top+r.height/2-head[0].top-head[0].height/2)<1)})()`)) throw Error('批量操作未对齐');
  await shot('batch-desktop');
  await click('[data-testid=photo-batch-clear]');
  await albums();await resize(502,1457);await shot('frame20-album');
  await photos();await resize(503,733);await click('.prow__thumb');await shot('frame21-detail');
  await click('.photo-done');
  await resize(1707,826);await click('.prow__thumb');await shot('frame17-library');
  await albums();await resize(1754,826);await shot('frame18-album');
  await photos();await resize(1094,729);await click('.prow__thumb');await shot('reference-library-1094');
  if(await evaluate(`getComputedStyle(document.querySelector('.plist')).gridTemplateColumns.split(' ').length`)!==4) throw Error('参考图画幅图库应保持四列');
  await albums();await resize(1076,726);await shot('reference-albums-1076');
  if(await evaluate(`getComputedStyle(document.querySelector('.arow__strip')).gridTemplateColumns.split(' ').length`)!==5) throw Error('参考图画幅相簿应保持五列');
  const results=[];
  const assert=(name,ok)=>{results.push({check:name,ok});if(!ok)throw Error(name)};
  if(!process.argv.includes('--before') && !naturalPhotos){
    for (const width of [375,390,502,767]) {
      await resize(width,844);await photos();
      assert(width+'px 照片库三列',await evaluate(`getComputedStyle(document.querySelector('.plist')).gridTemplateColumns.split(' ').length===3`));
      await click('[data-testid=photo-select]');
      assert(width+'px 复选框可选',await evaluate(`document.querySelector('[data-testid=photo-select]').checked`));
      await click('[data-testid=photo-batch-clear]');
      await click('.photo-layout button:last-child');
      assert(width+'px 列表保持单列',await evaluate(`getComputedStyle(document.querySelector('.plist')).gridTemplateColumns.split(' ').length===1`));
      await click('.photo-layout button:first-child');
      await albums();
      assert(width+'px 相簿按可用宽度排列',await evaluate(`[...document.querySelectorAll('.arow__strip')].every(e=>getComputedStyle(e).gridTemplateColumns.split(' ').length===(${width}<=392?2:${width}<=512?3:${width}<=652?4:5))`));
      assert(width+'px 无横向溢出',await evaluate(`[document.querySelector('.ws__main'),document.querySelector('.photo-library')].every(e=>e.scrollWidth<=e.clientWidth+1)`));
      await click('[data-testid=album-members] .thumb');
      assert(width+'px 移除可用',await evaluate(`window.__reviewEditor.project.appData.photos.albums[0].photoIds.length===4`));
      await click('[data-testid=album-candidate]');
      assert(width+'px 加入可用',await evaluate(`window.__reviewEditor.project.appData.photos.albums[0].photoIds.length===5`));
    }

    for(const [width,height] of [[375,568],[390,667],[390,844],[502,733],[767,844],[1024,844],[1440,844],[1920,844]]){
      await resize(width,height);await photos();await click('.prow__thumb');
      const result=await evaluate(`(()=>{
        const panel=document.querySelector('.inspector-panel');const body=document.querySelector('.photo-inspector');
        const rect=e=>e.getBoundingClientRect();const fields=[...panel.querySelectorAll('input,.photo-footer button')];
        const narrow=innerWidth<1024;
        return {width:innerWidth,height:innerHeight,noScroll:!narrow||(panel.scrollHeight<=panel.clientHeight+1&&body.scrollHeight<=body.clientHeight+1),visible:!narrow||fields.every(e=>rect(e).top>=rect(panel).top&&rect(e).bottom<=innerHeight),noHorizontal:document.documentElement.scrollWidth<=innerWidth,columns:getComputedStyle(document.querySelector('.plist')).gridTemplateColumns,preview:rect(body.querySelector('img')).height};
      })()`);
      results.push(result);await shot('detail-'+width+'-'+height);
      if(width<1024)await click('.photo-done');
    }
    // Portrait/landscape, no-time and long labels use the same no-scroll contract.
    await resize(390,667);
    for(const index of [0,5,6]){
      await photos();await click(`[data-testid=photo-row]:nth-child(${index+1}) .prow__thumb`);
      const result=await evaluate(`(()=>{const p=document.querySelector('.inspector-panel');const b=document.querySelector('.photo-inspector');return {index:${index},noScroll:p.scrollHeight<=p.clientHeight+1&&b.scrollHeight<=b.clientHeight+1}})()`);
      results.push(result);await click('.photo-done');
    }
    await evaluate(`(async()=>{const {updatePhoto}=await import('/src/editing/photos.js');const e=window.__reviewEditor;updatePhoto(e,e.project.appData.photos.photos[0].id,{displayTime:null,caption:'长说明'.repeat(20),location:'长地点'.repeat(10)})})()`);
    await click('.prow__thumb');
    results.push(await evaluate(`(()=>{const p=document.querySelector('.inspector-panel');return {edge:'missing-time-long-text',noScroll:p.scrollHeight<=p.clientHeight+1}})()`));
    await click('.photo-done');
    await resize(1707,826);await photos();await click('.prow__thumb');
    results.push(await evaluate(`({reference:'library',columns:getComputedStyle(document.querySelector('.plist')).gridTemplateColumns.split(' ').length})`));
    const density=await evaluate(`(()=>{const rect=el=>el.getBoundingClientRect();return {thumb:rect(document.querySelector('.prow__thumb')).width,lastCaption:rect([...document.querySelectorAll('.photo-open')].at(-1)).bottom,usage:rect(document.querySelector('.photo-page-footer')).bottom,actions:rect(document.querySelector('.photo-footer')).bottom,panelRatio:rect(document.querySelector('.inspector-panel')).width/rect(document.querySelector('.photo-workbench')).width}})()`);
    results.push({reference:'wide-density',...density});
    assert('宽屏缩略图保持约200–220px',density.thumb>=190&&density.thumb<=220);
    assert('宽屏八张照片的说明和底部操作完整可见',density.lastCaption<826&&density.usage<826&&density.actions<826);
    assert('宽屏详情栏占比保持平衡',density.panelRatio>=.23&&density.panelRatio<=.29);
    const originalPhotos=await evaluate(`window.__reviewEditor.project.appData.photos.photos`);
    await evaluate(`(()=>{const e=window.__reviewEditor;const photos=e.project.appData.photos.photos;const extra=Array.from({length:24},(_,index)=>({...photos[0],id:'photo-height-'+index,displayTime:'2025-01-01T00:00:00Z'}));e.patch({appData:{...e.project.appData,photos:{...e.project.appData.photos,photos:[...photos,...extra]}}})})()`);
    await sleep(150);
    const panelHeight=await evaluate(`(()=>{const panel=document.querySelector('.inspector-panel');const form=panel.querySelector('.prow__fields').getBoundingClientRect();const footer=panel.querySelector('.photo-footer').getBoundingClientRect();const grid=document.querySelector('.plist');return {height:panel.getBoundingClientRect().height,top:panel.getBoundingClientRect().top,toolbarTop:document.querySelector('.photed__bar').getBoundingClientRect().top,gap:footer.top-form.bottom,overflow:grid.scrollHeight-grid.clientHeight}})()`);
    assert('长图库不会拉伸详情栏',panelHeight.height<=826-56-148&&panelHeight.overflow>400);
    assert('详情操作紧跟表单',panelHeight.gap>=16&&panelHeight.gap<=32);
    await evaluate(`document.querySelector('.plist').scrollTop=600`);await sleep(150);
    assert('图库局部滚动且详情和工具栏固定',await evaluate(`(()=>{const p=document.querySelector('.inspector-panel').getBoundingClientRect();return document.querySelector('.plist').scrollTop>0&&document.querySelector('.ws__main').scrollTop===0&&Math.abs(p.top-${panelHeight.top})<1&&Math.abs(document.querySelector('.photed__bar').getBoundingClientRect().top-${panelHeight.toolbarTop})<1})()`));
    assert('底部信息栏保持紧凑',await evaluate(`(()=>{const f=document.querySelector('.photo-page-footer').getBoundingClientRect();const g=document.querySelector('.plist').getBoundingClientRect();return innerHeight-f.bottom<=10&&f.top-g.bottom<=12})()`));
    assert('滚动长图库时详情仍在视口内',await evaluate(`(()=>{const p=document.querySelector('.inspector-panel').getBoundingClientRect();return p.top>=56&&p.bottom<=innerHeight})()`));
    await shot('long-gallery-detail');
    await evaluate(`(()=>{const e=window.__reviewEditor;e.patch({appData:{...e.project.appData,photos:{...e.project.appData.photos,photos:${JSON.stringify(originalPhotos)}}}});document.querySelector('.ws__main').scrollTop=0})()`);
    await sleep(150);
    await resize(1754,826);await albums();
    results.push(await evaluate(`({reference:'album',columns:getComputedStyle(document.querySelector('.arow__strip')).gridTemplateColumns.split(' ').length})`));

    await resize(390,667);await photos();await click('.prow__thumb');
    await evaluate(`document.querySelector('[data-testid=photo-caption]').focus();document.querySelector('[data-testid=photo-caption]').select()`);
    await session.send('Input.insertText',{text:'完成前最后一次编辑'});
    await click('.photo-done');
    assert('完成提交最后一次编辑',await evaluate(`window.__reviewEditor.project.appData.photos.photos.some(p=>p.caption==='完成前最后一次编辑')`));
    await evaluate(`document.querySelector('.prow__thumb').focus();document.querySelector('.prow__thumb').click()`);await sleep(150);
    await session.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await session.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await sleep(150);
    assert('Esc 关闭并恢复焦点',await evaluate(`!document.querySelector('dialog.inspector-panel').open&&document.activeElement.matches('.prow__thumb')`));
    await albums();
    assert('相簿页显示新建相簿入口',await evaluate(`Boolean(document.querySelector('[data-testid=album-create-toggle]'))&&!document.querySelector('[data-testid=upload-input]')`));
    await photos();await resize(390,400);await click('.prow__thumb');
    assert('极矮视口保留可滚动操作',await evaluate(`(()=>{const p=document.querySelector('.inspector-panel');const f=p.querySelector('.photo-footer');p.scrollTop=p.scrollHeight;return getComputedStyle(p).overflowY==='auto'&&f.getBoundingClientRect().bottom<=innerHeight})()`));
    await click('.photo-done');
    await albums();await click('[data-testid=album-rename]');
    assert('重命名聚焦名称输入框',await evaluate(`document.activeElement.matches('[data-testid=album-rename-input]')`));
    await evaluate(`(()=>{const input=document.querySelector('[data-testid=album-rename-input]');input.value='夏天';input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    assert('相簿重命名写入数据',await evaluate(`window.__reviewEditor.project.appData.photos.albums[0].name==='夏天'`));
    await click('.arow__tools .photo-menu summary');
    await evaluate(`document.querySelector('.photo-page-title').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))`);
    assert('相簿菜单点击外部关闭',await evaluate(`!document.querySelector('.arow__tools .photo-menu').open`));
    const photoCount=await evaluate(`window.__reviewEditor.project.appData.photos.photos.length`);
    await click('.arow__tools .photo-menu summary');await click('[data-testid=album-remove]');
    await waitFor(`Boolean(document.querySelector('[data-testid=confirm-ok]'))`,'删除相簿确认');
    await click('[data-testid=confirm-ok]');
    assert('删除相簿后照片保留且自动选择另一相簿',await evaluate(`window.__reviewEditor.project.appData.photos.photos.length===${photoCount}&&window.__reviewEditor.project.appData.photos.albums.length===1&&Boolean(document.querySelector('[data-testid=album-row]'))`));
    await photos();
    await evaluate(`(()=>{const select=document.querySelector('.photo-sort select');select.value='name';select.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    assert('按说明名称排序',await evaluate(`(()=>{const names=[...document.querySelectorAll('.photo-open strong')].map(el=>el.textContent);return names.every((name,index)=>!index||names[index-1].localeCompare(name,'zh-CN')<=0)})()`));
    await evaluate(`document.querySelector('#photo-tab-library').dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}))`);
    assert('键盘切换相簿并跟随焦点',await evaluate(`document.activeElement.id==='photo-tab-albums'&&document.querySelector('.photo-workbench').dataset.tab==='albums'`));
    await evaluate(`window.__reviewEditor.patch({appData:{...window.__reviewEditor.project.appData,photos:{photos:[],albums:[]}}})`);
    await photos();await resize(320,568);await shot('empty-library-320');
    assert('窄屏初次空态可见且无横向溢出',await evaluate(`Boolean(document.querySelector('[data-testid=photos-empty]'))&&document.querySelector('.ws__main').scrollWidth<=document.querySelector('.ws__main').clientWidth`));
    await albums();
    assert('窄屏隐藏左侧暂无相簿且只保留顶部新建入口',await evaluate(`getComputedStyle(document.querySelector('.photo-albums__empty')).display==='none'&&!document.querySelector('.album-management .photo-text-action')&&document.querySelector('.album-management').textContent.includes('点击右上方的「新建相簿」')`));
    await shot('no-albums-320');
    await resize(1536,900);
    assert('宽屏暂无相簿在列表剩余空间居中',await evaluate(`(()=>{const p=document.querySelector('.photo-albums__empty').getBoundingClientRect();const a=document.querySelector('.photo-albums').getBoundingClientRect();const h=document.querySelector('.photo-albums__head').getBoundingClientRect();return Math.abs(p.left+p.width/2-a.left-a.width/2)<8&&Math.abs(p.top+p.height/2-(h.bottom+12+a.bottom)/2)<2})()`));
    await shot('no-albums-1536');
    await resize(320,568);await click('[data-testid=album-create-toggle]');
    await evaluate(`(()=>{const input=document.querySelector('[data-testid=album-name-input]');input.value='空相簿';input.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    await click('[data-testid=album-create]');
    assert('没有照片也能创建相簿',await evaluate(`window.__reviewEditor.project.appData.photos.albums[0].name==='空相簿'&&!document.querySelector('[data-testid=album-candidate]')`));
    await shot('empty-album-320');
    await evaluate(`window.__reviewEditor.readOnlyReason='locked'`);
    assert('只读禁用新建相簿和重命名',await evaluate(`document.querySelector('[data-testid=album-create-toggle]').disabled&&document.querySelector('[data-testid=album-rename]').disabled`));
    assert('无页面错误',await evaluate(`window.__reviewErrors.length===0`));
    fs.writeFileSync(path.join(OUT_DIR,'results.json'),JSON.stringify(results,null,2));
    if(results.some(r=>r.noScroll===false||r.visible===false||r.noHorizontal===false))throw Error('布局断言失败');
    if(results.find(r=>r.reference==='library').columns!==5||results.find(r=>r.reference==='album').columns!==7)throw Error('宽屏列数未适应视觉密度');
  }
  console.log(JSON.stringify(results,null,2));
} catch (err) {
  console.error(err);process.exitCode=1;
} finally {
  session?.close();await cleanup();
}
