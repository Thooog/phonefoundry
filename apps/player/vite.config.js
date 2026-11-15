

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'

const r = (p) => fileURLToPath(new URL(p, import.meta.url))

/**
 * 构建结束后生成 dist/preview.html。
 *
 * 这个文件不能被 check:bundle 视为"额外产物"，所以由插件在写盘后立即生成，
 * 而不是放成单独的 npm script（避免顺序错乱导致检查失败）。
 */
function previewHostPlugin(outDir) {
  return {
    name: 'phone-sim-preview-host',
    apply: 'build',
    closeBundle() {
      const html = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="color-scheme" content="light" />
    <title>作品预览</title>
    <link rel="stylesheet" href="./renderer.css" />
    <style>
      html, body {
        margin: 0;
        padding: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: #e9e9ee;
      }
      #phone-root { width: 100%; height: 100%; }
    </style>
  </head>
  <body>
    <div id="phone-root"></div>
    <script src="./renderer.js"></script>
  </body>
</html>
`
      fs.mkdirSync(outDir, { recursive: true })
      fs.writeFileSync(path.join(outDir, 'preview.html'), html, 'utf8')
      console.log(`[preview-host] 已生成 ${path.relative(process.cwd(), outDir)}/preview.html`)
    },
  }
}

export default defineConfig(({ command }) => {
  const isBuild = command === 'build'

  return {
    plugins: [vue(), isBuild ? previewHostPlugin(r('dist')) : null].filter(Boolean),
    // 相对路径，保证 file:// 与子目录部署都能用
    base: './',
    resolve: {
      alias: {
        '@player-ui': r('../../packages/player-ui/src'),
        '@shared': r('../../packages/shared/src'),
      },
      dedupe: ['vue'],
    },
    // 开发态单独占 5174，与创作端并行
    server: {
      // 监听所有网卡，手机/平板才能通过局域网 IP 访问（默认只听 localhost）
      host: true,
      port: 5174,
      strictPort: true,
      fs: { allow: [r('../..')] },
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      target: 'es2020',
      sourcemap: false,
      cssCodeSplit: false,
      // 仅构建时生效；dev 下 lib 配置会被忽略
      ...(isBuild
        ? {
            lib: {
              entry: r('src/renderer.js'),
              name: 'PhoneSimulatorPlayer',
              formats: ['iife'],
              fileName: () => 'renderer.js',
            },
            rollupOptions: {
              output: {
                // 确保只有一个 JS
                inlineDynamicImports: true,
                assetFileNames: (info) => {
                  const name = info.names?.[0] ?? ''
                  if (name.endsWith('.css')) return 'renderer.css'
                  return 'assets/[name][extname]'
                },
              },
            },
          }
        : {}),
    },
    define: {
      __PHONE_SIM_BUILD__: JSON.stringify(isBuild),
      // 关键：Vue 运行时会读 process.env.NODE_ENV。

      // 这里直接编译期内联成字符串，产物里不会残留 process 引用。
      'process.env.NODE_ENV': JSON.stringify(isBuild ? 'production' : 'development'),
      __VUE_OPTIONS_API__: 'true',
      __VUE_PROD_DEVTOOLS__: 'false',
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
    },
  }
})
