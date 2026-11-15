

<script setup>
import { computed } from 'vue'
import { getApp } from '@phone-sim/shared'
import NavBar from '../appkit/NavBar.vue'
import EmptyState from '../appkit/EmptyState.vue'
import AppIcon from '../symbols/AppIcons.vue'
import { usePhoneRuntime } from '../kernel/create-runtime.js'

const runtime = usePhoneRuntime()
const app = computed(() => getApp(runtime.state.currentApp))
</script>

<template>
  <div class="pui-placeholder" data-testid="app-placeholder">
    <NavBar :title="app?.name ?? '应用'" back-label="桌面" @back="runtime.pop()" />
    <div class="pui-placeholder__body">
      <AppIcon v-if="app" :icon-key="app.iconKey" :accent="app.accent" :size="72" />
      <EmptyState
        title="这个应用还没有内容"
        description="它还没有开始做，会在 M4 的后半段补齐。"
      />
    </div>
  </div>
</template>

<style>
.pui-placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: var(--pui-bg-grouped);
}

.pui-placeholder__body {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--pui-space-4);
}
</style>
