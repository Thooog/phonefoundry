import { describe, it, expect, vi } from 'vitest'
import { emptyMessageDraft, commitMessageDraft } from '../message-drafts.js'
describe('message draft retries', () => {
  it('reuses the message id after a save failure', async () => {
    const draft = emptyMessageDraft()
    const create = vi.fn(() => ({ id: 'new' }))
    const update = vi.fn()
    const ops = { create, update, find: () => ({ id: 'new' }), flush: vi.fn().mockRejectedValueOnce(new Error('save failed')).mockResolvedValue(), upload: vi.fn() }
    await expect(commitMessageDraft(draft, ops)).rejects.toThrow('save failed')
    expect(draft.pendingId).toBe('new')
    await expect(commitMessageDraft(draft, ops)).resolves.toBe('new')
    expect(create).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledTimes(1)
  })
  it('retains staged files after media failure', async () => {
    const draft = { ...emptyMessageDraft(), files: ['image'] }
    const ops = { create: () => ({ id: 'new' }), upload: async () => false }
    await expect(commitMessageDraft(draft, ops)).rejects.toThrow('图片未能添加')
    expect(draft.files).toEqual(['image'])
    expect(draft.pendingId).toBe('new')
  })
  it('uploads replacement files after upload succeeded but saving failed', async () => {
    const first = {}, replacement = {}
    const draft = { ...emptyMessageDraft(), files: [first] }
    let message = { id:'new', mediaAssetIds:[] }
    const ops = {
      create:vi.fn(()=>message), find:()=>message, update:vi.fn(),
      clearMedia:vi.fn(async()=>{message={...message,mediaAssetIds:[]}}),
      upload:vi.fn(async()=>{message={...message,mediaAssetIds:['asset']};return true}),
      flush:vi.fn().mockRejectedValueOnce(new Error('save failed')).mockResolvedValue(),
    }
    await expect(commitMessageDraft(draft,ops)).rejects.toThrow('save failed')
    draft.files=[replacement]
    await commitMessageDraft(draft,ops)
    expect(ops.create).toHaveBeenCalledTimes(1)
    expect(ops.clearMedia).toHaveBeenCalledTimes(1)
    expect(ops.upload).toHaveBeenLastCalledWith(expect.objectContaining({id:'new'}),[replacement])
  })
  it('resumes a partially uploaded batch without uploading successful files again', async () => {
    const files=[{},{}], draft={...emptyMessageDraft(),files}
    const message={id:'new',mediaAssetIds:[]}
    const ops={create:vi.fn(()=>message),find:()=>message,update:vi.fn(),upload:vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false).mockResolvedValueOnce(true),flush:vi.fn()}
    await expect(commitMessageDraft(draft,ops)).rejects.toThrow('图片未能添加')
    await commitMessageDraft(draft,ops)
    expect(ops.upload).toHaveBeenCalledTimes(3)
    expect(ops.upload).toHaveBeenLastCalledWith(message,[files[1]])
    expect(ops.create).toHaveBeenCalledTimes(1)
  })
})
