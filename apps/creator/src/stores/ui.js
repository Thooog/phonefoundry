

import { defineStore } from 'pinia'
import { ref } from 'vue'

/** toast 自增 id，不用随机数 —— 便于在测试里断言顺序 */
let toastSeq = 0

export const useUiStore = defineStore('ui', () => {
  /** @type {import('vue').Ref<Array<{id:number, message:string, tone:string}>>} */
  const toasts = ref([])

  /** 同一时刻只允许一个确认框，排队会让 UI 出现叠层 */
  const dialog = ref(null)

  const toastTimers = new Map()

  /**
   * 弹一条轻提示。
   * @param {string} message
   * @param {{tone?: 'info'|'success'|'error', duration?: number}} [options]
   */
  function toast(message, options = {}) {
    const id = (toastSeq += 1)
    const tone = options.tone ?? 'info'
    const duration = options.duration ?? (tone === 'error' ? 6000 : 3200)

    toasts.value = [...toasts.value, { id, message, tone }]

    if (duration > 0) {
      const timer = setTimeout(() => dismissToast(id), duration)
      toastTimers.set(id, timer)
    }
    return id
  }

  function dismissToast(id) {
    const timer = toastTimers.get(id)
    if (timer) {
      clearTimeout(timer)
      toastTimers.delete(id)
    }
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }

  /**
   * 请求确认。返回 Promise<boolean>，用户点确定才是 true。
   *
   * 若已有对话框在等待，新请求会覆盖旧的并让旧的按"取消"结束 ——
   * 宁可丢掉一次确认，也不要出现两个遮罩叠在一起、用户点了没反应。
   *
   * @param {{title: string, message?: string, confirmText?: string, cancelText?: string, tone?: 'default'|'danger'}} options
   * @returns {Promise<boolean>}
   */
  function confirm(options) {
    if (dialog.value) {
      dialog.value.resolve(false)
      dialog.value = null
    }

    return new Promise((resolve) => {
      dialog.value = {
        title: options.title,
        message: options.message ?? '',
        confirmText: options.confirmText ?? '确定',
        cancelText: options.cancelText ?? '取消',
        tone: options.tone ?? 'default',
        resolve,
      }
    })
  }

  /** 由 ConfirmDialog 调用 */
  function settleDialog(ok) {
    const current = dialog.value
    dialog.value = null
    current?.resolve(ok)
  }

  function reset() {
    toastTimers.forEach((t) => clearTimeout(t))
    toastTimers.clear()
    toasts.value = []
    if (dialog.value) {
      dialog.value.resolve(false)
      dialog.value = null
    }
  }

  return {
    toasts,
    dialog,
    toast,
    dismissToast,
    confirm,
    settleDialog,
    reset,
  }
})
