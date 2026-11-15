const DISPLAY_TAGS = new Set(`a abbr article aside b blockquote br caption code dd div dl dt em figcaption figure footer h1 h2 h3 h4 h5 h6 header hr i img li main mark ol p pre s section small span strong style sub sup table tbody td th thead time tr u ul`.split(' '))
const DISPLAY_ATTRIBUTES = new Set(['alt', 'class', 'colspan', 'dir', 'height', 'id', 'lang', 'rowspan', 'style', 'title', 'width'])
const BITMAP = /^data:image\/(?:png|jpeg|gif|webp|avif);base64,[a-z0-9+/=\s]+$/i

export function staticHomeHtml(source) {
  // Template contents are inert, including while parsing untrusted markup.
  const template = document.createElement('template')
  template.innerHTML = source
  for (const element of template.content.querySelectorAll('*')) {
    if (element.namespaceURI !== 'http://www.w3.org/1999/xhtml' || !DISPLAY_TAGS.has(element.localName)) {
      element.remove()
      continue
    }
    for (const { name, value } of Array.from(element.attributes)) {
      if (DISPLAY_ATTRIBUTES.has(name)) continue
      if (name === 'src' && element.localName === 'img' && BITMAP.test(value)) continue
      element.removeAttribute(name)
    }
  }

  const baseStyle = document.createElement('style')
  baseStyle.textContent = 'html,body{margin:0;width:100%;height:100%;overflow:hidden}img{max-width:100%}'
  const policy = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"
  return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}">${baseStyle.outerHTML}${template.innerHTML}`
}
