// Presentation-only selection; deletion never changes the underlying records.
export function nextRecordSelection(ids, previousIds, selectedId) {
  const added = ids.find((id) => !previousIds.includes(id))
  if (added) return added
  if (ids.includes(selectedId)) return selectedId
  const index = Math.max(0, previousIds.indexOf(selectedId))
  return ids[Math.min(index, ids.length - 1)] ?? null
}
