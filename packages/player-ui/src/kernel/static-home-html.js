const DISPLAY_TAGS = new Set(`a abbr article aside b blockquote br caption code dd div dl dt em figcaption figure footer h1 h2 h3 h4 h5 h6 header hr i img li main mark ol p pre s section small span strong style sub sup table tbody td th thead time tr u ul`.split(' '))
const DISPLAY_ATTRIBUTES = new Set(['alt', 'class', 'colspan', 'dir', 'height', 'id', 'lang', 'rowspan', 'style', 'title', 'width'])
const HTML_NS = 'http://www.w3.org/1999/xhtml'
const SVG_NS = 'http://www.w3.org/2000/svg'
// 只放行「纯图形」子集。能加载外部资源（image / use / feImage / pattern）、
// 执行脚本（script）、嵌 HTML（foreignObject）、跑时间线（animate* / set）
// 或自带上文样式表（style）的标签一律不在内。
const SVG_TAGS = new Set('svg g path circle rect line polyline polygon ellipse title desc'.split(' '))
// 同理，href / xlink:href / filter / mask / clip-path 这类「引用别处」的属性也不给。
const SVG_ATTRIBUTES = new Set([
  'class', 'color', 'd', 'cx', 'cy', 'fill', 'fill-opacity', 'fill-rule', 'height',
  'id', 'opacity', 'pathLength', 'points', 'preserveAspectRatio', 'r', 'rx', 'ry',
  'stroke', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin',
  'stroke-miterlimit', 'stroke-opacity', 'stroke-width', 'style', 'transform', 'viewBox',
  'width', 'x', 'x1', 'x2', 'y', 'y1', 'y2',
])
const BITMAP = /^data:image\/(?:png|jpeg|gif|webp|avif);base64,[a-z0-9+/=\s]+$/i
// 外链图片只收 https：http 会在 https 页面里被当混合内容拦掉（作品多半是 https 托管或 file://），
// 与其让它静默不显示，不如在清洗阶段就拒掉，用户能立刻看出自己写错了。
const REMOTE_IMAGE = /^https:\/\/[^\s]+$/i

export function staticHomeHtml(source) {
  // Template contents are inert, including while parsing untrusted markup.
  const template = document.createElement('template')
  template.innerHTML = source
  for (const element of template.content.querySelectorAll('*')) {
    // 祖先被整棵摘掉的，子树已经不在树上了，别再按白名单走一遍
    if (!template.content.contains(element)) continue
    if (element.namespaceURI === SVG_NS) {
      if (!SVG_TAGS.has(element.localName)) {
        element.remove()
        continue
      }
      for (const { name } of Array.from(element.attributes)) {
        if (!SVG_ATTRIBUTES.has(name)) element.removeAttribute(name)
      }
      continue
    }
    if (element.namespaceURI !== HTML_NS || !DISPLAY_TAGS.has(element.localName)) {
      element.remove()
      continue
    }
    for (const { name, value } of Array.from(element.attributes)) {
      if (DISPLAY_ATTRIBUTES.has(name)) continue
      if (name === 'src' && element.localName === 'img' && (BITMAP.test(value) || REMOTE_IMAGE.test(value))) continue
      element.removeAttribute(name)
    }
  }

  const baseStyle = document.createElement('style')
  baseStyle.textContent = 'html,body{margin:0;width:100%;height:100%;overflow:hidden}img{max-width:100%}'
  // img-src 同时管 <img> 与 style 里的 url()：放开 https 就两层都能用。
  // 字体（font-src）、外部样式表（style-src 不含 host）、脚本仍被 default-src 'none' 挡住。
  const policy = "default-src 'none'; style-src 'unsafe-inline'; img-src data: https:; base-uri 'none'; form-action 'none'"
  return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}">${baseStyle.outerHTML}${template.innerHTML}`
}
