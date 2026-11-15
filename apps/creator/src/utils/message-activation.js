// Touch double taps need their own recognition; synthesized mouse events vary across browsers.
export function createMessageActivation(select, edit) {
  const delay = 350
  let timer, pointer, lastTap, pendingTouchEdit
  let ignoreMouseUntil = 0
  const now = () => performance.now()
  const cancelClick = () => clearTimeout(timer)
  const open = id => { cancelClick(); lastTap = null; pendingTouchEdit = null; edit(id) }
  const resetTouch = () => { pointer = null; lastTap = null; pendingTouchEdit = null; cancelClick() }
  return {
    click(id, event) {
      if (now() < ignoreMouseUntil) {
        if (pendingTouchEdit != null) open(pendingTouchEdit)
        return
      }
      cancelClick()
      if (event.detail === 0) { select(id); return }
      timer = setTimeout(() => select(id), delay)
    },
    doubleClick(id) { if (now() >= ignoreMouseUntil) open(id) },
    edit: open,
    pointerDown(id, event) {
      if (!['touch', 'pen'].includes(event.pointerType)) return
      ignoreMouseUntil = now() + 700
      cancelClick()
      pendingTouchEdit = null
      if (event.isPrimary === false) { resetTouch(); return }
      pointer = { id, pointerId: event.pointerId, x: event.clientX, y: event.clientY, time: now() }
    },
    pointerMove(event) {
      if (pointer?.pointerId === event.pointerId && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 12) resetTouch()
    },
    pointerUp(id, event) {
      if (!['touch', 'pen'].includes(event.pointerType)) return
      ignoreMouseUntil = now() + 700
      const start = pointer
      pointer = null
      if (!start || start.pointerId !== event.pointerId || start.id !== id) return
      if (now() - start.time > 500 || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 12) { resetTouch(); return }
      if (lastTap?.id === id && now() - lastTap.time <= delay && Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) <= 24) {
        cancelClick()
        lastTap = null
        pendingTouchEdit = id
        // Open after the synthesized click; opening on pointerup retargets that click to the dialog backdrop.
        timer = setTimeout(() => open(id), delay)
        return
      }
      lastTap = { id, time: now(), x: event.clientX, y: event.clientY }
      timer = setTimeout(() => { lastTap = null; select(id) }, delay)
    },
    pointerCancel: resetTouch,
    dispose: resetTouch,
  }
}
