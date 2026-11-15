

import { onBeforeUnmount, ref, watch } from 'vue'
import { isInlineUrl } from '../media/image-format.js'

/**
 * @param {object} editor project store
 * @param {() => Array<string|null|undefined>} idsGetter 当前需要显示的全部 assetId
 * @returns {{urls: import('vue').Ref<Map<string,string>>}}
 */
export function useAssetUrls(editor, idsGetter) {
  /** Map<assetId, url> */
  const urls = ref(new Map())

  let token = 0
  /** 本 composable 造出来的 objectURL，卸载时统一回收 */
  const createdUrls = new Set()

  async function refresh() {
    const myToken = (token += 1)
    const ids = [...new Set((idsGetter() ?? []).filter(Boolean))]
    const needed = new Set(ids)

    const next = new Map(urls.value)

    for (const [id, url] of next) {
      if (needed.has(id)) continue
      if (createdUrls.has(url)) {
        URL.revokeObjectURL(url)
        createdUrls.delete(url)
      }
      next.delete(id)
    }

    // 2. 内联地址直接可用
    const pending = []
    for (const id of ids) {
      if (next.has(id)) continue
      if (isInlineUrl(id)) next.set(id, id)
      else pending.push(id)
    }

    urls.value = next
    if (!pending.length) return

    let blobs
    try {
      blobs = await editor.getAssetBlobs(pending)
    } catch {
      // 读不出来不该让整页白着 —— 这几张图显示成占位格就行
      return
    }
    if (myToken !== token) return

    const merged = new Map(urls.value)
    for (const [id, blob] of blobs) {
      const url = URL.createObjectURL(blob)
      createdUrls.add(url)
      merged.set(id, url)
    }
    urls.value = merged
  }

  const idsKey = () => (idsGetter() ?? []).filter(Boolean).join('|')
  let lastKey = null
  watch(
    () => [editor.project, idsKey()],
    () => {
      const key = idsKey()
      if (key === lastKey) return
      lastKey = key
      refresh()
    },
    { immediate: true },
  )

  onBeforeUnmount(() => {
    token += 1
    for (const url of createdUrls) URL.revokeObjectURL(url)
    createdUrls.clear()
  })

  return { urls }
}
