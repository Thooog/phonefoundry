import { ref, computed, watch } from 'vue'
import { nextRecordSelection } from './record-selection.js'

export function useRecordSelection(records) {
  const selectedRecordId = ref(null)
  watch(() => records.value.map((record) => record.id), (ids, previous = []) => {
    selectedRecordId.value = nextRecordSelection(ids, previous, selectedRecordId.value)
  }, { immediate: true })
  const visibleRecords = computed(() => records.value.filter((record) => record.id === selectedRecordId.value))
  return { selectedRecordId, visibleRecords }
}
