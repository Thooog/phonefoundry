

import { describe, it, expect } from 'vitest'
import { createPhoneRuntime } from '../kernel/create-runtime.js'

describe('初始状态', () => {
  it('默认锁屏，且在锁屏时不算 home', () => {
    const rt = createPhoneRuntime()
    expect(rt.state.locked).toBe(true)
    expect(rt.atHome.value).toBe(false)
    expect(rt.state.currentApp).toBe(null)
    expect(rt.state.stack).toEqual([])
  })

  it('可以以未锁屏状态创建（导出后自动进入桌面）', () => {
    const rt = createPhoneRuntime({ locked: false })
    expect(rt.atHome.value).toBe(true)
  })
})

describe('解锁与锁屏', () => {
  it('解锁后进入桌面', () => {
    const rt = createPhoneRuntime()
    rt.unlock()
    expect(rt.state.locked).toBe(false)
    expect(rt.atHome.value).toBe(true)
    expect(rt.state.booted).toBe(true)
  })

  it('锁屏会清空应用与栈', () => {
    const rt = createPhoneRuntime({ locked: false })
    rt.openApp('kakaotalk')
    rt.push('chat', 'conv_1')
    rt.lock()
    expect(rt.state.locked).toBe(true)
    expect(rt.state.currentApp).toBe(null)
    expect(rt.state.stack).toEqual([])
  })
})

/**
 * 状态栏字色是应用可覆盖的唯一一项系统外观。
 * 照片的全屏查看器靠它把黑底上的白字要回来 —— 忘记复位会污染下一个应用。
 */
describe('状态栏字色', () => {
  it('默认自动，应用可以临时改成 light', () => {
    const rt = createPhoneRuntime({ locked: false })
    expect(rt.state.statusTone).toBe('auto')
    rt.openApp('photos')
    rt.setStatusTone('light')
    expect(rt.state.statusTone).toBe('light')
  })

  it('非法值回到自动，而不是把字色写坏', () => {
    const rt = createPhoneRuntime({ locked: false })
    rt.setStatusTone('purple')
    expect(rt.state.statusTone).toBe('auto')
  })

  it('换应用、回桌面、锁屏都会复位', () => {
    const rt = createPhoneRuntime({ locked: false })
    rt.openApp('photos')
    rt.setStatusTone('light')
    rt.goHome()
    expect(rt.state.statusTone).toBe('auto')

    rt.openApp('photos')
    rt.setStatusTone('light')
    rt.openApp('x')
    expect(rt.state.statusTone).toBe('auto')

    rt.setStatusTone('light')
    rt.lock()
    expect(rt.state.statusTone).toBe('auto')
  })
})

describe('应用导航栈', () => {
  it('进入应用时栈里只有一个根屏', () => {
    const rt = createPhoneRuntime({ locked: false })
    rt.openApp('kakaotalk')
    expect(rt.state.currentApp).toBe('kakaotalk')
    expect(rt.state.stack).toEqual([{ name: 'root', params: null }])
    expect(rt.currentScreen.value).toEqual({ name: 'root', params: null })
    expect(rt.state.transition).toBe('push')
  })

  it('push 一层 → pop 回到根屏 → 再 pop 回到桌面', () => {
    const rt = createPhoneRuntime({ locked: false })
    rt.openApp('kakaotalk')
    rt.push('chat', 'conv_1')
    expect(rt.currentScreen.value).toEqual({ name: 'chat', params: 'conv_1' })

    expect(rt.pop()).toBe(true)
    expect(rt.state.currentApp).toBe('kakaotalk')
    expect(rt.currentScreen.value.name).toBe('root')

    expect(rt.pop()).toBe(true)
    expect(rt.state.currentApp).toBe(null)
    expect(rt.state.stack).toEqual([])
    expect(rt.atHome.value).toBe(true)
  })

  it('重复 push 同一屏不会压两层（防双击）', () => {
    const rt = createPhoneRuntime({ locked: false })
    rt.openApp('kakaotalk')
    rt.push('chat', 'conv_1')
    rt.push('chat', 'conv_1')
    expect(rt.state.stack).toHaveLength(2)
  })

  it('同一屏不同参数允许入栈', () => {
    const rt = createPhoneRuntime({ locked: false })
    rt.openApp('kakaotalk')
    rt.push('chat', 'conv_1')
    rt.push('chat', 'conv_2')
    expect(rt.state.stack).toHaveLength(3)
    expect(rt.currentScreen.value.params).toBe('conv_2')
  })

  it('在桌面上 pop 不发生任何事', () => {
    const rt = createPhoneRuntime({ locked: false })
    expect(rt.pop()).toBe(false)
    expect(rt.state.currentApp).toBe(null)
  })

  it('goHome 从任意深度直接回桌面', () => {
    const rt = createPhoneRuntime({ locked: false })
    rt.openApp('x')
    rt.push('post', 'p1')
    rt.push('comment', 'c1')
    rt.goHome()
    expect(rt.state.currentApp).toBe(null)
    expect(rt.state.stack).toEqual([])
  })

  it('切换应用会重置栈，不继承上一个应用的层级', () => {
    const rt = createPhoneRuntime({ locked: false })
    rt.openApp('kakaotalk')
    rt.push('chat', 'conv_1')
    rt.openApp('instagram')
    expect(rt.state.stack).toEqual([{ name: 'root', params: null }])
  })

  it('pop 使用反向过渡标记', () => {
    const rt = createPhoneRuntime({ locked: false })
    rt.openApp('kakaotalk')
    rt.push('chat', 'conv_1')
    rt.pop()
    expect(rt.state.transition).toBe('pop')
  })
})

describe('预览定位 goto', () => {
  it('直接落到应用内的某屏', () => {
    const rt = createPhoneRuntime()
    rt.goto({ app: 'kakaotalk', screen: 'chat', entityId: 'conv_1' })
    expect(rt.state.locked).toBe(false)
    expect(rt.state.currentApp).toBe('kakaotalk')
    expect(rt.currentScreen.value).toEqual({ name: 'chat', params: 'conv_1' })
  })

  it('app 为 home 时回桌面', () => {
    const rt = createPhoneRuntime({ locked: false })
    rt.openApp('kakaotalk')
    rt.goto({ app: 'home' })
    expect(rt.state.currentApp).toBe(null)
    expect(rt.state.locked).toBe(false)
  })
})

describe('reset', () => {
  it('回到锁屏初始态', () => {
    const rt = createPhoneRuntime({ locked: false })
    rt.openApp('kakaotalk')
    rt.unlock()
    rt.reset()
    expect(rt.state.locked).toBe(true)
    expect(rt.state.currentApp).toBe(null)
    expect(rt.state.stack).toEqual([])
    expect(rt.state.booted).toBe(false)
  })

  it('复位会清掉玩家在作品端留下的照片标记', () => {
    const rt = createPhoneRuntime({ locked: false })
    rt.state.photoFlags = { pho_1: { isFavorite: true, isInTrash: true } }
    rt.reset()
    expect(rt.state.photoFlags).toEqual({})
  })
})

/** 换作品（预览直达）不该把上一部手机的收藏/回收站带过来 */
describe('photoFlags', () => {
  it('初始为空，且 goto 到另一个应用时清空', () => {
    const rt = createPhoneRuntime({ locked: false })
    expect(rt.state.photoFlags).toEqual({})
    rt.state.photoFlags = { pho_1: { isFavorite: true } }
    rt.goto({ app: 'photos' })
    expect(rt.state.photoFlags).toEqual({})
  })

  it('正常切应用 / 回桌面不清空（切一圈回来收藏还在）', () => {
    const rt = createPhoneRuntime({ locked: false })
    rt.state.photoFlags = { pho_1: { isInTrash: true } }
    rt.openApp('photos')
    rt.goHome()
    rt.openApp('kakaotalk')
    expect(rt.state.photoFlags).toEqual({ pho_1: { isInTrash: true } })
  })
})

describe('滚动位置记忆', () => {
  it('记下的位置能原样读回', () => {
    const rt = createPhoneRuntime({ locked: false })
    rt.rememberScroll('kakaotalk:list', 320)
    expect(rt.recallScroll('kakaotalk:list')).toBe(320)
  })

  it('没记过 / 空键都返回 0，调用方不必自己判空', () => {
    const rt = createPhoneRuntime({ locked: false })
    expect(rt.recallScroll('kakaotalk:list')).toBe(0)
    expect(rt.recallScroll('')).toBe(0)
    rt.rememberScroll('', 100)
    expect(rt.recallScroll('')).toBe(0)
  })

  it('非法值不写入（NaN / 负数），避免还原时 scrollTop 被赋成怪值', () => {
    const rt = createPhoneRuntime({ locked: false })
    rt.rememberScroll('k', NaN)
    rt.rememberScroll('k', -5)
    expect(rt.recallScroll('k')).toBe(0)
  })

  it('两个运行时互不串位置（同页并排演示两部手机）', () => {
    const a = createPhoneRuntime({ locked: false })
    const b = createPhoneRuntime({ locked: false })
    a.rememberScroll('kakaotalk:list', 300)
    expect(b.recallScroll('kakaotalk:list')).toBe(0)
  })

  it('回锁屏 / 复位会清空：那一轮使用已经结束', () => {
    const rt = createPhoneRuntime({ locked: false })
    rt.rememberScroll('kakaotalk:list', 300)
    rt.lock()
    expect(rt.recallScroll('kakaotalk:list')).toBe(0)

    rt.rememberScroll('kakaotalk:list', 300)
    rt.reset()
    expect(rt.recallScroll('kakaotalk:list')).toBe(0)
  })

  it('从桌面重新点进应用不清空 —— 那正是要记住的场景', () => {
    const rt = createPhoneRuntime({ locked: false })
    rt.rememberScroll('kakaotalk:list', 300)
    rt.openApp('kakaotalk')
    rt.goHome()
    expect(rt.recallScroll('kakaotalk:list')).toBe(300)
  })
})

/** 桌面入场动画的开关：读一次就作废，避免每次回桌面都抖一遍 */
describe('开机标记 consumeBoot', () => {
  it('解锁后能取到一次，第二次取不到', () => {
    const rt = createPhoneRuntime()
    rt.unlock()
    expect(rt.consumeBoot()).toBe(true)
    expect(rt.consumeBoot()).toBe(false)
  })

  it('没解锁时取不到（直接 goto 进应用不该播入场）', () => {
    const rt = createPhoneRuntime()
    expect(rt.consumeBoot()).toBe(false)
  })

  it('reset 后重新解锁会再给一次', () => {
    const rt = createPhoneRuntime()
    rt.unlock()
    rt.consumeBoot()
    rt.reset()
    rt.unlock()
    expect(rt.consumeBoot()).toBe(true)
  })
})

/**
 * 跨应用「借道」：信息应用的联系人页点「呼叫」，临时进电话的通话屏。
 *
 * 锁两件事：
 *   1. 挂断必须还回**借道前的那个页面**，而不是落在电话应用自己的首页
 *      （用户从没进过电话，把他丢在通讯录里就是"点挂断反而跳到联系人"）；
 *   2. 借道用 'fade'（整层淡入淡出），不是 'push'（横滑进来）——
 *      通话是全屏接管，横滑会让人以为又推进了一层页面。
 */
describe('跨应用借道 borrowApp', () => {
  it('记住来处，并把目标屏压到目标应用根屏之上', () => {
    const rt = createPhoneRuntime({ locked: false })
    rt.openApp('messages')
    rt.push('chat', 'conv_1')
    rt.push('contact', 'c_zhou')

    expect(rt.borrowApp('phone', 'call', { number: '13900139000' })).toBe(true)
    expect(rt.state.currentApp).toBe('phone')
    expect(rt.state.stack.map((s) => s.name)).toEqual(['root', 'call'])
    expect(rt.currentScreen.value.params).toEqual({ number: '13900139000' })
    expect(rt.state.transition).toBe('fade')
  })

  it('归还时原样回到借道前的应用与屏（含完整栈）', () => {
    const rt = createPhoneRuntime({ locked: false })
    rt.openApp('messages')
    rt.push('chat', 'conv_1')
    rt.push('contact', 'c_zhou')
    rt.borrowApp('phone', 'call', { number: '13900139000' })

    expect(rt.returnFromBorrow()).toBe(true)
    expect(rt.state.currentApp).toBe('messages')
    expect(rt.state.stack.map((s) => s.name)).toEqual(['root', 'chat', 'contact'])
    expect(rt.currentScreen.value.params).toBe('c_zhou')
    expect(rt.state.transition).toBe('fade')
  })

  it('没借道时归还返回 false（调用方该走普通 pop）', () => {
    const rt = createPhoneRuntime({ locked: false })
    rt.openApp('phone')
    rt.push('call', { number: '1' })
    expect(rt.returnFromBorrow()).toBe(false)
    expect(rt.state.currentApp).toBe('phone')
  })

  it('借道是临时的：正常离开应用会作废来处', () => {
    const rt = createPhoneRuntime({ locked: false })
    rt.openApp('messages')
    rt.push('contact', 'c_zhou')
    rt.borrowApp('phone', 'call', { number: '1' })
    rt.openApp('kakaotalk')
    expect(rt.returnFromBorrow()).toBe(false)
    expect(rt.state.currentApp).toBe('kakaotalk')
  })

  it('回桌面 / 锁屏 / 复位同样作废来处', () => {
    const make = () => {
      const rt = createPhoneRuntime({ locked: false })
      rt.openApp('messages')
      rt.borrowApp('phone', 'call', { number: '1' })
      return rt
    }
    const a = make()
    a.goHome()
    expect(a.returnFromBorrow()).toBe(false)

    const b = make()
    b.lock()
    expect(b.returnFromBorrow()).toBe(false)

    const c = make()
    c.reset()
    expect(c.returnFromBorrow()).toBe(false)
  })

  it('借道屏把状态栏切成白字后，归还时要还回自动判断', () => {
    const rt = createPhoneRuntime({ locked: false })
    rt.openApp('messages')
    rt.borrowApp('phone', 'call', { number: '1' })
    // 通话屏挂载后会把状态栏改白；组件整层卸载时它自己的 watch 不会跑
    rt.setStatusTone('light')
    rt.returnFromBorrow()
    expect(rt.state.statusTone).toBe('auto')
  })

  it('重复借道不会把来处覆盖成自己（连点两次「呼叫」仍能回到信息）', () => {
    const rt = createPhoneRuntime({ locked: false })
    rt.openApp('messages')
    rt.push('contact', 'c_zhou')
    rt.borrowApp('phone', 'call', { number: '1' })
    rt.borrowApp('phone', 'call', { number: '2' })
    expect(rt.returnFromBorrow()).toBe(true)
    expect(rt.state.currentApp).toBe('messages')
    expect(rt.currentScreen.value.params).toBe('c_zhou')
    expect(rt.returnFromBorrow()).toBe(false)
  })
})
