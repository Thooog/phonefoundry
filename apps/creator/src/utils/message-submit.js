export function shouldSubmitMessage(event, mobile, composing = false) {
  if (composing || event.isComposing || event.keyCode === 229 || event.repeat) return false
  if (event.type === 'beforeinput') {
    return mobile && (event.inputType === 'insertLineBreak' || event.inputType === 'insertParagraph')
  }
  return event.key === 'Enter' && !event.shiftKey && !event.altKey && Boolean(mobile || event.ctrlKey || event.metaKey)
}
