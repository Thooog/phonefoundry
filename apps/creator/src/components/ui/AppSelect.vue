<script setup>
/**
 * 下拉选择。
 *
 * options 接受字符串或 {value, label} 两种形态 ——
 * 前者用于"角色 id 列表"这类值即标签的场景，省去调用方手动映射。
 */
import { computed } from 'vue'

const model = defineModel({ type: [String, Number], default: '' })

const props = defineProps({
  id: { type: String, default: undefined },
  /** @type {Array<string | {value: string, label: string}>} */
  options: { type: Array, default: () => [] },
  placeholder: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
})

function normalize(option) {
  return typeof option === 'string' ? { value: option, label: option } : option
}

const normalized = computed(() => props.options.map(normalize))
</script>

<template>
  <select :id="id" v-model="model" class="ui-select" :disabled="disabled">
    <option v-if="placeholder" value="">{{ placeholder }}</option>
    <option v-for="opt in normalized" :key="opt.value" :value="opt.value">
      {{ opt.label }}
    </option>
  </select>
</template>

<style scoped>
.ui-select {
  flex: 1;
  min-width: 0;
  min-height: 40px;
  padding: 0 var(--sp-2);
  border: 1px solid var(--c-border);
  border-radius: 8px;
  background: var(--c-white);
  color: var(--c-text);
  font: inherit;
  font-size: var(--fs-base);
  cursor: pointer;
}

.ui-select:focus {
  outline: none;
  border-color: var(--c-accent);
  box-shadow: 0 0 0 3px var(--c-accent-weak);
}

.ui-select:disabled {
  background: var(--c-bg-sunken);
  color: var(--c-text-3);
  cursor: not-allowed;
}

@media(max-width:767px){.ui-select{min-height:44px;font-size:16px}}
</style>
