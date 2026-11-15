/**
 * 创作端 Vite 配置
 *
 * 与作品端的关键差别：
 *  - 允许 code splitting（是网页应用，不是单文件）
 *  - 允许引入第三方库（pinia / vue-router）
 *  - 需要把作品端的构建产物（renderer.js / renderer.css）作为静态资源暴露给预览 iframe
 *
 * 预览方案：iframe 直接加载 /player/renderer.js 的构建结果。
 * 开发期由中间件从 apps/player/dist 提供，保证"预览跑的就是真实产物"。
 */

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'

const r = (p) => fileURLToPath(new URL(p, import.meta.url))
const PLAYER_DIST = r('../player/dist')

const APP_VERSION = JSON.parse(fs.readFileSync(r('./package.json'), 'utf8')).version

/**
 * 开发期提供作品端构建产物：/player-runtime/*
 * 这样创作端 dev server 就能把真实的 player 产物喂给 iframe，
 * 不必再起第二个 server、也不会出现跨端口同源问题。
 */
function playerRuntimePlugin() {
  return {
    name: 'phone-sim-player-runtime',
    configureServer(server) {
      server.middlewares.use('/player-runtime', (req, res, next) => {
        const urlPath = (req.url || '/').split('?')[0]
        let decodedPath
        try {
          decodedPath = decodeURIComponent(urlPath)
        } catch {
          res.statusCode = 400
          res.end('bad path')
          return
        }
        const fileName = decodedPath === '/' || decodedPath === ''
          ? 'preview.html'
          : decodedPath.replace(/^\//, '')
        const filePath = path.resolve(PLAYER_DIST, fileName)

        // 用相对路径判断边界，避免 dist-backup 这类同前缀目录绕过检查。
        const relativePath = path.relative(PLAYER_DIST, filePath)
        if (
          fileName.includes('\0') ||
          relativePath === '..' ||
          relativePath.startsWith(`..${path.sep}`) ||
          path.isAbsolute(relativePath)
        ) {
          res.statusCode = 403
          res.end('forbidden')
          return
        }

        let realRoot
        let realFilePath
        try {
          realRoot = fs.realpathSync(PLAYER_DIST)
          realFilePath = fs.realpathSync(filePath)
        } catch {
          res.statusCode = 404
          res.setHeader('Content-Type', 'text/plain; charset=utf-8')
          res.end(
            `作品端产物不存在：${fileName}\n请先运行 pnpm build:player（或 pnpm dev 会先构建一次）`,
          )
          return
        }

        // 词法路径在目录内还不够：不允许 dist 内的符号链接把请求带出目录。
        const realRelativePath = path.relative(realRoot, realFilePath)
        if (
          realRelativePath === '..' ||
          realRelativePath.startsWith(`..${path.sep}`) ||
          path.isAbsolute(realRelativePath)
        ) {
          res.statusCode = 403
          res.end('forbidden')
          return
        }

        const ext = path.extname(realFilePath)
        const typeMap = {
          '.js': 'text/javascript; charset=utf-8',
          '.css': 'text/css; charset=utf-8',
          '.html': 'text/html; charset=utf-8',
          '.svg': 'image/svg+xml',
          '.webp': 'image/webp',
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.woff2': 'font/woff2',
        }
        res.setHeader('Content-Type', typeMap[ext] ?? 'application/octet-stream')
        res.setHeader('Cache-Control', 'no-store')
        fs.createReadStream(realFilePath).pipe(res)
        void next
      })
    },
  }
}

function playerRuntimeCopyPlugin() {
  let outDir = 'dist'

  return {
    name: 'phone-sim-player-runtime-copy',
    apply: 'build',
    configResolved(config) {
      /*
       * 必须用 config.root 拼，不能直接 `path.resolve(outDir, ...)`。
       * `build.outDir` 在解析后的配置里仍可能是相对值（`dist`），而 path.resolve
       * 用的是**当前工作目录** —— 从仓库根跑 `vite build apps/creator` 时，
       * 拷贝会落到 `<仓库根>/dist/player-runtime`，而真正的 `apps/creator/dist`
       * 里空空如也：预览 iframe 直接 404，且构建日志一句错都不报。
       */
      outDir = path.resolve(config.root, config.build.outDir)
    },
    closeBundle() {
      const targetDir = path.resolve(outDir, 'player-runtime')
      const files = fs.existsSync(PLAYER_DIST) ? fs.readdirSync(PLAYER_DIST) : []

      if (!files.includes('renderer.js')) {
        throw new Error(
          `[player-runtime] 找不到作品端产物：${PLAYER_DIST}\n` +
            '  预览页加载的是真实的作品端构建结果，没有它出来的包是坏的。\n' +
            '  先构建作品端：在 apps/player 下执行 `node ../../node_modules/vite/bin/vite.js build`，\n' +
            '  或者直接用根目录的 `pnpm build`（它保证先 player 后 creator）。',
        )
      }

      fs.mkdirSync(targetDir, { recursive: true })
      for (const name of files) {
        const from = path.join(PLAYER_DIST, name)
        if (!fs.statSync(from).isFile()) continue
        fs.copyFileSync(from, path.join(targetDir, name))
      }
    },
  }
}

export default defineConfig({
  plugins: [vue(), playerRuntimePlugin(), playerRuntimeCopyPlugin()],
  base: './',
  define: {
    // 备份包 manifest 里的 appVersion，见上方 APP_VERSION 的注释
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  resolve: {
    alias: {
      '@': r('src'),
      '@player-ui': r('../../packages/player-ui/src'),
      '@shared': r('../../packages/shared/src'),
      '@exporter': r('../../packages/exporter/src'),
    },
    dedupe: ['vue'],
  },
  server: {
    // 监听所有网卡，手机/平板才能通过局域网 IP 访问（默认只听 localhost）
    host: true,
    port: 5173,
    strictPort: true,
    fs: { allow: [r('../..')] },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
})
