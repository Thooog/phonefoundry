/**
 * 「应用设定」裁剪与派生测试。
 *
 * 重点守住三条边界：
 *   1. 旧项目没有 appSettings 也要补齐默认值（作品端不能读到 undefined）；
 *   2. 开关关闭时密码串不带进作品数据（与锁屏密码同一条安全约定）；
 *   3. 开关开着但密码没填满 → 不上锁（否则读者撞上「怎么输都进不去」的死局）。
 */

import { describe, it, expect } from 'vitest'
import { createProject } from '../factory/index.js'
import { toWorkData } from '../work/to-work-data.js'
import {
  DEFAULT_WIFI_NAME,
  WIFI_NAME_MAX_LENGTH,
  createDefaultAppSettings,
  normalizeAppSettings,
  resolvePhotoLock,
  resolveWifiName,
} from '../work/app-settings.js'

describe('normalizeAppSettings', () => {
  it('默认值：两把锁都关、4 位、无密码，Wi-Fi 名留空', () => {
    expect(normalizeAppSettings(undefined)).toEqual(createDefaultAppSettings())
  })

  it('只认 4 / 6 位，其余一律按 4 位', () => {
    expect(normalizeAppSettings({ photoLocks: { hidden: { length: 5 } } }).photoLocks.hidden.length).toBe(4)
    expect(normalizeAppSettings({ photoLocks: { trash: { length: 6 } } }).photoLocks.trash.length).toBe(6)
  })

  it('密码只留数字并截到位数', () => {
    const out = normalizeAppSettings({
      photoLocks: { hidden: { enabled: true, length: 4, passcode: '0a4b2c8d99' } },
    })
    expect(out.photoLocks.hidden.passcode).toBe('0428')
  })

  it('关闭开关时不携带密码串', () => {
    const out = normalizeAppSettings({
      photoLocks: { hidden: { enabled: false, length: 4, passcode: '0428' } },
    })
    expect(out.photoLocks.hidden.passcode).toBe('')
  })

  it('Wi-Fi 名去首尾空格并限长，未知字段不夹带', () => {
    const out = normalizeAppSettings({ wifiName: '  Linxia Home  ', junk: 'x' })
    expect(out.wifiName).toBe('Linxia Home')
    expect(out).not.toHaveProperty('junk')
    expect(normalizeAppSettings({ wifiName: 'x'.repeat(80) }).wifiName).toHaveLength(WIFI_NAME_MAX_LENGTH)
  })
})

describe('toWorkData 携带 appSettings', () => {
  it('旧项目没有这个字段时补齐默认值', () => {
    const project = createProject()
    delete project.workSettings.appSettings
    const work = toWorkData(project)
    expect(work.workSettings.appSettings).toEqual(createDefaultAppSettings())
  })

  it('配置能穿过裁剪进入作品数据，关闭时密码被清掉', () => {
    const project = createProject()
    project.workSettings.appSettings = {
      photoLocks: {
        hidden: { enabled: true, length: 6, passcode: '042801' },
        trash: { enabled: false, length: 4, passcode: '1976' },
      },
      wifiName: 'Linxia Home',
    }
    const app = toWorkData(project).workSettings.appSettings
    expect(app.photoLocks.hidden).toEqual({ enabled: true, length: 6, passcode: '042801' })
    expect(app.photoLocks.trash.passcode).toBe('')
    expect(app.wifiName).toBe('Linxia Home')
  })
})

describe('resolvePhotoLock', () => {
  const settings = (hidden, trash) => ({ appSettings: { photoLocks: { hidden, trash } } })

  it('开关 + 满位密码 = 真的上锁', () => {
    const lock = resolvePhotoLock(settings({ enabled: true, length: 4, passcode: '0428' }, {}), 'hidden')
    expect(lock.active).toBe(true)
    expect(lock.passcode).toBe('0428')
    expect(lock.length).toBe(4)
  })

  it('开关开着但密码位数不足 = 不上锁', () => {
    expect(resolvePhotoLock(settings({ enabled: true, length: 6, passcode: '0428' }, {}), 'hidden').active).toBe(false)
    expect(resolvePhotoLock(settings({ enabled: true, length: 4, passcode: '' }, {}), 'hidden').active).toBe(false)
  })

  it('关闭的锁不上锁，且不认识的种类安全返回', () => {
    expect(resolvePhotoLock(settings({ enabled: false, length: 4, passcode: '0428' }, {}), 'hidden').active).toBe(false)
    expect(resolvePhotoLock({}, 'nope')).toEqual({ enabled: false, length: 4, passcode: '', active: false })
    expect(resolvePhotoLock(null, 'hidden').active).toBe(false)
  })

  it('两把锁互相独立', () => {
    const s = settings(
      { enabled: true, length: 4, passcode: '0428' },
      { enabled: false, length: 4, passcode: '' },
    )
    expect(resolvePhotoLock(s, 'hidden').active).toBe(true)
    expect(resolvePhotoLock(s, 'trash').active).toBe(false)
  })
})

describe('resolveWifiName', () => {
  it('留空时用旧静态值兜底，旧作品不变样', () => {
    expect(resolveWifiName({})).toBe(DEFAULT_WIFI_NAME)
    expect(resolveWifiName({ appSettings: { wifiName: '   ' } })).toBe(DEFAULT_WIFI_NAME)
    expect(resolveWifiName(null)).toBe(DEFAULT_WIFI_NAME)
  })

  it('填了就用填的', () => {
    expect(resolveWifiName({ appSettings: { wifiName: 'Linxia Home' } })).toBe('Linxia Home')
  })
})
