/**
 * 取得作品端的构建产物（renderer.js / renderer.css）的**文本**。
 *
 * 为什么是"运行时去取"而不是 `import ... from '.../dist/renderer.js?raw'`：
 *
 *  1. 包体积：187KB 的 JS 内联进创作端 bundle，每次打开创作端都要多下载、多解析一份
 *     永远用不到的内容（只有点导出时才需要）。
 *  2. 时序：`?raw` 是**模块解析期**求值。产物不存在时整个创作端都起不来；
 *     而 `pnpm check` 的顺序是 `test → build:player`，也就是全新 clone 上
 *     跑测试时产物还不存在 —— 那样连单测都跑不了。
 *  3. 一致性：取的是**预览 iframe 正在用的同一份文件**。
 *     `./player-runtime/` 在开发期由 vite 中间件从 apps/player/dist 提供，
 *     构建期由插件复制进 dist/player-runtime/。导出与预览读同一份，
 *     "预览所见 = 导出所得"就不只是一句口号。
 */

/** 与 PreviewView 的 PLAYER_SRC 指向同一个目录 */
const PLAYER_RUNTIME = './player-runtime/'



/**
 * @returns {Promise<{ js: string, css: string }>}
 */
export async function loadPlayerBundle() {

  const [js, css] = await Promise.all([readText('renderer.js'), readText('renderer.css')])

  // 拿到 HTML 说明请求被前端路由或 404 页接管了，而不是返回了 JS
  if (!js.trim() || /^\s*</.test(js)) {
    throw new Error('取到的作品端产物不是 JavaScript，可能被服务器改写成了错误页。请重新构建作品端。')
  }

  return { js, css }
}

async function readText(name) {
  const url = new URL(`${PLAYER_RUNTIME}${name}`, document.baseURI)
  let response
  try {
    // no-store：构建完产物后刷新页面就能拿到新的，不会被 304 缓存住
    response = await fetch(url, { cache: 'no-store' })
  } catch {
    throw new Error(`取不到作品端产物 ${name}。请先构建作品端（pnpm build:player）。`)
  }
  if (!response.ok) {
    throw new Error(
      `取不到作品端产物 ${name}（HTTP ${response.status}）。请先构建作品端（pnpm build:player）。`,
    )
  }
  return response.text()
}
