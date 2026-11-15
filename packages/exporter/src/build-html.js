/**
 * 作品 HTML 模板 —— 导出产物的外壳。
 *
 * 产物必须满足三件事：
 *  1. `file://` 双击就能跑：不能有 ESM、不能 fetch 数据、不能依赖服务器
 *  2. 删掉 assets/ 目录也还开得起来（只是图变占位）—— 不能白屏
 *  3. 作品端产物原样嵌入，不改一个字节：否则"预览所见"和"导出所得"会漂移
 *
 * ── 为什么数据放在 `<script type="application/json">` ──
 *
 * `file://` 下 `fetch('./work.json')` 会被同源策略拦掉（协议是 file:，没有源）。
 * `<script>` 不受这个限制，而 `type="application/json"` 的脚本浏览器不会执行它。
 *
 * 顺带解决转义问题：数据独立成一个文本节点后，只需要处理 `</script` 这一种
 * 提前闭合的可能；如果把数据塞进 JS 变量，就得对整个 JSON 字符串做双重转义，
 * 少转一处就是一个只在特定内容下才炸的 bug。
 *
 * ── 两个必须守住的不变量 ──
 *
 *  - 内联的 JS / CSS 里不能出现 `</script` / `</style` / `<!--`
 *    出现就会提前闭合标签，页面剩下一地残骸。作品端产物是我们自己的构建结果，
 *    真出现了说明构建配置出了问题 —— 所以这里直接抛错，不静默截断。
 *  - `<meta name="viewport">` 不能漏
 *    少了它，手机会按 980px 的桌面宽度布局，外壳会误判成宽视口去画设备外框，
 *    结果就是"手机里又套了一个手机"。这条在 probe-system 里已经踩过一次。
 */

/** 内联代码里会破坏 HTML 结构的序列 */
const JS_BREAKERS = /<\/script|<!--/i
const CSS_BREAKERS = /<\/style|<!--/i

/**
 * @param {object} params
 * @param {string} params.title        作品标题（用于 <title>，会被 HTML 转义）
 * @param {object} params.work         WorkData
 * @param {{ js: string, css: string }} params.player 作品端构建产物
 * @param {Record<string,string>} [params.assets] folder: assetId→文件名；inline: assetId→dataURL
 * @param {'folder'|'inline'} [params.mode]
 * @param {string} [params.basePath] folder 模式的资源目录，默认 `./assets/`
 * @returns {string} 完整的 HTML 文本
 */
export function buildWorkHtml({
  title,
  work,
  player,
  assets = {},
  mode = 'folder',
  basePath = './assets/',
}) {
  const js = player?.js ?? ''
  const css = player?.css ?? ''

  if (!js.trim()) {
    throw new Error('作品端 JS 为空：导出前必须先构建作品端产物。')
  }
  assertInlineSafe(js, JS_BREAKERS, '<script>', 'JS')
  assertInlineSafe(css, CSS_BREAKERS, '<style>', 'CSS')

  const payload = {
    mode: mode === 'inline' ? 'inline' : 'folder',
    // inline 模式没有目录，basePath 无意义，给空串让解析器走默认分支
    basePath: mode === 'inline' ? '' : basePath,
    work,
    assets,
  }

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="color-scheme" content="light" />
<title>${escapeHtmlText(title || '作品')}</title>
<style>${css}</style>
<style>
  /* 与作品端 dist/preview.html 完全一致：预览与导出必须是同一套外壳几何 */
  html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #e9e9ee; }
  #phone-root { width: 100%; height: 100%; }
  .phone-boot-hint {
    margin: 0; padding: 24px; text-align: center;
    font: 14px/1.7 system-ui, -apple-system, "Segoe UI", sans-serif; color: #6b6b76;
  }
</style>
</head>
<body>
<div id="phone-root"></div>
<noscript><p class="phone-boot-hint">这个作品需要开启 JavaScript 才能浏览。</p></noscript>
<script id="phone-work" type="application/json">${escapeJsonForScriptNode(payload)}</script>
<script>
(function () {
  var el = document.getElementById('phone-work');
  if (!el) return;
  window.__PHONE_WORK__ = JSON.parse(el.textContent);
})();
</script>
<script>${js}</script>
</body>
</html>
`
}

function assertInlineSafe(code, pattern, tag, label) {
  const hit = code.match(pattern)
  if (!hit) return
  throw new Error(
    `作品端 ${label} 里出现了会自动闭合 ${tag} 的序列「${hit[0]}」，` +
      '内联进 HTML 会截断页面。这是构建产物的问题，请检查作品端构建配置。',
  )
}

/**
 * JSON → 可以安全放进 `<script type="application/json">` 的文本。
 *
 * 只需处理 `<`：HTML 分词器在 script 数据状态里只认 `</script` 和 `<!--`，
 * 而把每个 `<` 换成 `\u003c` 之后这两种序列都不可能再出现。
 * `\u003c` 是合法的 JSON 转义，JSON.parse 会还原成 `<`，数据本身无损。
 *
 * 不做成 `<\/script` 这种形式：它是 JS 字符串字面量的写法，
 * 放进 JSON 会变成非法转义（JSON 只认 `\/`，不认 `\<`）。
 */
export function escapeJsonForScriptNode(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

/** HTML 文本节点转义：只用在 <title> 上，四个字符就够 */
export function escapeHtmlText(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
