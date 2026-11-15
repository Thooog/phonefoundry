<script setup>
defineProps({ label: { type: String, required: true }, disabled: Boolean })
</script>

<template>
  <button type="button" class="delete-icon-button" :disabled="disabled" :aria-label="label" :title="label">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6" />
    </svg>
  </button>
</template>

<style scoped>
.delete-icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--c-text-2);
  cursor: pointer;
}
.delete-icon-button:hover:not(:disabled) {
  color: var(--c-danger);
  background: var(--c-danger-weak);
}
.delete-icon-button:focus-visible {
  outline: 2px solid var(--c-danger);
  outline-offset: 2px;
}
.delete-icon-button:disabled { opacity: .45; cursor: not-allowed; }
@media (any-pointer: coarse) {
  .delete-icon-button { width: 44px; height: 44px; }
}
</style>
