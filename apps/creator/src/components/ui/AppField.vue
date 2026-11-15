<script setup>
/**
 * 表单字段容器：标签 + 说明 + 控件 + 错误。
 *
 * 存在的理由不是"少写几行 div"，是保证所有表单的间距与标签对齐方式一致 ——
 * 作品设置面板有 7 个字段，逐个手写 <label> 迟早会出现某一项偏 2px。
 */
defineProps({
  label: { type: String, required: true },
  hint: { type: String, default: '' },
  error: { type: String, default: '' },
  /** 让 id 与内部控件的 aria-labelledby 对应 */
  fieldId: { type: String, default: '' },
})
</script>

<template>
  <div class="ui-field" :data-invalid="Boolean(error)">
    <label class="ui-field__label" :for="fieldId || undefined">
      {{ label }}
    </label>
    <div class="ui-field__control">
      <slot />
    </div>
    <p v-if="error" class="ui-field__error">{{ error }}</p>
    <p v-else-if="hint" class="ui-field__hint">{{ hint }}</p>
  </div>
</template>

<style scoped>
.ui-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ui-field__label {
  font-size: var(--fs-sm);
  font-weight: 500;
  color: var(--c-text-2);
}

.ui-field__control {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}

.ui-field__hint,
.ui-field__error {
  font-size: var(--fs-sm);
  line-height: 1.45;
  margin: 0;
}

.ui-field__hint {
  color: var(--c-text-3);
}

.ui-field__error {
  color: var(--c-danger);
}
</style>
