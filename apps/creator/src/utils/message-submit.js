/**
 * 消息输入框的 Enter 规则：**Enter 直接发**，Shift+Enter / Ctrl(⌘)+Enter 都是换行。
 *
 * 触屏软键盘不一定发 keydown，只发 beforeinput 的 insertLineBreak，
 * 所以那条分支必须留着，并且只在触屏上认 —— 桌面端按 Enter 已经先被 keydown 拦下来了。
 */
export function shouldSubmitMessage(event, mobile, composing = false) {
  if (composing || event.isComposing || event.keyCode === 229 || event.repeat) return false
  if (event.type === 'beforeinput') {
    return mobile && (event.inputType === 'insertLineBreak' || event.inputType === 'insertParagraph')
  }
  if (event.key !== 'Enter') return false
  return !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey
}
