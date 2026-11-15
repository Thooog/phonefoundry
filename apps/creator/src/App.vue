<script setup>
/**
 * 应用外壳。
 *
 * 只做三件事：路由出口、全局提示、全局确认框。
 * 任何布局（顶栏、侧栏）都属于具体页面 —— 列表页与工作区的顶栏内容不同，
 * 硬塞进这里会变成一堆 v-if="route.name === ..."。
 */

import ToastHost from './components/ui/ToastHost.vue'
import ConfirmDialog from './components/ui/ConfirmDialog.vue'
</script>

<template>
  <RouterView />
  <ToastHost />
  <ConfirmDialog />
</template>
