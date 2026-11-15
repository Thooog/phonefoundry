<script setup>

const model = defineModel({ type: String, default: '' })

defineProps({
  id: { type: String, default: undefined },
  placeholder: { type: String, default: '' },
  maxlength: { type: Number, default: undefined },
  type: { type: String, default: 'text' },
  disabled: { type: Boolean, default: false },
  /** 数字输入的下限（type="number" 时生效），如粉丝 / 关注数不允许负数 */
  min: { type: [Number, String], default: undefined },
  /** 等宽字体：用于密码、ID 这类逐字符阅读的内容 */
  mono: { type: Boolean, default: false },
})
</script>

<template>
  <input
    :id="id"
    v-model="model"
    class="ui-input"
    :class="{ 'ui-input--mono': mono }"
    :type="type"
    :placeholder="placeholder"
    :maxlength="maxlength"
    :min="min"
    :disabled="disabled"
  />
</template>

<style scoped>
.ui-input {
  flex: 1;
  min-width: 0;
  min-height: 40px;
  padding: 0 var(--sp-3);
  border: 1px solid var(--c-border);
  border-radius: 8px;
  background: var(--c-white);
  color: var(--c-text);
  font: inherit;
  font-size: var(--fs-base);
  transition:
    border-color var(--dur-fast) var(--ease),
    box-shadow var(--dur-fast) var(--ease);
}

.ui-input::placeholder {
  color: var(--c-text-3);
}

.ui-input:focus {
  outline: none;
  border-color: var(--c-accent);
  box-shadow: 0 0 0 3px var(--c-accent-weak);
}

.ui-input:disabled {
  background: var(--c-bg-sunken);
  color: var(--c-text-3);
  cursor: not-allowed;
}

.ui-input--mono {
  font-family: var(--font-mono);
  letter-spacing: 0.08em;
}

@media(max-width:767px){.ui-input{min-height:44px;font-size:16px}}
</style>
