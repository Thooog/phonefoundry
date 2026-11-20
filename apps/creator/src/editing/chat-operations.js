const nowIso = () => new Date().toISOString()
const STEP_MS = 1000

export function createChatOperations(APP) {
  function nearAnchor(anchorTime, direction) {
    const base = Date.parse(anchorTime)
    if (!Number.isFinite(base)) return nowIso()
    return new Date(base + direction * STEP_MS).toISOString()
  }

  function ensureBucket(project) {
    if (!project.appData || typeof project.appData !== 'object') project.appData = {}
    if (!project.appData[APP]) project.appData[APP] = { conversations: [], messages: [] }

    const bucket = project.appData[APP]
    if (!Array.isArray(bucket.conversations)) bucket.conversations = []
    if (!Array.isArray(bucket.messages)) bucket.messages = []
    return bucket
  }

  function conversationsOf(project) {
    const list = project?.appData?.[APP]?.conversations ?? []
    return [...list].sort((a, b) => String(b.sortKey ?? '').localeCompare(String(a.sortKey ?? '')))
  }

  function threadOf(project, conversationId) {
    const messages = project?.appData?.[APP]?.messages ?? []
    return messages.filter((m) => m.conversationId === conversationId)
  }

  function deleteConversation(editor, conversationId) {
    let removed = false
    let removedMessages = 0

    editor.mutate((draft) => {
      const bucket = ensureBucket(draft)
      const keptConvs = bucket.conversations.filter((c) => c.id !== conversationId)
      removed = keptConvs.length !== bucket.conversations.length
      bucket.conversations = keptConvs

      const keptMsgs = bucket.messages.filter((m) => m.conversationId !== conversationId)
      removedMessages = bucket.messages.length - keptMsgs.length
      bucket.messages = keptMsgs
    })

    return { removed, removedMessages }
  }

  function countMessagesOf(project, conversationId) {
    return (project?.appData?.[APP]?.messages ?? []).filter((m) => m.conversationId === conversationId).length
  }

  function deleteMessage(editor, messageId) {
    let removed = false
    editor.mutate((draft) => {
      const bucket = ensureBucket(draft)
      const kept = bucket.messages.filter((m) => m.id !== messageId)
      removed = kept.length !== bucket.messages.length
      bucket.messages = kept
    })
    return removed
  }

  /**
   * 改一条消息的发送时间，并把它**之后**的消息整体平移同一个差值。
   *
   * 「之后」按会话里的物理顺序算（addMessage 就是按插入位置排的），不按时间排：
   * 一旦有消息的时间被改乱，按时间找「谁在后面」就会挑错人，而物理顺序就是
   * 作者眼里的先后。
   *
   * 锚点设成目标时间，后面每条各加 `目标 − 原时间`，相对间隔原样保留 ——
   * 作者修一条消息的时刻，整段对话的节奏不该被压扁或拉开。
   *
   * @returns {{ deltaMs: number, shifted: number }} 平移量与跟着动的条数（不含锚点）
   */
  function retimeMessage(editor, conversationId, messageId, iso) {
    const to = Date.parse(iso)
    if (!Number.isFinite(to)) return { deltaMs: 0, shifted: 0 }
    let deltaMs = 0
    let shifted = 0
    editor.mutate((draft) => {
      const bucket = ensureBucket(draft)
      const list = bucket.messages
      const thread = list.filter((m) => m.conversationId === conversationId)
      const index = thread.findIndex((m) => m.id === messageId)
      if (index === -1) return
      const from = Date.parse(thread[index].displayTime)
      deltaMs = Number.isFinite(from) ? to - from : 0
      const later = new Set(thread.slice(index + 1).map((m) => m.id))
      const stamp = nowIso()
      bucket.messages = list.map((m) => {
        if (m.id === messageId) return { ...m, displayTime: iso, updatedAt: stamp }
        if (!deltaMs || !later.has(m.id)) return m
        const time = Date.parse(m.displayTime)
        if (!Number.isFinite(time)) return m
        shifted += 1
        return { ...m, displayTime: new Date(time + deltaMs).toISOString(), updatedAt: stamp }
      })
    })
    return { deltaMs, shifted }
  }
  return { nearAnchor, ensureBucket, conversationsOf, threadOf, deleteConversation, countMessagesOf, deleteMessage, retimeMessage }
}
