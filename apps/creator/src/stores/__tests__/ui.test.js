/**
 * uiStore 测试。
 *
 * 重点不是"能弹出一个 toast"，而是两件容易出错的事：
 *  1. 确认框的 Promise 必须**恰好**被 resolve 一次（漏了会让 await 永久挂起，
 *     重复 resolve 会让同一个操作执行两遍 —— 删除确认上这就是灾难）
 *  2. 第二个确认请求到达时，第一个必须按"取消"结束，不能两个都挂着
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useUiStore } from '../ui.js'

beforeEach(() => {
  setActivePinia(createPinia())
  vi.useRealTimers()
})

describe('轻提示', () => {
  it('按顺序追加，带自增 id', () => {
    const ui = useUiStore()
    ui.toast('第一条', { duration: 0 })
    ui.toast('第二条', { duration: 0 })

    expect(ui.toasts.map((t) => t.message)).toEqual(['第一条', '第二条'])
    expect(ui.toasts[1].id).toBeGreaterThan(ui.toasts[0].id)
  })

  it('duration 到点后自动移除', () => {
    vi.useFakeTimers()
    const ui = useUiStore()
    ui.toast('会消失', { duration: 1000 })

    expect(ui.toasts).toHaveLength(1)
    vi.advanceTimersByTime(1000)
    expect(ui.toasts).toHaveLength(0)
  })

  it('duration 为 0 时不会自己消失（用于必须被看到的提示）', () => {
    vi.useFakeTimers()
    const ui = useUiStore()
    ui.toast('常驻', { duration: 0 })

    vi.advanceTimersByTime(60000)
    expect(ui.toasts).toHaveLength(1)
  })

  it('手动关闭只移除对应那条', () => {
    const ui = useUiStore()
    const keep = ui.toast('留着', { duration: 0 })
    const drop = ui.toast('删掉', { duration: 0 })

    ui.dismissToast(drop)
    expect(ui.toasts.map((t) => t.id)).toEqual([keep])
  })

  it('错误提示默认停留更久', () => {
    vi.useFakeTimers()
    const ui = useUiStore()
    ui.toast('出错了', { tone: 'error' })

    vi.advanceTimersByTime(4000)
    expect(ui.toasts).toHaveLength(1) // 普通提示 3.2s 就没了，错误提示还在
    vi.advanceTimersByTime(2500)
    expect(ui.toasts).toHaveLength(0)
  })
})

describe('确认框', () => {
  it('点确定 → Promise 为 true', async () => {
    const ui = useUiStore()
    const pending = ui.confirm({ title: '删除？' })

    expect(ui.dialog.title).toBe('删除？')
    ui.settleDialog(true)

    await expect(pending).resolves.toBe(true)
    expect(ui.dialog).toBeNull()
  })

  it('点取消 → Promise 为 false', async () => {
    const ui = useUiStore()
    const pending = ui.confirm({ title: '删除？' })
    ui.settleDialog(false)

    await expect(pending).resolves.toBe(false)
  })

  it('普通确认默认「确定/取消」，危险操作可换文案', async () => {
    const ui = useUiStore()
    const first = ui.confirm({ title: 'A' })
    expect(ui.dialog.confirmText).toBe('确定')
    expect(ui.dialog.cancelText).toBe('取消')
    ui.settleDialog(false)
    await first

    const second = ui.confirm({ title: 'B', confirmText: '删除', tone: 'danger' })
    expect(ui.dialog.confirmText).toBe('删除')
    expect(ui.dialog.tone).toBe('danger')
    ui.settleDialog(false)
    await second
  })

  it('重复 settle 不会让同一个 Promise 被 resolve 两次', async () => {
    const ui = useUiStore()
    let resolvedCount = 0
    const pending = ui.confirm({ title: '只结算一次' }).then((v) => {
      resolvedCount += 1
      return v
    })

    ui.settleDialog(true)
    ui.settleDialog(true)
    ui.settleDialog(false)

    await expect(pending).resolves.toBe(true)
    expect(resolvedCount).toBe(1)
  })

  it('已有确认框时再来一个：旧的按取消结束，新的接管', async () => {
    const ui = useUiStore()
    const first = ui.confirm({ title: '第一个' })
    const second = ui.confirm({ title: '第二个' })

    await expect(first).resolves.toBe(false)
    expect(ui.dialog.title).toBe('第二个')

    ui.settleDialog(true)
    await expect(second).resolves.toBe(true)
  })
})

describe('reset', () => {
  it('清空提示与对话框，未决的确认按取消结束（页面卸载时不能让 await 悬着）', async () => {
    const ui = useUiStore()
    ui.toast('残留', { duration: 0 })
    const pending = ui.confirm({ title: '未决' })

    ui.reset()

    await expect(pending).resolves.toBe(false)
    expect(ui.toasts).toHaveLength(0)
    expect(ui.dialog).toBeNull()
  })
})
