/**
 * 作品端根组件。
 *
 * 职责边界（重要）：
 *  - 只做"数据 → 界面"的渲染，绝不写回数据
 *  - 不 import 任何编辑端代码、不加编辑入口
 *  - 预览与导出共用这一个组件，两者的唯一差异是数据来源
 *
 * 层次（从下到上）：
 *   锁屏  ←→  桌面  ←→  应用（AppHost）
 *                        ↑ 密码盘是锁屏之上的浮层，不属于这三层
 *   状态栏永远在最上层：它在真机上是系统级绘制，不属于任何应用。
 */

<script setup>
import { computed, ref, provide, watchEffect, defineExpose } from 'vue'
import PhoneShell from './PhoneShell.vue'
import PlaceholderStage from './PlaceholderStage.vue'
import StatusBar from './kernel/StatusBar.vue'
import LockScreen from './kernel/LockScreen.vue'
import PasscodePad from './kernel/PasscodePad.vue'
import HomeScreen from './kernel/HomeScreen.vue'
import AppHost from './kernel/AppHost.vue'
import { createPhoneRuntime, providePhoneRuntime } from './kernel/create-runtime.js'
import { useShellFit } from './use-shell-fit.js'

const props = defineProps({
  /** WorkData；null 表示无数据（空态占位） */
  work: { type: Object, default: null },
  /** asset resolver：(assetId) => url|null */
  resolveAsset: { type: Function, default: null },
  /** 'device' | 'fill' | 'auto' */
  shellMode: { type: String, default: 'auto' },
  /**
   * 预览直达目标 `{ app, screen?, entityId? }`。
   * 只有创作端预览会带（随首帧数据下发）；导出的作品恒为 null —— 读者永远从锁屏开始。
   */
  start: { type: Object, default: null },
})

const { mode, scale, setForcedMode } = useShellFit()
const resolvedMode = ref('device')
const shellEl = ref(null)

/**
 * 外壳形态：作品设置的 shellMode 优先，'auto' 才交给视口判断。
 *
 * 这里必须把强制值**回灌给 useShellFit**，而不是只在最后覆盖 mode。
 * 早期版本只做了 `resolvedMode = shellMode === 'auto' ? mode : shellMode`：
 * mode 是覆盖对了，但 scale 还停在视口判断那一路的结果上（移动端 fill 分支
 * 直接 `scale = 1`），于是 410 宽的机身在 390 宽的屏幕上按 1 倍硬塞，
 * 四周各溢出 10px 被 overflow:hidden 裁掉 —— 表现是"有框、但贴着屏幕边没有留白"。
 */
watchEffect(() => {
  setForcedMode(props.shellMode)
  resolvedMode.value = mode.value
})

/** 子组件通过 inject 取资产解析器与数据，避免层层 props */
//
// 注意：这里 provide 的是**函数**而不是值。

provide('phoneWork', () => props.work)
provide('phoneResolveAsset', (assetId) => {
  if (!assetId || !props.resolveAsset) return null
  return props.resolveAsset(assetId)
})
provide('phoneShellMode', resolvedMode)

/** 系统状态：锁屏 / 桌面 / 应用栈 */
const runtime = providePhoneRuntime(createPhoneRuntime({ locked: true }))

if (props.start?.app) runtime.goto(props.start)

/**
 * 滚动位置记忆。
 * 只把两个方法暴露出去，不把整个 runtime 交给 appkit —— 基础原语不该有能力
 * 调 openApp / pop，"原语反向控制导航"是很容易失控的一种耦合。
 */
provide('phoneScrollMemory', {
  rememberScroll: runtime.rememberScroll,
  recallScroll: runtime.recallScroll,
})

const settings = computed(() => props.work?.workSettings ?? {})
const passcodeEnabled = computed(() => Boolean(settings.value.passcodeEnabled))
const passcode = computed(() => String(settings.value.passcode ?? ''))
const passcodeLength = computed(() => (settings.value.passcodeLength === 6 ? 6 : 4))
const timeFormat = computed(() => settings.value.timeFormat ?? 'h24')

const locked = computed(() => runtime.state.locked)
const showingApp = computed(() => !locked.value && runtime.state.currentApp !== null)

/**
 * 状态栏字色：
 *   锁屏 / 桌面（壁纸上是白字）→ light
 *   应用内（浅色页面）→ dark
 *   应用显式指定（照片的全屏查看器是黑底）→ 听应用的
 */
const statusTone = computed(() => {
  const explicit = runtime.state.statusTone
  if (showingApp.value && (explicit === 'light' || explicit === 'dark')) return explicit
  return showingApp.value ? 'dark' : 'light'
})

/**
 * 解锁请求。
 * 关键判断：**设了密码但密码是空串**（用户勾了开关却没输入）要按"没有密码"处理，
 * 否则会出现"怎么点都进不去"的死局 —— 密码盘接受了输入，但空串永远对不上。
 */
function requestUnlock() {
  if (passcodeEnabled.value && passcode.value) {
    runtime.openPasscode()
    return
  }
  runtime.unlock()
}

function onPasscodeSuccess() {
  runtime.unlock()
}

function onPasscodeCancel() {
  runtime.closePasscode()
}

/** 供 renderer 调用：phone:goto / phone:reset */
function goto(target) {
  runtime.goto(target)
}

function reset() {
  runtime.reset()
}

defineExpose({ resolvedMode, scale, shellEl, runtime, goto, reset })
</script>

<template>
  <PhoneShell
    ref="shellEl"
    class="pui-app-root"
    :mode="resolvedMode"
    :style="{ '--pui-shell-scale': scale }"
  >
    <div
      v-if="work"
      class="pui-system"
      :data-passcode-open="runtime.state.passcodeOpen && passcode ? 'true' : 'false'"
      data-testid="phone-system"
    >
      <!--
        三层互斥，用 Transition 交叉淡入：
        锁屏上滑解锁是"下方桌面先露出来"，不是锁屏淡出后桌面再出现，
        所以这里不用 out-in —— 同帧交叉才没有空白间隙。
      -->
      <Transition name="pui-fade">
        <LockScreen
          v-if="locked"
          key="lock"
          :work-settings="settings"
          :resolve-asset="resolveAsset"
          :passcode-open="runtime.state.passcodeOpen && Boolean(passcode)"
          @unlock="requestUnlock"
        />
        <HomeScreen v-else-if="!showingApp" key="home" />
        <AppHost v-else key="app" />
      </Transition>

      <!-- 密码盘：浮在锁屏之上，只在设了密码时打开 -->
      <PasscodePad
        v-if="runtime.state.passcodeOpen && passcode"
        :expected="passcode"
        :length="passcodeLength"
        :max-attempts="5"
        @success="onPasscodeSuccess"
        @cancel="onPasscodeCancel"
      />

      <StatusBar :tone="statusTone" :time-format="timeFormat" />
    </div>

    <PlaceholderStage v-else :mode="resolvedMode" />
  </PhoneShell>
</template>

<style>
.pui-system {
  position: absolute;
  inset: 0;
  overflow: hidden;
  isolation: isolate;
}

.pui-system .pui-lock__wall {
  transition: filter 180ms ease-out;
}

/* 密码盘打开时降低壁纸亮度，保留原图色彩与按键对背景的透出效果。 */
.pui-system[data-passcode-open='true'] .pui-lock__wall {
  filter: blur(18px) brightness(0.72);
}

.pui-system[data-passcode-open='true'] .pui-lock__scrim {
  opacity: 0;
}

.pui-system[data-passcode-open='true'] .pui-lock__content,
.pui-system[data-passcode-open='true'] .pui-lock__corner {
  visibility: hidden;
  pointer-events: none;
}

/*
 * 交叉淡入：160ms。
 * 用固定时长而不是 tokens 的 --pui-dur-base，是因为 reduce-motion 下
 * tokens 会把它压成 1ms —— 那样解锁会"啪"地切换，反而更晃眼。
 * 淡入淡出属于"不引起前庭反应"的动画，可以保留。
 */
.pui-fade-enter-active,
.pui-fade-leave-active {
  transition: opacity 160ms linear;
}

.pui-fade-enter-from,
.pui-fade-leave-to {
  opacity: 0;
}
</style>
