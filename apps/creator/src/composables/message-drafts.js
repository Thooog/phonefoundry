export function emptyMessageDraft() {
  return { sender: '', type: 'text', content: '', time: '', duration: 1, transcript: '', callKind: 'voice', callStatus: 'completed', files: [], pendingId: null, uploadedFiles: [] }
}

// The retained id makes retries update the same message after media/save failure.
export async function commitMessageDraft(draft, operations) {
  let message = draft.pendingId ? operations.find(draft.pendingId) : null
  if (!message) {
    draft.uploadedFiles = []
    message = operations.create()
    if (!message) throw new Error('无法新增消息，请检查当前会话。')
    draft.pendingId = message.id
  } else {
    await operations.update(message.id)
    message = operations.find(message.id)
  }
  const uploaded = draft.uploadedFiles ??= []
  // File identity distinguishes retrying a failed save from replacing staged media.
  if (uploaded.some((file, index) => draft.files[index] !== file)) {
    await operations.clearMedia(message)
    uploaded.length = 0
    message = operations.find(message.id)
  }
  for (const file of draft.files.slice(uploaded.length)) {
    const ok = await operations.upload(message, [file])
    if (!ok) throw new Error('图片未能添加，草稿已保留，可以重试。')
    uploaded.push(file)
    message = operations.find?.(message.id) ?? message
  }
  await operations.flush()
  return message.id
}
