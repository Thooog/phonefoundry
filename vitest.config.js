import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

const r = (p) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@shared': r('packages/shared/src'),
      '@phone-sim/shared': r('packages/shared/src'),
      '@player-ui': r('packages/player-ui/src'),
      // 与 apps/creator/vite.config.js 保持一致；导入/导出测试直接引用导出器源码
      '@exporter': r('packages/exporter/src'),
    },
  },
  test: {
    testTransformMode: { web: ['**/home-desktop.test.js'] },
    environment: 'node',
    include: ['packages/**/*.test.js', 'apps/**/*.test.js'],
    globals: false,
    // IndexedDB 在 Node 里不存在，用 fake-indexeddb 提供实现。
    // 注意：这只是"能跑通逻辑"，不能替代真浏览器验证容量限制与持久化行为。
    setupFiles: ['./scripts/vitest.setup.js'],
    // IDB 测试涉及多轮事务，默认 5s 偶尔不够
    testTimeout: 15000,
    // IDB 是全局单例，并行跑会互相干扰
    fileParallelism: false,
  },
})
