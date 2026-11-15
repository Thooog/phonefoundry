import { describe, it, expect } from 'vitest'
import { effectScope, ref } from 'vue'
import { useMessageViewer } from '../apps/shared/use-message-viewer.js'

describe('shared message viewer gestures', () => {
  it('pages horizontally, ignores vertical scrolling and clamps after media removal', () => {
    const scope = effectScope()
    const thread = ref([{ id: 'm', images: ['a', 'b', 'c'] }])
    const tone = ref('auto')
    const viewer = scope.run(() => useMessageViewer({ thread, imageSrcs: item => item.images, runtime: { setStatusTone: value => { tone.value = value } }, timeFormat: ref('h24'), tone: 'dark' }))
    viewer.openViewer(thread.value[0], 0)
    expect(tone.value).toBe('dark')
    const event = (x, y) => ({ clientX: x, clientY: y, pointerType: 'touch', currentTarget: { offsetWidth: 300 } })
    viewer.onViewerDown(event(200, 10)); viewer.onViewerMove(event(50, 12)); viewer.onViewerUp(event(50, 12))
    expect(viewer.viewerIndex.value).toBe(1)
    viewer.onViewerDown(event(200, 10)); viewer.onViewerMove(event(195, 150)); viewer.onViewerUp(event(195, 150))
    expect(viewer.viewerIndex.value).toBe(1)
    thread.value[0].images = ['a']
    expect(viewer.viewerIndex.value).toBe(0)
    viewer.closeViewer()
    expect(tone.value).toBe('auto')
    scope.stop()
  })
})
