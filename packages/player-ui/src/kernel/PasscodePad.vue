

<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useReducedMotion } from '../motion/reduced-motion.js'

const props = defineProps({
  /** 正确密码（字符串） */
  expected: { type: String, default: '' },
  /** 位数 4 | 6 */
  length: { type: Number, default: 4 },
  /** 错误提示里显示的剩余次数；0 表示不提示次数 */
  maxAttempts: { type: Number, default: 0 },

  title: { type: String, default: '输入密码' },
  hint: { type: String, default: '' },
  showEmergency: { type: Boolean, default: true },
  /**
   * 配色主题：
   *   'dark'  —— 默认，透明底 + 白字（锁屏压在壁纸上，沿用旧外观）
   *   'light' —— 白底 + 深色字，圆键是浅灰底深色数字（相簿密码锁，压在照片白底应用之上）
   */
  theme: { type: String, default: 'dark' },
})

const emit = defineEmits(['success', 'cancel'])

/** 抖动的时长，与 CSS 动画保持一致 */
const SHAKE_MS = 420

const digits = ref([])
const error = ref(false)
const attempts = ref(0)
const reduced = useReducedMotion()
let shakeTimer = 0

const total = computed(() => (props.length === 6 ? 6 : 4))
const filled = computed(() => digits.value.length)
const keypad = computed(() => [
  '1', '2', '3',
  '4', '5', '6',
  '7', '8', '9',
  '', '0', filled.value > 0 ? 'del' : '',
])

const LETTERS = {
  2: 'ABC',
  3: 'DEF',
  4: 'GHI',
  5: 'JKL',
  6: 'MNO',
  7: 'PQRS',
  8: 'TUV',
  9: 'WXYZ',
}

const message = computed(() => {
  if (!error.value) return ''
  if (props.maxAttempts > 0) {
    const left = Math.max(0, props.maxAttempts - attempts.value)
    return left > 0 ? `密码不正确，还可以试 ${left} 次` : '密码不正确'
  }
  return '密码不正确'
})

// 位数变了（编辑端切换 4/6 位）要清空，否则旧的 4 位会立刻被判错
watch(
  () => props.length,
  () => {
    digits.value = []
    error.value = false
  },
)

onBeforeUnmount(() => clearTimeout(shakeTimer))

function press(key) {
  if (key === 'del') {
    digits.value = digits.value.slice(0, -1)
    error.value = false
    return
  }
  if (!key || digits.value.length >= total.value) return
  digits.value = [...digits.value, key]

  if (digits.value.length === total.value) {
    // 让最后一个圆点先渲染出来再判定，否则"点满即抖动"会显得很突兀
    setTimeout(verify, 60)
  }
}

function verify() {
  const input = digits.value.join('')
  if (props.expected && input === props.expected) {
    emit('success')
    return
  }
  attempts.value += 1
  error.value = true
  digits.value = []
  clearTimeout(shakeTimer)
  shakeTimer = setTimeout(() => {
    error.value = false
  }, SHAKE_MS)
}

defineExpose({ digits, error, attempts, press })
</script>

<template>
  <div
    class="pui-pass"
    :class="{ 'pui-pass--error': error, 'pui-pass--light': theme === 'light' }"
    :data-error="error ? 'true' : 'false'"
    :data-length="total"
    :data-reduced="reduced ? 'true' : 'false'"
    :data-theme="theme"
    data-testid="passcode-pad"
  >
    <div class="pui-pass__head">
      <p class="pui-pass__title">{{ title }}</p>
      <p v-if="hint" class="pui-pass__hint">{{ hint }}</p>

      <div class="pui-pass__dots" :data-count="total">
        <span
          v-for="index in total"
          :key="index"
          class="pui-pass__dot"
          :class="{ 'pui-pass__dot--on': index <= filled }"
          :data-testid="`passcode-dot-${index}`"
        ></span>
      </div>

      <!-- 提示行固定高度：出现/消失时不推挤密码盘，否则手指下的按键会跳走 -->
      <p class="pui-pass__msg" data-testid="passcode-message" role="status">{{ message }}</p>
    </div>

    <div class="pui-pass__keys">
      <template v-for="(key, index) in keypad" :key="index">
        <span v-if="!key" class="pui-pass__spacer"></span>
        <button
          v-else
          type="button"
          class="pui-pass__key"
          :data-testid="key === 'del' ? 'passcode-backspace' : `passcode-key-${key}`"
          @click="press(key)"
        >
          <svg v-if="key === 'del'" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path
              d="M9 5h10a2 2 0 012 2v10a2 2 0 01-2 2H9l-6-7 6-7z"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linejoin="round"
            />
            <path
              d="M12 9.5l5 5M17 9.5l-5 5"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
            />
          </svg>
          <template v-else>
            <span class="pui-pass__digit">{{ key }}</span>
            <span v-if="LETTERS[key]" class="pui-pass__letters">{{ LETTERS[key] }}</span>
          </template>
        </button>
      </template>
    </div>

    <div class="pui-pass__foot" :class="{ 'pui-pass__foot--solo': !showEmergency }">
      <span v-if="showEmergency" class="pui-pass__sos">紧急情况</span>
      <button type="button" class="pui-pass__cancel" data-testid="passcode-cancel" @click="$emit('cancel')">
        取消
      </button>
    </div>
  </div>
</template>

<style>
.pui-pass {
  position: absolute;
  inset: 0;
  z-index: var(--pui-z-overlay);
  display: flex;
  flex-direction: column;

  padding: calc(var(--pui-statusbar-h) + 24px) var(--pui-space-6)
    calc(var(--pui-homebar-h) + 20px);
  background: transparent;
  color: rgba(255, 255, 255, 0.95);
  animation: pui-pass-in 220ms var(--pui-ease-out) both;
}

@keyframes pui-pass-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

.pui-pass__head {
  text-align: center;

  margin-top: 74px;
}

.pui-pass__title {
  margin: 0 0 14px;
  font-size: var(--pui-font-title3);
  font-weight: var(--pui-weight-semibold);
  letter-spacing: var(--pui-tracking-title);
}

/* 副标题：只在相簿密码锁这类「复用密码盘」的场景出现，锁屏不渲染 */
.pui-pass__hint {
  margin: -8px 0 16px;
  font-size: var(--pui-font-footnote);
  color: rgba(255, 255, 255, 0.72);
}

.pui-pass__dots {
  display: flex;
  align-items: center;
  justify-content: center;

  gap: 20px;
  height: 18px;
}

.pui-pass__dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 1.5px solid rgba(255, 255, 255, 0.8);
  background: transparent;
  transition:
    background-color 120ms linear,
    transform 120ms var(--pui-ease-out);
}

.pui-pass__dot--on {
  background: #fff;
  transform: scale(1.06);
}

.pui-pass--error .pui-pass__dot {
  border-color: var(--pui-red);
  background: var(--pui-red);
}

.pui-pass__msg {
  height: 18px;
  margin: 14px 0 0;
  font-size: var(--pui-font-footnote);
  color: var(--pui-red);
  opacity: 0;
  transition: opacity 140ms linear;
}

.pui-pass--error .pui-pass__msg {
  opacity: 1;
}

/*
 * 抖动：整体左右摆而不是每个圆点各抖 ——
 * 圆点相位一旦不同步，看起来像加载失败而不是"密码错了"。
 */
.pui-pass--error .pui-pass__dots {
  animation: pui-pass-shake 420ms cubic-bezier(0.36, 0.07, 0.19, 0.97) both;
}

@keyframes pui-pass-shake {
  10%,
  90% {
    transform: translateX(-2px);
  }
  20%,
  80% {
    transform: translateX(4px);
  }
  30%,
  50%,
  70% {
    transform: translateX(-7px);
  }
  40%,
  60% {
    transform: translateX(7px);
  }
}

/* reduce-motion：只保留"变色 + 提示"，不做位移 */
.pui-pass[data-reduced='true'].pui-pass--error .pui-pass__dots {
  animation: none;
}

.pui-pass[data-reduced='true'] {
  animation: pui-pass-fade 160ms linear both;
}

@keyframes pui-pass-fade {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.pui-pass__keys {
  display: grid;

  grid-template-columns: repeat(3, 80px);
  gap: 14px 25px;
  justify-content: center;
  /* 首行中心 y≈323：head 底 ≈246 + 37 到盘顶 */
  margin: 37px auto 0;
  width: 100%;
}

.pui-pass__key {
  width: 80px;
  aspect-ratio: 1;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  /* 简洁半透明磨砂圆键，背景模糊由锁屏壁纸层统一处理。 */
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 50%;
  background: rgba(228, 233, 238, 0.22);
  -webkit-backdrop-filter: blur(2px);
  backdrop-filter: blur(2px);
  box-shadow: none;
  color: #fff;
  font: inherit;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition:
    transform 120ms var(--pui-ease-out),
    background-color 120ms linear;
  will-change: transform;
}

.pui-pass__digit {
  font-size: 1.6rem;
  line-height: 1.1;
  font-weight: var(--pui-weight-regular);
}

.pui-pass__letters {
  font-size: 0.5625rem;
  letter-spacing: 0.12em;
  color: rgba(255, 255, 255, 0.8);
  text-transform: uppercase;
}

/* 按下的反馈必须是"即时"的：这里不用 transition，只改背景与缩放 */
.pui-pass__key:active {
  background-color: rgba(255, 255, 255, 0.32);
  transform: scale(0.88);
}

.pui-pass__key:focus-visible {
  outline: 2px solid rgba(255, 255, 255, 0.95);
  outline-offset: 3px;
}

.pui-pass__spacer {
  display: block;
}

/* 底部操作区与三列数字键等宽，让两侧文案对齐最外侧圆键。 */
.pui-pass__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  max-width: 290px;
  padding: 0;
  margin: auto auto 0;
}

/* 藏起「紧急情况」后让「取消」保持在右侧原位，别跳到左边 */
.pui-pass__foot--solo {
  justify-content: flex-end;
}

.pui-pass__sos {
  font-size: var(--pui-font-body);
  color: rgba(255, 255, 255, 0.95);
}

.pui-pass__cancel {
  padding: 10px 20px;
  /* 抵消自身水平内边距：让"取消"文字与左侧"紧急情况"对称落在距边 44px 处，
   * 同时保留 20px 额外点击热区 */
  margin-right: -20px;
  border: 0;
  background: transparent;
  color: rgba(255, 255, 255, 0.95);
  font: inherit;
  font-size: var(--pui-font-body);
  cursor: pointer;
}

.pui-pass--light {
  background: #fff;
  color: var(--pui-label);
}

.pui-pass--light .pui-pass__hint {
  color: var(--pui-label-2);
}

.pui-pass--light .pui-pass__dot {
  border-color: rgba(0, 0, 0, 0.4);
  background: transparent;
}

.pui-pass--light .pui-pass__dot--on {
  background: #000;
  border-color: #000;
}

.pui-pass--light .pui-pass__key {
  border-color: rgba(0, 0, 0, 0.06);
  background: rgba(0, 0, 0, 0.06);
  color: #000;
}

.pui-pass--light .pui-pass__letters {
  color: rgba(0, 0, 0, 0.5);
}

.pui-pass--light .pui-pass__key:active {
  background-color: rgba(0, 0, 0, 0.13);
}

.pui-pass--light .pui-pass__key:focus-visible {
  outline-color: rgba(0, 0, 0, 0.6);
}

.pui-pass--light .pui-pass__sos,
.pui-pass--light .pui-pass__cancel {
  color: var(--pui-label);
}
</style>
