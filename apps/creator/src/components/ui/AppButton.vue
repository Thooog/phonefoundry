<script setup>

defineProps({
  /** default | primary | ghost | danger */
  variant: { type: String, default: 'default' },
  /** sm | md */
  size: { type: String, default: 'md' },
  disabled: { type: Boolean, default: false },
  /** 原生 type，默认 button 避免在表单里意外提交 */
  nativeType: { type: String, default: 'button' },
})
</script>

<template>
  <button
    class="ui-btn"
    :type="nativeType"
    :data-variant="variant"
    :data-size="size"
    :disabled="disabled"
  >
    <slot />
  </button>
</template>

<style scoped>
.ui-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 38px;
  padding: 0 var(--sp-3);
  border: 1px solid var(--c-border-strong);
  border-radius: var(--radius-sm);
  background: var(--c-white);
  color: var(--c-text);
  font-size: var(--fs-base);
  white-space: nowrap;
  transition:
    background var(--dur-fast) var(--ease),
    border-color var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
}

.ui-btn:hover:not(:disabled) {
  background: var(--c-bg-sunken);
}

.ui-btn:active:not(:disabled) {
  transform: translateY(0.5px);
}

.ui-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.ui-btn[data-size='sm'] {
  min-height: 34px;
  padding: 0 var(--sp-2);
  font-size: var(--fs-sm);
}

.ui-btn[data-variant='primary'] {
  background: var(--c-accent);
  border-color: var(--c-accent);
  color: var(--c-text-inverse);
}

.ui-btn[data-variant='primary']:hover:not(:disabled) {
  background: var(--c-accent-hover);
  border-color: var(--c-accent-hover);
}

.ui-btn[data-variant='ghost'] {
  background: transparent;
  border-color: transparent;
}

.ui-btn[data-variant='ghost']:hover:not(:disabled) {
  background: var(--c-bg-sunken);
}

.ui-btn[data-variant='danger'] {
  border-color: transparent;
  color: var(--c-danger);
}

.ui-btn[data-variant='danger']:hover:not(:disabled) {
  background: var(--c-danger-weak);
  border-color: var(--c-danger);
}

@media(max-width:767px){.ui-btn,.ui-btn[data-size=sm]{min-height:44px}}
</style>
