import { ref, computed } from 'vue'
import { toDateTimeLocal } from '../utils/time.js'

export function useChatImport({ editor, ui, project, owner, readOnly, parseConversationText, resolveImportTimes, addConversation, addMessage, updateMessage, readReceipts = false }) {
  const importOpen = ref(false)
  const importText = ref('')
  const importPreview = ref(null) // parseConversationText 的结果

  // 括号里只写时刻的是发送时间；写了「已读」的是回执，只对手机所属人那行有意义。
  // 中间不写时刻的行会顺着上一条往后推 20 秒，不必每行都标。
  // 单独一行的日期（2026/6/30）给后面的行定日期，跨天的对话靠它分段。

  function openImport() {
    if (readOnly.value) return
    importText.value = ''
    importPreview.value = null
    importOpen.value = true
  }

  function closeImport() {
    importOpen.value = false
    importPreview.value = null
  }

  function runParse() {
    importPreview.value = parseConversationText(project.value, importText.value)
  }

  const importStats = computed(() => {
    const list = importPreview.value ?? []
    const matched = list.filter((l) => l.characterId).length
    const unmatched = list.length - matched
    return { total: list.length, matched, unmatched }
  })

  /**
   * 未识别的行不入脏数据，但也 participe 不到时间推导里 ——
   * 先把它们滤掉，剩下的才是真正会写进会话的消息。
   */
  const importLines = computed(() => (importPreview.value ?? []).filter((l) => l.characterId))

  /**
   * 推导出的每条显示时刻（HH:mm:ss）+ 是否是行里显式写的 + 这一天是不是刚开始。
   * 按「行对象」存而不是按下标 —— 预览列表里还留着未识别的行，
   * 用下标会因为中间少一行而整体错位。
   *
   * `dayStart` 用来在预览里插日期分隔：跨天的导入只看 HH:mm 会以为时间倒流
   * （23:30 下面紧跟 23:24），必须把日期摆出来。
   */
  const importTimeMap = computed(() => {
    const map = new Map()
    const lines = importLines.value
    if (!lines.length) return map
    const iso = resolveImportTimes(lines)
    let prevDay = null
    lines.forEach((line, i) => {
      const local = toDateTimeLocal(iso[i])
      const day = local.slice(0, 10)
      map.set(line, {
        label: local.slice(11),
        explicit: Boolean(line.sentTime),
        showDate: day !== prevDay,
        dateLabel: formatImportDay(day),
      })
      prevDay = day
    })
    return map
  })

  function formatImportDay(day) {
    const [y, m, d] = String(day).split('-').map(Number)
    if (!y || !m || !d) return String(day)
    return `${y}/${m}/${d}`
  }

  /** 解析出的、去重后的「对方」角色 id（用于预填会话参与者） */
  const importParticipants = computed(() => {
    const list = importPreview.value ?? []
    const ids = []
    for (const line of list) {
      // 所属人也是角色、也会发消息，但不进 participantIds（见 editing/messages.js 文件头第 1 点）
      if (line.characterId && line.characterId !== owner.value?.id && !ids.includes(line.characterId)) {
        ids.push(line.characterId)
      }
    }
    return ids
  })

  function doImport() {
    const lines = importLines.value
    if (readOnly.value || !lines.length) return

    let written = 0
    editor.mutate(draft => {
      const batch = { project: draft, mutate: fn => fn(draft) }
    // 1. 新建会话，参与者 = 解析出的「对方」角色
    const conversation = addConversation(batch, { participantIds: [...importParticipants.value] })

    // 2. 逐条写消息。时间不是每条固定 +1 分钟，而是顺着上下文推：
    //    写了 (HH:mm) 的用那个时刻，没写的比上一条晚 20 秒（见 editing/messages.js）。
    const times = resolveImportTimes(importLines.value)
    importLines.value.forEach((line, i) => {
      const displayTime = times[i]
      const senderCharacterId = line.characterId ?? null
      const message = addMessage(batch, conversation.id, {
        senderCharacterId,
        content: line.content,
        displayTime,
      })

      // 已读标记：只对手机所属人发的消息有意义（作品端 readAt 只渲染在右侧气泡下），
      // 写入这条消息的 readAt。已读时刻的日期对齐到该消息的 displayTime 当天。
      if (readReceipts && message && line.readAt && senderCharacterId && senderCharacterId === owner.value?.id) {
        const aligned = alignReadAtToMessage(line.readAt, displayTime)
        updateMessage(batch, message.id, { readAt: aligned })
      }
      written += 1
    })

    })

    closeImport()
    ui.toast(`已导入 ${written} 条消息`, { tone: 'success' })
  }

  /**
   * 把解析出的已读时刻（占位在「今天」）对齐到消息的发送日期：
   * 回执上只打 HH:mm，日期必须跟消息同一天，否则会显示成别的日子。
   */
  function alignReadAtToMessage(readAt, displayTime) {
    const readDate = new Date(readAt)
    const msgDate = new Date(displayTime)
    if (!Number.isFinite(readDate.getTime()) || !Number.isFinite(msgDate.getTime())) return readAt
    readDate.setFullYear(msgDate.getFullYear(), msgDate.getMonth(), msgDate.getDate())
    return readDate.toISOString()
  }

  return { importOpen, importText, importPreview, openImport, closeImport, runParse, importStats, importTimeMap, doImport }
}
