<!--
  应用宿主 —— 当前应用的全屏层，负责"进/出"过渡。

  为什么方向要从 runtime.state.transition 取：
   iOS 的进入和退出不是同一段动画倒放：
     push：旧屏左移 22% 淡出，新屏从右侧 100% 滑入
     pop ：新屏从左侧 22% 滑入，旧屏向右侧 100% 滑出
   两者共用一套 transform 会让"返回"看起来像"又进了一层"，
   这是很多自制手机界面最容易露馅的地方。

  为什么两层同时存在（Transition 默认 mode）：
   同步进出才有"上一屏被推走"的层次感。mode="out-in" 会先空白再进，
   在手机上表现为闪一下白。
-->
<script setup>
import { computed } from 'vue'
import { getApp } from '@phone-sim/shared'
import KakaoTalkApp from '../apps/kakaotalk/KakaoTalkApp.vue'
import XApp from '../apps/x/XApp.vue'
import PhoneApp from '../apps/phone/PhoneApp.vue'
import PhotoApp from '../apps/photos/PhotoApp.vue'
import MessagesApp from '../apps/messages/MessagesApp.vue'
import InstagramApp from '../apps/instagram/InstagramApp.vue'
import NotesApp from '../apps/notes/NotesApp.vue'
import SettingsApp from '../apps/settings/SettingsApp.vue'
import AppPlaceholder from '../apps/AppPlaceholder.vue'
import { usePhoneRuntime } from './create-runtime.js'

const runtime = usePhoneRuntime()

const REGISTRY = {
  photos: PhotoApp,
  kakaotalk: KakaoTalkApp,
  messages: MessagesApp,
  x: XApp,
  instagram: InstagramApp,
  notes: NotesApp,
  phone: PhoneApp,
  settings: SettingsApp,
}

const appId = computed(() => runtime.state.currentApp)
const appMeta = computed(() => getApp(appId.value))
const appComponent = computed(() => REGISTRY[appId.value] ?? AppPlaceholder)
/**
 * 'fade' = 跨应用借道（信息应用点「呼叫」直接进通话屏）。
 * 通话是全屏接管，不该横移进来；其它情况仍是推拉。
 */
const direction = computed(() => {
  const t = runtime.state.transition
  if (t === 'fade') return 'fade'
  return t === 'pop' ? 'pop' : 'push'
})
</script>

<template>
  <div class="pui-apphost" data-testid="app-host" :data-app="appId">
    <Transition :name="`pui-app-${direction}`">
      <div :key="appId" class="pui-apphost__layer" :data-app="appId">
        <component :is="appComponent" :app="appMeta" />
      </div>
    </Transition>
  </div>
</template>

<style>
.pui-apphost {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: var(--pui-bg);
}

/* 每层都铺满：过渡期间新旧两层同时存在，不能靠文档流排 */
.pui-apphost__layer {
  position: absolute;
  inset: 0;
  will-change: transform;
}

.pui-app-push-enter-from {
  transform: translate3d(100%, 0, 0);
}

.pui-app-push-leave-to {
  transform: translate3d(-22%, 0, 0);
  opacity: 0.72;
}

.pui-app-pop-enter-from {
  transform: translate3d(-22%, 0, 0);
  opacity: 0.72;
}

.pui-app-pop-leave-to {
  transform: translate3d(100%, 0, 0);
}

.pui-app-push-enter-active,
.pui-app-push-leave-active,
.pui-app-pop-enter-active,
.pui-app-pop-leave-active {
  transition:
    transform 300ms var(--pui-ease-out),
    opacity 300ms var(--pui-ease-out);
}

/* 返回桌面：从"应用"缩回图标的位置感太贵，这里用上滑淡出，方向与进入相反 */
.pui-app-pop-leave-to {
  opacity: 0;
}

/* 跨应用借道（信息应用「呼叫」→ 通话屏）：整层淡入淡出，一点横移都不要。
   时长与电话应用内部通话屏的 fade 对齐（260ms），两段接起来是一口气。 */
.pui-app-fade-enter-from,
.pui-app-fade-leave-to {
  opacity: 0;
}

.pui-app-fade-enter-active,
.pui-app-fade-leave-active {
  transition: opacity 260ms var(--pui-ease-out);
  will-change: opacity;
}
</style>
