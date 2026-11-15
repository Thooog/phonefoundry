/**
 * Blob → 浏览器下载。
 *
 * 为什么延迟 revoke：`a.click()` 只是把下载"排进队列"，
 * 立刻 `revokeObjectURL` 在部分浏览器（尤其下载被拦后再放行时）会让文件变成 0 字节。
 * 10 秒足够任何正常的下载启动，超时后浏览器自己也会回收。
 */

const MIME_BY_EXT = Object.freeze({
  zip: 'application/zip',
  html: 'text/html;charset=utf-8',
})

/**
 * @param {Uint8Array} bytes
 * @param {string} fileName
 */
export function downloadBytes(bytes, fileName) {
  const ext = String(fileName).split('.').pop()?.toLowerCase() ?? ''
  const blob = new Blob([bytes], { type: MIME_BY_EXT[ext] ?? 'application/octet-stream' })
  const url = URL.createObjectURL(blob)

  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.rel = 'noopener'
  // 必须进 DOM 才能在部分浏览器上触发下载
  document.body.appendChild(link)
  link.click()
  link.remove()

  setTimeout(() => URL.revokeObjectURL(url), 10000)
}
