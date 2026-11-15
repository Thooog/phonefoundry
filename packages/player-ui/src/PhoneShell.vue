/**
 * 手机外壳
 *
 * 两种呈现方式（决策 B6 / D7）：
 *  - 桌面（宽视口）：居中显示设备外框 + 刘海，四周留白
 *  - 移动端（窄视口 / 触摸为主）：铺满可用视口，隐藏外框与假刘海
 *
 * 为什么移动端要隐藏假刘海：真实手机已有自己的刘海/灵动岛，
 * 再叠一个假的会挡住内容。此时只保留顶部安全区 padding。
 */

<script setup>
import { computed } from 'vue'

const props = defineProps({
  /** 'auto' 由外壳自己判断 | 'device' 强制设备框 | 'fill' 强制铺满 */
  mode: { type: String, default: 'auto' },
  /** 是否显示状态栏区域占位（锁屏/桌面会有，全屏应用可能隐藏） */
  showStatusBar: { type: Boolean, default: true },
})

const effectiveMode = computed(() => props.mode)
</script>

<template>
  <div class="pui-root pui-shell" :data-mode="effectiveMode" data-testid="phone-shell">
    <div class="pui-shell__stage">
      <div class="pui-shell__device">
        <!-- 侧键：真机上凸出机身的实体键，是"这是一台手机"的重要质感来源。
             挂在机身层，铺满模式下隐藏（真实手机有自己的键）。 -->
        <span class="pui-shell__key pui-shell__key--mute" aria-hidden="true"></span>
        <span class="pui-shell__key pui-shell__key--volup" aria-hidden="true"></span>
        <span class="pui-shell__key pui-shell__key--voldn" aria-hidden="true"></span>
        <span class="pui-shell__key pui-shell__key--power" aria-hidden="true"></span>
        <div class="pui-shell__screen">
          <div class="pui-shell__content">
            <slot />
          </div>
          <div class="pui-shell__notch" aria-hidden="true"></div>
          <div class="pui-shell__home-indicator" aria-hidden="true"></div>
        </div>
      </div>
    </div>
  </div>
</template>

<style>
.pui-shell {
  --pui-shell-scale: 1;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #e9e9ee;
  overflow: hidden;
}

/*
 * 舞台尺寸 = 设备尺寸 × 缩放。
 * 设备本身保持 100% 尺寸再 transform: scale，
 * 外层格子因此天然等于缩放后的视觉尺寸，flex 居中不会产生偏移。
 */
.pui-shell__stage {
  width: calc(var(--pui-device-w) * var(--pui-shell-scale));
  height: calc(var(--pui-device-h) * var(--pui-shell-scale));
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
}

.pui-shell__device {
  position: relative;
  width: var(--pui-device-w);
  height: var(--pui-device-h);
  flex: 0 0 auto;
  transform: scale(var(--pui-shell-scale));
  transform-origin: center center;
  border-radius: var(--pui-radius-device);

  background: linear-gradient(
    135deg,
    #d3d6dd 0%,
    #83858f 2%,
    #33343c 6%,
    #1b1c22 50%,
    #2c2d35 94%,
    #9b9fa9 98%,
    #d0d3da 100%
  );
  box-shadow:
    inset 0 0 0 2px rgba(0, 0, 0, 0.88),
    inset 0 0 1px 1px rgba(255, 255, 255, 0.16),
    0 0 0 1px rgba(0, 0, 0, 0.5),
    0 42px 88px -28px rgba(0, 0, 0, 0.5),
    0 14px 30px -14px rgba(0, 0, 0, 0.38);
}

/* ── 侧键：静音拨片 / 音量±（左），电源（右） ── */
.pui-shell__key {
  position: absolute;
  width: 3px;
  border-radius: 2px;
  /* 横向渐变模拟键自身的柱面反光：外缘暗、中间亮 */
  background: linear-gradient(90deg, #2e2f36 0%, #6f707a 45%, #1e1f25 100%);
  box-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.55);
}

.pui-shell__key--mute {
  left: -3px;
  top: 17.5%;
  height: 26px;
}

.pui-shell__key--volup {
  left: -3px;
  top: 24%;
  height: 54px;
}

.pui-shell__key--voldn {
  left: -3px;
  top: 32%;
  height: 54px;
}

.pui-shell__key--power {
  right: -3px;
  top: 27%;
  height: 76px;
}

/*
 * 灵动岛。
 * 真实 iPhone 14/15：约 125 × 37pt，屏幕宽 393pt → 宽约 31.8%，
 * 距屏幕顶 11pt，圆角全圆。
 *
 * 挂在屏幕层而不是机身层：挂机身层要额外算边框厚度，值容易算歪。
 */
.pui-shell__notch {
  position: absolute;
  top: 11px;
  left: 50%;
  translate: -50% 0;
  width: 31.8%;
  min-width: 88px;
  height: 33px;
  border-radius: 999px;
  background: #0b0b0f;
  z-index: 50;
}

/* 灵动岛右侧的前置镜头：一点冷色反光，纯黑胶囊会像一块贴纸 */
.pui-shell__notch::after {
  content: '';
  position: absolute;
  top: 50%;
  right: 11px;
  translate: 0 -50%;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: radial-gradient(circle at 32% 30%, #2b3a55 0%, #101625 45%, #04060c 100%);
}

/*
 * 屏幕内缩 = 机身边框厚度。
 * 同时把宽高各减 2 倍边框，保证屏幕的宽高比独立于机身比例，
 * 否则 390×844 机身配 370×824 屏幕会让画面显得偏胖。
 */
.pui-shell__screen {
  position: absolute;
  inset: var(--pui-bezel-width);
  border-radius: var(--pui-radius-screen);
  overflow: hidden;
  background: var(--pui-bg);
  isolation: isolate;
}

.pui-shell__content {
  position: absolute;
  inset: 0;
  overflow: hidden;
  /* 屏幕内所有布局都以"屏幕宽度"为基准，避免缩放后 rem 抖动 */
  container-type: inline-size;
}

/* Home 指示条：宽度按屏幕宽度比例，真机约 134/390 ≈ 34% */
.pui-shell__home-indicator {
  position: absolute;
  bottom: 8px;
  left: 50%;
  translate: -50% 0;
  width: 34%;
  max-width: 140px;
  height: 5px;
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.28);
  z-index: 55;
  pointer-events: none;
}

/* ── 铺满模式：隐藏外框与假刘海，只保留安全区 ── */
.pui-shell[data-mode='fill'] {
  background: #000;
}

.pui-shell[data-mode='fill'] .pui-shell__stage {
  width: 100%;
  height: 100%;
}

.pui-shell[data-mode='fill'] .pui-shell__device {
  width: 100%;
  height: 100%;
  /* 用 !important 覆盖内联的 --pui-shell-scale，避免 @media 下残留缩放 */
  transform: none;
  border-radius: 0;
  box-shadow: none;
  background: var(--pui-bg);
}

.pui-shell[data-mode='fill'] .pui-shell__notch {
  display: none;
}

/* 铺满模式：真实手机有自己的实体键，自绘的会画在屏幕内容里，隐藏 */
.pui-shell[data-mode='fill'] .pui-shell__key {
  display: none;
}

.pui-shell[data-mode='fill'] .pui-shell__screen {
  inset: 0;
  border-radius: 0;
}

/* 铺满模式：真实手机系统自己会画 Home 条，叠两条很怪，所以隐藏自绘的 */
.pui-shell[data-mode='fill'] .pui-shell__home-indicator {
  display: none;
}
</style>
