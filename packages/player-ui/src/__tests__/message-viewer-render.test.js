import { describe, expect, it } from 'vitest'
import { createSSRApp, effectScope, h, ref } from 'vue'
import { renderToString } from 'vue/server-renderer'
import MessagesMediaViewer from '../apps/messages/MessagesMediaViewer.vue'
import KakaoTalkMediaViewer from '../apps/kakaotalk/KakaoTalkMediaViewer.vue'
import { useMessageViewer } from '../apps/shared/use-message-viewer.js'
import { createSampleProject, toWorkData } from '@phone-sim/shared'
import KakaoTalkApp from '../apps/kakaotalk/KakaoTalkApp.vue'
import MessagesApp from '../apps/messages/MessagesApp.vue'
import { createPhoneRuntime, PHONE_RUNTIME } from '../kernel/create-runtime.js'

describe('media viewer component wiring', () => {
  it('KakaoTalk only lists explicitly selected friends, including for legacy accounts', async () => {
    const work = toWorkData(createSampleProject())
    const runtime = createPhoneRuntime({ locked: false })
    runtime.openApp('kakaotalk')
    const ownerAccount = work.platformAccounts.find(a => a.platform === 'kakaotalk' && a.characterId === work.workSettings.ownerCharacterId)
    const render = () => {
      const app = createSSRApp(KakaoTalkApp)
      app.provide(PHONE_RUNTIME, runtime)
      app.provide('phoneWork', () => work)
      return renderToString(app)
    }
    expect(await render()).not.toContain('data-testid="kt-friend-item"')
    ownerAccount.extraFields.friendList = [work.characters[0].id, work.characters[1].id, work.characters[1].id, 'deleted']
    expect((await render()).match(/data-testid="kt-friend-item"/g)).toHaveLength(1)
    ownerAccount.extraFields.friendList = []
    expect(await render()).not.toContain('data-testid="kt-friend-item"')
    work.workSettings.ownerCharacterId = null
    expect(await render()).not.toContain('data-testid="kt-friend-item"')
  })
  for (const [component, appId, prefix] of [[KakaoTalkApp, 'kakaotalk', 'kt'], [MessagesApp, 'messages', 'msg']]) {
    it(`${appId}: opens the sample app and its message thread without setup errors`, async () => {
      const work = toWorkData(createSampleProject())
      const runtime = createPhoneRuntime({ locked: false })
      runtime.openApp(appId)
      const render = () => {
        const app = createSSRApp(component)
        app.provide(PHONE_RUNTIME, runtime)
        app.provide('phoneWork', () => work)
        app.provide('phoneResolveAsset', id => id)
        return renderToString(app)
      }
      expect(await render()).toContain(`${prefix}-list-screen`)
      runtime.push('chat', work.appData[appId].conversations[0].id)
      expect(await render()).toContain(`${prefix}-thread-screen`)
    })
  }
  for (const [component, prefix] of [[MessagesMediaViewer, 'msg'], [KakaoTalkMediaViewer, 'kt']]) {
    it(`${prefix}: renders selected media and removes the overlay when closed`, async () => {
      const scope = effectScope()
      const controller = scope.run(() => useMessageViewer({
        thread: ref([{ id: 'message', authorName: '测试作者', images: ['first.png', 'second.png'] }]),
        imageSrcs: item => item.images,
        runtime: { setStatusTone() {} }, timeFormat: ref('h24'), tone: 'dark',
      }))
      const render = () => renderToString(createSSRApp({ render: () => h(component, { controller }) }))
      expect(await render()).not.toContain(`${prefix}-media-viewer`)
      controller.openViewer({ id: 'message', images: ['first.png', 'second.png'] }, 1)
      const html = await render()
      expect(html).toContain(`${prefix}-media-viewer`)
      expect(html).toContain('测试作者')
      expect(html).toContain('second.png')
      expect(html).toContain('第 2 张，共 2 张')
      controller.closeViewer()
      expect(await render()).not.toContain(`${prefix}-media-viewer`)
      scope.stop()
    })
  }
})
