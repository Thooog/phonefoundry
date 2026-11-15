import { describe, it, expect } from 'vitest'

import {
  CONTACT_NAME_MAX_LENGTH,
  PHONE_NUMBER_MAX_LENGTH,
  addCall,
  addContact,
  countCallsOfContact,
  deleteCall,
  deleteContact,
  selectableContacts,
  sortCallsByTime,
  sortContactsByName,
  updateCall,
  updateContact,
} from '../phone.js'

function createEditor() {
  let mutations = 0
  const editor = {
    project: {
      id: 'prj_test',
      characters: [],
      platformAccounts: [],
      appData: { phone: { contacts: [], calls: [] } },
      assets: [],
    },
    get mutations() {
      return mutations
    },
    mutate(fn) {
      mutations += 1
      const draft = { ...editor.project }
      fn(draft)
      editor.project = draft
    },
  }
  return editor
}

const bucketOf = (editor) => editor.project.appData.phone

describe('addContact', () => {
  it('写入联系人，未关联角色时为 null', () => {
    const editor = createEditor()
    const contact = addContact(editor, { name: '周雨', phoneNumber: '13900139000' })

    expect(bucketOf(editor).contacts).toHaveLength(1)
    expect(contact.name).toBe('周雨')
    expect(contact.phoneNumber).toBe('13900139000')
    expect(contact.characterId).toBeNull()
  })

  it('姓名超长被截断', () => {
    const editor = createEditor()
    const contact = addContact(editor, { name: '名'.repeat(CONTACT_NAME_MAX_LENGTH + 10) })
    expect(contact.name).toHaveLength(CONTACT_NAME_MAX_LENGTH)
  })
})

describe('updateContact', () => {
  it('改号码与备注', () => {
    const editor = createEditor()
    const contact = addContact(editor, { name: 'A' })
    const updated = updateContact(editor, contact.id, { phoneNumber: '1', note: '楼下便利店' })

    expect(updated.phoneNumber).toBe('1')
    expect(updated.note).toBe('楼下便利店')
    expect(bucketOf(editor).contacts[0].note).toBe('楼下便利店')
  })

  it('characterId 传 null 是有效的「解除关联」', () => {
    const editor = createEditor()
    const contact = addContact(editor, { name: 'A', characterId: 'chr_1' })
    const updated = updateContact(editor, contact.id, { characterId: null })

    // 如果实现里用真值判断过滤，这里会保持 chr_1 而用户以为解绑了
    expect(updated.characterId).toBeNull()
  })

  it('id 不在白名单内，改不动', () => {
    const editor = createEditor()
    const contact = addContact(editor, { name: 'A' })
    updateContact(editor, contact.id, { id: 'hacked' })
    expect(bucketOf(editor).contacts[0].id).toBe(contact.id)
  })
})

describe('deleteContact', () => {
  it('连带删掉挂在该联系人名下的通话记录', () => {
    const editor = createEditor()
    const contact = addContact(editor, { name: 'A' })
    const other = addContact(editor, { name: 'B' })
    addCall(editor, { contactId: contact.id })
    addCall(editor, { contactId: contact.id })
    addCall(editor, { contactId: other.id })

    const result = deleteContact(editor, contact.id)

    expect(result.removed).toBe(true)
    expect(result.removedCalls).toBe(2)
    expect(bucketOf(editor).calls).toHaveLength(1)
    expect(bucketOf(editor).calls[0].contactId).toBe(other.id)
  })

  it('只删一条 mutate：联系人 + 通话一次提交', () => {
    const editor = createEditor()
    const contact = addContact(editor, { name: 'A' })
    addCall(editor, { contactId: contact.id })

    const before = editor.mutations
    deleteContact(editor, contact.id)
    expect(editor.mutations - before).toBe(1)
  })

  it('删不存在的联系人不会误删通话', () => {
    const editor = createEditor()
    const contact = addContact(editor, { name: 'A' })
    addCall(editor, { contactId: contact.id })

    const result = deleteContact(editor, 'con_nope')
    expect(result.removed).toBe(false)
    expect(result.removedCalls).toBe(0)
    expect(bucketOf(editor).calls).toHaveLength(1)
  })
})

describe('addCall', () => {
  it('默认是来电、时长 0', () => {
    const editor = createEditor()
    const call = addCall(editor, { contactId: 'con_1' })
    expect(call.type).toBe('incoming')
    expect(call.durationSec).toBe(0)
    expect(Number.isFinite(Date.parse(call.displayTime))).toBe(true)
  })

  it('非法类型回落到来电', () => {
    const editor = createEditor()
    const call = addCall(editor, { contactId: 'con_1', type: 'weird' })
    expect(call.type).toBe('incoming')
  })

  it('负时长归零', () => {
    const editor = createEditor()
    const call = addCall(editor, { contactId: 'con_1', durationSec: -30 })
    expect(call.durationSec).toBe(0)
  })

  it('可以不挂联系人，只填一个陌生号码', () => {
    const editor = createEditor()
    const call = addCall(editor, { phoneNumber: ' 13800138000 ', type: 'missed' })

    expect(call.contactId).toBeNull()
    expect(call.phoneNumber).toBe('13800138000') // 首尾空白被裁掉
    expect(call.type).toBe('missed')
    expect(bucketOf(editor).calls).toHaveLength(1)
  })

  it('既没联系人也没号码也是一条合法通话（无主叫号码）', () => {
    const editor = createEditor()
    const call = addCall(editor)
    expect(call.contactId).toBeNull()
    expect(call.phoneNumber).toBe('')
  })

  it('挂了联系人就不留号码：两个归属不能同时存在', () => {
    const editor = createEditor()
    const contact = addContact(editor, { name: '房东', phoneNumber: '13900139000' })
    const call = addCall(editor, { contactId: contact.id, phoneNumber: '13800138000' })
    expect(call.phoneNumber).toBe('')
  })

  it('号码超长被截断', () => {
    const editor = createEditor()
    const call = addCall(editor, { phoneNumber: '1'.repeat(PHONE_NUMBER_MAX_LENGTH + 8) })
    expect(call.phoneNumber).toHaveLength(PHONE_NUMBER_MAX_LENGTH)
  })
})

describe('updateCall', () => {
  it('改成未接来电时，时长强制归零', () => {
    const editor = createEditor()
    const call = addCall(editor, { contactId: 'con_1', type: 'incoming', durationSec: 3600 })
    const updated = updateCall(editor, call.id, { type: 'missed' })

    expect(updated.type).toBe('missed')
    expect(updated.durationSec).toBe(0)
  })

  it('超长时长被收到 24 小时以内', () => {
    const editor = createEditor()
    const call = addCall(editor, { contactId: 'con_1' })
    const updated = updateCall(editor, call.id, { durationSec: 60 * 60 * 100 })
    expect(updated.durationSec).toBe(24 * 3600)
  })

  it('没有可写字段时不触发 mutate', () => {
    const editor = createEditor()
    const call = addCall(editor, { contactId: 'con_1' })
    const before = editor.mutations
    expect(updateCall(editor, call.id, {})).toBeNull()
    expect(editor.mutations).toBe(before)
  })

  it('改陌生号码', () => {
    const editor = createEditor()
    const call = addCall(editor, { phoneNumber: '13800138000' })
    const updated = updateCall(editor, call.id, { phoneNumber: '13900139000' })
    expect(updated.phoneNumber).toBe('13900139000')
  })

  it('从陌生号码切到联系人：号码被清掉', () => {
    const editor = createEditor()
    const contact = addContact(editor, { name: '房东', phoneNumber: '13900139000' })
    const call = addCall(editor, { phoneNumber: '13800138000' })

    const updated = updateCall(editor, call.id, { contactId: contact.id })
    expect(updated.contactId).toBe(contact.id)
    expect(updated.phoneNumber).toBe('')
  })

  it('从联系人切回陌生号码：contactId 变 null，之前填的号码不复活', () => {
    const editor = createEditor()
    const contact = addContact(editor, { name: '房东' })
    const call = addCall(editor, { contactId: contact.id })

    const updated = updateCall(editor, call.id, { contactId: null })
    expect(updated.contactId).toBeNull()
    expect(updated.phoneNumber).toBe('')
  })
})

describe('deleteCall', () => {
  it('删掉指定的一条', () => {
    const editor = createEditor()
    const call = addCall(editor, { contactId: 'con_1' })
    expect(deleteCall(editor, call.id)).toBe(true)
    expect(bucketOf(editor).calls).toHaveLength(0)
  })

  it('删不存在的一条返回 false', () => {
    const editor = createEditor()
    expect(deleteCall(editor, 'call_nope')).toBe(false)
  })
})

describe('排序', () => {
  it('联系人按姓名排（中文按拼音）', () => {
    const sorted = sortContactsByName([{ name: '周雨' }, { name: '安禾' }, { name: '陈默' }])
    expect(sorted.map((c) => c.name)).toEqual(['安禾', '陈默', '周雨'])
  })

  it('通话记录新的在前，无效时间垫底', () => {
    const sorted = sortCallsByTime([
      { id: 'none', displayTime: '' },
      { id: 'old', displayTime: '2026-01-01T00:00:00.000Z' },
      { id: 'new', displayTime: '2026-10-01T00:00:00.000Z' },
    ])
    expect(sorted.map((c) => c.id)).toEqual(['new', 'old', 'none'])
  })
})

describe('selectableContacts', () => {
  it('合并显式联系人与角色信息 / 电话账号派生出来的联系人', () => {
    const editor = createEditor()
    addContact(editor, { name: '显式', phoneNumber: '111' })
    editor.project.characters = [{ id: 'chr_1', name: '安禾', avatarAssetId: null }]
    editor.project.platformAccounts = [
      { id: 'acc_1', characterId: 'chr_1', platform: 'messages', displayName: '安禾' },
    ]

    const names = selectableContacts(editor.project).map((c) => c.name)
    expect(names).toContain('显式')
    expect(names).toContain('安禾')
  })

  it('已有关联联系人的角色不再派生，避免同一个人出现两次', () => {
    const editor = createEditor()
    editor.project.characters = [{ id: 'chr_1', name: '安禾' }]
    editor.project.platformAccounts = [
      { id: 'acc_1', characterId: 'chr_1', platform: 'messages', displayName: '安禾' },
    ]
    addContact(editor, { name: '安禾', characterId: 'chr_1' })

    const list = selectableContacts(editor.project)
    expect(list.filter((c) => c.name === '安禾')).toHaveLength(1)
  })

  it('project 为空时返回空数组，不炸', () => {
    expect(selectableContacts(null)).toEqual([])
  })
})

describe('countCallsOfContact', () => {
  it('只数挂在该联系人名下的', () => {
    const editor = createEditor()
    addCall(editor, { contactId: 'con_1' })
    addCall(editor, { contactId: 'con_1' })
    addCall(editor, { contactId: 'con_2' })

    expect(countCallsOfContact(editor.project, 'con_1')).toBe(2)
    expect(countCallsOfContact(editor.project, 'con_nope')).toBe(0)
  })
})
