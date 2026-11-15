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
  return { nearAnchor, ensureBucket, conversationsOf, threadOf, deleteConversation, countMessagesOf, deleteMessage }
}
